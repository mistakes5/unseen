import { app, dialog } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { getProfile, saveProfile, userDir } from './profiles';
import { settings } from './settings';
import { sessionsDir } from './sessions';
import { syncSchoolTranscripts, type SchoolSyncConfig } from './school-transcript-sync.mjs';

function configPath() { return join(app.getPath('userData'), 'school-sync', 'config.json'); }
export function schoolFolders(): Record<string, string> {
  if (!existsSync(configPath())) return {};
  return (JSON.parse(readFileSync(configPath(), 'utf8')) as SchoolSyncConfig).courses ?? {};
}
export async function chooseSchoolFolder(profileId: string): Promise<string | null> {
  const profile = getProfile(profileId);
  if (!profile) throw new Error('Unknown course profile');
  if (profile.sessions?.autoSave === false) throw new Error('Saving is disabled for this profile. Enable it before choosing a course folder.');
  const result = await dialog.showOpenDialog({ title: `Save transcripts and notes for ${profile.name}`,
    buttonLabel: 'Use course folder', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = join(app.getPath('userData'), 'school-sync');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const previous = existsSync(configPath()) ? JSON.parse(readFileSync(configPath(), 'utf8')) : {};
  const config: SchoolSyncConfig = { ...previous, archiveDir: sessionsDir(), profileDir: userDir(),
    settingsFile: join(app.getPath('userData'), 'settings.json'), stateFile: join(root, 'state.json'),
    courses: { ...previous.courses, [profileId]: result.filePaths[0] } };
  // Built-ins need a user override so the standalone and packaged followers
  // honor the same explicit per-profile saving choice.
  if (!existsSync(join(userDir(), `${profileId}.yaml`))) {
    const saved = saveProfile(profile);
    if (!saved.ok) throw new Error(saved.error);
  }
  writeFileSync(configPath() + '.tmp', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  renameSync(configPath() + '.tmp', configPath());
  settings().set({ sessions: { autoSave: true } });
  return result.filePaths[0];
}
export function startSchoolFolderSync(): void {
  // Preserve an existing owner's installed follower; fresh installs need no
  // Node installation, source checkout or additional background service.
  if (existsSync(join(homedir(), 'Library/LaunchAgents/local.classroom.copilot.school-sync.plist'))) return;
  const sync = () => {
    if (!existsSync(configPath())) return;
    try {
      const result = syncSchoolTranscripts(JSON.parse(readFileSync(configPath(), 'utf8')));
      if (result.errors.length) console.error('[school-sync]', result.errors.join('; '));
    } catch { console.error('[school-sync] Could not sync course folders; check the configured folder permissions.'); }
  };
  sync(); const timer = setInterval(sync, 10_000); timer.unref();
  app.once('will-quit', () => { clearInterval(timer); sync(); });
}
