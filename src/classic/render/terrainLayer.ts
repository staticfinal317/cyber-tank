/**
 * 经典复刻 · 地形离屏缓存层（含独立的树木覆盖层）
 *
 * 首帧全量绘制；之后按 diffDirtyCells 增量重绘变化的半格。
 * 树木画在独立离屏 canvas 上（渲染层由 ClassicRenderer 负责在坦克之上叠加）。
 * 水面 2 帧动画：仅对已缓存的水面格按 tick 周期重画（"数量少，每帧检查即可"）。
 */
import { Terrain } from '../core/types';
import { GRID, HALF_PX, FIELD_PX } from '../core/constants';
import type { SpriteAtlas } from './sprites';
import { diffDirtyCells, cellCol, cellRow } from './dirty';

/** 砖块 1/4 掩码 bit 定义：bit0 左上 bit1 右上 bit2 左下 bit3 右下（与 core/types.ts 文档一致） */
const QUARTER_TL = 0b0001;
const QUARTER_TR = 0b0010;
const QUARTER_BL = 0b0100;
const QUARTER_BR = 0b1000;

/** 水面动画帧切换周期（渲染层内部节奏参数，纯视觉，非架构常量） */
const WATER_FRAME_TICKS = 30;

function createOffscreenContext(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建地形离屏 2D 上下文');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export class TerrainLayer {
  private readonly atlas: SpriteAtlas;
  private readonly terrainCanvas: HTMLCanvasElement;
  private readonly terrainCtx: CanvasRenderingContext2D;
  private readonly treesCanvas: HTMLCanvasElement;
  private readonly treesCtx: CanvasRenderingContext2D;

  private prevTerrain: Readonly<Uint8Array> | null = null;
  private prevBrickMask: Readonly<Uint8Array> | null = null;
  private waterCells: number[] = [];
  private dirtyScratch: number[] = [];
  private lastWaterFrame = -1;

  constructor(atlas: SpriteAtlas) {
    this.atlas = atlas;
    const terrain = createOffscreenContext(FIELD_PX);
    this.terrainCanvas = terrain.canvas;
    this.terrainCtx = terrain.ctx;
    const trees = createOffscreenContext(FIELD_PX);
    this.treesCanvas = trees.canvas;
    this.treesCtx = trees.ctx;
  }

  get canvas(): HTMLCanvasElement {
    return this.terrainCanvas;
  }

  get treesLayer(): HTMLCanvasElement {
    return this.treesCanvas;
  }

  /** 按当前快照增量更新离屏缓存；terrain/brickMask 为 snapshot 直传的只读数组 */
  update(terrain: Readonly<Uint8Array>, brickMask: Readonly<Uint8Array>, tick: number): void {
    const waterFrame = Math.floor(tick / WATER_FRAME_TICKS) % 2;
    const dirty = diffDirtyCells(this.prevTerrain, terrain, this.prevBrickMask, brickMask, this.dirtyScratch);

    for (const idx of dirty) {
      this.drawCell(cellCol(idx), cellRow(idx), terrain, brickMask, waterFrame);
    }
    if (dirty.length > 0) this.rebuildWaterCells(terrain);

    if (waterFrame !== this.lastWaterFrame) {
      this.lastWaterFrame = waterFrame;
      for (const idx of this.waterCells) {
        this.blit(this.terrainCtx, 'terrain.water', waterFrame, cellCol(idx) * HALF_PX, cellRow(idx) * HALF_PX);
      }
    }

    this.prevTerrain = terrain;
    this.prevBrickMask = brickMask;
  }

  private rebuildWaterCells(terrain: Readonly<Uint8Array>): void {
    this.waterCells = [];
    for (let i = 0; i < terrain.length; i += 1) {
      if (terrain[i] === Terrain.Water) this.waterCells.push(i);
    }
  }

  private drawCell(
    col: number,
    row: number,
    terrain: Readonly<Uint8Array>,
    brickMask: Readonly<Uint8Array>,
    waterFrame: number,
  ): void {
    const idx = row * GRID + col;
    const px = col * HALF_PX;
    const py = row * HALF_PX;
    const value = terrain[idx] as Terrain;

    this.terrainCtx.fillStyle = '#000000';
    this.terrainCtx.fillRect(px, py, HALF_PX, HALF_PX);
    this.treesCtx.clearRect(px, py, HALF_PX, HALF_PX);

    switch (value) {
      case Terrain.Brick:
        this.drawBrick(px, py, brickMask[idx] ?? 0);
        break;
      case Terrain.Steel:
        this.blit(this.terrainCtx, 'terrain.steel', 0, px, py);
        break;
      case Terrain.Water:
        this.blit(this.terrainCtx, 'terrain.water', waterFrame, px, py);
        break;
      case Terrain.Trees:
        this.blit(this.treesCtx, 'terrain.trees', 0, px, py);
        break;
      case Terrain.Ice:
        this.blit(this.terrainCtx, 'terrain.ice', 0, px, py);
        break;
      default:
        break; // Empty：保持已填充的黑色背景
    }
  }

  private drawBrick(px: number, py: number, mask: number): void {
    const frame = this.atlas.frame('terrain.brick');
    const half = HALF_PX / 2; // 4px：砖块 1/4 子块边长
    const quarters: readonly [number, number, number][] = [
      [QUARTER_TL, 0, 0],
      [QUARTER_TR, half, 0],
      [QUARTER_BL, 0, half],
      [QUARTER_BR, half, half],
    ];
    for (const [bit, ox, oy] of quarters) {
      if ((mask & bit) === 0) continue;
      this.terrainCtx.drawImage(
        this.atlas.canvas,
        frame.x + ox,
        frame.y + oy,
        half,
        half,
        px + ox,
        py + oy,
        half,
        half,
      );
    }
  }

  private blit(ctx: CanvasRenderingContext2D, key: string, frameIndex: number, px: number, py: number): void {
    const frame = this.atlas.frame(key, frameIndex);
    ctx.drawImage(this.atlas.canvas, frame.x, frame.y, frame.w, frame.h, px, py, frame.w, frame.h);
  }
}
