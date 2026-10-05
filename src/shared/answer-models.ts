import type { ModelInfo } from './types';

/** The two configured answer backends each have one default model. */
export const ANSWER_MODEL_DEFAULTS: Record<string, { model: string; label: string; reasoningEffort?: 'low' }> = {
  'omp-codex': { model: 'gpt-6-luna', label: 'GPT-6 Luna · low reasoning · Fast', reasoningEffort: 'low' },
  codex: { model: 'gpt-6-luna', label: 'GPT-6 Luna · low reasoning · Fast', reasoningEffort: 'low' },
  'openai-compatible': { model: 'glm', label: 'GLM' },
};

export function answerProviderSelection(provider: string) {
  const preset = ANSWER_MODEL_DEFAULTS[provider];
  return { llm: { provider, ...(preset ? { model: preset.model, ...(preset.reasoningEffort ? { reasoningEffort: preset.reasoningEffort } : {}) } : {}) } };
}

export function answerModelChoices(provider: string, discovered: ModelInfo[]): ModelInfo[] {
  const preset = ANSWER_MODEL_DEFAULTS[provider];
  return preset ? [{ id: preset.model, label: preset.label }] : discovered;
}
