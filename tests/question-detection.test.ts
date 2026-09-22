import { describe, expect, it, vi } from 'vitest';
import { detectQuestion } from '../src/main/services/question-detection';
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
});
