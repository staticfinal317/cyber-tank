import { describe, expect, it } from 'vitest';
import {
  createInitialFsmState,
  transition,
  type FsmEvent,
  type FsmState,
} from '../src/classic/game/fsm';
import { DirectionStack, KeyboardController } from '../src/classic/game/keyboard';
import { FixedStepAccumulator, GameLoop } from '../src/classic/game/loop';
import { ScreensOverlay } from '../src/classic/game/screens';
import { ClassicGame, StageKillTally } from '../src/classic/game/ClassicGame';
import { Dir, type SimEvent } from '../src/classic/core/types';
import { CLASSIC_LEVELS } from '../src/classic/content/levels';
import { World } from '../src/classic/sim/World';
import { RNG } from '../src/core/RNG';

/* ==================== fsm.ts：流程状态机（纯逻辑） ==================== */

describe('fsm · 流程状态机（纯逻辑，可在 node 直接单测）', () => {
  it('createInitialFsmState：合法 totalStages 得到 menu 初始态', () => {
    const state = createInitialFsmState(3);
    expect(state).toEqual({ kind: 'menu', stageIndex: 0, totalStages: 3 });
  });

  it('createInitialFsmState：totalStages 非正整数时 fail fast 抛错', () => {
    expect(() => createInitialFsmState(0)).toThrow();
    expect(() => createInitialFsmState(-1)).toThrow();
    expect(() => createInitialFsmState(1.5)).toThrow();
  });

  it('合法转移链：menu → stageIntro → playing ⇄ paused → stageClear → 下一关 stageIntro', () => {
    let state = createInitialFsmState(3);
    state = transition(state, { type: 'confirm' });
    expect(state.kind).toBe('stageIntro');
    expect(state.stageIndex).toBe(0);

    state = transition(state, { type: 'introTimeout' });
    expect(state.kind).toBe('playing');

    state = transition(state, { type: 'togglePause' });
    expect(state.kind).toBe('paused');

    state = transition(state, { type: 'togglePause' });
    expect(state.kind).toBe('playing');

    state = transition(state, { type: 'stageClear' });
    expect(state.kind).toBe('stageClear');

    state = transition(state, { type: 'confirm' });
    expect(state.kind).toBe('stageIntro');
    expect(state.stageIndex).toBe(1); // 进入第 2 关（0-based index 1）
  });

  it('最后一关 stageClear + confirm → allClear（而非再进 stageIntro）', () => {
    let state: FsmState = { kind: 'stageClear', stageIndex: 2, totalStages: 3 }; // 第 3 关（最后一关）通关
    state = transition(state, { type: 'confirm' });
    expect(state.kind).toBe('allClear');
  });

  it('allClear / gameOver + confirm → 回到 menu', () => {
    const fromAllClear = transition(
      { kind: 'allClear', stageIndex: 2, totalStages: 3 },
      { type: 'confirm' },
    );
    expect(fromAllClear.kind).toBe('menu');
    expect(fromAllClear.stageIndex).toBe(0);

    const fromGameOver = transition(
      { kind: 'gameOver', stageIndex: 1, totalStages: 3 },
      { type: 'confirm' },
    );
    expect(fromGameOver.kind).toBe('menu');
  });

  it('playing + gameOver 事件 → gameOver（基地被毁或命数耗尽）', () => {
    const state = transition(
      { kind: 'playing', stageIndex: 0, totalStages: 3 },
      { type: 'gameOver' },
    );
    expect(state.kind).toBe('gameOver');
  });

  it('非法转移（当前状态不接受的事件）：原样忽略，返回同一状态引用', () => {
    const menuState = createInitialFsmState(3);
    // menu 直接收到 stageClear：非法，应被忽略
    const result = transition(menuState, { type: 'stageClear' });
    expect(result).toBe(menuState); // 同一引用，证明是"未转移"而非"转移到了某个新 menu 对象"
    expect(result.kind).toBe('menu');
  });

  it('非法转移覆盖：paused 收到 confirm、stageIntro 收到 stageClear、stageClear 收到 togglePause 均被忽略', () => {
    const pausedState: FsmState = { kind: 'paused', stageIndex: 0, totalStages: 3 };
    expect(transition(pausedState, { type: 'confirm' })).toBe(pausedState);

    const introState: FsmState = { kind: 'stageIntro', stageIndex: 0, totalStages: 3 };
    expect(transition(introState, { type: 'stageClear' })).toBe(introState);

    const stageClearState: FsmState = { kind: 'stageClear', stageIndex: 0, totalStages: 3 };
    expect(transition(stageClearState, { type: 'togglePause' })).toBe(stageClearState);
  });

  it('穷举 FsmEvent 类型对每个状态逐一验证：仅文档化的合法事件会改变 kind', () => {
    const allEvents: FsmEvent[] = [
      { type: 'confirm' },
      { type: 'togglePause' },
      { type: 'introTimeout' },
      { type: 'stageClear' },
      { type: 'gameOver' },
    ];
    const legalTransitionsByKind: Record<FsmState['kind'], readonly FsmEvent['type'][]> = {
      menu: ['confirm'],
      stageIntro: ['introTimeout'],
      playing: ['togglePause', 'stageClear', 'gameOver'],
      paused: ['togglePause'],
      stageClear: ['confirm'],
      allClear: ['confirm'],
      gameOver: ['confirm'],
    };
    for (const [kind, legalTypes] of Object.entries(legalTransitionsByKind) as [
      FsmState['kind'],
      readonly FsmEvent['type'][],
    ][]) {
      const state: FsmState = { kind, stageIndex: 0, totalStages: 3 };
      for (const event of allEvents) {
        const next = transition(state, event);
        if (legalTypes.includes(event.type)) {
          expect(next.kind, `${kind} + ${event.type} 应发生转移`).not.toBe(kind);
        } else {
          expect(next, `${kind} + ${event.type} 应被忽略`).toBe(state);
        }
      }
    }
  });
});

