import { ENEMIES, availableEnemyKinds } from '../content/enemies';
import { WEAPONS } from '../content/weapons';
import { AMMO_STRATEGIES, MOVEMENT_STRATEGIES } from './LoadoutStrategies';
import { missionProgress, surfaceAt, weatherAt, type WeatherState } from './ExpeditionRules';
import { RNG } from '../core/RNG';
import { SpatialHash } from './SpatialHash';
import { ENEMY_BEHAVIORS, behaviorSpeedScale, behaviorSteering, incomingDamageScale, isEnemyCloaked } from './EnemyBehaviors';
import { CHASSIS_ABILITIES, abilityCooldown } from './ChassisAbilities';
import { WORLD_EVENTS, eventPool, type WorldEventKind } from './WorldEvents';
import type {
  AbilityId, AmmoId, AssistLevel, BossVariant, ChassisId, CrewRole, EnemyKind, ExpeditionMissionId, GameMode, GameOptions,
  ReplayFrame, SurfaceId, ThemeId, Vec2, WeaponId,
} from '../core/types';

export interface ControlFrame {
  move: Vec2;
  aim: Vec2;
  firing: boolean;
  abilities: ReadonlySet<AbilityId>;
  abilityTargets?: ReadonlyMap<AbilityId, Vec2>;
  switchAmmo: boolean;
  ping?: boolean;
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
  activeAmmoIndex: 0 | 1;
  surface: SurfaceId;
  crewRole: CrewRole | 'pilot';
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
  specialCooldown: number;
  cloaked: boolean;
  bossVariant?: BossVariant;
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
  ammo?: AmmoId;
  bounces: number;
}

export interface PickupEntity {
  id: number;
  kind: 'shield' | 'rapid' | 'multi' | 'power' | 'stars';
  pos: Vec2;
  life: number;
}

export type { WorldEventKind } from './WorldEvents';

export interface SimulationEvents {
  shot: { player: PlayerEntity; projectile: ProjectileEntity };
  hit: { pos: Vec2; color: number; heavy: boolean };
  repaired: { enemy: EnemyEntity; pos: Vec2; score: number };
  damage: { pos: Vec2; value: number; critical: boolean };
  pickup: { pos: Vec2; kind: PickupEntity['kind'] };
  playerHit: { player: PlayerEntity; damage: number };
  ability: { player: PlayerEntity; ability: AbilityId; pos: Vec2 };
  wave: { wave: number; boss: boolean };
  event: { kind: WorldEventKind; message: string };
  mission: { missionId: ExpeditionMissionId };
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
  readonly encounteredEnemies = new Set<EnemyKind>();
  readonly replayFrames: ReplayFrame[] = [];
  readonly bounds = { x: ARENA_X, z: ARENA_Z };

  wave = 0;
  score = 0;
  repaired = 0;
  bossesDefeated = 0;
  combo = 1;
  comboTimer = 0;
  elapsed = 0;
  safeRadius = 13.5;
  teamMarker?: { pos: Vec2; life: number; owner: number };
  coopGateCharge = 0;
  eventKind: WorldEventKind = 'none';
  eventTimer = 0;
  nextWaveTimer = 1.6;
  over = false;
  rapidTimer = 0;
  multiTimer = 0;
  powerTimer = 0;
  weather: WeatherState;
  missionProgressValue = 0;
  missionTarget = 0;
  missionComplete = false;
  missionStageLabel = '';
  missionCompletedAt = 0;
  private nextId = 1;
  private eventClock = 24;
  private replayClock = 0;
  private listeners = new Map<keyof SimulationEvents, Set<(payload: unknown) => void>>();
  private techRanks: Record<string, number>;
  private readonly enemyIndex = new SpatialHash<EnemyEntity>(3.2);
  private readonly playerIndex = new SpatialHash<PlayerEntity>(3.2);
  private readonly projectilePool: ProjectileEntity[] = [];

  get pooledProjectileCount(): number { return this.projectilePool.length; }

