/**
 * 经典复刻 · 确定性模拟层双玩家（2P）支持 —— C1 专项测试矩阵
 *
 * 与 tests/classic-sim.test.ts 相互独立、自行实现夹具（不依赖内部模块），
 * 只覆盖 2P 专属行为；既有 1P 语义回归由 classic-sim.test.ts 全量覆盖。
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/classic/sim/World';
import { Dir, Terrain, type EnemyKind, type LevelData, type PlayerInput, type SimEvent, type WorldSnapshot } from '../src/classic/core/types';
import { BASE, GRID, HALF_SUB, PLAYER } from '../src/classic/core/constants';
import { RNG } from '../src/core/RNG';

/* ---------------- 测试夹具（与 classic-sim.test.ts 保持一致的构造方式） ---------------- */

const CHAR_OF: Record<Terrain, string> = {
  [Terrain.Empty]: '.',
  [Terrain.Brick]: 'B',
  [Terrain.Steel]: 'S',
  [Terrain.Water]: 'W',
  [Terrain.Trees]: 'T',
  [Terrain.Ice]: 'I',
};

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function buildGrid(overrides: Readonly<Record<string, Terrain>>): string[] {
  const rows: string[] = [];
  for (let row = 0; row < GRID; row += 1) {
    let line = '';
    for (let col = 0; col < GRID; col += 1) {
      const t = overrides[cellKey(col, row)] ?? Terrain.Empty;
      line += CHAR_OF[t];
    }
    rows.push(line);
  }
  return rows;
}

/** 默认单个'basic'敌人出生于左上角(0,0)，远离本文件测试所用的玩家出生行(row24)。 */
function makeLevel(opts: {
  terrain?: Readonly<Record<string, Terrain>>;
  enemyQueue?: readonly EnemyKind[];
  stage?: number;
} = {}): LevelData {
  const baseWalls: Record<string, Terrain> = {};
  for (const cell of BASE.wallCells) baseWalls[cellKey(cell.col, cell.row)] = Terrain.Brick;
  return {
    stage: opts.stage ?? 1,
    grid: buildGrid({ ...baseWalls, ...(opts.terrain ?? {}) }),
    enemyQueue: opts.enemyQueue ?? ['basic'],
  };
}

/**
 * 用整行钢墙把默认敌人（出生于左上角）彻底关在场地上半区，使其无论跑多少 tick
 * 都不可能下探到玩家出生行(row24)一带——供纯玩家对玩家（队友火力/冻结机制）的
 * 长 tick 测试使用，避免因敌方 AI 随机游走引入极小概率的抖动。
 */
function makeQuarantinedLevel(): LevelData {
  const wallRow = 5;
  const terrain: Record<string, Terrain> = {};
  for (let col = 0; col < GRID; col += 1) terrain[cellKey(col, wallRow)] = Terrain.Steel;
  return makeLevel({ terrain });
}

function getPlayerByIndex(snap: WorldSnapshot, playerIndex: number) {
  const player = snap.tanks.find((t) => t.kind === 'player' && t.playerIndex === playerIndex);
  if (!player) throw new Error(`测试夹具异常：快照中找不到玩家 ${playerIndex} 的坦克`);
  return player;
}

function firstEnemyPoint(snap: WorldSnapshot): { x: number; y: number } | undefined {
  return snap.tanks.find((t) => t.kind !== 'player');
}

/**
 * 反应式机器人：只驱动指定 playerIndex 的坦克朝目标点移动并（可选）开火，
 * 其余玩家的输入恒为 {dir:null, fire:false}（含目标玩家已出局时的占位输入）。
 */
function stepBotTowardPoint(
  world: World,
  playerIndex: number,
  playerCount: number,
  pointSelector: (snap: WorldSnapshot) => { x: number; y: number } | undefined,
  maxTicks: number,
  fireMode: 'toggle' | 'never' = 'toggle',
  stopWhen?: (events: SimEvent[]) => boolean,
): SimEvent[] {
  const collected: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i += 1) {
    const snap = world.snapshot();
    const point = pointSelector(snap);
    const inputs: PlayerInput[] = Array.from({ length: playerCount }, () => ({ dir: null, fire: false }));
    const player = snap.tanks.find((t) => t.kind === 'player' && t.playerIndex === playerIndex);
    if (point && player) {
      const dx = point.x - player.x;
      const dy = point.y - player.y;
      const fire = fireMode === 'toggle' && i % 2 === 0;
      if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 100) inputs[playerIndex] = { dir: dx > 0 ? Dir.Right : Dir.Left, fire };
      else if (Math.abs(dy) > 100) inputs[playerIndex] = { dir: dy > 0 ? Dir.Down : Dir.Up, fire };
      else inputs[playerIndex] = { dir: player.dir, fire };
    }
    const events = world.tick(inputs);
    collected.push(...events);
    if (stopWhen && stopWhen(events)) break;
  }
  return collected;
}

