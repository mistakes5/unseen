import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSchoolTranscripts, type SchoolSyncConfig } from '../scripts/sync-school-transcripts.mjs';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'school-sync-')); dirs.push(root);
  const config: SchoolSyncConfig = { archiveDir: join(root, 'sessions'), profileDir: join(root, 'profiles'),
    settingsFile: join(root, 'settings.json'), stateFile: join(root, 'state.json'),
    courses: { 'course-a': join(root, 'School A'), 'course-b': join(root, 'School B') } };
  for (const [id, dir] of Object.entries(config.courses)) {
    mkdirSync(dir); mkdirSync(join(config.archiveDir, id), { recursive: true });
  }
  mkdirSync(config.profileDir);
  for (const id of Object.keys(config.courses)) writeFileSync(join(config.profileDir, `${id}.yaml`), `id: ${id}\n`);
  writeFileSync(config.settingsFile, JSON.stringify({ activeProfile: 'course-b', sessions: { autoSave: true } }));
  const source = join(config.archiveDir, 'course-a', '2026-10-19_one.jsonl');
  const events = [
    { type: 'start', t: 1792422000000, profileId: 'course-a', profileName: 'Course A', version: 'test' },
    { type: 'final', t: 1792422001000, profileId: 'course-a', speaker: 0, text: 'Spoken classroom content.' },
    { type: 'answer', t: 1792422002000, profileId: 'course-a', forced: false, text: 'An AI draft, not speech.' },
  ];
  writeFileSync(source, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const base = join(config.courses['course-a'], 'Documents');
  const output = join(base, 'Transcripts', '2026-10-19', 'Classroom Copilot', '2026-10-19_one');
  const log = join(base, 'Copilot Logs', '2026-10-19', 'Classroom Copilot', '2026-10-19_one.answers.md');
  return { config, source, output, log, events };
}

describe('automatic school-folder transcript sync', () => {
  it('follows the originating profile even after a switch, keeps AI separate, and leaves curated notes intact', () => {
    const { config, output, log } = setup();
    const cleaned = join(config.courses['course-a'], '2026-10-19 — Cleaned Transcript.md');
    writeFileSync(cleaned, 'User corrections');
    expect(syncSchoolTranscripts(config)).toMatchObject({ updated: 1, errors: [] });
    expect(readFileSync(`${output}.speech.md`, 'utf8')).toContain('Spoken classroom content.');
    expect(readFileSync(`${output}.speech.md`, 'utf8')).not.toContain('An AI draft');
    expect(readFileSync(`${output}.speech.jsonl`, 'utf8')).not.toContain('"type":"answer"');
    expect(readFileSync(log, 'utf8')).toContain('An AI draft, not speech.');
    expect(readFileSync(cleaned, 'utf8')).toBe('User corrections');
    expect(statSync(`${output}.speech.md`).mode & 0o777).toBe(0o600);
    expect(existsSync(join(config.courses['course-b'], 'Documents', 'Transcripts', '2026-10-19'))).toBe(false);
    const index = readFileSync(join(config.courses['course-a'], 'Documents', 'Transcripts', 'Classroom Copilot — Live Index.md'), 'utf8');
    expect(index).toContain('2026-10-19/Classroom Copilot/2026-10-19_one.speech.md');
    expect(index).toContain('../Copilot Logs/2026-10-19/Classroom Copilot/2026-10-19_one.answers.md');
  });
  it('retries a partial tail when completed, avoids unchanged writes, and repairs missing outputs', () => {
    const { config, source, output } = setup();
    syncSchoolTranscripts(config);
    const initialMtime = statSync(`${output}.speech.md`).mtimeMs;
    expect(syncSchoolTranscripts(config)).toMatchObject({ unchanged: 1, updated: 0 });
    expect(statSync(`${output}.speech.md`).mtimeMs).toBe(initialMtime);
    appendFileSync(source, '{"type":"final","t":1792422003000,"profileId":"course-a",');
    expect(syncSchoolTranscripts(config).errors).toEqual([]);
    expect(readFileSync(`${output}.speech.md`, 'utf8')).not.toContain('Later speech');
    appendFileSync(source, '"speaker":1,"text":"Later speech"}\n');
    expect(syncSchoolTranscripts(config)).toMatchObject({ updated: 1, errors: [] });
    expect(readFileSync(`${output}.speech.md`, 'utf8')).toContain('Later speech');
    rmSync(`${output}.speech.md`);
    expect(syncSchoolTranscripts(config).updated).toBe(1);
    expect(existsSync(`${output}.speech.md`)).toBe(true);
  });
  it('refuses mixed courses and retries corruption without replacing valid exports', () => {
    const { config, source, output, events } = setup();
    syncSchoolTranscripts(config);
    const saved = readFileSync(`${output}.speech.md`, 'utf8');
    appendFileSync(source, JSON.stringify({ ...events[1], profileId: 'course-b' }) + '\n');
    expect(syncSchoolTranscripts(config).errors[0]).toContain('Mixed-profile');
    expect(readFileSync(`${output}.speech.md`, 'utf8')).toBe(saved);
    writeFileSync(source, events.map(e => JSON.stringify(e)).join('\n') + '\n{bad}\n');
    expect(syncSchoolTranscripts(config).errors).toHaveLength(1);
    expect(readFileSync(`${output}.speech.md`, 'utf8')).toBe(saved);
    writeFileSync(source, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    expect(syncSchoolTranscripts(config).errors).toEqual([]);
  });
  it('honors disabled saving, excludes test sessions, and never guesses an unmapped course', () => {
    const { config, source, output, events } = setup();
    writeFileSync(config.settingsFile, '{"sessions":{"autoSave":false}}');
    expect(syncSchoolTranscripts(config).updated).toBe(0);
    writeFileSync(config.settingsFile, '{"sessions":{"autoSave":true}}');
    writeFileSync(join(config.profileDir, 'course-a.yaml'), 'id: course-a\nsessions:\n  autoSave: false\n');
    expect(syncSchoolTranscripts(config).updated).toBe(0);
    writeFileSync(join(config.profileDir, 'course-a.yaml'), 'id: course-a\n');
    events[0].profileName = 'Course A TEST replay';
    writeFileSync(source, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    expect(syncSchoolTranscripts(config)).toMatchObject({ updated: 0, skipped: 1, errors: [] });
    delete config.courses['course-a'];
    expect(syncSchoolTranscripts(config).updated).toBe(0);
    expect(existsSync(`${output}.speech.md`)).toBe(false);
  });
});
