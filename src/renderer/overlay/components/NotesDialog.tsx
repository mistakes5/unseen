import React, { useEffect, useRef, useState } from 'react';
import type { SessionNotesDialog } from '../../../shared/types';

function NotesIcon({ done = false }: { done?: boolean }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {done ? <path d="m5 12 4 4L19 6" /> : <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>}
  </svg>;
}

export function NotesDialogView({ dialog, onAction }: {
  dialog: SessionNotesDialog; onAction(action: 'create' | 'cancel' | 'open' | 'done'): void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { phase } = dialog;
  const title = phase === 'working' ? 'Piecing it together.' : phase === 'saved' ? 'Your notes are ready.'
    : phase === 'error' ? 'Notes need another try.' : 'Create today’s notes?';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button[data-focus]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase !== 'working') { event.preventDefault(); onAction(phase === 'confirm' ? 'cancel' : 'done'); }
      if (event.key === 'Tab') {
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!buttons.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [phase, onAction]);
  const date = dialog.day ? new Date(`${dialog.day}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';
  return <div className="notes-shade">
    <div ref={ref} className={`notes-dialog notes-${phase}`} role="dialog" aria-modal="true" aria-labelledby="notes-dialog-title" aria-describedby="notes-dialog-description" tabIndex={-1}>
      <div className="notes-dialog-top"><span className="notes-glyph"><NotesIcon done={phase === 'saved'} /></span><span className="notes-eyebrow">CLASS NOTES</span>
        {phase !== 'working' && <button className="notes-close" aria-label="Close notes dialog" onClick={() => onAction(phase === 'confirm' ? 'cancel' : 'done')}>×</button>}
      </div>
      <h2 id="notes-dialog-title">{title}</h2>
      <p id="notes-dialog-description" className="notes-description">{phase === 'confirm'
        ? 'Bring today’s recordings together into one clear set of study notes.'
        : phase === 'working' ? 'Reading every recording, connecting related ideas, and keeping separate topics clear.'
        : phase === 'saved' ? 'Saved beside your course notes, with links back to the transcripts.'
        : 'Your transcripts and previous notes are safe.'}</p>
      {phase === 'error' ? <p className="notes-error" role="alert">{dialog.error}</p> : <div className="notes-course-card">
        <span className="notes-course-name">{dialog.courseName}</span>
        <span className="notes-course-meta">{date}<span>·</span>{dialog.recordings} recording{dialog.recordings === 1 ? '' : 's'}<span>·</span>All of today</span>
      </div>}
      {phase === 'working' ? <div className="notes-progress" role="status"><span className="notes-spinner" />Creating your notes<span className="notes-progress-dots">…</span></div>
        : phase !== 'error' && <div className="notes-model"><span className="notes-model-dot" />GPT-6.1 Sol<span className="notes-low">Low reasoning</span></div>}
      <div className="notes-actions">
        {phase === 'confirm' ? <><button className="notes-secondary" data-focus onClick={() => onAction('cancel')}>Not now</button><button className="notes-primary" onClick={() => onAction('create')}>Create notes <span aria-hidden="true">↗</span></button></>
          : phase === 'saved' ? <><button className="notes-secondary" data-focus onClick={() => onAction('done')}>Done</button><button className="notes-primary" onClick={() => onAction('open')}>Open notes <span aria-hidden="true">↗</span></button></>
          : phase === 'error' ? <button className="notes-secondary" data-focus onClick={() => onAction('done')}>Close</button>
          : <span className="notes-working-hint">Your original recordings stay untouched.</span>}
      </div>
    </div>
  </div>;
}

export function NotesDialog(): React.JSX.Element | null {
  const [dialog, setDialog] = useState<SessionNotesDialog | null>(null);
  useEffect(() => window.unseen.onSessionNotesDialog?.(setDialog), []);
  const onAction = React.useCallback((action: 'create' | 'cancel' | 'open' | 'done') => {
    if (!dialog) return;
    if (action === 'create') setDialog({ ...dialog, phase: 'working' });
    else setDialog(null);
    void window.unseen.sessionNotesRespond(dialog.id, action).catch(() => {
      setDialog({ ...dialog, phase: 'error', error: 'Could not complete that action. Your saved transcripts are safe.' });
    });
  }, [dialog]);
  return dialog ? <NotesDialogView dialog={dialog} onAction={onAction} /> : null;
}
