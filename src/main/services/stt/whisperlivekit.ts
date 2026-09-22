import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { SttProvider } from './provider';

const root = process.env.CLASSROOM_WLK_DIR || join(homedir(), 'Developer/classroom-whisperlivekit');
const base = 'http://127.0.0.1:8178';
let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    const body = await response.json() as { status?: string };
    return response.ok && body.status === 'ok';
  } catch { return false; }
}

export function stopLocalTranscription(): void {
  child?.kill('SIGTERM');
  child = null;
}

async function ensureServer(): Promise<void> {
  if (await healthy()) return;
  if (starting) return starting;
  starting = (async () => {
    const bin = join(root, '.venv/bin/wlk');
    if (!existsSync(bin)) throw new Error(`Local transcription is not installed at ${root}`);
    const proc = spawn(bin, [
      '--host', '127.0.0.1', '--port', '8178',
      '--backend', 'mlx-whisper', '--model', 'large-v3-turbo',
      '--language', 'en', '--backend-policy', 'localagreement',
      '--log-level', 'WARNING',
    ], { cwd: root, env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH || ''}` }, stdio: ['ignore', 'ignore', 'pipe'] });
    child = proc;
    let failure = '';
    proc.on('error', (error) => { failure = error.message; });
    proc.stderr?.on('data', (chunk: Buffer) => {
      // Keep diagnostics bounded. Do not log classroom transcripts.
      failure = (failure + chunk.toString()).slice(-2000);
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await healthy()) return;
      if (proc.exitCode !== null || proc.signalCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    proc.kill('SIGTERM');
    if (child === proc) child = null;
    throw new Error(`Local MLX server could not start. ${failure.slice(-800)}`);
  })().finally(() => { starting = null; });
  return starting;
}

export const whisperLiveKitProvider: SttProvider = {
  id: 'whisperlivekit',
  displayName: 'Local MLX Whisper Turbo (no transcription fee)',
  needsApiKey: false,
  async descriptor(settings) {
    await ensureServer();
    const params = new URLSearchParams({ language: settings.stt.language || 'en', interim_results: 'true', endpointing: String(settings.stt.endpointingMs) });
    return { providerId: 'whisperlivekit', wsUrl: `ws://127.0.0.1:8178/v1/listen?${params}` };
  },
  async verify() {
    try { await ensureServer(); return { ok: true, message: 'Local MLX Turbo ready' }; }
    catch (error) { return { ok: false, message: String(error) }; }
  },
};
