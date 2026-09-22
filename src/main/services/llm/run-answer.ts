import type { WebContents } from 'electron';
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

// One answer in flight at a time: starting a new one aborts the previous.
let current: AbortController | null = null;

export function cancelAnswer(): void {
  current?.abort();
  current = null;
}

function friendlyError(err: unknown, providerId: string): string {
  const msg = String((err as Error)?.message ?? err);
  const status = (err as { status?: number }).status;
  if (status === 401 || /401|invalid.*key/i.test(msg)) {
    return `${providerId}: invalid or missing API key — check Settings → Providers.`;
  }
  if (status === 429 || /429|rate.?limit/i.test(msg)) {
    return `${providerId}: rate limited — wait a moment and retry.`;
  }
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) {
    return `${providerId}: cannot reach the API — check your connection${providerId === 'ollama' ? ' and that Ollama is running' : ''}.`;
  }
  return `${providerId}: ${msg}`;
}

export async function runAnswer(sender: WebContents, payload: AnswerPayload): Promise<void> {
  const diagnostic = process.argv.includes('--overlay-replay-file');
  const began = Date.now();
  cancelAnswer();
  const controller = new AbortController();
  current = controller;

  const cfg = settings().get();
  if (!payload.forced && cfg.questionDetection.provider === 'jev') {
    try {
      const key = getSecret('typesafe');
      if (!key) throw new Error('Add your TypeSafe key in Settings → Providers to enable Jev, or select basic question detection. Ask now bypasses Jev.');
      const probability = await detectQuestion(payload, key, controller.signal);
      if (diagnostic) console.info('[overlay-replay] Jev', JSON.stringify({ probability, elapsedMs: Date.now() - began, forced: payload.forced }));
      if (controller.signal.aborted) return;
      if (probability < cfg.questionDetection.threshold) {
        sender.send(IPC.evAnswerDelta, 'SKIP');
        sender.send(IPC.evAnswerDone, { usage: null });
        if (current === controller) current = null;
        return;
      }
    } catch (error) {
      if (!controller.signal.aborted) sender.send(IPC.evAnswerError, String((error as Error).message));
      if (current === controller) current = null;
      return;
    }
  }
  const profile = getActiveProfile();
  const namespaces = profile.memory?.namespaces ?? [];
  const request: LlmRequest = buildAnswerRequest({
    profile,
    knowledge: loadKnowledge(profile, payload.newSegment, payload.fullTranscript.slice(-1000)),
    memory: [...loadMemoryFacts(namespaces), ...loadWatchedMarkdown(namespaces)],
    settings: cfg,
    ...payload,
  });

  const chain = [cfg.llm.provider, ...cfg.llm.fallbacks.filter((f) => f !== cfg.llm.provider)];
  let lastError = '';

  for (const providerId of chain) {
    if (controller.signal.aborted) return;
    let firstDeltaSent = false;
    let usage: Usage | null = null;
    let answerText = '';

    // Stall watchdog: abort if the stream goes silent.
    let lastEventAt = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt > (providerId === 'codex' ? 45_000 : LLM_STALL_TIMEOUT_MS)) controller.abort();
    }, 3000);

    try {
      const provider = getLlmProvider(providerId);
      const ctx = { ...providerContext(providerId, cfg), signal: controller.signal };
      // Fallback providers may not know the primary's model — use the
      // profile/settings model only for the primary.
      const req =
        providerId === cfg.llm.provider ? request : { ...request, model: cfg.llm.model };

      for await (const event of provider.stream(req, ctx)) {
        lastEventAt = Date.now();
        if (event.type === 'delta') {
          firstDeltaSent = true;
          answerText += event.text;
          sender.send(IPC.evAnswerDelta, event.text);
        } else if (event.type === 'usage') {
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            estimatedCost: providerId === 'codex' ? null : estimateCost(
              req.model,
              event.inputTokens,
              event.outputTokens,
              event.cacheReadTokens ?? 0,
            ),
          };
        }
      }
      sender.send(IPC.evAnswerDone, { usage });
      if (diagnostic) console.info('[overlay-replay] Answer sent to real renderer', JSON.stringify({ elapsedMs: Date.now() - began, chars: answerText.length, skipped: answerText.trim() === 'SKIP' }));
      if (answerText.trim() && answerText.trim().toUpperCase() !== 'SKIP') {
        recordEvent({
          t: Date.now(),
          type: 'answer',
          text: answerText.trim(),
          profileId: profile.id,
          forced: payload.forced,
          usage,
        });
      }
      return;
    } catch (err) {
      if (controller.signal.aborted) {
        if (current === controller) sender.send(IPC.evAnswerError, 'Answer timed out. Try Ask now.');
        return;
      }
      lastError = friendlyError(err, providerId);
      console.error('[llm]', lastError);
      if (firstDeltaSent) {
        // Mid-stream failure: don't silently switch providers and restart the
        // answer — surface the error.
        sender.send(IPC.evAnswerError, lastError);
        return;
      }
      // Failed before any output → try the next provider in the chain.
    } finally {
      clearInterval(watchdog);
      if (current === controller && controller.signal.aborted) current = null;
    }
  }
  sender.send(IPC.evAnswerError, lastError || 'All providers failed.');
}
