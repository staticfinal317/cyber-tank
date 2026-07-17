/**
 * 经典复刻 · 敌方 AI（权重状态机）
 *
 * [provisional] 以下所有权重常量均无官方权威数值来源（docs/BATTLE_CITY_REMAKE_PLAN.md §1.4/§3.6
 * 只给出定性描述："基础坦克高随机弱目标性""快速坦克强偏基地路线""加农中等目标性、远距开火意愿高"
 * "重型坦克稳步推进"）。具体数值为本次实现选取，Alpha 阶段以 FC 逐帧实测校正，禁止散落到其他文件。
 */
import { Dir, Terrain, type EnemyKind } from '../core/types';
import { HALF_SUB, TANK_SUB } from '../core/constants';
import type { RNG } from '../../core/RNG';
import { cellIndex } from './terrain';

interface AiWeights {
  /** 四个方向的基线随机权重 */
  randomWeight: number;
  /** 朝基地方向的额外权重 */
  baseBias: number;
  /** 朝玩家方向的额外权重 */
  playerBias: number;
  /** 无照面时的基础开火概率（每 tick 判定一次） */
  fireChance: number;
  /** 与目标同行/同列且面向、视线无 Steel 阻挡时的开火概率 */
  fireAlignedChance: number;
  /** 主动重新选择方向的周期（tick） */
  reconsiderTicks: number;
}

const AI_WEIGHTS: Record<EnemyKind, AiWeights> = {
  basic: { randomWeight: 6, baseBias: 1, playerBias: 0, fireChance: 0.01, fireAlignedChance: 0.05, reconsiderTicks: 90 },
  fast: { randomWeight: 2, baseBias: 6, playerBias: 1, fireChance: 0.01, fireAlignedChance: 0.06, reconsiderTicks: 75 },
  power: { randomWeight: 3, baseBias: 3, playerBias: 2, fireChance: 0.02, fireAlignedChance: 0.12, reconsiderTicks: 75 },
  armor: { randomWeight: 3, baseBias: 4, playerBias: 1, fireChance: 0.015, fireAlignedChance: 0.07, reconsiderTicks: 100 },
};

/** 顺序对应 [Up, Right, Down, Left]，与 Dir 枚举顺序一致 */
const DIRS: readonly Dir[] = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];

interface TargetRect { x: number; y: number; w: number; h: number }

/**
 * 取多个候选目标中离 (fromX, fromY) 直线距离最近者的中心点。
 * [provisional]：FC 真机按敌方坦克编号分配固定目标，本项目简化为取最近者，
 * 未按编号还原（考据成本高，见契约"被否方案"）。
 */
function nearestTargetCenter(targets: readonly TargetRect[], fromX: number, fromY: number): { cx: number; cy: number } | undefined {
  let best: { cx: number; cy: number } | undefined;
  let bestDist = Infinity;
  for (const t of targets) {
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const dist = (cx - fromX) ** 2 + (cy - fromY) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = { cx, cy };
    }
  }
  return best;
}

function weightedPickIndex(rng: RNG, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i] as number;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/** 把偏向 (dx,dy) 的权重叠加到四方向权重表上；偏向更强的轴获得完整 bias，另一轴获得一半 */
function addAxisBias(weights: [number, number, number, number], dx: number, dy: number, bias: number): void {
  if (bias <= 0) return;
  const horizPrimary = Math.abs(dx) >= Math.abs(dy);
  if (dx > 0) weights[1] += horizPrimary ? bias : bias / 2; // Right
  else if (dx < 0) weights[3] += horizPrimary ? bias : bias / 2; // Left
  if (dy > 0) weights[2] += horizPrimary ? bias / 2 : bias; // Down
  else if (dy < 0) weights[0] += horizPrimary ? bias / 2 : bias; // Up
}

