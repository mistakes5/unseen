import React, { useEffect, useState } from 'react';
import { useOverlayStore } from './store';
import { askNow, togglePause, toggleListening, isListening } from './controller';
import { Transcript } from './components/Transcript';
import { AnswerFeed } from './components/AnswerFeed';
import { DetectionStatus } from './components/DetectionStatus';

export function App(): React.JSX.Element {
  const status = useOverlayStore((s) => s.status);
  const profiles = useOverlayStore((s) => s.profiles);
  const activeProfile = useOverlayStore((s) => s.activeProfile);
  const usage = useOverlayStore((s) => s.usage);
  const sessionCost = useOverlayStore((s) => s.sessionCost);
  const settings = useOverlayStore((s) => s.settings);
  const setActiveProfile = useOverlayStore((s) => s.setActiveProfile);
  const [listening, setListening] = useState(isListening());
  const [paused, setPaused] = useState(false);
  // Capture can also finish itself (finite replay), not only via this button.
  useEffect(() => {
    const active = isListening();
    setListening(active);
    if (!active) setPaused(false);
  }, [status]);

  const privacyOn = settings?.overlay.privacyMode ?? true;
  const fontSize = settings?.overlay.fontSize ?? 13;
  const captureKind = status.kind === 'error' ? 'error' : paused ? 'paused'
    : listening && (status.kind === 'live' || status.kind === 'thinking') ? 'live' : 'idle';

  const onProfileChange = async (id: string): Promise<void> => {
    const profile = await window.unseen.profilesSetActive(id);
    setActiveProfile(profile);
  };

  return (
    <div id="app" style={{ ['--answer-font-size' as never]: `${fontSize + 0.5}px` }}>
      <header>
        <select
          className="profile-picker"
          value={activeProfile?.id ?? ''}
          onChange={(e) => void onProfileChange(e.target.value)}
          title={activeProfile?.description}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.name}
            </option>
          ))}
        </select>
        <div className="window-controls">
          <button
            className={`ghost-btn ${privacyOn ? 'active' : ''}`}
            title={
              privacyOn
                ? 'Privacy Mode ON — this window is hidden from screen capture'
                : 'Privacy Mode OFF — this window is visible in screen shares'
            }
            onClick={() => void window.unseen.setPrivacyMode(!privacyOn)}
          >
            {privacyOn ? '🙈' : '👁'}
          </button>
          <button className="ghost-btn" title="Minimize" aria-label="Minimize" onClick={() => void window.unseen.overlayMinimize()}>—</button>
          <button className="ghost-btn" title="Settings" aria-label="Settings" onClick={() => void window.unseen.openSettings()}>⚙</button>
          <button className="ghost-btn" title="Quit Unseen" aria-label="Quit Unseen" onClick={() => void window.unseen.quit()}>✕</button>
        </div>
      </header>
      <div className="capture-bar">
        <div className="capture-status" role="status">
          <span className={`dot ${captureKind}`} />
          <span className="status-text">{status.text}</span>
        </div>
        <div className="capture-actions">
          <button
            className={`ghost-btn ${listening ? 'active' : ''}`}
            title={listening ? 'Stop listening' : 'Start listening'}
            onClick={() => {
              const now = toggleListening();
              setListening(now);
              if (!now) setPaused(false);
            }}
          >
            {listening ? '⏹ Stop' : '▶ Start'}
          </button>
          {listening && (
            <button
              className="ghost-btn"
              title="Pause/resume listening"
              onClick={() => setPaused(togglePause())}
            >
              {paused ? '▶' : '⏸'}
            </button>
          )}
          <button className="ghost-btn" title="Answer the latest thing said" onClick={askNow}>
            Ask now
          </button>
        </div>
      </div>

      <Transcript />
      <DetectionStatus />

      <div className="section-label">Answers</div>
      <AnswerFeed />

      <footer>
        <span>
          {settings
            ? `${settings.hotkeys.toggleVisibility.replace('CommandOrControl', '⌘')} hide · ${settings.hotkeys.askNow.replace('CommandOrControl', '⌘')} ask`
            : ''}
        </span>
        <span className="cost">
          {usage
            ? `in ${usage.inputTokens} · out ${usage.outputTokens}${
                sessionCost > 0 ? ` · ~$${sessionCost.toFixed(4)}` : ''
              }`
            : '—'}
        </span>
      </footer>
    </div>
  );
}
