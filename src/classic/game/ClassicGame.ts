/**
 * 经典复刻 · 顶层游戏编排（M6）
 *
 * 薄的副作用编排层：持有 World（战斗模拟）/ ClassicRenderer（渲染）/ KeyboardController（输入）/
 * ScreensOverlay（界面）/ GameLoop（固定步长循环），并把纯逻辑的 FSM 转移映射为具体的舞台切换。
 *
 * 【已知接口缺口】World.tick() 在 status 变为非 'playing' 后会直接短路返回 []，且不再推进
 * tickCount（见 sim/World.ts 的 `if (this._status !== 'playing') return [];`）。这意味着结算前
 * 180 tick 的"看爆炸/结算动画"延迟无法通过继续调用 world.tick() 来驱动——快照会冻结在同一帧。
 * 本层因此把该延迟实现为 ClassicGame 自身的 tick 计数器（resultDelayTicks），延迟期间不再调用
 * world.tick()/renderer.render()，画面保持在 status 刚变化那一帧的最终定格。若未来希望在延迟期间
 * 播放逐帧特效，需要在 World 或 Renderer 层新增"允许 status 非 playing 时继续推进特效计时"的能力，
 * 但这超出本任务"不修改 sim/render"的约束，故仅记录、不擅自更改。
 */
import type { ClassicWorld, LevelData, SimEvent, WorldSnapshot } from '../core/types';
import { TICK_RATE } from '../core/constants';
import { CLASSIC_LEVELS } from '../content/levels';
import { RNG } from '../../core/RNG';
import { World } from '../sim/World';
import { ClassicRenderer } from '../render/ClassicRenderer';
import { createInitialFsmState, transition, type FsmEvent, type FsmState } from './fsm';
import { KeyboardController, type MenuAction } from './keyboard';
import { GameLoop } from './loop';
import { ScreensOverlay } from './screens';

/** 结算前延迟：让爆炸/结算动画的最后一帧多停留一会儿再切结算屏 [provisional 节奏] */
const RESULT_DELAY_TICKS = 180;

/** 过场屏展示时长：约 2 秒 */
const STAGE_INTRO_TICKS = 2 * TICK_RATE;

type CarryOver = { level: number; lives: number; score: number };

export interface ClassicGameOptions {
  container: HTMLElement;
  /** 每个模拟 tick 后回调（音频层 M7 由集成方挂接；不传则忽略） */
  onEvents?: (events: readonly SimEvent[]) => void;
  /** 进入过场屏（第 N 关）时回调，stageNumber 为 1-based；集成方用于触发开场 jingle */
  onStageStart?: (stageNumber: number) => void;
}

export class ClassicGame {
  private readonly options: ClassicGameOptions;
  private readonly renderer: ClassicRenderer;
  private readonly screens: ScreensOverlay;
  private readonly keyboard: KeyboardController;
  private readonly loop: GameLoop;

  private fsmState: FsmState;
  private world: ClassicWorld | null = null;

  private pendingCarryOver: CarryOver | undefined;
  private finalSnapshot: WorldSnapshot | null = null;
  private resultDelayTicks = 0;
  private stageStartScore = 0;
  private introTicks = 0;
  private pendingStageScore = 0;
  private pendingTotalScore = 0;

  constructor(options: ClassicGameOptions) {
    this.options = options;
    this.renderer = new ClassicRenderer({ container: options.container });
    this.screens = new ScreensOverlay(options.container);
    this.keyboard = new KeyboardController({ onMenuAction: (action) => this.handleMenuAction(action) });
    this.loop = new GameLoop(() => this.onTick());
    this.fsmState = createInitialFsmState(CLASSIC_LEVELS.length);
    window.addEventListener('resize', this.handleResize);
  }

  /** 进入标题菜单并启动 rAF 主循环 */
  start(): void {
    this.screens.showMenu();
    this.loop.start();
  }

  dispose(): void {
    this.loop.dispose();
    this.keyboard.dispose();
    this.screens.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    this.renderer.resize();
  };

  private handleMenuAction(action: MenuAction): void {
    this.dispatch(action === 'confirm' ? { type: 'confirm' } : { type: 'togglePause' });
  }

  private dispatch(event: FsmEvent): void {
    const prev = this.fsmState;
    const next = transition(prev, event);
    if (next === prev) return; // 非法/无意义事件：fsm 已原样忽略，这里不重复处理
    this.fsmState = next;
    this.onStateEnter(next, prev);
  }

