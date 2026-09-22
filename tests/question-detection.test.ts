import { describe, expect, it, vi } from 'vitest';
import { detectQuestion, detectQuestions } from '../src/main/services/question-detection';
import type { AnswerPayload } from '../src/shared/types';

const payload: AnswerPayload = {
  fullTranscript: 'We have been discussing political identities.',
  newSegment: 'Could someone explain that distinction?',
  forced: false, codeMode: false, userSpeaker: 0,
};

describe('Jev question detection contract', () => {
  it.each(['canadian-politics', 'political-identities', 'federalism', 'politics-of-ai'])('adds isolated per-candidate focus for %s without extra model calls', async profileId => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {
      candidate_0: { type: 'noul', noul: 0.9 }, candidate_1: { type: 'noul', noul: 0.1 },
    } })));
    await detectQuestions({ profileId, candidates: [
      { id: 'a', text: 'Why?', speaker: 0, context: 'Do not use the merged later answer', priorContext: 'x'.repeat(8000), followingContext: 'About that example.' },
      { id: 'b', text: 'Okay.', speaker: 0, context: 'Merged later speech', priorContext: '' },
    ] }, 'test-key', new AbortController().signal, fetcher);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state.courseGuidance).toBeTruthy();
    expect(body.state.focus[0].recent).toHaveLength(1200);
    expect(body.state.focus[0].selected).toBe('Why?');
    expect(body.state.focus[0].continuation).toBe('About that example.');
    expect(body.state.focus[1].recent).toBe('');
    expect(body.questions.candidate_0.instructions).toContain('focus[0]');
    expect(body.questions.candidate_1.instructions).toContain('focus[1]');
    expect(body.questions.candidate_1.instructions).toContain('survey items');
    expect(Object.keys(body.questions)).toEqual(['candidate_0', 'candidate_1']);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not infer a course for unrelated or prototype-key profile IDs', async () => {
    for (const profileId of ['lecture-companion', 'toString', '__proto__']) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { needs_response: { type: 'noul', noul: 0.5 } } })));
      await detectQuestion({ ...payload, profileId }, 'test-key', new AbortController().signal, fetcher);
      const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      expect(body.state).not.toHaveProperty('courseGuidance');
      expect(body.state).not.toHaveProperty('focus');
      expect(body.questions.needs_response.instructions).not.toContain('courseGuidance');
    }
  });

  it('also supplies course context through the legacy single-question path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { needs_response: { type: 'noul', noul: 0.9 } } })));
    await detectQuestion({ ...payload, profileId: 'federalism' }, 'test-key', new AbortController().signal, fetcher);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state.courseGuidance).toContain('Federalism');
    expect(body.state.focus.selected).toBe(payload.newSegment);
  });

  it('judges a late clarification independently in the same request without replacing normal detections', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {
      candidate_0: { type: 'noul', noul: 0.3 }, clarifies_recent: { type: 'noul', noul: 0.94 },
    } })));
    const result = await detectQuestions({ profileId: 'course', candidates: [
      { id: 'q2', text: 'For the chart.', speaker: 0, context: '' },
    ], recentQuestion: { id: 'q1', text: 'What attributes?', context: 'Postmodernism rejects grand narratives.', followingSpeech: 'Give a term for the chart.' } }, 'test-key', new AbortController().signal, fetcher);
    expect(result).toEqual([{ id: 'q2', probability: 0.3 }, { id: 'q1', probability: 0.94, kind: 'clarification' }]);
    expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state.recentQuestion.followingSpeech).toBe('Give a term for the chart.');
    expect(body.questions.clarifies_recent.criteria.false).toContain('student answer');
  });
  it('sends bounded transcript state and reads the documented Noul probability', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { needs_response: { type: 'noul', noul: 0.91 } } })));
    expect(await detectQuestion(payload, 'test-key', new AbortController().signal, fetcher)).toBe(0.91);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(init!.body as string);
    expect(body.state.newSpeech).toBe(payload.newSegment);
    expect(body.questions.needs_response.type).toBe('noul');
    expect(body.model).toBe('jev-latest');
  });
  it.each([{}, { type: 'noul', noul: 'yes' }, { type: 'noul', noul: 2 }])('rejects malformed judgments without triggering an answer', async (answer) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { needs_response: answer } })));
    await expect(detectQuestion(payload, 'test-key', new AbortController().signal, fetcher)).rejects.toThrow('invalid question judgment');
  });
  it('surfaces authentication errors instead of silently changing detectors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    await expect(detectQuestion(payload, 'test-key', new AbortController().signal, fetcher)).rejects.toThrow('HTTP 401');
  });

  it('keeps each candidate separate from its preceding context and explicitly includes recall and short follow-ups', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {
      candidate_0: { type: 'noul', noul: 0.95 }, candidate_1: { type: 'noul', noul: 0.1 },
    } })));
    const results = await detectQuestions({ profileId: 'course', candidates: [
      { id: 'recall', text: 'What did you take from that section?', speaker: 0,
        context: 'Merged transcript through candidate', priorContext: 'Earlier discussion about group comparisons.', followingContext: 'Could you explain the main argument?' },
      { id: 'filler', text: 'Um,', speaker: 0, context: 'Merged transcript through filler', priorContext: 'Earlier discussion and the recall question.' },
    ] }, 'test-key', new AbortController().signal, fetcher);
    expect(results).toEqual([{ id: 'recall', probability: 0.95 }, { id: 'filler', probability: 0.1 }]);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state.candidates[0].precedingDiscussion).toBe('Earlier discussion about group comparisons.');
    expect(body.state.candidates[0].text).toBe('What did you take from that section?');
    expect(body.state.candidates[0].followingSpeech).toBe('Could you explain the main argument?');
    expect(body.questions.candidate_0.instructions).toContain('candidates[0].followingSpeech');
    expect(body.questions.candidate_0.instructions).toContain('candidates[0].precedingDiscussion');
    expect(body.questions.candidate_1.instructions).toContain('candidates[1].text');
    expect(body.questions.candidate_0.instructions).toContain('Prior explanation is not proof');
    expect(body.questions.candidate_0.instructions).toContain('Why?');
    expect(body.questions.candidate_0.instructions).toContain('not whether you know the answer');
    expect(body.questions.candidate_0.instructions).toContain('Open invitations to participate count');
    expect(body.questions.candidate_0.instructions).toContain('do not wait for an explicit request to summarize');
    expect(body.questions.candidate_0.criteria.false).toContain('classroom logistics');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('bounds prior context and preserves empty prior context instead of leaking the candidate into it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {
      candidate_0: { type: 'noul', noul: 0.8 }, candidate_1: { type: 'noul', noul: 0.2 },
    } })));
    await detectQuestions({ profileId: 'course', candidates: [
      { id: 'a', text: 'x'.repeat(3000), speaker: 0, priorContext: 'a'.repeat(9000), context: 'not used' },
      { id: 'b', text: 'Opening sentence.', speaker: 0, priorContext: '', context: 'Opening sentence.' },
    ] }, 'test-key', new AbortController().signal, fetcher);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.state.candidates[0].text).toHaveLength(2500);
    expect(body.state.candidates[0].precedingDiscussion).toHaveLength(7000);
    expect(body.state.candidates[1].precedingDiscussion).toBe('');
  });
});
