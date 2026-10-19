import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent, SessionMeta } from '../src/shared/types';
import { collectNotesSource, generateNotesAfterConfirmation, notesDestination, notesRequest, saveNotes } from '../src/main/services/session-notes';
import { codexArgs } from '../src/main/services/llm/codex';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const t = new Date('2026-10-19T11:30:00-04:00').getTime();
function fixture() {
  const events: Record<string, SessionEvent[]> = {};
  const metas: SessionMeta[] = [];
  function add(id: string, profileId: string, at: number, text: string, name = 'Course A') {
    events[id] = [{ type: 'start', t: at, profileId, profileName: name, version: 'test' },
      { type: 'final', t: at + 1000, profileId, speaker: 0, text },
      { type: 'answer', t: at + 2000, profileId, forced: false, text: 'AI answer must not become lecture evidence.' }];
    metas.push({ id, profileId, profileName: name, startedAt: at, endedAt: at + 2000, finals: 1, answers: 1 });
  }
  add('course-a/first', 'course-a', t, 'Early explanation of a concept.');
  add('course-a/restart', 'course-a', t + 600_000, 'Continuation of the concept after restarting.');
  add('course-a/unrelated', 'course-a', t + 1200_000, 'A separate tutorial about another topic.');
  add('course-b/other', 'course-b', t, 'Another course should not appear.');
  add('course-a/yesterday', 'course-a', t - 86400_000, 'Yesterday should not appear.');
  add('course-a/test', 'course-a', t, 'Replay should not appear.', 'Course A TEST replay');
  return { events, archive: { list: () => metas.slice().reverse(), read: (id: string) => events[id] } };
}

describe('Stop → confirm → daily profile notes', () => {
  it('collects every same-day recording in order, including unrelated topics, without AI or other courses', () => {
    const { archive } = fixture();
    const source = collectNotesSource(archive, 'course-a/restart');
    expect(source.sessionIds).toEqual(['course-a/first', 'course-a/restart', 'course-a/unrelated']);
    expect(source.segments).toBe(3);
    expect(source.text).toContain('Early explanation');
    expect(source.text).toContain('after restarting');
    expect(source.text).toContain('separate tutorial');
    expect(source.text).not.toMatch(/AI answer|Yesterday|Another course|Replay/);
    expect(source.text.indexOf('Early explanation')).toBeLessThan(source.text.indexOf('after restarting'));
    const request = notesRequest(source);
    expect(request).toMatchObject({ model: 'gpt-6.1-sol', reasoningEffort: 'low', serviceTier: 'priority' });
    expect(request.system[0].text).toContain('Keep unrelated topics');
    expect(request.system[0].text).toContain('Read every recording');
    const args = codexArgs(request);
    expect(args).toContain('gpt-6.1-sol');
    expect(args).toContain('model_reasoning_effort="low"');
    expect(args).toContain('service_tier="priority"');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--ignore-user-config');
  });
  it('sends nothing to the model when the user declines, and saves only after confirmation', async () => {
    const source = collectNotesSource(fixture().archive, 'course-a/restart');
    const generate = vi.fn(async () => '# Study notes\n\nA grounded account of the recorded class.');
    const save = vi.fn();
    expect(await generateNotesAfterConfirmation(source, { confirm: async () => false, generate, save })).toBe(false);
    expect(generate).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(await generateNotesAfterConfirmation(source, { confirm: async () => true, generate, save })).toBe(true);
    expect(generate).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledOnce();
  });
  it('does not save partial notes on a provider error', async () => {
    const source = collectNotesSource(fixture().archive, 'course-a/restart');
    const save = vi.fn();
    await expect(generateNotesAfterConfirmation(source, { confirm: async () => true,
      generate: async () => { throw new Error('Provider unavailable'); }, save })).rejects.toThrow('Provider unavailable');
    expect(save).not.toHaveBeenCalled();
  });
  it('saves beside existing course notes, preserves curated files, and updates its own dated note', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classroom-notes-')); dirs.push(dir);
    const source = collectNotesSource(fixture().archive, 'course-a/restart');
    const path = notesDestination(dir, source);
    writeFileSync(path, '# User-written summary');
    expect(() => saveNotes(path, dir, source, '# Notes\n\nA grounded account of the recorded class.')).toThrow('preserved');
    expect(readFileSync(path, 'utf8')).toBe('# User-written summary');
    rmSync(path);
    saveNotes(path, dir, source, '# Notes\n\nA grounded account of the recorded class.');
    expect(readFileSync(path, 'utf8')).toContain('model: gpt-6.1-sol');
    expect(readFileSync(path, 'utf8')).toContain('Includes 3 recording(s)');
    saveNotes(path, dir, source, '# Updated notes\n\nA grounded account with the later recording.');
    expect(readFileSync(path, 'utf8')).toContain('# Updated notes');
  });
  it('rejects mixed profiles and does not silently skip an unreadable daily recording', () => {
    const { events, archive } = fixture();
    events['course-a/first'].push({ type: 'final', t, profileId: 'course-b', text: 'wrong course', speaker: 1 });
    expect(() => collectNotesSource(archive, 'course-a/restart')).toThrow('mixed course');
    events['course-a/first'].pop();
    expect(() => collectNotesSource({ list: archive.list, read: id => {
      if (id === 'course-a/first') throw new Error('Unreadable archive');
      return archive.read(id);
    } }, 'course-a/restart')).toThrow('Unreadable');
  });
});
