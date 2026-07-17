/**
 * 经典复刻 · M4 运行时程序化像素精灵图集
 *
 * 设计不变式：
 * 1. 本文件与 canvas/DOM 零依赖（除 buildAtlas 内部按需探测），spriteKeys/spritePixels 可在 node 下直接测试。
 * 2. 每个精灵仅绘制"朝上"一帧；渲染层按 Dir 旋转 90° 倍数得到其余方向，此处不出多方向。
 * 3. 像素数据 = 调色板索引字符矩阵（'.'=透明），换色变体复用同一份形状生成函数、只替换 palette。
 * 4. 全部素材原创：仅致敬 FC 原版的配色气质与轮廓分工，不逐像素复制任何既有素材。
 *
 * 契约新增（超出任务给定的最小 API，供 node 测试与 buildAtlas 内部复用，不与既定契约冲突）：
 * - spriteFrameCount(key)：纯数据版帧数查询（frameCount 挂在 buildAtlas() 产物上，需要 canvas 环境）。
 * - spritePalette(key)：暴露调色板，供测试校验"换色变体形状相同、调色板不同"。
 */

export type SpriteKey = string;

export interface SpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  frame(key: SpriteKey, frameIndex?: number): SpriteFrame;
  frameCount(key: SpriteKey): number;
}

/* ---------- 像素网格基础设施（纯数据，无 canvas 依赖） ---------- */

type Grid = string[][];
type Palette = Readonly<Record<string, string>>;

interface SpriteDef {
  readonly w: number;
  readonly h: number;
  readonly palette: Palette;
  readonly frames: readonly (readonly string[])[];
}

const registry = new Map<SpriteKey, SpriteDef>();

function blankGrid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
}

function toShape(g: Grid): string[] {
  return g.map((row) => row.join(''));
}

function setPixel(g: Grid, x: number, y: number, ch: string): void {
  const row = g[y];
  if (row) row[x] = ch;
}

function fillRect(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) setPixel(g, x, y, ch);
  }
}

/** 左半部分手绘、镜像补全右半部分（用于左右对称图标，减少重复坐标） */
function mirrorHorizontal(g: Grid): void {
  for (const row of g) {
    const w = row.length;
    for (let x = 0; x < Math.floor(w / 2); x += 1) {
      row[w - 1 - x] = row[x] ?? '.';
    }
  }
}

/** 注册即校验：行数=高、行宽=宽、字符 ⊆ 调色板∪{'.'}，任何越界在模块加载期立即失败 */
function register(key: SpriteKey, w: number, h: number, palette: Palette, frames: readonly Grid[]): void {
  const shapes = frames.map(toShape);
  for (const shape of shapes) {
    if (shape.length !== h) throw new Error(`sprite ${key}: 帧行数 ${shape.length} != ${h}`);
    for (const row of shape) {
      if (row.length !== w) throw new Error(`sprite ${key}: 行宽 ${row.length} != ${w}`);
      for (const ch of row) {
        if (ch !== '.' && !(ch in palette)) throw new Error(`sprite ${key}: 字符 '${ch}' 不在调色板中`);
      }
    }
  }
  registry.set(key, { w, h, palette, frames: shapes });
}

function getDef(key: SpriteKey): SpriteDef {
  const def = registry.get(key);
  if (!def) throw new Error(`未知精灵 key: ${key}`);
  return def;
}

/* ---------- 坦克车体生成器（player/enemy 共用，仅参数与调色板不同） ---------- */

const TRACK_TOP = 3;
const TRACK_BOTTOM = 15;

interface TankBodyOptions {
  hullLeft: number; // 车体左边界列，右边界镜像为 15-hullLeft
  hullTop: number;
  hullBottom: number;
  roundCorners: boolean; // basic：圆润轮廓（切角）
  thickOutline: boolean; // armor：方正厚重（双层描边）
  turret: { left: number; top: number; bottom: number };
  barrel: { left: number; top: number; bottom: number };
  longBarrelInner?: { left: number; top: number; bottom: number }; // power：炮管贯穿车体，视觉更长
  sidePlateRows?: readonly number[]; // armor：履带外侧加装甲板
  studRows?: readonly number[]; // player：星级越高、侧裙甲越多
  treadFrame: 0 | 1;
}

