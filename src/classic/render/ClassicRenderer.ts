/**
 * 经典复刻 · Canvas 2D 分层渲染器（M5）
 *
 * 纯消费方：只读取 WorldSnapshot 与 SimEvent，不导入 sim/ 任何模块、不访问模拟内部状态。
 * 渲染循环（rAF）由上层 M6 持有；本类被动响应 render()/resize()/dispose() 调用，不自建定时器。
 */
import { Dir, type SimEvent, type TankView, type WorldSnapshot } from '../core/types';
import { BASE, FIELD_PX, HALF_PX, POWERUP, SUBPX, TANK_PX, WAVE } from '../core/constants';
import { buildAtlas, type SpriteAtlas, type SpriteFrame } from './sprites';
import { computeLayout, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './layout';
import { EffectQueue, effectFrameIndex, explosionKindForEvent, type Effect } from './effects';
import { drawNumber } from './digits';
import { TerrainLayer } from './terrainLayer';

export interface ClassicRendererOptions {
  container: HTMLElement;
}

/** 渲染层内部节奏参数（纯视觉动画节拍，非架构常量，不进 core/constants.ts） */
const FLASH_BLINK_TICKS = 15;
const SHIELD_BLINK_TICKS = 8;
const SHOVEL_BLINK_PERIOD_TICKS = 8;

function subToPx(subpx: number): number {
  return Math.floor(subpx / SUBPX);
}

function resolveTankSpriteKey(tank: TankView, tick: number): string {
  if (tank.kind === 'player') return `tank.player.l${tank.level}`;
  if (tank.flashing && Math.floor(tick / FLASH_BLINK_TICKS) % 2 === 0) {
    return `tank.enemy.${tank.kind}.flash`;
  }
  if (tank.kind === 'armor' && tank.hp >= 1 && tank.hp <= 3) {
    return `tank.enemy.armor.hp${tank.hp}`;
  }
  return `tank.enemy.${tank.kind}`;
}

/** 精灵只有朝上帧；按 Dir 顺时针旋转 90° 的倍数，旋转中心为帧中点 */
function drawRotatedSprite(
  ctx: CanvasRenderingContext2D,
  atlasCanvas: HTMLCanvasElement | OffscreenCanvas,
  frame: SpriteFrame,
  dir: Dir,
  topLeftX: number,
  topLeftY: number,
): void {
  if (dir === Dir.Up) {
    ctx.drawImage(atlasCanvas, frame.x, frame.y, frame.w, frame.h, topLeftX, topLeftY, frame.w, frame.h);
    return;
  }
  const cx = topLeftX + frame.w / 2;
  const cy = topLeftY + frame.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dir * (Math.PI / 2));
  ctx.drawImage(atlasCanvas, frame.x, frame.y, frame.w, frame.h, -frame.w / 2, -frame.h / 2, frame.w, frame.h);
  ctx.restore();
}

/** 出生星星动画帧序号：按剩余 tick 占总时长的进度线性映射到 [0, frameCount) */
function spawnFrameIndex(remainingTicks: number, totalTicks: number, frameCount: number): number {
  const elapsed = totalTicks - remainingTicks;
  const ratio = totalTicks > 0 ? elapsed / totalTicks : 0;
  const idx = Math.floor(ratio * frameCount);
  return Math.min(frameCount - 1, Math.max(0, idx));
}

/**
 * 事件坐标（subpx）→ 特效中心点（px）的纯映射，供 ingestEvents 消费，亦单独导出以便在
 * node 环境直接单测（ClassicRenderer 本体需要浏览器 canvas，无法在 node 实例化）。
 * brickHit/steelHit 为半格左上角，bulletsCancel 为碰撞点，其余（含 playerDestroyed/
 * baseDestroyed，均携带左上角坐标）与 enemyDestroyed 同为坦克/基地左上角。
 */
export function resolveEffectCenter(event: SimEvent): { cx: number; cy: number } | null {
  switch (event.type) {
    case 'brickHit':
    case 'steelHit':
      return { cx: subToPx(event.x) + HALF_PX / 2, cy: subToPx(event.y) + HALF_PX / 2 };
    case 'bulletsCancel':
      return { cx: subToPx(event.x), cy: subToPx(event.y) };
    case 'enemyDestroyed':
    case 'playerDestroyed':
    case 'baseDestroyed':
      return { cx: subToPx(event.x) + TANK_PX / 2, cy: subToPx(event.y) + TANK_PX / 2 };
    default:
      return null;
  }
}

