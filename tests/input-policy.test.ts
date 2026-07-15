import { describe, expect, it } from 'vitest';
import { canUseCoopOnDevice } from '../src/ui/UIController';

describe('touch cooperative input policy', () => {
  it('keeps desktop keyboard cooperation available', () => {
    expect(canUseCoopOnDevice(false, [])).toBe(true);
  });

  it('prevents an uncontrollable P2 on touch devices', () => {
    expect(canUseCoopOnDevice(true, [])).toBe(false);
    expect(canUseCoopOnDevice(true, [1])).toBe(false);
  });

  it('enables complete touch-device cooperation when both gamepad slots are ready', () => {
    expect(canUseCoopOnDevice(true, [1, 2])).toBe(true);
  });
});
