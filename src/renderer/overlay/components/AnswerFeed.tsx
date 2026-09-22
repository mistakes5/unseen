import React, { useEffect, useRef, useState } from 'react';
import { useOverlayStore } from '../store';
import { renderMarkdown } from '../markdown';
import { expandAnswer } from '../controller';

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost-btn copy-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? '✓' : 'copy'}
    </button>
  );
}

export function AnswerFeed(): React.JSX.Element {
  const answers = useOverlayStore((s) => s.answers);
  const professor = useOverlayStore(s => s.professorSpeaker);
  const labels = useOverlayStore(s => s.settings?.stt.diarize ?? false);
  const ref = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; setShowScrollBtn(false); }, [answers.length]);

  return (
    <>
      <div
        id="answers"
        ref={ref}
        onScroll={(e) => setShowScrollBtn(e.currentTarget.scrollTop > 30)}
      >
        {answers.length === 0 && (
          <div className="empty-hint">
            Answers appear here when a question is detected — or hit “Ask now” to answer the
            latest thing said.
          </div>
        )}
        {answers.map((a) => (
          <div className="answer-item" key={a.id}>
            <div className="meta">
              <span>{a.ts} · {labels && a.speaker !== undefined ? `${a.speaker === professor ? 'Professor' : `S${a.speaker}`} · ` : ''}{a.phase ?? (a.done ? 'done' : 'answering')}</span>
              {a.text && <CopyButton text={a.text} />}
            </div>
            {a.question && <div style={{ fontWeight: 600, margin: '4px 0 6px' }}>{a.question}</div>}
            {a.error ? (
              <span className="err">error: {a.error}</span>
            ) : (
              <div
                className="body"
                // renderMarkdown escapes all model output before injecting.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(a.phase === 'skipped' ? 'No answer generated — skipped.' : a.text) }}
              />
            )}
            {a.phase === 'done' && a.text && <button className="ghost-btn"
              disabled={a.expansion?.phase === 'queued' || a.expansion?.phase === 'answering'}
              onClick={() => expandAnswer(a.id)}>
              {a.expansion?.phase === 'queued' ? 'Expansion queued…' : a.expansion?.phase === 'answering' ? 'Expanding…'
                : a.expansion?.phase === 'done' ? a.expansion.visible ? 'Collapse' : 'Show expanded'
                : a.expansion?.phase === 'error' ? 'Retry expansion' : 'Expand'}
            </button>}
            {a.expansion?.visible && <div style={{ borderTop: '1px solid currentColor', marginTop: 8, paddingTop: 8 }}>
              <div className="meta"><span>Expanded explanation</span>{a.expansion.text && <CopyButton text={a.expansion.text} />}</div>
              {a.expansion.error && <span className="err">{a.expansion.error}</span>}
              <div className="body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.expansion.text) }} />
            </div>}
          </div>
        ))}
      </div>
      {showScrollBtn && (
        <button
          className="ghost-btn scroll-btn"
          onClick={() => {
            const el = ref.current;
            if (el) el.scrollTop = 0;
            setShowScrollBtn(false);
          }}
        >
          ↑ newest
        </button>
      )}
    </>
  );
}
