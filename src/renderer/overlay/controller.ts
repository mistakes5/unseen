// Orchestrates STT → transcript → triggers → answer IPC → store updates.
// All the timing/in-flight rules ported from the original app live here.

import type { Usage } from '../../shared/types';
import { TranscriptStore } from './transcript-store';
import { evaluateTriggers } from './trigger-engine/engine';
import { SttClient } from './stt/client';
import { useOverlayStore } from './store';

const MIN_GAP_MS = 1500; // debounce between auto-answers (profile can raise)
const INFLIGHT_TIMEOUT_MS = 60_000; // allow Jev + Codex's 45s watchdog to finish

const transcript = new TranscriptStore();
let client: SttClient | null = null;
// The meeting overlay is on-demand: it does NOT listen until the user starts a
// session (no mic capture, no STT connection, no "reconnecting" churn at idle).
let listening = false;
let listeningLabel = 'listening';

let inFlight = false;
let inFlightSince = 0;
let lastQueryAt = 0;
let pendingRetry = false;
let answerSeq = 0;
let currentAnswerId: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function store() {
  return useOverlayStore.getState();
}

function pushTranscript(): void {
  store().setTranscript(transcript.turns(), transcript.interim);
}

async function maybeAnswer(opts: { force?: boolean; codeMode?: boolean } = {}): Promise<void> {
  const { force = false, codeMode = false } = opts;
  if (!listening || client?.paused) return;
  const profile = store().activeProfile;
  if (!profile) return;

  if (inFlight) {
    if (force) {
      // Ask Now always forces through: abandon the previous answer.
      await window.unseen.answerCancel();
      if (currentAnswerId !== null) {
        store().finishAnswer(currentAnswerId, { discard: true });
        currentAnswerId = null;
      }
      inFlight = false;
    } else if (Date.now() - inFlightSince > INFLIGHT_TIMEOUT_MS) {
      inFlight = false;
      currentAnswerId = null;
      store().setStatus(client?.paused ? 'paused' : 'live', client?.paused ? 'paused' : 'listening');
    } else {
      pendingRetry = true;
      return;
    }
  }

  const now = Date.now();
  const debounce = Math.max(MIN_GAP_MS, profile.triggers.debounce_ms);
  if (!force && now - lastQueryAt < debounce) {
    if (!retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      void maybeAnswer();
    }, debounce - (now - lastQueryAt));
    return;
  }

  let effectiveCodeMode = codeMode;
  if (!force) {
    if (!profile.triggers.auto || transcript.newText().length < profile.triggers.min_chars) return;
    const result = store().settings?.questionDetection.provider === 'jev'
      ? { fire: true, codeMode: false }
      : evaluateTriggers(profile.triggers, {
      newText: transcript.newText(),
      recentText: transcript.recentText(),
    });
    if (!result.fire) return;
    effectiveCodeMode = result.codeMode;
  }

  const fullTranscript = transcript.fullTranscript();
  if (!fullTranscript || fullTranscript.length < 15) return;
  const newSegment = transcript.newSegment(force ? 2 : 0);

  // Advance the pointer NOW so repeated Ask Now clicks don't resend the window.
  transcript.markAnswered();

  inFlight = true;
  inFlightSince = now;
  lastQueryAt = now;
  store().setStatus('thinking', 'thinking');

  currentAnswerId = ++answerSeq;
  store().beginAnswer(currentAnswerId);

  try {
    await window.unseen.answerStart({
      fullTranscript,
      newSegment,
      forced: force,
      codeMode: effectiveCodeMode,
      userSpeaker: transcript.userSpeaker(Date.now()),
    });
  } catch (err) {
    console.error('[overlay] answerStart failed', err);
    if (currentAnswerId !== null) {
      store().finishAnswer(currentAnswerId, { error: String(err) });
      currentAnswerId = null;
    }
    inFlight = false;
    store().setStatus('live', 'listening');
  }
}

function settleAnswer(opts: { error?: string; usage?: Usage | null }): void {
  inFlight = false;
  const paused = client?.paused ?? false;
  store().setStatus(!listening ? 'idle' : paused ? 'paused' : 'live', !listening ? 'stopped' : paused ? 'paused' : listeningLabel);

  if (currentAnswerId !== null) {
    const item = store().answers.find((a) => a.id === currentAnswerId);
    const trimmed = (item?.text ?? '').trim();
    const wasSkip = trimmed.toUpperCase() === 'SKIP';
    store().finishAnswer(currentAnswerId, {
      discard: wasSkip && !opts.error,
      error: opts.error,
      usage: opts.usage,
    });
    currentAnswerId = null;
  }
  if (pendingRetry) {
    pendingRetry = false;
    setTimeout(() => void maybeAnswer(), 100);
  }
}

export function askNow(): void {
  if (!listening) return;
  void maybeAnswer({ force: true });
}

export function togglePause(): boolean {
  // Pause only makes sense while a session is running.
  if (!listening) return false;
  const paused = client?.togglePause() ?? false;
  if (paused) {
    void window.unseen.answerCancel();
    if (currentAnswerId !== null) store().finishAnswer(currentAnswerId, { discard: true });
    currentAnswerId = null;
    inFlight = false;
    pendingRetry = false;
  }
  return paused;
}