/* ==================== keyboard.ts：DirectionStack（纯逻辑） ==================== */

describe('DirectionStack · 方向多键裁决（纯逻辑，可在 node 直接单测）', () => {
  it('未按任何键时：dir 为 null，fire 为 false', () => {
    const stack = new DirectionStack();
    expect(stack.sample()).toEqual({ dir: null, fire: false });
  });

  it('多方向键同时按住：后按优先（最近按下的方向生效）', () => {
    const stack = new DirectionStack();
    stack.press('ArrowUp');
    expect(stack.sample().dir).toBe(Dir.Up);
    stack.press('ArrowRight');
    expect(stack.sample().dir).toBe(Dir.Right); // 后按的 Right 优先于仍按住的 Up
    stack.press('ArrowDown');
    expect(stack.sample().dir).toBe(Dir.Down);
  });

  it('松开最近按下的方向后：回退到仍按住的、次新的方向', () => {
    const stack = new DirectionStack();
    stack.press('ArrowUp');
    stack.press('ArrowRight');
    stack.press('ArrowDown'); // 按下顺序：Up, Right, Down（Down 最新）
    expect(stack.sample().dir).toBe(Dir.Down);

    stack.release('ArrowDown');
    expect(stack.sample().dir).toBe(Dir.Right); // 回退到次新的 Right

    stack.release('ArrowRight');
    expect(stack.sample().dir).toBe(Dir.Up); // 继续回退到最早的 Up

    stack.release('ArrowUp');
    expect(stack.sample().dir).toBeNull(); // 全部松开
  });

  it('WASD 与方向键映射到同一路方向，互相替换按下顺序', () => {
    const stack = new DirectionStack();
    stack.press('KeyW'); // 等价于 ArrowUp
    stack.press('ArrowUp'); // 同一方向重复按下，应移到最新位置而非产生第二条记录
    stack.press('KeyD'); // Right
    expect(stack.sample().dir).toBe(Dir.Right);
    stack.release('ArrowRight'); // release 用方向键 code 释放 WASD 按下的同方向，应同样生效
    expect(stack.sample().dir).toBe(Dir.Up);
  });

  it('fire 状态与方向裁决完全独立：按住方向的同时可独立按下/松开 J 或空格', () => {
    const stack = new DirectionStack();
    stack.press('ArrowLeft');
    expect(stack.sample()).toEqual({ dir: Dir.Left, fire: false });

    stack.press('KeyJ');
    expect(stack.sample()).toEqual({ dir: Dir.Left, fire: true });

    stack.release('KeyJ');
    expect(stack.sample()).toEqual({ dir: Dir.Left, fire: false });

    stack.press('Space');
    expect(stack.sample().fire).toBe(true);
    stack.release('ArrowLeft'); // 松开方向不影响 fire
    expect(stack.sample()).toEqual({ dir: null, fire: true });
  });

  it('未映射的键码（如 Enter/Escape）对方向与 fire 均无影响', () => {
    const stack = new DirectionStack();
    stack.press('ArrowUp');
    stack.press('Enter');
    stack.press('Escape');
    expect(stack.sample()).toEqual({ dir: Dir.Up, fire: false });
    stack.release('Enter'); // release 未映射键同样安全无副作用
    expect(stack.sample()).toEqual({ dir: Dir.Up, fire: false });
  });

  it('reset：清空按下顺序与 fire 状态', () => {
    const stack = new DirectionStack();
    stack.press('ArrowUp');
    stack.press('KeyJ');
    stack.reset();
    expect(stack.sample()).toEqual({ dir: null, fire: false });
  });
});

