import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmRequest } from '../src/shared/types';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }));
import { codexArgs, codexProvider, parseCodexEvent } from '../src/main/services/llm/codex';

const request: LlmRequest = { model: 'gpt-5.6-luna', reasoningEffort: 'low', system: [{ text: 'Answer briefly.' }], messages: [{ role: 'user', content: 'What is citizenship?' }], maxTokens: 2000 };
function fakeChild(lines: unknown[], code = 0, hang = false) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn((signal: string) => {
      child.signalCode = signal;
      child.stdout.end(); child.stderr.end(); child.emit('close', null);
      return true;
    }),
  });
  child.stdin.on('finish', () => {
    if (hang) return;
    for (const line of lines) child.stdout.write(JSON.stringify(line) + '\n');
    child.stdout.end(); child.stderr.end(); child.exitCode = code; child.emit('close', code);
  });
  return child;
}

describe('Codex CLI provider', () => {
  beforeEach(() => vi.clearAllMocks());
  it('isolates each turn and retains the exact Luna low configuration', () => {
    const args = codexArgs(request);
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('project_doc_max_bytes=0');
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('model_reasoning_effort="low"');
    expect(args).toContain('service_tier="fast"');
    expect(args).toContain('fast_mode');
    expect(args).toContain('gpt-5.6-luna');
    expect(args).toContain('shell_tool');
    for (const feature of ['plugins', 'browser_use', 'computer_use', 'image_generation', 'code_mode_host']) {
      expect(args[args.indexOf(feature) - 1]).toBe('--disable');
    }
    expect(args.at(-1)).toBe('-');
    expect(args.join(' ')).not.toContain('What is citizenship');
  });
  it('ignores non-JSON diagnostics', () => expect(parseCodexEvent('not JSON')).toBeNull());
  it('uses GPT-6 Luna low and Fast only through isolated per-call overrides', async () => {
    const args = codexArgs({ ...request, model: 'gpt-6-luna', reasoningEffort: 'low' });
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-6-luna');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('model_reasoning_effort="low"');
    expect(args).toContain('service_tier="fast"');
    expect(args).toContain('fast_mode');
    expect(await codexProvider.listModels({ apiKey: null })).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'gpt-6-luna' })]));
  });
  it('returns only completed answer messages and usage', async () => {
    const child = fakeChild([
      { type: 'item.completed', item: { type: 'reasoning', text: 'hidden' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Citizenship is legal membership.' } },
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } },
    ]);
    mocks.spawn.mockReturnValue(child);
    const events = [];
    for await (const event of codexProvider.stream(request, { apiKey: null, signal: new AbortController().signal })) events.push(event);
    expect(events).toEqual([
      { type: 'delta', text: 'Citizenship is legal membership.' },
      { type: 'usage', inputTokens: 100, outputTokens: 10, cacheReadTokens: 40 },
      { type: 'done' },
    ]);
    expect(mocks.spawn.mock.calls[0][2].cwd).toContain('classroom-codex-');
    expect(mocks.spawn.mock.calls[0][1].join(' ')).toContain('model_instructions_file=');
    expect(child.stdin.read().toString()).not.toContain('Answer briefly.');
  });
  it('reports failed turns instead of pretending to complete', async () => {
    mocks.spawn.mockReturnValue(fakeChild([{ type: 'turn.failed' }], 1));
    const run = async () => { for await (const _ of codexProvider.stream(request, { apiKey: null, signal: new AbortController().signal })) { /* consume */ } };
    await expect(run()).rejects.toThrow('Codex could not complete');
  });
  it('reuses only an empty working directory, never another answer’s instruction file or thread', async () => {
    const calls = [];
    for (let i = 0; i < 2; i++) {
      const child = fakeChild([
        { type: 'item.completed', item: { type: 'agent_message', text: `Answer ${i}` } },
        { type: 'turn.completed' },
      ]);
      mocks.spawn.mockReturnValueOnce(child);
      for await (const _ of codexProvider.stream(request, { apiKey: null, signal: new AbortController().signal })) { /* consume */ }
      calls.push(mocks.spawn.mock.calls.at(-1)!);
    }
    expect(calls[0][2].cwd).toBe(calls[1][2].cwd);
    expect(calls[0][2].cwd).toContain('classroom-codex-workspace-');
    const instructionArg = (call: any[]) => call[1].find((arg: string) => arg.startsWith('model_instructions_file='));
    expect(instructionArg(calls[0])).not.toBe(instructionArg(calls[1]));
    expect(calls[0][1]).toContain('--ephemeral');
    expect(calls[1][1]).toContain('--ignore-user-config');
  });
  it('kills the subprocess when an answer is cancelled', async () => {
    const child = fakeChild([], 0, true);
    mocks.spawn.mockReturnValue(child);
    const abort = new AbortController();
    child.stdin.on('finish', () => setTimeout(() => abort.abort(), 1));
    const run = async () => { for await (const _ of codexProvider.stream(request, { apiKey: null, signal: abort.signal })) { /* consume */ } };
    await expect(run()).rejects.toThrow();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('releases a completed answer without waiting for CLI shutdown, then reaps the child', async () => {
    const child = fakeChild([], 0, true);
    child.stdin.on('finish', () => {
      child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Complete.' } }) + '\n');
      child.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }) + '\n');
    });
    mocks.spawn.mockReturnValue(child);
    const events = [];
    for await (const e of codexProvider.stream(request, { apiKey: null, signal: new AbortController().signal })) events.push(e);
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(child.exitCode).toBeNull();
    expect(child.kill).not.toHaveBeenCalled();
    child.exitCode = 0; child.stdout.end(); child.stderr.end(); child.emit('close', 0);
  });
});
