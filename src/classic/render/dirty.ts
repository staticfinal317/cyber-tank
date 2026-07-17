/**
 * 经典复刻 · 地形脏格 diff（纯函数，无 canvas 依赖）
 *
 * 供地形离屏缓存增量重绘使用：两份 terrain/brickMask 快照 → 变化的半格（flat index）列表。
 * prevTerrain/prevBrickMask 传 null 表示"无历史"，视为全部格子脏（首帧全量绘制）。
 * 返回 flat index（= row*grid+col）而非 {col,row} 对象，避免逐帧产生大量小对象。
 */
import { GRID } from '../core/constants';

/**
 * @param out 可选的复用数组（避免逐帧新分配）；传入时会被就地清空重填并作为返回值
 */
export function diffDirtyCells(
  prevTerrain: Readonly<Uint8Array> | null,
  nextTerrain: Readonly<Uint8Array>,
  prevBrickMask: Readonly<Uint8Array> | null,
  nextBrickMask: Readonly<Uint8Array>,
  out: number[] = [],
): number[] {
  out.length = 0;
  const count = nextTerrain.length;
  for (let i = 0; i < count; i += 1) {
    const terrainChanged = prevTerrain === null || prevTerrain[i] !== nextTerrain[i];
    const brickChanged = prevBrickMask === null || prevBrickMask[i] !== nextBrickMask[i];
    if (terrainChanged || brickChanged) out.push(i);
  }
  return out;
}

export function cellCol(index: number, grid: number = GRID): number {
  return index % grid;
}

export function cellRow(index: number, grid: number = GRID): number {
  return Math.floor(index / grid);
}
