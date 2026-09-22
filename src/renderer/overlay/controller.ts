// Independent listening, batched question detection, and two answer slots.
import type { AnswerPayload, QuestionCandidate, Usage } from '../../shared/types';
import { TranscriptStore } from './transcript-store';
import { evaluateTriggers } from './trigger-engine/engine';
import { SttClient } from './stt/client';
import { useOverlayStore } from './store';
import { AnswerQueue, questionSpans } from './question-queue';

const transcript = new TranscriptStore();
let client: SttClient | null = null;
let listening = false;
let accepting = false; // file EOF may stop audio while the answer queue drains
let listeningLabel = 'listening';
let sessionId = '';
let epoch = 0;
let seq = 0;
let detecting = false;
let candidates: (QuestionCandidate & { receivedAt: number })[] = [];
let detectionTimer: ReturnType<typeof setTimeout> | null = null;
const payloads = new Map<string, AnswerPayload>();
const expansions = new Map<string, string>();
const seen = new Map<string, number>();
function store() { return useOverlayStore.getState(); }
function pushTranscript(): void { store().setTranscript(transcript.turns(), transcript.interim); }
function status(): void {
  const paused = client?.paused ?? false;
  const live = listening && !paused;
  const count = `${queue.running} answering · ${queue.pending} queued${detecting || candidates.length ? ' · checking questions' : ''}`;
  store().setStatus(queue.running ? 'thinking' : paused ? 'paused' : live ? 'live' : 'idle',
    `${live ? listeningLabel : paused ? 'paused' : 'stopped'}${queue.running || queue.pending || detecting ? ` · ${count}` : ''}`);
}
function recordStatus(id: string, state: 'cancelled' | 'error' | 'skipped', text: string): void {
  const payload = payloads.get(id);
  if (payload?.profileId) window.unseen.sessionRecordStatus({ questionId: id,
    profileId: payload.profileId, sessionId: payload.sessionId ?? '', status: state, text });
}
const queue = new AnswerQueue(q => {
  const payload = payloads.get(q.id);
  if (!payload) { queue.finish(q.id); return; }
  const parent = expansions.get(q.id);
  if (parent) store().patchExpansion(parent, { phase: 'answering' });
  else store().setAnswerPhase(q.id, 'answering');
  status();
  void window.unseen.answerStart(payload).catch(error => settle(q.id, { error: String(error) }));
});

function settle(id: string, opts: { error?: string; usage?: Usage | null }): void {
  if (!queue.has(id)) return; // stale completion from stopped/previous course
  const parent = expansions.get(id);
  if (parent) {
    const text = store().answers.find(a => a.id === parent)?.expansion?.text.trim();
    const error = opts.error || (!text || text.toUpperCase() === 'SKIP' ? 'No expansion generated. Try again.' : undefined);
    store().patchExpansion(parent, { phase: error ? 'error' : 'done', error });
    store().expansionUsage(opts.usage);
    if (error) recordStatus(id, 'error', error);
    expansions.delete(id); payloads.delete(id); queue.finish(id); status(); return;
  }
  const text = store().answers.find(a => a.id === id)?.text.trim() ?? '';
  const skipped = !opts.error && (!text || text.toUpperCase() === 'SKIP');
  store().finishAnswer(id, opts);
  if (skipped) {
    store().setAnswerPhase(id, 'skipped');
    recordStatus(id, 'skipped', 'The answer model skipped this question.');
  } else if (opts.error) recordStatus(id, 'error', opts.error);
  payloads.delete(id);
  queue.finish(id); status();
}

function enqueue(q: QuestionCandidate, forced = false): void {
  const profile = store().activeProfile;
  if (!profile || !accepting) return;
  const key = q.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 30_000) seen.delete(k);
  if (!forced && seen.has(key)) return;
  seen.set(key, now);
  q.priority = q.speaker === store().professorSpeaker ? 1 : 0;
  payloads.set(q.id, { requestId: q.id, profileId: profile.id, sessionId,
    question: q.text, speaker: q.speaker, fullTranscript: q.context,
    newSegment: `[S${q.speaker}] ${q.text}`, forced, detected: true, codeMode: false, userSpeaker: 0 });
  const preceding = q.priorContext?.replace(/\[S\d+\]\s*/g, '').trim();
  store().beginAnswer(q.id, q.text, q.speaker, preceding
    ? `${preceding.length > 240 ? '…' : ''}${preceding.slice(-240)}` : undefined);
  window.unseen.sessionRecordQuestion({ text: q.text, speaker: q.speaker,
    profileId: profile.id, sessionId, questionId: q.id });
  queue.enqueue(q); status();
}

