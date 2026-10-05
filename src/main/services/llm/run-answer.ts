import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AnswerPayload, LlmRequest, Usage } from '../../../shared/types';
import { IPC } from '../../../shared/ipc-contract';
import { LLM_STALL_TIMEOUT_MS } from '../../../shared/constants';
import { settings } from '../settings';
import { getActiveProfile } from '../profiles';
import { loadKnowledge, loadMemoryFacts, loadWatchedMarkdown } from '../knowledge';
import { buildAnswerRequest } from '../prompt-builder';
import { getLlmProvider, providerContext } from './registry';
import { estimateCost } from './prices';
import { getLectureHistory, getExpansionArchiveCorpora, recordEvent } from '../sessions';
import { lectureDraftContext, lectureExpansionContext } from '../lecture-history';
import { selectExpansionEvidence } from '../expansion-search';
import { loadExpansionSourcesConfig, loadExpansionIndexCorpora } from '../expansion-sources';
import { checkSuggestion } from '../suggestion-guard';
import { getSecret } from '../secrets';
import { detectQuestion } from '../question-detection';
import { isParticipationCourse } from '../../../shared/course-participation';
import { AnswerSnapshots, buildExpansionRequest, buildRefinementRequest } from '../answer-expansion';

const active = new Map<string, AbortController>();
const snapshots = new AnswerSnapshots();
export function cancelAnswer(): void {
  for (const controller of active.values()) controller.abort();
  active.clear();
}

function friendlyError(err: unknown, providerId: string): string {
  const msg = String((err as Error)?.message ?? err);
  const status = (err as { status?: number }).status;
  if (status === 401 || /401|invalid.*key/i.test(msg)) return `${providerId}: invalid or missing API key — check Settings → Providers.`;
  if (status === 429 || /429|rate.?limit/i.test(msg)) return `${providerId}: rate limited — wait a moment and retry.`;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|network (?:unavailable|error)|NetworkError/i.test(msg)) return `${providerId}: cannot reach the API — check your connection.`;
  return `${providerId}: ${msg}`;
}