function buildTankBody(o: TankBodyOptions): Grid {
  const g = blankGrid(16, 16);

  for (let y = TRACK_TOP; y <= TRACK_BOTTOM; y += 1) {
    const rung = (y - TRACK_TOP) % 4 === (o.treadFrame === 0 ? 1 : 3);
    const outer = rung ? 'h' : 'k';
    setPixel(g, 0, y, outer);
    setPixel(g, 1, y, 'k');
    setPixel(g, 15, y, outer);
    setPixel(g, 14, y, 'k');
  }

  fillRect(g, o.hullLeft, o.hullTop, 15 - o.hullLeft, o.hullBottom, 'o');
  const innerLeft = o.hullLeft + (o.thickOutline ? 2 : 1);
  const innerRight = 15 - innerLeft;
  const innerTop = o.hullTop + (o.thickOutline ? 2 : 1);
  fillRect(g, innerLeft, innerTop, innerRight, o.hullBottom - 1, 'b');
  fillRect(g, innerLeft, innerTop, innerRight, innerTop, 'h');
  fillRect(g, innerLeft, o.hullBottom - 2, innerRight, o.hullBottom - 1, 's');

  if (o.roundCorners) {
    setPixel(g, o.hullLeft, o.hullTop, '.');
    setPixel(g, 15 - o.hullLeft, o.hullTop, '.');
    setPixel(g, o.hullLeft, o.hullBottom, '.');
    setPixel(g, 15 - o.hullLeft, o.hullBottom, '.');
  }

  fillRect(g, o.turret.left, o.turret.top, 15 - o.turret.left, o.turret.bottom, 'h');
  fillRect(g, o.barrel.left, o.barrel.top, 15 - o.barrel.left, o.barrel.bottom, 'g');
  if (o.longBarrelInner) {
    const lb = o.longBarrelInner;
    fillRect(g, lb.left, lb.top, 15 - lb.left, lb.bottom, 'g');
  }
  for (const y of o.sidePlateRows ?? []) {
    setPixel(g, 1, y, 'o');
    setPixel(g, 14, y, 'o');
  }
  for (const y of o.studRows ?? []) {
    setPixel(g, 1, y, 'a');
    setPixel(g, 14, y, 'a');
  }
  return g;
}

/** 4 个星级的形状差异：0/1 星窄炮管无侧裙甲，2/3 星炮管加粗、侧裙甲随星级递增（0/1/2/3 块） */
function playerBodyOptions(level: 0 | 1 | 2 | 3, treadFrame: 0 | 1): TankBodyOptions {
  const wide = level >= 2;
  const studRows: readonly number[][] = [[], [9], [7, 11], [6, 9, 12]];
  return {
    hullLeft: 2,
    hullTop: 3,
    hullBottom: 15,
    roundCorners: false,
    thickOutline: false,
    turret: wide ? { left: 6, top: 3, bottom: 4 } : { left: 7, top: 3, bottom: 4 },
    barrel: wide ? { left: 6, top: 0, bottom: 2 } : { left: 7, top: 0, bottom: 2 },
    studRows: studRows[level],
    treadFrame,
  };
}

function basicBodyOptions(treadFrame: 0 | 1): TankBodyOptions {
  return {
    hullLeft: 2,
    hullTop: 3,
    hullBottom: 15,
    roundCorners: true,
    thickOutline: false,
    turret: { left: 7, top: 3, bottom: 4 },
    barrel: { left: 7, top: 0, bottom: 2 },
    treadFrame,
  };
}

function fastBodyOptions(treadFrame: 0 | 1): TankBodyOptions {
  return {
    hullLeft: 4,
    hullTop: 3,
    hullBottom: 15,
    roundCorners: false,
    thickOutline: false,
    turret: { left: 7, top: 3, bottom: 4 },
    barrel: { left: 7, top: 0, bottom: 2 },
    treadFrame,
  };
}

function powerBodyOptions(treadFrame: 0 | 1): TankBodyOptions {
  return {
    hullLeft: 2,
    hullTop: 3,
    hullBottom: 15,
    roundCorners: false,
    thickOutline: false,
    turret: { left: 7, top: 3, bottom: 4 },
    barrel: { left: 7, top: 0, bottom: 2 },
    longBarrelInner: { left: 7, top: 3, bottom: 6 },
    treadFrame,
  };
}

