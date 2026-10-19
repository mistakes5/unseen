#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const arch = process.argv[2] ?? process.arch;
const pin = JSON.parse(readFileSync(join(root, 'config/codex-runtime.json'), 'utf8'));
if (!['arm64', 'x64'].includes(arch)) throw new Error('Usage: node scripts/prepare-codex-runtime.mjs arm64|x64');
const asset = pin.assets[arch];
const cache = join(root, 'build/runtime-downloads');
const dest = join(root, 'build/runtime');
mkdirSync(cache, { recursive: true }); mkdirSync(dest, { recursive: true });
const archive = join(cache, asset.name);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
if (!existsSync(archive) || sha(readFileSync(archive)) !== asset.sha256) {
  const bytes = await download(`${pin.source}/releases/download/${pin.tag}/${asset.name}`);
  if (sha(bytes) !== asset.sha256) throw new Error('Official Codex download checksum mismatch');
  writeFileSync(archive, bytes);
}
const entries = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (entries.length !== 1 || !/^codex-(aarch64|x86_64)-apple-darwin$/.test(entries[0])) throw new Error('Unexpected Codex archive layout');
const scratch = mkdtempSync(join(tmpdir(), 'classroom-codex-package-'));
try {
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', scratch]);
  cpSync(join(scratch, entries[0]), join(dest, 'codex')); chmodSync(join(dest, 'codex'), 0o755);
} finally { rmSync(scratch, { recursive: true, force: true }); }
for (const name of ['LICENSE', 'NOTICE']) {
  const bytes = await download(`https://raw.githubusercontent.com/openai/codex/${pin.tag}/${name}`);
  writeFileSync(join(dest, `codex.${name}`), bytes);
}
writeFileSync(join(dest, 'codex-version.json'), JSON.stringify({ version: pin.version, arch, source: pin.source, release: pin.tag, archiveSha256: asset.sha256 }, null, 2) + '\n');
if (process.arch === arch) {
  const version = execFileSync(join(dest, 'codex'), ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (!version.endsWith(pin.version)) throw new Error('Bundled Codex version mismatch');
  console.log(version);
}
console.log(`Prepared verified native Codex for ${arch}; no Node launcher required.`);
