import { describe, expect, it } from 'vitest';
import { World } from '../src/classic/sim/World';
import { Dir, Terrain, type EnemyKind, type LevelData, type PlayerInput } from '../src/classic/core/types';
import { BASE, GRID } from '../src/classic/core/constants';
import { RNG } from '../src/core/RNG';
import { deriveStageSeed } from '../src/classic/net/deriveSeed';
import { LockstepBuffer } from '../src/classic/net/lockstep';
import { decodeInput, encodeInput, parse, serialize, type Frame, type InputFrame } from '../src/classic/net/protocol';

/* ---------------- 测试夹具：与 tests/classic-sim.test.ts 同构造方式，仅在本文件内实现 ---------------- */

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

/** 基地三面砖墙铺满（同 classic-sim.test.ts），避免敌人无遮挡直接洞穿基地打断本文件不关心的场景 */
function makeLevel(opts: { enemyQueue?: readonly EnemyKind[]; stage?: number } = {}): LevelData {
  const baseWalls: Record<string, Terrain> = {};
  for (const cell of BASE.wallCells) baseWalls[cellKey(cell.col, cell.row)] = Terrain.Brick;
  return {
    stage: opts.stage ?? 1,
    grid: buildGrid(baseWalls),
    enemyQueue: opts.enemyQueue ?? ['basic', 'fast', 'power', 'armor'],
  };
}

/** 按 slot+tick 生成的确定性脚本输入，两端各自独立计算，不依赖对方结果 */
function scriptInput(slot: number, tick: number): PlayerInput {
  const dirs = [Dir.Up, Dir.Right, Dir.Down, Dir.Left] as const;
  return { dir: dirs[(tick + slot) % dirs.length] as Dir, fire: (tick + slot) % 3 === 0 };
}

/* ---------------- deriveStageSeed：跨调用稳定、不同 stageIndex 不同值 ---------------- */

describe('deriveStageSeed', () => {
  it('同参数跨调用返回相同值', () => {
    expect(deriveStageSeed(42, 0)).toBe(deriveStageSeed(42, 0));
    expect(deriveStageSeed(999999, 7)).toBe(deriveStageSeed(999999, 7));
  });

  it('不同 stageIndex 产生不同种子', () => {
    const seeds = new Set<number>();
    for (let stage = 0; stage < 8; stage += 1) seeds.add(deriveStageSeed(42, stage));
    expect(seeds.size).toBe(8);
  });

  it('不同 masterSeed 产生不同种子', () => {
    expect(deriveStageSeed(1, 0)).not.toBe(deriveStageSeed(2, 0));
  });

  it('返回值恒为无符号 32 位整数', () => {
    const value = deriveStageSeed(0xffffffff, 0xffffffff);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(value)).toBe(true);
  });
});

/* ---------------- protocol：编解码往返、越界与非法帧 ---------------- */

describe('protocol 编解码', () => {
  it('encodeInput/decodeInput 往返：dir 各方向与 null', () => {
    for (const dir of [Dir.Up, Dir.Right, Dir.Down, Dir.Left, null]) {
      for (const fire of [true, false]) {
        const input: PlayerInput = { dir, fire };
        const frame = encodeInput(1, 10, input);
        expect(frame.dir).toBe(dir === null ? -1 : dir);
        expect(decodeInput(frame)).toEqual(input);
      }
    }
  });

  it('decodeInput 对越界 dir 抛错', () => {
    const bad: InputFrame = { t: 'in', tick: 1, slot: 0, dir: 4, fire: 0 };
    expect(() => decodeInput(bad)).toThrow();
    const bad2: InputFrame = { t: 'in', tick: 1, slot: 0, dir: -2, fire: 0 };
    expect(() => decodeInput(bad2)).toThrow();
  });

  it('serialize/parse 往返对三种帧均成立', () => {
    const frames: Frame[] = [
      { t: 'in', tick: 5, slot: 0, dir: 2, fire: 1 },
      { t: 'cmd', tick: 5, slot: 0, cmd: 'confirm' },
      { t: 'h', tick: 5, slot: 1, hash: 123456 },
    ];
    for (const frame of frames) {
      expect(parse(serialize(frame))).toEqual(frame);
    }
  });

  it('parse 对未知 t 或非对象抛错', () => {
    expect(() => parse(JSON.stringify({ t: 'unknown' }))).toThrow();
    expect(() => parse(JSON.stringify(null))).toThrow();
    expect(() => parse(JSON.stringify(42))).toThrow();
  });
});

