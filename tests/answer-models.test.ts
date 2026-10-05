import { expect, it } from 'vitest';
import { answerModelChoices, answerProviderSelection } from '../src/shared/answer-models';

it('switches from any model to GPT-6 Luna with low reasoning when choosing Codex', () => {
  expect(answerProviderSelection('codex')).toEqual({ llm: { provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'low' } });
  expect(answerModelChoices('codex', [{ id: 'gpt-5.6-luna' }]).map(m => m.id)).toEqual(['gpt-6-luna']);
});

it('switches to the same exact Luna low model for OMP rather than retaining a GLM model', () => {
  expect(answerProviderSelection('omp-codex')).toEqual({ llm: { provider: 'omp-codex', model: 'gpt-6-luna', reasoningEffort: 'low' } });
  expect(answerModelChoices('omp-codex', [{ id: 'glm' }]).map(m => m.id)).toEqual(['gpt-6-luna']);
});

it('switches to GLM for the existing compatible server', () => {
  expect(answerProviderSelection('openai-compatible')).toEqual({ llm: { provider: 'openai-compatible', model: 'glm' } });
  expect(answerModelChoices('openai-compatible', [{ id: 'another-server-model' }]).map(m => m.id)).toEqual(['glm']);
});

it('preserves model discovery for other providers', () => {
  const models = [{ id: 'local-model' }];
  expect(answerModelChoices('ollama', models)).toEqual(models);
  expect(answerProviderSelection('ollama')).toEqual({ llm: { provider: 'ollama' } });
});