  /** 每个 rAF 帧、由 GameLoop 按固定步长回调 0-5 次 */
  private onTick(): void {
    switch (this.fsmState.kind) {
      case 'stageIntro':
        this.introTicks += 1;
        if (this.introTicks >= STAGE_INTRO_TICKS) this.dispatch({ type: 'introTimeout' });
        return;
      case 'playing':
        this.stepWorld();
        return;
      case 'menu':
      case 'paused':
      case 'stageClear':
      case 'allClear':
      case 'gameOver':
        return; // 这些状态下不驱动模拟
      default: {
        const exhaustive: never = this.fsmState.kind;
        throw new Error(`ClassicGame.onTick: 未知 FSM 状态 ${String(exhaustive)}`);
      }
    }
  }

  private stepWorld(): void {
    const world = this.world;
    if (!world) throw new Error('ClassicGame: playing 状态下 world 未初始化（不应发生）');

    if (world.status === 'playing') {
      const input = this.keyboard.sample();
      const events = world.tick([input]);
      const snapshot = world.snapshot();
      this.renderer.render(snapshot, events);
      this.options.onEvents?.(events);
      if (world.status !== 'playing') {
        // 见文件头【已知接口缺口】：status 一旦变化，world.tick() 之后就是空操作，
        // 故从此刻起改由本层的 resultDelayTicks 计数，不再调用 world.tick()。
        this.finalSnapshot = snapshot;
        this.resultDelayTicks = RESULT_DELAY_TICKS;
      }
      return;
    }

    if (this.resultDelayTicks > 0) {
      this.resultDelayTicks -= 1;
      return;
    }
    this.finishStage(world.status);
  }

  private finishStage(status: 'stageClear' | 'gameOver'): void {
    const snapshot = this.finalSnapshot;
    if (!snapshot) throw new Error('ClassicGame: finishStage 缺少 finalSnapshot（不应发生）');

    this.pendingTotalScore = snapshot.hud.score;
    if (status === 'stageClear') {
      const playerTank = snapshot.tanks.find((t) => t.kind === 'player');
      this.pendingCarryOver = {
        level: playerTank?.level ?? 0,
        lives: snapshot.hud.lives,
        score: snapshot.hud.score,
      };
      this.pendingStageScore = snapshot.hud.score - this.stageStartScore;
      this.dispatch({ type: 'stageClear' });
    } else {
      this.dispatch({ type: 'gameOver' });
    }
  }

  private onStateEnter(state: FsmState, prev: FsmState): void {
    switch (state.kind) {
      case 'menu':
        this.world = null;
        this.pendingCarryOver = undefined;
        this.finalSnapshot = null;
        this.resultDelayTicks = 0;
        this.screens.showMenu();
        return;
      case 'stageIntro':
        this.introTicks = 0;
        this.screens.showStageIntro(state.stageIndex + 1);
        this.options.onStageStart?.(state.stageIndex + 1);
        return;
      case 'playing':
        if (prev.kind === 'stageIntro') this.startStage(state.stageIndex);
        this.screens.hide();
        return;
      case 'paused':
        this.screens.showPaused();
        return;
      case 'stageClear':
        this.screens.showStageClear({ stageScore: this.pendingStageScore, totalScore: this.pendingTotalScore });
        return;
      case 'allClear':
        this.screens.showAllClear({ totalScore: this.pendingTotalScore });
        return;
      case 'gameOver':
        this.screens.showGameOver({ totalScore: this.pendingTotalScore });
        return;
      default: {
        const exhaustive: never = state.kind;
        throw new Error(`ClassicGame.onStateEnter: 未知 FSM 状态 ${String(exhaustive)}`);
      }
    }
  }

  private startStage(stageIndex: number): void {
    const level = requireLevel(stageIndex);
    const seed = Date.now(); // 模拟外允许使用 Date.now 生成种子（见 core/types.ts 分层不变式 1）
    this.world = new World({ level, rng: new RNG(seed), carryOver: this.pendingCarryOver });
    this.pendingCarryOver = undefined;
    this.finalSnapshot = null;
    this.resultDelayTicks = 0;
    this.stageStartScore = this.world.snapshot().hud.score;
  }
}

function requireLevel(stageIndex: number): LevelData {
  const level = CLASSIC_LEVELS[stageIndex];
  if (!level) {
    throw new Error(`ClassicGame: 找不到第 ${stageIndex} 关数据（关卡总数 ${CLASSIC_LEVELS.length}）`);
  }
  return level;
}
