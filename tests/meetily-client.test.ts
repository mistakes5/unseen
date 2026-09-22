import { afterEach, describe, expect, it, vi } from 'vitest';
import { SttClient } from '../src/renderer/overlay/stt/client';

describe('Meetily mode never captures audio', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('polls new text without opening microphone/socket and stops cleanly', async () => {
    vi.useFakeTimers();
    const getUserMedia = vi.fn();
    const websocket = vi.fn();
    const poll = vi.fn().mockResolvedValueOnce({ reset: true, state: 'following', events: [] })
      .mockResolvedValue({ reset: false, state: 'following', events: [{ type: 'final', text: 'Synthetic question?', speaker: 0 }] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('WebSocket', websocket);
    vi.stubGlobal('window', { unseen: { meetilyPoll: poll } });
    const onEvent = vi.fn(), onReset = vi.fn();
    const client = new SttClient({ getDescriptor: async () => ({ providerId: 'meetily', input: 'meetily', wsUrl: '' }), getMicDeviceId: () => 'default', onEvent, onReset, onStatus: vi.fn() });
    await client.start();
    expect(onReset).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(onEvent).toHaveBeenCalledWith({ type: 'final', text: 'Synthetic question?', speaker: 0 });
    client.stop();
    const calls = poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(calls);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(websocket).not.toHaveBeenCalled();
  });
});
