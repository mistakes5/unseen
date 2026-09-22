import type { QuestionCandidate } from '../../shared/types';

/** Candidates are verbatim speech spans, not generated questions. Jev judges them. */
export function questionSpans(text: string): string[] {
  return (text.match(/[^?]+\?+|[^?]+$/gu) ?? []).flatMap(part => {
    // Keep multi-sentence setup with its question. Separate unpunctuated
    // discussion invitations only when the transcript supplies a boundary.
    if (part.endsWith('?')) return [part.trim()];
    return Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(part), s => s.segment.trim());
  }).filter(Boolean);
}

/** FIFO with independent IDs: completing Q2 cannot write into Q1's card. */
export class AnswerQueue {
  private waiting: QuestionCandidate[] = [];
  private active = new Map<string, QuestionCandidate>();
  constructor(private start: (q: QuestionCandidate) => void, readonly concurrency = 2) {}
  enqueue(q: QuestionCandidate): void { this.waiting.push(q); this.sort(); this.pump(); }
  prioritize(speaker: number | null): void {
    for (const q of this.waiting) if (q.priority !== -1) q.priority = q.speaker === speaker ? 1 : 0;
    this.sort();
  }
  private sort(): void { this.waiting.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)); }
  finish(id: string): boolean {
    if (!this.active.delete(id)) return false;
    this.pump(); return true;
  }
  has(id: string): boolean { return this.active.has(id); }
  get running(): number { return this.active.size; }
  get pending(): number { return this.waiting.length; }
  clear(): QuestionCandidate[] {
    const items = [...this.active.values(), ...this.waiting];
    this.waiting = []; this.active.clear(); return items;
  }
  private pump(): void {
    while (this.active.size < this.concurrency && this.waiting.length) {
      const q = this.waiting.shift()!; this.active.set(q.id, q); this.start(q);
    }
  }
}
