import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import type { AnswerPayload } from '../src/shared/types';
import type { WebContents } from 'electron';
import type { ExpansionSourcesConfig } from '../src/main/services/expansion-sources';
import type { ExpansionCorpus } from '../src/main/services/expansion-search';

const mocks = vi.hoisted(() => ({
  config: {} as typeof DEFAULT_SETTINGS,
  detect: vi.fn(),
  stream: vi.fn(),
  key: vi.fn(),
  record: vi.fn(),
  knowledge: vi.fn(() => []),
  history: vi.fn(() => ({ text: 'Earlier lecture', complete: true })),
  archives: vi.fn<() => ExpansionCorpus[]>(() => []),
  sources: vi.fn<() => ExpansionSourcesConfig>(() => ({ version: 1, indexes: [], transcriptProfiles: [] })),
  indexes: vi.fn<() => ExpansionCorpus[]>(() => []),
  novelty: vi.fn(),
}));
vi.mock('../src/main/services/settings', () => ({ settings: () => ({ get: () => mocks.config }) }));
vi.mock('../src/main/services/secrets', () => ({ getSecret: (...args: unknown[]) => mocks.key(...args) }));
vi.mock('../src/main/services/question-detection', () => ({ detectQuestion: (...args: unknown[]) => mocks.detect(...args) }));
vi.mock('../src/main/services/profiles', () => ({ getActiveProfile: () => ({ memory: { namespaces: [] }, id: 'political-identities' }) }));
vi.mock('../src/main/services/knowledge', () => ({ loadKnowledge: mocks.knowledge, loadMemoryFacts: () => [], loadWatchedMarkdown: () => [] }));
vi.mock('../src/main/services/prompt-builder', () => ({ buildAnswerRequest: () => ({ model: 'gpt-5.6-luna', system: [], messages: [], maxTokens: 2000, reasoningEffort: 'low' }) }));
vi.mock('../src/main/services/llm/registry', () => ({ getLlmProvider: () => ({ stream: mocks.stream }), providerContext: () => ({}) }));
vi.mock('../src/main/services/sessions', () => ({ recordEvent: (...args: unknown[]) => mocks.record(...args), getLectureHistory: mocks.history,
  getExpansionArchiveCorpora: mocks.archives }));
vi.mock('../src/main/services/expansion-sources', () => ({ loadExpansionSourcesConfig: mocks.sources, loadExpansionIndexCorpora: mocks.indexes }));
vi.mock('../src/main/services/suggestion-guard', () => ({ checkSuggestion: mocks.novelty }));

import { runAnswer, cancelAnswer } from '../src/main/services/llm/run-answer';

const payload: AnswerPayload = { fullTranscript: 'A classroom discussion.', newSegment: 'How does identity differ from citizenship?', forced: false, codeMode: false, userSpeaker: 0 };

