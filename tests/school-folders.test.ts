import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ root: '', course: '', cancel: false, set: vi.fn(), save: vi.fn(() => ({ ok: true })) }));
vi.mock('electron', () => ({ app: { getPath: () => state.root, once: vi.fn() }, dialog: { showOpenDialog: async () => ({ canceled: state.cancel, filePaths: [state.course] }) } }));
vi.mock('../src/main/services/profiles', () => ({ getProfile: () => ({ id: 'course-a', name: 'Course A' }), userDir: () => join(state.root, 'profiles'), saveProfile: state.save }));
vi.mock('../src/main/services/settings', () => ({ settings: () => ({ set: state.set }) }));
vi.mock('../src/main/services/sessions', () => ({ sessionsDir: () => join(state.root, 'sessions') }));
import { chooseSchoolFolder, schoolFolders } from '../src/main/services/school-folders';
beforeEach(() => {
  vi.clearAllMocks(); state.cancel = false;
  state.root = mkdtempSync(join(tmpdir(), 'school-folders-')); state.course = join(state.root, 'Course A');
  mkdirSync(state.course); mkdirSync(join(state.root, 'profiles'));
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
it('writes a user-selected course mapping and enables saving without changing model/provider settings', async () => {
  expect(await chooseSchoolFolder('course-a')).toBe(state.course);
  expect(schoolFolders()).toEqual({ 'course-a': state.course });
  expect(state.set).toHaveBeenCalledWith({ sessions: { autoSave: true } });
  expect(state.save).toHaveBeenCalledOnce();
  const config = JSON.parse(readFileSync(join(state.root, 'school-sync/config.json'), 'utf8'));
  expect(config.archiveDir).toBe(join(state.root, 'sessions'));
  expect(config.settingsFile).toBe(join(state.root, 'settings.json'));
});
it('does not enable saving or write any configuration when the folder picker is canceled', async () => {
  state.cancel = true;
  expect(await chooseSchoolFolder('course-a')).toBeNull();
  expect(state.set).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  expect(schoolFolders()).toEqual({});
});
