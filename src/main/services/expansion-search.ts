import { retrieveCourse, type CourseChunk, type CourseIndex } from './course-retrieval';
import type { ExpansionEvidence } from './answer-expansion';
import type { SessionEvent, SessionMeta } from '../../shared/types';
import { lectureChunks, lectureDay } from './lecture-history';

export interface ExpansionCorpus {
  profileId: string;
  courseName: string;
  kind: 'reading' | 'lecture';
  chunks: CourseChunk[];
}

/** Historical speech only, scoped by explicit course IDs and the original answer's time. */
export function archiveExpansionCorpora(metas: SessionMeta[], read: (id: string) => SessionEvent[],
  currentProfileId: string, asOf: number, otherProfileIds: string[] = []): ExpansionCorpus[] {
  const allowed = new Set([currentProfileId, ...otherProfileIds]);
  const output: ExpansionCorpus[] = [];
  for (const meta of metas.filter(m => m.profileId && allowed.has(m.profileId) && m.startedAt <= asOf
    && !/\bTEST\b/i.test(m.profileName ?? '')
    && (m.profileId !== currentProfileId || lectureDay(m.startedAt) !== lectureDay(asOf)))
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 60)) {
    let events: SessionEvent[];
    try { events = read(meta.id); } catch { continue; }
    const speech = events.filter((e): e is Extract<SessionEvent, { type: 'final' }> =>
      e.type === 'final' && e.t <= asOf && (!e.profileId || e.profileId === meta.profileId))
      .map(e => e.text.trim()).filter(Boolean).join('\n');
    if (!speech) continue;
    const chunks = lectureChunks(speech.slice(0, 240_000), 2400, 400)
      .map((text, i) => ({ source: `Spoken session ${lectureDay(meta.startedAt)}`,
        locator: `passage ${i + 1}`, text }));
    output.push({ profileId: meta.profileId!, courseName: meta.profileName ?? meta.profileId!, kind: 'lecture', chunks });
  }
  return output;
}

/** Local selection only. The answer model decides whether a selected connection helps. */
export function selectExpansionEvidence(corpora: ExpansionCorpus[], currentProfileId: string,
  question: string, answer: string, nearby: string, includeOtherCourses: boolean): ExpansionEvidence[] {
  const query = `${question} ${answer.slice(0, 500)} ${nearby.slice(-700)}`;
  const select = (crossCourse: boolean, budget: number): ExpansionEvidence[] => {
    const chunks = corpora.filter(c => (c.profileId !== currentProfileId) === crossCourse)
      .flatMap(c => c.chunks.map(chunk => ({ ...chunk,
        source: `${c.courseName} | ${c.kind} | ${chunk.source}` })));
    if (!chunks.length) return [];
    const index: CourseIndex = { version: 1, builtAt: '', chunks };
    return retrieveCourse(index, query, budget, nearby).map(e => ({ name: e.name, text: e.text }));
  };
  return [...select(false, 8000), ...(includeOtherCourses ? select(true, 5000) : [])];
}
