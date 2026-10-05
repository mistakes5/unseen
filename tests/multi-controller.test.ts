import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import type { AnswerPayload, Profile, QuestionBatch } from '../src/shared/types';
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
    sessionEnd: vi.fn(),
    sessionRecordFinal: vi.fn(), sessionRecordQuestion: vi.fn(), sessionRecordStatus: vi.fn(), sessionSpeaker: vi.fn(),
    answerStart: vi.fn().mockResolvedValue({ ok: true }), answerCancel: vi.fn().mockResolvedValue(undefined),
    questionsCancel: vi.fn().mockResolvedValue(undefined),
    questionsDetect: vi.fn(async batch => batch.candidates.map((c: any) => ({ id: c.id, probability: 0.99 }))),
};
  for (const event of ['SettingsChanged', 'ProfilesChanged', 'AnswerDelta', 'AnswerDone', 'AnswerError', 'SessionError', 'ForceAnswer', 'TogglePause', 'ListeningExpired']) api[`on${event}`] = (cb: any) => { listeners[event] = cb; };
  vi.stubGlobal('window', { unseen: api });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps captured question context when subsequent speech replaces the rolling window', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  for (const text of ['First question?', 'Second question?', 'The college has capacity constraints. Why admit more students?']) {
    mock.opts!.onEvent({ type: 'final', text, speaker: 0 });
    await vi.advanceTimersByTimeAsync(751);
  }
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  const first = api.answerStart.mock.calls[0][0];
  mock.opts!.onEvent({ type: 'final', text: 'An unrelated later topic. '.repeat(400), speaker: 0 });
  listeners.AnswerDelta({ requestId: first.requestId, text: 'First answer.' });
  listeners.AnswerDone({ requestId: first.requestId, usage: null });
  const third = api.answerStart.mock.calls[2][0];
  expect(third.questionContext).toContain('college has capacity constraints');
  expect(third.newSegment).toContain('Why admit more students?');
  expect(third.fullTranscript).not.toContain('college has capacity constraints');
});

it('auto-stop closes transcription, cancels queued AI work, keeps notes, and ignores late events', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why does the constitution matter?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const question = api.answerStart.mock.calls[0][0];
  listeners.AnswerDelta({ requestId: question.requestId, text: 'It sets out powers.' });
  listeners.AnswerDone({ requestId: question.requestId, usage: null });
  const token = api.sessionBegin.mock.calls[0][0];
  listeners.ListeningExpired(token);
  expect(c.isListening()).toBe(false);
  expect(mock.stop).toHaveBeenCalledOnce();
  expect(api.sessionEnd).toHaveBeenCalledWith(token);
  expect(api.answerCancel).toHaveBeenCalled();
  expect(api.questionsCancel).toHaveBeenCalled();
  expect(useOverlayStore.getState().answers[0].text).toBe('It sets out powers.');
  expect(useOverlayStore.getState().turns).not.toHaveLength(0);
  expect(useOverlayStore.getState().status.text).toContain('Stopped automatically after 3 hours');
  mock.opts!.onStatus({ state: 'error', message: 'A late connection error' });
  expect(useOverlayStore.getState().status.text).toContain('Stopped automatically after 3 hours');
  mock.opts!.onEvent({ type: 'final', text: 'This late speech must not be processed.', speaker: 0 });
  c.askNow(); await vi.advanceTimersByTimeAsync(1000);
  expect(api.sessionRecordFinal).toHaveBeenCalledOnce();
  expect(api.answerStart).toHaveBeenCalledOnce();
  c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  const nextToken = api.sessionBegin.mock.calls[1][0];
  expect(nextToken).not.toBe(token);
  listeners.ListeningExpired(token);
  expect(c.isListening()).toBe(true);
  listeners.ListeningExpired(nextToken);
  expect(c.isListening()).toBe(false);
});

