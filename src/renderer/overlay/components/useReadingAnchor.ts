import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface ReadingSignals {
  /** Pixels scrolled away from the newest card at the top of the feed. */
  scrollTop: number;
  /** The pointer is resting over the answer feed. */
  pointerInside: boolean;
  /** Text inside the feed is selected (copying or highlighting a passage). */
  hasSelection: boolean;
}

/**
 * Decide whether the card being read stays fixed when answers arrive or grow above it.
 * Holding keeps the reader's place; not holding lets the newest answer appear in view.
 */
export function shouldHoldPosition(s: ReadingSignals): boolean {
  return s.scrollTop > 4 || s.pointerInside || s.hasSelection;
}

interface Anchor { id: string; offset: number }

// Newest-first feed: new and streaming cards land ABOVE the reader. Chromium's
// overflow-anchor is disabled at scrollTop 0 and loses its anchor across React
// re-renders, so the card in view is pinned explicitly: remember which card sits
// at the top of the viewport and its offset, then restore that offset after each
// commit before paint.
export function useReadingAnchor<T extends HTMLElement>(content: unknown): {
  ref: RefObject<T | null>;
  /** Cards scrolled entirely above the viewport. */
  newer: number;
  /** The reader has scrolled away from the newest card. */
  away: boolean;
  onScroll(): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
  jumpToNewest(): void;
} {
  const ref = useRef<T | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const pointerInside = useRef(false);
  const [newer, setNewer] = useState(0);
  const [away, setAway] = useState(false);

  const capture = (): void => {
    const el = ref.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>('[data-answer-id]');
    // Anchor the card under the reading line, not one whose last few pixels
    // overlap the top edge; growth in that sliver would push the real passage.
    const readingLine = el.scrollTop + Math.min(80, el.clientHeight * 0.25);
    let above = 0;
    anchor.current = null;
    for (const card of cards) {
      const bottom = card.offsetTop + card.offsetHeight;
      if (bottom <= el.scrollTop) above++;
      if (!anchor.current && bottom > readingLine) {
        anchor.current = { id: card.dataset.answerId!, offset: card.offsetTop - el.scrollTop };
      }
    }
    setNewer(prev => (prev === above ? prev : above));
    const isAway = el.scrollTop > 4;
    setAway(prev => (prev === isAway ? prev : isAway));
  };

  useLayoutEffect(() => {
    const el = ref.current;
    const held = anchor.current;
    if (el && held) {
      const selection = window.getSelection();
      const hold = shouldHoldPosition({
        scrollTop: el.scrollTop,
        pointerInside: pointerInside.current,
        hasSelection: !!selection && !selection.isCollapsed && el.contains(selection.anchorNode),
      });
      const card = hold ? el.querySelector<HTMLElement>(`[data-answer-id="${CSS.escape(held.id)}"]`) : null;
      if (card) {
        const delta = card.offsetTop - el.scrollTop - held.offset;
        if (delta !== 0) el.scrollTop += delta;
      }
    }
    capture();
  }, [content]);

  return {
    ref,
    newer,
    away,
    onScroll: capture,
    onPointerEnter: () => { pointerInside.current = true; },
    onPointerLeave: () => { pointerInside.current = false; },
    jumpToNewest: () => {
      const el = ref.current;
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    },
  };
}
