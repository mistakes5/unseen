import { describe, expect, it } from 'vitest';
import { detectionDelay } from '../src/renderer/overlay/detection-timing';

describe('question scheduling without changing semantic sensitivity', () => {
  it('removes 500 ms of wait for question-mark-ended speech', () => {
    expect(detectionDelay([{ text: 'Why is sovereignty important?', receivedAt: 1000 }], 1000)).toBe(250);
  });
  it.each(['Could someone who did the reading', 'How does sovereignty', 'Some terms for that chart.'])('keeps context settling for %s', text => {
    expect(detectionDelay([{ text, receivedAt: 1000 }], 1000)).toBe(750);
  });
  it('retains the hard deadline under continuous speech', () => {
    expect(detectionDelay([{ text: 'fragment', receivedAt: 1000 }], 3100)).toBe(100);
    expect(detectionDelay([{ text: 'Why?', receivedAt: 1000 }], 3300)).toBe(0);
  });
  it('does not hurry a question while a spoken continuation is arriving', () => {
    expect(detectionDelay([{ text: 'What difference does it make?', receivedAt: 1000 }], 1100, true)).toBe(750);
  });
  it('does not lose earlier fragments when a complete question joins their batch', () => {
    expect(detectionDelay([{ text: 'Reading context', receivedAt: 1000 }, { text: 'Thoughts?', receivedAt: 1300 }], 1300)).toBe(250);
  });
});
