import { create } from 'zustand';
import type { Profile, ProfileSummary, Settings, Usage } from '../../shared/types';
import type { TranscriptTurn } from './transcript-store';

export interface AnswerItem {
  id: string | number;
  ts: string;
  text: string;
  done: boolean;
  error?: string;
  question?: string;
  contextHint?: string;
  refinement?: 'queued' | 'answering' | 'done' | 'error';
  speaker?: number;
  phase?: 'queued' | 'answering' | 'done' | 'cancelled' | 'skipped' | 'error';
  expansion?: { text: string; phase: 'queued' | 'answering' | 'done' | 'error'; error?: string; visible: boolean };
}

export type StatusKind = 'idle' | 'live' | 'thinking' | 'paused' | 'error';

export interface DetectionCheck {
  id: string;
  text: string;
  probability: number;
  threshold: number;
  passed: boolean;
}

interface OverlayState {
  status: { kind: StatusKind; text: string };
  turns: TranscriptTurn[];
  interim: string;
  answers: AnswerItem[];
  usage: Usage | null;
  sessionCost: number;
  settings: Settings | null;
  profiles: ProfileSummary[];
  activeProfile: Profile | null;
  professorSpeaker: number | null;
  sessionError: string | null;
  detectionChecks: DetectionCheck[];
  detectionCount: number;
  addDetectionChecks(checks: DetectionCheck[]): void;

  setStatus(kind: StatusKind, text: string): void;
  setTranscript(turns: TranscriptTurn[], interim: string): void;
  beginAnswer(id: string | number, question?: string, speaker?: number, contextHint?: string): void;
  setAnswerPhase(id: string | number, phase: NonNullable<AnswerItem['phase']>): void;
  appendAnswer(id: string | number, delta: string): void;
  finishAnswer(id: string | number, opts: { discard?: boolean; error?: string; usage?: Usage | null }): void;
  patchExpansion(id: string | number, patch: Partial<NonNullable<AnswerItem['expansion']>>): void;
  patchRefinement(id: string, phase: NonNullable<AnswerItem['refinement']>, text?: string): void;
  expansionUsage(usage?: Usage | null): void;
  setSettings(s: Settings): void;
  setProfiles(p: ProfileSummary[]): void;
  setActiveProfile(p: Profile): void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  status: { kind: 'idle', text: 'starting…' },
  turns: [],
  interim: '',
  answers: [],
  usage: null,
  sessionCost: 0,
  settings: null,
  profiles: [],
  activeProfile: null,
  professorSpeaker: null,
  sessionError: null,
  detectionChecks: [],
  detectionCount: 0,
  addDetectionChecks: checks => set(s => ({ detectionChecks: [...checks.slice().reverse(), ...s.detectionChecks].slice(0, 20), detectionCount: s.detectionCount + checks.length })),

  setStatus: (kind, text) => set({ status: { kind, text } }),
  setTranscript: (turns, interim) => set({ turns, interim }),

  beginAnswer: (id, question, speaker, contextHint) =>
    set((s) => ({
      answers: [
        {
          id,
          question,
          contextHint,
          speaker,
          phase: 'queued' as const,
          ts: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          text: '',
          done: false,
        },
        ...s.answers,
      ].sort((a, b) => Number(String(b.id).split('-').at(-1)) - Number(String(a.id).split('-').at(-1))),
    })),

  setAnswerPhase: (id, phase) => set(s => ({ answers: s.answers.map(a => a.id === id ? { ...a, phase } : a) })),
  patchExpansion: (id, patch) => set(s => ({ answers: s.answers.map(a => a.id === id
    ? { ...a, expansion: { text: '', phase: 'queued', visible: true, ...a.expansion, ...patch } } : a) })),
  patchRefinement: (id, refinement, text) => set(s => ({ answers: s.answers.map(a => a.id === id
    ? { ...a, refinement, ...(text !== undefined ? { text, expansion: undefined } : {}) } : a) })),
  expansionUsage: usage => set(s => ({ usage: usage ?? s.usage, sessionCost: s.sessionCost + (usage?.estimatedCost ?? 0) })),
  appendAnswer: (id, delta) =>
    set((s) => ({
      answers: s.answers.map((a) => (a.id === id ? { ...a, text: a.text + delta } : a)),
    })),

  finishAnswer: (id, { discard, error, usage }) =>
    set((s) => ({
      answers: discard
        ? s.answers.filter((a) => a.id !== id)
        : s.answers.map((a) => (a.id === id ? { ...a, done: true, error, phase: error ? 'error' : 'done' } : a)),
      usage: usage ?? s.usage,
      sessionCost: s.sessionCost + (usage?.estimatedCost ?? 0),
    })),

  setSettings: (settings) => set({ settings }),
  setProfiles: (profiles) => set({ profiles }),
  setActiveProfile: (activeProfile) => set({ activeProfile }),
}));
