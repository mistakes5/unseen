export const FRAGMENT_SETTLE_MS = 750;
export const QUESTION_SETTLE_MS = 250;
export const MAX_DETECTION_WAIT_MS = 2200;

/** Scheduling hint, never a question classifier. Every span still goes to Jev.
 * Keep the existing continuation window for fragments and reading invitations.
 * A completed question can begin sooner; later context can refine its answer.
 */
export function detectionDelay(candidates: readonly { text: string; receivedAt: number }[], now: number, hasInterim = false): number {
  if (!candidates.length) return 0;
  const settle = !hasInterim && candidates.some(c => /\?\s*$/u.test(c.text)) ? QUESTION_SETTLE_MS : FRAGMENT_SETTLE_MS;
  return Math.min(settle, Math.max(0, candidates[0].receivedAt + MAX_DETECTION_WAIT_MS - now));
}
