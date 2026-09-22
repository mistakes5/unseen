import type { SttDescriptor, TranscriptEvent } from '../../../shared/types';
import { getParser } from './parsers';
import { createSilentAudio } from './silent-audio';

// Generic streaming STT client: mic → MediaRecorder → vendor WebSocket.
// Provider-agnostic; vendor specifics come from the descriptor (built in main,
// so keys stay there) and the registered parser. Ports the battle-tested
// reconnect/keepalive/pause behavior from the original app:
//  - a single scheduleReconnect() path so a transient failure can never leave
//    us permanently silent, and reconnects never stack
//  - keepalive pings (Deepgram closes 1011 without audio in a ~10s window)
//  - the mic stream is released before reconnecting (a held device makes the
//    next getUserMedia throw → permanent silence)
//  - onerror never reconnects: onclose always follows and owns recovery

export type SttStatus =
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'paused' }
  | { state: 'reconnecting' }
  | { state: 'following'; message: string }
  | { state: 'complete'; message: string }
  | { state: 'error'; message: string };

export interface SttClientOpts {
  getDescriptor: () => Promise<SttDescriptor>;
  getMicDeviceId: () => string;
  onEvent: (e: TranscriptEvent) => void;
  onStatus: (s: SttStatus) => void;
  onReset?: () => void;
}