/* ==================== loop.ts：FixedStepAccumulator（纯逻辑） ==================== */

describe('FixedStepAccumulator · 固定步长累加器（纯逻辑，可在 node 直接单测）', () => {
  const STEP = 1000 / 60; // ≈16.6667ms

  it('构造参数非法时 fail fast 抛错', () => {
    expect(() => new FixedStepAccumulator(0)).toThrow();
    expect(() => new FixedStepAccumulator(-1)).toThrow();
    expect(() => new FixedStepAccumulator(STEP, 0)).toThrow();
    expect(() => new FixedStepAccumulator(STEP, 1.5)).toThrow();
  });

  it('单帧恰好一个步长：产出 1 tick，余量归零', () => {
    const acc = new FixedStepAccumulator(STEP, 5);
    expect(acc.advance(STEP)).toBe(1);
    expect(acc.remainder).toBeCloseTo(0, 6);
  });

  it('时间不足一个步长：产出 0 tick，余量累积到下一帧', () => {
    const acc = new FixedStepAccumulator(STEP, 5);
    expect(acc.advance(STEP / 2)).toBe(0);
    expect(acc.remainder).toBeCloseTo(STEP / 2, 6);
    expect(acc.advance(STEP / 2)).toBe(1); // 两次半步长合计恰好一步
    expect(acc.remainder).toBeCloseTo(0, 6);
  });

  it('单帧补 tick 数超过上限（5）时：只产出 5 个 tick，多余时间被丢弃而非留存到下一帧', () => {
    const acc = new FixedStepAccumulator(STEP, 5);
    const ticks = acc.advance(STEP * 10); // 相当于 10 步的时间，一次性喂入
    expect(ticks).toBe(5); // 单帧上限 5
    expect(acc.remainder).toBe(0); // 超过 5 步对应的时长被直接丢弃，不留存（命中上限后清零，非浮点近似值）

    // 验证"丢弃"确实发生：紧接着喂入一个不足半步的时间，不应因为残留时间而多蹦出 1 tick
    expect(acc.advance(STEP * 0.1)).toBe(0);
  });

  it('多帧连续推进：产出的 tick 序列与手工时间线一致', () => {
    const acc = new FixedStepAccumulator(STEP, 5);
    const deltas = [STEP * 2.5, STEP * 0.4, STEP * 0.3, STEP * 3];
    const ticksPerFrame = deltas.map((d) => acc.advance(d));
    // 逐帧手算：
    //  帧1: 2.5 步 → 2 tick，余 0.5 步
    //  帧2: 0.5+0.4=0.9 步 → 0 tick，余 0.9 步
    //  帧3: 0.9+0.3=1.2 步 → 1 tick，余 0.2 步
    //  帧4: 0.2+3=3.2 步 → 3 tick，余 0.2 步
    expect(ticksPerFrame).toEqual([2, 0, 1, 3]);
    expect(acc.remainder).toBeCloseTo(STEP * 0.2, 3);
  });

  it('reset：清空累积余量', () => {
    const acc = new FixedStepAccumulator(STEP, 5);
    acc.advance(STEP * 0.7);
    acc.reset();
    expect(acc.remainder).toBe(0);
    expect(acc.advance(STEP * 0.7)).toBe(0); // 重置后重新从 0 累积，而非延续之前的余量
  });

  it('负数 deltaMs（异常输入）不会倒扣累积时间', () => {
    const acc = new FixedStepAccumulator(STEP, 5);
    acc.advance(STEP * 0.5);
    acc.advance(-1000);
    expect(acc.remainder).toBeCloseTo(STEP * 0.5, 6);
  });
});

