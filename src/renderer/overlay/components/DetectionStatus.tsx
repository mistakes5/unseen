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
    {!saving && <div className="saving-note">Session saving off — transcripts and answers stay in this app session.</div>}
    {error && <div role="status" className="service-notice"
      title={`${error} ${unchecked} speech segments went unchecked. Transcription is separate. Ask now bypasses the detector for the latest speech.`}>
      <strong>{error}</strong> <span>{unchecked} speech segments went unchecked.
      {' '}Transcription is separate. Ask now bypasses the detector for the latest speech.</span>
    </div>}
    <details className="detection-panel">
    <summary>Question detector <span className="panel-note">{auto ? provider === 'jev' ? 'Jev' : 'rules' : 'off'}{general ? ' · general questions' : ''} · {count} checked · cutoff {threshold?.toFixed(2)}</span></summary>
    <div className="detector-log">
      {!!unchecked && <div>{unchecked} segments were not classified during detector failures this session; they were not judged below cutoff.</div>}
      {!checks.length && <div>Waiting for finalized speech. Ask now bypasses this detector.</div>}
      {checks.map(c => <div key={c.id} className={`check ${c.passed ? 'passed' : ''}`}
        title={c.passed ? 'Passed the cutoff' : 'Below cutoff'}>
        <span className="score">{c.probability.toFixed(2)}</span> {c.text}
      </div>)}
    </div>
  </details></>;
}
