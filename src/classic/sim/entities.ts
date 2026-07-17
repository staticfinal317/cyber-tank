/**
 * 经典复刻 · 模拟内部实体状态（非公开契约，仅 sim/ 内部模块间共享）
 *
 * 与 core/types.ts 的 TankView/BulletView/PowerUpView 一一对应，但携带渲染快照不需要暴露的
 * 内部字段（AI 计时器、开火边沿检测、冰面滑行剩余等）。
 */
import type { Dir, EnemyKind, PowerUpKind } from '../core/types';

export type TankAxis = 'h' | 'v';

export interface TankState {
  id: number;
  kind: 'player' | EnemyKind;
  /** 玩家编号（0=P1，1=P2）；敌人恒 0，仅 kind='player' 时有意义 */
  playerIndex: number;
  /** 左上角坐标，subpx */
  x: number;
  y: number;
  dir: Dir;
  /** 当前朝向所属轴，用于判定"横转纵/纵转横"触发格点吸附 */
  axis: TankAxis;
  /** 玩家星级 0-3；敌人恒 0 */
  level: number;
  hp: number;
  maxHp: number;
  /** 闪烁坦克标记：命中一次即掉道具并清除该标记 */
  flashing: boolean;
  shieldTicks: number;
  frozenTicks: number;
  spawningTicks: number;
  trackPhase: number;
  /** 本 tick 是否发生了实际位移（决定 trackPhase 是否递增） */
  moved: boolean;
  iceSlideRemaining: number;
  /** 上一 tick 的开火输入（用于玩家开火边沿触发判定） */
  prevFireInput: boolean;
  alive: boolean;
  speed: number;
  /** 移动速度对应的子弹初速（玩家随星级、敌人按 kind 固定） */
  bulletSpeed: number;
  /** 敌方 AI：下次允许/强制重新选择方向的 tick */
  aiNextReconsiderTick: number;
}

export interface BulletState {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  fromPlayer: boolean;
  speed: number;
  ownerTankId: number;
  /** 子弹所有者的玩家编号；敌方子弹恒 0（不参与 owner 归属判定，靠 fromPlayer 区分） */
  ownerPlayerIndex: number;
  /** 玩家 3 星子弹：钢墙整格摧毁 + 砖墙双倍破坏 */
  maxLevelPlayerBullet: boolean;
  removed: boolean;
}

export interface PowerUpState {
  kind: PowerUpKind;
  x: number;
  y: number;
}
