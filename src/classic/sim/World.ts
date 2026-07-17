/**
 * 经典复刻 · 确定性战斗模拟核心（M2）
 *
 * 只依赖 core/types.ts、core/constants.ts 与注入的 RNG；零浏览器 API、零 Math.random/Date.now。
 * 对外只导出 `World` 类，实现 core/types.ts 的 `ClassicWorld` 接口。
 */
import {
  Dir,
  Terrain,
  type BulletView,
  type ClassicWorld,
  type ClassicWorldOptions,
  type EnemyKind,
  type PlayerInput,
  type PowerUpKind,
  type SimEvent,
  type TankView,
  type WorldSnapshot,
} from '../core/types';
import {
  BASE,
  BULLET_SUB,
  FIELD_SUB,
  GRID,
  HALF_SUB,
  ICE_SLIDE_TICKS,
  PLAYER,
  POWERUP,
  SPEED,
  TANK_SUB,
  WAVE,
  ENEMY,
} from '../core/constants';
import type { RNG } from '../../core/RNG';
import type { BulletState, PowerUpState, TankAxis, TankState } from './entities';
import {
  QUARTER_FULL,
  cellIndex,
  createBrickMask,
  isBaseCell,
  parseTerrain,
} from './terrain';
import { clamp, rectsOverlap, withinField } from './collide';
import { enemyReconsiderTicks, pickEnemyDirection, shouldEnemyFire } from './ai';
import { FNV_INIT, fnvBool, fnvByte, fnvBytes, fnvInt32 } from './hash';


/**
 * [provisional] 规则清单未给出敌方同屏弹数上限；采用经典 FC 行为——
 * 每辆敌方坦克同一时刻最多 1 发在场子弹（与玩家 0 星同规格）。
 */
const ENEMY_MAX_BULLETS = 1;

const POWER_UP_KINDS: readonly PowerUpKind[] = ['star', 'grenade', 'helmet', 'clock', 'shovel', 'tank'];

/** 砖块 1/4 掩码：面向子弹方向的"近侧"2 个 quarter bit */
const NEAR_QUARTER_BITS: Record<Dir, number> = {
  [Dir.Up]: 0b1100, // 左下+右下：子弹从下方靠近
  [Dir.Down]: 0b0011, // 左上+右上：子弹从上方靠近
  [Dir.Left]: 0b1010, // 右上+右下：子弹从右侧靠近
  [Dir.Right]: 0b0101, // 左上+左下：子弹从左侧靠近
};

const KIND_CODE: Record<TankState['kind'], number> = {
  player: 0, basic: 1, fast: 2, power: 3, armor: 4,
};
const STATUS_CODE: Record<WorldSnapshot['status'], number> = {
  playing: 0, stageClear: 1, gameOver: 2,
};

function dirVector(dir: Dir): { dx: number; dy: number } {
  switch (dir) {
    case Dir.Up: return { dx: 0, dy: -1 };
    case Dir.Right: return { dx: 1, dy: 0 };
    case Dir.Down: return { dx: 0, dy: 1 };
    case Dir.Left: return { dx: -1, dy: 0 };
    default: throw new Error(`未知方向: ${String(dir)}`);
  }
}

function axisOf(dir: Dir): TankAxis {
  return dir === Dir.Left || dir === Dir.Right ? 'h' : 'v';
}

function snapToHalfCell(coord: number): number {
  return Math.round(coord / HALF_SUB) * HALF_SUB;
}

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function normalizePlayerLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > 3) {
    throw new Error(`carryOver.level 必须是 0-3 的整数，实际 ${level}`);
  }
  return level;
}

function normalizeNonNegativeInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} 必须是非负整数，实际 ${value}`);
  }
  return value;
}

interface TargetRect { x: number; y: number; w: number; h: number }

export class World implements ClassicWorld {
  private readonly level: ClassicWorldOptions['level'];
  private readonly rng: RNG;

  private readonly terrain: Uint8Array;
  private readonly brickMask: Uint8Array;
  private baseAlive: boolean;
  private shovelTicksRemaining: number;

  private tanks: TankState[];
  private bullets: BulletState[];
  private powerUp: PowerUpState | null;

  private score: number;
  private lives: number;
  private _status: WorldSnapshot['status'];

  private tickCount: number;
  private nextTankId: number;
  private nextBulletId: number;
  private enemiesSpawned: number;
  private lastEnemySpawnTick: number;

  constructor(options: ClassicWorldOptions) {
    if (!options.level) throw new Error('World 需要 level 参数');
    if (!options.rng) throw new Error('World 需要注入 rng 参数');

    this.level = options.level;
    this.rng = options.rng;
    this.terrain = parseTerrain(options.level.grid);
    this.brickMask = createBrickMask(this.terrain);
    this.baseAlive = true;
    this.shovelTicksRemaining = 0;

    this.bullets = [];
    this.powerUp = null;
    this._status = 'playing';

    this.tickCount = 0;
    this.nextTankId = 1;
    this.nextBulletId = 1;
    this.enemiesSpawned = 0;
    this.lastEnemySpawnTick = -WAVE.spawnIntervalTicks;

    const carryOver = options.carryOver;
    const initialLevel = normalizePlayerLevel(carryOver?.level ?? 0);
    this.lives = normalizeNonNegativeInt(carryOver?.lives ?? PLAYER.initialLives, 'carryOver.lives');
    this.score = normalizeNonNegativeInt(carryOver?.score ?? 0, 'carryOver.score');

    const px = PLAYER.spawnCell.col * HALF_SUB;
    const py = PLAYER.spawnCell.row * HALF_SUB;
    const playerTank: TankState = {
      id: this.nextTankId++,
      kind: 'player',
      x: px,
      y: py,
      dir: Dir.Up,
      axis: 'v',
      level: initialLevel,
      hp: 1,
      maxHp: 1,
      flashing: false,
      shieldTicks: PLAYER.spawnShieldTicks,
      frozenTicks: 0,
      spawningTicks: 0,
      trackPhase: 0,
      moved: false,
      iceSlideRemaining: 0,
      prevFireInput: false,
      alive: true,
      speed: SPEED.player,
      bulletSpeed: initialLevel >= 1 ? SPEED.bulletFast : SPEED.bulletSlow,
      aiNextReconsiderTick: 0,
    };
    this.tanks = [playerTank];
  }

  get status(): WorldSnapshot['status'] {
    return this._status;
  }

  tick(inputs: readonly PlayerInput[]): SimEvent[] {
    if (inputs.length === 0) throw new Error('tick() 至少需要 1 个 PlayerInput（inputs[0]=P1）');
    this.tickCount += 1;
    if (this._status !== 'playing') return [];

    const events: SimEvent[] = [];
    const playerInput = inputs[0] as PlayerInput;

    const player = this.getPlayerTank();
    if (player.alive) {
      this.resolveTankMovement(player, playerInput.dir);
    }

    for (const tank of this.tanks) {
      if (tank.kind === 'player' || !tank.alive) continue;
      this.updateEnemyAi(tank);
    }

    if (player.alive) this.tryPlayerFire(player, playerInput.fire, events);
    for (const tank of this.tanks) {
      if (tank.kind === 'player' || !tank.alive || tank.spawningTicks > 0 || tank.frozenTicks > 0) continue;
      this.tryEnemyFire(tank, events);
    }

    this.updateBullets(events);
    this.updateWaveSpawning();
    this.updateShovel();
    this.updatePowerUpPickup(events);
    this.updateTimersAndCleanup();
    this.checkStageClearOrGameOver(events);

    return events;
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tickCount,
      stage: this.level.stage,
      status: this._status,
      terrain: this.terrain.slice(),
      brickMask: this.brickMask.slice(),
      baseAlive: this.baseAlive,
      shovelTicks: this.shovelTicksRemaining,
      tanks: this.tanks.map((t) => this.toTankView(t)),
      bullets: this.bullets.map((b) => this.toBulletView(b)),
      powerUp: this.powerUp ? { ...this.powerUp } : null,
      hud: {
        enemiesRemaining: this.level.enemyQueue.length - this.enemiesSpawned,
        lives: this.lives,
        score: this.score,
        stage: this.level.stage,
      },
    };
  }

  hash(): number {
    let h = FNV_INIT;
    h = fnvInt32(h, this.tickCount);
    h = fnvBytes(h, this.terrain);
    h = fnvBytes(h, this.brickMask);
    for (const t of this.tanks) {
      h = fnvInt32(h, t.id);
      h = fnvByte(h, KIND_CODE[t.kind]);
      h = fnvInt32(h, t.x);
      h = fnvInt32(h, t.y);
      h = fnvByte(h, t.dir);
      h = fnvByte(h, t.level);
      h = fnvInt32(h, t.hp);
      h = fnvBool(h, t.flashing);
      h = fnvInt32(h, t.shieldTicks);
      h = fnvInt32(h, t.frozenTicks);
      h = fnvInt32(h, t.spawningTicks);
      h = fnvInt32(h, t.trackPhase);
      h = fnvBool(h, t.alive);
    }
    for (const b of this.bullets) {
      h = fnvInt32(h, b.id);
      h = fnvInt32(h, b.x);
      h = fnvInt32(h, b.y);
      h = fnvByte(h, b.dir);
      h = fnvBool(h, b.fromPlayer);
    }
    h = fnvInt32(h, this.score);
    h = fnvInt32(h, this.lives);
    h = fnvByte(h, STATUS_CODE[this._status]);
    return h;
  }

  /* ---------------- 内部：坦克与地形辅助 ---------------- */

  private getPlayerTank(): TankState {
    const player = this.tanks.find((t) => t.kind === 'player');
    if (!player) throw new Error('玩家坦克丢失（不应发生）');
    return player;
  }

  private toTankView(t: TankState): TankView {
    return {
      id: t.id,
      kind: t.kind,
      x: t.x,
      y: t.y,
      dir: t.dir,
      level: t.level,
      hp: t.hp,
      flashing: t.flashing,
      shieldTicks: t.shieldTicks,
      frozenTicks: t.frozenTicks,
      spawningTicks: t.spawningTicks,
      trackPhase: t.trackPhase,
    };
  }

  private toBulletView(b: BulletState): BulletView {
    return { id: b.id, x: b.x, y: b.y, dir: b.dir, fromPlayer: b.fromPlayer };
  }

  private baseRect(): TargetRect {
    return { x: BASE.cell.col * HALF_SUB, y: BASE.cell.row * HALF_SUB, w: 2 * HALF_SUB, h: 2 * HALF_SUB };
  }

  private tanksCollide(excludeId: number, x: number, y: number): boolean {
    for (const other of this.tanks) {
      if (other.id === excludeId || !other.alive) continue;
      if (rectsOverlap(x, y, TANK_SUB, TANK_SUB, other.x, other.y, TANK_SUB, TANK_SUB)) return true;
    }
    return false;
  }

  private terrainOrBaseBlocksTank(x: number, y: number): boolean {
    if (!withinField(x, y, TANK_SUB)) return true;
    const colStart = Math.floor(x / HALF_SUB);
    const colEnd = Math.floor((x + TANK_SUB - 1) / HALF_SUB);
    const rowStart = Math.floor(y / HALF_SUB);
    const rowEnd = Math.floor((y + TANK_SUB - 1) / HALF_SUB);
    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let col = colStart; col <= colEnd; col += 1) {
        if (col < 0 || col >= GRID || row < 0 || row >= GRID) return true;
        if (isBaseCell(col, row)) return true;
        const t = this.terrain[cellIndex(col, row)] as Terrain;
        if (t === Terrain.Brick || t === Terrain.Steel || t === Terrain.Water) return true;
      }
    }
    return false;
  }

  private isIceAt(tank: TankState): boolean {
    const cx = tank.x + TANK_SUB / 2;
    const cy = tank.y + TANK_SUB / 2;
    const col = Math.floor(cx / HALF_SUB);
    const row = Math.floor(cy / HALF_SUB);
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return false;
    return this.terrain[cellIndex(col, row)] === Terrain.Ice;
  }

  private attemptStep(tank: TankState, dir: Dir): boolean {
    const { dx, dy } = dirVector(dir);
    const nx = clamp(tank.x + dx * tank.speed, 0, FIELD_SUB - TANK_SUB);
    const ny = clamp(tank.y + dy * tank.speed, 0, FIELD_SUB - TANK_SUB);
    if (nx === tank.x && ny === tank.y) return false;
    if (this.terrainOrBaseBlocksTank(nx, ny)) return false;
    if (this.tanksCollide(tank.id, nx, ny)) return false;
    tank.x = nx;
    tank.y = ny;
    return true;
  }

  /**
   * 统一处理玩家/敌方的移动决议：格点吸附（规则 2）+ 冰面打滑（规则 3）。
   * desiredDir 为 null 表示本 tick 未按方向键（仅玩家可能出现，敌方 AI 恒给出方向）。
   */
  private resolveTankMovement(tank: TankState, desiredDir: Dir | null): boolean {
    if (desiredDir !== null) {
      const newAxis = axisOf(desiredDir);
      if (desiredDir !== tank.dir && newAxis !== tank.axis) {
        if (newAxis === 'v') tank.x = snapToHalfCell(tank.x);
        else tank.y = snapToHalfCell(tank.y);
      }
      tank.dir = desiredDir;
      tank.axis = newAxis;
      const moved = this.attemptStep(tank, desiredDir);
      tank.moved = moved;
      tank.iceSlideRemaining = moved && this.isIceAt(tank) ? ICE_SLIDE_TICKS : 0;
      return moved;
    }
    if (tank.iceSlideRemaining > 0) {
      const moved = this.attemptStep(tank, tank.dir);
      tank.moved = moved;
      tank.iceSlideRemaining = moved ? tank.iceSlideRemaining - 1 : 0;
      return moved;
    }
    tank.moved = false;
    return false;
  }

  private updateEnemyAi(tank: TankState): void {
    if (tank.spawningTicks > 0 || tank.frozenTicks > 0) {
      tank.moved = false;
      return;
    }
    const kind = tank.kind as EnemyKind;
    if (this.tickCount >= tank.aiNextReconsiderTick) {
      const player = this.getPlayerTank();
      const ecx = tank.x + TANK_SUB / 2;
      const ecy = tank.y + TANK_SUB / 2;
      const pcx = player.x + TANK_SUB / 2;
      const pcy = player.y + TANK_SUB / 2;
      const baseCx = (BASE.cell.col + 1) * HALF_SUB;
      const baseCy = (BASE.cell.row + 1) * HALF_SUB;
      const dir = pickEnemyDirection(kind, ecx, ecy, baseCx, baseCy, pcx, pcy, this.rng);
      tank.dir = dir;
      tank.axis = axisOf(dir);
      tank.aiNextReconsiderTick = this.tickCount + enemyReconsiderTicks(kind);
    }
    const moved = this.resolveTankMovement(tank, tank.dir);
    if (!moved) tank.aiNextReconsiderTick = this.tickCount; // 撞墙/被阻挡 → 下一 tick 立即重选
  }

  /* ---------------- 内部：开火 ---------------- */

  private playerMaxBullets(level: number): number {
    return requireDefined(PLAYER.maxBullets[level], `PLAYER.maxBullets 缺少等级 ${level} 的配置`);
  }

  private tryPlayerFire(player: TankState, fireInput: boolean, events: SimEvent[]): void {
    const edge = fireInput && !player.prevFireInput;
    player.prevFireInput = fireInput;
    if (!edge) return;
    const maxBullets = this.playerMaxBullets(player.level);
    const activeCount = this.bullets.filter((b) => b.fromPlayer && !b.removed).length;
    if (activeCount >= maxBullets) return;
    this.spawnBullet(player, events);
  }

  private tryEnemyFire(tank: TankState, events: SimEvent[]): void {
    const activeCount = this.bullets.filter((b) => b.ownerTankId === tank.id && !b.removed).length;
    if (activeCount >= ENEMY_MAX_BULLETS) return;
    const player = this.getPlayerTank();
    const playerTarget: TargetRect = { x: player.x, y: player.y, w: TANK_SUB, h: TANK_SUB };
    const baseTarget = this.baseRect();
    const fire = shouldEnemyFire(
      tank.kind as EnemyKind, this.terrain, tank.x, tank.y, tank.dir, playerTarget, baseTarget, this.rng,
    );
    if (fire) this.spawnBullet(tank, events);
  }

  private spawnBullet(tank: TankState, events: SimEvent[]): void {
    let bx: number;
    let by: number;
    if (tank.dir === Dir.Up) {
      bx = tank.x + TANK_SUB / 2 - BULLET_SUB / 2;
      by = tank.y - BULLET_SUB;
    } else if (tank.dir === Dir.Down) {
      bx = tank.x + TANK_SUB / 2 - BULLET_SUB / 2;
      by = tank.y + TANK_SUB;
    } else if (tank.dir === Dir.Left) {
      bx = tank.x - BULLET_SUB;
      by = tank.y + TANK_SUB / 2 - BULLET_SUB / 2;
    } else {
      bx = tank.x + TANK_SUB;
      by = tank.y + TANK_SUB / 2 - BULLET_SUB / 2;
    }
    const fromPlayer = tank.kind === 'player';
    this.bullets.push({
      id: this.nextBulletId++,
      x: bx,
      y: by,
      dir: tank.dir,
      fromPlayer,
      speed: tank.bulletSpeed,
      ownerTankId: tank.id,
      maxLevelPlayerBullet: fromPlayer && tank.level >= 3,
      removed: false,
    });
    events.push({ type: 'fire', fromPlayer });
  }

  /* ---------------- 内部：子弹推进与碰撞 ---------------- */

  private updateBullets(events: SimEvent[]): void {
    const moves: { bullet: BulletState; nx: number; ny: number }[] = [];
    for (const b of this.bullets) {
      if (b.removed) continue;
      const { dx, dy } = dirVector(b.dir);
      moves.push({ bullet: b, nx: b.x + dx * b.speed, ny: b.y + dy * b.speed });
    }

    // 子弹×子弹：玩家弹与敌弹相交即同时湮灭；敌弹之间互不作用
    for (let i = 0; i < moves.length; i += 1) {
      const a = moves[i] as { bullet: BulletState; nx: number; ny: number };
      if (a.bullet.removed) continue;
      for (let j = i + 1; j < moves.length; j += 1) {
        const c = moves[j] as { bullet: BulletState; nx: number; ny: number };
        if (c.bullet.removed) continue;
        if (a.bullet.fromPlayer === c.bullet.fromPlayer) continue;
        if (rectsOverlap(a.nx, a.ny, BULLET_SUB, BULLET_SUB, c.nx, c.ny, BULLET_SUB, BULLET_SUB)) {
          a.bullet.removed = true;
          c.bullet.removed = true;
          events.push({ type: 'bulletsCancel', x: Math.floor((a.nx + c.nx) / 2), y: Math.floor((a.ny + c.ny) / 2) });
        }
      }
    }

    for (const { bullet, nx, ny } of moves) {
      if (bullet.removed) continue;
      bullet.x = nx;
      bullet.y = ny;

      if (!withinField(nx, ny, BULLET_SUB)) {
        bullet.removed = true;
        continue;
      }

      const baseRect = this.baseRect();
      if (this.baseAlive && rectsOverlap(nx, ny, BULLET_SUB, BULLET_SUB, baseRect.x, baseRect.y, baseRect.w, baseRect.h)) {
        this.baseAlive = false;
        this._status = 'gameOver';
        events.push({ type: 'baseDestroyed', x: baseRect.x, y: baseRect.y });
        events.push({ type: 'gameOver' });
        bullet.removed = true;
        continue;
      }

      if (this.resolveBulletVsTerrain(bullet, events)) continue;
      if (this.resolveBulletVsTank(bullet, events)) continue;
    }

    this.bullets = this.bullets.filter((b) => !b.removed);
  }

  /** 命中砖/钢返回 true（子弹消耗）；否则 false（子弹继续飞行，穿过树/冰/水/空地） */
  private resolveBulletVsTerrain(bullet: BulletState, events: SimEvent[]): boolean {
    const vertical = bullet.dir === Dir.Up || bullet.dir === Dir.Down;
    const perpStart = vertical ? Math.floor(bullet.x / HALF_SUB) : Math.floor(bullet.y / HALF_SUB);
    const perpEnd = vertical
      ? Math.floor((bullet.x + BULLET_SUB - 1) / HALF_SUB)
      : Math.floor((bullet.y + BULLET_SUB - 1) / HALF_SUB);

    let along: number;
    if (bullet.dir === Dir.Up) along = Math.floor(bullet.y / HALF_SUB);
    else if (bullet.dir === Dir.Down) along = Math.floor((bullet.y + BULLET_SUB - 1) / HALF_SUB);
    else if (bullet.dir === Dir.Left) along = Math.floor(bullet.x / HALF_SUB);
    else along = Math.floor((bullet.x + BULLET_SUB - 1) / HALF_SUB);

    const cells: { col: number; row: number }[] = [];
    for (let p = perpStart; p <= perpEnd; p += 1) {
      const cell = vertical ? { col: p, row: along } : { col: along, row: p };
      if (cell.col >= 0 && cell.col < GRID && cell.row >= 0 && cell.row < GRID) cells.push(cell);
    }
    if (cells.length === 0) return false;

    const steelCells = cells.filter((c) => this.terrain[cellIndex(c.col, c.row)] === Terrain.Steel);
    if (steelCells.length > 0) {
      for (const c of steelCells) {
        const idx = cellIndex(c.col, c.row);
        const cx = c.col * HALF_SUB;
        const cy = c.row * HALF_SUB;
        if (bullet.maxLevelPlayerBullet) {
          this.terrain[idx] = Terrain.Empty;
          this.brickMask[idx] = 0;
          events.push({ type: 'steelBreak', x: cx, y: cy });
        } else {
          events.push({ type: 'steelHit', x: cx, y: cy });
        }
      }
      bullet.removed = true;
      return true;
    }

    const brickCells = cells.filter((c) => this.terrain[cellIndex(c.col, c.row)] === Terrain.Brick);
    if (brickCells.length > 0) {
      for (const c of brickCells) {
        this.damageBrick(c.col, c.row, bullet.dir, bullet.maxLevelPlayerBullet);
        events.push({ type: 'brickHit', x: c.col * HALF_SUB, y: c.row * HALF_SUB });
      }
      bullet.removed = true;
      return true;
    }

    return false;
  }

  private damageBrick(col: number, row: number, dir: Dir, fullBreak: boolean): void {
    const idx = cellIndex(col, row);
    if (fullBreak) {
      this.brickMask[idx] = 0;
      this.terrain[idx] = Terrain.Empty;
      return;
    }
    const near = NEAR_QUARTER_BITS[dir];
    let mask = this.brickMask[idx] as number;
    if ((mask & near) !== 0) {
      mask &= ~near;
    } else {
      mask &= ~(QUARTER_FULL & ~near);
    }
    this.brickMask[idx] = mask;
    if (mask === 0) this.terrain[idx] = Terrain.Empty;
  }

  /** 命中坦克返回 true（子弹消耗）；敌弹穿过敌方坦克返回 false（规则 7） */
  private resolveBulletVsTank(bullet: BulletState, events: SimEvent[]): boolean {
    if (bullet.fromPlayer) {
      for (const tank of this.tanks) {
        if (tank.kind === 'player' || !tank.alive || tank.spawningTicks > 0) continue;
        if (tank.id === bullet.ownerTankId) continue;
        if (!rectsOverlap(bullet.x, bullet.y, BULLET_SUB, BULLET_SUB, tank.x, tank.y, TANK_SUB, TANK_SUB)) continue;
        this.applyHitToEnemy(tank, events);
        bullet.removed = true;
        return true;
      }
      return false;
    }
    const player = this.getPlayerTank();
    if (
      player.alive && player.spawningTicks === 0
      && rectsOverlap(bullet.x, bullet.y, BULLET_SUB, BULLET_SUB, player.x, player.y, TANK_SUB, TANK_SUB)
    ) {
      bullet.removed = true;
      if (player.shieldTicks > 0) return true; // 有护盾则无事
      this.destroyPlayer(events);
      return true;
    }
    return false;
  }

  private applyHitToEnemy(tank: TankState, events: SimEvent[]): void {
    if (tank.flashing) {
      tank.flashing = false;
      this.spawnPowerUp(events);
    }
    tank.hp -= 1;
    if (tank.hp > 0) {
      events.push({ type: 'tankHit', tankId: tank.id });
      return;
    }
    tank.alive = false;
    const kind = tank.kind as EnemyKind;
    const score = ENEMY[kind].score;
    this.addScore(score, events);
    events.push({ type: 'enemyDestroyed', tankId: tank.id, kind, score, x: tank.x, y: tank.y });
  }

  private destroyPlayer(events: SimEvent[]): void {
    const player = this.getPlayerTank();
    events.push({ type: 'playerDestroyed', tankId: player.id, x: player.x, y: player.y });
    player.level = 0;
    this.lives -= 1;
    if (this.lives < 0) {
      this._status = 'gameOver';
      events.push({ type: 'gameOver' });
      player.alive = false;
      return;
    }
    player.x = PLAYER.spawnCell.col * HALF_SUB;
    player.y = PLAYER.spawnCell.row * HALF_SUB;
    player.dir = Dir.Up;
    player.axis = 'v';
    player.hp = 1;
    player.maxHp = 1;
    player.shieldTicks = PLAYER.spawnShieldTicks;
    player.frozenTicks = 0;
    player.spawningTicks = 0;
    player.iceSlideRemaining = 0;
    player.bulletSpeed = SPEED.bulletSlow;
    player.moved = false;
    player.alive = true;
    events.push({ type: 'playerRespawn' });
  }

  private addScore(amount: number, events: SimEvent[]): void {
    const before = Math.floor(this.score / PLAYER.extraLifeScore);
    this.score += amount;
    const after = Math.floor(this.score / PLAYER.extraLifeScore);
    for (let i = before; i < after; i += 1) {
      this.lives += 1;
      events.push({ type: 'extraLife' });
    }
  }

  /* ---------------- 内部：道具 ---------------- */

  private pickPowerUpCell(): { col: number; row: number } {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const col = this.rng.int(1, GRID - 2);
      const row = this.rng.int(1, GRID - 2);
      if (isBaseCell(col, row)) continue;
      return { col, row };
    }
    throw new Error('无法为道具找到合法生成位置（关卡尺寸异常）');
  }

  private spawnPowerUp(events: SimEvent[]): void {
    const kind = this.rng.pick(POWER_UP_KINDS);
    const { col, row } = this.pickPowerUpCell();
    this.powerUp = { kind, x: col * HALF_SUB, y: row * HALF_SUB };
    events.push({ type: 'powerUpSpawn', kind });
  }

  private updatePowerUpPickup(events: SimEvent[]): void {
    if (!this.powerUp) return;
    const player = this.getPlayerTank();
    if (!player.alive) return;
    if (!rectsOverlap(player.x, player.y, TANK_SUB, TANK_SUB, this.powerUp.x, this.powerUp.y, HALF_SUB, HALF_SUB)) return;

    const kind = this.powerUp.kind;
    this.powerUp = null;
    this.addScore(POWERUP.score, events);
    events.push({ type: 'powerUpPickup', kind, score: POWERUP.score });

    switch (kind) {
      case 'star':
        player.level = Math.min(player.level + 1, 3);
        player.bulletSpeed = player.level >= 1 ? SPEED.bulletFast : SPEED.bulletSlow;
        break;
      case 'grenade':
        this.destroyAllEnemies();
        break;
      case 'helmet':
        player.shieldTicks = Math.max(player.shieldTicks, POWERUP.helmetTicks);
        break;
      case 'clock':
        for (const t of this.tanks) {
          if (t.kind !== 'player' && t.alive) t.frozenTicks = POWERUP.clockTicks;
        }
        break;
      case 'shovel':
        this.activateShovel();
        break;
      case 'tank':
        this.lives += 1;
        break;
      default:
        throw new Error(`未知道具类型: ${String(kind)}`);
    }
  }

  /** [provisional] 手雷清场不计分（规则 12 明示），故不发出 enemyDestroyed 事件 */
  private destroyAllEnemies(): void {
    for (const tank of this.tanks) {
      if (tank.kind !== 'player' && tank.alive) tank.alive = false;
    }
  }

  private activateShovel(): void {
    this.shovelTicksRemaining = POWERUP.shovelTicks;
    for (const cell of BASE.wallCells) {
      this.terrain[cellIndex(cell.col, cell.row)] = Terrain.Steel;
    }
  }

  private updateShovel(): void {
    if (this.shovelTicksRemaining <= 0) return;
    this.shovelTicksRemaining -= 1;
    if (this.shovelTicksRemaining === 0) {
      for (const cell of BASE.wallCells) {
        const idx = cellIndex(cell.col, cell.row);
        if (this.terrain[idx] === Terrain.Steel) {
          this.terrain[idx] = Terrain.Brick;
          this.brickMask[idx] = QUARTER_FULL;
        }
      }
    }
  }

  /* ---------------- 内部：波次与终局 ---------------- */

  private updateWaveSpawning(): void {
    const total = this.level.enemyQueue.length;
    if (this.enemiesSpawned >= total) return;
    const aliveEnemies = this.tanks.filter((t) => t.kind !== 'player' && t.alive).length;
    if (aliveEnemies >= WAVE.maxAlive) return;
    if (this.tickCount - this.lastEnemySpawnTick < WAVE.spawnIntervalTicks) return;

    const cellIdx = this.enemiesSpawned % WAVE.spawnCells.length;
    const cell = requireDefined(WAVE.spawnCells[cellIdx], 'WAVE.spawnCells 为空');
    const x = cell.col * HALF_SUB;
    const y = cell.row * HALF_SUB;
    if (this.tanksCollide(-1, x, y)) return; // 出生点被占用，顺延到下一 tick 重试

    const kind = requireDefined(this.level.enemyQueue[this.enemiesSpawned], 'enemyQueue 越界');
    const flashing = WAVE.flashIndices.includes(this.enemiesSpawned);
    const hp = ENEMY[kind].hp;
    const tank: TankState = {
      id: this.nextTankId++,
      kind,
      x,
      y,
      dir: Dir.Down,
      axis: 'v',
      level: 0,
      hp,
      maxHp: hp,
      flashing,
      shieldTicks: 0,
      frozenTicks: 0,
      spawningTicks: WAVE.spawnStarTicks,
      trackPhase: 0,
      moved: false,
      iceSlideRemaining: 0,
      prevFireInput: false,
      alive: true,
      speed: ENEMY[kind].speed,
      bulletSpeed: ENEMY[kind].bulletSpeed,
      aiNextReconsiderTick: this.tickCount,
    };
    this.tanks.push(tank);
    this.enemiesSpawned += 1;
    this.lastEnemySpawnTick = this.tickCount;
  }

  private updateTimersAndCleanup(): void {
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (tank.shieldTicks > 0) tank.shieldTicks -= 1;
      if (tank.frozenTicks > 0) tank.frozenTicks -= 1;
      if (tank.spawningTicks > 0) tank.spawningTicks -= 1;
      if (tank.moved) tank.trackPhase += 1;
    }
    this.tanks = this.tanks.filter((t) => t.alive || t.kind === 'player');
  }

  private checkStageClearOrGameOver(events: SimEvent[]): void {
    if (this._status !== 'playing') return;
    const total = this.level.enemyQueue.length;
    if (this.enemiesSpawned < total) return;
    const anyEnemyAlive = this.tanks.some((t) => t.kind !== 'player' && t.alive);
    if (!anyEnemyAlive) {
      this._status = 'stageClear';
      events.push({ type: 'stageClear' });
    }
  }
}
