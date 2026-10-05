import { describe, expect, it, vi } from 'vitest';
import { checkSuggestion } from '../src/main/services/suggestion-guard';
import { lectureChunks, lectureDraftContext, lectureExpansionContext, MAX_LECTURE_CHARS, readLectureHistory } from '../src/main/services/lecture-history';
import type { SessionEvent, SessionMeta } from '../src/shared/types';

const now = Date.parse('2026-09-23T19:00:00Z');
const draft = 'Question to ask: Would the same rule apply in a crisis?\nWhy it matters: It tests the limit.';
const clear = { answered: { type: 'noul', noul: 0.01 }, repeated: { type: 'noul', noul: 0.02 }, mistakenPremise: { type: 'noul', noul: 0.03 } };
const response = (answers = clear) => new Response(JSON.stringify({ answers }));
const signal = () => new AbortController().signal;
describe('lecture-wide suggestion evidence', () => {
  it('includes old restart segments but excludes other courses, dates, TEST sessions and generated answers', () => {
    const metas = [
      { id: 'a/old', profileId: 'a', startedAt: now - 60000 },
      { id: 'a/new', profileId: 'a', startedAt: now },
      { id: 'b/other', profileId: 'b', startedAt: now },
      { id: 'a/yesterday', profileId: 'a', startedAt: now - 86400000 },
      { id: 'a/test', profileId: 'a', startedAt: now, profileName: 'A — TEST replay' },
    ] as SessionMeta[];
    const final: SessionEvent = { t: now - 60000, type: 'final', speaker: 0, text: 'Earlier explanation', profileId: 'a' };
    const read = vi.fn((id: string): SessionEvent[] => id === 'a/old' ? [final] : [
      { t: now, type: 'answer', profileId: 'a', text: 'Unspoken AI answer', forced: false },
      { t: now, type: 'answer', profileId: 'a', text: draft, forced: false, responseKind: 'question-suggestion' },
    ]);
    const history = readLectureHistory({ list: () => metas, read }, 'a', now, [final]);
    expect(read.mock.calls.map(c => c[0])).toEqual(['a/old', 'a/new']);
    expect(history.complete).toBe(true);
    expect(history.text.match(/Earlier explanation/g)).toHaveLength(1);
    expect(history.text).toContain('PREVIOUS DRAFT (not necessarily asked)');
    expect(history.text).not.toContain('Unspoken AI answer');
  });
  it('uses volatile evidence without disk autosave and fails closed on unreadable/overlong history', () => {
    const event: SessionEvent = { type: 'final', t: now, text: 'A'.repeat(MAX_LECTURE_CHARS + 1), speaker: 0, profileId: 'a' };
    expect(readLectureHistory({ list: () => [], read: () => [] }, 'a', now, [event]).complete).toBe(false);
    expect(readLectureHistory({ list: () => { throw Error('disk'); }, read: () => [] }, 'a', now).complete).toBe(false);
    const h = readLectureHistory({ list: () => [], read: () => [] }, 'a', now, [{ ...event, text: 'Volatile speech' }]);
    expect(h).toEqual({ text: 'LECTURE SPEECH: Volatile speech\n', complete: true });
  });
  it('retrieves older passages for drafting and covers every character with overlapping verification chunks', () => {
    const text = 'Constitutional entrenchment protects regional autonomy.\n' + 'Unrelated geography. '.repeat(1500);
    expect(lectureDraftContext({ text, complete: true }, 'What protects regional autonomy?')).toContain('Constitutional entrenchment');
    const chunks = lectureChunks(text);
    expect(chunks[1].slice(0, 1500)).toBe(chunks[0].slice(-1500));
    expect(chunks[0] + chunks.slice(1).map(c => c.slice(1500)).join('')).toBe(text);
  });
  it('selects relevant spoken lecture context without treating prior AI drafts as speech', () => {
    const history = { text: [
      'LECTURE SPEECH: Peoplehood connects language, shared history, and ancestral homelands.',
      'PREVIOUS DRAFT (not necessarily asked): Invented professor view about peoplehood.',
      'LECTURE SPEECH: The room then discussed a different topic.',
    ].join('\n'), complete: true };
    const context = lectureExpansionContext(history, 'How does peoplehood relate to land?', 'Indigenous identity discussion');
    expect(context).toContain('ancestral homelands');
    expect(context).not.toContain('Invented professor view');
  });
});
describe('actual draft novelty gate', () => {
  it.each(['answered', 'repeated', 'mistakenPremise'] as const)('withholds %s, including uncertain collisions', async key => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ ...clear, [key]: { type: 'noul', noul: 0.35 } }));
    const result = await checkSuggestion(draft, { text: 'Older lecture', complete: true }, 'Recent speech', 'key', signal(), fetcher);
    expect(result.allow).toBe(false); expect(result.reason).toContain(key);
    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(body.state.draft).toBe(draft);
    expect(body.state.lectureExcerpt).toContain('Older lecture');
  });
  it('checks all history with at most two simultaneous requests, without filtering by keyword', async () => {
    let active = 0, peak = 0;
    const fetcher = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return response();
    });
    const result = await checkSuggestion(draft, { text: 'Old speech '.repeat(7000), complete: true }, '', 'key', signal(), fetcher);
    expect(result.allow).toBe(true); expect(result.checks).toBeGreaterThan(2); expect(peak).toBe(2);
  });
  it('withholds on malformed judgments, service failure, missing key, or incomplete evidence', async () => {
    const invalid = vi.fn(async () => response({} as typeof clear));
    expect((await checkSuggestion(draft, { text: 'speech', complete: true }, '', 'key', signal(), invalid)).allow).toBe(false);
    const down = vi.fn(async () => new Response('', { status: 401 }));
    expect((await checkSuggestion(draft, { text: 'speech', complete: true }, '', 'key', signal(), down)).allow).toBe(false);
    const unused = vi.fn();
    expect((await checkSuggestion(draft, { text: 'speech', complete: false }, '', 'key', signal(), unused)).allow).toBe(false);
    expect((await checkSuggestion(draft, { text: 'speech', complete: true }, '', '', signal(), unused)).allow).toBe(false);
    expect((await checkSuggestion('SKIP', { text: 'speech', complete: true }, '', 'key', signal(), unused)).allow).toBe(false);
    expect(unused).not.toHaveBeenCalled();
  });
  it('propagates cancellation rather than publishing an unchecked draft', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(checkSuggestion(draft, { text: 'speech', complete: true }, '', 'key', controller.signal, vi.fn())).rejects.toThrow();
  });
});