describe('classroom Jev → answer flow', () => {
  beforeEach(() => {
    cancelAnswer();
    vi.clearAllMocks();
    mocks.config = structuredClone(DEFAULT_SETTINGS);
    mocks.sources.mockReturnValue({ version: 1, indexes: [], transcriptProfiles: [] });
    mocks.indexes.mockReturnValue([]);
    mocks.archives.mockReturnValue([]);
    mocks.key.mockReturnValue('test-key');
    mocks.history.mockReturnValue({ text: 'Earlier lecture', complete: true });
    mocks.novelty.mockResolvedValue({ allow: true, reason: 'No collision', elapsedMs: 100, checks: 1 });
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'delta', text: 'A suggested contribution.' };
      yield { type: 'done' };
    });
  });

  it.each([
    ['Codex could not complete this answer. Check codex login, model access, network, and account usage limits.', false],
    ['fetch failed', true],
    ['connect ECONNREFUSED', true],
  ])('does not infer an outage from generic troubleshooting advice: %s', async (message, network) => {
    mocks.config.llm.provider = 'codex'; mocks.config.llm.fallbacks = [];
    mocks.stream.mockImplementation(async function* () { throw new Error(message); });
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, { ...payload, detected: true, requestId: 'failure' });
    expect(send).toHaveBeenCalledWith('answer:error', { requestId: 'failure', error: network
      ? 'codex: cannot reach the API — check your connection.' : `codex: ${message}` });
  });

  it('does not call the answer model when Jev rejects a segment', async () => {
    mocks.detect.mockResolvedValue(0.1);
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, payload);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('answer:done', { usage: null });
  });

  it('buffers suggestion text until the actual draft passes and checks speech arriving during generation', async () => {
    const send = vi.fn();
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'delta', text: 'Question to ask: A follow-up?' };
      expect(send).not.toHaveBeenCalled();
      mocks.history.mockReturnValue({ text: 'Earlier lecture plus new explanation', complete: true });
      yield { type: 'delta', text: '\nWhy it matters: A limit.' };
    });
    await runAnswer({ send } as unknown as WebContents, { ...payload, detected: true, responseKind: 'question-suggestion' });
    expect(mocks.novelty).toHaveBeenCalledWith('Question to ask: A follow-up?\nWhy it matters: A limit.',
      { text: 'Earlier lecture plus new explanation', complete: true }, payload.fullTranscript, 'test-key', expect.any(AbortSignal));
    expect(send).toHaveBeenCalledWith('answer:delta', 'Question to ask: A follow-up?\nWhy it matters: A limit.');
  });

  it('never displays or saves a rejected suggestion as an answer', async () => {
    mocks.novelty.mockResolvedValue({ allow: false, reason: 'Already answered', elapsedMs: 123, checks: 1 });
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, { ...payload, detected: true, responseKind: 'question-suggestion' });
    expect(send).toHaveBeenCalledWith('answer:delta', 'SKIP');
    expect(send).not.toHaveBeenCalledWith('answer:delta', 'A suggested contribution.');
    expect(mocks.record.mock.calls.some(([ev]) => ev.type === 'answer')).toBe(false);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'answer-status', status: 'skipped', text: expect.stringContaining('Already answered') }), undefined);
  });

  it('checks late speech once more before showing a suggestion', async () => {
    mocks.novelty.mockImplementationOnce(async () => {
      mocks.history.mockReturnValue({ text: 'Earlier lecture\nLate answer.', complete: true });
      return { allow: true, reason: '', elapsedMs: 100, checks: 1 };
    }).mockResolvedValueOnce({ allow: false, reason: 'Late answer', elapsedMs: 100, checks: 1 });
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, { ...payload, detected: true, responseKind: 'question-suggestion' });
    expect(mocks.novelty).toHaveBeenCalledTimes(2);
    expect(mocks.novelty.mock.calls[1][1].text).toBe('\nLate answer.');
    expect(send).toHaveBeenCalledWith('answer:delta', 'SKIP');
  });

  it('streams a Luna answer after an accepted question', async () => {
    mocks.detect.mockResolvedValue(0.95);
    const send = vi.fn();
    await runAnswer({ send } as unknown as WebContents, payload);
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-luna', reasoningEffort: 'low' }), expect.anything());
    expect(send).toHaveBeenCalledWith('answer:delta', 'A suggested contribution.');
    expect(mocks.novelty).not.toHaveBeenCalled();
    expect(mocks.history).toHaveBeenCalledWith('political-identities', expect.any(Number));
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
      question: 'How does identity differ from citizenship?', sessionId: 'political-identities/original' });
    mocks.knowledge.mockClear(); mocks.detect.mockClear(); mocks.record.mockClear();
    mocks.history.mockReturnValue({ text: 'LECTURE SPEECH: Earlier identity and citizenship distinction.\nPREVIOUS DRAFT (not necessarily asked): Unspoken draft.\n', complete: true });
    await runAnswer(sender, { ...payload, requestId: 'expand-child', expandAnswerId: 'expand-source',
      fullTranscript: 'Wrong newer lecture', question: 'Wrong newer question?', sessionId: 'political-identities/wrong' });
    expect(mocks.knowledge).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
    const req = mocks.stream.mock.calls.at(-1)![0];
    expect(JSON.stringify(req)).not.toContain('Wrong newer');
    expect(JSON.stringify(req)).toContain('Earlier identity and citizenship distinction');
    expect(JSON.stringify(req)).not.toContain('Unspoken draft');
    expect(mocks.history).toHaveBeenCalledWith('political-identities', expect.any(Number));
    expect(req.messages.at(-2)).toEqual({ role: 'assistant', content: 'A suggested contribution.' });
    expect(req.system.at(-1).text).toContain('To play devil’s advocate');
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'expand-source', question: 'How does identity differ from citizenship?', expandedFrom: 'expand-source',
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

  it('adds relevant local reading and cross-class speech only to the requested expansion', async () => {
    const sender = { send: vi.fn(), id: 94 } as unknown as WebContents;
    await runAnswer(sender, { ...payload, detected: true, requestId: 'linked-source',
      question: 'Should search reproduce biased social patterns?' });
    mocks.sources.mockReturnValue({ version: 1, indexes: [{ profileId: 'political-identities', courseName: 'Political Identities', file: 'identity.index.json' }],
      transcriptProfiles: ['politics-of-ai'] });
    mocks.indexes.mockReturnValue([{ profileId: 'political-identities', courseName: 'Political Identities', kind: 'reading', chunks: [
      { source: 'Social identity reading', locator: 'file p. 3', text: 'Social identity shapes which groups receive recognition.' },
    ] }]);
    mocks.archives.mockReturnValue([{ profileId: 'politics-of-ai', courseName: 'Politics of AI', kind: 'lecture', chunks: [
      { source: 'Earlier class', locator: 'passage 1', text: 'Search results reproduce racial stereotypes.' },
    ] }]);
    await runAnswer(sender, { ...payload, requestId: 'linked-expand', expandAnswerId: 'linked-source',
      question: 'Unrelated newer question?', fullTranscript: 'Unrelated newer speech.' });
    const request = mocks.stream.mock.calls.at(-1)![0];
    const rendered = JSON.stringify(request);
    expect(rendered).toContain('Search results reproduce racial stereotypes.');
    expect(rendered).toContain('Politics of AI');
    expect(rendered).not.toContain('Unrelated newer');
    expect(mocks.archives).toHaveBeenCalledWith('political-identities', expect.any(Number), ['politics-of-ai']);
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
