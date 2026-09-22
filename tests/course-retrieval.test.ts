import { describe, it, expect } from 'vitest';
import { retrieveCourse, type CourseIndex } from '../src/main/services/course-retrieval';
const index: CourseIndex = { version: 1, builtAt: '2026-09-22', chunks: [
  { source: 'Tajfel.pdf', locator: 'PDF file page 8', text: 'Social identity and positive distinctiveness explain intergroup comparisons.' },
  { source: 'unrelated.md', locator: 'notes', text: 'Bring notebooks to class tomorrow.' },
] };
describe('local course retrieval', () => {
  it('retrieves relevant evidence with exact provenance', () => {
    const result = retrieveCourse(index, 'What is positive distinctiveness?');
    expect(result).toHaveLength(1);
    expect(result[0].name).toContain('Tajfel.pdf | PDF file page 8');
  });
  it('returns no invented evidence for a missing topic', () => expect(retrieveCourse(index, 'quantum bananas')).toEqual([]));
  it('caps evidence size and passage count', () => {
    const many = { ...index, chunks: Array.from({ length: 100 }, () => ({ ...index.chunks[0], text: 'identity '.repeat(1000) })) };
    const result = retrieveCourse(many, 'identity', 5000);
    expect(result.reduce((n, c) => n + c.text.length + c.name.length, 0)).toBeLessThanOrEqual(5000);
    expect(result.length).toBeLessThanOrEqual(6);
  });
});
