import { describe, expect, it } from 'vitest';
import { GRID, HALF_PX, SUBPX, TANK_PX } from '../src/classic/core/constants';
import { FX } from '../src/classic/core/constants';
import { computeLayout, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../src/classic/render/layout';
import { cellCol, cellRow, diffDirtyCells } from '../src/classic/render/dirty';
import { DIGIT_GLYPHS, DIGIT_HEIGHT, DIGIT_WIDTH } from '../src/classic/render/digits';
import {
  EffectQueue,
  effectFrameIndex,
  explosionKindForEvent,
  isEffectExpired,
  makeEffect,
} from '../src/classic/render/effects';
import {
  ClassicRenderer,
  resolveEffectCenter,
  resolveLifeRows,
  resolveTankSpriteKey,
} from '../src/classic/render/ClassicRenderer';
import { Dir, type PlayerHudView, type TankView } from '../src/classic/core/types';

describe('computeLayout · 整数缩放与居中偏移', () => {
  it('容器恰为逻辑分辨率整数倍时：scale 精确匹配，offset 为 0', () => {
    const layout = computeLayout(LOGICAL_WIDTH * 2, LOGICAL_HEIGHT * 2);
    expect(layout).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
  });

  it('容器尺寸非整数倍时：缩放向下取整，偏移居中', () => {
    const layout = computeLayout(500, 400);
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(Math.floor((500 - LOGICAL_WIDTH) / 2));
    expect(layout.offsetY).toBe(Math.floor((400 - LOGICAL_HEIGHT) / 2));
  });

  it('容器小于逻辑分辨率时：缩放钳制为 1（允许负偏移，由容器裁剪）', () => {
    const layout = computeLayout(100, 100);
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(Math.floor((100 - LOGICAL_WIDTH) / 2));
    expect(layout.offsetY).toBe(Math.floor((100 - LOGICAL_HEIGHT) / 2));
  });

  it('容器尺寸为 0 或负数时：不产生 NaN，缩放钳制为 1', () => {
    const zero = computeLayout(0, 0);
    expect(zero.scale).toBe(1);
    expect(Number.isFinite(zero.offsetX)).toBe(true);
    expect(Number.isFinite(zero.offsetY)).toBe(true);

    const negative = computeLayout(-10, -10);
    expect(negative.scale).toBe(1);
    expect(Number.isFinite(negative.offsetX)).toBe(true);
  });

  it('支持自定义逻辑分辨率参数（不依赖默认 208×208+HUD）', () => {
    const layout = computeLayout(100, 50, 20, 10);
    expect(layout).toEqual({ scale: 5, offsetX: 0, offsetY: 0 });
  });
});

describe('EffectQueue · 特效队列（事件→入队→按 tick 推进→到期出队）', () => {
  it('explosionKindForEvent：事件类型 → 特效种类的纯映射', () => {
    expect(explosionKindForEvent('brickHit')).toBe('explosionSmall');
    expect(explosionKindForEvent('steelHit')).toBe('explosionSmall');
    expect(explosionKindForEvent('bulletsCancel')).toBe('explosionSmall');
    expect(explosionKindForEvent('enemyDestroyed')).toBe('explosionBig');
    expect(explosionKindForEvent('playerDestroyed')).toBe('explosionBig');
    expect(explosionKindForEvent('baseDestroyed')).toBe('explosionBig');
    for (const noEffectType of [
      'fire',
      'tankHit',
      'steelBreak',
      'powerUpSpawn',
      'powerUpPickup',
      'extraLife',
      'stageClear',
      'gameOver',
      'playerRespawn',
    ] as const) {
      expect(explosionKindForEvent(noEffectType)).toBeNull();
    }
  });

  it('makeEffect 按 FX 常量设定 startTick/endTick；isEffectExpired 独占端点判定', () => {
    const effect = makeEffect('explosionSmall', 10, 20, 100);
    expect(effect.startTick).toBe(100);
    expect(effect.endTick).toBe(100 + FX.smallExplosionTicks);
    expect(isEffectExpired(effect, effect.endTick - 1)).toBe(false);
    expect(isEffectExpired(effect, effect.endTick)).toBe(true);
  });

  it('effectFrameIndex 按经过时长线性映射到 [0, frameCount)，末帧钳制', () => {
    const effect = makeEffect('explosionBig', 0, 0, 0); // duration = FX.bigExplosionTicks = 24
    const frameCount = 2;
    expect(effectFrameIndex(effect, 0, frameCount)).toBe(0);
    expect(effectFrameIndex(effect, 11, frameCount)).toBe(0);
    expect(effectFrameIndex(effect, 12, frameCount)).toBe(1);
    expect(effectFrameIndex(effect, 23, frameCount)).toBe(1);
    expect(effectFrameIndex(effect, 9999, frameCount)).toBe(frameCount - 1);
  });

  it('spawn 入队、advance 按 tick 移除已到期特效（原地压缩，未过期项保留顺序）', () => {
    const queue = new EffectQueue();
    queue.spawn('explosionSmall', 1, 1, 0); // endTick = 12
    queue.spawn('explosionBig', 2, 2, 0); // endTick = 24
    expect(queue.list.length).toBe(2);

    queue.advance(12);
    expect(queue.list.length).toBe(1);
    expect(queue.list[0]?.kind).toBe('explosionBig');

    queue.advance(24);
    expect(queue.list.length).toBe(0);
  });

  it('clear 立即清空队列', () => {
    const queue = new EffectQueue();
    queue.spawn('explosionSmall', 0, 0, 0);
    queue.clear();
    expect(queue.list.length).toBe(0);
  });
});

describe('diffDirtyCells · 地形脏格 diff', () => {
  const cellCount = GRID * GRID;

  it('prevTerrain/prevBrickMask 为 null 时视为首帧，全部格子脏', () => {
    const terrain = new Uint8Array(cellCount);
    const brick = new Uint8Array(cellCount);
    const dirty = diffDirtyCells(null, terrain, null, brick);
    expect(dirty.length).toBe(cellCount);
  });

  it('仅 terrain 变化的格子被标记，col/row 换算正确', () => {
    const prev = new Uint8Array(cellCount);
    const next = prev.slice();
    const brick = new Uint8Array(cellCount);
    const changedIndex = 5 * GRID + 3; // row 5, col 3
    next[changedIndex] = 1;

    const dirty = diffDirtyCells(prev, next, brick, brick);
    expect(dirty).toEqual([changedIndex]);
    expect(cellCol(changedIndex)).toBe(3);
    expect(cellRow(changedIndex)).toBe(5);
  });

  it('仅 brickMask 变化也算脏格（terrain 不变）', () => {
    const terrain = new Uint8Array(cellCount);
    const prevBrick = new Uint8Array(cellCount);
    const nextBrick = prevBrick.slice();
    const idx = 10;
    nextBrick[idx] = 0b1111;

    const dirty = diffDirtyCells(terrain, terrain, prevBrick, nextBrick);
    expect(dirty).toEqual([idx]);
  });

  it('无任何变化时返回空列表', () => {
    const terrain = new Uint8Array(cellCount);
    const brick = new Uint8Array(cellCount);
    const dirty = diffDirtyCells(terrain, terrain, brick, brick);
    expect(dirty).toEqual([]);
  });

  it('传入复用数组时原地清空重填，返回同一引用（避免逐帧新分配）', () => {
    const reused: number[] = [999, 888, 777];
    const terrain = new Uint8Array(cellCount);
    const brick = new Uint8Array(cellCount);
    const result = diffDirtyCells(null, terrain, null, brick, reused);
    expect(result).toBe(reused);
    expect(result.length).toBe(cellCount);
  });
});

describe('DIGIT_GLYPHS · 内置 3×5 像素数字字体', () => {
  it('0-9 每个字形恰为 5 行 3 列，字符 ⊆ {"#","."}', () => {
    for (let d = 0; d <= 9; d += 1) {
      const glyph = DIGIT_GLYPHS[String(d)];
      expect(glyph).toBeDefined();
      expect(glyph).toHaveLength(DIGIT_HEIGHT);
      for (const row of glyph ?? []) {
        expect(row).toHaveLength(DIGIT_WIDTH);
        for (const ch of row) expect(ch === '#' || ch === '.').toBe(true);
      }
    }
    expect(DIGIT_WIDTH).toBe(3);
    expect(DIGIT_HEIGHT).toBe(5);
  });

  it('恰好覆盖 0-9 共 10 个字形，不多不少', () => {
    expect(Object.keys(DIGIT_GLYPHS).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });
});

describe('resolveEffectCenter · 事件坐标(subpx) → 特效中心点(px) 的纯映射', () => {
  it('brickHit/steelHit：换算为半格左上角 + 半格中心偏移', () => {
    const center = resolveEffectCenter({ type: 'brickHit', x: 2 * SUBPX, y: 3 * SUBPX });
    expect(center).toEqual({ cx: 2 + HALF_PX / 2, cy: 3 + HALF_PX / 2 });

    const steelCenter = resolveEffectCenter({ type: 'steelHit', x: 4 * SUBPX, y: 5 * SUBPX });
    expect(steelCenter).toEqual({ cx: 4 + HALF_PX / 2, cy: 5 + HALF_PX / 2 });
  });

  it('bulletsCancel：直接使用碰撞点坐标，不做偏移', () => {
    const center = resolveEffectCenter({ type: 'bulletsCancel', x: 5 * SUBPX, y: 7 * SUBPX });
    expect(center).toEqual({ cx: 5, cy: 7 });
  });

  it('enemyDestroyed/playerDestroyed/baseDestroyed 均取事件坐标 + 坦克半宽偏移（同一路径，无特殊分支）', () => {
    const enemy = resolveEffectCenter({
      type: 'enemyDestroyed', tankId: 1, kind: 'basic', score: 100, x: 10 * SUBPX, y: 20 * SUBPX, byPlayer: 0,
    });
    // playerDestroyed/baseDestroyed 走与 enemyDestroyed 完全相同的坐标路径——不再依赖
    // 已删除的"上一帧快照按 tankId 反查"workaround，也不再对 baseDestroyed 硬编码 BASE.cell。
    const player = resolveEffectCenter({ type: 'playerDestroyed', tankId: 0, x: 10 * SUBPX, y: 20 * SUBPX, playerIndex: 0 });
    const base = resolveEffectCenter({ type: 'baseDestroyed', x: 10 * SUBPX, y: 20 * SUBPX });

    const expected = { cx: 10 + TANK_PX / 2, cy: 20 + TANK_PX / 2 };
    expect(enemy).toEqual(expected);
    expect(player).toEqual(expected);
    expect(base).toEqual(expected);
  });

  it('无对应特效的事件类型（fire/tankHit/stageClear 等）返回 null', () => {
    expect(resolveEffectCenter({ type: 'fire', fromPlayer: true })).toBeNull();
    expect(resolveEffectCenter({ type: 'tankHit', tankId: 1 })).toBeNull();
    expect(resolveEffectCenter({ type: 'stageClear' })).toBeNull();
    expect(resolveEffectCenter({ type: 'gameOver' })).toBeNull();
  });

  it('D7：playerParalyzed 取事件坐标 + 坦克半宽偏移，与 playerDestroyed 同一路径', () => {
    const paralyzed = resolveEffectCenter({ type: 'playerParalyzed', playerIndex: 1, x: 10 * SUBPX, y: 20 * SUBPX });
    expect(paralyzed).toEqual({ cx: 10 + TANK_PX / 2, cy: 20 + TANK_PX / 2 });
  });
});

/* ---------------- D5：P2 帧集选择逻辑 ---------------- */

function makePlayerTank(overrides: Partial<TankView> = {}): TankView {
  return {
    id: 1,
    kind: 'player',
    playerIndex: 0,
    x: 0,
    y: 0,
    dir: Dir.Up,
    level: 0,
    hp: 1,
    flashing: false,
    shieldTicks: 0,
    frozenTicks: 0,
    spawningTicks: 0,
    trackPhase: 0,
    ...overrides,
  };
}

function makeEnemyTank(overrides: Partial<TankView> = {}): TankView {
  return {
    id: 2,
    kind: 'basic',
    playerIndex: 0,
    x: 0,
    y: 0,
    dir: Dir.Up,
    level: 0,
    hp: 1,
    flashing: false,
    shieldTicks: 0,
    frozenTicks: 0,
    spawningTicks: 0,
    trackPhase: 0,
    ...overrides,
  };
}

describe('resolveTankSpriteKey · D5 玩家精灵按 playerIndex 选帧', () => {
  it('playerIndex===0：与改动前完全一致，取 tank.player.lN', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(resolveTankSpriteKey(makePlayerTank({ playerIndex: 0, level }), 0)).toBe(`tank.player.l${level}`);
    }
  });

  it('playerIndex===1：取 P2 绿色帧集 tank.player2.lN', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(resolveTankSpriteKey(makePlayerTank({ playerIndex: 1, level }), 0)).toBe(`tank.player2.l${level}`);
    }
  });

  it('敌人渲染路径完全不变（flashing/armor hp 选帧逻辑照旧，不受 P2 改动影响）', () => {
    expect(resolveTankSpriteKey(makeEnemyTank({ kind: 'basic' }), 0)).toBe('tank.enemy.basic');
    expect(resolveTankSpriteKey(makeEnemyTank({ kind: 'armor', hp: 2 }), 0)).toBe('tank.enemy.armor.hp2');
    expect(resolveTankSpriteKey(makeEnemyTank({ kind: 'power', flashing: true }), 0)).toBe('tank.enemy.power.flash');
  });
});

