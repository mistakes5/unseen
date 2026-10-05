import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileSchema } from '../src/shared/profile-schema';
const state = vi.hoisted(() => ({ active: 'school', autoSave: true, begin: vi.fn(() => 'school/session'), append: vi.fn() }));
const profiles = { school: { id: 'school', name: 'School' }, demo: { id: 'demo', name: 'Demo', sessions: { autoSave: false } } };
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => 'test' }, dialog: {}, shell: {}, webContents: { getAllWebContents: () => [] } }));
vi.mock('../src/main/services/settings', () => ({ settings: () => ({ get: () => ({ sessions: { autoSave: state.autoSave } }) }) }));
vi.mock('../src/main/services/profiles', () => ({ getActiveProfile: () => profiles[state.active as keyof typeof profiles], getProfile: (id: string) => profiles[id as keyof typeof profiles] }));
vi.mock('../src/main/services/session-archive', () => ({ SessionArchive: class { begin = state.begin; append = state.append; } }));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
import { beginSession, recordEvent } from '../src/main/services/sessions';

describe('profile session saving', () => {
  beforeEach(() => { state.active = 'school'; state.autoSave = true; vi.clearAllMocks(); });
  it('validates general detection and unsaved profiles without changing defaults', () => {
    const base = { id: 'demo', name: 'Demo', prompt: { system: 'Help answer questions.' } };
    const parsed = ProfileSchema.parse({ ...base, sessions: { autoSave: false }, questionDetection: { mode: 'general' } });
    expect(parsed.sessions?.autoSave).toBe(false);
    expect(parsed.questionDetection?.mode).toBe('general');
    expect(ProfileSchema.parse(base).sessions).toBeUndefined();
    expect(ProfileSchema.parse(base).questionDetection).toBeUndefined();
    expect(ProfileSchema.safeParse({ ...base, questionDetection: { mode: 'all-statements' } }).success).toBe(false);
  });
  it('never begins an archive or writes Demo speech, checks, answers or errors', () => {
    state.active = 'demo';
    expect(beginSession()).toBe('');
    recordEvent({ t: 1, type: 'final', text: 'Private speech', speaker: 0, profileId: 'demo' });
    recordEvent({ t: 2, type: 'answer', text: 'Private answer', profileId: 'demo', forced: false }, 'demo/stale');
    recordEvent({ t: 3, type: 'answer-status', text: 'Private error', profileId: 'demo', questionId: 'q', status: 'error' });
    recordEvent({ t: 4, type: 'question-check', text: 'Private check', profileId: 'demo', questionId: 'q', probability: 1, threshold: 0.65, passed: true, elapsedMs: 1, promptVersion: 'test' });
    expect(state.begin).not.toHaveBeenCalled(); expect(state.append).not.toHaveBeenCalled();
  });
  it('blocks late Demo answers after switching back to school', () => {
    beginSession(); state.append.mockClear();
    recordEvent({ t: 2, type: 'answer', text: 'Private answer', profileId: 'demo', forced: false });
    recordEvent({ t: 2, type: 'answer', text: 'Private answer', profileId: 'demo', forced: false }, 'school/session');
    expect(state.append).not.toHaveBeenCalled();
  });
  it('retains school saving and its pending answers while Demo is active', () => {
    expect(beginSession()).toBe('school/session'); state.active = 'demo'; beginSession();
    recordEvent({ t: 2, type: 'answer', text: 'School answer', profileId: 'school', forced: false }, 'school/session');
    expect(state.append).toHaveBeenCalledOnce();
    expect(state.append.mock.calls[0][0]).toBe('school/session');
  });
  it('global autosave off still blocks school saving', () => {
    state.autoSave = false;
    expect(beginSession()).toBe('');
    recordEvent({ t: 2, type: 'final', text: 'Speech', profileId: 'school', speaker: 0 }, 'school/session');
    expect(state.begin).not.toHaveBeenCalled(); expect(state.append).not.toHaveBeenCalled();
  });
});