/* ---------------- 初始化：出生位置 / HUD ---------------- */

describe('2P 初始化', () => {
  it('P1/P2 分别位于 spawnCells[0]/[1]，hud.players 长度为 2，初始命数/得分符合默认值', () => {
    const level = makeLevel({});
    const world = new World({ level, rng: new RNG(1), playerCount: 2 });
    const snap = world.snapshot();

    const p1 = getPlayerByIndex(snap, 0);
    const p2 = getPlayerByIndex(snap, 1);
    expect(p1.x).toBe(PLAYER.spawnCells[0].col * HALF_SUB);
    expect(p1.y).toBe(PLAYER.spawnCells[0].row * HALF_SUB);
    expect(p2.x).toBe(PLAYER.spawnCells[1].col * HALF_SUB);
    expect(p2.y).toBe(PLAYER.spawnCells[1].row * HALF_SUB);

    expect(snap.hud.players.length).toBe(2);
    expect(snap.hud.players[0]).toEqual({ lives: PLAYER.initialLives, score: 0, out: false });
    expect(snap.hud.players[1]).toEqual({ lives: PLAYER.initialLives, score: 0, out: false });
  });

  it('省略 playerCount 时默认严格 1P：hud.players 长度为 1，tick() 拒绝空输入数组', () => {
    const level = makeLevel({});
    const world = new World({ level, rng: new RNG(1) });
    const snap = world.snapshot();
    expect(snap.hud.players.length).toBe(1);
    expect(snap.tanks.filter((t) => t.kind === 'player').length).toBe(1);
    expect(() => world.tick([])).toThrow();
  });
});

/* ---------------- 输入路由：inputs[playerIndex] 各自独立 ---------------- */

describe('输入路由', () => {
  it('inputs[playerIndex] 分别驱动各自玩家坦克，互不影响', () => {
    const level = makeLevel({});
    const world = new World({ level, rng: new RNG(1), playerCount: 2 });

    world.tick([{ dir: Dir.Right, fire: false }, { dir: null, fire: false }]);
    let snap = world.snapshot();
    const p1After1 = getPlayerByIndex(snap, 0);
    const p2After1 = getPlayerByIndex(snap, 1);
    expect(p1After1.dir).toBe(Dir.Right);
    expect(p1After1.x).toBe(PLAYER.spawnCells[0].col * HALF_SUB + 12);
    expect(p2After1.dir).toBe(Dir.Up); // 未收到方向输入，朝向不变
    expect(p2After1.x).toBe(PLAYER.spawnCells[1].col * HALF_SUB); // 未移动

    world.tick([{ dir: null, fire: false }, { dir: Dir.Left, fire: false }]);
    snap = world.snapshot();
    const p1After2 = getPlayerByIndex(snap, 0);
    const p2After2 = getPlayerByIndex(snap, 1);
    expect(p1After2.x).toBe(p1After1.x); // P1 本 tick 未收到输入，位置不变
    expect(p2After2.dir).toBe(Dir.Left);
    expect(p2After2.x).toBe(PLAYER.spawnCells[1].col * HALF_SUB - 12);
  });
});

/* ---------------- 子弹上限按玩家独立计数 ---------------- */

describe('子弹上限（per-owner）', () => {
  it('P1 弹匣打满不影响 P2 同 tick 首次开火；双方各自的上限互不共享', () => {
    const level = makeLevel({});
    const world = new World({ level, rng: new RNG(1), playerCount: 2 });

    // 双方同 tick 首次开火（初始朝向即 Dir.Up，无需转向）：若上限被错误实现为
    // "全场玩家子弹共享一个计数器"，P2 会因 P1 先落子弹而被挡（本断言正是要排除这种可能）。
    world.tick([{ dir: Dir.Up, fire: true }, { dir: Dir.Up, fire: true }]);
    expect(world.snapshot().bullets.length).toBe(2);

    // 松开再按：双方均已达到各自 0 星上限（1 发），新的上升沿应被各自拒绝，弹药数不变
    world.tick([{ dir: Dir.Up, fire: false }, { dir: Dir.Up, fire: false }]);
    world.tick([{ dir: Dir.Up, fire: true }, { dir: Dir.Up, fire: true }]);
    expect(world.snapshot().bullets.length).toBe(2);
  });
});