export function isListening(): boolean {
  return listening;
}

/** A new course starts stopped with no previous room transcript or answer feed. */
export function resetClassroomSession(): void {
  if (listening) toggleListening();
  else void window.unseen.answerCancel();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  pendingRetry = false;
  inFlight = false;
  currentAnswerId = null;
  lastQueryAt = 0;
  transcript.finals = [];
  transcript.interim = '';
  transcript.answeredUpTo = 0;
  useOverlayStore.setState({ answers: [], usage: null, sessionCost: 0 });
  pushTranscript();
  store().setStatus('idle', 'course changed — press Start');
}

/** Start / stop a listening session. Returns the new listening state. */
export function toggleListening(): boolean {
  if (listening) {
    listening = false;
    client?.stop();
    void window.unseen.answerCancel();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    pendingRetry = false;
    if (currentAnswerId !== null) store().finishAnswer(currentAnswerId, { discard: true });
    currentAnswerId = null;
    inFlight = false;
    store().setStatus('idle', 'stopped');
  } else {
    listening = true;
    void client?.start();
  }
  return listening;
}

export async function initController(): Promise<void> {
  const s = useOverlayStore.getState();

  const [settings, profiles, active] = await Promise.all([
    window.unseen.settingsGet(),
    window.unseen.profilesList(),
    window.unseen.profilesGetActive(),
  ]);
  s.setSettings(settings);
  s.setProfiles(profiles);
  s.setActiveProfile(active);
  transcript.configure({
    windowChars: active.transcript?.window_chars ?? settings.transcript.windowChars,
    retentionMin: active.transcript?.retention_min ?? settings.transcript.retentionMin,
  });

  let lastSttConfig = JSON.stringify(settings.stt);
  let lastProfileId = active.id;
  window.unseen.onSettingsChanged(async (next) => {
    if (next.activeProfile !== lastProfileId) {
      lastProfileId = next.activeProfile;
      resetClassroomSession();
    }
    store().setSettings(next);
    const profile = await window.unseen.profilesGetActive();
    store().setActiveProfile(profile);
    transcript.configure({
      windowChars: profile.transcript?.window_chars ?? next.transcript.windowChars,
      retentionMin: profile.transcript?.retention_min ?? next.transcript.retentionMin,
    });
    // Mic device, language, diarization, or STT provider changed → reconnect,
    // but only if a session is actually running (don't wake an idle overlay).
    const sttConfig = JSON.stringify(next.stt);
    if (sttConfig !== lastSttConfig) {
      lastSttConfig = sttConfig;
      if (listening) {
        client?.stop();
        await client?.start();
      }
    }
  });
  window.unseen.onProfilesChanged((list) => store().setProfiles(list));

  window.unseen.onAnswerDelta((delta) => {
    if (currentAnswerId !== null) store().appendAnswer(currentAnswerId, delta);
  });
  window.unseen.onAnswerDone(({ usage }) => settleAnswer({ usage }));
  window.unseen.onAnswerError((err) => settleAnswer({ error: err }));
  window.unseen.onForceAnswer(() => askNow());
  window.unseen.onTogglePause(() => {
    togglePause();
  });

  client = new SttClient({
    onReset: () => {
      void window.unseen.answerCancel();
      if (currentAnswerId !== null) store().finishAnswer(currentAnswerId, { discard: true });
      currentAnswerId = null;
      inFlight = false;
      pendingRetry = false;
      transcript.finals = [];
      transcript.interim = '';
      transcript.answeredUpTo = 0;
      pushTranscript();
    },
    getDescriptor: () => window.unseen.sttDescriptor(),
    getMicDeviceId: () => store().settings?.stt.micDeviceId ?? 'default',
    onStatus: (status) => {
      switch (status.state) {
        case 'complete':
          listening = false;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = null;
          pendingRetry = false;
          store().setStatus('idle', status.message);
          break;
        case 'following':
          listeningLabel = status.message;
          if (!inFlight) store().setStatus('live', status.message);
          break;
        case 'connecting':
          store().setStatus('idle', 'connecting…');
          break;
        case 'live':
          listeningLabel = `listening — ${store().settings?.stt.provider ?? 'standalone'}`;
          store().setStatus('live', listeningLabel);
          break;
        case 'paused':
          store().setStatus('paused', 'paused');
          break;
        case 'reconnecting':
          store().setStatus('idle', 'reconnecting…');
          break;
        case 'error':
          store().setStatus('error', status.message);
          break;
      }
    },
    onEvent: (event) => {
      if (event.type === 'interim') {
        transcript.setInterim(event.text);
        pushTranscript();
        return;
      }
      transcript.addFinal({ t: Date.now(), text: event.text, speaker: event.speaker });
      window.unseen.sessionRecordFinal({ text: event.text, speaker: event.speaker });
      pushTranscript();
      void maybeAnswer();
    },
  });
  // On-demand: stay idle until the user presses Start (▶) in the overlay.
  store().setStatus('idle', 'stopped — press ▶ to start');
}
