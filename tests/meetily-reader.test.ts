import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeetilyReader } from '../src/main/services/stt/meetily';

let root: string;
async function recording(name: string, created = '2026-09-22T12:00:00Z', status = 'recording') {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'metadata.json'), JSON.stringify({ status, created_at: created, transcript_file: 'transcripts.json' }));
  return folder;
}
async function segments(folder: string, texts: string[]) {
  await writeFile(join(folder, 'transcripts.json'), JSON.stringify({ segments: texts.map((text, sequence_id) => ({ text, sequence_id })) }));
}
describe('read-only Meetily transcript follower', () => {
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'meetily-reader-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('does not replay existing text and emits each newly appended final once', async () => {
    const folder = await recording('one');
    await segments(folder, ['Old private discussion']);
    const reader = new MeetilyReader(root);
    expect(await reader.poll(true)).toEqual({ events: [], reset: true, state: 'following' });
    await segments(folder, ['Old private discussion', 'What is civic nationalism?']);
    expect((await reader.poll()).events).toEqual([{ type: 'final', text: 'What is civic nationalism?', speaker: 0 }]);
    expect((await reader.poll()).events).toEqual([]);
  });
  it('never imports completed recordings and waits when Meetily is idle', async () => {
    const folder = await recording('old', undefined, 'completed');
    await segments(folder, ['Old question?']);
    expect(await new MeetilyReader(root).poll(true)).toEqual({ events: [], reset: false, state: 'waiting' });
  });
  it('does not lose the first question when recording has no transcript file yet', async () => {
    const folder = await recording('new');
    const reader = new MeetilyReader(root);
    expect((await reader.poll(true)).events).toEqual([]);
    await segments(folder, ['First new question?']);
    expect((await reader.poll()).events[0]).toMatchObject({ text: 'First new question?' });
  });
  it('clears session context and skips existing history after recording switches', async () => {
    const first = await recording('one');
    await segments(first, ['First lecture']);
    const reader = new MeetilyReader(root);
    await reader.poll(true);
    const next = await recording('two', '2026-09-22T14:00:00Z');
    await segments(next, ['Second lecture']);
    expect(await reader.poll()).toEqual({ events: [], reset: true, state: 'following' });
    await segments(next, ['Second lecture', 'New question?']);
    expect((await reader.poll()).events[0]).toMatchObject({ text: 'New question?' });
    await recording('two', '2026-09-22T14:00:00Z', 'completed');
    expect((await reader.poll()).state).toBe('waiting'); // Don't jump to abandoned first recording.
  });
  it('resumes from the current tail rather than processing paused speech', async () => {
    const folder = await recording('one');
    await segments(folder, ['Before']);
    const reader = new MeetilyReader(root);
    await reader.poll(true);
    await segments(folder, ['Before', 'While paused']);
    expect((await reader.poll(true)).events).toEqual([]);
  });
  it('retries malformed snapshots without dropping the next final', async () => {
    const folder = await recording('one');
    await segments(folder, ['Before']);
    const reader = new MeetilyReader(root);
    await reader.poll(true);
    await writeFile(join(folder, 'transcripts.json'), '{');
    await expect(reader.poll()).rejects.toThrow();
    await segments(folder, ['Before', 'After']);
    expect((await reader.poll()).events[0]).toMatchObject({ text: 'After' });
  });
  it('rejects transcript symlinks outside the selected recording', async () => {
    const folder = await recording('one');
    const outside = join(root, 'outside.json');
    await writeFile(outside, JSON.stringify({ segments: [] }));
    await symlink(outside, join(folder, 'transcripts.json'));
    await expect(new MeetilyReader(root).poll()).rejects.toThrow('Invalid Meetily transcript path');
  });
});
