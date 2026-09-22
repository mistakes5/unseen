import type { AnswerPayload, LlmRequest } from '../../shared/types';

export function buildExpansionRequest(original: LlmRequest, answer: string, profileId: string): LlmRequest {
  const guidance = [
    'EXPAND THE ORIGINAL ANSWER — this follow-up overrides earlier short-answer word limits and latest-segment/SKIP directives.',
    'Stay with the original question and its supplied course evidence, not a newer topic. Treat the previous answer as an unverified draft; correct it if needed.',
    'Write 100–180 words in very simple, natural spoken English. Give a little more explanation, one concrete example when useful, and an important qualification. Define any necessary jargon. No setup commentary.',
    'Do not invent readings, quotations, facts, or citations. Distinguish what the supplied readings support from your own inference. Do not search or use tools.',
    'The original conversation determines the topic. Readings are optional support: use ordinary reasoning and clearly illustrative examples when appropriate, without forcing a citation or claiming the reading establishes them.',
  ];
  if (profileId === 'political-identities') guidance.push(
    'POLISCI 3304F discussion preference: when the discussion is one-sided and a credible contrasting perspective adds substance, include a brief, clearly signposted devil’s-advocate contribution, such as “To play devil’s advocate…” or “Someone on the other side might argue…”.',
    'Explain the strongest fair version of that perspective and why someone could hold it. Connect it to the original question and supplied course concepts, then add a simple limitation or response. If appropriate, consider a fair reply to that counterargument too; do not force an endless back-and-forth.',
    'Do not imply the speaker endorses the counterview. Do not manufacture disagreement, false balance, or equal evidence for unequal claims. Omit the counterview for purely factual questions where it does not help. Never promise participation marks or claim a verified grading policy.',
  );
  return {
    ...original,
    system: [...original.system, { text: guidance.join('\n'), cacheable: true }],
    messages: [...original.messages, { role: 'assistant', content: answer },
      { role: 'user', content: 'Expand the original answer above using the expansion instructions. Keep the same original question and course evidence.' }],
    maxTokens: Math.max(original.maxTokens, 650),
  };
}

export interface AnswerSnapshot {
  owner: number;
  profileId: string;
  payload: AnswerPayload;
  request: LlmRequest;
  answer: string;
}

/** Bounded, memory-only: never re-search files or replace context with newer speech. */
export class AnswerSnapshots {
  private entries = new Map<string, AnswerSnapshot>();
  constructor(private limit = 100) {}
  save(id: string, value: AnswerSnapshot): void {
    this.entries.delete(id);
    this.entries.set(id, structuredClone(value));
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  get(id: string, owner: number, profileId: string): AnswerSnapshot {
    const value = this.entries.get(id);
    if (!value || value.owner !== owner || value.profileId !== profileId) {
      throw new Error('Original answer context is unavailable for this class. Ask the question again.');
    }
    return structuredClone(value);
  }
}