/* ---------------- 队友火力：护盾阻挡 / 冻结 ---------------- */

describe('队友火力（friendly fire）', () => {
  /**
   * P1(col8,row24)/P2(col16,row24) 出生行(row24)贯穿基地围墙（col11/14 砖墙）与基地本体
   * （col12-13），P1 若在原地直接右转开火，子弹会先被基地围墙拦下，根本到不了 P2——
   * 因此双方先一同北移同样的 tick 数，脱离基地所在行（row23-25）后再让 P1 右转开火，
   * 子弹得以在同一行、无阻挡地直线飞抵 P2。
   */
  function moveBothUpOffBaseRow(world: World): void {
    for (let i = 0; i < 60; i += 1) {
      world.tick([{ dir: Dir.Up, fire: false }, { dir: Dir.Up, fire: false }]);
    }
  }

  it('出生护盾期间队友子弹无效：子弹消失但不冻结、不产生 playerParalyzed', () => {
    const level = makeQuarantinedLevel();
    const world = new World({ level, rng: new RNG(1), playerCount: 2 });

    moveBothUpOffBaseRow(world);
    const allEvents: SimEvent[] = [];
    allEvents.push(...world.tick([{ dir: Dir.Right, fire: true }, { dir: null, fire: false }]));
    for (let i = 0; i < 39; i += 1) {
      allEvents.push(...world.tick([{ dir: null, fire: false }, { dir: null, fire: false }]));
    }

    expect(allEvents.some((e) => e.type === 'playerParalyzed')).toBe(false);
    const p2 = getPlayerByIndex(world.snapshot(), 1);
    expect(p2.frozenTicks).toBe(0);
    expect(p2.shieldTicks).toBeGreaterThan(0); // 仍在出生护盾期
  });

  it('护盾消退后队友子弹命中：产生 playerParalyzed 并按 PLAYER.paralyzedTicks 冻结，不产生 bulletsCancel', () => {
    const level = makeQuarantinedLevel();
    const world = new World({ level, rng: new RNG(1), playerCount: 2 });

    for (let i = 0; i < PLAYER.spawnShieldTicks; i += 1) {
      world.tick([{ dir: null, fire: false }, { dir: null, fire: false }]);
    }
    expect(getPlayerByIndex(world.snapshot(), 1).shieldTicks).toBe(0);
    moveBothUpOffBaseRow(world);

    let events = world.tick([{ dir: Dir.Right, fire: true }, { dir: null, fire: false }]);
    let paralyzed = events.find((e) => e.type === 'playerParalyzed');
    for (let i = 0; i < 39 && !paralyzed; i += 1) {
      events = world.tick([{ dir: null, fire: false }, { dir: null, fire: false }]);
      paralyzed = events.find((e) => e.type === 'playerParalyzed');
    }
    const paralyzedEvent = paralyzed as Extract<SimEvent, { type: 'playerParalyzed' }> | undefined;
    expect(paralyzedEvent).toBeDefined();
    expect(paralyzedEvent?.playerIndex).toBe(1);
    expect(events.some((e) => e.type === 'bulletsCancel')).toBe(false);
    expect(getPlayerByIndex(world.snapshot(), 1).frozenTicks).toBe(PLAYER.paralyzedTicks - 1);
  });

  it('冻结期间不可移动/不可开火；冻结期满后自动恢复正常', () => {
    const level = makeQuarantinedLevel();
    const world = new World({ level, rng: new RNG(1), playerCount: 2 });

    for (let i = 0; i < PLAYER.spawnShieldTicks; i += 1) {
      world.tick([{ dir: null, fire: false }, { dir: null, fire: false }]);
    }
    moveBothUpOffBaseRow(world);
    let events = world.tick([{ dir: Dir.Right, fire: true }, { dir: null, fire: false }]);
    let paralyzed = events.find((e) => e.type === 'playerParalyzed');
    for (let i = 0; i < 39 && !paralyzed; i += 1) {
      events = world.tick([{ dir: null, fire: false }, { dir: null, fire: false }]);
      paralyzed = events.find((e) => e.type === 'playerParalyzed');
    }
    expect(paralyzed).toBeDefined();

    const beforeAttempts = getPlayerByIndex(world.snapshot(), 1);
    const frozenAtHit = beforeAttempts.frozenTicks;
    expect(frozenAtHit).toBeGreaterThan(0);

    // 冻结期间给 P2 明确的移动+开火输入，均应被忽略
    for (let i = 0; i < 10; i += 1) {
      const tickEvents = world.tick([{ dir: null, fire: false }, { dir: Dir.Right, fire: true }]);
      expect(tickEvents.some((e) => e.type === 'fire' && e.fromPlayer)).toBe(false);
    }
    const stillFrozen = getPlayerByIndex(world.snapshot(), 1);
    expect(stillFrozen.x).toBe(beforeAttempts.x);
    expect(stillFrozen.y).toBe(beforeAttempts.y);
    expect(stillFrozen.frozenTicks).toBe(frozenAtHit - 10);

    // 推进到冻结结束
    for (let i = 0; i < stillFrozen.frozenTicks; i += 1) {
      world.tick([{ dir: null, fire: false }, { dir: null, fire: false }]);
    }
    const unfrozen = getPlayerByIndex(world.snapshot(), 1);
    expect(unfrozen.frozenTicks).toBe(0);

    const afterUnfreezeEvents = world.tick([{ dir: null, fire: false }, { dir: Dir.Right, fire: true }]);
    expect(afterUnfreezeEvents.some((e) => e.type === 'fire' && e.fromPlayer)).toBe(true);
    const movedP2 = getPlayerByIndex(world.snapshot(), 1);
    expect(movedP2.x).toBeGreaterThan(unfrozen.x); // 解冻后可正常右移
  });
});

