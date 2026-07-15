import { ENEMIES, availableEnemyKinds } from '../content/enemies';
import { WEAPONS } from '../content/weapons';
import { RNG } from '../core/RNG';
import type {
  AbilityId, AssistLevel, ChassisId, EnemyKind, GameMode, GameOptions,
  ReplayFrame, ThemeId, Vec2, WeaponId,
} from '../core/types';

export interface ControlFrame {
  move: Vec2;
  aim: Vec2;
  firing: boolean;
  abilities: ReadonlySet<AbilityId>;
}

export interface PlayerEntity {
  id: number;
  slot: 1 | 2;
  pos: Vec2;
  vel: Vec2;
  aim: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  cooldown: number;
  shield: number;
  boost: number;
  invulnerable: number;
  alive: boolean;
  downTimer: number;
  weapon: WeaponId;
  chassis: ChassisId;
  abilityCooldowns: Record<AbilityId, number>;
}

export interface EnemyEntity {
  id: number;
  kind: EnemyKind;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  hitFlash: number;
  cooldown: number;
  phase: number;
  marked: number;
}

export interface ProjectileEntity {
  id: number;
  team: 'player' | 'enemy';
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  radius: number;
  damage: number;
  life: number;
  color: number;
  pierce: number;
  owner: number;
}

export interface PickupEntity {
  id: number;
  kind: 'shield' | 'rapid' | 'multi' | 'power' | 'stars';
  pos: Vec2;
  life: number;
}

export type WorldEventKind = 'none' | 'emp' | 'meteor' | 'supply';

export interface SimulationEvents {
  shot: { player: PlayerEntity; projectile: ProjectileEntity };
  hit: { pos: Vec2; color: number; heavy: boolean };
  repaired: { enemy: EnemyEntity; pos: Vec2; score: number };
  damage: { pos: Vec2; value: number; critical: boolean };
  pickup: { pos: Vec2; kind: PickupEntity['kind'] };
  playerHit: { player: PlayerEntity; damage: number };
  ability: { player: PlayerEntity; ability: AbilityId };
  wave: { wave: number; boss: boolean };
  event: { kind: WorldEventKind; message: string };
  message: { title: string; body: string };
  gameOver: undefined;
}

type Listener<K extends keyof SimulationEvents> = (payload: SimulationEvents[K]) => void;

const ABILITY_BASE: Record<AbilityId, number> = { shield: 12, repair: 16, dash: 7, storm: 20 };
const ARENA_X = 12.5;
const ARENA_Z = 10.5;

function len(v: Vec2): number { return Math.hypot(v.x, v.z); }
function normalized(v: Vec2, fallback: Vec2 = { x: 0, z: -1 }): Vec2 {
  const l = len(v);
  return l > .0001 ? { x: v.x / l, z: v.z / l } : { ...fallback };
}
function distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

export class Simulation {
  readonly options: GameOptions;
  readonly rng: RNG;
  readonly players: PlayerEntity[] = [];
  readonly enemies: EnemyEntity[] = [];
  readonly projectiles: ProjectileEntity[] = [];
  readonly pickups: PickupEntity[] = [];
  readonly replayFrames: ReplayFrame[] = [];
  readonly bounds = { x: ARENA_X, z: ARENA_Z };

  wave = 0;
  score = 0;
  repaired = 0;
  combo = 1;
  comboTimer = 0;
  elapsed = 0;
  safeRadius = 13.5;
  eventKind: WorldEventKind = 'none';
  eventTimer = 0;
  nextWaveTimer = 1.6;
  over = false;
  rapidTimer = 0;
  multiTimer = 0;
  powerTimer = 0;
  private nextId = 1;
  private eventClock = 24;
  private replayClock = 0;
  private listeners = new Map<keyof SimulationEvents, Set<(payload: unknown) => void>>();
  private techRanks: Record<string, number>;

