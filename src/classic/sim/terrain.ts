/**
 * 经典复刻 · 地形层：网格解析、砖块 1/4 掩码、基地区域查询
 */
import { Terrain, TERRAIN_CHARS } from '../core/types';
import { GRID, BASE } from '../core/constants';

export const CELL_COUNT = GRID * GRID;

/** 砖块 1/4 掩码 bit 定义：bit0 左上 bit1 右上 bit2 左下 bit3 右下 */
export const QUARTER_TL = 0b0001;
export const QUARTER_TR = 0b0010;
export const QUARTER_BL = 0b0100;
export const QUARTER_BR = 0b1000;
export const QUARTER_FULL = QUARTER_TL | QUARTER_TR | QUARTER_BL | QUARTER_BR;

export function cellIndex(col: number, row: number): number {
  return row * GRID + col;
}

/** 解析 26×26 文本网格为地形数组；任何格式错误直接 throw（fail fast） */
export function parseTerrain(grid: readonly string[]): Uint8Array {
  if (grid.length !== GRID) {
    throw new Error(`关卡网格必须为 ${GRID} 行，实际 ${grid.length} 行`);
  }
  const terrain = new Uint8Array(CELL_COUNT);
  for (let row = 0; row < GRID; row += 1) {
    const line = grid[row];
    if (line === undefined || line.length !== GRID) {
      throw new Error(`关卡网格第 ${row} 行必须为 ${GRID} 字符`);
    }
    for (let col = 0; col < GRID; col += 1) {
      const ch = line[col] as string;
      const terrainValue = TERRAIN_CHARS[ch];
      if (terrainValue === undefined) {
        throw new Error(`关卡网格出现未知字符 '${ch}'（第 ${row} 行第 ${col} 列）`);
      }
      terrain[cellIndex(col, row)] = terrainValue;
    }
  }
  return terrain;
}

export function createBrickMask(terrain: Uint8Array): Uint8Array {
  const mask = new Uint8Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (terrain[i] === Terrain.Brick) mask[i] = QUARTER_FULL;
  }
  return mask;
}

const BASE_COL0 = BASE.cell.col;
const BASE_ROW0 = BASE.cell.row;

export function isBaseCell(col: number, row: number): boolean {
  return col >= BASE_COL0 && col < BASE_COL0 + 2 && row >= BASE_ROW0 && row < BASE_ROW0 + 2;
}

export function isBlockingTerrain(t: Terrain): boolean {
  return t === Terrain.Brick || t === Terrain.Steel || t === Terrain.Water;
}
