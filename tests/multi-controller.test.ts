import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import type { AnswerPayload, Profile } from '../src/shared/types';
import type { SttClientOpts } from '../src/renderer/overlay/stt/client';

const mock = vi.hoisted(() => ({ opts: null as SttClientOpts | null, start: vi.fn(), stop: vi.fn() }));
vi.mock('../src/renderer/overlay/stt/client', () => ({ SttClient: class {
  paused = false;
  constructor(opts: SttClientOpts) { mock.opts = opts; }
  start() { mock.start(); mock.opts!.onStatus({ state: 'live' }); return Promise.resolve(); }
  stop() { mock.stop(); }
  togglePause() { return this.paused = !this.paused; }
} }));

const profile = { id: 'canadian-politics', name: 'Course', transcript: { window_chars: 7000, retention_min: 5 },
  triggers: { auto: true, min_chars: 12, debounce_ms: 1800, detectors: ['question'], keywords: [] },
  description: '', icon: '', prompt: { system: '', response_style: 'spoken', language: 'English' }, knowledge: { prompt_label: '', files: [] } } satisfies Profile;
let listeners: Record<string, (value: any) => void>;
let api: Record<string, any>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks(); listeners = {};
  api = {
    settingsGet: async () => structuredClone(DEFAULT_SETTINGS), profilesList: async () => [], profilesGetActive: async () => profile,
    sessionBegin: vi.fn().mockResolvedValue('canadian-politics/test-session'),
    sessionRecordFinal: vi.fn(), sessionRecordQuestion: vi.fn(), sessionRecordStatus: vi.fn(), sessionSpeaker: vi.fn(),
    answerStart: vi.fn().mockResolvedValue({ ok: true }), answerCancel: vi.fn().mockResolvedValue(undefined),
    questionsCancel: vi.fn().mockResolvedValue(undefined),
    questionsDetect: vi.fn(async batch => batch.candidates.map((c: any) => ({ id: c.id, probability: 0.99 }))),
  };
  for (const event of ['SettingsChanged', 'ProfilesChanged', 'AnswerDelta', 'AnswerDone', 'AnswerError', 'SessionError', 'ForceAnswer', 'TogglePause']) api[`on${event}`] = (cb: any) => { listeners[event] = cb; };
  vi.stubGlobal('window', { unseen: api });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps transcribing while two answers run, prioritizes professor, routes out-of-order events, and cancels stale work', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What is turnout? What predicts vote choice?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(151);
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  c.setProfessorSpeaker(2);
  mock.opts!.onEvent({ type: 'final', text: 'Can you explain correlation?', speaker: 1 });
  mock.opts!.onEvent({ type: 'final', text: 'Why is correlation not causation?', speaker: 2 });
  await vi.advanceTimersByTimeAsync(151);
  expect(api.sessionRecordFinal).toHaveBeenCalledTimes(3);
  expect(api.sessionRecordQuestion).toHaveBeenCalledTimes(4);
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  const [q1, q2] = api.answerStart.mock.calls.map((call: [AnswerPayload]) => call[0]);
  listeners.AnswerDelta({ requestId: q2.requestId, text: 'Answer two.' });
  listeners.AnswerDone({ requestId: q2.requestId, usage: null });
  expect(api.answerStart.mock.calls[2][0].question).toBe('Why is correlation not causation?');
  listeners.AnswerDelta({ requestId: q1.requestId, text: 'Answer one.' });
  listeners.AnswerDone({ requestId: q1.requestId, usage: null });
  expect(api.answerStart.mock.calls[3][0].question).toBe('Can you explain correlation?');
  expect(useOverlayStore.getState().answers.find(a => a.id === q1.requestId)?.text).toBe('Answer one.');
  expect(useOverlayStore.getState().answers[0].question).toBe('Why is correlation not causation?');
  c.toggleListening();
  const late = api.answerStart.mock.calls[2][0];
  listeners.AnswerDelta({ requestId: late.requestId, text: 'STALE' });
  expect(useOverlayStore.getState().answers.some(a => a.text.includes('STALE'))).toBe(false);
  expect(api.sessionRecordStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', profileId: 'canadian-politics' }));
  expect(mock.stop).toHaveBeenCalledOnce();
});