  constructor(options: GameOptions, techRanks: Record<string, number> = {}) {
    this.options = options;
    this.rng = new RNG(options.seed);
    this.techRanks = techRanks;
    const chassisHp = options.chassis === 'guardian' ? 25 : options.chassis === 'comet' ? -10 : 0;
    const hp = 100 + chassisHp + (techRanks.armor ?? 0) * 10;
    this.players.push(this.createPlayer(1, { x: options.coop ? -1.35 : 0, z: 5.7 }, hp));
    if (options.coop) this.players.push(this.createPlayer(2, { x: 1.35, z: 5.7 }, hp));
  }

  on<K extends keyof SimulationEvents>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (payload: unknown) => void);
  }

  private emit<K extends keyof SimulationEvents>(event: K, payload: SimulationEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  private createPlayer(slot: 1 | 2, pos: Vec2, hp: number): PlayerEntity {
    return {
      id: this.nextId++, slot, pos, vel: { x: 0, z: 0 }, aim: { x: 0, z: -1 }, hp, maxHp: hp,
      radius: .78, cooldown: 0, shield: 0, boost: 0, invulnerable: 1.5, alive: true, downTimer: 0,
      weapon: this.options.weapon, chassis: this.options.chassis,
      abilityCooldowns: { shield: 0, repair: 0, dash: 0, storm: 0 },
    };
  }

  update(dt: number, controls: ControlFrame[]): void {
    if (this.over) return;
    const step = Math.min(dt, .033);
    this.elapsed += step;
    this.comboTimer -= step;
    if (this.comboTimer <= 0) this.combo = 1;
    this.rapidTimer -= step;
    this.multiTimer -= step;
    this.powerTimer -= step;
    this.updateWorldEvent(step);
    this.updatePlayers(step, controls);
    this.updateEnemies(step);
    this.updateProjectiles(step);
    this.updatePickups(step);
    this.handleCollisions();
    this.updateWaves(step);
    this.recordReplay(step);
    this.checkGameOver();
  }

  private updatePlayers(dt: number, controls: ControlFrame[]): void {
    this.players.forEach((player, index) => {
      const control = controls[index] ?? { move: { x: 0, z: 0 }, aim: player.aim, firing: false, abilities: new Set<AbilityId>() };
      if (!player.alive) {
        player.downTimer -= dt;
        const helper = this.players.find((other) => other.alive && distance(other.pos, player.pos) < 2.3);
        if (helper) player.downTimer -= dt * (1.4 + (this.techRanks.rescue ?? 0) * .35);
        if (player.downTimer <= 0 && helper) {
          player.alive = true; player.hp = player.maxHp * .45; player.invulnerable = 2.5;
          this.emit('message', { title: '伙伴归队', body: '并肩作战，修复速度更快！' });
        }
        return;
      }

      player.cooldown -= dt;
      player.shield -= dt;
      player.boost -= dt;
      player.invulnerable -= dt;
      (Object.keys(player.abilityCooldowns) as AbilityId[]).forEach((key) => {
        const eventBoost = this.eventKind === 'emp' ? 1.55 : 1;
        player.abilityCooldowns[key] = Math.max(0, player.abilityCooldowns[key] - dt * (this.options.theme === 'aurora-ice' ? 1.08 : 1) * eventBoost);
      });

      const move = len(control.move) > 1 ? normalized(control.move) : control.move;
      const baseSpeed = player.chassis === 'comet' ? 6.3 : player.chassis === 'guardian' ? 4.5 : 5.4;
      let speed = baseSpeed * (1 + (this.techRanks.engine ?? 0) * .04) * (player.boost > 0 ? 1.65 : 1);
      if (this.options.theme === 'neon-city' && Math.abs(player.pos.x) < 1.2) speed *= 1.18;
      const response = this.options.theme === 'aurora-ice' ? 3.8 : 11;
      player.vel.x += (move.x * speed - player.vel.x) * Math.min(1, response * dt);
      player.vel.z += (move.z * speed - player.vel.z) * Math.min(1, response * dt);
      if (this.options.theme === 'toy-factory' && Math.abs(player.pos.z) < 2.2) player.vel.x += Math.sin(this.elapsed * .8) * dt * 3;
      player.pos.x = clamp(player.pos.x + player.vel.x * dt, -ARENA_X, ARENA_X);
      player.pos.z = clamp(player.pos.z + player.vel.z * dt, -ARENA_Z, ARENA_Z);

      let aim = normalized(control.aim, player.aim);
      const autoTarget = this.nearestEnemy(player.pos, 11);
      if (this.options.assist === 'easy' && autoTarget) aim = normalized({ x: autoTarget.pos.x - player.pos.x, z: autoTarget.pos.z - player.pos.z });
      player.aim = aim;
      const autoFire = this.options.assist === 'easy' && Boolean(autoTarget);
      if ((control.firing || autoFire) && player.cooldown <= 0) this.firePlayer(player);
      control.abilities.forEach((ability) => this.useAbility(player, ability));

      if (this.options.mode === 'last-core' && len(player.pos) > this.safeRadius && player.invulnerable <= 0) {
        this.damagePlayer(player, 5 * dt, false);
      }
    });

    if (this.options.theme === 'cloud-garden' && Math.floor(this.elapsed) % 12 === 0) {
      this.players.forEach((player) => { if (player.alive) player.hp = Math.min(player.maxHp, player.hp + dt * 1.5); });
    }
  }

  private firePlayer(player: PlayerEntity): void {
    const weapon = WEAPONS[player.weapon];
    const rapid = this.rapidTimer > 0 ? .56 : 1;
    player.cooldown = weapon.cooldown * rapid * (1 - (this.techRanks.cooling ?? 0) * .04);
    const pelletCount = weapon.pellets + (this.multiTimer > 0 ? 2 : 0);
    const damage = weapon.damage * (1 + (this.techRanks.power ?? 0) * .05) * (this.powerTimer > 0 ? 1.6 : 1);
    for (let i = 0; i < pelletCount; i += 1) {
      const offset = (i - (pelletCount - 1) / 2) * weapon.spread;
      const c = Math.cos(offset); const s = Math.sin(offset);
      const dir = { x: player.aim.x * c - player.aim.z * s, z: player.aim.x * s + player.aim.z * c };
      const projectile: ProjectileEntity = {
        id: this.nextId++, team: 'player', pos: { x: player.pos.x + dir.x, z: player.pos.z + dir.z },
        prev: { ...player.pos }, vel: { x: dir.x * weapon.speed, z: dir.z * weapon.speed }, radius: .15,
        damage, life: 1.5, color: weapon.color, pierce: player.weapon === 'rail' ? 3 : 0, owner: player.id,
      };
      this.projectiles.push(projectile);
      this.emit('shot', { player, projectile });
    }
  }

  private useAbility(player: PlayerEntity, ability: AbilityId): void {
    if (player.abilityCooldowns[ability] > 0 || !player.alive) return;
    player.abilityCooldowns[ability] = ABILITY_BASE[ability];
    if (ability === 'shield') { player.shield = 5; player.invulnerable = 1; }
    if (ability === 'repair') {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * .38);
      const down = this.players.find((other) => !other.alive && distance(other.pos, player.pos) < 5);
      if (down) down.downTimer = 0;
    }
    if (ability === 'dash') { player.boost = 2.6; player.invulnerable = .45; }
    if (ability === 'storm') {
      this.enemies.forEach((enemy) => {
        if (distance(enemy.pos, player.pos) < 7) {
          enemy.hp -= 65; enemy.marked = .7;
          this.emit('damage', { pos: enemy.pos, value: 65, critical: true });
        }
      });
    }
    this.emit('ability', { player, ability });
  }

  private updateEnemies(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      enemy.hitFlash -= dt; enemy.marked -= dt; enemy.cooldown -= dt; enemy.phase += dt;
      if (enemy.hp <= 0) { this.destroyEnemy(enemy, i); continue; }
      const target = this.nearestPlayer(enemy.pos);
      if (!target) continue;
      const toTarget = normalized({ x: target.pos.x - enemy.pos.x, z: target.pos.z - enemy.pos.z });
      const def = ENEMIES[enemy.kind];
      let desired = toTarget;
      let speed = def.speed * (1 + this.wave * .018);
      if (enemy.kind === 'gunner' || enemy.kind === 'sniper' || enemy.kind === 'medic') {
        const d = distance(enemy.pos, target.pos);
        const preferred = enemy.kind === 'sniper' ? 9 : 6;
        if (d < preferred - 1) desired = { x: -toTarget.x, z: -toTarget.z };
        else if (d < preferred + 1) desired = { x: -toTarget.z * .5, z: toTarget.x * .5 };
      }
      if (enemy.kind === 'charger' && Math.sin(enemy.phase * 3) > .5) speed *= 1.7;
      if (enemy.kind === 'medic') {
        const ally = this.enemies.find((other) => other !== enemy && other.hp < other.maxHp && distance(other.pos, enemy.pos) < 4);
        if (ally) ally.hp = Math.min(ally.maxHp, ally.hp + dt * 8);
      }
      enemy.vel.x += (desired.x * speed - enemy.vel.x) * Math.min(1, dt * 4.5);
      enemy.vel.z += (desired.z * speed - enemy.vel.z) * Math.min(1, dt * 4.5);
      enemy.pos.x = clamp(enemy.pos.x + enemy.vel.x * dt, -ARENA_X - 1, ARENA_X + 1);
      enemy.pos.z = clamp(enemy.pos.z + enemy.vel.z * dt, -ARENA_Z - 1, ARENA_Z + 1);

      if (def.fireRate > 0 && enemy.cooldown <= 0 && distance(enemy.pos, target.pos) < (enemy.kind === 'sniper' ? 14 : 9)) {
        enemy.cooldown = def.fireRate * this.rng.range(.8, 1.15);
        this.fireEnemy(enemy, toTarget, def.damage);
      }
    }
  }

  private fireEnemy(enemy: EnemyEntity, dir: Vec2, damage: number): void {
    const count = enemy.kind === 'boss' ? 5 : 1;
    for (let i = 0; i < count; i += 1) {
      const offset = count === 1 ? 0 : (i - 2) * .2;
      const c = Math.cos(offset); const s = Math.sin(offset);
      const shotDir = { x: dir.x * c - dir.z * s, z: dir.x * s + dir.z * c };
      this.projectiles.push({
        id: this.nextId++, team: 'enemy', pos: { ...enemy.pos }, prev: { ...enemy.pos },
        vel: { x: shotDir.x * 8.3, z: shotDir.z * 8.3 }, radius: .18, damage,
        life: 2.5, color: ENEMIES[enemy.kind].color, pierce: 0, owner: enemy.id,
      });
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const bullet = this.projectiles[i];
      if (!bullet) continue;
      bullet.life -= dt;
      bullet.prev = { ...bullet.pos };
      bullet.pos.x += bullet.vel.x * dt;
      bullet.pos.z += bullet.vel.z * dt;
      if (bullet.life <= 0 || Math.abs(bullet.pos.x) > ARENA_X + 3 || Math.abs(bullet.pos.z) > ARENA_Z + 3) this.projectiles.splice(i, 1);
    }
  }

  private handleCollisions(): void {
    for (let bi = this.projectiles.length - 1; bi >= 0; bi -= 1) {
      const bullet = this.projectiles[bi];
      if (!bullet) continue;
      if (bullet.team === 'player') {
        const targetIndex = this.enemies.findIndex((enemy) => distance(bullet.pos, enemy.pos) < bullet.radius + enemy.radius);
        if (targetIndex >= 0) {
          const enemy = this.enemies[targetIndex];
          if (!enemy) continue;
          enemy.hp -= bullet.damage; enemy.hitFlash = .12;
          this.emit('hit', { pos: bullet.pos, color: bullet.color, heavy: bullet.damage > 40 });
          this.emit('damage', { pos: enemy.pos, value: Math.round(bullet.damage), critical: bullet.damage > 40 });
          if (bullet.pierce > 0) bullet.pierce -= 1; else this.projectiles.splice(bi, 1);
        }
      } else {
        const target = this.players.find((player) => player.alive && distance(bullet.pos, player.pos) < bullet.radius + player.radius);
        if (target) { this.damagePlayer(target, bullet.damage, true); this.projectiles.splice(bi, 1); }
      }
    }

    this.enemies.forEach((enemy) => {
      this.players.forEach((player) => {
        if (!player.alive) return;
        const d = distance(enemy.pos, player.pos);
        if (d < enemy.radius + player.radius) {
          const dir = normalized({ x: player.pos.x - enemy.pos.x, z: player.pos.z - enemy.pos.z });
          player.pos.x += dir.x * .18; player.pos.z += dir.z * .18;
          enemy.pos.x -= dir.x * .08; enemy.pos.z -= dir.z * .08;
          this.damagePlayer(player, ENEMIES[enemy.kind].damage * .025, false);
        }
      });
    });
  }

  private damagePlayer(player: PlayerEntity, amount: number, feedback: boolean): void {
    if (player.invulnerable > 0 || !player.alive) return;
    const actual = player.shield > 0 ? amount * .18 : amount;
    player.hp -= actual;
    player.invulnerable = feedback ? .12 : 0;
    if (feedback) this.emit('playerHit', { player, damage: Math.ceil(actual) });
    if (player.hp <= 0) {
      player.hp = 0; player.alive = false; player.downTimer = 5.5;
      this.emit('message', { title: '等待重建', body: this.players.length > 1 ? '队友靠近即可加速重建' : '这次收集到的星屑依然会保留' });
    }
  }

  private destroyEnemy(enemy: EnemyEntity, index: number): void {
    this.enemies.splice(index, 1);
    const def = ENEMIES[enemy.kind];
    this.combo = Math.min(8, this.comboTimer > 0 ? this.combo + 1 : 1);
    this.comboTimer = 2.6;
    const earned = Math.round(def.score * this.combo);
    this.score += earned; this.repaired += 1;
    this.emit('repaired', { enemy, pos: { ...enemy.pos }, score: earned });
    if (enemy.kind === 'splitter' && this.enemies.length < 45) {
      this.spawnEnemy('charger', { x: enemy.pos.x - .5, z: enemy.pos.z });
      this.spawnEnemy('charger', { x: enemy.pos.x + .5, z: enemy.pos.z });
    }
    const dropChance = .09 + (this.techRanks.fortune ?? 0) * .025 + (enemy.kind === 'boss' ? .9 : 0);
    if (this.rng.next() < dropChance) {
      const kinds: PickupEntity['kind'][] = ['shield', 'rapid', 'multi', 'power', 'stars'];
      this.pickups.push({ id: this.nextId++, kind: this.rng.pick(kinds), pos: { ...enemy.pos }, life: 12 });
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i]; if (!pickup) continue;
      pickup.life -= dt;
      const player = this.players.find((candidate) => candidate.alive && distance(candidate.pos, pickup.pos) < 1.3);
      if (player) {
        if (pickup.kind === 'shield') player.shield = Math.max(player.shield, 7);
        if (pickup.kind === 'rapid') this.rapidTimer = 10;
        if (pickup.kind === 'multi') this.multiTimer = 10;
        if (pickup.kind === 'power') this.powerTimer = 10;
        if (pickup.kind === 'stars') this.score += 450;
        this.emit('pickup', { pos: pickup.pos, kind: pickup.kind });
        this.pickups.splice(i, 1); continue;
      }
      if (pickup.life <= 0) this.pickups.splice(i, 1);
    }
  }

  private updateWaves(dt: number): void {
    if (this.enemies.length > 0) return;
    this.nextWaveTimer -= dt;
    if (this.nextWaveTimer > 0) return;
    this.wave += 1;
    const boss = this.wave % 5 === 0;
    this.emit('wave', { wave: this.wave, boss });
    if (boss) {
      this.spawnEnemy('boss', { x: 0, z: -9.5 }, 1 + this.wave * .09);
      for (let i = 0; i < Math.min(6, 2 + Math.floor(this.wave / 5)); i += 1) this.spawnFromEdge(this.rng.pick(availableEnemyKinds(this.wave)));
    } else {
      const count = Math.min(38, 3 + this.wave * 2 + (this.options.coop ? 2 : 0));
      const kinds = availableEnemyKinds(this.wave);
      for (let i = 0; i < count; i += 1) this.spawnFromEdge(this.rng.pick(kinds));
    }
    this.nextWaveTimer = 2.4;
  }

  private spawnFromEdge(kind: EnemyKind): void {
    const edge = this.rng.int(0, 2);
    const pos = edge === 0
      ? { x: this.rng.range(-ARENA_X, ARENA_X), z: -ARENA_Z - 1 }
      : { x: edge === 1 ? -ARENA_X - 1 : ARENA_X + 1, z: this.rng.range(-ARENA_Z, 3) };
    this.spawnEnemy(kind, pos, 1 + Math.max(0, this.wave - 1) * .105);
  }

  private spawnEnemy(kind: EnemyKind, pos: Vec2, scale = 1): void {
    const def = ENEMIES[kind];
    const hp = def.hp * scale;
    this.enemies.push({
      id: this.nextId++, kind, pos: { ...pos }, vel: { x: 0, z: 0 }, hp, maxHp: hp,
      radius: def.radius, hitFlash: 0, cooldown: this.rng.range(.5, Math.max(.7, def.fireRate)), phase: this.rng.range(0, 8), marked: 0,
    });
  }

  private updateWorldEvent(dt: number): void {
    if (this.options.mode === 'last-core') this.safeRadius = Math.max(4.2, 13.5 - this.elapsed * .022);
    this.eventClock -= dt;
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) this.eventKind = 'none';
    if (this.eventClock > 0 || this.wave < 2) return;
    this.eventClock = this.rng.range(28, 40);
    this.eventTimer = 8;
    this.eventKind = this.rng.pick<WorldEventKind>(['emp', 'meteor', 'supply']);
    const message = this.eventKind === 'emp' ? '电磁风暴：技能恢复加速'
      : this.eventKind === 'meteor' ? '流星雨：留意地面预警圈'
        : '补给信标：星核芯片已送达';
    this.emit('event', { kind: this.eventKind, message });
    if (this.eventKind === 'supply') {
      this.pickups.push({ id: this.nextId++, kind: this.rng.pick(['rapid', 'multi', 'power', 'shield']), pos: { x: this.rng.range(-5, 5), z: this.rng.range(-3, 4) }, life: 15 });
    }
    if (this.eventKind === 'meteor') {
      for (let i = 0; i < 4; i += 1) {
        const pos = { x: this.rng.range(-9, 9), z: this.rng.range(-7, 6) };
        this.enemies.forEach((enemy) => { if (distance(enemy.pos, pos) < 2.3) enemy.hp -= 45; });
        this.emit('hit', { pos, color: 0xff8b3d, heavy: true });
      }
    }
  }

  private nearestPlayer(pos: Vec2): PlayerEntity | undefined {
    return this.players.filter((p) => p.alive).sort((a, b) => distance(a.pos, pos) - distance(b.pos, pos))[0];
  }

  private nearestEnemy(pos: Vec2, maxDistance: number): EnemyEntity | undefined {
    return this.enemies
      .filter((enemy) => distance(enemy.pos, pos) <= maxDistance)
      .sort((a, b) => distance(a.pos, pos) - distance(b.pos, pos))[0];
  }

  private recordReplay(dt: number): void {
    this.replayClock -= dt;
    if (this.replayClock > 0) return;
    this.replayClock = .1;
    const [p1, p2] = this.players;
    if (!p1) return;
    this.replayFrames.push({ t: this.elapsed, p1x: p1.pos.x, p1z: p1.pos.z, p1r: Math.atan2(p1.aim.x, p1.aim.z), p2x: p2?.pos.x, p2z: p2?.pos.z });
    if (this.replayFrames.length > 3600) this.replayFrames.shift();
  }

  private checkGameOver(): void {
    if (this.players.some((player) => player.alive)) return;
    if (this.players.length > 1 && this.players.some((player) => player.downTimer > 0)) return;
    this.over = true;
    this.emit('gameOver', undefined);
  }
}