/* ---------------- LockstepBuffer：ready/stall/乱序/delay 边界/失步 ---------------- */

describe('LockstepBuffer', () => {
  it('输入未到齐时 inputsReady 为 false，inputsForTick 返回 null（stall）', () => {
    const buf = new LockstepBuffer({ localSlot: 0, playerCount: 2 });
    buf.submitLocalInput(10, { dir: Dir.Up, fire: false });
    expect(buf.inputsReady(10)).toBe(false);
    expect(buf.inputsForTick(10)).toBeNull();

    buf.submitRemoteInput(10, 1, { dir: Dir.Down, fire: true });
    expect(buf.inputsReady(10)).toBe(true);
    expect(buf.inputsForTick(10)).toEqual([
      { dir: Dir.Up, fire: false },
      { dir: Dir.Down, fire: true },
    ]);
  });

  it('乱序到达：先提交高 tick 再提交低 tick，各 tick 独立就绪', () => {
    const buf = new LockstepBuffer({ localSlot: 0, playerCount: 2 });
    buf.submitLocalInput(20, { dir: null, fire: false });
    buf.submitRemoteInput(20, 1, { dir: null, fire: false });
    expect(buf.inputsReady(10)).toBe(false);

    buf.submitLocalInput(10, { dir: Dir.Left, fire: false });
    buf.submitRemoteInput(10, 1, { dir: Dir.Right, fire: false });
    expect(buf.inputsReady(10)).toBe(true);
    expect(buf.inputsReady(20)).toBe(true);
  });

  it('delay 边界：默认 3，可显式设为 2-6', () => {
    expect(new LockstepBuffer({ localSlot: 0, playerCount: 2 }).delay).toBe(3);
    expect(new LockstepBuffer({ localSlot: 0, playerCount: 2, delay: 2 }).delay).toBe(2);
    expect(new LockstepBuffer({ localSlot: 0, playerCount: 2, delay: 6 }).delay).toBe(6);
  });

  it('构造参数非法时 fail fast', () => {
    expect(() => new LockstepBuffer({ localSlot: 0, playerCount: 0 })).toThrow();
    expect(() => new LockstepBuffer({ localSlot: 2, playerCount: 2 })).toThrow();
    expect(() => new LockstepBuffer({ localSlot: 0, playerCount: 2, delay: -1 })).toThrow();
  });

  it('submitRemoteInput/submitRemoteCmd/recordRemoteHash 的 slot 越界抛错', () => {
    const buf = new LockstepBuffer({ localSlot: 0, playerCount: 2 });
    expect(() => buf.submitRemoteInput(1, 2, { dir: null, fire: false })).toThrow();
    expect(() => buf.submitRemoteCmd(1, 2, 'pause')).toThrow();
    expect(() => buf.recordRemoteHash(1, 2, 1)).toThrow();
  });

  it('cmd 存取：本地/对方指令各自记录，未提交时返回 undefined', () => {
    const buf = new LockstepBuffer({ localSlot: 0, playerCount: 2 });
    expect(buf.cmdForTick(5)).toBeNull();
    buf.submitLocalCmd(5, 'confirm');
    expect(buf.cmdForTick(5)).toEqual(['confirm', undefined]);
    buf.submitRemoteCmd(5, 1, 'pause');
    expect(buf.cmdForTick(5)).toEqual(['confirm', 'pause']);
  });

  it('失步比对：同 tick 哈希相同则不失步，不同则 desync=true', () => {
    const buf = new LockstepBuffer({ localSlot: 0, playerCount: 2 });
    expect(buf.checkDesync(1)).toEqual({ desync: false });

    buf.recordLocalHash(1, 0xabc);
    expect(buf.checkDesync(1)).toEqual({ desync: false, localHash: 0xabc });

    buf.recordRemoteHash(1, 1, 0xabc);
    expect(buf.checkDesync(1)).toEqual({ desync: false, localHash: 0xabc });

    buf.recordLocalHash(2, 111);
    buf.recordRemoteHash(2, 1, 222);
    expect(buf.checkDesync(2)).toEqual({ desync: true, localHash: 111, remoteHash: 222 });
  });

  it('gc 清理指定 tick 之前的输入/指令/哈希记录', () => {
    const buf = new LockstepBuffer({ localSlot: 0, playerCount: 2 });
    buf.submitLocalInput(1, { dir: null, fire: false });
    buf.submitRemoteInput(1, 1, { dir: null, fire: false });
    buf.recordLocalHash(1, 1);
    buf.recordRemoteHash(1, 1, 1);

    buf.gc(2);
    expect(buf.inputsReady(1)).toBe(false);
    expect(buf.checkDesync(1)).toEqual({ desync: false });
  });
});

