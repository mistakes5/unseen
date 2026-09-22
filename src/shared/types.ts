// Core types shared between main, preload, and renderer.

/** Memory namespaces: a personal and a work knowledge space, combinable. */
export type Namespace = 'personal' | 'work';

/** A markdown file or folder read straight into a memory namespace (6.2). */
export interface WatchedSource {
  path: string;
  ns: Namespace;
}

export interface Settings {
  llm: {
    provider: string;
    model: string;
    maxTokens: number;
    temperature: number | null;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
    /** Provider ids tried in order if the primary fails before first token. */
    fallbacks: string[];
    endpoints: {
      ollama: string;
      openaiCompatible: { baseURL: string; label: string };
    };
  };
  stt: {
    provider: string;
    language: string;
    diarize: boolean;
    endpointingMs: number;
    micDeviceId: string;
  };
  questionDetection: { provider: 'rules' | 'jev'; threshold: number };
  overlay: {
    privacyMode: boolean;
    alwaysOnTop: boolean;
    opacity: number;
    fontSize: number;
  };
  hotkeys: {
    toggleVisibility: string;
    askNow: string;
    pause: string;
    cycleProfile: string;
    privacyMode: string;
    /** Toggle system-wide dictation: tap to start, tap again to stop+insert. */
    dictation: string;
  };
  dictation: {
    enabled: boolean;
    /** Run the LLM cleanup pass (filler removal, punctuation). Off = insert the
     *  raw transcription instantly. */
    cleanup: boolean;
    /** Model used for the post-dictation cleanup pass (runs on llm.provider). */
    model: string;
    /** Front-app names where dictation skips insertion (and Phase 2 logging). */
    excludeApps: string[];
    /** Append each dictation to the daily memory log (wired in Phase 2). */
    logToMemory: boolean;
  };
  memory: {
    /** Watched markdown files/folders read straight into a namespace (6.2). */
    sources: WatchedSource[];
    notes: {
      /** Apple Notes ingestion enabled. */
      enabled: boolean;
      /** Namespace for notes whose folder isn't explicitly mapped. */
      defaultNs: Namespace;
      /** Map a Notes folder name → namespace. */
      folderMap: { folder: string; ns: Namespace }[];
      /** Epoch ms of the last successful ingestion (incremental sync). */
      lastRunAt: number;
    };
  };
  transcript: {
    windowChars: number;
    retentionMin: number;
  };
  sessions: {
    autoSave: boolean;
  };
  activeProfile: string;
  /**
   * Root for synced data (memory/, knowledge/, sessions/). Empty = OS userData
   * (local). Point at an iCloud Drive folder for cross-device sync (Phase 4).
   * NOTE: settings.json and secrets.json always stay in local userData.
   */
  dataDir: string;
  /** First-run wizard completed. */
  onboarded: boolean;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ---- LLM ----

export interface SystemBlock {
  text: string;
  /** Maps to Anthropic prompt caching; ignored by providers without it. */
  cacheable?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: SystemBlock[];
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export type LlmEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number }
  | { type: 'done' };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** Estimated USD for this call; null when the model isn't in the price table. */
  estimatedCost: number | null;
}

export interface ModelInfo {
  id: string;
  label?: string;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  needsApiKey: boolean;
}

export interface VerifyResult {
  ok: boolean;
  message?: string;
}

// ---- STT ----

export interface SttDescriptor {
  providerId: string;
  input?: 'microphone' | 'meetily' | 'file-replay';
  replay?: { wavBase64: string; label: string };
  wsUrl: string;
  protocols?: string[];
  keepAlive?: { intervalMs: number; payload: string };
}

export interface MeetilyPoll {
  events: TranscriptEvent[];
  reset: boolean;
  state: 'following' | 'waiting';
}

export interface WordTiming {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
}

export type TranscriptEvent =
  | { type: 'interim'; text: string }
  | { type: 'final'; text: string; speaker: number; words?: WordTiming[] };

// ---- Answer flow ----

export interface AnswerPayload {
  /** Expand a completed answer using its main-process context snapshot. */
  expandAnswerId?: string;
  requestId?: string;
  profileId?: string;
  sessionId?: string;
  question?: string;
  speaker?: number;
  detected?: boolean;
  fullTranscript: string;
  newSegment: string;
  forced: boolean;
  codeMode: boolean;
  userSpeaker: number;
}

export interface AnswerDone {
  requestId?: string;
  usage: Usage | null;
}

export interface QuestionCandidate {
  id: string;
  text: string;
  speaker: number;
  context: string;
  priority?: number;
}

export interface QuestionBatch {
  profileId: string;
  candidates: QuestionCandidate[];
}

// ---- Profiles (validated shape; schema lives in profile-schema.ts) ----

export type ResponseStyle = 'spoken' | 'notes' | 'code-first';

export interface Profile {
  id: string;
  name: string;
  description: string;
  icon: string;
  builtin?: boolean;
  llm?: { model?: string; maxTokens?: number; temperature?: number };
  prompt: {
    system: string;
    response_style: ResponseStyle;
    language: string;
  };
  knowledge: {
    prompt_label: string;
    files: string[];
  };
  /** Distilled-memory namespaces to inject as context. Empty/absent = none. */
  memory?: { namespaces: Namespace[] };
  triggers: {
    auto: boolean;
    detectors: string[];
    keywords: string[];
    debounce_ms: number;
    min_chars: number;
  };
  transcript?: { window_chars?: number; retention_min?: number };
}

export interface ProfileSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  builtin: boolean;
}

export interface AppInfo {
  version: string;
  platform: string;
}

// ---- Memory ----

export interface DistillResult {
  ns: Namespace;
  day: string;
  /** log events distilled */
  events: number;
  /** new facts added this run (0 means everything was already known) */
  added: number;
  /** total facts in the day's namespace file after merge */
  total: number;
}

// ---- Sessions ----

export type SessionEvent =
  | { t: number; type: 'speaker-label'; speaker: number | null; label: 'Professor'; profileId: string }
  | { t: number; type: 'start'; version: string; profileId?: string; profileName?: string }
  | { t: number; type: 'final'; text: string; speaker: number; profileId?: string }
  | { t: number; type: 'question'; text: string; questionId: string; profileId: string; speaker?: number }
  | { t: number; type: 'answer-status'; questionId: string; profileId: string; status: 'cancelled' | 'error' | 'skipped'; text: string }
  | {
      t: number;
      type: 'answer';
      text: string;
      profileId: string;
      forced: boolean;
      usage?: Usage | null;
      questionId?: string;
      question?: string;
      expandedFrom?: string;
    };

export interface SessionMeta {
  id: string; // filename without extension
  startedAt: number;
  endedAt: number;
  finals: number;
  answers: number;
  questions?: number;
  profileId?: string;
  profileName?: string;
}
