import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
const mocks = vi.hoisted(() => ({ stream: vi.fn(), save: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/private/test' }, shell: { openPath: vi.fn(async () => '') } }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), readFileSync: () => '{"courses":{"course-a":"/school/course-a"}}' }));
vi.mock('../src/main/services/settings', () => ({ settings: () => ({ get: () => ({ sessions: { autoSave: true } }) }) }));
vi.mock('../src/main/services/profiles', () => ({ getProfile: () => ({ sessions: { autoSave: true } }) }));
vi.mock('../src/main/services/sessions', () => ({ listSessions: () => [], readSession: () => [
  { type: 'start', t: 1792422000000, profileId: 'course-a', profileName: 'Course A' },
  { type: 'final', t: 1792422001000, profileId: 'course-a', speaker: 0, text: 'Synthetic speech.' },
] }));
vi.mock('../src/main/services/llm/codex', () => ({ codexProvider: { stream: mocks.stream } }));
vi.mock('../src/main/services/session-notes', async original => ({ ...await original<typeof import('../src/main/services/session-notes')>(),
  notesDestination: () => '/school/course-a/notes.md', saveNotes: mocks.save }));
import { offerSessionNotes, respondToNotesDialog } from '../src/main/services/session-notes-ui';
beforeEach(() => { vi.clearAllMocks(); mocks.stream.mockImplementation(async function* () {
  yield { type: 'delta', text: '# Notes\n\nA grounded explanation of the synthetic speech.' }; yield { type: 'done' };
}); });
function setup() {
  const send = vi.fn();
  const parent = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { id: 9, send } });
  const job = offerSessionNotes('course-a/recording', parent as unknown as BrowserWindow);
  return { parent, send, job, token: send.mock.calls[0][1].id as string };
}
it('does not generate before confirmation, rejects another window, and honors Not now', async () => {
  const { job, send, token } = setup();
  expect(send.mock.calls[0][1].phase).toBe('confirm');
  expect(mocks.stream).not.toHaveBeenCalled();
  await respondToNotesDialog({ id: 99 } as WebContents, token, 'create');
  expect(mocks.stream).not.toHaveBeenCalled();
  await respondToNotesDialog({ id: 9 } as WebContents, token, 'cancel');
  await job; expect(mocks.stream).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it('sends matching progress and saved states after Create, and clears the dialog on Done', async () => {
  const { job, send, token, parent } = setup();
  await respondToNotesDialog({ id: 9 } as WebContents, token, 'create'); await job;
  expect(send.mock.calls.map(call => call[1].phase)).toEqual(['confirm', 'working', 'saved']);
  expect(mocks.stream.mock.calls[0][0]).toMatchObject({ model: 'gpt-6.1-sol', reasoningEffort: 'low' });
  expect(mocks.save).toHaveBeenCalledOnce();
  await respondToNotesDialog({ id: 9 } as WebContents, token, 'done');
  expect(parent.listenerCount('closed')).toBe(0);
});
