#!/usr/bin/env node
import * as asar from '@electron/asar';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const app = resolve(process.argv[2] ?? '');
if (!app.endsWith('.app')) throw new Error('Usage: node scripts/audit-mac-package.mjs APP_PATH');
const forbidden = /(^|\/)(?:auth\.json|secrets\.json|credentials\.json|agent\.db(?:-wal|-shm)?|\.env|\.omp|\.codex|\.claude)(\/|$)/i;
const resources = join(app, 'Contents/Resources');
const archive = join(resources, 'app.asar');
const entries = asar.listPackage(archive);
const bad = entries.filter(path => forbidden.test(path));
for (const path of readdirSync(resources, { recursive: true })) if (forbidden.test(path)) bad.push('Resources/' + path);
if (bad.length) throw new Error('Refusing credential/config stores in app: ' + bad.join(', '));
const runtime = join(resources, 'runtime');
for (const name of ['codex', 'codex.LICENSE', 'codex.NOTICE', 'codex-version.json']) if (!existsSync(join(runtime, name))) throw new Error('Missing bundled runtime file: ' + name);
const pin = JSON.parse(readFileSync(join(runtime, 'codex-version.json'), 'utf8'));
console.log(JSON.stringify({ credentialStoreFiles: 0, packagedEntriesChecked: entries.length,
  runtimeVersion: pin.version, architecture: pin.arch, excludesUserData: true }));
