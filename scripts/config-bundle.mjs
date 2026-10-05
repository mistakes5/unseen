#!/usr/bin/env node
import { createReadStream, constants as fsConstants } from 'node:fs';
import { chmod, cp, copyFile, mkdir, readFile, readdir, lstat, realpath, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultUserData = join(homedir(), 'Library/Application Support/Classroom Copilot');
const secretField = /api.?key|access.?token|refresh.?token|secret|password|authorization|credential/i;
const allowedSettingKeys = new Set(['llm', 'stt', 'questionDetection', 'overlay', 'hotkeys', 'dictation', 'memory',
  'transcript', 'sessions', 'activeProfile', 'dataDir', 'onboarded']);

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function safeSettings(settings) {
  function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !secretField.test(key)).map(([key, item]) => [key, clean(item)]));
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.username || url.password || [...url.searchParams.keys()].some(key => secretField.test(key)))
        throw new Error('A settings URL contains credentials. Remove them before exporting.');
    }
    return value;
  }
  return clean(Object.fromEntries(Object.entries(settings).filter(([key]) => allowedSettingKeys.has(key))));
}

function allowedFile(path) {
  return path === 'settings.json' || path === 'runtime/omp' ||
    (/^(profiles|knowledge|sessions|memory)\/[\w .()\-\/\u0080-\uffff]+$/.test(path) &&
      !path.split('/').some(part => secretField.test(part) || part.startsWith('.env')));
}