/* ---------------- 得分归属 / 额外命 ---------------- */

describe('得分归属与额外命', () => {
  it('enemyDestroyed.byPlayer 与击杀者一致；hud.players[byPlayer].score 增加，队友分数不变', () => {
    const maxSeed = 300;
    const budget = 2000;
    for (let seed = 1; seed <= maxSeed; seed += 1) {
      const level = makeLevel({ enemyQueue: ['basic'] });
      const world = new World({ level, rng: new RNG(seed), playerCount: 2 });
      // enemyQueue 仅 1 只敌人：击杀它必然在同一 tick 触发 stageClear，
      // 这是预期的良性结果而非异常，只需排除 gameOver（基地被毁等真正的失败场景）。
      const events = stepBotTowardPoint(world, 1, 2, firstEnemyPoint, budget, 'toggle', (evts) =>
        evts.some((e) => e.type === 'enemyDestroyed') || world.status === 'gameOver');
      const destroyedEvent = events.find((e) => e.type === 'enemyDestroyed') as
        | Extract<SimEvent, { type: 'enemyDestroyed' }> | undefined;
      if (!destroyedEvent || world.status === 'gameOver') continue;

      expect(destroyedEvent.byPlayer).toBe(1);
      const snap = world.snapshot();
      expect(snap.hud.players[1]?.score).toBe(destroyedEvent.score);
      expect(snap.hud.players[0]?.score).toBe(0); // P1 全程未参战，分数不变
      return;
    }
    throw new Error(`未能在 ${maxSeed} 个候选种子内（每个预算 ${budget} tick）让 P2 独立击杀敌人`);
  });

  it('得分跨越 20000 的倍数时只有对应玩家获得额外命，队友命数不受影响', () => {
    const maxSeed = 300;
    const budget = 2000;
    for (let seed = 1; seed <= maxSeed; seed += 1) {
      const level = makeLevel({ enemyQueue: ['basic'] });
      const world = new World({
        level,
        rng: new RNG(seed),
        playerCount: 2,
        carryOver: [
          { level: 0, lives: 3, score: 19999, out: false },
          { level: 0, lives: 3, score: 0, out: false },
        ],
      });
      // 同上：敌人只有 1 只，击杀它会同 tick 触发 stageClear，属预期良性结果，只排除 gameOver。
      const events = stepBotTowardPoint(world, 0, 2, firstEnemyPoint, budget, 'toggle', (evts) =>
        evts.some((e) => e.type === 'extraLife') || world.status === 'gameOver');
      const extraLifeEvents = events.filter((e) => e.type === 'extraLife') as Extract<SimEvent, { type: 'extraLife' }>[];
      if (extraLifeEvents.length === 0 || world.status === 'gameOver') continue;

      expect(extraLifeEvents).toHaveLength(1);
      expect(extraLifeEvents[0]?.playerIndex).toBe(0);
      const snap = world.snapshot();
      expect(snap.hud.players[0]?.lives).toBe(3 + 1);
      expect(snap.hud.players[0]?.score).toBe(19999 + 100);
      expect(snap.hud.players[1]?.lives).toBe(3); // 队友命数不受影响
      expect(snap.hud.players[1]?.score).toBe(0);
      return;
    }
    throw new Error(`未能在 ${maxSeed} 个候选种子内（每个预算 ${budget} tick）让 P1 独立击杀敌人跨过额外命门槛`);
  });
});