/* ==================== ClassicGame.ts：StageKillTally（纯逻辑，可在 node 直接单测） ==================== */

function enemyDestroyed(kind: 'basic' | 'fast' | 'power' | 'armor', score: number): SimEvent {
  return { type: 'enemyDestroyed', tankId: 1, kind, score, x: 0, y: 0 };
}

describe('StageKillTally · 本关击杀统计（纯逻辑，可独立实例化单测，无 DOM 依赖）', () => {
  it('空关卡：未喂入任何事件时，各类型计数与分值小计均为 0', () => {
    const tally = new StageKillTally();
    (['basic', 'fast', 'power', 'armor'] as const).forEach((kind) => {
      expect(tally.countOf(kind)).toBe(0);
      expect(tally.scoreOf(kind)).toBe(0);
    });
  });

  it('多类型混合：按 EnemyKind 分类累计计数与分值小计，互不干扰', () => {
    const tally = new StageKillTally();
    tally.applyEvents([
      enemyDestroyed('basic', 100),
      enemyDestroyed('basic', 100),
      enemyDestroyed('fast', 200),
      enemyDestroyed('armor', 400),
    ]);
    expect(tally.countOf('basic')).toBe(2);
    expect(tally.scoreOf('basic')).toBe(200);
    expect(tally.countOf('fast')).toBe(1);
    expect(tally.scoreOf('fast')).toBe(200);
    expect(tally.countOf('armor')).toBe(1);
    expect(tally.scoreOf('armor')).toBe(400);
    expect(tally.countOf('power')).toBe(0); // 本关未出现的类型：保持 0，不受其他类型影响
    expect(tally.scoreOf('power')).toBe(0);
  });

  it('忽略非 enemyDestroyed 事件：fire/tankHit/stageClear 等不影响计数', () => {
    const tally = new StageKillTally();
    tally.applyEvents([
      { type: 'fire', fromPlayer: true },
      { type: 'tankHit', tankId: 1 },
      { type: 'stageClear' },
      enemyDestroyed('basic', 100),
    ]);
    expect(tally.countOf('basic')).toBe(1);
    expect(tally.scoreOf('basic')).toBe(100);
  });

  it('applyEvents 支持跨多次 tick 累加：分批喂入的事件流总数一致', () => {
    const tally = new StageKillTally();
    tally.applyEvents([enemyDestroyed('basic', 100)]);
    tally.applyEvents([]); // 空 tick（无击杀）不应改变累计
    tally.applyEvents([enemyDestroyed('basic', 100), enemyDestroyed('power', 300)]);
    expect(tally.countOf('basic')).toBe(2);
    expect(tally.scoreOf('basic')).toBe(200);
    expect(tally.countOf('power')).toBe(1);
    expect(tally.scoreOf('power')).toBe(300);
  });

  it('跨关清零：reset() 后所有类型的计数与分值小计归零，可复用同一实例统计下一关', () => {
    const tally = new StageKillTally();
    tally.applyEvents([enemyDestroyed('basic', 100), enemyDestroyed('armor', 400)]);
    expect(tally.countOf('basic')).toBe(1);

    tally.reset();
    (['basic', 'fast', 'power', 'armor'] as const).forEach((kind) => {
      expect(tally.countOf(kind)).toBe(0);
      expect(tally.scoreOf(kind)).toBe(0);
    });

    // reset 后继续正常累计（模拟下一关的击杀）
    tally.applyEvents([enemyDestroyed('fast', 200)]);
    expect(tally.countOf('fast')).toBe(1);
    expect(tally.countOf('basic')).toBe(0); // 上一关的 basic 击杀未残留
  });
});

