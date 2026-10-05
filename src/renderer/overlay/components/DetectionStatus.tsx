import React from 'react';
import { useOverlayStore } from '../store';

export function DetectionStatus(): React.JSX.Element {
  const checks = useOverlayStore(s => s.detectionChecks);
  const count = useOverlayStore(s => s.detectionCount);
  const provider = useOverlayStore(s => s.settings?.questionDetection.provider);
  const threshold = useOverlayStore(s => s.settings?.questionDetection.threshold);
  const auto = useOverlayStore(s => s.activeProfile?.triggers.auto);
  const error = useOverlayStore(s => s.detectionError);
  const unchecked = useOverlayStore(s => s.uncheckedSegments);
  const general = useOverlayStore(s => s.activeProfile?.questionDetection?.mode === 'general');
  const saving = useOverlayStore(s => s.settings?.sessions?.autoSave !== false && s.activeProfile?.sessions?.autoSave !== false);
  return <>
    {!saving && <div className="panel-note">Session saving off — transcripts and answers stay in this app session.</div>}
    {error && <div role="status" className="detection-panel">
      <strong>{error}</strong> {unchecked} speech segments went unchecked.
      {' '}Transcription is separate. Ask now bypasses the detector for the latest speech.
    </div>}
    <details className="detection-panel">
    <summary>Question detector <span className="panel-note">{auto ? provider === 'jev' ? 'Jev' : 'rules' : 'off'}{general ? ' · general questions' : ''} · {count} checked · cutoff {threshold?.toFixed(2)}</span></summary>
    <div style={{ maxHeight: 120, overflowY: 'auto' }}>
      {!!unchecked && <div>{unchecked} segments were not classified during detector failures this session; they were not judged below cutoff.</div>}
      {!checks.length && <div>Waiting for finalized speech. Ask now bypasses this detector.</div>}
      {checks.map(c => <div key={c.id} style={{ marginTop: 5 }}>
        <strong>{c.probability.toFixed(2)} · {c.passed ? 'passed gate' : 'below cutoff'}</strong> — {c.text}
      </div>)}
    </div>
  </details></>;
}
