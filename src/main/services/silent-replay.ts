/** Explicit opt-in diagnostic: files -> engines, never speakers or microphone.
 * Not reachable from renderer IPC. Secrets stay in the main process's vault.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WebContents } from 'electron';
import { settings } from './settings';
import { getSecret } from './secrets';
import { deepgramProvider } from './stt/deepgram';
import { parseDeepgram } from '../../renderer/overlay/stt/parsers/deepgram';
import { detectQuestion } from './question-detection';
import { loadKnowledge } from './knowledge';
import { getActiveProfile } from './profiles';
import { runAnswer } from './llm/run-answer';
import { IPC } from '../../shared/ipc-contract';

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, Math.max(0, ms)));
interface Segment { text: string; receivedMs: number; audioEndSec?: number; lagMs?: number; inferenceMs?: number }
interface Replay { engine: string; firstInterimMs?: number; firstFinalMs?: number; startupMs?: number; segments: Segment[]; error?: string; close?: {code: number; reason: string}; bytesSent?: number }
function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`Missing ${name}`);
  return process.argv[i + 1];
}

async function deepgramReplay(pcm: Buffer): Promise<Replay> {
  const descriptor = await deepgramProvider.descriptor(settings().get());
  const url = new URL(descriptor.wsUrl);
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', '16000');
  url.searchParams.set('channels', '1');
  const result: Replay = { engine: 'Deepgram nova-3, realtime-paced PCM', segments: [] };
  const socket = new WebSocket(url, descriptor.protocols);
  let start = 0;
  let fatal: Error | undefined;
  const closed = new Promise<void>(r => socket.addEventListener('close', event => {
    result.close = { code: event.code, reason: event.reason.replace(/[a-f0-9]{40,}/gi, '[redacted]') };
    r();
  }, { once: true }));
  socket.addEventListener('message', event => {
    try {
      const raw = JSON.parse(String(event.data));
      if (raw.type === 'Error') { fatal = new Error('Deepgram streaming service reported an error'); socket.close(); return; }
      const parsed = parseDeepgram(raw);
      const receivedMs = Date.now() - start;
      if (parsed?.type === 'interim' && result.firstInterimMs === undefined) result.firstInterimMs = receivedMs;
      if (parsed?.type === 'final') {
        result.firstFinalMs ??= receivedMs;
        const words = raw.channel?.alternatives?.[0]?.words ?? [];
        const audioEndSec = words.at(-1)?.end;
        result.segments.push({ text: parsed.text, receivedMs, audioEndSec, lagMs: typeof audioEndSec === 'number' ? receivedMs - audioEndSec * 1000 : undefined });
      }
    } catch { fatal = new Error('Deepgram returned an invalid streaming message'); }
  });
  const timeout = setTimeout(() => { fatal = new Error('Deepgram replay timed out'); socket.close(); }, pcm.length / 32 + 30000);
  try {
    await new Promise<void>((yes, no) => {
      socket.addEventListener('open', () => yes(), { once: true });
      socket.addEventListener('error', () => no(new Error('Deepgram websocket connection failed')), { once: true });
    });
    start = Date.now();
    // 100ms of mono signed 16-bit PCM per frame, paced at real-time speed.
    for (let offset = 0; offset < pcm.length; offset += 3200) {
      await delay(start + offset / 32 - Date.now());
      if (fatal || socket.readyState !== WebSocket.OPEN) throw fatal ?? new Error('Deepgram closed early');
      socket.send(Uint8Array.from(pcm.subarray(offset, offset + 3200)));
      result.bytesSent = Math.min(offset + 3200, pcm.length);
    }
    socket.send(JSON.stringify({ type: 'CloseStream' }));
    await closed;
    if (fatal) throw fatal;
    return result;
  } catch (error) {
    result.error = (error as Error).message;
    return result;
  } finally { clearTimeout(timeout); socket.close(); }
}

async function mlxReplay(pcm: Buffer): Promise<Replay> {
  const root = join(homedir(), 'Developer');
  const startup = Date.now();
  const worker = spawn(join(root, 'classroom-whisperlivekit/.venv/bin/python'), [
    '-u', join(root, 'meetily/frontend/src-tauri/src/audio/transcription/mlx_worker.py'),
    '--model', 'mlx-community/whisper-large-v3-turbo',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  worker.stderr.resume();
  worker.stdin.on('error', () => {});
  const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
  const next = async (): Promise<Record<string, unknown>> => {
    let timer: ReturnType<typeof setTimeout>;
    const item = await Promise.race([
      lines.next(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MLX worker timed out')), 90000); }),
    ]).finally(() => clearTimeout(timer!));
    if (item.done) throw new Error('MLX worker exited');
    const response = JSON.parse(item.value);
    if (!response.ok) throw new Error('MLX transcription failed');
    return response;
  };
  const result: Replay = { engine: 'Meetily exact MLX worker; fixed 12s chunk simulation (not live Silero VAD)', segments: [] };
  try {
    await next(); result.startupMs = Date.now() - startup;
    const start = Date.now();
    for (let offset = 0; offset < pcm.length; offset += 12 * 32000) {
      const chunk = pcm.subarray(offset, offset + 12 * 32000);
      const audioEndSec = (offset + chunk.length) / 32000;
      await delay(start + audioEndSec * 1000 - Date.now());
      const floats = Buffer.alloc(chunk.length * 2);
      for (let i = 0; i < chunk.length / 2; i++) floats.writeFloatLE(chunk.readInt16LE(i * 2) / 32768, i * 4);
      const inferStart = Date.now();
      worker.stdin.write(JSON.stringify({ audio: floats.toString('base64'), language: 'en' }) + '\n');
      const response = await next();
      const receivedMs = Date.now() - start;
      if (typeof response.text === 'string' && response.text.trim()) {
        result.firstFinalMs ??= receivedMs;
        result.segments.push({ text: response.text, receivedMs, audioEndSec, lagMs: receivedMs - audioEndSec * 1000, inferenceMs: Date.now() - inferStart });
      }
    }
    return result;
  } finally { worker.kill('SIGTERM'); }
}

async function answer(fullTranscript: string, newSegment: string, forced: boolean) {
  const events: { channel: string; value: unknown }[] = [];
  const sender = { send: (channel: string, value: unknown) => { events.push({ channel, value }); } } as unknown as WebContents;
  const start = Date.now();
  await runAnswer(sender, { fullTranscript, newSegment, forced, codeMode: false, userSpeaker: 0 });
  const error = events.find(e => e.channel === IPC.evAnswerError);
  const text = events.filter(e => e.channel === IPC.evAnswerDelta).map(e => e.value).join('');
  return { elapsedMs: Date.now() - start, text, error: error?.value, sources: loadKnowledge(getActiveProfile(), newSegment, fullTranscript.slice(-1000)).map(k => k.name) };
}

export async function runSilentReplay(): Promise<void> {
  if (!process.argv.includes('--allow-cloud-replay')) throw new Error('Cloud replay requires explicit opt-in');
  const file = resolve(arg('--silent-replay-file'));
  const output = resolve(arg('--replay-output'));
  const startSec = Number(arg('--replay-start'));
  if (!Number.isFinite(startSec) || startSec < 0) throw new Error('Invalid replay start');
  if (!getSecret('deepgram') || !getSecret('typesafe')) throw new Error('Configure both keys first');
  if (settings().get().sessions.autoSave) throw new Error('Disable session autosave for isolated replay');
  const report: Record<string, unknown> = { createdAt: new Date().toISOString(), source: file, startSec, durationSec: 120, caveats: [
    'No microphone or speaker access. Same decoded audio, different segmentation.',
    'MLX uses exact installed source worker but fixed 12s chunks, not Meetily Silero VAD.',
    'Deepgram final lag is measured from last recognized word; MLX lag is from chunk end. These are NOT equivalent accuracy/latency metrics.',
    'Question and answer diagnostics run after replay; not live end-to-end latency.',
    'Existing ASR transcript is not human ground truth. No WER/accuracy claim.',
  ] };
  const save = async () => { await mkdir(output, { recursive: true }); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); };
  let engines: Replay[];
  if (process.argv.includes('--reuse-asr-report')) {
    const previous = JSON.parse(await readFile(resolve(arg('--reuse-asr-report')), 'utf8'));
    if (previous.source !== file || previous.startSec !== startSec || !Array.isArray(previous.engines)) throw new Error('Replay report source does not match');
    engines = previous.engines;
    if (process.argv.includes('--reuse-extra-asr-report')) {
      const extra = JSON.parse(await readFile(resolve(arg('--reuse-extra-asr-report')), 'utf8'));
      if (extra.source !== file || extra.startSec !== startSec || !Array.isArray(extra.engines)) throw new Error('Extra replay source does not match');
      engines = [...engines, ...extra.engines];
      report.reusedExtraAsrFrom = resolve(arg('--reuse-extra-asr-report'));
    }
    report.reusedAsrFrom = resolve(arg('--reuse-asr-report'));
    report.engineErrors = previous.engineErrors;
  } else {
    const pcm = execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-ss', String(startSec), '-i', file, '-t', '120', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { maxBuffer: 8_000_000, timeout: 30000 });
    report.durationSec = pcm.length / 32000;
    console.info('[replay] Silent, realtime-paced two-minute A/B started. No live capture.');
    const settled = await Promise.allSettled(process.argv.includes('--deepgram-only') ? [deepgramReplay(pcm)] : [deepgramReplay(pcm), mlxReplay(pcm)]);
    engines = settled.filter((r): r is PromiseFulfilledResult<Replay> => r.status === 'fulfilled').map(r => r.value);
    report.engineErrors = settled.map((r, i) => r.status === 'rejected' ? { engine: i === 0 ? 'Deepgram' : 'MLX', message: String(r.reason) } : null).filter(Boolean);
  }
  report.engines = engines;
  await save();
  if (process.argv.includes('--asr-only')) { console.info('[replay] ASR-only report saved.'); return; }
  console.info('[replay] ASR complete; testing Jev and the actual main-process answer pipeline.');
  const key = getSecret('typesafe')!;
  const cases = [
    { name: 'substantive', expected: true, context: '', text: 'How does social identity theory explain ingroup favoritism?' },
    { name: 'invitation', expected: true, context: '', text: 'Give an objection to the claim that identity determines political interests.' },
    { name: 'unfinished', expected: false, context: '', text: 'How does social identity theory explain the relationship between' },
    { name: 'split completion', expected: true, context: 'How does social identity theory explain', text: 'ingroup favoritism?' },
    { name: 'logistics', expected: false, context: '', text: 'Can everyone move their chairs into groups of four?' },
    { name: 'self answered', expected: false, context: '', text: 'What is a straw man? It is misrepresenting an argument to make it easier to attack.' },
    { name: 'old question', expected: false, context: 'What is a straw man? It is misrepresenting an argument.', text: 'Thanks, that makes sense.' },
    { name: 'statement', expected: false, context: '', text: 'Today we are discussing nationalism and group identity.' },
  ];
  const judgments = [];
  for (const test of cases) {
    const began = Date.now();
    const p = await detectQuestion({ fullTranscript: test.context, newSegment: test.text, forced: false, codeMode: false, userSpeaker: 0 }, key, AbortSignal.timeout(10000));
    judgments.push({ ...test, probability: p, passed: (p >= settings().get().questionDetection.threshold) === test.expected, elapsedMs: Date.now() - began });
  }
  report.syntheticJev = judgments; await save();
  const actual = [];
  for (const engine of engines) {
    let transcript = ''; let answered = 0;
    const rows = [];
    for (const segment of engine.segments) {
      transcript = (transcript + '\n' + segment.text).slice(-7000);
      const began = Date.now();
      const probability = await detectQuestion({ fullTranscript: transcript, newSegment: segment.text, forced: false, codeMode: false, userSpeaker: 0 }, key, AbortSignal.timeout(10000));
      const row: Record<string, unknown> = { text: segment.text, probability, jevMs: Date.now() - began };
      if (probability >= settings().get().questionDetection.threshold && answered < 2) {
        // Forced only because the SAME Jev gate just passed; avoids paying twice.
        row.answer = await answer(transcript, segment.text, true); answered++;
      }
      rows.push(row);
    }
    actual.push({ engine: engine.engine, rows });
    report.recordingQuestionTests = actual; await save();
  }
  report.groundedAnswer = await answer('We are discussing Tajfel and Turner.', 'According to Tajfel and Turner, why can minimal groups show discrimination without competing material interests?', false);
  report.missingSourceControl = await answer('', 'What exact page range from Mason did the professor assign for today?', true);
  await save();
  console.info('[replay] Complete. Report saved; credentials were not logged.');
}
