/**
 * 经典复刻 · AABB 碰撞辅助（地形/基地/坦克通用）
 */
import { Terrain } from '../core/types';
import { GRID, HALF_SUB, TANK_SUB, FIELD_SUB } from '../core/constants';
import { cellIndex, isBaseCell, isBlockingTerrain } from './terrain';

export function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function withinField(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x + size <= FIELD_SUB && y + size <= FIELD_SUB;
}

/** AABB(x,y,size,size) 覆盖的半格范围（含端点） */
export function overlappedCellRange(x: number, y: number, size: number): {
  colStart: number; colEnd: number; rowStart: number; rowEnd: number;
} {
  return {
    colStart: Math.floor(x / HALF_SUB),
    colEnd: Math.floor((x + size - 1) / HALF_SUB),
    rowStart: Math.floor(y / HALF_SUB),
    rowEnd: Math.floor((y + size - 1) / HALF_SUB),
  };
}

/** 坦克（16×16px）在 (x,y) 处是否被地形或基地阻挡；越界视为阻挡 */
export function terrainBlocksTank(terrain: Uint8Array, x: number, y: number): boolean {
  if (!withinField(x, y, TANK_SUB)) return true;
  const { colStart, colEnd, rowStart, rowEnd } = overlappedCellRange(x, y, TANK_SUB);
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      if (col < 0 || col >= GRID || row < 0 || row >= GRID) return true;
      if (isBaseCell(col, row)) return true;
      const t = terrain[cellIndex(col, row)] as Terrain;
      if (isBlockingTerrain(t)) return true;
    }
  }
  return false;
}
