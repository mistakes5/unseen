// Opt-in, sequential paired test. Existing Codex login/quota; no audio.
// npx esbuild scripts/benchmark-participation.ts --bundle --platform=node --format=cjs | node - BASELINE_PROFILE_DIR
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { load } from 'js-yaml';
import { ProfileSchema } from '../src/shared/profile-schema';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import { loadPreparedContext } from '../src/main/services/prepared-context';
import { buildAnswerRequest } from '../src/main/services/prompt-builder';
import { codexProvider } from '../src/main/services/llm/codex';

async function main() {
  const baseline = process.argv[2];
  if (!baseline) throw new Error('Provide baseline profile directory');
  const cases = [
    { profile: 'canadian-politics', course: '2530f', question: 'Suggest a testable hypothesis about economic evaluations and vote choice, and one reason a correlation would not prove causation.' },
    { profile: 'canadian-politics', course: '2530f', question: 'Why might social background appear unimportant after controlling for party identification and leader evaluations?' },
    { profile: 'political-identities', course: '3304f', question: 'Does in-group favouritism require a real conflict over resources? Use the minimal-group research.' },
  ];
  const results: object[] = [];
  for (const [i, c] of cases.entries()) {
    // Alternate order to reduce a simple first-call/order advantage.
    for (const variant of i % 2 ? ['brief', 'baseline'] : ['baseline', 'brief']) {
      const p = ProfileSchema.parse(load(readFileSync(join(variant === 'baseline' ? baseline : 'profiles', `${c.profile}.yaml`), 'utf8')));
      const knowledgeDir = process.env.CLASSROOM_KNOWLEDGE_DIR ?? join(homedir(), 'Library', 'Application Support', 'Classroom Copilot', 'knowledge');
      const knowledge = loadPreparedContext(join(knowledgeDir, `polisci-${c.course}.context.json`), p.id);
      if (knowledge.length < 2) throw new Error('Session bundle unavailable');
      const req = buildAnswerRequest({ profile: p, knowledge, settings: DEFAULT_SETTINGS,
        fullTranscript: `This is the ${c.course} class discussion.`, newSegment: c.question,
        userSpeaker: 0, forced: true, codeMode: false });
      req.model = 'gpt-5.6-luna'; req.reasoningEffort = 'low';
      const began = performance.now();
      let answer = '', answerMs = 0, usage: unknown;
      for await (const event of codexProvider.stream(req, { apiKey: null, signal: AbortSignal.timeout(45000) })) {
        if (event.type === 'delta') { answer += event.text; answerMs = performance.now() - began; }
        if (event.type === 'usage') usage = event;
      }
      const row = { case: i + 1, variant, question: c.question, answerMs, words: answer.trim().split(/\s+/).length, answer, usage };
      results.push(row); console.log(JSON.stringify(row));
    }
  }
  mkdirSync('reports/2026-09-22-participation-speed', { recursive: true });
  writeFileSync('reports/2026-09-22-participation-speed/results.json', JSON.stringify(results, null, 2), { mode: 0o600 });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
