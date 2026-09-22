import { app, dialog, shell, webContents } from 'electron';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { SessionEvent } from '../../shared/types';
import { IPC } from '../../shared/ipc-contract';
import { settings } from './settings';
import { getActiveProfile } from './profiles';
import { sessionToMarkdown } from './session-export';
import { SessionArchive } from './session-archive';

let currentId: string | null = null;
let currentProfile: string | null = null;
let archive: SessionArchive | null = null;
export function sessionsDir(): string {
  const dir = join(app.getPath('userData'), 'sessions');
  mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir;
}
function store(): SessionArchive { return archive ??= new SessionArchive(sessionsDir()); }
export function beginSession(): string {
  const p = getActiveProfile(); currentProfile = p.id;
  if (!settings().get().sessions.autoSave) { currentId = null; return ''; }
  return currentId = store().begin(p.id, p.name, app.getVersion());
}
export function recordEvent(ev: SessionEvent, sessionId?: string): void {
  if (!settings().get().sessions.autoSave) return;
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
