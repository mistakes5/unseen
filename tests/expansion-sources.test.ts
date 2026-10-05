import { afterAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'unseen-expansion-'));
process.env.UNSEEN_TEST_EXPANSION_DIR = dir;
vi.mock('../src/main/services/knowledge', () => ({ knowledgeDir: () => process.env.UNSEEN_TEST_EXPANSION_DIR! }));
import { loadExpansionIndexCorpora, loadExpansionSourcesConfig } from '../src/main/services/expansion-sources';
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.UNSEEN_TEST_EXPANSION_DIR; });

it('grants no cross-course sources without a valid private manifest', () => {
  expect(loadExpansionSourcesConfig()).toEqual({ version: 1, indexes: [], transcriptProfiles: [] });
  writeFileSync(join(dir, 'expansion-sources.json'), JSON.stringify({ version: 1,
    indexes: [{ profileId: 'other', courseName: 'Other class', file: '../outside.index.json' }],
    transcriptProfiles: ['other'] }));
  expect(loadExpansionSourcesConfig().indexes).toHaveLength(0);
});

it('loads only named indexes with source class labels', () => {
  writeFileSync(join(dir, 'expansion-sources.json'), JSON.stringify({ version: 1,
    indexes: [{ profileId: 'politics-of-ai', courseName: 'Politics of AI', file: 'ai.index.json' }],
    transcriptProfiles: ['political-identities'] }));
  writeFileSync(join(dir, 'ai.index.json'), JSON.stringify({ version: 1, builtAt: '2026-09-29', chunks: [
    { source: 'Noble', locator: 'file p. 2', text: 'Search rankings can repeat social patterns.' },
  ] }));
  const config = loadExpansionSourcesConfig();
  expect(config.transcriptProfiles).toEqual(['political-identities']);
  expect(loadExpansionIndexCorpora(config)).toEqual([{ profileId: 'politics-of-ai', courseName: 'Politics of AI',
    kind: 'reading', chunks: [{ source: 'Noble', locator: 'file p. 2', text: 'Search rankings can repeat social patterns.' }] }]);
});
