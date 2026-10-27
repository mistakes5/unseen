import type { QuestionCandidate, QuestionJudgment } from '../../shared/types';
import { QUESTION_ROUTE_THRESHOLD } from '../../shared/classroom-context';

export function coalesceQuestions(batch: QuestionCandidate[], judgments: QuestionJudgment[], threshold: number, recentId?: string) {
  const questions: QuestionCandidate[] = [];
  const roots = new Map<string, string>();
  const links: { candidate: QuestionCandidate; targetId: string; action: 'repeat' | 'update' }[] = [];
  for (const candidate of batch) {
    const judgment = judgments.find(j => !j.kind && j.id === candidate.id);
    const route = judgment?.route;
    const targetId = route && route.probability >= QUESTION_ROUTE_THRESHOLD
      ? route.targetId === recentId ? recentId : roots.get(route.targetId) : undefined;
    if (targetId) {
      roots.set(candidate.id, targetId);
      links.push({ candidate, targetId, action: route!.action });
      const question = questions.find(q => q.id === targetId);
      if (question && route!.action === 'update') question.clarification =
        [question.clarification, `[S${candidate.speaker}] ${candidate.text}`].filter(Boolean).join('\n');
    } else if (judgment && judgment.probability >= threshold) {
      roots.set(candidate.id, candidate.id);
      questions.push({ ...candidate });
    }
  }
  return { questions, links };
}
