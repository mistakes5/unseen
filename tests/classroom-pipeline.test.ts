import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import type { AnswerPayload } from '../src/shared/types';
import type { WebContents } from 'electron';

const mocks = vi.hoisted(() => ({
  config: {} as typeof DEFAULT_SETTINGS,
  detect: vi.fn(),
  stream: vi.fn(),
  key: vi.fn(),
  record: vi.fn(),
  knowledge: vi.fn(() => []),
}));
vi.mock('../src/main/services/settings', () => ({ settings: () => ({ get: () => mocks.config }) }));
vi.mock('../src/main/services/secrets', () => ({ getSecret: (...args: unknown[]) => mocks.key(...args) }));
vi.mock('../src/main/services/question-detection', () => ({ detectQuestion: (...args: unknown[]) => mocks.detect(...args) }));
vi.mock('../src/main/services/profiles', () => ({ getActiveProfile: () => ({ memory: { namespaces: [] }, id: 'political-identities' }) }));
vi.mock('../src/main/services/knowledge', () => ({ loadKnowledge: mocks.knowledge, loadMemoryFacts: () => [], loadWatchedMarkdown: () => [] }));
vi.mock('../src/main/services/prompt-builder', () => ({ buildAnswerRequest: () => ({ model: 'gpt-5.6-luna', system: [], messages: [], maxTokens: 2000, reasoningEffort: 'low' }) }));
vi.mock('../src/main/services/llm/registry', () => ({ getLlmProvider: () => ({ stream: mocks.stream }), providerContext: () => ({}) }));
vi.mock('../src/main/services/sessions', () => ({ recordEvent: (...args: unknown[]) => mocks.record(...args) }));

import { runAnswer, cancelAnswer } from '../src/main/services/llm/run-answer';

const payload: AnswerPayload = { fullTranscript: 'A classroom discussion.', newSegment: 'How does identity differ from citizenship?', forced: false, codeMode: false, userSpeaker: 0 };

