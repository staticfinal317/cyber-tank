/**
 * 经典复刻 · 游戏流程状态机（M6）
 *
 * 纯逻辑、零副作用、零 DOM 依赖：状态与转移函数可在 node 环境直接单测。
 * 副作用（创建 World、驱动 tick、切换界面）全部在 ClassicGame.ts 执行。
 *
 * 状态流：
 *   menu → stageIntro → playing ⇄ paused → stageClear
 *     → [还有下一关 → stageIntro(下一关) | 已是最后一关 → allClear]
 *   playing → gameOver（基地被毁或命数耗尽）
 *   allClear / gameOver → menu（Enter 回到标题）
 *
 * 非法事件（当前状态不接受的事件，例如 menu 直接收到 stageClear）一律忽略，
 * 原样返回传入的状态引用——这是"过滤掉与当前阶段无关的输入/回报"的正常行为，
 * 不是吞掉真正的错误；调用方若需要区分"发生了转移"，可用 `!==` 比较返回值与传入值。
 */

export type FsmStateKind =
  | 'menu'
  | 'stageIntro'
  | 'playing'
  | 'paused'
  | 'stageClear'
  | 'allClear'
  | 'gameOver';

export interface FsmState {
  readonly kind: FsmStateKind;
  /** 0-based 当前关卡序号（stageIntro/playing/stageClear 状态下有意义） */
  readonly stageIndex: number;
  /** 关卡总数，构造时固定，转移过程中不变 */
  readonly totalStages: number;
}

export type FsmEvent =
  | { type: 'confirm' } // Enter
  | { type: 'togglePause' } // Esc / P
  | { type: 'introTimeout' } // 过场屏展示时长到
  | { type: 'stageClear' } // World.status 变为 stageClear（经延迟后由 ClassicGame 上抛）
  | { type: 'gameOver' }; // World.status 变为 gameOver（经延迟后由 ClassicGame 上抛）

export function createInitialFsmState(totalStages: number): FsmState {
  if (!Number.isInteger(totalStages) || totalStages <= 0) {
    throw new Error(`createInitialFsmState: totalStages 必须是正整数，实际 ${totalStages}`);
  }
  return { kind: 'menu', stageIndex: 0, totalStages };
}

export function transition(state: FsmState, event: FsmEvent): FsmState {
  switch (state.kind) {
    case 'menu':
      if (event.type === 'confirm') return { ...state, kind: 'stageIntro', stageIndex: 0 };
      return state;

    case 'stageIntro':
      if (event.type === 'introTimeout') return { ...state, kind: 'playing' };
      return state;

    case 'playing':
      if (event.type === 'togglePause') return { ...state, kind: 'paused' };
      if (event.type === 'stageClear') return { ...state, kind: 'stageClear' };
      if (event.type === 'gameOver') return { ...state, kind: 'gameOver' };
      return state;

    case 'paused':
      if (event.type === 'togglePause') return { ...state, kind: 'playing' };
      return state;

    case 'stageClear':
      if (event.type === 'confirm') {
        const nextStage = state.stageIndex + 1;
        return nextStage < state.totalStages
          ? { ...state, kind: 'stageIntro', stageIndex: nextStage }
          : { ...state, kind: 'allClear' };
      }
      return state;

    case 'allClear':
      if (event.type === 'confirm') return { ...state, kind: 'menu', stageIndex: 0 };
      return state;

    case 'gameOver':
      if (event.type === 'confirm') return { ...state, kind: 'menu', stageIndex: 0 };
      return state;

    default: {
      const exhaustive: never = state.kind;
      throw new Error(`transition: 未知 FSM 状态 ${String(exhaustive)}`);
    }
  }
}