function armorBodyOptions(treadFrame: 0 | 1): TankBodyOptions {
  return {
    hullLeft: 2,
    hullTop: 3,
    hullBottom: 15,
    roundCorners: false,
    thickOutline: true,
    turret: { left: 6, top: 3, bottom: 5 },
    barrel: { left: 7, top: 0, bottom: 2 },
    sidePlateRows: [6, 9, 12],
    treadFrame,
  };
}

const TANK_PALETTE_KEYS = ['o', 'b', 'h', 's', 'g', 'k', 'a'] as const;
type TankChar = (typeof TANK_PALETTE_KEYS)[number];

function tankPalette(p: Record<TankChar, string>): Palette {
  return p;
}

const PLAYER_PALETTES: Record<0 | 1 | 2 | 3, Palette> = {
  0: tankPalette({ o: '#6b4e00', b: '#e8b923', h: '#fbe27a', s: '#a8790a', g: '#4a4a4a', k: '#2e2e2e', a: '#e8b923' }),
  1: tankPalette({ o: '#6b4e00', b: '#f0c530', h: '#ffe98a', s: '#b3830d', g: '#4a4a4a', k: '#2e2e2e', a: '#fff2b0' }),
  2: tankPalette({ o: '#5c4200', b: '#ffd54a', h: '#fff2a0', s: '#c99a1a', g: '#3a3a3a', k: '#242424', a: '#fff6c2' }),
  3: tankPalette({ o: '#4a3500', b: '#ffe066', h: '#fffbc0', s: '#d9ad2a', g: '#2a2a2a', k: '#1a1a1a', a: '#ffffff' }),
};

const ENEMY_KIND_BUILDERS = {
  basic: basicBodyOptions,
  fast: fastBodyOptions,
  power: powerBodyOptions,
  armor: armorBodyOptions,
} as const;

const ENEMY_BASE_PALETTES: Record<keyof typeof ENEMY_KIND_BUILDERS, Palette> = {
  basic: { o: '#3a3a3a', b: '#b9b9c2', h: '#e6e6ec', s: '#84848c', g: '#54545c', k: '#262626' },
  fast: { o: '#2c3a3f', b: '#9fb6bd', h: '#dbe9ec', s: '#6f868d', g: '#44575c', k: '#1c2427' },
  power: { o: '#3f2626', b: '#c2a3a3', h: '#f2dede', s: '#8f6b6b', g: '#5c3a3a', k: '#231414' },
  armor: { o: '#173d17', b: '#5f9e5f', h: '#a9d7a9', s: '#3d6b3d', g: '#2e2e2e', k: '#1a1a1a' },
};

/** 受击变色：绿(整血) → 黄(hp3) → 浅绿(hp2) → 灰(hp1)，形状与 armor 完全一致 */
const ARMOR_HP_PALETTES: Record<'hp3' | 'hp2' | 'hp1', Palette> = {
  hp3: { o: '#4a4013', b: '#d9c94a', h: '#f5ecab', s: '#a89a2e', g: '#2e2e2e', k: '#1a1a1a' },
  hp2: { o: '#294a1c', b: '#bfe6a0', h: '#e8f7d8', s: '#8fbf6e', g: '#2e2e2e', k: '#1a1a1a' },
  hp1: { o: '#333333', b: '#9a9a9a', h: '#d0d0d0', s: '#6a6a6a', g: '#2e2e2e', k: '#1a1a1a' },
};

/** 闪烁坦克通用红色变体：与本体各 kind 形状一致，渲染层按 tick 交替本体帧/flash 帧 */
const FLASH_PALETTE: Palette = { o: '#7a0000', b: '#ff4d4d', h: '#ffc2c2', s: '#b30000', g: '#4d0000', k: '#330000' };

for (const level of [0, 1, 2, 3] as const) {
  register(`tank.player.l${level}`, 16, 16, PLAYER_PALETTES[level], [
    buildTankBody(playerBodyOptions(level, 0)),
    buildTankBody(playerBodyOptions(level, 1)),
  ]);
}

for (const kind of Object.keys(ENEMY_KIND_BUILDERS) as (keyof typeof ENEMY_KIND_BUILDERS)[]) {
  const optionsOf = ENEMY_KIND_BUILDERS[kind];
  register(`tank.enemy.${kind}`, 16, 16, ENEMY_BASE_PALETTES[kind], [
    buildTankBody(optionsOf(0)),
    buildTankBody(optionsOf(1)),
  ]);
  register(`tank.enemy.${kind}.flash`, 16, 16, FLASH_PALETTE, [
    buildTankBody(optionsOf(0)),
    buildTankBody(optionsOf(1)),
  ]);
}