it('pause/resume and reconnect do not restart the deadline and paused sessions still expire', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  const token = api.sessionBegin.mock.calls[0][0];
  c.togglePause(); c.togglePause();
  mock.opts!.onStatus({ state: 'reconnecting' });
  expect(api.sessionBegin).toHaveBeenCalledOnce();
  expect(api.sessionEnd).not.toHaveBeenCalled();
  c.togglePause();
  listeners.ListeningExpired(token);
  expect(c.isListening()).toBe(false);
  expect(mock.stop).toHaveBeenCalledOnce();
});

it('an expiry during asynchronous session startup prevents the microphone from opening', async () => {
  let finish!: (id: string) => void;
  api.sessionBegin.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening();
  listeners.ListeningExpired(api.sessionBegin.mock.calls[0][0]);
  finish('late-session'); await vi.advanceTimersByTimeAsync(1);
  expect(mock.start).not.toHaveBeenCalled();
  expect(c.isListening()).toBe(false);
});

it('shows one detector warning, saves unchecked gaps without cards, and clears it after recovery', async () => {
  api.questionsDetect.mockRejectedValue(new Error('TypeSafe question detection: HTTP 529'));
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Regional governments have their own responsibilities.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  mock.opts!.onEvent({ type: 'final', text: 'A constitution protects those responsibilities.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(useOverlayStore.getState().answers).toHaveLength(0);
  expect(useOverlayStore.getState().uncheckedSegments).toBe(2);
  expect(useOverlayStore.getState().detectionError).toContain('temporarily unavailable');
  expect(api.sessionRecordFinal).toHaveBeenCalledTimes(2);
  expect(api.sessionRecordStatus).toHaveBeenCalledTimes(2);
  expect(api.sessionRecordStatus.mock.calls[0][0].text).toContain('not classified');
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => batch.candidates.map(q => ({ id: q.id, probability: .9 })));
  mock.opts!.onEvent({ type: 'final', text: 'Why is that different from delegation?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(useOverlayStore.getState().detectionError).toBeNull();
  expect(useOverlayStore.getState().uncheckedSegments).toBe(2);
  expect(api.answerStart).toHaveBeenCalledOnce();
  c.toggleListening();
});

it('does not publish a failure from a cancelled class or request', async () => {
  let reject!: (error: Error) => void;
  api.questionsDetect.mockImplementation(() => new Promise((_resolve, r) => { reject = r; }));
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why do these institutions matter?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(251);
  c.resetClassroomSession();
  reject(new Error('HTTP 529'));
  await vi.advanceTimersByTimeAsync(1);
  expect(useOverlayStore.getState().detectionError).toBeNull();
  expect(useOverlayStore.getState().uncheckedSegments).toBe(0);
  expect(api.sessionRecordStatus).not.toHaveBeenCalled();
});

it('routes an opted-in opening to one draft, saves it, and enforces cooldown without disabling ordinary answers', async () => {
  api.profilesGetActive = async () => ({ ...profile, questionSuggestions: 'openings' });
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => [
    ...batch.candidates.map(q => ({ id: q.id, probability: 0.99 })),
    ...(batch.questionSuggestions ? [{ id: batch.candidates.at(-1)!.id, probability: 0.95, kind: 'question-suggestion' }] : []),
  ]);
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Any questions about this tradeoff?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.answerStart).toHaveBeenCalledOnce();
  const first = api.answerStart.mock.calls[0][0];
  expect(first.responseKind).toBe('question-suggestion');
  expect(useOverlayStore.getState().answers[0].responseKind).toBe('question-suggestion');
  expect(api.sessionRecordQuestion.mock.calls[0][0].text).toContain('[question suggestion opening]');
  listeners.AnswerDelta({ requestId: first.requestId, text: 'Question to ask: Who decides when standards conflict?' });
  listeners.AnswerDone({ requestId: first.requestId, usage: null });
  mock.opts!.onEvent({ type: 'final', text: 'Why does this matter for accountability?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.questionsDetect.mock.calls[1][0].questionSuggestions).toBeUndefined();
  const second = api.answerStart.mock.calls[1][0];
  expect(second.responseKind).toBeUndefined();
  listeners.AnswerDone({ requestId: second.requestId, usage: null });
  await vi.advanceTimersByTimeAsync(60_000);
  mock.opts!.onEvent({ type: 'final', text: 'Any questions about how those standards are enforced?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.questionsDetect.mock.calls[2][0].questionSuggestions.recentDrafts).toEqual(['Question to ask: Who decides when standards conflict?']);
  expect(api.answerStart.mock.calls[2][0].recentSuggestions).toHaveLength(1);
  c.toggleListening();
});

it('leaves suggestion checks off by default and rejects an unsolicited suggestion result', async () => {
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => [
    ...batch.candidates.map(q => ({ id: q.id, probability: 0.1 })),
    { id: batch.candidates[0].id, probability: 0.99, kind: 'question-suggestion' },
  ]);
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'A substantive claim about institutions.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.questionsDetect.mock.calls[0][0].questionSuggestions).toBeUndefined();
  expect(api.answerStart).not.toHaveBeenCalled();
  c.toggleListening();
});

it('prioritizes a direct question over a speculative opening in the same batch', async () => {
  api.profilesGetActive = async () => ({ ...profile, questionSuggestions: 'openings' });
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => [
    ...batch.candidates.map((q, i) => ({ id: q.id, probability: i === 0 ? 0.99 : 0.1 })),
    { id: batch.candidates.at(-1)!.id, probability: 0.95, kind: 'question-suggestion' },
  ]);
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why does federalism matter? There are competing accounts of its benefits.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.answerStart).toHaveBeenCalledOnce();
  expect(api.answerStart.mock.calls[0][0].responseKind).toBeUndefined();
  c.toggleListening();
});

it('sends completed questions at 250ms but still saves speech and waits 750ms for fragments', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why does this matter?', speaker: 0 });
  expect(api.sessionRecordFinal).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(249);
  expect(api.questionsDetect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.questionsDetect).toHaveBeenCalledOnce();
  mock.opts!.onEvent({ type: 'final', text: 'Someone who did the reading', speaker: 0 });
  expect(api.sessionRecordFinal).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(749);
  expect(api.questionsDetect).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.questionsDetect).toHaveBeenCalledTimes(2);
});

