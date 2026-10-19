import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { NotesDialogView } from '../src/renderer/overlay/components/NotesDialog';

const dialog = { id: 'test', phase: 'confirm' as const, courseName: 'Course A', day: '2026-10-19', recordings: 3 };
it('shows a clear styled confirmation with course/day scope and explicit actions', () => {
  const html = renderToStaticMarkup(<NotesDialogView dialog={dialog} onAction={() => {}} />);
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('Create today’s notes?');
  expect(html).toContain('Course A');
  expect(html).toContain('3 recording');
  expect(html).toContain('Not now');
  expect(html).toContain('Create notes');
  expect(html).toContain('GPT-6.1 Sol');
  expect(html).not.toContain('/Users/');
});
it('keeps progress and completion in the same custom dialog', () => {
  const working = renderToStaticMarkup(<NotesDialogView dialog={{ ...dialog, phase: 'working' }} onAction={() => {}} />);
  expect(working).toContain('role="status"');
  expect(working).toContain('Piecing it together.');
  expect(working).not.toContain('Create notes');
  const saved = renderToStaticMarkup(<NotesDialogView dialog={{ ...dialog, phase: 'saved' }} onAction={() => {}} />);
  expect(saved).toContain('Your notes are ready.');
  expect(saved).toContain('Open notes');
});
