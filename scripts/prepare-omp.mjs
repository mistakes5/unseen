#!/usr/bin/env node
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(readFileSync(join(root, 'vendor/omp/source.json'), 'utf8'));
const patch = join(root, 'vendor/omp/local.patch');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--dest') throw new Error('Usage: npm run omp:source -- --dest NEW_DIRECTORY');
const dest = resolve(args[1]);
if (existsSync(dest)) throw new Error('Use a new destination; existing source trees are never modified');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(readFileSync(patch)) !== lock.patchSha256) throw new Error('OMP patch checksum mismatch');
mkdirSync(dest, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: dest, stdio: 'inherit' });
git('init', '--quiet');
git('remote', 'add', 'origin', lock.repository);
git('fetch', '--depth=1', 'origin', lock.baseCommit);
git('checkout', '--detach', '--quiet', 'FETCH_HEAD');
git('apply', '--check', patch);
git('apply', patch);
for (const [file, expected] of Object.entries(lock.patchedFiles)) {
  if (sha(readFileSync(join(dest, file))) !== expected) throw new Error('Patched source mismatch: ' + file);
}
console.log(`Verified ${Object.keys(lock.patchedFiles).length} patched OMP files at ${lock.baseCommit}. Source ready: ${dest}`);