for (const hp of ['hp3', 'hp2', 'hp1'] as const) {
  register(`tank.enemy.armor.${hp}`, 16, 16, ARMOR_HP_PALETTES[hp], [
    buildTankBody(armorBodyOptions(0)),
    buildTankBody(armorBodyOptions(1)),
  ]);
}

/* ---------- 子弹 ---------- */

register('bullet', 4, 4, { o: '#3a3a3a', b: '#fafad2' }, [
  blankGridFromRows(['.oo.', 'obbo', 'obbo', '.oo.']),
]);

function blankGridFromRows(rows: readonly string[]): Grid {
  return rows.map((row) => row.split(''));
}

/* ---------- 地形（8×8） ---------- */

register('terrain.brick', 8, 8, { m: '#5c3a29', r: '#b23a2e', h: '#d4604a' }, [
  blankGridFromRows([
    'hhhhmhhh',
    'rrrrmrrr',
    'rrrrmrrr',
    'mmmmmmmm',
    'hhmhhhhm',
    'rrmrrrrm',
    'rrmrrrrm',
    'mmmmmmmm',
  ]),
]);

register('terrain.steel', 8, 8, { o: '#2b2b2b', h: '#d9d9d9', f: '#9a9a9a', d: '#5a5a5a' }, [
  blankGridFromRows([
    'oooooooo',
    'ohffffdo',
    'ohffffdo',
    'ohffffdo',
    'ohffffdo',
    'ohffffdo',
    'ohffffdo',
    'oooooooo',
  ]),
]);

register('terrain.water', 8, 8, { a: '#1c4fa3', b: '#4f9fe0' }, [
  blankGridFromRows(['aaaaaaaa', 'babababa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'abababab', 'aaaaaaaa', 'aaaaaaaa']),
  blankGridFromRows(['aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'babababa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'abababab']),
]);

register('terrain.trees', 8, 8, { l: '#3e8f46', d: '#1f5c28' }, [buildTreesGrid()]);

function buildTreesGrid(): Grid {
  const g = blankGrid(8, 8);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const bi = Math.floor(x / 2);
      const bj = Math.floor(y / 2);
      setPixel(g, x, y, (bi + bj) % 2 === 0 ? 'l' : 'd');
    }
  }
  return g;
}

register('terrain.ice', 8, 8, { i: '#bfe3f5', w: '#eaf8ff' }, [buildIceGrid()]);

function buildIceGrid(): Grid {
  const g = blankGrid(8, 8);
  fillRect(g, 0, 0, 7, 7, 'i');
  for (let k = 0; k < 8; k += 1) setPixel(g, k, (k + 2) % 8, 'w');
  return g;
}

/* ---------- 基地（老鹰，16×16） ---------- */

function buildEagleGrid(alive: boolean): Grid {
  const g = blankGrid(16, 16);
  const bodyCh = alive ? 'e' : 'r';
  const wingCh = alive ? 'w' : 'r';
  fillRect(g, 2, 12, 13, 15, alive ? 'p' : 'r');
  fillRect(g, 6, 2, 9, 10, bodyCh);
  for (let y = 3; y <= 8; y += 1) {
    const reach = 5 - Math.floor((y - 3) / 2);
    fillRect(g, 6 - reach, y, 5, y, wingCh);
  }
  mirrorHorizontal(g);
  if (!alive) {
    for (let i = 0; i < 12; i += 1) {
      setPixel(g, 2 + i, 2 + i, 'k');
      setPixel(g, 13 - i, 2 + i, 'k');
    }
  }
  return g;
}

register('base.alive', 16, 16, { p: '#c9a227', e: '#f2ead0', w: '#d4b13a' }, [buildEagleGrid(true)]);
register('base.dead', 16, 16, { r: '#6b6b6b', k: '#232323' }, [buildEagleGrid(false)]);

/* ---------- 特效 ---------- */

function spawnStarGrid(size: number): Grid {
  const g = blankGrid(16, 16);
  const cx = 7;
  const cy = 7;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d === size) setPixel(g, x, y, 'a');
      else if (size > 1 && d === size - 1) setPixel(g, x, y, 'b');
    }
  }
  return g;
}

register(
  'fx.spawn',
  16,
  16,
  { a: '#fff7b0', b: '#ffffff' },
  [2, 4, 6, 8].map(spawnStarGrid),
);

