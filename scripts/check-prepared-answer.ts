// Opt-in local-file grounding smoke check. Uses Codex account quota, no audio.
// npx esbuild scripts/check-prepared-answer.ts --bundle --platform=node --format=cjs | node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { ProfileSchema } from '../src/shared/profile-schema';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import { loadPreparedContext } from '../src/main/services/prepared-context';
import { buildAnswerRequest } from '../src/main/services/prompt-builder';
import { codexProvider } from '../src/main/services/llm/codex';

async function main() {
  const profile = ProfileSchema.parse(load(readFileSync('profiles/canadian-politics.yaml', 'utf8')));
  const knowledgeDir = process.env.CLASSROOM_KNOWLEDGE_DIR ?? join(homedir(), 'Library', 'Application Support', 'Classroom Copilot', 'knowledge');
  const path = join(knowledgeDir, 'polisci-2530f.context.json');
  const start = performance.now();
  const knowledge = loadPreparedContext(path, profile.id);
  if (knowledge.length < 2) throw new Error('No current prepared bundle');
  console.log(JSON.stringify({ preloadMs: performance.now() - start, excerpts: knowledge.length }));
  for (const question of [
    'Using Gidengil, suggest a testable hypothesis about economic evaluations and vote choice, and one reason a correlation would not prove causation.',
    'Why might social background appear unimportant after controlling for party identification and leader evaluations? Use the supplied reading.',
  ]) {
    const began = performance.now();
    const request = buildAnswerRequest({ profile, knowledge, settings: DEFAULT_SETTINGS,
      fullTranscript: 'We are in the POLISCI 2530F tutorial on vote choice.', newSegment: question,
      userSpeaker: 0, forced: true, codeMode: false });
    request.model = 'gpt-5.6-luna'; request.reasoningEffort = 'low';
    for await (const event of codexProvider.stream(request, { apiKey: null, signal: AbortSignal.timeout(45000) })) {
      if (event.type === 'delta') console.log(JSON.stringify({ answer: event.text, elapsedMs: performance.now() - began }));
      if (event.type === 'usage') console.log(JSON.stringify(event));
    }
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
