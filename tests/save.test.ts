import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../src/persistence/SaveRepository';

describe('save schema', () => {
  it('starts with a safe child-friendly loadout', () => {
    const save = createDefaultSave();
    expect(save.version).toBe(2);
    expect(save.unlockedWeapons).toContain('pulse');
    expect(save.starShards).toBe(0);
  });
});
