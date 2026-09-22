import React, { useLayoutEffect, useRef, useState } from 'react';
import { useOverlayStore, type AnswerItem } from '../store';
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
  const nearTop = useRef(true);
  const previous = useRef({ count: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (answers.length > previous.current.count) {
      if (nearTop.current) { el.scrollTop = 0; setShowScrollBtn(false); }
      else { el.scrollTop += el.scrollHeight - previous.current.height; setShowScrollBtn(true); }
    }
    previous.current = { count: answers.length, height: el.scrollHeight };
  });
  const quiet = answers.filter(a => a.phase === 'skipped' || a.phase === 'cancelled');
  const visible = answers.filter(a => a.phase !== 'skipped' && a.phase !== 'cancelled');
  const phaseLabel = (a: AnswerItem): string => a.phase === 'answering' ? 'Answering…'
    : a.phase === 'queued' ? 'Queued' : a.phase === 'error' ? 'Needs attention' : 'Ready';

  return (
    <>
      <div
        id="answers"
        ref={ref}
        onScroll={(e) => { nearTop.current = e.currentTarget.scrollTop <= 30; setShowScrollBtn(!nearTop.current); }}
      >
        {visible.length === 0 && (
          <div className="empty-hint">
            Answers appear here when a question is detected — or hit “Ask now” to answer the
            latest thing said.
          </div>
        )}
        {visible.map((a) => (
          <article className={`answer-item phase-${a.phase ?? 'done'}`} key={a.id}>
            <div className="meta">
              <span>{a.ts}{labels && a.speaker !== undefined ? ` · ${a.speaker === professor ? 'Professor' : `S${a.speaker}`}` : ''}</span>
              <span className={`phase-badge ${a.phase ?? 'done'}`}>{phaseLabel(a)}</span>
              {a.text && <CopyButton text={a.text} />}
            </div>
            {a.question && <div className="question-text">{a.question}</div>}
            {a.contextHint && <details className="question-context"><summary>Discussion context</summary><div>{a.contextHint}</div></details>}
            {a.error ? (
              <span className="err">error: {a.error}</span>
            ) : (
              <div
                className="body"
                // renderMarkdown escapes all model output before injecting.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(a.text) }}
              />
            )}
            {a.phase === 'done' && a.text && <button className="ghost-btn"
              disabled={a.expansion?.phase === 'queued' || a.expansion?.phase === 'answering'}
              onClick={() => expandAnswer(a.id)}>
              {a.expansion?.phase === 'queued' ? 'Expansion queued…' : a.expansion?.phase === 'answering' ? 'Expanding…'
                : a.expansion?.phase === 'done' ? a.expansion.visible ? 'Collapse' : 'Show expanded'
                : a.expansion?.phase === 'error' ? 'Retry expansion' : 'Expand'}
            </button>}
            {a.expansion?.visible && <div className="expanded-answer">
              <div className="meta"><span>Expanded explanation</span>{a.expansion.text && <CopyButton text={a.expansion.text} />}</div>
              {a.expansion.error && <span className="err">{a.expansion.error}</span>}
              <div className="body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.expansion.text) }} />
            </div>}
          </article>
        ))}
        {quiet.length > 0 && <details className="quiet-answers"><summary>{quiet.length} skipped or cancelled · show history</summary>
          {quiet.map(a => <div key={a.id} className="quiet-answer"><span>{a.ts} · {a.phase}</span><div>{a.question}</div></div>)}
        </details>}
      </div>
      {showScrollBtn && (
        <button
          className="ghost-btn scroll-btn"
          onClick={() => {
            const el = ref.current;
            if (el) el.scrollTop = 0;
            nearTop.current = true;
            setShowScrollBtn(false);
          }}
        >
          ↑ newest
        </button>
      )}
    </>
  );
}
