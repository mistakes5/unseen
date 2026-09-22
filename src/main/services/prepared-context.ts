import { readFileSync, statSync } from 'node:fs';
import type { KnowledgeInput } from './prompt-builder';

export interface PreparedContext {
  version: 1;
  profileId: string;
  sessionDate: string;
  timeZone: string;
  topic: string;
  excerpts: KnowledgeInput[];
}

const cache = new Map<string, { stamp: string; context: PreparedContext }>();
const MAX_CHARS = 26000;

/** Fixed evidence, prepared before class. No query, ranking, model or network. */
export function loadPreparedContext(path: string, profileId: string, now = new Date()): KnowledgeInput[] {
  const unavailable = (reason: string): KnowledgeInput[] => [{
    name: 'Prepared-context availability (app status, not a reading)',
    text: reason + ' No course search was performed. Current-session reading evidence is unavailable; do not invent course-specific attribution.',
  }];
  try {
    const st = statSync(path);
    if (st.size > 150000) throw new Error('size');
    const stamp = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
    let entry = cache.get(path);
    if (!entry || entry.stamp !== stamp) {
      const c = JSON.parse(readFileSync(path, 'utf8')) as PreparedContext;
      if (c.version !== 1 || typeof c.profileId !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(c.sessionDate) || typeof c.timeZone !== 'string' ||
          typeof c.topic !== 'string' || !Array.isArray(c.excerpts) || !c.excerpts.length ||
          !c.excerpts.every(e => typeof e.name === 'string' && typeof e.text === 'string') ||
          c.excerpts.reduce((n, e) => n + e.name.length + e.text.length, 0) > MAX_CHARS) throw new Error('invalid');
      entry = { stamp, context: c };
      cache.set(path, entry);
    }
    const c = entry.context;
    if (c.profileId !== profileId) return unavailable('The prepared bundle belongs to a different course profile.');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: c.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (day !== c.sessionDate) return unavailable(`The prepared bundle is for ${c.sessionDate}, not today's session. Refresh it before relying on it.`);
    return c.excerpts;
  } catch {
    cache.delete(path);
    return unavailable('The prepared course bundle is missing or invalid.');
  }
}
