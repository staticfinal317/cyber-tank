import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../src/persistence/SaveRepository';
import { compactSave, LocalSaveRepository, normalizeSave } from '../src/persistence/LocalSaveRepository';

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
    const migrated = normalizeSave({ loadoutPresets: [], highScore: Number.NaN, settings: { masterVolume: 9, aimSensitivity: -4 } } as never);
    expect(migrated.activePresetId).toBe('preset-1');
    expect(migrated.unlockedMovementModules).toContain('amphibious');
    expect(migrated.highScore).toBe(0);
    expect(migrated.settings.masterVolume).toBe(1);
    expect(migrated.settings.aimSensitivity).toBe(.55);
  });

  it('recovers a damaged primary save from its backup', async () => {
    const values = new Map<string, string>();
    const backup = createDefaultSave(); backup.starShards = 321;
    values.set('cyber-tank.save.v3', '{broken');
    values.set('cyber-tank.save.v3.backup', JSON.stringify(backup));
    const repo = new LocalSaveRepository({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
    expect((await repo.load()).starShards).toBe(321);
    expect(repo.getStatus().mode).toBe('recovered');
  });

  it('keeps permanent progress when replay history must be compacted', () => {
    const save = createDefaultSave(); save.starShards = 700; save.leaderboard = Array.from({ length: 12 }, (_, index) => ({ id: `${index}`, date: '', score: index, wave: 1, mode: 'endless', theme: 'neon-city', duration: 1, repaired: 0, stars: 0, title: '测试' }));
    const compact = compactSave(save);
    expect(compact.starShards).toBe(700);
    expect(compact.leaderboard).toHaveLength(8);
    expect(compact.replays).toHaveLength(0);
  });
});
