import React from 'react';
import { useOverlayStore } from '../store';

export function DetectionStatus(): React.JSX.Element {
  const checks = useOverlayStore(s => s.detectionChecks);
  const count = useOverlayStore(s => s.detectionCount);
  const provider = useOverlayStore(s => s.settings?.questionDetection.provider);
  const threshold = useOverlayStore(s => s.settings?.questionDetection.threshold);
  const auto = useOverlayStore(s => s.activeProfile?.triggers.auto);
  return <details className="detection-panel">
    <summary>Question detector <span className="panel-note">{auto ? provider === 'jev' ? 'Jev' : 'rules' : 'off'} · {count} checked · cutoff {threshold?.toFixed(2)}</span></summary>
    <div style={{ maxHeight: 120, overflowY: 'auto' }}>
      {!checks.length && <div>Waiting for finalized speech. Ask now bypasses this detector.</div>}
      {checks.map(c => <div key={c.id} style={{ marginTop: 5 }}>
        <strong>{c.probability.toFixed(2)} · {c.passed ? 'passed gate' : 'below cutoff'}</strong> — {c.text}
      </div>)}
    </div>
  </details>;
}
