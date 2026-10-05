#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const userData = process.argv[2] || join(homedir(), 'Library/Application Support/Classroom Copilot');
const settingsPath = join(userData, 'settings.json');
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
let failed = false;
for (const name of ['electron', 'electron-vite', 'vitest', 'typescript', 'zod', 'js-yaml']) {
  try { require.resolve(name); console.log(`OK dependency: ${name}`); }
  catch { failed = true; console.log(`MISSING dependency: ${name}; run npm ci`); }
}
const candidates = [process.env.CLASSROOM_OMP_BIN, join(userData, 'runtime/omp'), join(homedir(), '.bun/bin/omp'),
  join(homedir(), '.local/bin/omp'), '/opt/homebrew/bin/omp', '/usr/local/bin/omp'];
const omp = candidates.find(path => path && existsSync(path)) || 'omp';
try { console.log('OMP:', execFileSync(omp, ['--version'], { encoding: 'utf8', timeout: 8000 }).trim()); }
catch { failed = true; console.log('MISSING OMP: restore the captured runtime or follow vendor/omp/README.md'); }
console.log(settings ? `Saved configuration: STT=${settings.stt?.provider}; answers=${settings.llm?.provider}; detector=${settings.questionDetection?.provider}`
  : 'No saved configuration: restore a private bundle, or configure providers and a profile in Settings.');
const vaultPath = join(userData, 'secrets.json');
const vault = existsSync(vaultPath) ? JSON.parse(readFileSync(vaultPath, 'utf8')) : { entries: {} };
for (const [id, env] of [['deepgram', 'DEEPGRAM_API_KEY'], ['typesafe', 'TYPESAFE_API_KEY']])
  console.log(`${id} credential record: ${vault.entries?.[id] || process.env[env] ? 'present (not decrypted/tested)' : 'missing; enter your key in Settings'}`);
console.log('Offline check only: no microphone, provider requests, login changes, or model calls.');
if (failed) process.exitCode = 1;