export class SttClient {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private _paused = false;
  private stopped = false;
  private generation = 0;
  private meetilyTimer: ReturnType<typeof setTimeout> | null = null;
  private replay: Awaited<ReturnType<typeof createSilentAudio>> | null = null;
  private replayEndTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: SttClientOpts) {}

  get paused(): boolean {
    return this._paused;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this._paused = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.cleanup();
  }

  togglePause(): boolean {
    this._paused = !this._paused;
    if (this._paused) {
      this.generation++;
      this.cleanup();
      this.opts.onStatus({ state: 'paused' });
    } else if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.opts.onStatus({ state: 'reconnecting' });
      try {
        if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      } catch {
        /* already stopped */
      }
      void this.connect();
    } else {
      this.opts.onStatus({ state: 'live' });
    }
    return this._paused;
  }

  private cleanup(): void {
    if (this.replayEndTimer) clearTimeout(this.replayEndTimer);
    this.replayEndTimer = null;
    this.replay?.dispose();
    this.replay = null;
    if (this.meetilyTimer) clearTimeout(this.meetilyTimer);
    this.meetilyTimer = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* already stopped */
    }
    this.recorder = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(delay: number): void {
    if (this.stopped || this._paused || this.reconnectTimer) return;
    this.opts.onStatus({ state: 'reconnecting' });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.cleanup();
    this.opts.onStatus({ state: 'connecting' });

    let descriptor: SttDescriptor;
    try {
      descriptor = await this.opts.getDescriptor();
      if (this.stopped || generation !== this.generation) return;
    } catch (err) {
      // Config error (e.g. missing key) — retrying won't help.
      this.opts.onStatus({ state: 'error', message: String((err as Error).message ?? err) });
      return;
    }
    if (descriptor.input === 'meetily') {
      await this.pollMeetily(generation, true);
      return; // Explicitly no getUserMedia, MediaRecorder, WebSocket or MLX spawn.
    }
    const parse = getParser(descriptor.providerId);

    try {
      if (descriptor.input === 'file-replay') {
        if (!descriptor.replay) throw new Error('Missing file replay audio');
        this.replay = await createSilentAudio(descriptor.replay.wavBase64);
        this.stream = this.replay.stream;
      } else {
        const deviceId = this.opts.getMicDeviceId();
        this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        });
      }
      if (this.stopped || generation !== this.generation) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.replay?.dispose();
        this.replay = null;
        return;
      }
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (descriptor.input === 'file-replay') {
        this.stop();
        this.opts.onStatus({ state: 'error', message: `Silent replay audio failed: ${e.message ?? 'decode error'}` });
        return;
      }
      console.error('[stt] getUserMedia failed:', e.name, e.message);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        // Permanent until the user acts — surface it instead of looping silently.
        this.opts.onStatus({
          state: 'error',
          message: 'Microphone blocked — allow it in System Settings → Privacy → Microphone, then Start again.',
        });
        return;
      }
      if (e.name === 'NotFoundError') {
        this.opts.onStatus({ state: 'error', message: 'No microphone found.' });
        return;
      }
      // Transient (device busy) — retry.
      this.scheduleReconnect(3000);
      return;
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder = recorder;

    const ws = new WebSocket(descriptor.wsUrl, descriptor.protocols);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      if (this.stopped || generation !== this.generation) return;
      if (!this._paused) this.opts.onStatus(descriptor.input === 'file-replay'
        ? { state: 'following', message: `SILENT FILE REPLAY — ${descriptor.replay?.label}` }
        : { state: 'live' });
      recorder.ondataavailable = (e) => {
        if (this._paused) return;
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          void e.data.arrayBuffer().then((buf) => {
            if (ws.readyState === WebSocket.OPEN && !this.stopped && !this._paused) ws.send(buf);
          });
        }
      };
      recorder.start(250);
      void this.replay?.start(() => {
        // Leave 3 seconds of silent stream to flush vendor endpointing/finals.
        this.replayEndTimer = setTimeout(() => {
          if (generation !== this.generation || this.stopped) return;
          this.stop();
          this.opts.onStatus({ state: 'complete', message: 'silent replay finished — stopped (no microphone)' });
        }, 3000);
      }).catch(() => {
        this.stop();
        this.opts.onStatus({ state: 'error', message: 'Could not start silent file audio' });
      });
    };

    ws.onmessage = (event) => {
      try {
        const parsed = parse(JSON.parse(event.data as string));
        if (parsed) this.opts.onEvent(parsed);
      } catch (err) {
        console.error('[stt] parse error', err);
      }
    };

    ws.onerror = () => {
      // onclose always follows and owns recovery — avoid double reconnects.
    };
    ws.onclose = (ev) => {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
      console.warn(`[stt] socket closed (code ${ev.code}${ev.reason ? `, ${ev.reason}` : ''})`);
      if (descriptor.input === 'file-replay') {
        this.stop();
        this.opts.onStatus({ state: 'error', message: `Replay connection closed (${ev.code}); press Stop, then Start to retry. No microphone was opened.` });
        return; // Never automatically re-upload a test file on reconnect.
      }
      if (this._paused) {
        this.opts.onStatus({ state: 'paused' });
        return;
      }
      // Deepgram signals auth/param errors with 4xxx (and 1008). Those won't
      // self-heal by retrying — surface them instead of looping forever.
      if (ev.code === 1008 || (ev.code >= 4000 && ev.code <= 4999)) {
        this.opts.onStatus({
          state: 'error',
          message: `Transcription rejected (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}) — check your Deepgram key in Settings.`,
        });
        return;
      }
      this.scheduleReconnect(2000);
    };

    if (descriptor.keepAlive) {
      const { intervalMs, payload } = descriptor.keepAlive;
      this.keepAliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }, intervalMs);
    }
  }

  private async pollMeetily(generation: number, reset = false): Promise<void> {
    if (this.stopped || this._paused || generation !== this.generation) return;
    try {
      const snapshot = await window.unseen.meetilyPoll(reset);
      if (this.stopped || this._paused || generation !== this.generation) return;
      if (snapshot.reset) this.opts.onReset?.();
      this.opts.onStatus({ state: 'following', message: snapshot.state === 'following'
        ? 'following Meetily — waiting for new transcript text'
        : 'waiting for a Meetily recording — start it in Meetily' });
      for (const event of snapshot.events) this.opts.onEvent(event);
    } catch {
      if (this.stopped || this._paused || generation !== this.generation) return;
      this.opts.onStatus({ state: 'following', message: 'waiting for readable Meetily transcript…' });
    }
    if (!this.stopped && !this._paused && generation === this.generation) {
      this.meetilyTimer = setTimeout(() => void this.pollMeetily(generation), 500);
    }
  }
}