it.each(['canadian-politics', 'political-identities', 'federalism', 'politics-of-ai'].flatMap(id =>
  ['done', 'answering'].map(phase => ({ id, phase }))))('refines a $phase answer for $id once in the same card', async ({ id, phase }) => {
  api.profilesGetActive = async () => ({ ...profile, id });
  api.sessionBegin.mockResolvedValue(`${id}/test-session`);
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => [
    ...batch.candidates.map(q => ({ id: q.id, probability: q.text.startsWith('What') ? 0.99 : 0.1 })),
    ...(batch.recentQuestion ? [{ id: batch.recentQuestion.id, probability: 0.95, kind: 'clarification' }] : []),
  ]);
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What attributes describe postmodernism?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const q = api.answerStart.mock.calls[0][0];
  listeners.AnswerDelta({ requestId: q.requestId, text: 'Original short explanation.' });
  if (phase === 'done') listeners.AnswerDone({ requestId: q.requestId, usage: null });
  await vi.advanceTimersByTimeAsync(3250);
  mock.opts!.onEvent({ type: 'final', text: 'Some key terms to put in these quadrants.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  if (phase === 'answering') {
    expect(api.answerStart).toHaveBeenCalledOnce();
    listeners.AnswerDone({ requestId: q.requestId, usage: null });
  }
  const revision = api.answerStart.mock.calls[1][0];
  expect(revision.refineAnswerId).toBe(q.requestId);
  expect(revision.clarification).toContain('quadrants');
  expect(useOverlayStore.getState().answers).toHaveLength(1);
  listeners.AnswerDelta({ requestId: revision.requestId, text: 'Skepticism — questioning universal claims.' });
  expect(useOverlayStore.getState().answers[0].text).toBe('Original short explanation.');
  listeners.AnswerDone({ requestId: revision.requestId, usage: null });
  expect(useOverlayStore.getState().answers[0]).toMatchObject({ id: q.requestId, refinement: 'done', text: 'Skepticism — questioning universal claims.' });
  mock.opts!.onEvent({ type: 'final', text: 'Compared with liberalism.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  c.expandAnswer(q.requestId);
  expect(api.answerStart.mock.calls[2][0].expandAnswerId).toBe(q.requestId);
});

it('keeps the original after a failed refinement and ignores refinement output after stop', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => [
    ...batch.candidates.map(q => ({ id: q.id, probability: q.text.startsWith('What') ? 0.99 : 0.1 })),
    ...(batch.recentQuestion ? [{ id: batch.recentQuestion.id, probability: 0.95, kind: 'clarification' }] : []),
  ]);
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What attributes?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const q = api.answerStart.mock.calls[0][0];
  listeners.AnswerDelta({ requestId: q.requestId, text: 'Original.' });
  listeners.AnswerDone({ requestId: q.requestId, usage: null });
  mock.opts!.onEvent({ type: 'final', text: 'A term for this chart.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const revision = api.answerStart.mock.calls[1][0];
  listeners.AnswerDelta({ requestId: revision.requestId, text: 'Partial failed update' });
  listeners.AnswerError({ requestId: revision.requestId, error: 'Network unavailable' });
  expect(useOverlayStore.getState().answers[0]).toMatchObject({ text: 'Original.', refinement: 'error' });
  c.toggleListening();
  listeners.AnswerDone({ requestId: revision.requestId, usage: null });
  expect(useOverlayStore.getState().answers[0].text).toBe('Original.');
});

it('expires the clarification window and does not refine an independent question', async () => {
  const c = await import('../src/renderer/overlay/controller');
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => [
    ...batch.candidates.map(q => ({ id: q.id, probability: q.text.startsWith('What') ? 0.99 : 0.1 })),
    ...(batch.recentQuestion ? [{ id: batch.recentQuestion.id, probability: 0.05, kind: 'clarification' }] : []),
  ]);
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What is identity?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const q = api.answerStart.mock.calls[0][0];
  listeners.AnswerDelta({ requestId: q.requestId, text: 'A sense of who we are.' });
  listeners.AnswerDone({ requestId: q.requestId, usage: null });
  mock.opts!.onEvent({ type: 'final', text: 'Moving to the next topic.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.answerStart).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(12000);
  mock.opts!.onEvent({ type: 'final', text: 'A label for this chart.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.questionsDetect.mock.calls.at(-1)[0].recentQuestion).toBeUndefined();
  expect(api.answerStart).toHaveBeenCalledOnce();
});

it('waits for nearby finalized speech before detecting and sends the completed context to answers', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why do people', speaker: 0 });
  await vi.advanceTimersByTimeAsync(500);
  expect(api.questionsDetect).not.toHaveBeenCalled();
  mock.opts!.onEvent({ type: 'final', text: 'follow the group?', speaker: 1 });
  await vi.advanceTimersByTimeAsync(249);
  expect(api.questionsDetect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  const batch = api.questionsDetect.mock.calls[0][0];
  expect(batch.candidates[0].followingContext).toContain('follow the group?');
  expect(batch.candidates[0].priorContext).not.toContain('follow the group?');
  expect(api.answerStart.mock.calls[0][0].fullTranscript).toContain('follow the group?');
  expect(api.answerStart.mock.calls[0][0].question).toBe('Why do people');
});

it('caps the settling delay during continuous interim speech and Ask now bypasses it', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Can anyone explain this?', speaker: 0 });
  // A continuation begins within the fast window; it still gets the longer
  // fragment settle time, bounded by the original hard deadline.
  mock.opts!.onEvent({ type: 'interim', text: 'An ongoing continuation' });
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(500);
    mock.opts!.onEvent({ type: 'interim', text: 'An ongoing continuation' });
  }
  expect(api.questionsDetect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(201);
  expect(api.questionsDetect).toHaveBeenCalledOnce();
  c.askNow();
  expect(api.answerStart).toHaveBeenCalledTimes(2);
});

it('keeps transcribing while two answers run, prioritizes professor, routes out-of-order events, and cancels stale work', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'What is turnout? What predicts vote choice?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  c.setProfessorSpeaker(2);
  mock.opts!.onEvent({ type: 'final', text: 'Can you explain correlation?', speaker: 1 });
  mock.opts!.onEvent({ type: 'final', text: 'Why is correlation not causation?', speaker: 2 });
  await vi.advanceTimersByTimeAsync(751);
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
  await vi.advanceTimersByTimeAsync(751);
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
  await vi.advanceTimersByTimeAsync(751);
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
  await vi.advanceTimersByTimeAsync(751);
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
  await vi.advanceTimersByTimeAsync(751);
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

it('uses preceding speech for detection, preserves full answer context, and exposes real rejected scores', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => batch.candidates.map(q => ({
    id: q.id, probability: q.text.endsWith('?') ? 0.95 : 0.12,
  })));
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'The reading discusses group comparisons.', speaker: 1 });
  await vi.advanceTimersByTimeAsync(751);
  mock.opts!.onEvent({ type: 'final', text: 'What do you remember from that section? Like,', speaker: 1 });
  await vi.advanceTimersByTimeAsync(751);
  const batch = api.questionsDetect.mock.calls[1][0];
  expect(batch.sessionId).toBe('canadian-politics/test-session');
  expect(batch.candidates[0].priorContext).toContain('The reading discusses group comparisons.');
  expect(batch.candidates[0].priorContext).not.toContain('What do you remember');
  expect(batch.candidates[0].context).toContain('What do you remember from that section?');
  expect(batch.candidates[1].priorContext).toContain('What do you remember from that section?');
  expect(api.answerStart).toHaveBeenCalledOnce();
  expect(api.answerStart.mock.calls[0][0].fullTranscript).toContain('The reading discusses group comparisons.');
  const state = useOverlayStore.getState();
  expect(state.detectionCount).toBe(3);
  expect(state.detectionChecks[0]).toMatchObject({ text: 'Like,', probability: 0.12, passed: false });
  expect(state.detectionChecks[1]).toMatchObject({ probability: 0.95, passed: true });
  c.resetClassroomSession();
  expect(useOverlayStore.getState().detectionCount).toBe(0);
  expect(useOverlayStore.getState().detectionChecks).toEqual([]);
});

it('routes an informal participation invitation without a question mark into an answer using the discussion context', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  api.questionsDetect.mockImplementation(async (batch: QuestionBatch) => batch.candidates.map(q => ({
    id: q.id, probability: q.text.startsWith('Anyone') ? 0.92 : 0.1,
  })));
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  c.setProfessorSpeaker(0);
  mock.opts!.onEvent({ type: 'final', text: 'The chapter contrasts group loyalty with individual conscience.', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  mock.opts!.onEvent({ type: 'final', text: 'Anyone who read it wanna demonstrate before I explain it', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  expect(api.answerStart).toHaveBeenCalledOnce();
  const request = api.answerStart.mock.calls[0][0];
  expect(request.question).toBe('Anyone who read it wanna demonstrate before I explain it');
  expect(request.fullTranscript).toContain('group loyalty with individual conscience');
  expect(request.detected).toBe(true);
  listeners.AnswerDelta({ requestId: request.requestId, text: 'Group loyalty can pressure people to act against their conscience.' });
  listeners.AnswerDone({ requestId: request.requestId, usage: null });
  expect(useOverlayStore.getState().answers[0]).toMatchObject({ phase: 'done', speaker: 0,
    text: 'Group loyalty can pressure people to act against their conscience.' });
  expect(mock.stop).not.toHaveBeenCalled();
});

it('retries the captured question once with a fresh ID and ignores late failed-attempt events', async () => {
  const c = await import('../src/renderer/overlay/controller');
  const { useOverlayStore } = await import('../src/renderer/overlay/store');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why does the constitution matter?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const original = structuredClone(api.answerStart.mock.calls[0][0]);
  listeners.AnswerDelta({ requestId: original.requestId, text: 'Incomplete answer' });
  listeners.AnswerError({ requestId: original.requestId, error: 'Connection failed' });
  expect(useOverlayStore.getState().answers[0].canRetry).toBe(true);
  mock.opts!.onEvent({ type: 'final', text: 'An unrelated later topic.', speaker: 1 });
  c.retryAnswer(original.requestId); c.retryAnswer(original.requestId);
  expect(api.answerStart).toHaveBeenCalledTimes(2);
  const retried = api.answerStart.mock.calls[1][0];
  expect(retried).toEqual({ ...original, requestId: retried.requestId });
  expect(retried.requestId).not.toBe(original.requestId);
  listeners.AnswerDelta({ requestId: original.requestId, text: 'Stale text' });
  listeners.AnswerDone({ requestId: original.requestId, usage: null });
  expect(useOverlayStore.getState().answers[0].text).toBe('');
  expect(useOverlayStore.getState().answers[0].phase).toBe('answering');
  listeners.AnswerDelta({ requestId: retried.requestId, text: 'Recovered answer' });
  listeners.AnswerDone({ requestId: retried.requestId, usage: null });
  expect(useOverlayStore.getState().answers).toHaveLength(1);
  expect(useOverlayStore.getState().answers[0]).toMatchObject({ text: 'Recovered answer', phase: 'done', error: undefined });
});

it('allows a failed retry to be retried after stopping capture without opening the microphone', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  mock.opts!.onEvent({ type: 'final', text: 'Why does the constitution matter?', speaker: 0 });
  await vi.advanceTimersByTimeAsync(751);
  const original = structuredClone(api.answerStart.mock.calls[0][0]);
  listeners.AnswerError({ requestId: original.requestId, error: 'Connection failed' });
  c.retryAnswer(original.requestId);
  const retried = api.answerStart.mock.calls[1][0];
  listeners.AnswerError({ requestId: retried.requestId, error: 'Still unavailable' });
  c.toggleListening();
  c.retryAnswer(retried.requestId);
  expect(api.answerStart).toHaveBeenCalledTimes(3);
  expect(api.answerStart.mock.calls[2][0]).toEqual({ ...original, requestId: expect.any(String) });
  expect(mock.start).toHaveBeenCalledOnce();
  c.resetClassroomSession();
  c.retryAnswer(retried.requestId);
  expect(api.answerStart).toHaveBeenCalledTimes(3);
});

it('queues retries behind active work and preserves their transcript while waiting', async () => {
  const c = await import('../src/renderer/overlay/controller');
  await c.initController(); c.toggleListening(); await vi.advanceTimersByTimeAsync(1);
  for (const text of ['Why does the constitution matter?', 'What is citizenship?', 'What is federalism?']) {
    mock.opts!.onEvent({ type: 'final', text, speaker: 0 });
    await vi.advanceTimersByTimeAsync(751);
  }
  const original = structuredClone(api.answerStart.mock.calls[0][0]);
  const second = api.answerStart.mock.calls[1][0];
  listeners.AnswerError({ requestId: original.requestId, error: 'Connection failed' });
  expect(api.answerStart).toHaveBeenCalledTimes(3);
  c.retryAnswer(original.requestId); c.retryAnswer(original.requestId);
  expect(api.answerStart).toHaveBeenCalledTimes(3);
  mock.opts!.onEvent({ type: 'final', text: 'A later unrelated topic.', speaker: 1 });
  listeners.AnswerDelta({ requestId: second.requestId, text: 'Second answer' });
  listeners.AnswerDone({ requestId: second.requestId, usage: null });
  expect(api.answerStart).toHaveBeenCalledTimes(4);
  expect(api.answerStart.mock.calls[3][0]).toEqual({ ...original, requestId: expect.any(String) });
});
