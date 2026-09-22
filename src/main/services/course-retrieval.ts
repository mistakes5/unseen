import type { KnowledgeInput } from './prompt-builder';

export interface CourseChunk { source: string; locator: string; text: string }
export interface CourseIndex { version: 1; builtAt: string; chunks: CourseChunk[] }
const STOP = new Set('the a an is are was were of in on to and or that this it as for with be by from how what why can could would do does did we you i they their have has about which some any explain discuss please'.split(' '));
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => t.length > 2 && !STOP.has(t));
}

/** Local lexical retrieval; no embeddings/network. Hard bound keeps CLI turns fast. */
export function retrieveCourse(index: CourseIndex, query: string, maxChars = 14000, context = ''): KnowledgeInput[] {
  if (index.version !== 1 || !Array.isArray(index.chunks)) return [];
  const wanted = [...new Set(terms(query))];
  const contextTerms = [...new Set(terms(context))].filter(t => !wanted.includes(t));
  if (!wanted.length) return [];
  const docs = index.chunks.filter(c => typeof c.source === 'string' && typeof c.locator === 'string' && typeof c.text === 'string')
    .map(c => ({ c, tokens: new Set(terms(c.text)), title: new Set(terms(c.source)) }));
  const idf = new Map(wanted.map(t => [t, Math.log(1 + docs.length / (1 + docs.filter(d => d.tokens.has(t)).length))]));
  const scored = docs.map(d => ({ ...d, score: wanted.reduce((s, t) => s + (d.tokens.has(t) ? idf.get(t)! : 0) + (d.title.has(t) ? 0.3 : 0), 0)
    + Math.min(1, contextTerms.filter(t => d.tokens.has(t)).length * 0.03) }))
    .filter(d => d.score > 0 && wanted.some(t => d.tokens.has(t)))
    .sort((a, b) => b.score - a.score);
  const out: KnowledgeInput[] = [];
  let remaining = maxChars;
  for (const { c } of scored) {
    if (out.length >= 6 || remaining < 400) break;
    const name = `${c.source} | ${c.locator} | local snapshot ${index.builtAt.slice(0, 10)}`;
    if (name.length >= remaining) continue;
    const text = c.text.slice(0, Math.min(3000, remaining - name.length));
    remaining -= text.length + name.length;
    out.push({ name, text });
  }
  return out;
}
