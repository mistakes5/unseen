#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--app')) throw new Error('Usage: npm run verify:installation -- [--app APP_PATH]');
const app = args[0] === '--app' ? args[1] : null;
const lock = JSON.parse(readFileSync(join(root, 'config/installed-payload.json'), 'utf8'));
const failures = [];
for (const [file, expected] of Object.entries(lock.files)) {
  const path = join(root, file);
  if (!existsSync(path) || sha(readFileSync(path)) !== expected) failures.push(file);
  if (app) {
    const resources = join(resolve(app), 'Contents/Resources');
    const bytes = file.startsWith('out/') ? asar.extractFile(join(resources, 'app.asar'), file)
      : readFileSync(join(resources, file));
    if (sha(bytes) !== expected) failures.push('installed:' + file);
  }
}
if (app) {
  const archive = join(resolve(app), 'Contents/Resources/app.asar');
  const runtimeFiles = Object.fromEntries(asar.listPackage(archive).map(path => path.replace(/^\//, ''))
    .filter(path => path.startsWith('node_modules/') && !asar.statFile(archive, path).files)
    .sort().map(path => [path, sha(asar.extractFile(archive, path))]));
  if (Object.keys(runtimeFiles).length !== lock.runtimeDependencies.files || sha(JSON.stringify(runtimeFiles)) !== lock.runtimeDependencies.sha256)
    failures.push('runtime dependencies');
  const electronVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion',
    join(resolve(app), 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist')], { encoding: 'utf8' }).trim();
  if (electronVersion !== lock.electron) failures.push('Electron version');
}
if (failures.length) { console.error('Payload mismatch:', failures.join(', ')); process.exitCode = 1; }
else console.log(`Verified ${Object.keys(lock.files).length} compiled/profile files against the captured installation${app ? `; app matches ${lock.runtimeDependencies.files} runtime dependency files and Electron ${lock.electron}` : ''}.`);
