import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ silent: vi.fn() }));
vi.mock('../src/renderer/overlay/stt/silent-audio', () => ({ createSilentAudio: mocks.silent }));
import { SttClient } from '../src/renderer/overlay/stt/client';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instances.push(this); }
}
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported() { return true; }
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  start = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => { this.state = 'inactive'; });
  constructor() { Recorder.instances.push(this); }
}
describe('standalone audio -> recorder -> socket -> transcript', () => {
  const poll = vi.fn(), getUserMedia = vi.fn(), stop = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); Socket.instances = []; Recorder.instances = [];
    vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal('window', { unseen: { meetilyPoll: poll } });
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('standalone microphone does not consult Meetily and delivers a final', async () => {
    const onEvent = vi.fn();
    const client = new SttClient({ getDescriptor: async () => ({ providerId: 'deepgram', wsUrl: 'wss://example.test' }), getMicDeviceId: () => 'default', onEvent, onStatus: vi.fn() });
    await client.start(); Socket.instances[0].onopen!();
    expect(getUserMedia).toHaveBeenCalledOnce();
    Recorder.instances[0].ondataavailable!({ data: new Blob(['audio']) });
    await new Promise(r => setTimeout(r, 0));
    expect(Socket.instances[0].send).toHaveBeenCalledOnce();
    Socket.instances[0].onmessage!({ data: JSON.stringify({ is_final: true, channel: { alternatives: [{ transcript: 'What is a straw man?' }] } }) });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'final', text: 'What is a straw man?' }));
    expect(poll).not.toHaveBeenCalled();
    client.stop(); expect(stop).toHaveBeenCalledOnce();
  });
  it('file replay uses the same recorder/socket, never mic or Meetily, and ends', async () => {
    vi.useFakeTimers();
    const start = vi.fn().mockResolvedValue(undefined), dispose = vi.fn(), onStatus = vi.fn();
    mocks.silent.mockResolvedValue({ stream: { getTracks: () => [] }, start, dispose });
    const client = new SttClient({ getDescriptor: async () => ({ providerId: 'deepgram', input: 'file-replay', replay: { wavBase64: 'test', label: 'test lecture' }, wsUrl: 'wss://example.test' }), getMicDeviceId: () => 'default', onEvent: vi.fn(), onStatus });
    await client.start(); Socket.instances[0].onopen!();
    expect(Recorder.instances[0].start).toHaveBeenCalledWith(250);
    expect(start).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled(); expect(poll).not.toHaveBeenCalled();
    start.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(3000);
    expect(dispose).toHaveBeenCalledOnce();
    expect(Socket.instances[0].close).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'complete' }));
  });
});
