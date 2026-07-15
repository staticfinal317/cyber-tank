import { describe, expect, it } from 'vitest';
import { dailyRuleForSeed } from '../src/gameplay/DailyChallenge';
import { mergeCrewControls } from '../src/input/CrewControls';
import { Simulation, type ControlFrame, type EnemyEntity, type ProjectileEntity } from '../src/gameplay/Simulation';
import type { GameOptions, TankLoadout } from '../src/core/types';
import { DEFAULT_LOADOUT } from '../src/content/expedition';

const idle: ControlFrame = { move: { x: 0, z: 0 }, aim: { x: 0, z: -1 }, firing: false, abilities: new Set(), switchAmmo: false };
const base: GameOptions = { mode: 'endless', theme: 'neon-city', assist: 'standard', coop: false, weapon: 'pulse', chassis: 'spark', seed: 7, testDrive: true };

function loadout(tool: TankLoadout['tool']): TankLoadout { return { ...DEFAULT_LOADOUT, ammoSlots: [...DEFAULT_LOADOUT.ammoSlots], tool }; }
function makeEnemy(kind: EnemyEntity['kind'], overrides: Partial<EnemyEntity> = {}): EnemyEntity {
  return { id: 90, kind, pos: { x: 0, z: 5.7 }, vel: { x: 0, z: 0 }, hp: 100, maxHp: 100, radius: 1, hitFlash: 0, cooldown: 99, phase: 1, marked: 0, specialCooldown: 99, cloaked: false, ...overrides };
}

describe('completed gameplay systems', () => {
  it('combines a driver and gunner for one shared tank', () => {
    const driver = { ...idle, move: { x: 1, z: 0 }, aimActive: true };
    const gunner = { ...idle, aim: { x: -1, z: 0 }, firing: true, aimActive: true };
    const merged = mergeCrewControls(driver, gunner);
    expect(merged.move).toEqual({ x: 1, z: 0 });
    expect(merged.aim).toEqual({ x: -1, z: 0 });
    expect(merged.firing).toBe(true);
  });

  it('keeps daily challenge selection deterministic', () => {
    expect(dailyRuleForSeed(7, '2026-07-15')).toEqual(dailyRuleForSeed(7, '2026-07-15'));
    const sim = new Simulation({ ...base, mode: 'daily', dailyKey: '2026-07-15' });
    if (sim.dailyRule!.objective === 'score') sim.score = sim.dailyRule!.target;
    if (sim.dailyRule!.objective === 'waves') sim.clearedWaves = sim.dailyRule!.target;
    if (sim.dailyRule!.objective === 'boss') sim.bossesDefeated = sim.dailyRule!.target;
    if (sim.dailyRule!.objective === 'repair') sim.repaired = sim.dailyRule!.target;
    sim.update(.016, [idle]); expect(sim.dailyComplete).toBe(true);
  });

  it('turns scanner, tractor and bridge configurations into combat actions', () => {
    const scan = new Simulation({ ...base, loadout: loadout('scanner') }); const scanned = makeEnemy('bulwark'); scan.enemies.push(scanned);
    scan.update(.016, [{ ...idle, ping: true }]); expect(scanned.marked).toBeGreaterThan(5);
    const tractor = new Simulation({ ...base, loadout: loadout('tractor') }); const pulled = makeEnemy('scout', { pos: { x: 6, z: 5.7 } }); tractor.enemies.push(pulled);
    tractor.update(.016, [{ ...idle, ping: true }]); expect(pulled.pos.x).toBeLessThan(5);
    const bridge = new Simulation({ ...base, loadout: loadout('bridge-projector') }); bridge.update(.016, [{ ...idle, ping: true }]);
    expect(bridge.bridgeTimer).toBeGreaterThan(8);
  });

  it('reflects projectiles and consumes suppress on the player', () => {
    const reflect = new Simulation(base); const reflector = makeEnemy('reflector'); reflect.enemies.push(reflector);
    const shot: ProjectileEntity = { id: 5, team: 'player', pos: { ...reflector.pos }, prev: { ...reflector.pos }, vel: { x: 0, z: -5 }, radius: .2, damage: 20, life: 2, color: 0xffffff, pierce: 0, owner: reflect.players[0]!.id, bounces: 0, hitEnemyIds: new Set() };
    reflect.projectiles.push(shot); reflect.update(.016, [idle]);
    expect(reflector.hp).toBe(100); expect(shot.team).toBe('enemy'); expect(shot.vel.z).toBeGreaterThan(0);
    const suppress = new Simulation(base); const player = suppress.players[0]!;
    suppress.projectiles.push({ ...shot, id: 6, team: 'enemy', pos: { ...player.pos }, prev: { ...player.pos }, vel: { x: 0, z: 0 }, owner: 99, suppression: 2, hitEnemyIds: new Set() });
    suppress.update(.016, [idle]); expect(player.suppressed).toBeGreaterThan(1.9);
  });
});
