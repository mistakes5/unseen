import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningLimit, LISTENING_LIMIT_MS } from '../src/main/services/listening-limit';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

it('expires exactly three hours after Start, even without incoming speech', () => {
  const expire = vi.fn(); const limit = new ListeningLimit(expire);
  limit.start(1);
  vi.advanceTimersByTime(LISTENING_LIMIT_MS - 1);
  expect(expire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledExactlyOnceWith(1);
  expect(limit.check()).toBe(false);
  vi.advanceTimersByTime(LISTENING_LIMIT_MS);
  expect(expire).toHaveBeenCalledOnce();
});

it('uses elapsed wall time after sleep/resume rather than counting timer ticks', () => {
  const expire = vi.fn(); const limit = new ListeningLimit(expire);
  limit.start(4);
  vi.setSystemTime(Date.now() + LISTENING_LIMIT_MS + 1);
  expect(limit.check()).toBe(false);
  expect(expire).toHaveBeenCalledExactlyOnceWith(4);
});

it('repeated connection/work checks do not extend the deadline', () => {
  const expire = vi.fn(); const limit = new ListeningLimit(expire);
  limit.start(7);
  for (let hour = 0; hour < 3; hour++) {
    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    limit.check();
    vi.advanceTimersByTime(1);
  }
  expect(expire).toHaveBeenCalledExactlyOnceWith(7);
});

it('manual stop cancels the deadline and new Start receives a full three hours', () => {
  const expire = vi.fn(); const limit = new ListeningLimit(expire);
  limit.start(1);
  vi.advanceTimersByTime(LISTENING_LIMIT_MS - 100);
  limit.stop(1);
  vi.advanceTimersByTime(1000);
  expect(expire).not.toHaveBeenCalled();
  limit.start(2);
  limit.stop(1); // delayed old stop must not cancel the new limit
  vi.advanceTimersByTime(LISTENING_LIMIT_MS);
  expect(expire).toHaveBeenCalledExactlyOnceWith(2);
});

it('an expiry stays blocked until an explicit fresh Start', () => {
  const limit = new ListeningLimit(vi.fn());
  limit.start(1); vi.advanceTimersByTime(LISTENING_LIMIT_MS);
  limit.stop(1); expect(limit.check()).toBe(false);
  limit.start(2); expect(limit.check()).toBe(true);
  limit.stop(); expect(vi.getTimerCount()).toBe(0);
});
