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

  it('normalizes every gameplay-critical field in a syntactically valid damaged save', () => {
    const migrated = normalizeSave({
      unlockedWeapons: ['not-a-weapon'], unlockedChassis: ['bad-chassis'],
      unlockedMovementModules: ['broken-wheel'], unlockedAmmo: ['broken-ammo'],
      unlockedTools: ['broken-tool'], unlockedPaints: ['broken-paint'],
      loadoutPresets: [{
        id: '<bad>', name: '<img src=x onerror=alert(1)>', updatedAt: 'not-a-date',
        loadout: { chassis: 'bad', movement: 'bad', ammoSlots: ['bad', 'bad'], activeAmmoIndex: 9, tool: 'bad', paint: 'bad', decal: '<bad>', light: 'bad', trail: 'bad' },
      }],
      techRanks: { armor: -1000, cooling: 100, power: 1e300, unknown: 4 },
      leaderboard: [{ id: 9, date: null, score: Number.POSITIVE_INFINITY, wave: -8, mode: 'bad', theme: 'bad', duration: Number.NaN, repaired: -1, stars: -3, title: '<b>bad</b>' }],
      replays: [{ id: null, createdAt: 'bad', options: { mode: 'bad' }, summary: null, frames: [{ t: Number.NaN, p1x: 'bad' }] }],
      world: { valleyXp: 0, valleyLevel: 99, restoredLandmarks: ['bad'], encyclopedia: ['bad'], activeCompanion: 'bad', unlockedCompanions: ['bad'], companionBond: { 'little-core': -1, sprout: 1e300 }, themeMastery: { 'bad-theme': 9 } },
    } as never);

    expect(migrated.unlockedWeapons).toEqual(['pulse']);
    expect(migrated.loadoutPresets[0]?.loadout).toMatchObject({
      chassis: 'spark', movement: 'road-wheel', ammoSlots: ['star-pulse', 'repair-seed'],
      activeAmmoIndex: 0, tool: 'repair-arm', paint: 'sunrise-yellow', light: 'cyan', trail: 'spark',
    });
    expect(migrated.loadoutPresets[0]?.name).not.toContain('<');
    expect(migrated.techRanks).toEqual({ armor: 0, cooling: 4, power: 5 });
    expect(migrated.world.valleyLevel).toBe(1);
    expect(migrated.world.activeCompanion).toBe('little-core');
    expect(migrated.leaderboard[0]?.date).toBe(new Date(0).toISOString());
    expect(migrated.replays).toEqual([]);
  });

  it('enters memory mode when the ambient localStorage API is unavailable', async () => {
    const repo = new LocalSaveRepository();
    const save = await repo.load();
    expect(save.version).toBe(3);
    expect(repo.getStatus().mode).toBe('memory');
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
