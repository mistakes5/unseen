import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { beforeEach, expect, it, vi } from 'vitest';
import type { LlmRequest } from '../src/shared/types';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }));
import { ompProvider } from '../src/main/services/llm/omp';

const req: LlmRequest = { model: 'gpt-6-luna', reasoningEffort: 'low', system: [{ text: 'Answer briefly.' }],
  messages: [{ role: 'user', content: 'Synthetic private question' }], maxTokens: 2000 };
const delta = (text: string) => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });
const end = { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', usage: { input: 20, output: 8, cacheRead: 5 } } };
function childFor(lines: unknown[] = [], hanging = false) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn((signal: string) => {
      child.signalCode = signal; child.stdout.end(); child.stderr.end(); child.emit('close', null); return true;
    }),
  });
  child.stdin.on('finish', () => {
    if (hanging) return;
    for (const line of lines) child.stdout.write(JSON.stringify(line) + '\n');
    child.stdout.end(); child.stderr.end(); child.exitCode = 0; child.emit('close', 0);
  });
  return child;
}
const context = () => ({ apiKey: null, signal: new AbortController().signal });
async function consume() {
  const events = [];
  for await (const e of ompProvider.stream(req, context())) events.push(e);
  return events;
}
beforeEach(() => vi.clearAllMocks());

it('delivers text before completion, ignores reasoning, and keeps private input out of arguments', async () => {
  const child = childFor([], true);
  mocks.spawn.mockReturnValue(child);
  const stream = ompProvider.stream(req, context())[Symbol.asyncIterator]();
  child.stdin.on('finish', () => {
    child.stdout.write('non-JSON diagnostic\n');
    child.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hidden' } }) + '\n');
    child.stdout.write(JSON.stringify(delta('Visible ')) + '\n');
  });
  expect(await stream.next()).toEqual({ value: { type: 'delta', text: 'Visible ' }, done: false });
  expect(child.exitCode).toBeNull();
  const args: string[] = mocks.spawn.mock.calls[0][1];
  expect(args).not.toContain(req.messages[0].content);
  expect(child.stdin.read().toString()).toContain('Synthetic private question');
  expect(args[args.indexOf('--model') + 1]).toBe('openai-codex/gpt-6-luna');
  expect(args[args.indexOf('--thinking') + 1]).toBe('low');
  expect(args[args.indexOf('--service-tier') + 1]).toBe('priority');
  for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-session', '--no-prewalk']) expect(args).toContain(flag);
  const config = await readFile(args[args.indexOf('--config') + 1], 'utf8');
  expect(config).toContain('modelFallback: false');
  expect(config).toContain('enabled: false');
  child.stdout.write(JSON.stringify(delta('answer.')) + '\n');
  child.stdout.write(JSON.stringify(end) + '\n');
  expect(await stream.next()).toMatchObject({ value: { type: 'delta', text: 'answer.' } });
  expect(await stream.next()).toMatchObject({ value: { type: 'usage', inputTokens: 20, outputTokens: 8, cacheReadTokens: 5 } });
  expect(await stream.next()).toMatchObject({ value: { type: 'done' } });
  expect(await stream.next()).toMatchObject({ done: true });
  expect(child.kill).not.toHaveBeenCalled();
  child.exitCode = 0; child.stdout.end(); child.stderr.end(); child.emit('close', 0);
});

it('does not duplicate streamed answer text from the terminal message snapshot', async () => {
  mocks.spawn.mockReturnValue(childFor([delta('One answer.'), { ...end, message: { ...end.message, content: [{ type: 'text', text: 'One answer.' }] } }]));
  expect(await consume()).toEqual([{ type: 'delta', text: 'One answer.' },
    { type: 'usage', inputTokens: 20, outputTokens: 8, cacheReadTokens: 5 }, { type: 'done' }]);
});

it('accepts a final text-only snapshot when a compatible OMP emits no text chunks', async () => {
  mocks.spawn.mockReturnValue(childFor([{ ...end, message: { ...end.message, content: [
    { type: 'thinking', text: 'hidden' }, { type: 'text', text: 'Final answer.' },
  ] } }]));
  expect((await consume()).filter(e => e.type === 'delta')).toEqual([{ type: 'delta', text: 'Final answer.' }]);
});

it.each([
  [delta('Partial answer.')],
  [{ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'PRIVATE ACCOUNT DETAIL' } }],
  [{ type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse' } }],
])('surfaces an incomplete, failed or tool turn without leaking provider diagnostics', async (...args) => {
  mocks.spawn.mockReturnValue(childFor(args));
  await expect(consume()).rejects.toThrow('OMP could not complete this answer.');
});

it('cancels a hanging subprocess instead of leaving an answer slot occupied', async () => {
  const child = childFor([], true);
  mocks.spawn.mockReturnValue(child);
  const controller = new AbortController();
  child.stdin.on('finish', () => setTimeout(() => controller.abort(), 1));
  const run = async () => { for await (const _ of ompProvider.stream(req, { apiKey: null, signal: controller.signal })) { /* consume */ } };
  await expect(run()).rejects.toThrow();
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
});