export async function runAnswer(sender: WebContents, payload: AnswerPayload): Promise<void> {
  const requestStartedAt = performance.now();
  const lectureCutoff = Date.now();
  const id = payload.requestId ?? randomUUID();
  const controller = new AbortController();
  const emit = (channel: string, value: unknown): void => {
    if (controller.signal.aborted || active.get(id) !== controller) return;
    if (!payload.requestId) { sender.send(channel, value); return; } // opt-in headless diagnostics
    sender.send(channel, channel === IPC.evAnswerDelta ? { requestId: id, text: value }
      : channel === IPC.evAnswerError ? { requestId: id, error: value }
      : { ...(value as object), requestId: id });
  };
  if (active.has(id) || active.size >= 2) {
    sender.send(IPC.evAnswerError, payload.requestId ? { requestId: id, error: 'Answer slots busy; retry this question.' } : 'Answer slots busy');
    return;
  }
  active.set(id, controller);
  try {
    const cfg = settings().get();
    const profile = getActiveProfile(); // freeze course before asynchronous work
    if (payload.profileId && payload.profileId !== profile.id) throw new Error('Class changed; question cancelled.');
    if (payload.expandAnswerId && payload.refineAnswerId) throw new Error('Choose expansion or refinement, not both.');
    const parentId = payload.expandAnswerId ?? payload.refineAnswerId;
    const original = parentId ? snapshots.get(parentId, sender.id, profile.id) : null;
    const source = original?.payload ?? payload;
    const isSuggestion = source.responseKind === 'question-suggestion';
    if (!original && !payload.forced && !payload.detected && cfg.questionDetection.provider === 'jev') {
      const key = getSecret('typesafe');
      if (!key) throw new Error('Add your TypeSafe key in Settings → Providers to enable Jev. Ask now bypasses Jev.');
      const probability = await detectQuestion(payload, key, controller.signal, fetch, profile.questionDetection?.mode);
      if (controller.signal.aborted) return;
      if (probability < cfg.questionDetection.threshold) {
        emit(IPC.evAnswerDelta, 'SKIP'); emit(IPC.evAnswerDone, { usage: null }); return;
      }
    }
    const namespaces = profile.memory?.namespaces ?? [];
    const expansionEvidence = original && payload.expandAnswerId && profile.questionDetection?.mode !== 'general' ? (() => {
      const config = loadExpansionSourcesConfig();
      const corpora = [...loadExpansionIndexCorpora(config),
        ...getExpansionArchiveCorpora(profile.id, original.lectureCutoff ?? lectureCutoff, config.transcriptProfiles)];
      return selectExpansionEvidence(corpora, profile.id, source.question ?? source.newSegment,
        original.answer, source.fullTranscript, true);
    })() : [];
    const request: LlmRequest = original ? payload.refineAnswerId
      ? buildRefinementRequest(original.request, original.answer, payload.clarification ?? '', profile.id)
      : buildExpansionRequest(original.request, original.answer, profile.id,
        lectureExpansionContext(getLectureHistory(profile.id, original.lectureCutoff ?? lectureCutoff),
          source.question ?? source.newSegment, source.fullTranscript), expansionEvidence) : buildAnswerRequest({ profile,
      knowledge: loadKnowledge(profile, `${payload.newSegment} ${(payload.questionContext ?? payload.fullTranscript).slice(-1000)}`, payload.fullTranscript.slice(-1000)),
      memory: [...loadMemoryFacts(namespaces), ...loadWatchedMarkdown(namespaces)], settings: cfg, ...payload,
      ...(isSuggestion ? { earlierLecture: lectureDraftContext(getLectureHistory(profile.id), payload.newSegment + '\n' + payload.fullTranscript.slice(-1500)) }
        : isParticipationCourse(profile.id) ? { earlierLecture: lectureExpansionContext(getLectureHistory(profile.id, lectureCutoff), payload.question ?? payload.newSegment, payload.questionContext ?? payload.fullTranscript, 6000) } : {}) });
    const chain = [cfg.llm.provider, ...cfg.llm.fallbacks.filter(f => f !== cfg.llm.provider)];
    let lastError = '';
    for (const providerId of chain) {
      if (controller.signal.aborted) return;
      let firstDeltaSent = false, answerText = '', timedOut = false;
      const providerStartedAt = performance.now();
      let firstTextMs: number | null = null;
      let usage: Usage | null = null;
      let lastEventAt = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastEventAt > (providerId === 'codex' || providerId === 'omp-codex' ? 45_000 : LLM_STALL_TIMEOUT_MS)) {
          timedOut = true;
          emit(IPC.evAnswerError, 'Answer timed out. Retry this question.'); controller.abort();
        }
      }, 1000);
      try {
        const provider = getLlmProvider(providerId);
        const ctx = { ...providerContext(providerId, cfg), signal: controller.signal };
        const req = providerId === cfg.llm.provider ? request : { ...request, model: cfg.llm.model };
        for await (const event of provider.stream(req, ctx)) {
          if (controller.signal.aborted) return;
          lastEventAt = Date.now();
          if (event.type === 'delta') {
            if (event.text) firstTextMs ??= Math.round(performance.now() - providerStartedAt);
            answerText += event.text;
            // Never flash an unchecked question in the overlay. Ordinary answers still stream.
            if (!isSuggestion) { firstDeltaSent = true; emit(IPC.evAnswerDelta, event.text); }
          }
          else if (event.type === 'usage') usage = {
            inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens,
            estimatedCost: providerId === 'codex' ? null : estimateCost(req.model, event.inputTokens, event.outputTokens, event.cacheReadTokens ?? 0),
          };
        }
        if (controller.signal.aborted || timedOut) return;
        if (isSuggestion) {
          if (getActiveProfile().id !== profile.id) throw new Error('Class changed; draft cancelled.');
          if (answerText.trim().toUpperCase() !== 'SKIP') {
            const checked = getLectureHistory(profile.id); // Includes speech during generation.
            let result = await checkSuggestion(answerText, checked, payload.fullTranscript, getSecret('typesafe') ?? '', controller.signal);
            if (result.allow) {
              const latest = getLectureHistory(profile.id);
              if (latest.text !== checked.text || latest.complete !== checked.complete) {
                const additions = latest.text.startsWith(checked.text) ? latest.text.slice(checked.text.length) : latest.text;
                result = await checkSuggestion(answerText, { text: additions, complete: latest.complete }, '', getSecret('typesafe') ?? '', controller.signal);
                if (getLectureHistory(profile.id).text !== latest.text) result = { ...result, allow: false, reason: 'Discussion changed during final check; draft withheld.' };
              }
            }
            if (controller.signal.aborted) return;
            if (!result.allow) {
              recordEvent({ t: Date.now(), type: 'answer-status', profileId: profile.id,
                questionId: id, status: 'skipped', text: `${result.reason} Novelty check: ${result.elapsedMs}ms, ${result.checks} requests.` }, source.sessionId);
              answerText = 'SKIP';
            }
          }
          if (getActiveProfile().id !== profile.id) throw new Error('Class changed; draft cancelled.');
          firstDeltaSent = true;
          emit(IPC.evAnswerDelta, answerText);
        }
        if (answerText.trim() && answerText.trim().toUpperCase() !== 'SKIP') {
          if (!original) snapshots.save(id, { owner: sender.id, profileId: profile.id, payload, request, answer: answerText.trim(), lectureCutoff });
          else if (payload.refineAnswerId) snapshots.save(payload.refineAnswerId, { ...original, request, answer: answerText.trim() });
          recordEvent({
          t: Date.now(), type: 'answer', text: answerText.trim(), profileId: profile.id,
          forced: payload.forced, usage, questionId: source.requestId, question: source.question,
          ...(source.responseKind ? { responseKind: source.responseKind } : {}),
          timing: { provider: providerId, prepareMs: Math.round(providerStartedAt - requestStartedAt),
            firstTextMs, completeMs: Math.round(performance.now() - providerStartedAt) },
          ...(payload.expandAnswerId ? { expandedFrom: payload.expandAnswerId } : {}),
          ...(payload.refineAnswerId ? { refinedFrom: payload.refineAnswerId } : {}),
        }, source.sessionId);
        }
        // Release the main-process slot before telling the renderer to pump its queue.
        emit(IPC.evAnswerDone, { usage });
        return;
      } catch (err) {
        if (controller.signal.aborted) return;
        lastError = friendlyError(err, providerId);
        if (firstDeltaSent) { emit(IPC.evAnswerError, lastError); return; }
      } finally { clearInterval(watchdog); }
    }
    emit(IPC.evAnswerError, lastError || 'All providers failed.');
  } catch (error) { emit(IPC.evAnswerError, String((error as Error).message ?? error)); }
  finally { if (active.get(id) === controller) active.delete(id); }
}
