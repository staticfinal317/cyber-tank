import { describe, expect, it } from 'vitest';
import { PauseState } from '../src/core/PauseState';

describe('pause blockers', () => {
  it('does not let WebGL recovery clear a manual pause', () => {
    const state = new PauseState(); state.set('manual', true); state.set('webgl', true); state.set('webgl', false);
    expect(state.paused).toBe(true); expect(state.has('manual')).toBe(true);
  });

  it('keeps a hidden task paused after WebGL recovery until the user resumes', () => {
    const state = new PauseState(); state.set('hidden', true); state.set('webgl', true); state.set('webgl', false);
    expect(state.paused).toBe(true);
    state.resumeByUser(); expect(state.paused).toBe(false);
  });

  it('cannot resume while the WebGL context is still lost', () => {
    const state = new PauseState(); state.set('hidden', true); state.set('webgl', true); state.resumeByUser();
    expect(state.paused).toBe(true); expect(state.has('webgl')).toBe(true);
  });
});