it('invalidates an outstanding detection on course switch and clears professor assignment on reconnect', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  let resolve!: (value: unknown) => void;
  api.questionsDetect.mockImplementation(() => new Promise(r => { resolve = r; }));
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  c.setProfessorSpeaker(1);
  mock.opts!.onStatus({ state: 'reconnecting' });
  expect(useOverlayStore.getState().professorSpeaker).toBeNull();
  mock.opts!.onEvent({ type: 'final', text: 'What is identity?', speaker: 1 });
  await vi.advanceTimersByTimeAsync(151);
  const id = api.questionsDetect.mock.calls[0][0].candidates[0].id;
  c.resetClassroomSession(); resolve([{ id, probability: 0.99 }]);
  await vi.advanceTimersByTimeAsync(1);
  expect(api.answerStart).not.toHaveBeenCalled();
  expect(useOverlayStore.getState().answers).toEqual([]);
});

it('reports paused accurately while releasing answer work', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  expect(c.togglePause()).toBe(true);
  expect(useOverlayStore.getState().status).toEqual({ kind: 'paused', text: 'paused' });
  expect(c.togglePause()).toBe(false);
  expect(useOverlayStore.getState().status.kind).toBe('live');
});

it('expands the selected answer in place while listening, deduplicates clicks, and caches the result', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What is identity?', speaker: 1 });
  await vi.advanceTimersByTimeAsync(151);
  const q = api.answerStart.mock.calls[0][0];
  listeners.AnswerDelta({ requestId: q.requestId, text: 'Short original.' });
  listeners.AnswerDone({ requestId: q.requestId, usage: null });
  c.expandAnswer(q.requestId); c.expandAnswer(q.requestId);
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  const expansion = api.answerStart.mock.calls[1][0];
  expect(expansion.expandAnswerId).toBe(q.requestId);
  expect(expansion.fullTranscript).toBe('');
  expect(c.isListening()).toBe(true);
  mock.opts!.onEvent({ type: 'final', text: 'What is nationalism?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(151);
  expect(api.answerStart).toHaveBeenCalledTimes(3);
  listeners.AnswerDelta({ requestId: expansion.requestId, text: 'Expanded explanation.' });
  listeners.AnswerDone({ requestId: expansion.requestId, usage: { inputTokens: 1, outputTokens: 1, estimatedCost: 0.01 } });
  const original = () => useOverlayStore.getState().answers.find(a => a.id === q.requestId)!;
  expect(original().text).toBe('Short original.');
  expect(original().expansion).toMatchObject({ text: 'Expanded explanation.', phase: 'done', visible: true });
  expect(useOverlayStore.getState().answers).toHaveLength(2);
  c.expandAnswer(q.requestId); expect(original().expansion?.visible).toBe(false);
  c.expandAnswer(q.requestId); expect(original().expansion?.visible).toBe(true);
  expect(api.answerStart).toHaveBeenCalledTimes(3);
  expect(mock.stop).not.toHaveBeenCalled();
});

it('cancels only expansion display state without losing the original and permits retry', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What is identity?', speaker: 1 });
  await vi.advanceTimersByTimeAsync(151);
  const q = api.answerStart.mock.calls[0][0];
  listeners.AnswerDelta({ requestId: q.requestId, text: 'Original.' });
  listeners.AnswerDone({ requestId: q.requestId, usage: null });
  c.expandAnswer(q.requestId);
  const old = api.answerStart.mock.calls[1][0];
  c.togglePause();
  listeners.AnswerDelta({ requestId: old.requestId, text: 'Late expansion' });
  expect(useOverlayStore.getState().answers[0]).toMatchObject({ text: 'Original.', phase: 'done', expansion: { phase: 'error', text: '' } });
  c.expandAnswer(q.requestId);
  expect(api.answerStart).toHaveBeenCalledTimes(3);
  c.resetClassroomSession();
  listeners.AnswerDone({ requestId: api.answerStart.mock.calls[2][0].requestId, usage: null });
  expect(useOverlayStore.getState().answers).toEqual([]);
});
