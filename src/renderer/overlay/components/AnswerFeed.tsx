import React, { memo, useState } from 'react';
import { useOverlayStore, type AnswerItem } from '../store';
import { renderMarkdown } from '../markdown';
import { expandAnswer, retryAnswer } from '../controller';
import { useReadingAnchor } from './useReadingAnchor';

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
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// Stable text and card props keep old answers out of each streamed update.
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }): React.JSX.Element {
  // renderMarkdown escapes all model output before injecting.
  return <div className="body" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
});

const AnswerCard = memo(function AnswerCard({ a, labels, professor }: {
  a: AnswerItem;
  labels: boolean;
  professor: number | null;
}): React.JSX.Element {
  const phaseLabel = (a: AnswerItem): string => a.refinement === 'queued' || a.refinement === 'answering' ? 'Updating context…'
    : a.refinement === 'done' ? 'Context updated' : a.refinement === 'error' ? 'Original kept · update failed'
    : a.phase === 'answering' ? 'Answering…'
    : a.phase === 'queued' ? 'Queued' : a.phase === 'error' ? 'Needs attention' : 'Ready';
  return (
    <article className={`answer-item phase-${a.phase ?? 'done'}`} data-answer-id={String(a.id)}>
      <div className="row-head">
        <div className="question-text">{a.responseKind === 'question-suggestion' ? 'Possible discussion question'
          : a.question || 'Latest speech'}</div>
        <time>{a.ts}</time>
      </div>
      <div className="meta">
        {a.responseKind === 'question-suggestion' && <span>Question to ask · draft</span>}
        {labels && a.speaker !== undefined && <span>{a.speaker === professor ? 'Professor' : `Speaker ${a.speaker}`}</span>}
        <span className={`phase-badge ${a.refinement && a.refinement !== 'done' ? `refine-${a.refinement}` : a.phase ?? 'done'}`}>{phaseLabel(a)}</span>
        <span className="spacer" />
        {a.text && <CopyButton text={a.text} />}
      </div>
      {a.responseKind === 'question-suggestion' && <div className="draft-note">Choose whether and when to ask; this is not spoken automatically.</div>}
      {a.contextHint && <details className="question-context"><summary>Discussion context</summary><div>{a.contextHint}</div></details>}
      {a.error ? (
        <div className="err" role="alert" title={a.error}>{a.error}</div>
      ) : (
        <MarkdownBody text={a.text} />
      )}
      {a.phase === 'error' && a.canRetry && <button className="ghost-btn card-action"
        onClick={() => retryAnswer(a.id)}>Retry answer</button>}
      {a.phase === 'done' && a.text && a.responseKind !== 'question-suggestion' && <button className="ghost-btn card-action"
        disabled={a.refinement === 'queued' || a.refinement === 'answering' || a.expansion?.phase === 'queued' || a.expansion?.phase === 'answering'}
        onClick={() => expandAnswer(a.id)}>
        {a.expansion?.phase === 'queued' ? 'Expansion queued…' : a.expansion?.phase === 'answering' ? 'Expanding…'
          : a.expansion?.phase === 'done' ? a.expansion.visible ? 'Collapse' : 'Show expanded'
          : a.expansion?.phase === 'error' ? 'Retry expansion' : 'Expand'}
      </button>}
      {a.expansion?.visible && <div className="expanded-answer">
        <div className="meta"><span>Expanded explanation</span>{a.expansion.text && <CopyButton text={a.expansion.text} />}</div>
        {a.expansion.error && <div className="err" title={a.expansion.error}>{a.expansion.error}</div>}
        <MarkdownBody text={a.expansion.text} />
      </div>}
    </article>
  );
});

export const AnswerFeed = memo(function AnswerFeed(): React.JSX.Element {
  const answers = useOverlayStore((s) => s.answers);
  const professor = useOverlayStore(s => s.professorSpeaker);
  const labels = useOverlayStore(s => s.settings?.stt.diarize ?? false);
  const reading = useReadingAnchor<HTMLDivElement>(answers);
  const quiet = answers.filter(a => a.phase === 'skipped' || a.phase === 'cancelled');
  const visible = answers.filter(a => a.phase !== 'skipped' && a.phase !== 'cancelled');

  return (
    <div className="feed">
      <div
        id="answers"
        ref={reading.ref}
        onScroll={reading.onScroll}
        onPointerEnter={reading.onPointerEnter}
        onPointerLeave={reading.onPointerLeave}
      >
        {visible.length === 0 && (
          <div className="empty-hint">
            Answers appear here when a question is detected. Use Ask now to answer the latest
            thing said.
          </div>
        )}
        {visible.map((a) => (
          <AnswerCard key={a.id} a={a} labels={labels} professor={professor} />
        ))}
        {quiet.length > 0 && <details className="quiet-answers"><summary>{quiet.length} skipped or cancelled</summary>
          {quiet.map(a => <div key={a.id} className="quiet-answer"><span>{a.ts} · {a.phase}</span><div>{a.question}</div></div>)}
        </details>}
      </div>
      {reading.away && (
        <button className="scroll-btn" onClick={reading.jumpToNewest}>
          {reading.newer > 0 ? `${reading.newer} newer` : 'Back to newest'}
        </button>
      )}
    </div>
  );
});
