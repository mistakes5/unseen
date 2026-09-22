import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionEvent, SessionMeta } from '../../shared/types';

/** Class-scoped local catalog. No embeddings, LLM calls, or personal-memory writes. */
export class SessionArchive {
  constructor(private root: string) { mkdirSync(root, { recursive: true, mode: 0o700 }); }

  private path(id: string): string {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?$/.test(id)) throw new Error('Invalid session id');
    return join(this.root, `${id}.jsonl`);
  }

  begin(profileId: string, profileName: string, version: string, t = Date.now()): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error('Invalid course id');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
    const id = `${profileId}/${day}_${randomUUID()}`;
    mkdirSync(join(this.root, profileId), { recursive: true, mode: 0o700 });
    this.append(id, { t, type: 'start', profileId, profileName, version });
    return id;
  }

  append(id: string, event: SessionEvent): void {
    const path = this.path(id);
    if ('profileId' in event && event.profileId && id.includes('/') && id.split('/')[0] !== event.profileId) throw new Error('Session/course mismatch');
    if (event.type !== 'start' && !existsSync(path)) throw new Error('Session no longer exists');
    appendFileSync(path, JSON.stringify(event) + '\n', { mode: 0o600 });
    chmodSync(path, 0o600);
    // Incremental metadata catalog; full transcript remains in append-only JSONL.
    const metaPath = path.replace(/\.jsonl$/, '.meta.json');
    let meta: SessionMeta;
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); }
    catch { meta = { id, startedAt: event.t, endedAt: event.t, finals: 0, answers: 0, questions: 0 }; }
    meta.endedAt = event.t;
    if (event.type === 'start') { meta.profileId = event.profileId; meta.profileName = event.profileName; }
    if (event.type === 'final') meta.finals++;
    if (event.type === 'answer') meta.answers++;
    if (event.type === 'question') meta.questions = (meta.questions ?? 0) + 1;
    writeFileSync(metaPath + '.tmp', JSON.stringify(meta), { mode: 0o600 });
    renameSync(metaPath + '.tmp', metaPath);
  }

  read(id: string): SessionEvent[] {
    return readFileSync(this.path(id), 'utf8').split('\n').flatMap(line => {
      try { return [JSON.parse(line) as SessionEvent]; } catch { return []; }
    });
  }

  list(): SessionMeta[] {
    const ids: string[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) ids.push(entry.name.slice(0, -6));
      if (entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name)) {
        for (const file of readdirSync(join(this.root, entry.name))) {
          if (file.endsWith('.jsonl')) ids.push(`${entry.name}/${file.slice(0, -6)}`);
        }
      }
    }
    return ids.flatMap(id => {
      try {
        const path = this.path(id).replace(/\.jsonl$/, '.meta.json');
        if (existsSync(path)) return [JSON.parse(readFileSync(path, 'utf8')) as SessionMeta];
        // Legacy sessions remain readable, without moving or rewriting them.
        const events = this.read(id);
        if (!events.length) return [];
        const start = events.find(e => e.type === 'start');
        return [{ id, startedAt: events[0].t, endedAt: events.at(-1)!.t,
          profileId: start?.type === 'start' ? start.profileId : undefined,
          profileName: start?.type === 'start' ? start.profileName : undefined,
          finals: events.filter(e => e.type === 'final').length,
          answers: events.filter(e => e.type === 'answer').length }];
      } catch { return []; }
    }).sort((a, b) => b.startedAt - a.startedAt);
  }

  search(profileId: string, query: string): { sessionId: string; t: number; type: string; text: string }[] {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length || !profileId) return [];
    const results = [];
    for (const meta of this.list().filter(m => m.profileId === profileId)) {
      for (const ev of this.read(meta.id)) {
        if ('text' in ev && terms.every(term => ev.text.toLocaleLowerCase().includes(term))) {
          results.push({ sessionId: meta.id, t: ev.t, type: ev.type, text: ev.text });
          if (results.length >= 100) return results;
        }
      }
    }
    return results;
  }

  delete(id: string): void {
    const path = this.path(id);
    for (const file of [path, path.replace(/\.jsonl$/, '.meta.json')]) if (existsSync(file)) rmSync(file);
  }
}