function explosionGrid(size: number, radius: number): Grid {
  const g = blankGrid(size, size);
  const c = size / 2 - 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c);
      if (d <= radius && d > radius - 2) setPixel(g, x, y, d > radius - 1 ? 'a' : 'b');
      else if (d <= radius - 2) setPixel(g, x, y, 'c');
    }
  }
  return g;
}

const EXPLOSION_PALETTE: Palette = { a: '#ff8a1e', b: '#ffcf4d', c: '#fff6c8' };

register(
  'fx.explosion.small',
  16,
  16,
  EXPLOSION_PALETTE,
  [2, 4, 6].map((r) => explosionGrid(16, r)),
);
register(
  'fx.explosion.big',
  32,
  32,
  EXPLOSION_PALETTE,
  [8, 14].map((r) => explosionGrid(32, r)),
);

function shieldGrid(phase: 0 | 1): Grid {
  const g = blankGrid(16, 16);
  const cx = 7.5;
  const cy = 7.5;
  const r = 7;
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    if (i % 2 !== phase) continue;
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.round(cx + r * Math.cos(angle));
    const y = Math.round(cy + r * Math.sin(angle));
    setPixel(g, x, y, 's');
  }
  return g;
}

register('fx.shield', 16, 16, { s: '#6fd8ff' }, [shieldGrid(0), shieldGrid(1)]);

/* ---------- 道具（16×16，底板 + 图标构图） ---------- */

function plateGrid(): Grid {
  const g = blankGrid(16, 16);
  fillRect(g, 0, 0, 15, 15, 'o');
  fillRect(g, 1, 1, 14, 14, 'p');
  return g;
}

function starIconGrid(): Grid {
  const g = plateGrid();
  const cx = 7;
  const cy = 7;
  for (let d = 0; d <= 6; d += 1) {
    setPixel(g, cx - d, cy, 'i');
    setPixel(g, cx + 1 + d, cy, 'i');
    setPixel(g, cx, cy - d, 'i');
    setPixel(g, cx + 1, cy - d, 'i');
    setPixel(g, cx, cy + d, 'i');
    setPixel(g, cx + 1, cy + d, 'i');
  }
  return g;
}

function grenadeIconGrid(): Grid {
  const g = plateGrid();
  fillRect(g, 5, 7, 10, 12, 'i');
  setPixel(g, 4, 8, 'i');
  setPixel(g, 11, 8, 'i');
  setPixel(g, 4, 11, 'i');
  setPixel(g, 11, 11, 'i');
  fillRect(g, 7, 4, 8, 6, 'f');
  return g;
}

function helmetIconGrid(): Grid {
  const g = plateGrid();
  for (let y = 5; y <= 10; y += 1) {
    const half = 6 - Math.abs(y - 8);
    fillRect(g, 8 - half, y, 7 + half, y, 'i');
  }
  fillRect(g, 4, 11, 11, 12, 'i');
  return g;
}

function clockIconGrid(): Grid {
  const g = plateGrid();
  const cx = 7;
  const cy = 7;
  const r = 5;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      if (d <= r && d > r - 1.2) setPixel(g, x, y, 'i');
    }
  }
  fillRect(g, 7, 4, 7, 7, 'n');
  fillRect(g, 7, 7, 10, 7, 'n');
  return g;
}

function shovelIconGrid(): Grid {
  const g = plateGrid();
  fillRect(g, 7, 2, 8, 9, 'n');
  fillRect(g, 4, 9, 11, 13, 'i');
  return g;
}

function tankIconGrid(): Grid {
  const g = plateGrid();
  fillRect(g, 4, 4, 11, 12, 'i');
  fillRect(g, 3, 5, 3, 11, 'n');
  fillRect(g, 12, 5, 12, 11, 'n');
  fillRect(g, 7, 1, 8, 4, 'n');
  return g;
}

const PLATE_BORDER = '#141414';
register('powerup.star', 16, 16, { o: PLATE_BORDER, p: '#8a1f1f', i: '#ffe14d' }, [starIconGrid()]);
register('powerup.grenade', 16, 16, { o: PLATE_BORDER, p: '#1f3d1f', i: '#cfd6cf', f: '#e0a53a' }, [grenadeIconGrid()]);
register('powerup.helmet', 16, 16, { o: PLATE_BORDER, p: '#1f2d5c', i: '#e8b923' }, [helmetIconGrid()]);
register('powerup.clock', 16, 16, { o: PLATE_BORDER, p: '#3d1f5c', i: '#e8e8e8', n: '#2b2b2b' }, [clockIconGrid()]);
register('powerup.shovel', 16, 16, { o: PLATE_BORDER, p: '#5c3d1f', i: '#c8c8c8', n: '#8a5a2e' }, [shovelIconGrid()]);
register('powerup.tank', 16, 16, { o: PLATE_BORDER, p: '#1f1f1f', i: '#e8b923', n: '#8a5a2e' }, [tankIconGrid()]);

