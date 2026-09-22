import type { TranscriptEvent, WordTiming } from '../../../shared/types';

/** Preserve within-result speaker changes instead of assigning majority speaker. */
export function speakerTurns(event: TranscriptEvent): TranscriptEvent[] {
  if (event.type !== 'final' || !event.words?.length || !event.words.some(w => w.speaker !== undefined && w.speaker !== event.speaker)) return [event];
  const groups: { speaker: number; words: WordTiming[] }[] = [];
  for (const word of event.words) {
    const speaker = word.speaker ?? event.speaker;
    const last = groups.at(-1);
    if (last?.speaker === speaker) last.words.push(word);
    else groups.push({ speaker, words: [word] });
  }
  return groups.map(g => ({ type: 'final', speaker: g.speaker, words: g.words,
    text: g.words.map(w => w.punctuated_word ?? w.word).join(' ') }));
}
