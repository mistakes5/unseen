import React, { useEffect, useState } from 'react';
import type { SessionMeta } from '../../../shared/types';
import type { TabProps } from '../App';

function fmtDate(t: number): string {
  return new Date(t).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(meta: SessionMeta): string {
  const min = Math.round((meta.endedAt - meta.startedAt) / 60_000);
  return min < 1 ? '<1 min' : `${min} min`;
}

export function SessionsTab({ settings, update }: TabProps): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [exported, setExported] = useState<string | null>(null);
  const [course, setCourse] = useState(settings.activeProfile);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ sessionId: string; t: number; type: string; text: string }[]>([]);
  const courses = [...new Map(sessions.filter(s => s.profileId).map(s => [s.profileId!, s.profileName ?? s.profileId!])).entries()];
  if (!courses.some(([id]) => id === settings.activeProfile)) courses.push([settings.activeProfile, settings.activeProfile]);

  const refresh = (): void => {
    void window.unseen.sessionsList().then(setSessions);
  };
  useEffect(refresh, []);

  return (
    <div>
      <h2>Sessions</h2>
      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.sessions.autoSave}
            onChange={(e) => update({ sessions: { autoSave: e.target.checked } })}
          />
          Record sessions (transcript + answers, stored only on this machine)
        </label>
      </div>

      {exported && <div className="verify ok">✓ Exported to {exported}</div>}
      <div className="field">
        <label>Class archive</label>
        <select value={course} onChange={e => { setCourse(e.target.value); setHits([]); }}>
          {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="">Legacy / unclassified</option>
        </select>
      </div>
      <div className="row">
        <input aria-label="Search this class transcript" placeholder="Search saved transcript + questions + answers" value={query} onChange={e => setQuery(e.target.value)} />
        <button className="btn secondary" onClick={() => { void window.unseen.sessionsSearch(course, query).then(setHits); }}>Search class</button>
      </div>
      <p style={{ fontSize: 12, color: '#888' }}>Local text archive, indexed by class and session date. Search runs only when requested; recordings are not saved.</p>
      {hits.map((hit, i) => <div key={i} className="profile-card" style={{ display: 'block' }}>
        <div className="desc">{fmtDate(hit.t)} · {hit.type}</div><div>{hit.text}</div>
      </div>)}

      {sessions.length === 0 ? (
        <p style={{ color: '#888', fontSize: 12, marginTop: 12 }}>
          No recorded sessions yet. Once the copilot hears speech, a session file starts
          automatically (when recording is on).
        </p>
      ) : (
        sessions.filter(s => (s.profileId ?? '') === course).map((s) => (
          <div className="profile-card" key={s.id} style={{ cursor: 'default' }}>
            <span className="icon">🗒️</span>
            <div>
              <div className="name">{s.profileName ?? s.profileId ?? 'Unclassified'} · {fmtDate(s.startedAt)}</div>
              <div className="desc">
                {fmtDuration(s)} · {s.finals} transcript segments · {s.questions ?? 0} questions · {s.answers} answers
              </div>
            </div>
            <div className="spacer" />
            <button
              className="btn secondary"
              onClick={async () => {
                const res = await window.unseen.sessionsExport(s.id);
                if (res.ok && res.path) setExported(res.path);
              }}
            >
              Export .md
            </button>
            <button
              className="btn secondary"
              onClick={async () => {
                await window.unseen.sessionsDelete(s.id);
                refresh();
              }}
            >
              Delete
            </button>
          </div>
        ))
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={() => void window.unseen.sessionsOpenFolder()}>
          Open sessions folder…
        </button>
        <button className="btn secondary" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
