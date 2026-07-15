import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../src/persistence/SaveRepository';
import { applyWorldRun, valleyLevelForXp } from '../src/gameplay/WorldProgression';
import { Simulation, type ControlFrame } from '../src/gameplay/Simulation';
import type { GameOptions, RunSummary } from '../src/core/types';

const idle: ControlFrame = { move: { x: 0, z: 0 }, aim: { x: 0, z: -1 }, firing: false, abilities: new Set(), switchAmmo: false };
const options: GameOptions = { mode: 'endless', theme: 'neon-city', assist: 'standard', coop: true, crewRoleP2: 'navigator', weapon: 'pulse', chassis: 'spark' };

describe('offline family world and cooperation', () => {
  it('turns every run into persistent valley, discovery and companion progress', () => {
    const world = createDefaultSave().world;
    const summary: RunSummary = { id: 'run', date: '2026-01-01', score: 1200, wave: 5, mode: 'adventure', theme: 'cloud-garden', duration: 120, repaired: 12, stars: 20, title: '探索家', missionId: 'spring-bridge', missionComplete: true };
    const next = applyWorldRun(world, summary, ['scout', 'boss'], 'spring-bridge');
    expect(next.valleyXp).toBeGreaterThan(90);
    expect(next.encyclopedia).toEqual(['scout', 'boss']);
    expect(next.restoredLandmarks).toContain('spring-bridge');
    expect(next.companionBond['little-core']).toBeGreaterThan(0);
    expect(valleyLevelForXp(520)).toBe(4);
  });

  it('lets a navigator place a longer shared tactical marker', () => {
    const sim = new Simulation(options);
    sim.update(.016, [idle, { ...idle, aim: { x: 1, z: 0 }, ping: true }]);
    expect(sim.players[1]?.crewRole).toBe('navigator');
    expect(sim.teamMarker?.life).toBeGreaterThan(7.9);
    expect(sim.teamMarker?.owner).toBe(sim.players[1]?.id);
  });

  it('rewards two nearby family players for charging a cooperative mechanism', () => {
    const sim = new Simulation(options);
    for (let i = 0; i < 260; i += 1) sim.update(.033, [idle, idle]);
    expect(sim.score).toBeGreaterThanOrEqual(300);
  });
});
