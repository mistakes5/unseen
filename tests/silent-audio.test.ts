import { afterEach, describe, it, expect, vi } from 'vitest';
import { createSilentAudio } from '../src/renderer/overlay/stt/silent-audio';

describe('silent file audio routing', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('connects to a stream, never to the speaker output, and disposes tracks', async () => {
    const stopTrack = vi.fn();
    const destination = { stream: { getTracks: () => [{ stop: stopTrack }] } };
    const source = { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const context = { destination: { speakers: true }, decodeAudioData: vi.fn().mockResolvedValue({}), createBufferSource: () => source,
      createMediaStreamDestination: () => destination, resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    const audio = await createSilentAudio(btoa('test'));
    expect(source.connect).toHaveBeenCalledExactlyOnceWith(destination);
    expect(source.connect).not.toHaveBeenCalledWith(context.destination);
    await audio.start(vi.fn());
    expect(source.start).toHaveBeenCalledOnce();
    audio.dispose();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