  constructor(options: GameOptions, techRanks: Record<string, number> = {}) {
    this.options = options;
    this.rng = new RNG(options.seed);
    this.techRanks = techRanks;
    this.weather = weatherAt(0, options.season ?? 'spring');
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
      weapon: this.options.loadout ? AMMO_STRATEGIES[this.options.loadout.ammoSlots[this.options.loadout.activeAmmoIndex]].weapon : this.options.weapon,
      chassis: this.options.loadout?.chassis ?? this.options.chassis,
      abilityCooldowns: { shield: 0, repair: 0, dash: 0, storm: 0 },
      activeAmmoIndex: this.options.loadout?.activeAmmoIndex ?? 0,
      surface: 'road',
      crewRole: slot === 1 ? 'pilot' : this.options.crewRoleP2 ?? 'navigator',
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
    this.rebuildSpatialIndexes();
    this.updatePlayers(step, controls);
    this.updateCooperation(step);
    this.updateEnemies(step);
    this.updateProjectiles(step);
    this.updatePickups(step);
    this.rebuildSpatialIndexes();
    this.handleCollisions();
    this.updateWaves(step);
    this.updateMission();
    this.recordReplay(step);
    this.checkGameOver();
  }

  private updatePlayers(dt: number, controls: ControlFrame[]): void {
    this.players.forEach((player, index) => {
      const control = controls[index] ?? { move: { x: 0, z: 0 }, aim: player.aim, firing: false, abilities: new Set<AbilityId>(), abilityTargets: new Map<AbilityId, Vec2>(), switchAmmo: false };
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
      if (control.switchAmmo && this.options.loadout) {
        player.activeAmmoIndex = player.activeAmmoIndex === 0 ? 1 : 0;
        player.weapon = AMMO_STRATEGIES[this.options.loadout.ammoSlots[player.activeAmmoIndex]].weapon;
        this.emit('message', { title: '炮弹切换', body: player.activeAmmoIndex === 0 ? '主炮已就绪' : '副炮已就绪' });
      }
      player.shield -= dt;
      player.boost -= dt;
      player.invulnerable -= dt;
      (Object.keys(player.abilityCooldowns) as AbilityId[]).forEach((key) => {
        const eventBoost = this.eventKind === 'emp' ? 1.55 : 1;
        player.abilityCooldowns[key] = Math.max(0, player.abilityCooldowns[key] - dt * (this.options.theme === 'aurora-ice' ? 1.08 : 1) * eventBoost);
      });

      const move = len(control.move) > 1 ? normalized(control.move) : control.move;
      const baseSpeed = player.chassis === 'comet' ? 6.3 : player.chassis === 'guardian' ? 4.5 : 5.4;
      const movement = this.options.loadout ? MOVEMENT_STRATEGIES[this.options.loadout.movement] : undefined;
      const surface = this.currentSurface(player.pos);
      player.surface = surface;
      const deepWaterPenalty = surface === 'deep-water' && this.options.loadout?.movement !== 'amphibious' ? .22 : 1;
      const movementBoost = (movement ? movement.speed * movement.grip(surface) : 1) * deepWaterPenalty;
      let speed = baseSpeed * (1 + (this.techRanks.engine ?? 0) * .04) * (player.boost > 0 ? 1.65 : 1);
      speed *= movementBoost;
      if (this.options.theme === 'neon-city' && Math.abs(player.pos.x) < 1.2) speed *= 1.18;
      const weatherSteering = this.options.biome ? this.weather.intensity * (1 - this.weatherSteering()) : 0;
      const surfaceResponse = surface === 'ice' ? .38 : surface === 'deep-snow' ? .7 : surface === 'mud' ? .78 : surface === 'deep-water' ? .52 : 1;
      const response = (this.options.theme === 'aurora-ice' ? 3.8 : 11) * (movement?.response ?? 1) * surfaceResponse * (1 - weatherSteering);
      player.vel.x += (move.x * speed - player.vel.x) * Math.min(1, response * dt);
      player.vel.z += (move.z * speed - player.vel.z) * Math.min(1, response * dt);
      if (this.options.biome && this.options.season === 'autumn') player.vel.x += Math.sin(this.elapsed * .72) * this.weather.intensity * dt * 1.5;
      if (this.options.biome && (surface === 'shallow-water' || surface === 'deep-water')) player.vel.z += Math.sin(this.elapsed * .55) * dt * .9;
      if (surface === 'deep-water' && this.options.loadout?.movement !== 'amphibious') {
        player.vel.x *= .88; player.vel.z *= .88;
      }
      if (this.options.theme === 'toy-factory' && Math.abs(player.pos.z) < 2.2) player.vel.x += Math.sin(this.elapsed * .8) * dt * 3;
      player.pos.x = clamp(player.pos.x + player.vel.x * dt, -ARENA_X, ARENA_X);
      player.pos.z = clamp(player.pos.z + player.vel.z * dt, -ARENA_Z, ARENA_Z);

      let aim = normalized(control.aim, player.aim);
      const autoTarget = this.nearestEnemy(player.pos, 11);
      if (this.options.assist === 'easy' && autoTarget) aim = normalized({ x: autoTarget.pos.x - player.pos.x, z: autoTarget.pos.z - player.pos.z });
      player.aim = aim;
      const autoFire = this.options.assist === 'easy' && Boolean(autoTarget);
      if ((control.firing || autoFire) && player.cooldown <= 0) this.firePlayer(player);
      control.abilities.forEach((ability) => this.useAbility(player, ability, control.abilityTargets?.get(ability)));
      if (control.ping) this.placeTeamMarker(player);

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
    const ammoId = this.options.loadout?.ammoSlots[player.activeAmmoIndex];
    const ammo = ammoId ? AMMO_STRATEGIES[ammoId] : undefined;
    const rapid = this.rapidTimer > 0 ? .56 : 1;
    player.cooldown = weapon.cooldown * rapid * (1 - (this.techRanks.cooling ?? 0) * .04);
    const pelletCount = weapon.pellets + (this.multiTimer > 0 ? 2 : 0);
    const damage = weapon.damage * (ammo?.damage ?? 1) * (1 + (this.techRanks.power ?? 0) * .05) * (this.powerTimer > 0 ? 1.6 : 1) * (player.crewRole === 'wingman' ? 1.15 : 1);
    for (let i = 0; i < pelletCount; i += 1) {
      const offset = (i - (pelletCount - 1) / 2) * weapon.spread;
      const c = Math.cos(offset); const s = Math.sin(offset);
      const dir = { x: player.aim.x * c - player.aim.z * s, z: player.aim.x * s + player.aim.z * c };
      const projectile = this.acquireProjectile({
        team: 'player', pos: { x: player.pos.x + dir.x, z: player.pos.z + dir.z },
        prev: { ...player.pos }, vel: { x: dir.x * weapon.speed * (ammo?.speed ?? 1), z: dir.z * weapon.speed * (ammo?.speed ?? 1) }, radius: .15,
        damage, life: 1.8, color: ammo?.color ?? weapon.color, pierce: ammo?.pierce ?? (player.weapon === 'rail' ? 3 : 0), owner: player.id,
        ammo: ammoId, bounces: ammo?.bounces ?? 0,
      });
      this.projectiles.push(projectile);
      this.emit('shot', { player, projectile });
    }
  }

  private useAbility(player: PlayerEntity, ability: AbilityId, target?: Vec2): void {
    if (player.abilityCooldowns[ability] > 0 || !player.alive) return;
    const profile = CHASSIS_ABILITIES[player.chassis];
    player.abilityCooldowns[ability] = abilityCooldown(player.chassis, ability, ABILITY_BASE[ability]);
    if (ability === 'shield') {
      player.shield = profile.shieldDuration; player.invulnerable = 1;
      if (profile.teamShieldRadius > 0) this.players.forEach((ally) => { if (ally.alive && distance(ally.pos, player.pos) <= profile.teamShieldRadius) ally.shield = Math.max(ally.shield, profile.shieldDuration * .8); });
    }
    if (ability === 'repair') {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * profile.repairRatio);
      const down = this.players.find((other) => !other.alive && distance(other.pos, player.pos) < 5);
      if (down) down.downTimer = 0;
      if (player.crewRole === 'engineer') this.players.forEach((ally) => { if (ally !== player && ally.alive && distance(ally.pos, player.pos) < 6) ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * .3); });
    }
    let effectPos = { ...player.pos };
    if (ability === 'dash') {
      const direction = normalized(target ?? player.aim, player.aim);
      player.aim = direction;
      player.vel.x += direction.x * profile.dashImpulse; player.vel.z += direction.z * profile.dashImpulse;
      player.boost = 2.6; player.invulnerable = .45;
      effectPos = { x: player.pos.x + direction.x * 1.8, z: player.pos.z + direction.z * 1.8 };
      if (profile.dashDamage > 0) this.enemies.forEach((enemy) => { if (distance(enemy.pos, effectPos) < 2.5) { enemy.hp -= profile.dashDamage; enemy.marked = .5; } });
    }
    if (ability === 'storm') {
      const direction = normalized(target ?? player.aim, player.aim);
      effectPos = target ? { x: clamp(player.pos.x + direction.x * 5.2, -ARENA_X, ARENA_X), z: clamp(player.pos.z + direction.z * 5.2, -ARENA_Z, ARENA_Z) } : { ...player.pos };
      this.enemies.forEach((enemy) => {
        if (distance(enemy.pos, effectPos) < profile.stormRadius) {
          enemy.hp -= profile.stormDamage; enemy.marked = .7;
          this.emit('damage', { pos: enemy.pos, value: profile.stormDamage, critical: true });
        }
      });
    }
    this.emit('ability', { player, ability, pos: effectPos });
  }