export class ClassicRenderer {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: SpriteAtlas;
  private readonly terrainLayer: TerrainLayer;
  private readonly effects = new EffectQueue();

  constructor(options: ClassicRendererOptions) {
    if (!(options?.container instanceof HTMLElement)) {
      throw new Error('ClassicRenderer 需要合法的 container: HTMLElement');
    }
    this.container = options.container;

    // 图集构建失败（如非浏览器环境）直接抛出，不吞异常
    this.atlas = buildAtlas();

    this.canvas = document.createElement('canvas');
    this.canvas.width = LOGICAL_WIDTH;
    this.canvas.height = LOGICAL_HEIGHT;
    this.canvas.style.position = 'absolute';
    this.canvas.style.setProperty('image-rendering', 'pixelated');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取渲染 2D 上下文');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.style.overflow = 'hidden';
    this.container.style.background = '#000000';
    this.container.appendChild(this.canvas);

    this.terrainLayer = new TerrainLayer(this.atlas);

    this.resize();
  }

  /** 容器尺寸变化时调用，重算整数缩放；只改变显示尺寸/位置，canvas 内部逻辑分辨率恒定 */
  resize(): void {
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    const { scale, offsetX, offsetY } = computeLayout(containerW, containerH);
    this.canvas.style.width = `${LOGICAL_WIDTH * scale}px`;
    this.canvas.style.height = `${LOGICAL_HEIGHT * scale}px`;
    this.canvas.style.left = `${offsetX}px`;
    this.canvas.style.top = `${offsetY}px`;
  }

  /** 每帧调用：绘制快照 + 消费本帧事件（特效由事件驱动，生命周期按 snapshot.tick 推进） */
  render(snapshot: WorldSnapshot, events: readonly SimEvent[]): void {
    const tick = snapshot.tick;
    this.ingestEvents(events, tick);
    this.effects.advance(tick);

    this.terrainLayer.update(snapshot.terrain, snapshot.brickMask, tick);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    ctx.drawImage(this.terrainLayer.canvas, 0, 0);
    this.drawShovelBlink(ctx, snapshot);

    this.drawBase(ctx, snapshot.baseAlive);
    if (snapshot.powerUp) this.drawPowerUp(ctx, snapshot.powerUp.kind, snapshot.powerUp.x, snapshot.powerUp.y);
    for (const tank of snapshot.tanks) this.drawTank(ctx, tank, tick);
    for (const bullet of snapshot.bullets) {
      const frame = this.atlas.frame('bullet');
      drawRotatedSprite(ctx, this.atlas.canvas, frame, bullet.dir, subToPx(bullet.x), subToPx(bullet.y));
    }

    for (const effect of this.effects.list) this.drawEffect(ctx, effect, tick);

    ctx.drawImage(this.terrainLayer.treesLayer, 0, 0);

    this.drawHud(ctx, snapshot);
  }

  /** 移除 canvas 与内部状态，释放资源；不移除任何监听（本类未注册过监听） */
  dispose(): void {
    this.canvas.remove();
    this.effects.clear();
  }

  /* ---------------- 事件 → 特效 ---------------- */

  private ingestEvents(events: readonly SimEvent[], tick: number): void {
    for (const event of events) {
      const kind = explosionKindForEvent(event.type);
      if (!kind) continue;
      const center = resolveEffectCenter(event);
      if (!center) continue;
      this.effects.spawn(kind, center.cx, center.cy, tick);
    }
  }

  /* ---------------- 实体层 ---------------- */

  private drawBase(ctx: CanvasRenderingContext2D, alive: boolean): void {
    const key = alive ? 'base.alive' : 'base.dead';
    const frame = this.atlas.frame(key);
    ctx.drawImage(
      this.atlas.canvas,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      BASE.cell.col * HALF_PX,
      BASE.cell.row * HALF_PX,
      frame.w,
      frame.h,
    );
  }

  private drawPowerUp(ctx: CanvasRenderingContext2D, kind: string, xSub: number, ySub: number): void {
    const frame = this.atlas.frame(`powerup.${kind}`);
    ctx.drawImage(this.atlas.canvas, frame.x, frame.y, frame.w, frame.h, subToPx(xSub), subToPx(ySub), frame.w, frame.h);
  }

