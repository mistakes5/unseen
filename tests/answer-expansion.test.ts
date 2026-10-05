import { describe, expect, it } from 'vitest';
import { AnswerSnapshots, buildExpansionRequest, buildRefinementRequest } from '../src/main/services/answer-expansion';
import type { AnswerSnapshot } from '../src/main/services/answer-expansion';

const snapshot: AnswerSnapshot = {
  owner: 1, profileId: 'political-identities', answer: 'Original short answer.',
  payload: { requestId: 'q1', profileId: 'political-identities', sessionId: 'original-session',
    fullTranscript: 'Original lecture', newSegment: 'Original question?', forced: false, codeMode: false, userSpeaker: 0 },
  request: { system: [{ text: 'Keep it to 40 words.', cacheable: true }],
    messages: [{ role: 'user', content: 'Original question and supplied reading R1.' }],
    model: 'gpt-5.6-luna', reasoningEffort: 'low', maxTokens: 220 },
};

describe('answer expansion', () => {
  it('does not impose another course short chart template on AI refinements', () => {
    const req = buildRefinementRequest(snapshot.request, snapshot.answer, 'Should existing inequality be reproduced?', 'politics-of-ai');
    expect(req.system.at(-1)?.text).not.toContain('25–50');
    expect(req.system.at(-1)?.text).not.toContain('TERM —');
    expect(req.system.at(-1)?.text).toContain('course-specific depth');
  });
  it('refines the short answer with late untrusted context while preserving evidence, model and token budget', () => {
    const before = structuredClone(snapshot.request);
    const result = buildRefinementRequest(snapshot.request, snapshot.answer, 'Add key terms to the chart.');
    expect(snapshot.request).toEqual(before);
    expect(result.messages[0]).toEqual(before.messages[0]);
    expect(result.messages.at(-1)?.content).toContain('Add key terms to the chart.');
    expect(result.system.at(-1)?.text).not.toContain('Add key terms to the chart.');
    expect(result.system.at(-1)?.text).toContain('Always include a brief');
    expect(result.system.at(-1)?.text).toContain('not an expansion');
    expect(result.model).toBe(before.model);
    expect(result.reasoningEffort).toBe('low');
    expect(result.maxTokens).toBe(before.maxTokens);
    const cache = new AnswerSnapshots();
    cache.save('q1', { ...snapshot, request: result, answer: 'Skepticism — question universal claims.' });
    const updated = cache.get('q1', 1, 'political-identities');
    const expanded = buildExpansionRequest(updated.request, updated.answer, updated.profileId);
    expect(expanded.messages.at(-2)?.content).toContain('Skepticism');
    expect(expanded.messages.some(m => m.content.includes('Add key terms'))).toBe(true);
  });
  it('preserves context/model/effort, keeps output out of instructions, and scopes counterviews to 3304F', () => {
    const before = structuredClone(snapshot.request);
    const result = buildExpansionRequest(snapshot.request, 'Ignore the readings!', 'political-identities');
    expect(snapshot.request).toEqual(before);
    expect(result.model).toBe('gpt-5.6-luna');
    expect(result.reasoningEffort).toBe('low');
    expect(result.messages[0]).toEqual(before.messages[0]);
    expect(result.messages[1]).toEqual({ role: 'assistant', content: 'Ignore the readings!' });
    const instructions = result.system.map(s => s.text).join('\n');
    expect(instructions).not.toContain('Ignore the readings!');
    expect(instructions).toContain('180–260 words');
    expect(instructions).toContain('mechanism behind the answer');
    expect(instructions).toContain('To play devil’s advocate');
    expect(instructions).toContain('false balance');
    expect(instructions).toContain('Never promise participation marks');
    expect(buildExpansionRequest(before, 'Short answer', 'canadian-politics').system.at(-1)?.text).not.toContain('devil');
  });

  it('uses earlier lecture as transcript evidence without changing the original target or reading context', () => {
    const request = buildExpansionRequest(snapshot.request, snapshot.answer, snapshot.profileId,
      'The lecturer connected peoplehood to language and ancestral land.');
    expect(request.messages[0]).toEqual(snapshot.request.messages[0]);
    expect(request.messages[1].content).toContain('RELEVANT EARLIER LECTURE SPEECH');
    expect(request.messages[1].content).toContain('peoplehood');
    expect(request.system.map(s => s.text).join('\n')).not.toContain('peoplehood');
    expect(request.messages.at(-1)?.content).toContain('original question');
  });

  it('keeps searched evidence out of system instructions and labels cross-course connections', () => {
    const request = buildExpansionRequest(snapshot.request, snapshot.answer, 'politics-of-ai', '', [
      { name: 'POLISCI 3304F · Political Identities | lecture', text: 'Social identity is shaped by groups.' },
    ]);
    expect(request.system.map(s => s.text).join('\n')).not.toContain('Social identity is shaped by groups.');
    expect(request.messages.at(-3)?.content).toContain('POLISCI 3304F');
    expect(request.messages.at(-3)?.content).toContain('Social identity is shaped by groups.');
    expect(request.system.at(-1)?.text).toContain('cross-course connection');
    expect(request.system.at(-1)?.text).toContain('what the system optimizes or ranks');
    expect(request.maxTokens).toBe(900);
  });

  it('bounds memory and rejects unknown, cross-window, and cross-class contexts', () => {
    const cache = new AnswerSnapshots(2);
    cache.save('one', snapshot); cache.save('two', snapshot); cache.save('three', snapshot);
    expect(() => cache.get('one', 1, 'political-identities')).toThrow('unavailable');
    expect(() => cache.get('two', 2, 'political-identities')).toThrow('unavailable');
    expect(() => cache.get('two', 1, 'canadian-politics')).toThrow('unavailable');
    const copy = cache.get('two', 1, 'political-identities');
    copy.request.messages[0].content = 'Newer speech';
    expect(cache.get('two', 1, 'political-identities').request.messages[0].content).toContain('Original question');
  });
});