  private placeTeamMarker(player: PlayerEntity): void {
    const range = player.crewRole === 'navigator' ? 7.5 : 5.5;
    const pos = { x: clamp(player.pos.x + player.aim.x * range, -ARENA_X, ARENA_X), z: clamp(player.pos.z + player.aim.z * range, -ARENA_Z, ARENA_Z) };
    this.teamMarker = { pos, life: player.crewRole === 'navigator' ? 8 : 5, owner: player.id };
    const radius = player.crewRole === 'navigator' ? 4.2 : 2.6;
    this.enemies.forEach((enemy) => { if (distance(enemy.pos, pos) < radius) enemy.marked = Math.max(enemy.marked, 3); });
    this.emit('message', { title: player.crewRole === 'navigator' ? '领航标记已共享' : '小队标记已共享', body: '所有驾驶员都能看到青色目标环' });
  }

  private updateCooperation(dt: number): void {
    if (this.teamMarker) { this.teamMarker.life -= dt; if (this.teamMarker.life <= 0) this.teamMarker = undefined; }
    const [p1, p2] = this.players;
    if (!p1 || !p2 || !p1.alive || !p2.alive || distance(p1.pos, p2.pos) > 3.8) { this.coopGateCharge = Math.max(0, this.coopGateCharge - dt * .5); return; }
    this.coopGateCharge += dt;
    if (this.coopGateCharge < 8) return;
    this.coopGateCharge = 0; p1.shield = Math.max(p1.shield, 4); p2.shield = Math.max(p2.shield, 4); this.score += 300;
    this.emit('message', { title: '协作机关启动', body: '两台机体并肩充能，获得家庭护盾与 300 分协作奖励' });
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
      const profile = ENEMY_BEHAVIORS[enemy.kind];
      const targetDistance = distance(enemy.pos, target.pos);
      const desired = behaviorSteering(profile, toTarget, targetDistance, enemy.phase);
      let speed = def.speed * (1 + this.wave * .018) * behaviorSpeedScale(profile, enemy.phase);
      if (enemy.marked > 0) speed *= .56;
      enemy.cloaked = isEnemyCloaked(profile, enemy.phase);
      enemy.specialCooldown -= dt;
      if (profile.tags.includes('heal')) {
        const ally = this.enemies.find((other) => other !== enemy && other.hp < other.maxHp && distance(other.pos, enemy.pos) < 4);
        if (ally) ally.hp = Math.min(ally.maxHp, ally.hp + dt * (profile.healPerSecond ?? 8));
      }
      if (profile.tags.includes('summon') && enemy.specialCooldown <= 0 && this.enemies.length < 45) {
        enemy.specialCooldown = (profile.summonEvery ?? 7) * this.rng.range(.85, 1.15);
        const summonKind = profile.summonKind ?? 'scout';
        const count = enemy.kind === 'boss' ? 2 : 1;
        for (let n = 0; n < count; n += 1) this.spawnEnemy(summonKind, { x: enemy.pos.x + (n ? .8 : -.8), z: enemy.pos.z + .4 }, .78 + this.wave * .025);
      }
      enemy.vel.x += (desired.x * speed - enemy.vel.x) * Math.min(1, dt * 4.5);
      enemy.vel.z += (desired.z * speed - enemy.vel.z) * Math.min(1, dt * 4.5);
      enemy.pos.x = clamp(enemy.pos.x + enemy.vel.x * dt, -ARENA_X - 1, ARENA_X + 1);
      enemy.pos.z = clamp(enemy.pos.z + enemy.vel.z * dt, -ARENA_Z - 1, ARENA_Z + 1);

      if (def.fireRate > 0 && enemy.cooldown <= 0 && targetDistance < (enemy.kind === 'sniper' || enemy.kind === 'warden' ? 14 : 9)) {
        enemy.cooldown = def.fireRate * this.rng.range(.8, 1.15);
        this.fireEnemy(enemy, toTarget, def.damage);
      }
    }
  }

  private fireEnemy(enemy: EnemyEntity, dir: Vec2, damage: number): void {
    const count = enemy.kind === 'boss' ? (enemy.bossVariant === 'tide-leviathan' ? 8 : 5) : enemy.kind === 'warden' ? 3 : 1;
    for (let i = 0; i < count; i += 1) {
      const offset = enemy.bossVariant === 'tide-leviathan' ? i / count * Math.PI * 2 : count === 1 ? 0 : (i - 2) * .2;
      const c = Math.cos(offset); const s = Math.sin(offset);
      const base = enemy.bossVariant === 'tide-leviathan' ? { x: 0, z: -1 } : dir;
      const shotDir = { x: base.x * c - base.z * s, z: base.x * s + base.z * c };
      this.projectiles.push(this.acquireProjectile({
        team: 'enemy', pos: { ...enemy.pos }, prev: { ...enemy.pos },
        vel: { x: shotDir.x * 8.3, z: shotDir.z * 8.3 }, radius: .18, damage,
        life: 2.5, color: ENEMIES[enemy.kind].color, pierce: 0, owner: enemy.id, bounces: 0,
      }));
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const bullet = this.projectiles[i];
      if (!bullet) continue;
      bullet.life -= dt;
      bullet.prev.x = bullet.pos.x; bullet.prev.z = bullet.pos.z;
      bullet.pos.x += bullet.vel.x * dt;
      bullet.pos.z += bullet.vel.z * dt;
      const outsideX = Math.abs(bullet.pos.x) > ARENA_X + 1;
      const outsideZ = Math.abs(bullet.pos.z) > ARENA_Z + 1;
      if ((outsideX || outsideZ) && bullet.bounces > 0) {
        if (outsideX) { bullet.vel.x *= -1; bullet.pos.x = clamp(bullet.pos.x, -ARENA_X, ARENA_X); }
        if (outsideZ) { bullet.vel.z *= -1; bullet.pos.z = clamp(bullet.pos.z, -ARENA_Z, ARENA_Z); }
        bullet.bounces -= 1;
      } else if (bullet.life <= 0 || Math.abs(bullet.pos.x) > ARENA_X + 3 || Math.abs(bullet.pos.z) > ARENA_Z + 3) this.releaseProjectileAt(i);
    }
  }

  private handleCollisions(): void {
    for (let bi = this.projectiles.length - 1; bi >= 0; bi -= 1) {
      const bullet = this.projectiles[bi];
      if (!bullet) continue;
      if (bullet.team === 'player') {
        const target = this.enemyIndex.query(bullet.pos, 2.8).find((enemy) => distance(bullet.pos, enemy.pos) < bullet.radius + enemy.radius);
        const targetIndex = target ? this.enemies.indexOf(target) : -1;
        if (targetIndex >= 0) {
          const enemy = this.enemies[targetIndex];
          if (!enemy) continue;
          const profile = ENEMY_BEHAVIORS[enemy.kind];
          const damageScale = incomingDamageScale(profile, enemy.phase) * (enemy.cloaked ? .72 : 1);
          enemy.hp -= bullet.damage * damageScale; enemy.hitFlash = .12;
          if (bullet.ammo === 'frost' || bullet.ammo === 'seed-core') enemy.marked = bullet.ammo === 'frost' ? 2.8 : 1.4;
          if (bullet.ammo === 'repair-seed' || bullet.ammo === 'seed-core') {
            const owner = this.players.find((player) => player.id === bullet.owner);
            if (owner) owner.hp = Math.min(owner.maxHp, owner.hp + (bullet.ammo === 'repair-seed' ? 6 : 2));
          }
          if (bullet.ammo === 'chain-lightning') {
            const chained = this.enemyIndex.query(enemy.pos, 3.4).find((other) => other !== enemy);
            if (chained) { chained.hp -= bullet.damage * .55; chained.hitFlash = .1; this.emit('hit', { pos: chained.pos, color: bullet.color, heavy: false }); }
          }
          this.emit('hit', { pos: bullet.pos, color: bullet.color, heavy: bullet.damage > 40 });
          this.emit('damage', { pos: enemy.pos, value: Math.round(bullet.damage * damageScale), critical: bullet.damage * damageScale > 40 });
          if (bullet.pierce > 0) bullet.pierce -= 1; else this.releaseProjectileAt(bi);
        }
      } else {
        const target = this.playerIndex.query(bullet.pos, 2).find((player) => player.alive && distance(bullet.pos, player.pos) < bullet.radius + player.radius);
        if (target) { this.damagePlayer(target, bullet.damage, true); this.releaseProjectileAt(bi); }
      }
    }

    this.enemies.forEach((enemy) => {
      this.playerIndex.query(enemy.pos, enemy.radius + 1.2).forEach((player) => {
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

  private currentSurface(pos: Vec2 = { x: 0, z: 0 }): SurfaceId {
    if (this.options.biome === 'mountain-sea-valley') return surfaceAt(pos, this.options.season ?? 'spring');
    if (this.options.theme === 'cloud-garden') return 'mud';
    if (this.options.theme === 'crystal-ocean') return 'shallow-water';
    if (this.options.theme === 'dino-canyon') return 'sand';
    if (this.options.theme === 'aurora-ice') return 'ice';
    return 'road';
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
    if (enemy.kind === 'boss') this.bossesDefeated += 1;
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
    if (this.options.testDrive) return;
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
    this.encounteredEnemies.add(kind);
    const hp = def.hp * scale;
    this.enemies.push({
      id: this.nextId++, kind, pos: { ...pos }, vel: { x: 0, z: 0 }, hp, maxHp: hp,
      radius: def.radius, hitFlash: 0, cooldown: this.rng.range(.5, Math.max(.7, def.fireRate)), phase: this.rng.range(0, 8), marked: 0,
      specialCooldown: this.rng.range(3.5, 7), cloaked: false,
      bossVariant: kind === 'boss' ? this.bossVariant() : undefined,
    });
  }

  private updateWorldEvent(dt: number): void {
    if (this.options.biome === 'mountain-sea-valley') this.weather = weatherAt(this.elapsed, this.options.season ?? 'spring');
    if (this.options.mode === 'last-core') this.safeRadius = Math.max(4.2, 13.5 - this.elapsed * .022);
    this.eventClock -= dt;
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) this.eventKind = 'none';
    if (this.eventClock > 0 || this.wave < 2) return;
    this.eventClock = this.rng.range(28, 40);
    this.eventKind = this.rng.pick(eventPool(this.options));
    const definition = WORLD_EVENTS[this.eventKind];
    this.eventTimer = definition.duration;
    this.emit('event', { kind: this.eventKind, message: definition.message });
    if (this.eventKind === 'supply') {
      this.pickups.push({ id: this.nextId++, kind: this.rng.pick(['rapid', 'multi', 'power', 'shield']), pos: { x: this.rng.range(-5, 5), z: this.rng.range(-3, 4) }, life: 15 });
    }
    if (this.eventKind === 'sky-current') this.players.forEach((player) => { player.abilityCooldowns.dash = Math.max(0, player.abilityCooldowns.dash - 4); });
    if (this.eventKind === 'crystal-surge') this.powerTimer = Math.max(this.powerTimer, 10);
    if (this.eventKind === 'toy-march' && this.enemies.length < 38) for (let i = 0; i < 3; i += 1) this.spawnFromEdge('scout');
    if (this.eventKind === 'aurora-pulse') this.players.forEach((player) => { player.shield = Math.max(player.shield, 6); });
    if (this.eventKind === 'dino-stampede') {
      for (let i = 0; i < 5; i += 1) this.emit('hit', { pos: { x: -8 + i * 4, z: this.rng.range(-6, 5) }, color: definition.color, heavy: true });
    }
    if (this.eventKind === 'meteor' || this.eventKind === 'lightning') {
      for (let i = 0; i < 4; i += 1) {
        const pos = { x: this.rng.range(-9, 9), z: this.rng.range(-7, 6) };
        this.enemies.forEach((enemy) => { if (distance(enemy.pos, pos) < 2.3) enemy.hp -= 45; });
        this.emit('hit', { pos, color: this.eventKind === 'lightning' ? 0xbba0ff : 0xff8b3d, heavy: true });
      }
    }
  }

  private weatherSteering(): number {
    const season = this.options.season ?? 'spring';
    return season === 'spring' ? .9 : season === 'summer' ? .86 : season === 'autumn' ? .82 : .74;
  }

  private updateMission(): void {
    const id = this.options.missionId;
    if (!id) return;
    const progress = missionProgress(id, this.repaired, this.wave, this.score, this.bossesDefeated);
    this.missionProgressValue = progress.value;
    this.missionTarget = progress.target;
    this.missionStageLabel = progress.label;
    if (progress.complete && !this.missionComplete) {
      this.missionComplete = true;
      this.missionCompletedAt = this.elapsed;
      this.emit('mission', { missionId: id });
    }
  }

  private bossVariant(): BossVariant {
    if (this.options.missionId === 'summer-storm-eye') return 'storm-roc';
    if (this.options.missionId === 'winter-aurora') return 'frost-mammoth';
    return this.options.route === 'river-route' ? 'tide-leviathan' : 'ridge-colossus';
  }

  private nearestPlayer(pos: Vec2): PlayerEntity | undefined {
    return this.playerIndex.nearest(pos, 36, (player) => player.alive);
  }

  private nearestEnemy(pos: Vec2, maxDistance: number): EnemyEntity | undefined {
    return this.enemyIndex.nearest(pos, maxDistance);
  }

  private rebuildSpatialIndexes(): void {
    this.enemyIndex.rebuild(this.enemies);
    this.playerIndex.rebuild(this.players);
  }

  private acquireProjectile(data: Omit<ProjectileEntity, 'id'>): ProjectileEntity {
    const projectile = this.projectilePool.pop();
    if (!projectile) return { id: this.nextId++, ...data };
    projectile.id = this.nextId++; projectile.team = data.team;
    projectile.pos.x = data.pos.x; projectile.pos.z = data.pos.z;
    projectile.prev.x = data.prev.x; projectile.prev.z = data.prev.z;
    projectile.vel.x = data.vel.x; projectile.vel.z = data.vel.z;
    projectile.radius = data.radius; projectile.damage = data.damage; projectile.life = data.life;
    projectile.color = data.color; projectile.pierce = data.pierce; projectile.owner = data.owner;
    projectile.ammo = data.ammo; projectile.bounces = data.bounces;
    return projectile;
  }

  private releaseProjectileAt(index: number): void {
    const [projectile] = this.projectiles.splice(index, 1);
    if (projectile && this.projectilePool.length < 192) this.projectilePool.push(projectile);
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
