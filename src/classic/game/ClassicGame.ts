/**
 * 经典复刻 · 顶层游戏编排（M6）
 *
 * 薄的副作用编排层：持有 World（战斗模拟）/ ClassicRenderer（渲染）/ KeyboardController（输入）/
 * ScreensOverlay（界面）/ GameLoop（固定步长循环），并把纯逻辑的 FSM 转移映射为具体的舞台切换。
 *
 * World.tick() 在 status 变为非 'playing' 后仍会推进 tickCount（"表现 tick"：只计数、不模拟任何
 * 实体，恒返回空事件数组），因此结算前 180 tick 的"看爆炸/结算动画"延迟（resultDelayTicks）期间，
 * 本层继续以中性输入调用 world.tick() + renderer.render()，让爆炸特效与地形动画（如水面）随
 * snapshot.tick 正常播放完，而不是把画面定格在 status 刚变化的那一帧。结算数据（分数/命数/星级）
 * 仍在 status 翻转的那一帧采样进 finalSnapshot，供 finishStage 使用，不受后续表现 tick 影响。
 */
import type { ClassicWorld, LevelData, PlayerInput, SimEvent, WorldSnapshot } from '../core/types';
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

/** 结算延迟期间喂给 world.tick() 的中性输入：status 已非 playing，World 不会用它模拟任何实体 */
const NEUTRAL_INPUT: PlayerInput = { dir: null, fire: false };

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
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
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
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleResize = (): void => {
    this.renderer.resize();
  };

  /**
   * 切后台自动暂停：与 Esc 走完全相同的入暂停路径；回前台保持暂停，等玩家手动恢复。
   * FSM 停留 'playing' 也覆盖了结算延迟期（resultDelayTicks 递减、world.status 已非 'playing'
   * 的那段时间），但设计明确排除结算延迟，故额外要求 world.status 仍为 'playing'。
   */
  private handleVisibilityChange = (): void => {
    if (document.hidden && this.fsmState.kind === 'playing' && this.world?.status === 'playing') {
      this.dispatch({ type: 'togglePause' });
    }
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
        // status 翻转的这一帧：定格结算数据供 finishStage 使用；此后继续调用 world.tick()
        // 只推进"表现 tick"（见文件头），画面据此继续播放爆炸/地形动画。
        this.finalSnapshot = snapshot;
        this.resultDelayTicks = RESULT_DELAY_TICKS;
      }
      return;
    }

    if (this.resultDelayTicks > 0) {
      this.resultDelayTicks -= 1;
      const events = world.tick([NEUTRAL_INPUT]);
      const snapshot = world.snapshot();
      this.renderer.render(snapshot, events);
      this.options.onEvents?.(events);
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
