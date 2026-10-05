import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';

const fixture = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../src/renderer/overlay/store', () => ({ useOverlayStore: (select: any) => select(fixture.state) }));
vi.mock('../src/renderer/overlay/controller', () => ({ expandAnswer: vi.fn(), retryAnswer: vi.fn(), setProfessorSpeaker: vi.fn() }));
import { AnswerFeed } from '../src/renderer/overlay/components/AnswerFeed';
import { Transcript } from '../src/renderer/overlay/components/Transcript';
import { DetectionStatus } from '../src/renderer/overlay/components/DetectionStatus';

beforeEach(() => {
  fixture.state = { answers: [], professorSpeaker: 0, settings: structuredClone(DEFAULT_SETTINGS), turns: [], interim: '', sessionError: null };
});
it('shows exactly one service warning outside the collapsed detector details', () => {
  fixture.state = { ...fixture.state, detectionChecks: [], detectionCount: 0,
    detectionError: 'Jev is temporarily unavailable.', uncheckedSegments: 12 };
  const html = renderToStaticMarkup(<DetectionStatus />);
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html.indexOf('Jev is temporarily unavailable')).toBeLessThan(html.indexOf('<details'));
  expect(html).toContain('12 speech segments went unchecked');
  expect(html).toContain('not judged below cutoff');
  expect(renderToStaticMarkup(<AnswerFeed />)).not.toContain('Question check failed');
});
it('labels suggestions as optional drafts, not words already spoken or regular answers', () => {
  fixture.state.answers = [{ id: 'q-1', ts: '14:28', question: 'Any questions?', text: 'Question to ask: Why?', phase: 'done', responseKind: 'question-suggestion' }];
  const html = renderToStaticMarkup(<AnswerFeed />);
  expect(html).toContain('Question to ask · draft');
  expect(html).toContain('not spoken automatically');
  expect(html).not.toContain('>Expand<');
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

it('offers retry only when a failed answer has retained request context', () => {
  fixture.state.answers = [{ id: 'q-1', ts: '14:28', question: 'Why?', text: '', phase: 'error', error: 'Service unavailable', canRetry: true }];
  expect(renderToStaticMarkup(<AnswerFeed />)).toContain('Retry answer');
  fixture.state.answers[0].canRetry = false;
  expect(renderToStaticMarkup(<AnswerFeed />)).not.toContain('Retry answer');
});
it('makes Demo saving and general question scope visible', () => {
  fixture.state = { ...fixture.state, settings: { ...fixture.state.settings, sessions: { autoSave: true } },
    activeProfile: { sessions: { autoSave: false }, questionDetection: { mode: 'general' }, triggers: { auto: true } },
    detectionChecks: [], detectionCount: 0, uncheckedSegments: 0 };
  const html = renderToStaticMarkup(<DetectionStatus />);
  expect(html).toContain('Session saving off');
  expect(html).toContain('general questions');
});
