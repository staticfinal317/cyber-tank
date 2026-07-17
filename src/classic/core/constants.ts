/**
 * 经典复刻 · 全局常量（架构契约，改动需主线评审）
 *
 * 标注 [provisional] 的数值无权威公开来源（见 docs/BATTLE_CITY_REMAKE_PLAN.md 附录 A.9），
 * Alpha 阶段以 FC 逐帧实测校正；数值只允许在本文件调整，禁止在逻辑代码中散落魔法数。
 */

/** 棋盘：13×13 大格 = 26×26 半格，逻辑分辨率 208×208 px */
export const GRID = 26;
export const HALF_PX = 8;
export const FIELD_PX = GRID * HALF_PX; // 208

/** 定点数：1 逻辑 px = 16 subpx。模拟内所有坐标/速度均为整数 subpx，保证确定性 */
export const SUBPX = 16;
export const FIELD_SUB = FIELD_PX * SUBPX;
export const HALF_SUB = HALF_PX * SUBPX;

/** 模拟固定步长 60Hz */
export const TICK_RATE = 60;

/** 坦克体积：16×16 px（2×2 半格） */
export const TANK_PX = 16;
export const TANK_SUB = TANK_PX * SUBPX;

/** 子弹体积：4×4 px */
export const BULLET_PX = 4;
export const BULLET_SUB = BULLET_PX * SUBPX;

/** 速度（subpx/tick）[provisional] */
export const SPEED = {
  player: 12,
  enemyBasic: 8,
  enemyFast: 16,
  enemyPower: 10,
  enemyArmor: 8,
  bulletSlow: 32, // 玩家 0 星 / 敌方基础
  bulletFast: 48, // 玩家 1 星+ / 加农坦克
} as const;

/** 敌方配置（分值/耐久为考据确认值，速度引用 SPEED） */
export const ENEMY = {
  basic: { hp: 1, score: 100, speed: SPEED.enemyBasic, bulletSpeed: SPEED.bulletSlow },
  fast: { hp: 1, score: 200, speed: SPEED.enemyFast, bulletSpeed: SPEED.bulletSlow },
  power: { hp: 1, score: 300, speed: SPEED.enemyPower, bulletSpeed: SPEED.bulletFast },
  armor: { hp: 4, score: 400, speed: SPEED.enemyArmor, bulletSpeed: SPEED.bulletSlow },
} as const;

/** 波次规则（考据确认：每关 20 敌、场上 4、闪烁坦克为第 4/11/18 辆） */
export const WAVE = {
  totalEnemies: 20,
  maxAlive: 4,
  /** 0-based 序号：第 4、11、18 辆 */
  flashIndices: [3, 10, 17] as readonly number[],
  /** 出生点半格坐标（col,row）：左上/中上/右上 */
  spawnCells: [
    { col: 0, row: 0 },
    { col: 12, row: 0 },
    { col: 24, row: 0 },
  ] as readonly { col: number; row: number }[],
  /** 敌人出生动画（星星）时长，期间不可交互 [provisional] */
  spawnStarTicks: 60,
  /** 相邻两次敌人投放的最小间隔 [provisional] */
  spawnIntervalTicks: 120,
} as const;

/** 玩家规则 */
export const PLAYER = {
  initialLives: 3,
  /** 出生点半格坐标（col,row）：基地左侧（原版 P1 位置） */
  spawnCell: { col: 8, row: 24 },
  /** 出生/复活无敌时长 [provisional] */
  spawnShieldTicks: 180,
  /** 0-1 星同屏 1 发，2 星起 2 发（考据确认） */
  maxBullets: [1, 1, 2, 2] as readonly number[],
  /** 每 20000 分奖 1 命（FC 版，考据确认） */
  extraLifeScore: 20000,
} as const;

/** 道具规则（拾取 +500 分为考据确认；时长 [provisional]） */
export const POWERUP = {
  score: 500,
  helmetTicks: 600, // 10s
  clockTicks: 600, // 10s
  shovelTicks: 1200, // 20s
  /** 铁锹失效前钢/砖闪烁提示时长 [provisional] */
  shovelBlinkTicks: 240,
} as const;

/** 基地（老鹰）：占 2×2 半格，底边居中（原版位置），左上角为 cell */
export const BASE = {
  cell: { col: 12, row: 24 },
  /** 基地围墙半格坐标（左/上/右三面，底边贴场地边界；铁锹改写此范围） */
  wallCells: [
    { col: 11, row: 23 }, { col: 12, row: 23 }, { col: 13, row: 23 }, { col: 14, row: 23 },
    { col: 11, row: 24 }, { col: 14, row: 24 },
    { col: 11, row: 25 }, { col: 14, row: 25 },
  ] as readonly { col: number; row: number }[],
} as const;

/** 冰面打滑：松开方向后惯性滑行时长 [provisional] */
export const ICE_SLIDE_TICKS = 24;

/** 爆炸动画帧数（渲染层节奏参考）[provisional] */
export const FX = {
  smallExplosionTicks: 12,
  bigExplosionTicks: 24,
} as const;
