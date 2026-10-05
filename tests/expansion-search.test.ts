import { expect, it } from 'vitest';
import { archiveExpansionCorpora, selectExpansionEvidence, type ExpansionCorpus } from '../src/main/services/expansion-search';
import type { SessionEvent, SessionMeta } from '../src/shared/types';

const corpora: ExpansionCorpus[] = [
  { profileId: 'politics-of-ai', courseName: 'POLISCI 3390F · Politics of AI', kind: 'reading', chunks: [
    { source: 'Noble, Algorithms of Oppression', locator: 'file p. 4', text: 'Search ranking can reproduce racial stereotypes from unequal historical data.' },
  ] },
  { profileId: 'political-identities', courseName: 'POLISCI 3304F · Political Identities', kind: 'lecture', chunks: [
    { source: 'September lecture', locator: 'passage 2', text: 'Social identity and representation shape which groups receive recognition.' },
  ] },
];

it('finds current-class evidence and labels a relevant cross-class connection', () => {
  const found = selectExpansionEvidence(corpora, 'politics-of-ai',
    'Should search reproduce social stereotypes?', 'Search ranking should account for historical bias.',
    'The lecture asked about unequal data.', true);
  expect(found.some(e => e.name.includes('POLISCI 3390F') && e.text.includes('Search ranking'))).toBe(true);
  expect(found.some(e => e.name.includes('POLISCI 3304F') && e.text.includes('Social identity'))).toBe(true);
});

it('keeps other courses out when cross-course retrieval is disabled', () => {
  const found = selectExpansionEvidence(corpora, 'politics-of-ai',
    'Should search reproduce social stereotypes?', 'Search ranking should account for historical bias.', '', false);
  expect(found.some(e => e.name.includes('POLISCI 3304F'))).toBe(false);
});

it('searches only authorized spoken archives available before the original answer', () => {
  const asOf = Date.parse('2026-09-29T14:00:00Z');
  const metas = [
    { id: 'politics-of-ai/current', profileId: 'politics-of-ai', profileName: 'Politics of AI', startedAt: asOf - 1000 },
    { id: 'political-identities/older', profileId: 'political-identities', profileName: 'Political Identities', startedAt: asOf - 86400000 },
    { id: 'federalism/other', profileId: 'federalism', profileName: 'Federalism', startedAt: asOf - 86400000 },
    { id: 'political-identities/test', profileId: 'political-identities', profileName: 'TEST Political Identities', startedAt: asOf - 86400000 },
  ] as SessionMeta[];
  const read = (id: string): SessionEvent[] => [
    { type: 'final', t: asOf - 500, profileId: id.split('/')[0], speaker: 0, text: 'Earlier identity and representation.' },
    { type: 'final', t: asOf + 500, profileId: id.split('/')[0], speaker: 0, text: 'Future speech must stay out.' },
    { type: 'answer', t: asOf - 400, profileId: id.split('/')[0], forced: false, text: 'AI output is not spoken evidence.' },
  ];
  const found = archiveExpansionCorpora(metas, read, 'politics-of-ai', asOf, ['political-identities']);
  expect(found).toHaveLength(1);
  expect(found[0].courseName).toBe('Political Identities');
  expect(found[0].chunks[0].text).toContain('Earlier identity');
  expect(found[0].chunks[0].text).not.toContain('Future speech');
  expect(found[0].chunks[0].text).not.toContain('AI output');
});
