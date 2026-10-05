// One bounded retry policy for both detector paths. No model/provider fallback.
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
export const JEV_REQUEST_BUDGET_MS = 8000;
export const JEV_MAX_ATTEMPTS = 3;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Null means no usable server delay, not permission to ignore a long delay. */
export function retryAfterMs(headers: Headers, now: number): number | null {
  const ms = headers.get('retry-after-ms');
  if (ms?.trim() && Number.isFinite(Number(ms)) && Number(ms) >= 0) return Number(ms);
  const seconds = headers.get('retry-after');
  if (!seconds?.trim()) return null;
  if (Number.isFinite(Number(seconds)) && Number(seconds) >= 0) return Number(seconds) * 1000;
  const date = Date.parse(seconds);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export async function requestJev(body: unknown, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  signal.throwIfAborted();
  const serialized = JSON.stringify(body);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Question check timed out', 'TimeoutError')), JEV_REQUEST_BUDGET_MS);
  const bounded = AbortSignal.any([signal, deadline.signal]);
  const began = performance.now();
  try {
    for (let attempt = 0; attempt < JEV_MAX_ATTEMPTS; attempt++) {
      bounded.throwIfAborted();
      let response: Response | undefined;
      let failure: Error;
      try {
        response = await fetcher('https://api.typesafe.ai/v1/systemone', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          signal: bounded, body: serialized,
        });
      } catch (error) {
        bounded.throwIfAborted();
        if (!(error instanceof TypeError)) throw error;
        failure = new Error('TypeSafe question detection: network unavailable');
      }
      if (response?.ok) return await response.json();
      if (response) {
        failure = new Error(`TypeSafe question detection: HTTP ${response.status}`);
        if (!RETRYABLE.has(response.status)) throw failure;
      }
      const serverDelay = response ? retryAfterMs(response.headers, Date.now()) : null;
      void response?.body?.cancel().catch(() => {});
      const delay = Math.max(serverDelay ?? 0, (attempt === 0 ? 250 : 600) + Math.floor(Math.random() * 100));
      const remaining = JEV_REQUEST_BUDGET_MS - (performance.now() - began);
      if (attempt + 1 >= JEV_MAX_ATTEMPTS || delay + 100 >= remaining) throw failure!;
      await wait(delay, bounded);
    }
    throw new Error('TypeSafe question detection: retry limit reached');
  } finally { clearTimeout(timer); }
}