async function ensureSafeDestination(root, rel) {
  if (!allowedFile(rel) || rel.split('/').some(part => part === '..' || part === '.' || !part))
    throw new Error('Invalid bundle path');
  const target = resolve(root, rel);
  if (!target.startsWith(resolve(root) + sep)) throw new Error('Bundle path escapes its destination');
  let current = resolve(root);
  for (const part of rel.split('/')) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Refusing a symlink destination'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

export async function exportBundle({ userData = defaultUserData, bundle, ompBin, includeHistory = false }) {
  userData = await realpath(userData);
  bundle = resolve(bundle);
  if (bundle === userData || bundle.startsWith(userData + sep)) throw new Error('Export outside the live app data directory');
  await mkdir(bundle, { mode: 0o700 }); // Existing destinations are deliberately refused.
  const manifest = { version: 1, platform: process.platform, architecture: process.arch, exportedAt: new Date().toISOString(),
    sourceHome: homedir(), includesHistory: includeHistory, credentialsIncluded: false, files: [] };
  async function record(rel) {
    const path = join(bundle, rel);
    const info = await lstat(path);
    manifest.files.push({ path: rel, bytes: info.size, sha256: await hashFile(path) });
  }
  const settings = safeSettings(JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')));
  await writeFile(join(bundle, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  await record('settings.json');
  async function copyTree(source, prefix) {
    let entries;
    try { entries = await readdir(source, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const rel = `${prefix}/${entry.name}`;
      if (!allowedFile(rel)) throw new Error('Unsupported file name in configuration bundle');
      if (entry.isSymbolicLink()) throw new Error('Configuration directories must not contain symlinks');
      if (entry.isDirectory()) { await mkdir(join(bundle, rel), { recursive: true, mode: 0o700 }); await copyTree(join(source, entry.name), rel); }
      else if (entry.isFile()) {
        if (secretField.test(entry.name) || entry.name.startsWith('.env')) throw new Error('Unexpected credential file in selected configuration directories');
        await mkdir(dirname(join(bundle, rel)), { recursive: true, mode: 0o700 });
        await copyFile(join(source, entry.name), join(bundle, rel), fsConstants.COPYFILE_FICLONE);
        await chmod(join(bundle, rel), 0o600);
        await record(rel);
      }
    }
  }
  for (const name of ['profiles', 'knowledge', ...(includeHistory ? ['sessions', 'memory'] : [])]) await copyTree(join(userData, name), name);
  if (ompBin) {
    await mkdir(join(bundle, 'runtime'), { mode: 0o700 });
    await copyFile(await realpath(ompBin), join(bundle, 'runtime/omp'), fsConstants.COPYFILE_FICLONE);
    await chmod(join(bundle, 'runtime/omp'), 0o600);
    await record('runtime/omp');
  }
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return manifest;
}

export async function restoreBundle({ userData = defaultUserData, bundle, appStopped = false, targetHome = homedir() }) {
  if (!appStopped) throw new Error('Quit Classroom Copilot first, then pass --app-stopped');
  bundle = await realpath(bundle);
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.credentialsIncluded !== false || !Array.isArray(manifest.files)) throw new Error('Invalid bundle manifest');
  if (manifest.files.some(file => file.path === 'runtime/omp') &&
      (manifest.platform !== process.platform || manifest.architecture !== process.arch)) throw new Error('OMP runtime belongs to a different platform/architecture');
  await mkdir(userData, { recursive: true, mode: 0o700 });
  if ((await lstat(userData)).isSymbolicLink()) throw new Error('Refusing a symlink app-data directory');
  userData = await realpath(userData);
  const prepared = [];
  const seen = new Set();
  // Validate every path and checksum before changing any app files.
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || seen.has(file.path)) throw new Error('Invalid/duplicate manifest path');
    seen.add(file.path);
    const source = await ensureSafeDestination(bundle, file.path);
    const target = await ensureSafeDestination(userData, file.path);
    if (await hashFile(source) !== file.sha256) throw new Error('Bundle checksum mismatch');
    prepared.push({ source, target, rel: file.path });
  }
  if (!seen.has('settings.json')) throw new Error('Bundle has no settings');
  const settings = safeSettings(JSON.parse(await readFile(join(bundle, 'settings.json'), 'utf8')));
  // Device-specific inputs and home paths need relocation, not a copied hardware ID.
  function relocate(value) {
    if (Array.isArray(value)) return value.map(relocate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relocate(item)]));
    return typeof value === 'string' && manifest.sourceHome && value.startsWith(manifest.sourceHome + '/')
      ? targetHome + value.slice(manifest.sourceHome.length) : value;
  }
  const portable = relocate(settings);
  if (portable.stt) portable.stt.micDeviceId = 'default';
  const backup = join(userData, `restore-backup-${Date.now()}`);
  for (const { source, target, rel } of prepared) {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try { await lstat(target); await mkdir(dirname(join(backup, rel)), { recursive: true, mode: 0o700 }); await cp(target, join(backup, rel)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temp = target + `.restore-${process.pid}`;
    if (rel === 'settings.json') await writeFile(temp, JSON.stringify(portable, null, 2) + '\n', { mode: 0o600 });
    else await copyFile(source, temp, fsConstants.COPYFILE_FICLONE);
    await chmod(temp, rel === 'runtime/omp' ? 0o700 : 0o600);
    await rename(temp, target);
  }
  return { filesRestored: prepared.length, backup, runtime: seen.has('runtime/omp') ? join(userData, 'runtime/omp') : null };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--include-history') opts.includeHistory = true;
    else if (args[i] === '--app-stopped') opts.appStopped = true;
    else if (['--user-data', '--bundle', '--omp-bin'].includes(args[i])) {
      const key = { '--user-data': 'userData', '--bundle': 'bundle', '--omp-bin': 'ompBin' }[args[i]];
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value');
      opts[key] = args[++i];
    } else throw new Error('Unknown option');
  }
  if (!opts.bundle || !['export', 'restore'].includes(command)) throw new Error('Usage: config-bundle.mjs export|restore --bundle DIR [--user-data DIR] [--omp-bin FILE] [--include-history] [--app-stopped]');
  const result = command === 'export' ? await exportBundle(opts) : await restoreBundle(opts);
  console.log(command === 'export' ? `Private bundle exported: ${result.files.length} files; credentials excluded.` : JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