describe('classroom Jev → answer flow', () => {
  beforeEach(() => {
    cancelAnswer();
    vi.clearAllMocks();
    mocks.config = structuredClone(DEFAULT_SETTINGS);
    mocks.key.mockReturnValue('test-key');
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'delta', text: 'A suggested contribution.' };
      yield { type: 'done' };
    });
  });

  it('does not call the answer model when Jev rejects a segment', async () => {
    mocks.detect.mockResolvedValue(0.1);
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, payload);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('answer:done', { usage: null });
  });

  it('streams a Luna answer after an accepted question', async () => {
    mocks.detect.mockResolvedValue(0.95);
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, payload);
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-luna', reasoningEffort: 'low' }), expect.anything());
    expect(send).toHaveBeenCalledWith('answer:delta', 'A suggested contribution.');
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ timing: {
      provider: mocks.config.llm.provider, prepareMs: expect.any(Number),
      firstTextMs: expect.any(Number), completeMs: expect.any(Number),
    } }), undefined);
  });

  it('allows Ask now without a TypeSafe key', async () => {
    mocks.key.mockReturnValue(null);
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, { ...payload, forced: true });
    expect(mocks.detect).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it('reports missing Jev credentials and never silently switches to paid answers', async () => {
    mocks.key.mockReturnValue(null);
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, payload);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('answer:error', expect.stringContaining('TypeSafe key'));
  });

  it('runs two tagged answers concurrently and routes completion to the correct question', async () => {
    const release: (() => void)[] = [];
    mocks.stream.mockImplementation(async function* () {
      const n = release.length;
      const gate = new Promise<void>(resolve => release.push(resolve));
      await gate;
      yield { type: 'delta', text: `Answer ${n}` };
    });
    const send = vi.fn(); const sender = { send } as unknown as WebContents;
    const p1 = runAnswer(sender, { ...payload, detected: true, requestId: 'q1', sessionId: 'political-identities/session' });
    const p2 = runAnswer(sender, { ...payload, detected: true, requestId: 'q2', sessionId: 'political-identities/session' });
    expect(release).toHaveLength(2);
    await runAnswer(sender, { ...payload, detected: true, requestId: 'q3' });
    expect(send).toHaveBeenCalledWith('answer:error', expect.objectContaining({ requestId: 'q3' }));
    release[1](); await p2;
    expect(send).toHaveBeenCalledWith('answer:delta', { requestId: 'q2', text: 'Answer 1' });
    release[0](); await p1;
    expect(send).toHaveBeenCalledWith('answer:delta', { requestId: 'q1', text: 'Answer 0' });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q1' }), 'political-identities/session');
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q2' }), 'political-identities/session');
  });

  it('does not emit or save late output from cancelled answers', async () => {
    let release!: () => void;
    mocks.stream.mockImplementation(async function* () {
      await new Promise<void>(resolve => { release = resolve; });
      yield { type: 'delta', text: 'Late output' };
    });
    const send = vi.fn();
    const pending = runAnswer({ send } as unknown as WebContents, { ...payload, detected: true, requestId: 'cancelled' });
    cancelAnswer(); release(); await pending;
    expect(send).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });

  it('expands from the original snapshot without Jev or retrieval and saves to the original question/session', async () => {
    const send = vi.fn(); const sender = { send, id: 77 } as unknown as WebContents;
    await runAnswer(sender, { ...payload, detected: true, requestId: 'expand-source',
      question: 'Original question?', sessionId: 'political-identities/original' });
    mocks.knowledge.mockClear(); mocks.detect.mockClear(); mocks.record.mockClear();
    await runAnswer(sender, { ...payload, requestId: 'expand-child', expandAnswerId: 'expand-source',
      fullTranscript: 'Wrong newer lecture', question: 'Wrong newer question?', sessionId: 'political-identities/wrong' });
    expect(mocks.knowledge).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
    const req = mocks.stream.mock.calls.at(-1)![0];
    expect(JSON.stringify(req)).not.toContain('Wrong newer');
    expect(req.messages[0]).toEqual({ role: 'assistant', content: 'A suggested contribution.' });
    expect(req.system.at(-1).text).toContain('To play devil’s advocate');
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'expand-source', question: 'Original question?', expandedFrom: 'expand-source',
    }), 'political-identities/original');
    expect(send).toHaveBeenCalledWith('answer:done', { requestId: 'expand-child', usage: null });
  });

  it('rejects missing expansion context before any model or retrieval call', async () => {
    const send = vi.fn();
    await runAnswer({ send, id: 88 } as unknown as WebContents,
      { ...payload, requestId: 'missing', expandAnswerId: 'not-cached' });
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.knowledge).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('answer:error', { requestId: 'missing', error: expect.stringContaining('unavailable') });
  });

  it('archives both original and refined answers in the original session, then expands the revised snapshot without retrieval', async () => {
    const sender = { send: vi.fn(), id: 92 } as unknown as WebContents;
    await runAnswer(sender, { ...payload, detected: true, requestId: 'refine-source', question: 'What attributes?', sessionId: 'political-identities/saved' });
    mocks.knowledge.mockClear(); mocks.detect.mockClear();
    mocks.stream.mockImplementation(async function* () { yield { type: 'delta', text: 'Skepticism — questioning universal claims.' }; });
    await runAnswer(sender, { ...payload, requestId: 'refine-child', refineAnswerId: 'refine-source', clarification: 'Key terms for the chart.', sessionId: 'wrong' });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'refine-source', refinedFrom: 'refine-source', text: 'Skepticism — questioning universal claims.' }), 'political-identities/saved');
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'refine-source', text: 'A suggested contribution.' }), 'political-identities/saved');
    expect(mocks.knowledge).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
    await runAnswer(sender, { ...payload, requestId: 'refine-expand', expandAnswerId: 'refine-source' });
    const req = mocks.stream.mock.calls.at(-1)![0];
    expect(req.messages.at(-2).content).toBe('Skepticism — questioning universal claims.');
    expect(req.messages.some((m: any) => m.content.includes('Key terms for the chart.'))).toBe(true);
  });
});
