import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { knowledgeDir } from './knowledge';
import type { CourseIndex } from './course-retrieval';
import type { ExpansionCorpus } from './expansion-search';

interface IndexSource { profileId: string; courseName: string; file: string }
export interface ExpansionSourcesConfig {
  version: 1;
  indexes: IndexSource[];
  /** Only these other courses' saved speech may enter an expansion. */
  transcriptProfiles: string[];
}

const EMPTY: ExpansionSourcesConfig = { version: 1, indexes: [], transcriptProfiles: [] };

/** Private, local opt-in manifest. An absent or malformed file grants no cross-course access. */
export function loadExpansionSourcesConfig(): ExpansionSourcesConfig {
  try {
    const path = join(knowledgeDir(), 'expansion-sources.json');
    if (statSync(path).size > 20_000) return EMPTY;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1 || !Array.isArray(value.indexes) || !Array.isArray(value.transcriptProfiles)) return EMPTY;
    if (value.indexes.length > 12 || value.transcriptProfiles.length > 12) return EMPTY;
    if (!value.indexes.every((x): x is IndexSource => Boolean(x) && typeof x === 'object'
      && typeof x.profileId === 'string' && typeof x.courseName === 'string'
      && typeof x.file === 'string' && /^[\w.-]+\.index\.json$/.test(x.file))) return EMPTY;
    if (!value.transcriptProfiles.every(x => typeof x === 'string' && /^[\w-]+$/.test(x))) return EMPTY;
    return value as unknown as ExpansionSourcesConfig;
  } catch { return EMPTY; }
}

export function loadExpansionIndexCorpora(config: ExpansionSourcesConfig): ExpansionCorpus[] {
  const out: ExpansionCorpus[] = [];
  for (const source of config.indexes) {
    try {
      const path = join(knowledgeDir(), source.file);
      if (statSync(path).size > 10_000_000) continue;
      const index = JSON.parse(readFileSync(path, 'utf8')) as CourseIndex;
      if (index.version !== 1 || !Array.isArray(index.chunks)) continue;
      out.push({ profileId: source.profileId, courseName: source.courseName,
        kind: 'reading', chunks: index.chunks });
    } catch { /* Missing or invalid local source is simply unavailable. */ }
  }
  return out;
}
