import 'dotenv/config';
import { app, BrowserWindow, session, systemPreferences, safeStorage } from 'electron';
import { registerIpc } from './ipc';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { createOverlay } from './windows/overlay';
import { createDictationHud } from './windows/dictation-hud';
import { openSettingsWindow } from './windows/settings';
import { initProfiles, disposeProfiles, listProfiles, getProfile } from './services/profiles';
import { loadKnowledge } from './services/knowledge';
import { getSecret, setSecret } from './services/secrets';
import { getLlmProvider } from './services/llm/registry';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { settings } from './services/settings';
import { ingestNotes } from './services/notes/ingest';
import { distillToday } from './services/memory/distill';
import { join } from 'node:path';
import { stopLocalTranscription } from './services/stt/whisperlivekit';

// Keep this classroom fork separate from any existing Unseen installation.
app.setName('Classroom Copilot');
app.setPath('userData', join(app.getPath('appData'), 'Classroom Copilot'));
if (!app.requestSingleInstanceLock()) app.quit();

// Headless scheduler entry: the LaunchAgent relaunches us with `--sync` to run
// Notes ingestion + distillation without opening any window, then quit.
const SYNC_MODE = process.argv.includes('--sync');

async function runHeadlessSync(): Promise<void> {
  try {
    await ingestNotes();
    await distillToday();
  } catch (err) {
    console.error('[sync] headless run failed', err);
  }
}

app.whenReady().then(async () => {
  if (process.argv.includes('--use-standalone-deepgram')) {
    settings().set({ stt: { provider: 'deepgram' } });
    stopLocalTranscription();
  }
  if (process.argv.includes('--overlay-replay-file')) console.info('[overlay-replay] Silent input enabled; microphone permission:', systemPreferences.getMediaAccessStatus('microphone'));
  if (process.argv.includes('--silent-replay-file')) {
    try {
      initProfiles();
      const { runSilentReplay } = await import('./services/silent-replay');
      await runSilentReplay();
    } catch (error) {
      console.error('[replay]', (error as Error).message);
      process.exitCode = 1;
    } finally { app.quit(); }
    return;
  }
  if (process.argv.includes('--use-meetily-transcript')) settings().set({ stt: { provider: 'meetily' } });
  // Explicit local setup command: import the existing macOS Keychain entry
  // directly into this app's encrypted vault. Never expose it through IPC/argv.
  if (process.argv.includes('--configure-codex-classroom')) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
      const key = execFileSync('/usr/bin/security', [
        'find-generic-password', '-a', userInfo().username, '-s', 'TYPESAFE_API_KEY', '-w',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 }).trim();
      if (!key) throw new Error('Keychain entry empty');
      settings().set({ llm: { provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'low', fallbacks: [] }, questionDetection: { provider: 'jev' } });
      setSecret('typesafe', key);
      console.info('[setup] Codex configured; TypeSafe key imported into encrypted storage.');
    } catch {
      console.error('[setup] Could not import TypeSafe key from macOS Keychain.');
    }
  }
  if (SYNC_MODE) {
    await runHeadlessSync();
    app.quit();
    return;
  }

  // Microphone access for the renderer's getUserMedia. Two layers must say yes:
  //  1. Electron's permission handler (below), and
  //  2. on macOS, the OS itself — which only prompts if we explicitly call
  //     askForMediaAccess. Without it, getUserMedia returns NotAllowedError and
  //     the STT client loops "reconnecting".
  const allowMedia = (permission: string): boolean =>
    permission === 'media' || permission === 'microphone' || permission === 'audioCapture';

  const ensureMicAccess = async (): Promise<boolean> => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    // 'denied'/'restricted' won't re-prompt — the user must flip it in System
    // Settings; the renderer surfaces that message. 'not-determined' → prompt.
    if (status === 'denied' || status === 'restricted') return false;
    return systemPreferences.askForMediaAccess('microphone');
  };

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (!allowMedia(permission)) {
      callback(false);
      return;
    }
    void ensureMicAccess().then(callback);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  initProfiles();
  // Warm only prepared bundles locally. No network, LLM call, or index search.
  for (const summary of listProfiles()) {
    const profile = getProfile(summary.id)!;
    if (profile.knowledge.files.length && profile.knowledge.files.every(f => f.endsWith('.context.json'))) loadKnowledge(profile);
  }
  registerIpc();
  createOverlay();
  // Create the dictation HUD hidden at startup so its controller is already
  // listening when the hotkey fires (no renderer-load race).
  createDictationHud();
  registerShortcuts();

  // First run (wizard not completed) or missing transcription key:
  // take the user straight to setup.
  if (!settings().get().onboarded ||
      (getLlmProvider(settings().get().llm.provider).needsApiKey && !getSecret(settings().get().llm.provider)) ||
      (settings().get().questionDetection.provider === 'jev' && !getSecret('typesafe'))) openSettingsWindow();

  // macOS dock click with no windows → recreate the overlay.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay();
  });
});

app.on('will-quit', () => {
  stopLocalTranscription();
  unregisterShortcuts();
  disposeProfiles();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
