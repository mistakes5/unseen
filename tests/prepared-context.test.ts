import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPreparedContext, type PreparedContext } from '../src/main/services/prepared-context';

const dirs: string[] = [];
const now = new Date('2026-09-22T16:30:00Z');
const bundle: PreparedContext = { version: 1, profileId: 'canadian-politics', sessionDate: '2026-09-22', timeZone: 'America/Toronto', topic: 'Voting', excerpts: [{ name: 'Gidengil | PDF file page 2', text: 'Original reading evidence.' }] };
function fixture(value: unknown = bundle): string {
  const dir = mkdtempSync(join(tmpdir(), 'classroom-context-test-')); dirs.push(dir);
  const file = join(dir, 'test.context.json'); writeFileSync(file, JSON.stringify(value)); return file;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('prepared context', () => {
  it('reuses the in-memory evidence with stable ordering and citations', () => {
    const path = fixture();
    const a = loadPreparedContext(path, 'canadian-politics', now);
    expect(a).toEqual(bundle.excerpts);
    expect(loadPreparedContext(path, 'canadian-politics', now)).toBe(a);
  });
  it('does not mix course profiles', () => expect(loadPreparedContext(fixture(), 'political-identities', now)[0].text).toContain('different course'));
  it('expires at local midnight, including an already-warmed bundle', () => {
    const path = fixture();
    expect(loadPreparedContext(path, bundle.profileId, new Date('2026-09-23T03:59:00Z'))).toEqual(bundle.excerpts);
    expect(loadPreparedContext(path, bundle.profileId, new Date('2026-09-23T04:00:00Z'))[0].text).toContain("not today's session");
  });
  it('rejects future-session evidence', () => expect(loadPreparedContext(fixture(), bundle.profileId, new Date('2026-09-21T16:00:00Z'))[0].text).toContain("not today's session"));
  it.each([{}, { ...bundle, excerpts: [{ name: 'big', text: 'x'.repeat(26001) }] }, { ...bundle, excerpts: [] }, { ...bundle, timeZone: 'invalid/zone' }])('fails closed on invalid bundles', value => {
    expect(loadPreparedContext(fixture(value), bundle.profileId, now)[0].text).toContain('missing or invalid');
  });
  it('reports missing context without looking up other evidence', () => expect(loadPreparedContext(join(dirs[0] ?? tmpdir(), 'missing-classroom-bundle.context.json'), bundle.profileId, now)[0].text).toContain('No course search'));
  it('reloads an explicitly updated bundle', () => {
    const path = fixture(); loadPreparedContext(path, bundle.profileId, now);
    const updated = { ...bundle, excerpts: [{ name: 'New source', text: 'Revised and explicitly prepared reading evidence.' }] };
    writeFileSync(path, JSON.stringify(updated));
    expect(loadPreparedContext(path, bundle.profileId, now)).toEqual(updated.excerpts);
  });
});
