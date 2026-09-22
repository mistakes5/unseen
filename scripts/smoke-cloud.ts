// Explicit opt-in live check; not part of npm test. Uses only synthetic text.
// npx esbuild scripts/smoke-cloud.ts --bundle --platform=node --format=cjs | node
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { detectQuestion } from '../src/main/services/question-detection';
import { codexProvider } from '../src/main/services/llm/codex';

async function main(): Promise<void> {
  const key = execFileSync('/usr/bin/security', ['find-generic-password', '-a', userInfo().username, '-s', 'TYPESAFE_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 }).trim();
  const signal = AbortSignal.timeout(45_000);
  const start = Date.now();
  const question = 'How is civic nationalism different from ethnic nationalism, and can a state contain both?';
  const base = { forced: false, codeMode: false, userSpeaker: 0 };
  const probability = await detectQuestion({ ...base, fullTranscript: 'We are discussing national identity and membership.', newSegment: question }, key, signal);
  console.log(JSON.stringify({ questionProbability: probability, detectionMs: Date.now() - start }));
  if (probability < 0.8) throw new Error('Synthetic question did not pass Jev gate');
  const answerStart = Date.now();
  for await (const event of codexProvider.stream({
    model: 'gpt-5.6-luna', reasoningEffort: 'low', maxTokens: 2000,
    system: [{ text: 'Offer a 40–90 word, accurate classroom contribution for Political Identities. No invented citations. Only answer the question.' }],
    messages: [{ role: 'user', content: question }],
  }, { apiKey: null, signal })) {
    if (event.type === 'delta') console.log(JSON.stringify({ answer: event.text, answerMs: Date.now() - answerStart }));
  }
  const nonQuestion = await detectQuestion({ ...base, fullTranscript: 'The lecture is starting.', newSegment: 'Please open your notebooks. I am going to put the title on the board.' }, key, signal);
  console.log(JSON.stringify({ statementProbability: nonQuestion, totalMs: Date.now() - start }));
  if (nonQuestion >= 0.8) throw new Error('Synthetic logistics was not rejected');
  console.log('PASS: Jev question/statement classification and Codex Luna low answer.');
}
main().catch(() => { console.error('Cloud smoke check failed; credentials were not logged.'); process.exitCode = 1; });
