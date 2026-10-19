import React, { useEffect, useState } from 'react';
import { useOverlayStore } from './store';
import { askNow, togglePause, toggleListening, isListening } from './controller';
import { Transcript } from './components/Transcript';
import { AnswerFeed } from './components/AnswerFeed';
import { DetectionStatus } from './components/DetectionStatus';
import { NotesDialog } from './components/NotesDialog';
import { ChevronIcon, CloseIcon, EyeIcon, EyeOffIcon, GearIcon, MinusIcon, PauseIcon, PlayIcon, StopIcon } from './components/Icons';

function shortcut(accelerator: string): string {
  return accelerator.replace('CommandOrControl', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '');
}

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
        <div className="title-stack">
          <label className="profile-picker">
            <select
              aria-label="Course"
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
            <ChevronIcon />
          </label>
          <div className={`capture-status ${captureKind}`} role="status" title={status.text}>
            <span className={`dot ${captureKind}`} />
            <span className="status-text">{status.text}</span>
          </div>
        </div>
        <div className="toolbar">
          <button
            className={`capsule-btn ${listening ? 'stop' : 'start'}`}
            title={listening ? 'Stop listening — automatically stops 3 hours after Start' : 'Start listening — automatically stops after 3 hours'}
            onClick={() => {
              const now = toggleListening();
              setListening(now);
              if (!now) setPaused(false);
            }}
          >
            {listening ? <><StopIcon /> Stop</> : <><PlayIcon /> Start</>}
          </button>
          {listening && (
            <button
              className={`icon-btn ${paused ? 'active' : ''}`}
              aria-label={paused ? 'Resume listening' : 'Pause listening'}
              title="Pause/resume listening"
              onClick={() => setPaused(togglePause())}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
          )}
          <button className="capsule-btn" title="Answer the latest thing said" onClick={askNow}>
            Ask now
          </button>
          <span className="toolbar-divider" />
          <button
            className={`icon-btn ${privacyOn ? 'active' : ''}`}
            aria-label={privacyOn ? 'Privacy Mode on' : 'Privacy Mode off'}
            title={
              privacyOn
                ? 'Privacy Mode ON — this window is hidden from screen capture'
                : 'Privacy Mode OFF — this window is visible in screen shares'
            }
            onClick={() => void window.unseen.setPrivacyMode(!privacyOn)}
          >
            {privacyOn ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => void window.unseen.openSettings()}><GearIcon /></button>
          <button className="icon-btn" title="Minimize" aria-label="Minimize" onClick={() => void window.unseen.overlayMinimize()}><MinusIcon /></button>
          <button className="icon-btn quit" title="Quit Unseen" aria-label="Quit Unseen" onClick={() => void window.unseen.quit()}><CloseIcon /></button>
        </div>
      </header>

      <Transcript />
      <DetectionStatus />

      <AnswerFeed />

      <footer>
        <span className="hotkeys">
          {settings && <>
            <kbd>{shortcut(settings.hotkeys.toggleVisibility)}</kbd> hide
            <kbd>{shortcut(settings.hotkeys.askNow)}</kbd> ask
          </>}
        </span>
        <span className="cost">
          {usage
            ? `${usage.inputTokens.toLocaleString()} in, ${usage.outputTokens.toLocaleString()} out${
                sessionCost > 0 ? `, ~$${sessionCost.toFixed(4)}` : ''
              }`
            : ''}
        </span>
      </footer>
      <NotesDialog />
    </div>
  );
}
