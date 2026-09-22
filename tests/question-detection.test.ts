import { describe, expect, it, vi } from 'vitest';
import { detectQuestion, detectQuestions } from '../src/main/services/question-detection';
import type { AnswerPayload } from '../src/shared/types';

const payload: AnswerPayload = {
  fullTranscript: 'We have been discussing political identities.',
  newSegment: 'Could someone explain that distinction?',
  forced: false, codeMode: false, userSpeaker: 0,
};

describe('Jev question detection contract', () => {
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