/* ---------------- 确定性对齐：两个 World 经 lockstep 交换输入后逐 tick 哈希一致 ---------------- */

describe('lockstep 确定性对齐（内存 mock 中继）', () => {
  it('A/B 两端跑 610 tick，每 100 tick 哈希一致，delay 缓冲吸收网络抖动后不 stall', () => {
    const masterSeed = 20260717;
    const stageSeed = deriveStageSeed(masterSeed, 0);
    const level = makeLevel();

    const worldA = new World({ level, rng: new RNG(stageSeed), playerCount: 2 });
    const worldB = new World({ level, rng: new RNG(stageSeed), playerCount: 2 });

    const DELAY = 3;
    const NET_DELAY = 2; // 模拟中继延迟 1-2 tick 到达
    const bufferA = new LockstepBuffer({ localSlot: 0, playerCount: 2, delay: DELAY });
    const bufferB = new LockstepBuffer({ localSlot: 1, playerCount: 2, delay: DELAY });

    // 启动引导：delay 窗口尚未填满前的前 DELAY 个 tick 用双方约定的静默输入占位，
    // 否则 worldTick 从 1 开始时永远等不到"提前 DELAY tick 采样"的真实输入。
    for (let t = 1; t <= DELAY; t += 1) {
      const idle: PlayerInput = { dir: null, fire: false };
      bufferA.submitLocalInput(t, idle);
      bufferA.submitRemoteInput(t, 1, idle);
      bufferB.submitLocalInput(t, idle);
      bufferB.submitRemoteInput(t, 0, idle);
    }

    type Pending = { at: number; run: () => void };
    const relayToA: Pending[] = [];
    const relayToB: Pending[] = [];

    function deliverDue(queue: Pending[], loop: number): void {
      while (queue.length > 0 && (queue[0] as Pending).at <= loop) {
        (queue.shift() as Pending).run();
      }
    }

    let worldTick = 1;
    const maxLoop = 610;

    for (let loop = 1; loop <= maxLoop; loop += 1) {
      const effectiveTick = loop + DELAY;
      const inputA = scriptInput(0, loop);
      const inputB = scriptInput(1, loop);

      bufferA.submitLocalInput(effectiveTick, inputA);
      bufferB.submitLocalInput(effectiveTick, inputB);

      // 经协议编解码后投递给对方（验证 protocol 与 lockstep 组合可用）
      const frameToB = encodeInput(0, effectiveTick, inputA);
      const frameToA = encodeInput(1, effectiveTick, inputB);
      relayToB.push({ at: loop + NET_DELAY, run: () => bufferB.submitRemoteInput(effectiveTick, 0, decodeInput(frameToB)) });
      relayToA.push({ at: loop + NET_DELAY, run: () => bufferA.submitRemoteInput(effectiveTick, 1, decodeInput(frameToA)) });

      deliverDue(relayToB, loop);
      deliverDue(relayToA, loop);

      while (bufferA.inputsReady(worldTick) && bufferB.inputsReady(worldTick)) {
        const inputsA = bufferA.inputsForTick(worldTick);
        const inputsB = bufferB.inputsForTick(worldTick);
        if (!inputsA || !inputsB) break;

        worldA.tick(inputsA);
        worldB.tick(inputsB);

        if (worldTick % 100 === 0) {
          expect(worldA.hash()).toBe(worldB.hash());
        }
        worldTick += 1;
      }
    }

    // 断言实际跑够 ≥600 个已推进的 world tick（而非仅循环了 610 次外层 loop）
    expect(worldTick).toBeGreaterThan(600);
  });
});
