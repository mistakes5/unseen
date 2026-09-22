import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';

const fixture = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../src/renderer/overlay/store', () => ({ useOverlayStore: (select: any) => select(fixture.state) }));
vi.mock('../src/renderer/overlay/controller', () => ({ expandAnswer: vi.fn(), setProfessorSpeaker: vi.fn() }));
import { AnswerFeed } from '../src/renderer/overlay/components/AnswerFeed';
import { Transcript } from '../src/renderer/overlay/components/Transcript';

beforeEach(() => {
  fixture.state = { answers: [], professorSpeaker: 0, settings: structuredClone(DEFAULT_SETTINGS), turns: [], interim: '', sessionError: null };
});
it('keeps the original visible during context updates and labels the same card', () => {
  fixture.state.answers = [{ id: 'q-1', ts: '14:28', question: 'Which term?', text: 'Original explanation.', phase: 'done', refinement: 'answering' }];
  const html = renderToStaticMarkup(<AnswerFeed />);
  expect(html).toContain('Updating context…');
  expect(html).toContain('Original explanation.');
  expect(html.match(/<article /g)).toHaveLength(1);
  expect(html).toContain('disabled');
});
it('keeps every active question, including fragments, newest first with distinct phases', () => {
  fixture.state.answers = [
    { id: 'q-3', ts: '14:30', question: 'the function?', text: '', phase: 'queued' },
    { id: 'q-2', ts: '14:29', question: 'How do we solve', text: '', phase: 'answering' },
    { id: 'q-1', ts: '14:28', question: 'Why?', text: 'A simple answer.', phase: 'done' },
  ];
  const html = renderToStaticMarkup(<AnswerFeed />);
  expect(html.match(/<article /g)).toHaveLength(3);
  expect(html.indexOf('the function?')).toBeLessThan(html.indexOf('How do we solve'));
  expect(html).toContain('Answering…');
  expect(html).toContain('Queued');
  expect(html).toContain('Expand');
});
it('preserves skipped questions in collapsed history without displaying empty answer cards', () => {
  fixture.state.answers = [{ id: 'q-1', ts: '14:28', question: 'A skipped question?', text: '', phase: 'skipped' }];
  const html = renderToStaticMarkup(<AnswerFeed />);
  expect(html).toContain('<details class="quiet-answers">');
  expect(html).toContain('A skipped question?');
  expect(html).not.toContain('<article ');
});
it('shows optional discussion context safely without replacing the detected question', () => {
  fixture.state.answers = [{ id: 'q-1', ts: '14:28', question: 'Why?', contextHint: '<script>context</script>', text: 'Answer.', phase: 'done' }];
  const html = renderToStaticMarkup(<AnswerFeed />);
  expect(html).toContain('Discussion context');
  expect(html).toContain('&lt;script&gt;context&lt;/script&gt;');
  expect(html).toContain('Why?');
});
it('retains professor selection and speaker labels when enabled, hides both when disabled', () => {
  fixture.state.settings.stt.diarize = true;
  fixture.state.turns = [{ t: 1, speaker: 0, text: 'A discussion question.' }, { t: 2, speaker: 1, text: 'A response.' }];
  const labelled = renderToStaticMarkup(<Transcript />);
  expect(labelled).toContain('Professor · S0');
  expect(labelled).toContain('Professor voice');
  expect(labelled).toContain('speaker labels on');
  fixture.state.settings.stt.diarize = false;
  const plain = renderToStaticMarkup(<Transcript />);
  expect(plain).not.toContain('Professor voice');
  expect(plain).not.toContain('Professor · S0');
  expect(plain).toContain('A discussion question.');
});