/* ---------- HUD 小图标（8×8） ---------- */

function miniTankGrid(): Grid {
  const g = blankGrid(8, 8);
  fillRect(g, 2, 1, 5, 6, 'i');
  setPixel(g, 1, 2, 'i');
  setPixel(g, 6, 2, 'i');
  setPixel(g, 1, 5, 'i');
  setPixel(g, 6, 5, 'i');
  fillRect(g, 3, 0, 4, 1, 'i');
  return g;
}

register('hud.enemyIcon', 8, 8, { i: '#c8c8c8' }, [miniTankGrid()]);
register('hud.lifeIcon', 8, 8, { i: '#f4c430' }, [miniTankGrid()]);

/* ---------- 纯数据公共 API（node 可测） ---------- */

export function spriteKeys(): SpriteKey[] {
  return Array.from(registry.keys());
}

export function spritePixels(key: SpriteKey, frameIndex = 0): string[] {
  const def = getDef(key);
  const frame = def.frames[frameIndex];
  if (!frame) throw new Error(`精灵 ${key} 不存在帧 ${frameIndex}`);
  return frame.slice();
}

/** 帧数的纯数据查询（不依赖 buildAtlas/canvas），供 node 测试与渲染层预校验使用 */
export function spriteFrameCount(key: SpriteKey): number {
  return getDef(key).frames.length;
}

/** 暴露调色板，供测试校验"换色变体形状相同、仅调色板不同" */
export function spritePalette(key: SpriteKey): Palette {
  return getDef(key).palette;
}

/* ---------- 浏览器环境：图集构建 ---------- */

function createCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  throw new Error('buildAtlas() 需要浏览器 canvas 环境（document 或 OffscreenCanvas）');
}

function get2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 渲染上下文');
    return ctx;
  }
  const ctx = (canvas as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('无法获取 2D 渲染上下文');
  return ctx;
}

/** 自动行打包：按 spriteKeys() 顺序逐帧排布，超出行宽自动换行 */
const ATLAS_MAX_WIDTH = 256;

export function buildAtlas(): SpriteAtlas {
  const keys = spriteKeys();
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const placed = new Map<SpriteKey, SpriteFrame[]>();

  for (const key of keys) {
    const def = getDef(key);
    const frames: SpriteFrame[] = [];
    for (let i = 0; i < def.frames.length; i += 1) {
      if (cursorX + def.w > ATLAS_MAX_WIDTH) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }
      frames.push({ x: cursorX, y: cursorY, w: def.w, h: def.h });
      cursorX += def.w;
      rowHeight = Math.max(rowHeight, def.h);
    }
    placed.set(key, frames);
  }

  const atlasHeight = cursorY + rowHeight;
  const canvas = createCanvas(ATLAS_MAX_WIDTH, atlasHeight);
  const ctx = get2dContext(canvas);

  for (const key of keys) {
    const def = getDef(key);
    const frames = placed.get(key);
    if (!frames) continue;
    def.frames.forEach((shape, i) => {
      const target = frames[i];
      if (!target) return;
      for (let y = 0; y < shape.length; y += 1) {
        const row = shape[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x += 1) {
          const ch = row[x];
          if (!ch || ch === '.') continue;
          const color = def.palette[ch];
          if (!color) continue;
          ctx.fillStyle = color;
          ctx.fillRect(target.x + x, target.y + y, 1, 1);
        }
      }
    });
  }

  return {
    canvas,
    frame(key: SpriteKey, frameIndex = 0): SpriteFrame {
      const list = placed.get(key);
      if (!list) throw new Error(`未知精灵 key: ${key}`);
      const f = list[frameIndex];
      if (!f) throw new Error(`精灵 ${key} 不存在帧 ${frameIndex}`);
      return f;
    },
    frameCount(key: SpriteKey): number {
      return getDef(key).frames.length;
    },
  };
}
