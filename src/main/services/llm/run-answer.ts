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
import { recordEvent } from '../sessions';
import { getSecret } from '../secrets';
import { detectQuestion } from '../question-detection';
import { AnswerSnapshots, buildExpansionRequest } from '../answer-expansion';

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
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) return `${providerId}: cannot reach the API — check your connection.`;
  return `${providerId}: ${msg}`;
}

export async function runAnswer(sender: WebContents, payload: AnswerPayload): Promise<void> {
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
    const original = payload.expandAnswerId ? snapshots.get(payload.expandAnswerId, sender.id, profile.id) : null;
    const source = original?.payload ?? payload;
    if (!original && !payload.forced && !payload.detected && cfg.questionDetection.provider === 'jev') {
      const key = getSecret('typesafe');
      if (!key) throw new Error('Add your TypeSafe key in Settings → Providers to enable Jev. Ask now bypasses Jev.');
      const probability = await detectQuestion(payload, key, controller.signal);
      if (controller.signal.aborted) return;
      if (probability < cfg.questionDetection.threshold) {
        emit(IPC.evAnswerDelta, 'SKIP'); emit(IPC.evAnswerDone, { usage: null }); return;
      }
    }
    const namespaces = profile.memory?.namespaces ?? [];
    const request: LlmRequest = original ? buildExpansionRequest(original.request, original.answer, profile.id) : buildAnswerRequest({ profile,
      knowledge: loadKnowledge(profile, payload.newSegment, payload.fullTranscript.slice(-1000)),
      memory: [...loadMemoryFacts(namespaces), ...loadWatchedMarkdown(namespaces)], settings: cfg, ...payload });
    const chain = [cfg.llm.provider, ...cfg.llm.fallbacks.filter(f => f !== cfg.llm.provider)];
    let lastError = '';
    for (const providerId of chain) {
      if (controller.signal.aborted) return;
      let firstDeltaSent = false, answerText = '', timedOut = false;
      let usage: Usage | null = null;
      let lastEventAt = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastEventAt > (providerId === 'codex' ? 45_000 : LLM_STALL_TIMEOUT_MS)) {
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
          if (event.type === 'delta') { firstDeltaSent = true; answerText += event.text; emit(IPC.evAnswerDelta, event.text); }
          else if (event.type === 'usage') usage = {
            inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens,
            estimatedCost: providerId === 'codex' ? null : estimateCost(req.model, event.inputTokens, event.outputTokens, event.cacheReadTokens ?? 0),
          };
        }
        if (controller.signal.aborted || timedOut) return;
        if (answerText.trim() && answerText.trim().toUpperCase() !== 'SKIP') {
          if (!original) snapshots.save(id, { owner: sender.id, profileId: profile.id, payload, request, answer: answerText.trim() });
          recordEvent({
          t: Date.now(), type: 'answer', text: answerText.trim(), profileId: profile.id,
          forced: payload.forced, usage, questionId: source.requestId, question: source.question,
          ...(original ? { expandedFrom: payload.expandAnswerId } : {}),
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
