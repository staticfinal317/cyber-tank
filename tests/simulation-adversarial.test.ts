import { describe, expect, it } from 'vitest';
import { PLAYER_MUZZLE_DISTANCE, Simulation, type ControlFrame, type EnemyEntity, type ProjectileEntity } from '../src/gameplay/Simulation';
import type { GameOptions } from '../src/core/types';

const idle: ControlFrame = {
  move: { x: 0, z: 0 }, aim: { x: 0, z: -1 }, firing: false,
  abilities: new Set(), switchAmmo: false,
};
const base: GameOptions = {
  mode: 'endless', theme: 'neon-city', assist: 'standard', coop: false,
  weapon: 'pulse', chassis: 'spark', seed: 424242,
};

function enemy(overrides: Partial<EnemyEntity> = {}): EnemyEntity {
  return {
    id: 100, kind: 'bulwark', pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 },
    hp: 100, maxHp: 100, radius: 1, hitFlash: 0, cooldown: 99, phase: 0,
    marked: 0, specialCooldown: 99, cloaked: false, ...overrides,
  };
}

describe('adversarial simulation invariants', () => {
  it('spawns a player projectile at the physical barrel tip', () => {
    const sim = new Simulation({ ...base, testDrive: true });
    const player = sim.players[0]!;
    let shot: ProjectileEntity | undefined;
    sim.on('shot', ({ projectile }) => { shot = projectile; });
    sim.update(.016, [{ ...idle, aim: { x: 0, z: -1 }, firing: true }]);
    expect(shot).toBeDefined();
    expect(shot!.pos.x).toBeCloseTo(player.pos.x, 5);
    expect(shot!.prev.z).toBeCloseTo(player.pos.z - PLAYER_MUZZLE_DISTANCE, 5);
    expect(shot!.pos.z).toBeLessThan(shot!.prev.z);
  });

  it('turns tactical nodes into real capture interactions', () => {
    const sim = new Simulation({ ...base, testDrive: true });
    const node = sim.tacticalNodes[0]!;
    sim.players[0]!.pos = { ...node.pos };
    for (let i = 0; i < 170; i += 1) sim.update(1 / 60, [idle]);
    expect(node.captured).toBe(true);
    expect(sim.score).toBe(160);
    expect(sim.players[0]!.shield).toBeGreaterThan(0);
  });

  it('lets a piercing projectile damage the same enemy only once', () => {
    const sim = new Simulation({ ...base, testDrive: true });
    const target = enemy(); sim.enemies.push(target);
    const projectile: ProjectileEntity = {
      id: 200, team: 'player', pos: { x: 0, z: 0 }, prev: { x: 0, z: 0 },
      vel: { x: 0, z: 0 }, radius: .2, damage: 10, life: 2, color: 0xffffff,
      pierce: 3, owner: sim.players[0]!.id, bounces: 0, hitEnemyIds: new Set(),
    };
    sim.projectiles.push(projectile);
    for (let i = 0; i < 4; i += 1) sim.update(.016, [idle]);
    expect(target.hp).toBe(90);
    expect(projectile.hitEnemyIds).toEqual(new Set([target.id]));
  });

  it('never allows a medic to revive an enemy already at zero health', () => {
    const sim = new Simulation({ ...base, testDrive: true });
    sim.enemies.push(
      enemy({ id: 101, kind: 'scout', hp: -.05, maxHp: 28 }),
      enemy({ id: 102, kind: 'medic', hp: 60, maxHp: 60 }),
    );
    sim.update(.016, [idle]);
    expect(sim.enemies.some((item) => item.id === 101)).toBe(false);
    expect(sim.repaired).toBe(1);
  });

  it('completes a wave mission only after the final target wave is cleared', () => {
    const sim = new Simulation({ ...base, mode: 'adventure', missionId: 'spring-river' });
    sim.wave = 2; sim.nextWaveTimer = 0;
    sim.update(.016, [idle]);
    expect(sim.wave).toBe(3);
    expect(sim.clearedWaves).toBe(2);
    expect(sim.missionComplete).toBe(false);
    sim.enemies.length = 0; sim.nextWaveTimer = 0;
    sim.update(.016, [idle]);
    expect(sim.clearedWaves).toBe(3);
    expect(sim.missionComplete).toBe(true);
  });

  it('requires an explicit shared marker and prevents passive repeated score farming', () => {
    const sim = new Simulation({ ...base, coop: true, testDrive: true });
    for (let i = 0; i < 400; i += 1) sim.update(.033, [idle, idle]);
    expect(sim.score).toBe(0);
    sim.teamMarker = { pos: { x: 0, z: 5.7 }, life: 30, owner: sim.players[1]!.id };
    for (let i = 0; i < 260; i += 1) sim.update(.033, [idle, idle]);
    expect(sim.score).toBe(300);
    for (let i = 0; i < 700; i += 1) sim.update(.033, [idle, idle]);
    expect(sim.score).toBe(300);
  });

  it('uses predictive easy aim to progress beyond the former wave-three stall', () => {
    const sim = new Simulation({ ...base, assist: 'easy', seed: 9127 });
    sim.players[0]!.invulnerable = 1000;
    for (let i = 0; i < 60 * 180; i += 1) sim.update(1 / 60, [idle]);
    expect(sim.wave).toBeGreaterThanOrEqual(4);
    expect(sim.repaired).toBeGreaterThan(20);
  }, 15_000);
});
