import { app, ipcMain, dialog } from 'electron';
import { IPC } from '../shared/ipc-contract';
import type { AnswerPayload, DeepPartial, Settings, QuestionBatch } from '../shared/types';
import { settings } from './services/settings';
import { setSecret, secretsStatus } from './services/secrets';
import {
  listProfiles,
  getProfile,
  getActiveProfile,
  saveProfile,
  deleteProfile,
  openProfilesFolder,
} from './services/profiles';
import { importKnowledgeFiles } from './services/knowledge';
import {
  recordEvent,
  listSessions,
  exportSession,
  deleteSession,
  openSessionsFolder,
  beginSession,
  searchSessions,
} from './services/sessions';
import { getLlmProvider, listLlmProviders, providerContext } from './services/llm/registry';
import { runAnswer, cancelAnswer } from './services/llm/run-answer';
import { getSttProvider, listSttProviders } from './services/stt/registry';
import { openSettingsWindow } from './windows/settings';
import { setPrivacyMode, minimizeOverlay } from './windows/overlay';
import { runDictationCleanup } from './services/dictation/cleanup';
import { insertText } from './services/insertion';
import { frontmostApp } from './services/insertion/paste-macos';
import { isAccessibilityTrusted } from './permissions';
import { finishDictation } from './dictation';
import { appendLogEvent } from './services/memory/log';
import { distillToday } from './services/memory/distill';
import { dataDir, userDataDir, iCloudDir, migrateDataDir } from './services/paths';
import { ingestNotes } from './services/notes/ingest';
import {
  launchAgentInstalled,
  installLaunchAgent,
  uninstallLaunchAgent,
} from './launch-agent';
import type { Namespace } from '../shared/types';
import { meetilyReader } from './services/stt/meetily';
import { stopLocalTranscription } from './services/stt/whisperlivekit';
import { withOverlayReplay } from './services/overlay-replay';
import { detectQuestions } from './services/question-detection';
import { getSecret } from './services/secrets';

const detections = new Set<AbortController>();

