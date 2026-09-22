import { afterEach, expect, it, vi } from 'vitest';
import { resetClassroomSession, isListening } from '../src/renderer/overlay/controller';
import { useOverlayStore } from '../src/renderer/overlay/store';
afterEach(() => vi.unstubAllGlobals());
it('clears the previous course view and cancels answers without starting the mic', () => {
  const answerCancel = vi.fn();
  vi.stubGlobal('window', { unseen: { answerCancel } });
  useOverlayStore.setState({ interim: 'old course speech', answers: [{ id: 1, ts: '', text: 'Old course answer', done: true }] });
  resetClassroomSession();
  expect(answerCancel).toHaveBeenCalledOnce();
  expect(isListening()).toBe(false);
  expect(useOverlayStore.getState()).toMatchObject({ interim: '', turns: [], answers: [], status: { kind: 'idle' } });
});
