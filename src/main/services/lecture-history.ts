import type { SessionEvent, SessionMeta } from '../../shared/types';
import { retrieveCourse } from './course-retrieval';

export const MAX_LECTURE_CHARS = 240_000;
export interface LectureHistory { text: string; complete: boolean }
export function lectureDay(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

/** Same course/day includes restart segments, never other courses, days or TEST sessions. */
export function readLectureHistory(
  archive: { list(): SessionMeta[]; read(id: string): SessionEvent[] },
  profileId: string, now: number, volatile: SessionEvent[] = [],
): LectureHistory {
  const day = lectureDay(now);
  const events: SessionEvent[] = [...volatile];
  let complete = true;
  try {
    for (const meta of archive.list()) {
      if (meta.profileId !== profileId || lectureDay(meta.startedAt) !== day || /\bTEST\b/i.test(meta.profileName ?? '')) continue;
      try { events.push(...archive.read(meta.id)); } catch { complete = false; }
    }
  } catch { complete = false; }
  const seen = new Set<string>();
  const lines: string[] = [];
  let chars = 0;
  for (const ev of events.sort((a, b) => a.t - b.t)) {
    if (ev.t > now || lectureDay(ev.t) !== day || ('profileId' in ev && ev.profileId && ev.profileId !== profileId)) continue;
    // Generated answers are NOT evidence of something said aloud.
    const label = ev.type === 'final' ? 'LECTURE SPEECH'
      : ev.type === 'answer' && ev.responseKind === 'question-suggestion' ? 'PREVIOUS DRAFT (not necessarily asked)' : null;
    if (!label || !('text' in ev)) continue;
    const key = `${ev.t}:${ev.type}:${ev.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = `${label}: ${ev.text}\n`;
    chars += line.length;
    if (chars > MAX_LECTURE_CHARS) { complete = false; break; }
    lines.push(line);
  }
  return { text: lines.join(''), complete };
}

/** Overlap preserves explanations split at a boundary; no lexical shortlist at verification. */
export function lectureChunks(text: string, size = 18_000, overlap = 1500): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return chunks;
}

/** Cheap local shortlist for generation only. The final guard checks every history chunk. */
export function lectureDraftContext(history: LectureHistory, query: string): string {
  return retrieveCourse({ version: 1, builtAt: '', chunks: lectureChunks(history.text, 2400, 400)
    .map((text, i) => ({ source: 'Earlier lecture / prior drafts', locator: `passage ${i + 1}`, text })) }, query, 10_000)
    .map(k => k.text).join('\n\n');
}

/** Relevant earlier spoken passages for a longer explanation; drafts are not lecture evidence. */
export function lectureExpansionContext(history: LectureHistory, question: string, nearby: string, maxChars = 12_000): string {
  const speech = history.text.split('\n').filter(line => line.startsWith('LECTURE SPEECH: ')).join('\n');
  if (!speech.trim()) return '';
  return retrieveCourse({ version: 1, builtAt: '', chunks: lectureChunks(speech, 2400, 400)
    .map((text, i) => ({ source: 'Earlier spoken lecture', locator: `passage ${i + 1}`, text })) },
  `${question} ${nearby.slice(-500)}`, maxChars, nearby.slice(-1500)).map(k => k.text).join('\n\n');
}
