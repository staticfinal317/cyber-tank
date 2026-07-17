/**
 * 经典复刻 · 键盘输入（M6）
 *
 * `DirectionStack` 是纯逻辑：不依赖 DOM，可在 node 环境直接单测。
 * `KeyboardController` 是薄的 DOM 桥接层：监听挂 window，dispose 时移除，
 * 把方向/开火的连续按住状态与 Enter/Esc/P 的一次性菜单动作分开上抛。
 */
import { Dir, type PlayerInput } from '../core/types';

/** 方向键位：方向键与 WASD 二选一，映射到同一个 Dir 视为同一路输入 */
const DIR_KEYS: Readonly<Record<string, Dir>> = {
  ArrowUp: Dir.Up,
  KeyW: Dir.Up,
  ArrowRight: Dir.Right,
  KeyD: Dir.Right,
  ArrowDown: Dir.Down,
  KeyS: Dir.Down,
  ArrowLeft: Dir.Left,
  KeyA: Dir.Left,
};

/** 开火键位：J 或空格 */
const FIRE_KEYS: ReadonlySet<string> = new Set(['KeyJ', 'Space']);

/** 需要阻止页面默认滚动行为的键位（方向键 + 空格） */
export const SCROLL_BLOCKED_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

/**
 * 方向多键裁决（契约：同时按多键时"后按优先"，松开后回退到仍按住的最近方向）。
 *
 * 用一个按"最近一次按下"排序的方向列表实现：press 时先移除旧位置再追加到末尾
 * （末尾即最近按下，天然实现后按优先）；release 时直接从列表中移除该项，
 * 列表中剩余方向的相对顺序不变，于是松开后自动回退到"仍按住的最近方向"。
 * fire 是独立的按住状态，与方向裁决完全解耦。
 */
export class DirectionStack {
  private order: Dir[] = [];
  private fireHeld = false;

  press(code: string): void {
    const dir = DIR_KEYS[code];
    if (dir !== undefined) {
      this.order = this.order.filter((d) => d !== dir);
      this.order.push(dir);
      return;
    }
    if (FIRE_KEYS.has(code)) this.fireHeld = true;
  }

  release(code: string): void {
    const dir = DIR_KEYS[code];
    if (dir !== undefined) {
      this.order = this.order.filter((d) => d !== dir);
      return;
    }
    if (FIRE_KEYS.has(code)) this.fireHeld = false;
  }

  /** 归一化为一帧 PlayerInput：dir 取最近按下且仍按住的方向，否则 null */
  sample(): PlayerInput {
    const last = this.order.length > 0 ? this.order[this.order.length - 1] : undefined;
    return { dir: last ?? null, fire: this.fireHeld };
  }

  reset(): void {
    this.order = [];
    this.fireHeld = false;
  }
}

/** Enter/Esc/P 等一次性菜单动作：由 DOM 层做边沿检测后上抛，FSM 只消费离散事件 */
export type MenuAction = 'confirm' | 'pause';

const CONFIRM_KEYS: ReadonlySet<string> = new Set(['Enter']);
const PAUSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyP']);

export interface KeyboardControllerOptions {
  onMenuAction: (action: MenuAction) => void;
  /** 测试/宿主可注入自定义事件目标；默认 window（契约要求挂 window） */
  target?: Window;
}

export class KeyboardController {
  private readonly direction = new DirectionStack();
  private readonly target: Window;
  private readonly onMenuAction: (action: MenuAction) => void;

  constructor(options: KeyboardControllerOptions) {
    this.onMenuAction = options.onMenuAction;
    this.target = options.target ?? window;
    this.target.addEventListener('keydown', this.handleKeyDown as EventListener, { passive: false });
    this.target.addEventListener('keyup', this.handleKeyUp as EventListener);
  }

  sample(): PlayerInput {
    return this.direction.sample();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.handleKeyUp as EventListener);
    this.direction.reset();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (SCROLL_BLOCKED_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat) return; // 过滤系统按键重复触发，避免误扰"后按优先"顺序
    if (CONFIRM_KEYS.has(event.code)) {
      this.onMenuAction('confirm');
      return;
    }
    if (PAUSE_KEYS.has(event.code)) {
      this.onMenuAction('pause');
      return;
    }
    this.direction.press(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.direction.release(event.code);
  };
}