/** 依据 kind 权重 + 注入 RNG 为敌方坦克选择新方向 */
export function pickEnemyDirection(
  kind: EnemyKind,
  enemyCenterX: number,
  enemyCenterY: number,
  baseCenterX: number,
  baseCenterY: number,
  playerTargets: readonly TargetRect[],
  rng: RNG,
): Dir {
  const w = AI_WEIGHTS[kind];
  const weights: [number, number, number, number] = [w.randomWeight, w.randomWeight, w.randomWeight, w.randomWeight];
  addAxisBias(weights, baseCenterX - enemyCenterX, baseCenterY - enemyCenterY, w.baseBias);
  const nearestPlayer = nearestTargetCenter(playerTargets, enemyCenterX, enemyCenterY);
  if (nearestPlayer) {
    addAxisBias(weights, nearestPlayer.cx - enemyCenterX, nearestPlayer.cy - enemyCenterY, w.playerBias);
  }
  const idx = weightedPickIndex(rng, weights);
  return DIRS[idx] as Dir;
}

export function enemyReconsiderTicks(kind: EnemyKind): number {
  return AI_WEIGHTS[kind].reconsiderTicks;
}

/**
 * 敌方是否与目标（玩家或基地）同行/同列、朝向目标、且视线上 2 半格宽的走廊内无 Steel。
 * 只检测 Steel（不检测 Brick）——子弹能打穿砖墙，对着砖墙开火仍然"有意义"。
 */
function facingClearShot(terrain: Uint8Array, enemyX: number, enemyY: number, dir: Dir, target: TargetRect): boolean {
  if (dir === Dir.Up || dir === Dir.Down) {
    const overlapsColumn = enemyX < target.x + target.w && enemyX + TANK_SUB > target.x;
    if (!overlapsColumn) return false;
    if (dir === Dir.Up && !(target.y < enemyY)) return false;
    if (dir === Dir.Down && !(target.y > enemyY)) return false;
    const colStart = Math.floor(enemyX / HALF_SUB);
    const colEnd = Math.floor((enemyX + TANK_SUB - 1) / HALF_SUB);
    const rowLo = Math.floor(Math.min(enemyY, target.y) / HALF_SUB);
    const rowHi = Math.floor((Math.max(enemyY, target.y) + TANK_SUB - 1) / HALF_SUB);
    for (let row = rowLo; row <= rowHi; row += 1) {
      for (let col = colStart; col <= colEnd; col += 1) {
        if (terrain[cellIndex(col, row)] === Terrain.Steel) return false;
      }
    }
    return true;
  }
  const overlapsRow = enemyY < target.y + target.h && enemyY + TANK_SUB > target.y;
  if (!overlapsRow) return false;
  if (dir === Dir.Left && !(target.x < enemyX)) return false;
  if (dir === Dir.Right && !(target.x > enemyX)) return false;
  const rowStart = Math.floor(enemyY / HALF_SUB);
  const rowEnd = Math.floor((enemyY + TANK_SUB - 1) / HALF_SUB);
  const colLo = Math.floor(Math.min(enemyX, target.x) / HALF_SUB);
  const colHi = Math.floor((Math.max(enemyX, target.x) + TANK_SUB - 1) / HALF_SUB);
  for (let col = colLo; col <= colHi; col += 1) {
    for (let row = rowStart; row <= rowEnd; row += 1) {
      if (terrain[cellIndex(col, row)] === Terrain.Steel) return false;
    }
  }
  return true;
}

export function shouldEnemyFire(
  kind: EnemyKind,
  terrain: Uint8Array,
  enemyX: number, enemyY: number, dir: Dir,
  playerTargets: readonly TargetRect[],
  baseTarget: TargetRect,
  rng: RNG,
): boolean {
  const w = AI_WEIGHTS[kind];
  // 空列表（全员出局）时 .some() 恒 false，自然退化为只判定基地，无需特判
  const aligned = playerTargets.some((t) => facingClearShot(terrain, enemyX, enemyY, dir, t))
    || facingClearShot(terrain, enemyX, enemyY, dir, baseTarget);
  const chance = aligned ? w.fireAlignedChance : w.fireChance;
  return rng.next() < chance;
}
