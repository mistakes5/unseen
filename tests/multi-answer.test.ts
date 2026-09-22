import { describe, expect, it, vi } from 'vitest';
import { AnswerQueue, questionSpans } from '../src/renderer/overlay/question-queue';
import { useOverlayStore } from '../src/renderer/overlay/store';
import { speakerTurns } from '../src/renderer/overlay/stt/speaker-turns';
import { detectQuestions } from '../src/main/services/question-detection';

const question = (id: string, speaker = 0) => ({ id, speaker, text: `Question ${id}?`, context: 'Context' });

describe('independent question queue', () => {
  it('splits multiple question marks and retains a final invitation', () => {
    expect(questionSpans('What is identity? How is it learned? Give an example.')).toEqual(['What is identity?', 'How is it learned?', 'Give an example.']);
    expect(questionSpans('Tajfel did an experiment. What did it show?')).toHaveLength(1);
  });
  it('runs two answers, queues the rest, and completes out of order', () => {
    const start = vi.fn(); const q = new AnswerQueue(start);
    for (const id of ['1', '2', '3', '4']) q.enqueue(question(id));
    expect(start.mock.calls.map(c => c[0].id)).toEqual(['1', '2']);
    q.finish('2'); expect(start.mock.calls.at(-1)![0].id).toBe('3');
    expect(q.has('1')).toBe(true);
    q.finish('3'); q.finish('1'); q.finish('4');
    expect(q.running + q.pending).toBe(0);
  });
  it('puts the professor ahead of waiting student questions, without cancelling active answers', () => {
    const start = vi.fn(); const q = new AnswerQueue(start);
    q.enqueue(question('1')); q.enqueue(question('2'));
    q.enqueue(question('3', 1)); q.enqueue(question('4', 2));
    q.prioritize(2); q.finish('1');
    expect(start.mock.calls.at(-1)![0].id).toBe('4');
    expect(q.has('2')).toBe(true);
    q.finish('2'); expect(start.mock.calls.at(-1)![0].id).toBe('3');
  });
  it('clears queued and active work; stale completions cannot advance another session', () => {
    const start = vi.fn(); const q = new AnswerQueue(start);
    q.enqueue(question('old1')); q.enqueue(question('old2')); q.enqueue(question('old3'));
    expect(q.clear()).toHaveLength(3);
    q.enqueue(question('new'));
    expect(q.finish('old1')).toBe(false); expect(q.has('new')).toBe(true);
    expect(start).toHaveBeenCalledTimes(3);
  });
  it('shows newest questions first even if priority causes older questions to be enqueued last', () => {
    useOverlayStore.setState({ answers: [] });
    const s = useOverlayStore.getState();
    s.beginAnswer('1-3', 'Newest'); s.beginAnswer('1-1', 'Oldest'); s.beginAnswer('1-2', 'Middle');
    s.appendAnswer('1-1', 'Answer one'); s.appendAnswer('1-3', 'Answer three');
    expect(useOverlayStore.getState().answers.map(a => a.question)).toEqual(['Newest', 'Middle', 'Oldest']);
    expect(useOverlayStore.getState().answers.at(-1)?.text).toBe('Answer one');
  });
});

it('preserves per-word speaker changes and question punctuation', () => {
  expect(speakerTurns({ type: 'final', text: 'Why? Good question.', speaker: 1, words: [
    { word: 'why', punctuated_word: 'Why?', speaker: 0, start: 0, end: 1 },
    { word: 'good', punctuated_word: 'Good', speaker: 1, start: 1, end: 2 },
    { word: 'question', punctuated_word: 'question.', speaker: 1, start: 2, end: 3 },
  ] }).map(e => e.type === 'final' ? [e.speaker, e.text] : null)).toEqual([[0, 'Why?'], [1, 'Good question.']]);
});

it('checks every candidate independently in one Jev request, keyed to its own source span', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {
    candidate_0: { type: 'noul', noul: 0.94 }, candidate_1: { type: 'noul', noul: 0.96 }, candidate_2: { type: 'noul', noul: 0.03 },
  } })));
  const result = await detectQuestions({ profileId: 'course-a', candidates: [question('1'), question('2'), question('3')] }, 'test-key', new AbortController().signal, fetcher);
  expect(result.map(r => r.id)).toEqual(['1', '2', '3']);
  expect(result.filter(r => r.probability >= 0.8)).toHaveLength(2);
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(Object.keys(body.questions)).toHaveLength(3);
  expect(body.questions.candidate_1.instructions).toContain('candidates[1].text');
});

it('fails closed if any candidate judgment is missing', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { candidate_0: { type: 'noul', noul: 0.9 } } })));
  await expect(detectQuestions({ profileId: 'course-a', candidates: [question('1'), question('2')] }, 'test-key', new AbortController().signal, fetcher)).rejects.toThrow('invalid question judgment');
});
