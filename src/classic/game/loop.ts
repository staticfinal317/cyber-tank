/**
 * 经典复刻 · 固定步长主循环（M6）
 *
 * `FixedStepAccumulator` 是纯逻辑：不依赖 DOM/rAF/Date，可在 node 环境直接单测。
 * `GameLoop` 是薄的 rAF 桥接层：按累加器吐出的 tick 数调用 onTick，
 * 页面切到后台时暂停推进，切回前台重置计时基准。
 */
import { TICK_RATE } from '../core/constants';

/** 单帧最多补的 tick 数：防止后台切回前台后的"补 tick 死亡螺旋" */
const DEFAULT_MAX_TICKS_PER_FRAME = 5;

/**
 * 固定步长累加器：喂入每帧的时间增量（ms），吐出本帧应执行的 tick 数。
 * 单帧最多吐 maxTicksPerFrame 个 tick；累加器一旦超过该上限对应的时长，
 * 多余时间被直接丢弃（不留存到下一帧），避免长时间不再爆发式补帧。
 */
export class FixedStepAccumulator {
  private accumulator = 0;

  constructor(
    private readonly stepMs: number = 1000 / TICK_RATE,
    private readonly maxTicksPerFrame: number = DEFAULT_MAX_TICKS_PER_FRAME,
  ) {
    if (!(stepMs > 0)) throw new Error(`FixedStepAccumulator: stepMs 必须为正数，实际 ${stepMs}`);
    if (!Number.isInteger(maxTicksPerFrame) || maxTicksPerFrame <= 0) {
      throw new Error(`FixedStepAccumulator: maxTicksPerFrame 必须是正整数，实际 ${maxTicksPerFrame}`);
    }
  }

  /** 喂入本帧时间增量（ms），返回应执行的 tick 数并更新内部累加器 */
  advance(deltaMs: number): number {
    this.accumulator += Math.max(0, deltaMs);

    let ticks = 0;
    while (ticks < this.maxTicksPerFrame && this.accumulator >= this.stepMs) {
      this.accumulator -= this.stepMs;
      ticks += 1;
    }
    // 命中单帧上限：说明积压的时间超过了本帧能补的量，直接丢弃剩余部分，
    // 不留存到下一帧（防止长时间不活动后瞬间补出一长串 tick 的死亡螺旋）。
    // 注意：不能改用"预先钳制 accumulator 到 maxTicksPerFrame*stepMs 再减"的写法——
    // 该乘法在浮点下会引入误差，可能让最后一次减法在到达 0 前就跌破 stepMs，
    // 少产出 1 个 tick（曾在此处触发过该 bug）。
    if (ticks === this.maxTicksPerFrame) this.accumulator = 0;
    return ticks;
  }

  /** 当前剩余的未消耗时间（ms），仅供测试观察内部状态 */
  get remainder(): number {
    return this.accumulator;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

/**
 * rAF 驱动的固定步长主循环。onTick 会在一帧内被调用 0-5 次（由累加器决定）。
 * 页面隐藏（document.hidden）期间跳过推进；切回前台时重置计时基准与累加器，
 * 避免隐藏期间累积的巨量时间差涌入累加器造成瞬间补大量 tick。
 */
export class GameLoop {
  private readonly accumulator: FixedStepAccumulator;
  private rafId: number | null = null;
  private lastTime = 0;
  private running = false;

  constructor(
    private readonly onTick: () => void,
    stepMs: number = 1000 / TICK_RATE,
    maxTicksPerFrame: number = DEFAULT_MAX_TICKS_PER_FRAME,
  ) {
    this.accumulator = new FixedStepAccumulator(stepMs, maxTicksPerFrame);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange = (): void => {
    if (!document.hidden) {
      this.lastTime = performance.now();
      this.accumulator.reset();
    }
  };

  private frame = (time: number): void => {
    if (!this.running) return;
    if (!document.hidden) {
      const deltaMs = time - this.lastTime;
      const ticks = this.accumulator.advance(deltaMs);
      for (let i = 0; i < ticks; i += 1) this.onTick();
    }
    this.lastTime = time;
    this.rafId = requestAnimationFrame(this.frame);
  };
}
