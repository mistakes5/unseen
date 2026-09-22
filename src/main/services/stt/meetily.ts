import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { MeetilyPoll, TranscriptEvent } from '../../../shared/types';
import type { SttProvider } from './provider';

const recordingsRoot = process.env.CLASSROOM_MEETILY_RECORDINGS || join(homedir(), 'Movies/meetily-recordings');
type Segment = { id?: string; sequence_id?: number; text?: string; transcript?: string; is_partial?: boolean };

/** Read-only follower. Never imports old transcript text when Start/resume is pressed. */
export class MeetilyReader {
  private folder = '';
  private seen = new Set<string>();
  private stamp = '';
  private newest = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root = recordingsRoot) {}

  poll(reset = false): Promise<MeetilyPoll> {
    const result = this.queue.then(() => this.read(reset));
    this.queue = result.catch(() => {});
    return result;
  }

  private async read(reset: boolean): Promise<MeetilyPoll> {
    if (reset) { this.folder = ''; this.seen.clear(); this.stamp = ''; this.newest = ''; }
    const root = await realpath(this.root);
    const folders = await readdir(root, { withFileTypes: true });
    const active: { folder: string; created: string; file: string }[] = [];
    for (const entry of folders) {
      if (!entry.isDirectory()) continue;
      try {
        const folder = join(root, entry.name);
        const meta = JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
        if (!['recording', 'active', 'in_progress'].includes(meta.status)) continue;
        const created = String(meta.created_at || '');
        if (created < this.newest) continue; // Don't jump back to abandoned older recordings.
        active.push({ folder, created, file: String(meta.transcript_file || 'transcripts.json') });
      } catch { /* Ignore incomplete metadata writes/unrelated folders. */ }
    }
    active.sort((a, b) => b.created.localeCompare(a.created));
    const selected = active[0];
    if (!selected) return { events: [], reset: false, state: 'waiting' };
    const changed = this.folder !== selected.folder;
    // A realpath containment check also prevents symlink traversal.
    let file: string;
    try { file = await realpath(join(selected.folder, selected.file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // New recordings create metadata before their first transcript. Arm an
      // empty cursor now so the first subsequently written question is not lost.
      if (changed) {
        this.folder = selected.folder;
        this.newest = selected.created;
        this.seen.clear();
        this.stamp = '';
      }
      return { events: [], reset: changed, state: 'following' };
    }
    const rel = relative(selected.folder, file);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid Meetily transcript path');
    const info = await stat(file);
    if (info.size > 32 * 1024 * 1024) throw new Error('Meetily live transcript exceeds the safety limit');
    const stamp = `${info.ino}:${info.mtimeMs}:${info.size}`;
    if (!changed && stamp === this.stamp) return { events: [], reset: false, state: 'following' };
    // Don't advance the cursor until a complete atomic JSON snapshot is available.
    const payload = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(payload.segments)) throw new Error('Invalid Meetily transcript format');
    if (changed) {
      this.folder = selected.folder;
      this.newest = selected.created;
      this.seen.clear();
    }
    const events: TranscriptEvent[] = [];
    const segments = (payload.segments as Segment[]).slice().sort((a, b) => (a.sequence_id ?? 0) - (b.sequence_id ?? 0));
    for (const [index, segment] of segments.entries()) {
      if (!segment || segment.is_partial) continue;
      const key = String(segment.sequence_id ?? segment.id ?? index);
      const text = String(segment.text ?? segment.transcript ?? '').trim();
      if (!text || this.seen.has(key)) continue;
      this.seen.add(key);
      // Seed the cursor on attach/session switch; never replay an old lecture to AI.
      if (!changed) events.push({ type: 'final', text, speaker: 0 });
    }
    this.stamp = stamp;
    return { events, reset: changed, state: 'following' };
  }
}

export const meetilyReader = new MeetilyReader();
export const meetilyProvider: SttProvider = {
  id: 'meetily', displayName: 'Meetily live transcript (shared engine)', needsApiKey: false,
  descriptor() { return { providerId: 'meetily', input: 'meetily', wsUrl: '' }; },
  async verify() {
    try {
      const result = await new MeetilyReader().poll(true);
      return { ok: true, message: result.state === 'following'
        ? 'Live recording found. Start follows new text only; no second microphone or model.'
        : 'Recordings folder found. Start recording in Meetily, then press Start in the overlay.' };
    } catch { return { ok: false, message: `Cannot read Meetily recordings at ${recordingsRoot}.` }; }
  },
};