/* ---------------- D6：HUD 双命数行布局 ---------------- */

function hudPlayer(overrides: Partial<PlayerHudView> = {}): PlayerHudView {
  return { lives: 3, score: 0, out: false, ...overrides };
}

describe('resolveLifeRows · D6 HUD 命数行布局（1P 单行 / 2P 双行）', () => {
  it('players.length===1：单行，label=null、out 恒为 false（与改动前绘制参数逐字段一致，像素级不回归）', () => {
    const rows = resolveLifeRows([hudPlayer({ lives: 2, out: true })]); // out=true 也不应影响 1P 行
    expect(rows).toEqual([{ y: LOGICAL_HEIGHT - 24, label: null, lives: 2, out: false }]);
  });

  it('players.length===1 但数组为空：lives 兜底为 0（沿用改动前 ?? 0 语义）', () => {
    expect(resolveLifeRows([])).toEqual([{ y: LOGICAL_HEIGHT - 24, label: null, lives: 0, out: false }]);
  });

  it('players.length===2：两行，分别携带 label 1/2 与各自 lives/out，行位置不同', () => {
    const rows = resolveLifeRows([hudPlayer({ lives: 3, out: false }), hudPlayer({ lives: 0, out: true })]);
    expect(rows).toEqual([
      { y: LOGICAL_HEIGHT - 40, label: 1, lives: 3, out: false },
      { y: LOGICAL_HEIGHT - 24, label: 2, lives: 0, out: true },
    ]);
  });
});

describe('ClassicRenderer 模块加载', () => {
  it('可在 node 环境安全导入（模块顶层零 DOM 依赖），导出构造函数', () => {
    // canvas 实际绘制无法在 node 断言（需要浏览器 canvas 环境）；
    // 这里只验证模块能被安全 import（不在顶层触碰 document/HTMLElement）且导出契约类。
    expect(typeof ClassicRenderer).toBe('function');
  });
});
