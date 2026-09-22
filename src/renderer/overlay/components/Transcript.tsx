import React from 'react';
import { useOverlayStore } from '../store';
import { useStickyScroll } from './useStickyScroll';
import { setProfessorSpeaker } from '../controller';

export function Transcript(): React.JSX.Element {
  const turns = useOverlayStore((s) => s.turns);
  const interim = useOverlayStore((s) => s.interim);
  const ref = useStickyScroll<HTMLDivElement>([turns, interim]);
  const professor = useOverlayStore(s => s.professorSpeaker);
  const labels = useOverlayStore(s => s.settings?.stt.diarize ?? false);
  const sessionError = useOverlayStore(s => s.sessionError);
  const speakers = [...new Set(turns.map(t => t.speaker))].sort((a, b) => a - b);

  return (
    <details className="transcript-panel" open>
      <summary>Live transcript <span className="panel-note">{labels ? 'speaker labels on' : 'speaker labels off'}</span></summary>
      {labels && <label className="speaker-control">
        Prioritize {' '}
        <select aria-label="Professor voice" value={professor ?? ''} onChange={e => setProfessorSpeaker(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Choose professor’s speaker</option>
          {speakers.map(s => <option key={s} value={s}>Speaker S{s}</option>)}
        </select>
        {professor !== null && <span className="panel-note">Professor first</span>}
      </label>}
      {sessionError && <div role="alert" style={{ color: '#ff8080', padding: 8 }}>{sessionError}</div>}
      <div id="transcript" ref={ref}>
      {turns.length === 0 && !interim ? (
        <span className="placeholder">Waiting for audio…</span>
      ) : (
        <>
          {turns.map((t, i) => (
            <div key={i}>
              {labels && <span className="speaker-label">{t.speaker === professor ? `Professor · S${t.speaker}` : `S${t.speaker}`} </span>}{t.text}
            </div>
          ))}
          {interim && <span className="interim">{interim}</span>}
        </>
      )}
      </div>
    </details>
  );
}
