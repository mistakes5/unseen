import { app, BrowserWindow, shell, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc-contract';
import type { SessionNotesDialog } from '../../shared/types';
import { settings } from './settings';
import { getProfile } from './profiles';
import { listSessions, readSession } from './sessions';
import { codexProvider } from './llm/codex';
import { collectNotesSource, generateNotesAfterConfirmation, notesDestination, saveNotes } from './session-notes';

interface PendingDialog {
  parent: BrowserWindow; state: SessionNotesDialog; path?: string;
  answer?: (accepted: boolean) => void; dispose(): void;
}
const dialogs = new Map<string, PendingDialog>();
const running = new Set<string>();
const generations = new Map<string, Promise<string>>();

export async function respondToNotesDialog(sender: WebContents, id: string, action: string): Promise<void> {
  const dialog = dialogs.get(id);
  if (!dialog || dialog.parent.webContents.id !== sender.id) return;
  if (dialog.state.phase === 'confirm' && (action === 'create' || action === 'cancel')) {
    const answer = dialog.answer; dialog.answer = undefined;
    if (action === 'create') dialog.state.phase = 'working';
    else dialog.dispose();
    answer?.(action === 'create');
  } else if (dialog.state.phase === 'saved' && (action === 'open' || action === 'done')) {
    if (action === 'open' && dialog.path) {
      const error = await shell.openPath(dialog.path);
      if (error) throw new Error('The notes were saved, but could not be opened.');
    }
    dialog.dispose();
  } else if (dialog.state.phase === 'error' && action === 'done') dialog.dispose();
}

export async function offerSessionNotes(id: string, parent: BrowserWindow | null): Promise<void> {
  if (running.has(id) || !parent || parent.isDestroyed()) return;
  running.add(id);
  const token = randomUUID();
  const state: SessionNotesDialog = { id: token, phase: 'confirm', courseName: '', day: '', recordings: 0 };
  const dispose = () => {
    const pending = dialogs.get(token);
    dialogs.delete(token); parent.removeListener('closed', dispose);
    pending?.answer?.(false);
  };
  const pending: PendingDialog = { parent, state, dispose };
  dialogs.set(token, pending); parent.once('closed', dispose);
  const send = () => {
    if (!parent.isDestroyed()) parent.webContents.send(IPC.evSessionNotesDialog, { ...state });
    else dispose();
  };
  try {
    const source = collectNotesSource({ list: listSessions, read: readSession }, id);
    if (!settings().get().sessions.autoSave || getProfile(source.profileId)?.sessions?.autoSave === false) { dispose(); return; }
    const config = JSON.parse(readFileSync(join(app.getPath('userData'), 'school-sync', 'config.json'), 'utf8')) as { courses: Record<string, string> };
    const courseDir = config.courses[source.profileId];
    if (!courseDir) throw new Error('No school folder is configured for this profile.');
    const path = notesDestination(courseDir, source);
    Object.assign(state, { courseName: source.profileName, day: source.day, recordings: source.sessionIds.length });
    const saved = await generateNotesAfterConfirmation(source, {
      confirm: () => new Promise<boolean>(resolve => { pending.answer = resolve; send(); }),
      generate: async request => {
        state.phase = 'working'; send();
        const key = `${source.profileId}/${source.day}`;
        const previous = generations.get(key) ?? Promise.resolve('');
        const generation = previous.catch(() => '').then(async () => {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), 180_000);
          let text = '';
          try {
            for await (const event of codexProvider.stream(request, { apiKey: null, signal: abort.signal })) {
              if (event.type === 'delta') text += event.text;
            }
            return text;
          } finally { clearTimeout(timer); }
        });
        generations.set(key, generation);
        try { return await generation; }
        finally { if (generations.get(key) === generation) generations.delete(key); }
      },
      save: notes => saveNotes(path, courseDir, source, notes),
    });
    if (saved) { pending.path = path; state.phase = 'saved'; send(); }
  } catch (error) {
    state.phase = 'error'; state.error = (error as Error).message; send();
  } finally { running.delete(id); }
}
