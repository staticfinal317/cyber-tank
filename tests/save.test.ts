import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../src/persistence/SaveRepository';
import { normalizeSave } from '../src/persistence/LocalSaveRepository';

describe('save schema', () => {
  it('starts with a safe child-friendly loadout', () => {
    const save = createDefaultSave();
    expect(save.version).toBe(3);
    expect(save.unlockedWeapons).toContain('pulse');
    expect(save.loadoutPresets).toHaveLength(3);
    expect(save.loadoutPresets[0]?.loadout.movement).toBe('road-wheel');
    expect(save.starShards).toBe(0);
  });

  it('migrates a v2 save without losing progress', () => {
    const migrated = normalizeSave({
      version: 2,
      highScore: 8800,
      starShards: 420,
      totalRepaired: 31,
      unlockedWeapons: ['pulse', 'scatter'],
      unlockedChassis: ['spark', 'guardian'],
      techRanks: { armor: 2 },
      achievements: ['first-repair'],
      leaderboard: [],
      replays: [],
      settings: { music: true, sfx: true, quality: 'balanced', leftHanded: false },
    } as never);
    expect(migrated.version).toBe(3);
    expect(migrated.highScore).toBe(8800);
    expect(migrated.techRanks.armor).toBe(2);
    expect(migrated.loadoutPresets[0]?.loadout.ammoSlots).toEqual(['star-pulse', 'repair-seed']);
  });

  it('falls back to safe defaults for damaged v3 collections', () => {
    const migrated = normalizeSave({ loadoutPresets: [] } as never);
    expect(migrated.activePresetId).toBe('preset-1');
    expect(migrated.unlockedMovementModules).toContain('amphibious');
  });
});
