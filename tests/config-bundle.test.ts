import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'classroom-config-test-')); roots.push(root);
  const source = join(root, 'source'); mkdirSync(source);
  writeFileSync(join(source, 'settings.json'), JSON.stringify({ stt: { provider: 'deepgram', micDeviceId: 'old-device' },
    questionDetection: { provider: 'jev', threshold: .65 }, llm: { provider: 'omp-codex', apiKey: 'synthetic-secret' },
    secret: 'synthetic-private-key', activeProfile: 'demo' }));
  writeFileSync(join(source, 'secrets.json'), 'synthetic-vault');
  mkdirSync(join(source, 'profiles')); writeFileSync(join(source, 'profiles/demo.yaml'), 'id: demo\n');
  return { root, source, bundle: join(root, 'bundle'), target: join(root, 'target') };
}
function run(...args: string[]) { return execFileSync(process.execPath, [resolve('scripts/config-bundle.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' }); }
it('exports and restores settings/profile overrides without copying credentials or starting capture', () => {
  const f = fixture(); run('export', '--user-data', f.source, '--bundle', f.bundle);
  const settings = JSON.parse(readFileSync(join(f.bundle, 'settings.json'), 'utf8'));
  expect(settings.llm.apiKey).toBeUndefined(); expect(settings.secret).toBeUndefined();
  expect(existsSync(join(f.bundle, 'secrets.json'))).toBe(false);
  run('restore', '--user-data', f.target, '--bundle', f.bundle, '--app-stopped');
  const restored = JSON.parse(readFileSync(join(f.target, 'settings.json'), 'utf8'));
  expect(restored.questionDetection.threshold).toBe(.65); expect(restored.stt.micDeviceId).toBe('default');
  expect(readFileSync(join(f.target, 'profiles/demo.yaml'), 'utf8')).toBe('id: demo\n');
  expect(() => run('restore', '--user-data', f.target, '--bundle', f.bundle)).toThrow();
});
it('rejects a damaged bundle before overwriting existing settings', () => {
  const f = fixture(); run('export', '--user-data', f.source, '--bundle', f.bundle);
  mkdirSync(f.target); writeFileSync(join(f.target, 'settings.json'), 'original');
  writeFileSync(join(f.bundle, 'profiles/demo.yaml'), 'tampered');
  expect(() => run('restore', '--user-data', f.target, '--bundle', f.bundle, '--app-stopped')).toThrow();
  expect(readFileSync(join(f.target, 'settings.json'), 'utf8')).toBe('original');
});
it('rejects traversal paths and symlink destinations', () => {
  const f = fixture(); run('export', '--user-data', f.source, '--bundle', f.bundle);
  const manifestPath = join(f.bundle, 'manifest.json'); const original = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(original); manifest.files[0].path = '../outside.json'; writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(() => run('restore', '--user-data', f.target, '--bundle', f.bundle, '--app-stopped')).toThrow();
  expect(existsSync(join(f.root, 'outside.json'))).toBe(false);
  writeFileSync(manifestPath, original); mkdirSync(f.target, { recursive: true }); symlinkSync(f.source, join(f.target, 'profiles'));
  expect(() => run('restore', '--user-data', f.target, '--bundle', f.bundle, '--app-stopped')).toThrow();
});
it('preserves a backup on restore and rejects credentials embedded in URLs', () => {
  const f = fixture(); run('export', '--user-data', f.source, '--bundle', f.bundle);
  mkdirSync(f.target); writeFileSync(join(f.target, 'settings.json'), 'previous');
  const result = JSON.parse(run('restore', '--user-data', f.target, '--bundle', f.bundle, '--app-stopped'));
  expect(readFileSync(join(result.backup, 'settings.json'), 'utf8')).toBe('previous');
  writeFileSync(join(f.source, 'settings.json'), JSON.stringify({ llm: { endpoints: { custom: 'https://example.invalid/?api_key=synthetic' } } }));
  expect(() => run('export', '--user-data', f.source, '--bundle', join(f.root, 'bad-export'))).toThrow();
});