/* ==================== 集成冒烟：World + 手动驱动 FSM，120 tick，不触碰渲染器 ==================== */

describe('集成冒烟 · World + FSM 手动驱动 120 tick（不 import/触碰 ClassicRenderer）', () => {
  it('从 menu 走到 playing 后，用假输入脚本驱动 120 tick：FSM 停留 playing，snapshot.tick 严格递增', () => {
    // 关卡数据取真实的第 1 关（已通过 parseLevel 校验），种子固定以保证测试确定性
    const level = CLASSIC_LEVELS[0];
    if (!level) throw new Error('测试夹具异常：CLASSIC_LEVELS 缺少第 1 关');
    const world = new World({ level, rng: new RNG(20260717) });

    let fsmState = createInitialFsmState(CLASSIC_LEVELS.length);
    fsmState = transition(fsmState, { type: 'confirm' }); // menu → stageIntro
    expect(fsmState.kind).toBe('stageIntro');
    fsmState = transition(fsmState, { type: 'introTimeout' }); // stageIntro → playing
    expect(fsmState.kind).toBe('playing');

    // 假输入脚本：方向按 tick 序号循环切换，每 3 tick 开一次火，覆盖"移动+开火"两条路径
    const directions = [Dir.Up, Dir.Right, Dir.Down, Dir.Left] as const;
    let previousTick = world.snapshot().tick;
    expect(previousTick).toBe(0);

    for (let i = 0; i < 120; i += 1) {
      const dir = directions[i % directions.length] ?? Dir.Up;
      const fire = i % 3 === 0;
      world.tick([{ dir, fire }]);

      // World.status 变化会让 FSM 收到 stageClear/gameOver 事件（此处不应发生，见下方断言）
      if (world.status !== 'playing') {
        fsmState = transition(fsmState, { type: world.status === 'stageClear' ? 'stageClear' : 'gameOver' });
      }

      const snap = world.snapshot();
      expect(snap.tick).toBe(previousTick + 1); // 严格递增，逐 tick 加 1
      previousTick = snap.tick;
    }

    expect(fsmState.kind).toBe('playing'); // 120 tick（2 秒）内不足以清光 20 个敌人或打光 3 条命
    expect(world.status).toBe('playing');
    expect(world.snapshot().tick).toBe(120);
  });
});

/* ==================== game/ 目录的 DOM 依赖模块：仅做 import 校验 ==================== */

describe('game/ 模块加载（DOM 依赖，测试环境无 jsdom，仅验证可安全 import）', () => {
  it('KeyboardController / GameLoop / ScreensOverlay / ClassicGame 均可在 node 环境安全导入', () => {
    // 顶层 import 不触碰 window/document（只在方法体/构造函数内引用），
    // 与 ClassicRenderer 的既有约定一致；实例化需要真实 DOM，交由浏览器端手测或未来 e2e 覆盖。
    expect(typeof KeyboardController).toBe('function');
    expect(typeof GameLoop).toBe('function');
    expect(typeof ScreensOverlay).toBe('function');
    expect(typeof ClassicGame).toBe('function');
  });
});