/* ---------------- 阵亡 / 重生 / 个体出局 / gameOver ---------------- */

describe('阵亡重生与出局（2P）', () => {
  it('P2 阵亡：命数-1，按 playerIndex 重生于 spawnCells[1]，P1 命数/位置不受影响', () => {
    const maxSeed = 300;
    const budget = 2000;
    for (let seed = 1; seed <= maxSeed; seed += 1) {
      const level = makeLevel({ enemyQueue: ['power', 'power', 'power', 'power'] });
      const world = new World({ level, rng: new RNG(seed), playerCount: 2 });
      const events = stepBotTowardPoint(world, 1, 2, firstEnemyPoint, budget, 'never', (evts) =>
        evts.some((e) => e.type === 'playerDestroyed') || world.status !== 'playing');
      const destroyed = events.find((e) => e.type === 'playerDestroyed') as
        | Extract<SimEvent, { type: 'playerDestroyed' }> | undefined;
      if (!destroyed || world.status !== 'playing') continue;

      expect(destroyed.playerIndex).toBe(1);
      expect(events.some((e) => e.type === 'playerRespawn' && e.playerIndex === 1)).toBe(true);

      const snap = world.snapshot();
      const p2 = getPlayerByIndex(snap, 1);
      expect(p2.x).toBe(PLAYER.spawnCells[1].col * HALF_SUB);
      expect(p2.y).toBe(PLAYER.spawnCells[1].row * HALF_SUB);
      expect(snap.hud.players[1]?.lives).toBe(PLAYER.initialLives - 1);
      expect(snap.hud.players[0]?.lives).toBe(PLAYER.initialLives); // P1 全程未参战
      return;
    }
    throw new Error(`未能在 ${maxSeed} 个候选种子内（每个预算 ${budget} tick）让 P2 单独阵亡且游戏仍在进行`);
  });

  it('单个玩家命数耗尽即出局（out=true，坦克移出场上）且游戏继续；全员出局才 gameOver', () => {
    const maxSeed = 300;
    const budget = 2000;
    for (let seed = 1; seed <= maxSeed; seed += 1) {
      const level = makeLevel({ enemyQueue: ['power', 'power', 'power', 'power'] });
      const world = new World({
        level,
        rng: new RNG(seed),
        playerCount: 2,
        carryOver: [
          { level: 0, lives: 0, score: 0, out: false },
          { level: 0, lives: 0, score: 0, out: false },
        ],
      });

      // 阶段一：只驱动 P1 送死（P2 全程被动站桩），验证"个体出局、队友继续"
      const phase1Events = stepBotTowardPoint(world, 0, 2, firstEnemyPoint, budget, 'never', (evts) =>
        evts.some((e) => e.type === 'playerDestroyed') || world.status !== 'playing');
      const p1Destroyed = phase1Events.find((e) => e.type === 'playerDestroyed') as
        | Extract<SimEvent, { type: 'playerDestroyed' }> | undefined;
      const statusAfterPhase1: WorldSnapshot['status'] = world.status;
      if (!p1Destroyed || p1Destroyed.playerIndex !== 0 || statusAfterPhase1 !== 'playing') continue;

      expect(world.snapshot().hud.players[0]).toEqual({ lives: 0, score: 0, out: true });
      expect(world.snapshot().tanks.some((t) => t.kind === 'player' && t.playerIndex === 0)).toBe(false);

      // 阶段二：换 P2 送死，验证"全员出局后立即 gameOver"
      const phase2Events = stepBotTowardPoint(world, 1, 2, firstEnemyPoint, budget, 'never', (evts) =>
        evts.some((e) => e.type === 'playerDestroyed') || world.status !== 'playing');
      const p2Destroyed = phase2Events.find((e) => e.type === 'playerDestroyed') as
        | Extract<SimEvent, { type: 'playerDestroyed' }> | undefined;
      const statusAfterPhase2: WorldSnapshot['status'] = world.status;
      if (!p2Destroyed || p2Destroyed.playerIndex !== 1 || statusAfterPhase2 !== 'gameOver') continue;

      expect(phase2Events.some((e) => e.type === 'gameOver')).toBe(true);
      const snap = world.snapshot();
      expect(snap.hud.players[0]).toEqual({ lives: 0, score: 0, out: true });
      expect(snap.hud.players[1]).toEqual({ lives: 0, score: 0, out: true });
      expect(snap.tanks.some((t) => t.kind === 'player')).toBe(false);
      return;
    }
    throw new Error(`未能在 ${maxSeed} 个候选种子内（每个预算各 ${budget} tick）让两名玩家依次出局并触发 gameOver`);
  });
});

