import { expect, it, vi } from 'vitest';
import { detectQuestions } from '../src/main/services/question-detection';
import { routingQuestion, readRoute } from '../src/main/services/question-routing';
import { coalesceQuestions } from '../src/renderer/overlay/question-routing';
import type { QuestionBatch, QuestionJudgment } from '../src/shared/types';

const batch: QuestionBatch = { profileId: 'politics-of-ai', coalesce: true,
  recentQuestion: { id: 'old', text: 'How would you classify that claim?', context: 'A claim about a public institution.', followingSpeech: '' },
  candidates: [
    { id: 'a', text: 'Was it an honest mistake?', speaker: 0, context: '' },
    { id: 'b', text: 'Or intentional deception?', speaker: 0, context: '' },
    { id: 'c', text: 'Who is elected to the chamber?', speaker: 0, context: '' },
  ] };
const choice = (index: number, selected: string, hasRecent = true) => ({ type: 'choice', choice: selected, confidence: .98,
  probabilities: Object.fromEntries(Object.keys(routingQuestion(index, hasRecent).criteria).map(key => [key, key === selected ? 1 : 0])) });

it('batches per-span relationships with detection and maps only source-backed earlier targets', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: {
    candidate_0: { type: 'noul', noul: .9 }, candidate_1: { type: 'noul', noul: .9 }, candidate_2: { type: 'noul', noul: .9 },
    route_0: choice(0, 'recent_update'), route_1: choice(1, 'previous_update'), route_2: choice(2, 'independent'),
  } })));
  const results = await detectQuestions(batch, 'synthetic-key', new AbortController().signal, fetcher);
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.questions.clarifies_recent).toBeUndefined();
  expect(body.questions.route_0.criteria.previous_update).toBeUndefined();
  expect(body.questions.route_1.instructions).toContain('different claims');
  expect(results[0].route).toEqual({ targetId: 'old', action: 'update', probability: 1 });
  expect(results[1].route?.targetId).toBe('a');
  const grouped = coalesceQuestions(batch.candidates, results, .65, 'old');
  expect(grouped.questions.map(q => q.id)).toEqual(['c']);
  expect(grouped.links.map(l => l.targetId)).toEqual(['old', 'old']);
});

it('keeps valid detections when optional routes are missing, uncertain or malformed', () => {
  const bad = [undefined, {}, { ...choice(0, 'recent_update'), choice: 'future_update' },
    { ...choice(0, 'recent_update'), probabilities: { recent_update: 1 } },
    { ...choice(0, 'recent_update'), probabilities: { independent: .9, recent_repeat: 0, recent_update: .1 } },
    { ...choice(0, 'recent_update'), probabilities: { independent: NaN, recent_repeat: 0, recent_update: 1 } }];
  for (const value of bad) expect(readRoute(value, 0, batch)).toBeUndefined();
  const judgments: QuestionJudgment[] = batch.candidates.map(q => ({ id: q.id, probability: .99,
    route: { targetId: 'old', action: 'update', probability: .79 } }));
  expect(coalesceQuestions(batch.candidates, judgments, .65, 'old').questions).toHaveLength(3);
});

it('does not merge a question into a rejected span or an unavailable parent', () => {
  expect(coalesceQuestions(batch.candidates.slice(0, 2), [
    { id: 'a', probability: .1 }, { id: 'b', probability: .99, route: { action: 'update', targetId: 'a', probability: .99 } },
  ], .65).questions.map(q => q.id)).toEqual(['b']);
  expect(coalesceQuestions(batch.candidates.slice(0, 1), [
    { id: 'a', probability: .99, route: { action: 'update', targetId: 'old', probability: .99 } },
  ], .65).questions.map(q => q.id)).toEqual(['a']);
});

it('a restatement is retained as a note without changing the original prompt', () => {
  const qs = batch.candidates.slice(0, 2);
  const grouped = coalesceQuestions(qs, [
    { id: 'a', probability: .99 }, { id: 'b', probability: .99, route: { action: 'repeat', targetId: 'a', probability: .99 } },
  ], .65);
  expect(grouped.questions).toHaveLength(1);
  expect(grouped.questions[0].clarification).toBeUndefined();
  expect(grouped.links[0].action).toBe('repeat');
});
