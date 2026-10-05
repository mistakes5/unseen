import { app, dialog, shell, webContents } from 'electron';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { SessionEvent } from '../../shared/types';
import { IPC } from '../../shared/ipc-contract';
import { settings } from './settings';
import { getActiveProfile, getProfile } from './profiles';
import { sessionToMarkdown } from './session-export';
import { SessionArchive } from './session-archive';
import { lectureDay, MAX_LECTURE_CHARS, readLectureHistory } from './lecture-history';
import { archiveExpansionCorpora } from './expansion-search';

let currentId: string | null = null;
let currentProfile: string | null = null;
let archive: SessionArchive | null = null;
let memoryDay = '';
const lectureMemory = new Map<string, { events: SessionEvent[]; chars: number; complete: boolean }>();
function rememberLecture(ev: SessionEvent): void {
  if (process.argv.some(a => /--(?:silent|overlay)-replay/.test(a))) return;
  if (ev.type !== 'final' && !(ev.type === 'answer' && ev.responseKind === 'question-suggestion')) return;
  const day = lectureDay(Date.now());
  if (memoryDay !== day) { lectureMemory.clear(); memoryDay = day; }
  if (lectureDay(ev.t) !== day) return;
  const profileId = ev.profileId ?? getActiveProfile().id;
  const memory = lectureMemory.get(profileId) ?? { events: [], chars: 0, complete: true };
  memory.chars += ev.text.length;
  if (memory.chars <= MAX_LECTURE_CHARS) memory.events.push({ ...ev, profileId });
  else memory.complete = false;
  lectureMemory.set(profileId, memory);
}
export function getLectureHistory(profileId: string, asOf = Date.now()) {
  const memory = memoryDay === lectureDay(Date.now()) ? lectureMemory.get(profileId) : undefined;
  const history = readLectureHistory(store(), profileId, asOf, memory?.events);
  if (memory?.complete === false) history.complete = false;
  return history;
}
export function getExpansionArchiveCorpora(profileId: string, asOf: number, otherProfileIds: string[] = []) {
  return archiveExpansionCorpora(store().list(), id => store().read(id), profileId, asOf, otherProfileIds);
}
export function sessionsDir(): string {
  const dir = join(app.getPath('userData'), 'sessions');
  mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir;
}
function store(): SessionArchive { return archive ??= new SessionArchive(sessionsDir()); }
export function beginSession(): string {
  const p = getActiveProfile(); currentProfile = p.id;
  if (!settings().get().sessions.autoSave || p.sessions?.autoSave === false) { currentId = null; return ''; }
  return currentId = store().begin(p.id, p.name, app.getVersion());
}
export function recordEvent(ev: SessionEvent, sessionId?: string): void {
  rememberLecture(ev); // Also available in memory when disk autosave is disabled.
  if (!settings().get().sessions.autoSave) return;
  // Resolve the originating profile, never the current course for a late Demo event.
  const profileId = ev.profileId ?? sessionId?.split('/')[0] ?? getActiveProfile().id;
  const profile = getProfile(profileId);
  if (!profile || profile.sessions?.autoSave === false) return;
  if (!sessionId && profileId !== getActiveProfile().id) return;
  try {
    if (sessionId) {
      if ('profileId' in ev && ev.profileId && !sessionId.startsWith(`${ev.profileId}/`)) throw new Error('Session/course mismatch');
      store().append(sessionId, ev); return;
    }
    if (!currentId || currentProfile !== getActiveProfile().id) beginSession();
    if (currentId) store().append(currentId, ev);
  } catch (err) {
    console.error('[sessions] record failed:', err);
    for (const wc of webContents.getAllWebContents()) wc.send(IPC.evSessionError, 'Could not save this session event. Check free disk space and folder permissions.');
  }
}
export function readSession(id: string) { return store().read(id); }
export function listSessions() { return store().list(); }
export function searchSessions(profileId: string, query: string) { return store().search(profileId, query); }
export async function exportSession(id: string): Promise<{ ok: boolean; path?: string }> {
  const res = await dialog.showSaveDialog({ title: 'Export class session',
    defaultPath: join(app.getPath('documents'), `unseen-${id.replaceAll('/', '-')}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (res.canceled || !res.filePath) return { ok: false };
  writeFileSync(res.filePath, sessionToMarkdown(readSession(id)), { mode: 0o600 });
  return { ok: true, path: res.filePath };
}
export function deleteSession(id: string): void { store().delete(id); if (currentId === id) currentId = null; }
export function openSessionsFolder(): void { void shell.openPath(sessionsDir()); }
