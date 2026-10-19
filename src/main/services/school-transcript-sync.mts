#!/usr/bin/env node
// Local, read-only follower of the app's durable archive. No audio or API access.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { load } from 'js-yaml';
import type { SessionEvent } from '../../shared/types';

export interface SchoolSyncConfig {
  archiveDir: string;
  profileDir: string;
  settingsFile: string;
  stateFile: string;
  courses: Record<string, string>;
}
interface Receipt { signature: string; files: string[] }
interface State { version: number; sessions: Record<string, Receipt> }
const VERSION = 1;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const time = (t: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(t);

function writeAtomic(file: string, text: string): void {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, text, { mode: 0o600 });
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}

function parseEvents(text: string): SessionEvent[] {
  // The writer may be between writes. Only read newline-terminated records;
  // a malformed complete record is an error, never a silent omission.
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => {
    const event = JSON.parse(line) as SessionEvent;
    if (!Number.isFinite(event.t) || typeof event.type !== 'string') throw new Error('Invalid event');
    if (['final', 'answer', 'question', 'answer-status'].includes(event.type)
      && (!('text' in event) || typeof event.text !== 'string')) throw new Error('Invalid text event');
    return event;
  });
}

export function syncSchoolTranscripts(config: SchoolSyncConfig) {
  for (const path of [config.archiveDir, config.profileDir, config.settingsFile, config.stateFile, ...Object.values(config.courses)]) {
    if (!isAbsolute(path)) throw new Error('Sync paths must be absolute');
  }
  const result = { updated: 0, unchanged: 0, skipped: 0, errors: [] as string[] };
  const settings = JSON.parse(readFileSync(config.settingsFile, 'utf8'));
  if (settings.sessions?.autoSave !== true) return result;
  let state: State = { version: VERSION, sessions: {} };
  if (existsSync(config.stateFile)) {
    const saved = JSON.parse(readFileSync(config.stateFile, 'utf8')) as State;
    if (saved.version === VERSION && saved.sessions) state = saved;
  }
  for (const [profileId, courseDir] of Object.entries(config.courses)) {
    if (!/^[a-z0-9-]+$/.test(profileId)) throw new Error('Invalid profile mapping');
    try {
      if (!statSync(courseDir).isDirectory()) throw new Error('Course folder is missing');
      const profileFile = ['yaml', 'yml'].map(ext => join(config.profileDir, `${profileId}.${ext}`)).find(existsSync);
      if (!profileFile) throw new Error('Mapped user profile is missing');
      const profile = load(readFileSync(profileFile, 'utf8')) as { id: string; sessions?: { autoSave?: boolean } };
      if (profile.id !== profileId) throw new Error('Profile ID mismatch');
      if (profile.sessions?.autoSave === false) { result.skipped++; continue; }
      const sourceDir = join(config.archiveDir, profileId);
      if (!existsSync(sourceDir)) continue;
      for (const filename of readdirSync(sourceDir).filter(f => /^\d{4}-\d{2}-\d{2}_[a-zA-Z0-9_-]+\.jsonl$/.test(f)).sort()) {
        const id = `${profileId}/${filename.slice(0, -6)}`;
        try {
          const source = join(sourceDir, filename);
          const stat = statSync(source);
          const signature = `${VERSION}:${courseDir}:${stat.size}:${stat.mtimeMs}`;
          const previous = state.sessions[id];
          if (previous?.signature === signature && previous.files.every(existsSync)) { result.unchanged++; continue; }
          const text = readFileSync(source, 'utf8');
          const events = parseEvents(text);
          const start = events.find(e => e.type === 'start');
          if (!start || start.type !== 'start' || start.profileId !== profileId) throw new Error('Missing matching session start');
          if (/\b(TEST|DEMO|REPLAY)\b/i.test(start.profileName ?? '')) { result.skipped++; continue; }
          if (events.some(e => 'profileId' in e && e.profileId && e.profileId !== profileId)) throw new Error('Mixed-profile session');
          const speech = events.filter(e => e.type === 'final' || e.type === 'speaker-label');
          const finals = speech.filter(e => e.type === 'final');
          if (!finals.length) { result.skipped++; continue; }
          const day = filename.slice(0, 10);
          const stem = filename.slice(0, -6);
          const transcriptDir = join(courseDir, 'Documents', 'Transcripts', day, 'Classroom Copilot');
          const logsDir = join(courseDir, 'Documents', 'Copilot Logs', day, 'Classroom Copilot');
          const name = (start.profileName ?? profileId).replace(/[\r\n]/g, ' ');
          const header = [`# ${name} — ${day}`, '',
            'Automatically updated from saved Classroom Copilot events. Uncorrected speech recognition; not audio-verified.',
            'Times are America/Toronto. Speaker numbers are anonymous; professor labels reflect user assignments.',
            'Generated files are replaced on updates. Keep edited/cleaned notes outside this Classroom Copilot folder.', '',
            `Source session: \`${id}\``, ''];
          const speechLines = [...header, `Finalized speech segments: ${finals.length}`, '', '## Transcript', ''];
          for (const e of speech) {
            if (e.type === 'final') speechLines.push(`**[${time(e.t)}] S${e.speaker}:** ${e.text}`, '');
            if (e.type === 'speaker-label') speechLines.push(`*${time(e.t)} — Professor label ${e.speaker === null ? 'cleared' : `assigned by user to S${e.speaker}`}.*`, '');
          }
          const speechFile = join(transcriptDir, `${stem}.speech.jsonl`);
          const markdownFile = join(transcriptDir, `${stem}.speech.md`);
          const provenanceFile = join(transcriptDir, `${stem}.provenance.json`);
          writeAtomic(speechFile, [start, ...speech].map(e => JSON.stringify(e)).join('\n') + '\n');
          writeAtomic(markdownFile, speechLines.join('\n'));
          const completeSource = text.slice(0, text.lastIndexOf('\n') + 1);
          writeAtomic(provenanceFile, JSON.stringify({ version: VERSION, source, sessionId: id,
            sourceSha256: hash(completeSource), sourceBytes: Buffer.byteLength(completeSource),
            profileId, speechSegments: finals.length, lastSpeechAt: finals.at(-1)!.t,
            lastSavedEventAt: events.at(-1)!.t, audioVerified: false, edited: false }, null, 2) + '\n');
          const files = [speechFile, markdownFile, provenanceFile];
          const answers = events.filter(e => e.type === 'answer' || e.type === 'question' || e.type === 'answer-status');
          if (answers.length) {
            const lines = [`# ${name} — ${day} — AI log`, '',
              'AI-generated drafts and detected question context. Not a transcript or evidence of what anyone said.',
              `Source session: \`${id}\``, ''];
            for (const e of answers) {
              if (e.type === 'answer') lines.push(`## ${time(e.t)} — ${e.responseKind === 'question-suggestion' ? 'Suggested question (AI draft)' : 'AI answer'}`,
                ...(e.question ? ['', `Detected question context: ${e.question}`] : []), '', e.text, '');
              if (e.type === 'question') lines.push(`### ${time(e.t)} — Detected question context`, '', e.text, '');
              if (e.type === 'answer-status') lines.push(`*${time(e.t)} — ${e.status}: ${e.text}*`, '');
            }
            const logFile = join(logsDir, `${stem}.answers.md`);
            writeAtomic(logFile, lines.join('\n')); files.push(logFile);
          }
          state.sessions[id] = { signature, files }; result.updated++;
        } catch (error) { result.errors.push(`${id}: ${(error as Error).message}`); }
      }
      const indexDir = join(courseDir, 'Documents', 'Transcripts');
      const index = ['# Classroom Copilot — automatic transcript copies', '',
        'Uncorrected finalized speech, organized by the session’s originating course profile.',
        'Updates approximately every 10 seconds while logged in and awake. Cleaned notes remain separate.', '',
        '| Date / session | Speech transcript | AI drafts (separate) |', '| --- | --- | --- |'];
      for (const [id, receipt] of Object.entries(state.sessions).sort(([a], [b]) => b.localeCompare(a))) {
        if (!id.startsWith(`${profileId}/`)) continue;
        const speech = receipt.files.find(f => f.endsWith('.speech.md') && f.startsWith(`${indexDir}/`));
        if (!speech || !existsSync(speech)) continue;
        const stem = id.split('/')[1];
        const log = receipt.files.find(f => f.endsWith('.answers.md') && existsSync(f));
        index.push(`| ${stem.slice(0, 10)} / ${stem.slice(11, 19)} | [Open transcript](<${relative(indexDir, speech)}>) | ${log ? `[AI log](<${relative(indexDir, log)}>)` : '—'} |`);
      }
      writeAtomic(join(indexDir, 'Classroom Copilot — Live Index.md'), index.join('\n') + '\n');
    } catch (error) { result.errors.push(`${profileId}: ${(error as Error).message}`); }
  }
  writeAtomic(config.stateFile, JSON.stringify(state, null, 2) + '\n');
  return result;
}