function scheduleDetection(): void {
  if (!accepting || detecting || !candidates.length) return;
  if (detectionTimer) clearTimeout(detectionTimer);
  // Allow a short continuation, but never debounce continuous speech forever.
  const remaining = Math.max(0, candidates[0].receivedAt + 2200 - Date.now());
  detectionTimer = setTimeout(() => { detectionTimer = null; void detectPending(); }, Math.min(750, remaining));
}
async function detectPending(): Promise<void> {
  const profile = store().activeProfile;
  if (!accepting || detecting || !profile || !candidates.length) return;
  const batch = candidates.splice(0, 12).map(c => ({ ...c, context: transcript.fullTranscript() }));
  const generation = epoch;
  detecting = true; status();
  try {
    const results = store().settings?.questionDetection.provider === 'jev'
      ? await window.unseen.questionsDetect({ profileId: profile.id, sessionId, candidates: batch })
      : batch.map(c => ({ id: c.id, probability: evaluateTriggers(profile.triggers, { newText: c.text, recentText: c.context }).fire ? 1 : 0 }));
    if (generation !== epoch || !accepting) return;
    const threshold = store().settings?.questionDetection.threshold ?? 0.8;
    store().addDetectionChecks(batch.map(c => ({ id: c.id, text: c.text,
      probability: results.find(r => r.id === c.id)!.probability, threshold,
      passed: results.find(r => r.id === c.id)!.probability >= threshold })));
    const accepted = batch.filter(c => results.some(r => r.id === c.id && r.probability >= threshold));
    // Professor candidates take available slots first, while cards retain speech order.
    accepted.sort((a, b) => Number(b.speaker === store().professorSpeaker) - Number(a.speaker === store().professorSpeaker));
    for (const q of accepted) enqueue(q);
  } catch (error) {
    if (generation !== epoch || !accepting) return;
    // Preserve failures visibly instead of silently losing a batch. No paid fallback.
    for (const q of batch) {
      store().beginAnswer(q.id, q.text, q.speaker);
      store().finishAnswer(q.id, { error: `Question check failed: ${String(error)}. Use Ask now to retry the latest speech.` });
    }
  } finally {
    if (generation === epoch) { detecting = false; status(); scheduleDetection(); }
  }
}

function cancelWork(): void {
  epoch++; accepting = false;
  if (detectionTimer) clearTimeout(detectionTimer);
  detectionTimer = null; detecting = false; candidates = [];
  void window.unseen.questionsCancel?.();
  void window.unseen.answerCancel();
  for (const q of queue.clear()) {
    recordStatus(q.id, 'cancelled', 'Listening stopped, paused, or course changed.');
    const parent = expansions.get(q.id);
    if (parent) store().patchExpansion(parent, { phase: 'error', error: 'Expansion cancelled. You can retry.' });
    else { store().finishAnswer(q.id, {}); store().setAnswerPhase(q.id, 'cancelled'); }
  }
  payloads.clear(); expansions.clear();
}

export function expandAnswer(answerId: string | number): void {
  const answer = store().answers.find(a => a.id === answerId);
  const profile = store().activeProfile;
  if (!profile || !answer?.done || answer.phase !== 'done' || !answer.text.trim()) return;
  if (answer.expansion?.phase === 'queued' || answer.expansion?.phase === 'answering') return;
  if (answer.expansion?.phase === 'done') {
    store().patchExpansion(answerId, { visible: !answer.expansion.visible }); return;
  }
  const id = `${epoch}-expand-${++seq}`;
  expansions.set(id, String(answerId));
  payloads.set(id, { requestId: id, expandAnswerId: String(answerId), profileId: profile.id,
    sessionId, question: answer.question, fullTranscript: '', newSegment: '', forced: true, detected: true, codeMode: false, userSpeaker: 0 });
  store().patchExpansion(answerId, { text: '', phase: 'queued', error: undefined, visible: true });
  queue.enqueue({ id, text: answer.question ?? '', speaker: answer.speaker ?? 0, context: '', priority: -1 });
  status();
}

export function askNow(): void {
  if (!listening || client?.paused) return;
  const last = transcript.finals.at(-1);
  if (!last) return;
  enqueue({ id: `${epoch}-${++seq}`, text: last.text, speaker: last.speaker, context: transcript.fullTranscript() }, true);
}

export function setProfessorSpeaker(speaker: number | null): void {
  if (store().professorSpeaker !== speaker && sessionId && listening && store().activeProfile) {
    window.unseen.sessionSpeaker?.({ speaker, sessionId, profileId: store().activeProfile!.id });
  }
  useOverlayStore.setState({ professorSpeaker: speaker });
  queue.prioritize(speaker);
}

export function togglePause(): boolean {
  if (!listening) return false;
  const paused = client?.togglePause() ?? false;
  if (paused) cancelWork(); else accepting = true;
  status(); return paused;
}
export function isListening(): boolean { return listening; }
export function resetClassroomSession(): void {
  if (listening) { listening = false; client?.stop(); }
  cancelWork(); sessionId = ''; seen.clear();
  transcript.finals = []; transcript.interim = ''; transcript.answeredUpTo = 0;
  useOverlayStore.setState({ answers: [], usage: null, sessionCost: 0, professorSpeaker: null, detectionChecks: [], detectionCount: 0 });
  pushTranscript(); store().setStatus('idle', 'course changed — press Start');
}

