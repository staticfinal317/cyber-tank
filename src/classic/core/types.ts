/**
 * 经典复刻 · 类型契约（架构契约，改动需主线评审）
 *
 * 分层不变式：
 * 1. `src/classic/sim/` 只依赖本文件、constants.ts 与注入的 RNG，零浏览器 API、零 Math.random/Date.now。
 * 2. 渲染与 UI 只消费 WorldSnapshot 与 SimEvent，不得直接读写模拟内部状态。
 * 3. 所有坐标为整数 subpx（见 constants.SUBPX）。
 */

import type { RNG } from '../../core/RNG';

/** 方向：顺时针，Up=0（精灵图/转向逻辑均按此序） */
export enum Dir {
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3,
}

/** 地形（碰撞层每半格一个枚举值） */
export enum Terrain {
  Empty = 0,
  Brick = 1,
  Steel = 2,
  Water = 3,
  Trees = 4,
  Ice = 5,
}

/**
 * 关卡文本网格字符 → 地形映射：
 * '.'=Empty  'B'=Brick  'S'=Steel  'W'=Water  'T'=Trees  'I'=Ice
 * 基地与出生点位置固定（constants.BASE / WAVE / PLAYER），不进网格字符。
 */
export const TERRAIN_CHARS: Readonly<Record<string, Terrain>> = {
  '.': Terrain.Empty,
  B: Terrain.Brick,
  S: Terrain.Steel,
  W: Terrain.Water,
  T: Terrain.Trees,
  I: Terrain.Ice,
};

export type EnemyKind = 'basic' | 'fast' | 'power' | 'armor';

export type PowerUpKind = 'star' | 'grenade' | 'helmet' | 'clock' | 'shovel' | 'tank';

/** 关卡数据：grid 为 26 行、每行 26 字符的文本网格 */
export interface LevelData {
  stage: number;
  grid: readonly string[];
  /** 长度 20，按出场顺序（闪烁与否由 WAVE.flashIndices 决定，不在此表达） */
  enemyQueue: readonly EnemyKind[];
}

/** 单个玩家的一帧输入（键盘/触屏/手柄归一化后的产物） */
export interface PlayerInput {
  /** 当前按住的方向；同时按多键时由输入层裁决（后按优先），模拟不做裁决 */
  dir: Dir | null;
  fire: boolean;
}

/* ---------- 快照（渲染/UI 只读视图） ---------- */

export interface TankView {
  id: number;
  kind: 'player' | EnemyKind;
  /** 左上角坐标，subpx */
  x: number;
  y: number;
  dir: Dir;
  /** 玩家星级 0-3；敌人恒 0 */
  level: number;
  /** 装甲坦克剩余耐久（渲染变色用）；其余为 1 */
  hp: number;
  flashing: boolean;
  /** >0 表示无敌护盾剩余 tick（渲染护盾动画） */
  shieldTicks: number;
  /** >0 表示冻结/出生动画剩余 tick */
  frozenTicks: number;
  spawningTicks: number;
  /** 履带动画相位（模拟推进，保证回放一致） */
  trackPhase: number;
}

export interface BulletView {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  fromPlayer: boolean;
}

export interface PowerUpView {
  kind: PowerUpKind;
  x: number;
  y: number;
}

export interface WorldSnapshot {
  tick: number;
  stage: number;
  status: 'playing' | 'stageClear' | 'gameOver';
  /** 长度 GRID*GRID，Terrain 枚举值（行优先） */
  terrain: Readonly<Uint8Array>;
  /**
   * 长度 GRID*GRID 的砖块 1/4 位掩码：bit0 左上 bit1 右上 bit2 左下 bit3 右下；
   * 仅 Terrain.Brick 的格子有效，0b1111=完整
   */
  brickMask: Readonly<Uint8Array>;
  baseAlive: boolean;
  /** 铁锹生效剩余 tick（渲染钢墙/闪烁提示） */
  shovelTicks: number;
  tanks: readonly TankView[];
  bullets: readonly BulletView[];
  powerUp: PowerUpView | null;
  hud: {
    enemiesRemaining: number; // 尚未出场的敌人数（右栏图标）
    lives: number;
    score: number;
    stage: number;
  };
}

/* ---------- 事件（音频/特效/UI 消费，一次 tick 可产生多条） ---------- */

export type SimEvent =
  | { type: 'fire'; fromPlayer: boolean }
  | { type: 'brickHit'; x: number; y: number }
  | { type: 'steelHit'; x: number; y: number }
  | { type: 'steelBreak'; x: number; y: number }
  | { type: 'bulletsCancel'; x: number; y: number }
  | { type: 'tankHit'; tankId: number } // 装甲坦克掉血未死
  | { type: 'enemyDestroyed'; tankId: number; kind: EnemyKind; score: number; x: number; y: number }
  | { type: 'playerDestroyed'; tankId: number }
  | { type: 'playerRespawn' }
  | { type: 'powerUpSpawn'; kind: PowerUpKind }
  | { type: 'powerUpPickup'; kind: PowerUpKind; score: number }
  | { type: 'extraLife' }
  | { type: 'baseDestroyed' }
  | { type: 'stageClear' }
  | { type: 'gameOver' };

/* ---------- 模拟接口 ---------- */

export interface ClassicWorldOptions {
  level: LevelData;
  rng: RNG;
  /** 携带上一关的玩家状态（星级/命数/分数）；首关传 undefined */
  carryOver?: { level: number; lives: number; score: number };
}

/**
 * 确定性模拟：同一 (level, seed, 输入序列) 必产生逐 tick 相同的快照与哈希。
 * 实现类：src/classic/sim/World.ts
 */
export interface ClassicWorld {
  readonly status: WorldSnapshot['status'];
  /** 推进一个 tick（60Hz）。inputs[0] 为 P1；返回本 tick 产生的事件 */
  tick(inputs: readonly PlayerInput[]): SimEvent[];
  snapshot(): WorldSnapshot;
  /** 关键状态的 FNV-1a 哈希，供确定性回归测试与回放校验 */
  hash(): number;
}
