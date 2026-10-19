#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const arch = process.argv[2] ?? process.arch;
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) throw new Error('Package on macOS: npm run release:mac -- arm64|x64');
const pin = JSON.parse(readFileSync(join(root, 'build/runtime/codex-version.json'), 'utf8'));
if (pin.arch !== arch) throw new Error('Prepare the matching Codex runtime first');
const output = join(root, 'release', `package-${arch}`);
execFileSync(join(root, 'node_modules/.bin/electron-builder'), ['--mac', '--dir', `--${arch}`, '--publish', 'never',
  `-c.directories.output=${output}`, '-c.mac.identity=-'], { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
const folder = readdirSync(output).find(name => name === (arch === 'arm64' ? 'mac-arm64' : 'mac'));
if (!folder) throw new Error('Packaged Mac app is missing');
const app = join(output, folder, 'Classroom Copilot.app');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts/audit-mac-package.mjs'), app], { stdio: 'inherit' });
const assets = join(root, 'release/assets'); mkdirSync(assets, { recursive: true });
const filename = `Classroom-Copilot-mac-${arch}.zip`;
const zip = join(assets, filename);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], { stdio: 'inherit' });
const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(zip + '.sha256', `${digest}  ${filename}\n`);
console.log(JSON.stringify({ app, zip, sha256: digest, codex: pin.version, arch }));
