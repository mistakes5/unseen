import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JEV_REQUEST_BUDGET_MS, requestJev, retryAfterMs } from '../src/main/services/typesafe-request';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const signal = () => new AbortController().signal;
const success = () => new Response(JSON.stringify({ answers: { q: { type: 'noul', noul: .9 } } }));

it.each([408, 429, 500, 502, 503, 504, 529])('recovers from HTTP %s with one retry of exactly the same payload', async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(success());
  const result = requestJev({ state: 'Synthetic speech' }, 'test-key', signal(), fetcher);
  await vi.advanceTimersByTimeAsync(249);
  expect(fetcher).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toHaveProperty('answers.q.noul', .9);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1]!.body).toBe(fetcher.mock.calls[1][1]!.body);
  expect(vi.getTimerCount()).toBe(0);
});

it('caps persistent errors at three attempts and releases deadline timers', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 529 }));
  const result = requestJev({}, 'test-key', signal(), fetcher).catch(e => e);
  await vi.advanceTimersByTimeAsync(850);
  expect(await result).toMatchObject({ message: expect.stringContaining('HTTP 529') });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([400, 401, 403, 404, 422])('does not retry HTTP %s', async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
  await expect(requestJev({}, 'test-key', signal(), fetcher)).rejects.toThrow(`HTTP ${status}`);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('retries a network failure but not invalid successful JSON', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(success());
  const result = requestJev({}, 'test-key', signal(), fetcher);
  await vi.advanceTimersByTimeAsync(250);
  await expect(result).resolves.toHaveProperty('answers');
  const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json'));
  await expect(requestJev({}, 'test-key', signal(), invalid)).rejects.toThrow();
  expect(invalid).toHaveBeenCalledOnce();
});

it('honors server delay and refuses a retry beyond the total budget', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 529, headers: { 'Retry-After': '2' } })).mockResolvedValueOnce(success());
  const result = requestJev({}, 'test-key', signal(), fetcher);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  await result;
  const slow = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 529, headers: { 'Retry-After': '30' } }));
  await expect(requestJev({}, 'test-key', signal(), slow)).rejects.toThrow('HTTP 529');
  expect(slow).toHaveBeenCalledOnce();
});

it('parses both supported delay headers and dates', () => {
  expect(retryAfterMs(new Headers({ 'retry-after-ms': '900' }), 0)).toBe(900);
  expect(retryAfterMs(new Headers({ 'Retry-After': 'Thu, 01 Jan 1970 00:00:02 GMT' }), 0)).toBe(2000);
  expect(retryAfterMs(new Headers({ 'Retry-After': 'invalid' }), 0)).toBeNull();
});

it('cancels backoff immediately without issuing another request', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 529 }));
  const result = requestJev({}, 'test-key', controller.signal, fetcher).catch(e => e);
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect(await result).toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds all attempts together to eight seconds including an in-flight retry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 529 }))
    .mockImplementation((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })));
  const result = requestJev({}, 'test-key', signal(), fetcher).catch(e => e);
  await vi.advanceTimersByTimeAsync(JEV_REQUEST_BUDGET_MS);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
