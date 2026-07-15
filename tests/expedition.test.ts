import { describe, expect, it } from 'vitest';
import { missionProgress, routeAccess, surfaceAt, weatherAt } from '../src/gameplay/ExpeditionRules';
import { Simulation, type ControlFrame } from '../src/gameplay/Simulation';
import type { GameOptions } from '../src/core/types';

const idle: ControlFrame = { move: { x: 0, z: 0 }, aim: { x: 0, z: -1 }, firing: false, abilities: new Set(), switchAmmo: false };
const expeditionOptions = (route: 'ridge-route' | 'river-route'): GameOptions => ({
  mode: 'adventure', theme: 'neon-city', assist: 'standard', coop: false, weapon: 'pulse', chassis: 'spark',
  biome: 'mountain-sea-valley', season: 'winter', route, missionId: 'winter-lighthouse',
});

describe('mountain-sea expedition rules', () => {
  it('turns river surfaces into ice during winter', () => {
    expect(surfaceAt({ x: 0, z: -4 }, 'spring')).toBe('deep-water');
    expect(surfaceAt({ x: 0, z: -4 }, 'winter')).toBe('ice');
  });

  it('requires amphibious movement for warm-season river route', () => {
    expect(routeAccess('river-route', 'spring', 'road-wheel').open).toBe(false);
    expect(routeAccess('river-route', 'summer', 'amphibious').open).toBe(true);
    expect(routeAccess('river-route', 'winter', 'road-wheel').open).toBe(true);
  });

  it('tracks each mission by its configured objective', () => {
    expect(missionProgress('spring-bridge', 8, 1, 0).complete).toBe(true);
    expect(missionProgress('autumn-orchard', 0, 3, 0)).toMatchObject({ value: 3, target: 4, complete: false });
    expect(missionProgress('summer-beacon', 0, 0, 1800).complete).toBe(true);
  });

  it('produces a deterministic weather warning cycle', () => {
    expect(weatherAt(19, 'summer')).toMatchObject({ id: 'thunderstorm', warning: true, intensity: 1 });
    expect(weatherAt(3, 'autumn').warning).toBe(false);
  });

  it('spawns a route-specific regional boss on wave five', () => {
    const river = new Simulation(expeditionOptions('river-route'));
    river.wave = 4; river.nextWaveTimer = 0; river.update(.016, [idle]);
    expect(river.enemies.find((enemy) => enemy.kind === 'boss')?.bossVariant).toBe('tide-leviathan');

    const ridge = new Simulation(expeditionOptions('ridge-route'));
    ridge.wave = 4; ridge.nextWaveTimer = 0; ridge.update(.016, [idle]);
    expect(ridge.enemies.find((enemy) => enemy.kind === 'boss')?.bossVariant).toBe('ridge-colossus');
  });
});
