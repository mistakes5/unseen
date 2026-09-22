import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import type { AnswerPayload } from '../src/shared/types';
import type { WebContents } from 'electron';

const mocks = vi.hoisted(() => ({
  config: {} as typeof DEFAULT_SETTINGS,
  detect: vi.fn(),
  stream: vi.fn(),
  key: vi.fn(),
}));
vi.mock('../src/main/services/settings', () => ({ settings: () => ({ get: () => mocks.config }) }));
vi.mock('../src/main/services/secrets', () => ({ getSecret: (...args: unknown[]) => mocks.key(...args) }));
vi.mock('../src/main/services/question-detection', () => ({ detectQuestion: (...args: unknown[]) => mocks.detect(...args) }));
vi.mock('../src/main/services/profiles', () => ({ getActiveProfile: () => ({ memory: { namespaces: [] }, id: 'political-identities' }) }));
vi.mock('../src/main/services/knowledge', () => ({ loadKnowledge: () => [], loadMemoryFacts: () => [], loadWatchedMarkdown: () => [] }));
vi.mock('../src/main/services/prompt-builder', () => ({ buildAnswerRequest: () => ({ model: 'gpt-5.6-luna', system: [], messages: [], maxTokens: 2000, reasoningEffort: 'low' }) }));
vi.mock('../src/main/services/llm/registry', () => ({ getLlmProvider: () => ({ stream: mocks.stream }), providerContext: () => ({}) }));
vi.mock('../src/main/services/sessions', () => ({ recordEvent: () => {} }));

import { runAnswer } from '../src/main/services/llm/run-answer';

const payload: AnswerPayload = { fullTranscript: 'A classroom discussion.', newSegment: 'How does identity differ from citizenship?', forced: false, codeMode: false, userSpeaker: 0 };

describe('classroom Jev → answer flow', () => {
  beforeEach(() => {
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
});
