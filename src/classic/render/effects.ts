/**
 * 经典复刻 · 渲染特效队列（纯逻辑 + 池化数组，无 canvas 依赖）
 *
 * 生命周期完全由 snapshot.tick 差驱动，禁止 Date.now/performance.now。
 * 事件坐标换算（subpx→逻辑 px、坦克/基地中心点解析）由调用方（ClassicRenderer）完成后
 * 再调用 EffectQueue.spawn；本模块只负责"给定 kind+中心点+当前 tick → 特效对象与队列生命周期"。
 */
import { FX } from '../core/constants';
import type { SimEvent } from '../core/types';

export type EffectKind = 'explosionSmall' | 'explosionBig';

export interface Effect {
  kind: EffectKind;
  /** 特效中心点，逻辑 px */
  cx: number;
  cy: number;
  startTick: number;
  /** 独占端点：tick >= endTick 视为过期 */
  endTick: number;
}

const EFFECT_DURATION_TICKS: Record<EffectKind, number> = {
  explosionSmall: FX.smallExplosionTicks,
  explosionBig: FX.bigExplosionTicks,
};

/** 事件类型 → 特效种类的纯映射；无对应特效的事件类型（fire/tankHit/道具类等）返回 null */
export function explosionKindForEvent(eventType: SimEvent['type']): EffectKind | null {
  switch (eventType) {
    case 'brickHit':
    case 'steelHit':
    case 'bulletsCancel':
      return 'explosionSmall';
    case 'enemyDestroyed':
    case 'playerDestroyed':
    case 'baseDestroyed':
      return 'explosionBig';
    default:
      return null;
  }
}

export function makeEffect(kind: EffectKind, cx: number, cy: number, tick: number): Effect {
  return { kind, cx, cy, startTick: tick, endTick: tick + EFFECT_DURATION_TICKS[kind] };
}

export function isEffectExpired(effect: Effect, tick: number): boolean {
  return tick >= effect.endTick;
}

/** 特效当前应播放的图集帧序号：按经过时长在 [0, frameCount) 内线性映射，末帧钳制 */
export function effectFrameIndex(effect: Effect, tick: number, frameCount: number): number {
  const duration = effect.endTick - effect.startTick;
  const elapsed = tick - effect.startTick;
  const ratio = duration > 0 ? elapsed / duration : 0;
  const idx = Math.floor(ratio * frameCount);
  return Math.min(frameCount - 1, Math.max(0, idx));
}

/** 特效队列：入队 + 按 tick 推进过期项（原地压缩数组，避免逐帧新分配） */
export class EffectQueue {
  private items: Effect[] = [];

  spawn(kind: EffectKind, cx: number, cy: number, tick: number): void {
    this.items.push(makeEffect(kind, cx, cy, tick));
  }

  /** 移除本 tick 已到期的特效；原地压缩数组，不产生新数组 */
  advance(tick: number): void {
    let write = 0;
    for (let read = 0; read < this.items.length; read += 1) {
      const item = this.items[read];
      if (!item) continue;
      if (!isEffectExpired(item, tick)) {
        this.items[write] = item;
        write += 1;
      }
    }
    this.items.length = write;
  }

  get list(): readonly Effect[] {
    return this.items;
  }

  clear(): void {
    this.items.length = 0;
  }
}