  private drawTank(ctx: CanvasRenderingContext2D, tank: TankView, tick: number): void {
    const px = subToPx(tank.x);
    const py = subToPx(tank.y);

    if (tank.spawningTicks > 0) {
      const frameCount = this.atlas.frameCount('fx.spawn');
      const idx = spawnFrameIndex(tank.spawningTicks, WAVE.spawnStarTicks, frameCount);
      const frame = this.atlas.frame('fx.spawn', idx);
      ctx.drawImage(this.atlas.canvas, frame.x, frame.y, frame.w, frame.h, px, py, frame.w, frame.h);
      return; // 出生动画期间不画坦克本体
    }

    const key = resolveTankSpriteKey(tank, tick);
    const frameCount = this.atlas.frameCount(key);
    const frameIndex = tank.trackPhase % frameCount;
    const frame = this.atlas.frame(key, frameIndex);
    drawRotatedSprite(ctx, this.atlas.canvas, frame, tank.dir, px, py);

    if (tank.shieldTicks > 0) {
      const shieldFrameCount = this.atlas.frameCount('fx.shield');
      const shieldIdx = Math.floor(tick / SHIELD_BLINK_TICKS) % shieldFrameCount;
      const shieldFrame = this.atlas.frame('fx.shield', shieldIdx);
      ctx.drawImage(this.atlas.canvas, shieldFrame.x, shieldFrame.y, shieldFrame.w, shieldFrame.h, px, py, shieldFrame.w, shieldFrame.h);
    }
  }

  private drawEffect(ctx: CanvasRenderingContext2D, effect: Effect, tick: number): void {
    const key = effect.kind === 'explosionBig' ? 'fx.explosion.big' : 'fx.explosion.small';
    const frameCount = this.atlas.frameCount(key);
    const idx = effectFrameIndex(effect, tick, frameCount);
    const frame = this.atlas.frame(key, idx);
    const px = Math.round(effect.cx - frame.w / 2);
    const py = Math.round(effect.cy - frame.h / 2);
    ctx.drawImage(this.atlas.canvas, frame.x, frame.y, frame.w, frame.h, px, py, frame.w, frame.h);
  }

  /** 铁锹失效倒计时最后阶段：基地围墙格在钢/砖贴图间闪烁（真实地形以 snapshot.terrain 为准，这里只是提示层） */
  private drawShovelBlink(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    if (snapshot.shovelTicks <= 0 || snapshot.shovelTicks > POWERUP.shovelBlinkTicks) return;
    const blinkOn = Math.floor(snapshot.tick / SHOVEL_BLINK_PERIOD_TICKS) % 2 === 0;
    const key = blinkOn ? 'terrain.steel' : 'terrain.brick';
    const frame = this.atlas.frame(key);
    for (const cell of BASE.wallCells) {
      ctx.drawImage(
        this.atlas.canvas,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
        cell.col * HALF_PX,
        cell.row * HALF_PX,
        frame.w,
        frame.h,
      );
    }
  }

  /* ---------------- HUD ---------------- */

  private drawHud(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    const hudX = FIELD_PX;
    const cols = 2;
    const gap = 1;

    const enemyFrame = this.atlas.frame('hud.enemyIcon');
    const remaining = Math.max(0, snapshot.hud.enemiesRemaining);
    for (let i = 0; i < remaining; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = hudX + 4 + col * (enemyFrame.w + gap);
      const y = 4 + row * (enemyFrame.h + gap);
      ctx.drawImage(this.atlas.canvas, enemyFrame.x, enemyFrame.y, enemyFrame.w, enemyFrame.h, x, y, enemyFrame.w, enemyFrame.h);
    }

    const lifeFrame = this.atlas.frame('hud.lifeIcon');
    const lifeY = LOGICAL_HEIGHT - 24;
    ctx.drawImage(this.atlas.canvas, lifeFrame.x, lifeFrame.y, lifeFrame.w, lifeFrame.h, hudX + 4, lifeY, lifeFrame.w, lifeFrame.h);
    drawNumber(ctx, snapshot.hud.players[0]?.lives ?? 0, hudX + 4 + lifeFrame.w + gap + 2, lifeY + 2, 2, '#ffffff');

    drawNumber(ctx, snapshot.hud.stage, hudX + 4, LOGICAL_HEIGHT - 8, 2, '#ffffff');
  }
}
