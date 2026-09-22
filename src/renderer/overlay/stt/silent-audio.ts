/** File audio routed only to a MediaStreamDestination, NEVER to speakers. */
export async function createSilentAudio(wavBase64: string) {
  const context = new AudioContext();
  try {
    const bytes = Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0));
    const buffer = await context.decodeAudioData(bytes.buffer);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const destination = context.createMediaStreamDestination();
    source.connect(destination); // Deliberately NOT context.destination.
    return {
      stream: destination.stream,
      async start(onEnded: () => void) {
        source.onended = onEnded;
        await context.resume();
        source.start();
      },
      dispose() {
        source.onended = null;
        try { source.stop(); } catch { /* not started */ }
        source.disconnect();
        for (const track of destination.stream.getTracks()) track.stop();
        void context.close();
      },
    };
  } catch (error) { await context.close(); throw error; }
}