export function toggleListening(): boolean {
  if (listening) {
    listening = false; client?.stop(); cancelWork(); status();
  } else {
    cancelWork();
    sessionId = '';
    listening = true; accepting = true; seen.clear();
    useOverlayStore.setState({ answers: [], usage: null, sessionCost: 0, sessionError: null, detectionChecks: [], detectionCount: 0 });
    transcript.finals = []; transcript.interim = ''; transcript.answeredUpTo = 0; pushTranscript();
    setProfessorSpeaker(null);
    const generation = epoch;
    store().setStatus('idle', 'starting session');
    void window.unseen.sessionBegin().then(id => {
      if (!listening || generation !== epoch) return;
      sessionId = id; return client?.start();
    }).catch(error => {
      if (generation !== epoch) return;
      listening = false; accepting = false;
      store().setStatus('error', `Could not start saved session: ${String(error)}`);
    });
  }
  return listening;
}

export async function initController(): Promise<void> {
  const [settings, profiles, active] = await Promise.all([
    window.unseen.settingsGet(), window.unseen.profilesList(), window.unseen.profilesGetActive(),
  ]);
  store().setSettings(settings); store().setProfiles(profiles); store().setActiveProfile(active);
  transcript.configure({ windowChars: active.transcript?.window_chars ?? settings.transcript.windowChars,
    retentionMin: active.transcript?.retention_min ?? settings.transcript.retentionMin });
  let lastSttConfig = JSON.stringify(settings.stt), lastProfileId = active.id;
  window.unseen.onSettingsChanged(async next => {
    if (next.activeProfile !== lastProfileId) { lastProfileId = next.activeProfile; resetClassroomSession(); }
    store().setSettings(next);
    const profile = await window.unseen.profilesGetActive();
    if (profile.id !== lastProfileId) return;
    store().setActiveProfile(profile);
    transcript.configure({ windowChars: profile.transcript?.window_chars ?? next.transcript.windowChars,
      retentionMin: profile.transcript?.retention_min ?? next.transcript.retentionMin });
    const sttConfig = JSON.stringify(next.stt);
    if (sttConfig !== lastSttConfig) {
      lastSttConfig = sttConfig; setProfessorSpeaker(null);
      if (listening) { client?.stop(); await client?.start(); }
    }
  });
  window.unseen.onProfilesChanged(list => store().setProfiles(list));
  window.unseen.onAnswerDelta(({ requestId, text }) => {
    if (!queue.has(requestId)) return;
    const parent = expansions.get(requestId);
    if (parent) {
      const previous = store().answers.find(a => a.id === parent)?.expansion?.text ?? '';
      store().patchExpansion(parent, { text: previous + text });
    } else store().appendAnswer(requestId, text);
  });
  window.unseen.onAnswerDone(({ requestId, usage }) => { if (requestId) settle(requestId, { usage }); });
  window.unseen.onAnswerError(({ requestId, error }) => settle(requestId, { error }));
  window.unseen.onSessionError(error => useOverlayStore.setState({ sessionError: error }));
  window.unseen.onForceAnswer(() => askNow());
  window.unseen.onTogglePause(() => { togglePause(); });
  client = new SttClient({
    onReset: () => {
      cancelWork(); accepting = listening;
      transcript.finals = []; transcript.interim = ''; transcript.answeredUpTo = 0;
      setProfessorSpeaker(null); pushTranscript();
    },
    getDescriptor: () => window.unseen.sttDescriptor(),
    getMicDeviceId: () => store().settings?.stt.micDeviceId ?? 'default',
    onStatus: s => {
      switch (s.state) {
        case 'complete': listening = false; listeningLabel = s.message; status(); break;
        case 'following': listeningLabel = s.message; status(); break;
        case 'connecting': setProfessorSpeaker(null); store().setStatus('idle', 'connecting'); break;
        case 'live': listeningLabel = `listening — ${store().settings?.stt.provider ?? 'standalone'}`; status(); break;
        case 'paused': store().setStatus('paused', 'paused'); break;
        case 'reconnecting': setProfessorSpeaker(null); store().setStatus('idle', 'reconnecting — reassign professor after reconnect'); break;
        case 'error': store().setStatus('error', s.message); break;
      }
    },
    onEvent: event => {
      if (event.type === 'interim') { transcript.setInterim(event.text); pushTranscript(); scheduleDetection(); return; }
      const profile = store().activeProfile;
      if (!profile) return;
      window.unseen.sessionRecordFinal({ text: event.text, speaker: event.speaker, profileId: profile.id, sessionId });
      for (const text of questionSpans(event.text)) {
        for (const pending of candidates) pending.followingContext = `${pending.followingContext ?? ''} [S${event.speaker}] ${text}`.trim().slice(-2500);
        const priorContext = transcript.fullTranscript();
        transcript.addFinal({ t: Date.now(), text, speaker: event.speaker });
        if (accepting && profile.triggers.auto && text.length >= 4) candidates.push({
          id: `${epoch}-${++seq}`, text, speaker: event.speaker, context: transcript.fullTranscript(), priorContext, receivedAt: Date.now(),
        });
      }
      pushTranscript(); scheduleDetection();
    },
  });
  store().setStatus('idle', 'stopped — press ▶ to start');
}