export function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settings().get());
  ipcMain.handle(IPC.settingsSet, (_e, patch: DeepPartial<Settings>) => {
    if (patch.stt?.provider === 'meetily') stopLocalTranscription();
    return settings().set(patch);
  });

  ipcMain.handle(IPC.secretsSet, (_e, id: string, value: string) => {
    setSecret(id, value);
    return secretsStatus();
  });
  ipcMain.handle(IPC.secretsStatus, () => secretsStatus());

  ipcMain.handle(IPC.profilesList, () => listProfiles());
  ipcMain.handle(IPC.profilesGet, (_e, id: string) => getProfile(id));
  ipcMain.handle(IPC.profilesGetActive, () => getActiveProfile());
  ipcMain.handle(IPC.profilesSave, (_e, profile: unknown) => saveProfile(profile));
  ipcMain.handle(IPC.profilesDelete, (_e, id: string) => deleteProfile(id));
  ipcMain.handle(IPC.knowledgeImport, () => importKnowledgeFiles());
  ipcMain.handle(IPC.profilesSetActive, (_e, id: string) => {
    cancelAnswer();
    for (const c of detections) c.abort();
    settings().set({ activeProfile: id });
    return getActiveProfile();
  });
  ipcMain.handle(IPC.profilesOpenFolder, () => openProfilesFolder());

  ipcMain.handle(IPC.providersList, () => ({
    llm: listLlmProviders(),
    stt: listSttProviders(),
  }));

  ipcMain.handle(IPC.modelsList, async (_e, providerId: string) => {
    const cfg = settings().get();
    return getLlmProvider(providerId).listModels(providerContext(providerId, cfg));
  });

  ipcMain.handle(IPC.providerVerify, async (_e, kind: 'llm' | 'stt', providerId: string) => {
    const cfg = settings().get();
    if (kind === 'stt') return getSttProvider(providerId).verify(cfg);
    return getLlmProvider(providerId).verify(providerContext(providerId, cfg));
  });

  ipcMain.handle(IPC.sttDescriptor, async () => {
    const cfg = settings().get();
    return withOverlayReplay(await getSttProvider(cfg.stt.provider).descriptor(cfg));
  });
  ipcMain.handle(IPC.meetilyPoll, (_event, reset: boolean) => {
    if (settings().get().stt.provider !== 'meetily') throw new Error('Meetily transcript mode is not selected');
    return meetilyReader.poll(reset === true);
  });

  // Dictation STT: single speaker (no diarization) + snappier endpointing so
  // finals land fast after the user stops talking.
  ipcMain.handle(IPC.sttDescriptorDictation, () => {
    const cfg = settings().get();
    if (cfg.stt.provider === 'meetily') throw new Error('Meetily shared transcripts are for the classroom overlay, not dictation.');
    return getSttProvider(cfg.stt.provider).descriptor({
      ...cfg,
      stt: { ...cfg.stt, diarize: false, endpointingMs: Math.min(cfg.stt.endpointingMs, 150) },
    });
  });

  ipcMain.handle(IPC.answerStart, (event, payload: AnswerPayload) => {
    // Fire and forget; results stream back as events to the caller.
    void runAnswer(event.sender, payload);
    return { ok: true };
  });
  ipcMain.handle(IPC.answerCancel, () => cancelAnswer());
  ipcMain.handle(IPC.questionsDetect, async (_e, batch: QuestionBatch) => {
    if (batch.profileId !== settings().get().activeProfile) throw new Error('Class changed');
    const key = getSecret('typesafe');
    if (!key) throw new Error('Add your TypeSafe key in Settings → Providers.');
    const controller = new AbortController(); detections.add(controller);
    try { return await detectQuestions(batch, key, controller.signal); }
    finally { detections.delete(controller); }
  });
  ipcMain.handle(IPC.questionsCancel, () => { for (const c of detections) c.abort(); detections.clear(); });

  // Dictation: renderer streams the raw STT buffer here for the cleanup pass.
  ipcMain.handle(IPC.dictationCleanup, (event, rawText: string) => {
    void runDictationCleanup(event.sender, rawText);
    return { ok: true };
  });
  // Insert cleaned text at the cursor (skips excluded front apps). After this,
  // the renderer reports done via dictationCancel to reset state + hide HUD.
  ipcMain.handle(IPC.dictationInsert, async (_e, text: string) => {
    const cfg = settings().get();
    const front = await frontmostApp();
    if (front && cfg.dictation.excludeApps.some((a) => a.toLowerCase() === front.toLowerCase())) {
      // Excluded app: skip insertion AND logging (Phase 1 privacy).
      return { pasted: false, reason: 'excluded-app' };
    }
    if (!isAccessibilityTrusted(false)) {
      isAccessibilityTrusted(true); // prompt
      return { pasted: false, reason: 'no-accessibility' };
    }
    const result = await insertText(text);
    // Feed the daily memory log (Phase 2). logToMemory gates this.
    if (cfg.dictation.logToMemory && text.trim()) {
      appendLogEvent({
        t: Date.now(),
        kind: 'dictation',
        ns: 'personal',
        app: front ?? undefined,
        text: text.trim(),
      });
    }
    return result;
  });
  ipcMain.handle(IPC.dictationCancel, () => finishDictation());
  ipcMain.handle(IPC.permAccessibility, () => isAccessibilityTrusted(true));

  ipcMain.handle(IPC.memoryDistill, () => distillToday());

  // Watched markdown sources (6.2): pick a folder/file → map to a namespace.
  ipcMain.handle(IPC.memoryAddSource, async (_e, ns: Namespace) => {
    const res = await dialog.showOpenDialog({
      title: 'Add a markdown source',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return settings().get();
    const sources = [...settings().get().memory.sources];
    for (const path of res.filePaths) {
      if (!sources.some((s) => s.path === path && s.ns === ns)) sources.push({ path, ns });
    }
    return settings().set({ memory: { sources } });
  });
  ipcMain.handle(IPC.memoryRemoveSource, (_e, path: string, ns: Namespace) => {
    const sources = settings()
      .get()
      .memory.sources.filter((s) => !(s.path === path && s.ns === ns));
    return settings().set({ memory: { sources } });
  });

  // Apple Notes ingestion + scheduler (6.3 / 6.4).
  ipcMain.handle(IPC.notesSyncNow, () => ingestNotes());
  ipcMain.handle(IPC.launchAgentStatus, () => ({ installed: launchAgentInstalled() }));
  ipcMain.handle(IPC.launchAgentInstall, () => installLaunchAgent());
  ipcMain.handle(IPC.launchAgentUninstall, () => uninstallLaunchAgent());

  // Configurable data dir / iCloud sync (Phase 4).
  ipcMain.handle(IPC.dataDirInfo, () => ({
    current: dataDir(),
    isDefault: !settings().get().dataDir,
    local: userDataDir(),
    iCloud: iCloudDir(),
  }));
  ipcMain.handle(IPC.dataDirSet, (_e, target: string) => {
    const old = dataDir();
    const resolved = target || userDataDir();
    if (resolved !== old) {
      const copied = migrateDataDir(old, resolved);
      console.log(`[paths] migrated [${copied.join(', ')}] from ${old} → ${resolved}`);
    }
    return settings().set({ dataDir: target });
  });

  ipcMain.handle(IPC.openSettings, () => openSettingsWindow());
  ipcMain.handle(IPC.setPrivacyMode, (_e, on: boolean) => setPrivacyMode(on));
  ipcMain.handle(IPC.overlayMinimize, () => minimizeOverlay());

  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform }));
  ipcMain.handle(IPC.quit, () => app.quit());

  // Sessions: transcript finals arrive fire-and-forget from the overlay.
  ipcMain.handle(IPC.sessionBegin, () => beginSession());
  ipcMain.on(IPC.sessionSpeaker, (_e, ev: { speaker: number | null; profileId: string; sessionId: string }) => {
    recordEvent({ t: Date.now(), type: 'speaker-label', label: 'Professor', speaker: ev.speaker, profileId: ev.profileId }, ev.sessionId);
  });
  ipcMain.on(IPC.sessionFinal, (_e, ev: { text: string; speaker: number; profileId: string; sessionId: string }) => {
    recordEvent({ t: Date.now(), type: 'final', text: ev.text, speaker: ev.speaker, profileId: ev.profileId }, ev.sessionId);
  });
  ipcMain.on(IPC.sessionQuestion, (_e, ev: { text: string; speaker: number; profileId: string; sessionId: string; questionId: string }) => {
    recordEvent({ t: Date.now(), type: 'question', text: ev.text, speaker: ev.speaker, profileId: ev.profileId, questionId: ev.questionId }, ev.sessionId);
  });
  ipcMain.on(IPC.sessionStatus, (_e, ev: { text: string; profileId: string; sessionId: string; questionId: string; status: 'cancelled' | 'error' | 'skipped' }) => {
    recordEvent({ t: Date.now(), type: 'answer-status', text: ev.text, profileId: ev.profileId, questionId: ev.questionId, status: ev.status }, ev.sessionId);
  });
  ipcMain.handle(IPC.sessionsSearch, (_e, profileId: string, query: string) => searchSessions(profileId, query));
  ipcMain.handle(IPC.sessionsList, () => listSessions());
  ipcMain.handle(IPC.sessionsExport, (_e, id: string) => exportSession(id));
  ipcMain.handle(IPC.sessionsDelete, (_e, id: string) => deleteSession(id));
  ipcMain.handle(IPC.sessionsOpenFolder, () => openSessionsFolder());
}
