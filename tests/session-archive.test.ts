import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionArchive } from '../src/main/services/session-archive';
import { sessionToMarkdown } from '../src/main/services/session-export';
const dirs: string[] = [];
function setup() { const dir = mkdtempSync(join(tmpdir(), 'classroom-archive-test-')); dirs.push(dir); return { dir, archive: new SessionArchive(dir) }; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('class-indexed durable transcripts and answers', () => {
  it('persists rejected detector scores without counting them as accepted questions or answers', () => {
    const { dir, archive } = setup();
    const id = archive.begin('course-a', 'Course A', 'test');
    const check = { type: 'question-check' as const, t: 2, questionId: 'q1', profileId: 'course-a',
      text: 'A test utterance.', probability: 0.42, threshold: 0.65, passed: false,
      elapsedMs: 170, promptVersion: 'classroom-invitation-v2' };
    archive.append(id, check);
    const reopened = new SessionArchive(dir);
    expect(reopened.read(id).at(-1)).toEqual(check);
    expect(reopened.list()[0]).toMatchObject({ questions: 0, answers: 0, finals: 0 });
  });
  it('links questions/answers, isolates courses, and survives a fresh archive instance', () => {
    const { dir, archive } = setup();
    const idA = archive.begin('course-a', 'Course A', 'test');
    const idB = archive.begin('course-b', 'Course B', 'test');
    expect(() => archive.append(idA, { type: 'final', t: 1, speaker: 0, text: 'wrong course', profileId: 'course-b' })).toThrow('Session/course mismatch');
    archive.append(idA, { type: 'final', t: 1, speaker: 2, text: 'Identity is discussed here.', profileId: 'course-a' });
    archive.append(idA, { type: 'question', t: 2, speaker: 2, text: 'What is identity?', questionId: 'q1', profileId: 'course-a' });
    archive.append(idA, { type: 'answer', t: 3, text: 'A social category.', questionId: 'q1', question: 'What is identity?', profileId: 'course-a', forced: false });
    archive.append(idB, { type: 'final', t: 4, speaker: 0, text: 'Identity in course B.', profileId: 'course-b' });
    const reopened = new SessionArchive(dir);
    expect(reopened.list().find(m => m.id === idA)).toMatchObject({ profileId: 'course-a', finals: 1, questions: 1, answers: 1 });
    expect(reopened.search('course-a', 'identity').every(h => h.sessionId === idA)).toBe(true);
    expect(reopened.search('course-a', 'identity')).toHaveLength(2);
    expect(statSync(join(dir, `${idA}.jsonl`)).mode & 0o777).toBe(0o600);
    const md = sessionToMarkdown(reopened.read(idA));
    expect(md).toContain('Course A'); expect(md).toContain('Question q1'); expect(md).toContain('S2');
    reopened.delete(idA); expect(reopened.list().map(m => m.id)).toEqual([idB]);
  });
  it('creates distinct sessions even when Start is pressed twice in the same second', () => {
    const { archive } = setup();
    expect(archive.begin('course-a', 'A', 'test', 1)).not.toBe(archive.begin('course-a', 'A', 'test', 1));
  });
  it('rejects traversal and refuses to resurrect deleted sessions', () => {
    const { archive } = setup();
    expect(() => archive.begin('../escape', 'A', 'test')).toThrow();
    expect(() => archive.read('../escape')).toThrow();
    const id = archive.begin('course-a', 'A', 'test'); archive.delete(id);
    expect(() => archive.append(id, { type: 'final', t: 1, speaker: 0, text: 'late' })).toThrow('no longer exists');
  });
  it('retains legacy sessions and ignores a torn trailing line', () => {
    const { dir, archive } = setup();
    writeFileSync(join(dir, 'legacy.jsonl'), JSON.stringify({ type: 'final', t: 1, text: 'Old transcript', speaker: 0 }) + '\n{"t":');
    expect(archive.list()).toMatchObject([{ id: 'legacy', finals: 1 }]);
    expect(archive.read('legacy')).toHaveLength(1);
  });
});