/* ---------------- 修订：carryOver[i].out=true 的初始出局玩家 ---------------- */

describe('carryOver 出局玩家（修订）', () => {
  it('P1 携带 out=true：不生成其坦克、不占用其出生点；P2 命数耗尽后（因 P1 已出局）立即 gameOver', () => {
    const maxSeed = 300;
    const budget = 2000;
    for (let seed = 1; seed <= maxSeed; seed += 1) {
      const level = makeLevel({ enemyQueue: ['power', 'power', 'power', 'power'] });
      const world = new World({
        level,
        rng: new RNG(seed),
        playerCount: 2,
        carryOver: [
          { level: 0, lives: 0, score: 500, out: true },
          { level: 0, lives: 0, score: 0, out: false },
        ],
      });

      const snap0 = world.snapshot();
      expect(snap0.tanks.filter((t) => t.kind === 'player')).toHaveLength(1);
      expect(snap0.tanks.some((t) => t.kind === 'player' && t.playerIndex === 0)).toBe(false);
      expect(snap0.hud.players[0]).toEqual({ lives: 0, score: 500, out: true });
      expect(snap0.hud.players[1]).toEqual({ lives: 0, score: 0, out: false });
      const p2 = getPlayerByIndex(snap0, 1);
      expect(p2.x).toBe(PLAYER.spawnCells[1].col * HALF_SUB);
      expect(p2.y).toBe(PLAYER.spawnCells[1].row * HALF_SUB);

      const events = stepBotTowardPoint(world, 1, 2, firstEnemyPoint, budget, 'never', (evts) =>
        evts.some((e) => e.type === 'playerDestroyed') || world.status !== 'playing');
      const destroyed = events.find((e) => e.type === 'playerDestroyed') as
        | Extract<SimEvent, { type: 'playerDestroyed' }> | undefined;
      if (!destroyed || destroyed.playerIndex !== 1 || world.status !== 'gameOver') continue;

      expect(events.some((e) => e.type === 'gameOver')).toBe(true);
      expect(world.snapshot().hud.players[1]).toEqual({ lives: 0, score: 0, out: true });
      return;
    }
    throw new Error(`未能在 ${maxSeed} 个候选种子内（每个预算 ${budget} tick）让唯一在场玩家 P2 出局并触发 gameOver`);
  });
});

/* ---------------- 确定性哈希回归（2P） ---------------- */

describe('确定性回归（2P）', () => {
  const level = makeLevel({ enemyQueue: ['basic', 'fast', 'power', 'armor'] });
  const scriptDirs = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];
  const scriptInputAt = (tick: number, offset: number): PlayerInput => ({
    dir: scriptDirs[(tick + offset) % scriptDirs.length] as Dir,
    fire: (tick + offset) % 3 === 0,
  });
  const scriptInputs = (tick: number): PlayerInput[] => [scriptInputAt(tick, 0), scriptInputAt(tick, 2)];

  it('相同种子 + 相同双人输入序列运行 600 tick，每 100 tick 两个独立实例哈希一致', () => {
    const worldA = new World({ level, rng: new RNG(42), playerCount: 2 });
    const worldB = new World({ level, rng: new RNG(42), playerCount: 2 });

    for (let t = 1; t <= 600; t += 1) {
      const input = scriptInputs(t);
      worldA.tick(input);
      worldB.tick(input);
      if (t % 100 === 0) {
        expect(worldA.hash()).toBe(worldB.hash());
      }
    }
  });
});
