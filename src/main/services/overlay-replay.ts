import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve } from 'node:path';
import type { SttDescriptor } from '../../shared/types';
const execFileAsync = promisify(execFile);
let cached: Promise<{ wavBase64: string; label: string }> | undefined;

/** Launch-only opt-in, never persistent. Normal launches still use the mic. */
export async function withOverlayReplay(descriptor: SttDescriptor): Promise<SttDescriptor> {
  const at = process.argv.indexOf('--overlay-replay-file');
  if (at < 0) return descriptor;
  if (!process.argv.includes('--allow-cloud-replay')) throw new Error('Replay needs explicit cloud opt-in');
  if (descriptor.input === 'meetily') throw new Error('Choose standalone Deepgram or Local MLX for file replay');
  const path = process.argv[at + 1];
  if (!path || path.startsWith('--')) throw new Error('Missing replay audio path');
  const startAt = process.argv.indexOf('--replay-start');
  const start = startAt < 0 ? 0 : Number(process.argv[startAt + 1]);
  if (!Number.isFinite(start) || start < 0) throw new Error('Invalid replay offset');
  const durationAt = process.argv.indexOf('--replay-duration');
  const duration = durationAt < 0 ? 120 : Number(process.argv[durationAt + 1]);
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) throw new Error('Replay duration must be 1–120 seconds');
  cached ??= execFileAsync('/opt/homebrew/bin/ffmpeg', [
    '-v', 'error', '-ss', String(start), '-i', resolve(path), '-t', String(duration),
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 8_000_000, timeout: 30000 }).then(({ stdout }) => ({
    wavBase64: stdout.toString('base64'), label: `${basename(path)} · ${start}s–${start + duration}s`,
  }));
  return { ...descriptor, input: 'file-replay', replay: await cached };
}
