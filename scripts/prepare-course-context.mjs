// Explicit offline preparation, never called from the answer path.
// node scripts/prepare-course-context.mjs INDEX SPEC OUTPUT.context.json
// SPEC selects exact source+locator pairs; no inferred assignment or ranking.
import { readFileSync, writeFileSync } from 'node:fs';
const [indexPath, specPath, output] = process.argv.slice(2);
if (!indexPath || !specPath || !output?.endsWith('.context.json')) throw new Error('Supply INDEX SPEC OUTPUT.context.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const excerpts = [{ name: spec.briefName, text: spec.brief }];
for (const pick of spec.passages) {
  const matches = index.chunks.filter(c => c.source === pick.source && c.locator === pick.locator);
  if (matches.length !== 1) throw new Error(`Expected one exact source/locator match: ${pick.source} | ${pick.locator}`);
  const c = matches[0];
  excerpts.push({ name: `${c.source} | ${c.locator}`, text: c.text });
}
const chars = excerpts.reduce((n, e) => n + e.name.length + e.text.length, 0);
if (chars > 26000) throw new Error('Prepared evidence exceeds 26000 characters; select fewer passages.');
const bundle = { version: 1, profileId: spec.profileId, sessionDate: spec.sessionDate, timeZone: 'America/Toronto', topic: spec.topic, excerpts };
writeFileSync(output, JSON.stringify(bundle), { mode: 0o600 });
console.log(JSON.stringify({ profileId: bundle.profileId, sessionDate: bundle.sessionDate, excerpts: excerpts.length, chars, output }));
