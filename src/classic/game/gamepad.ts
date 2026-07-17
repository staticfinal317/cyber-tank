/**
 * 经典复刻 · 手柄输入（B1，Switch Pro Controller 等 standard mapping 手柄）
 *
 * `GamepadMapper` 是纯逻辑：不依赖 DOM/navigator，可在 node 环境直接单测。
 * `GamepadBridge` 是薄的浏览器桥接层：`poll()` 里读 `navigator.getGamepads()` 转成
 * 快照喂 mapper，并维护连接状态（对齐 keyboard.ts 的"纯逻辑 + 薄 DOM 桥接"分层）。
 *
 * 键位映射（standard mapping，详见设计书 B1-D3）：
 * - 十字键 上/下/左/右：buttons 12/13/14/15，持续方向源。
 * - 左摇杆：axes 0/1，死区 0.5，主导轴裁决（|x| 与 |y| 谁超过死区更多听谁的，平局取横轴），
 *   同一时刻至多产出一个方向，天然适配四向游戏。
 * - 方向裁决：十字键 4 个 + 摇杆主导 1 个按 Dir 取"并集"（任一来源活跃即活跃），按最近
 *   激活顺序排序——与 keyboard.ts 的 DirectionStack 契约一致（后激活优先、松开回退到
 *   仍活跃的方向），但不复用其实现：两个来源可能同时命中同一 Dir，DirectionStack 按键码
 *   去重不适配这种"多来源同 Dir"场景，改造它收益不值当，这里在 mapper 内部自持一份
 *   约 10 行的排序表（见设计书 D2）。
 * - 面键 B/A/Y/X（buttons 0-3）：任一按住 = fire；从"全松开"到"至少一个按住"的
 *   上沿 = 产出一次 confirm（FSM 在 playing 态忽略 confirm，双职责安全）。
 * - button 9（+/Start）：上沿 = 产出一次 pause。
 * - 快照为 null（未连接/断开）：视为全部松开，不产生任何上沿动作；重新喂入非 null
 *   快照时从"全松开"状态重新检测边沿。
 * - 越界索引防御：buttons/axes 长度不足时按未按下/0 处理，不抛错。
 */
import { Dir, type PlayerInput } from '../core/types';
import type { MenuAction } from './keyboard';

/** 十字键 buttons 索引（standard mapping） */
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

/** 面键 buttons 索引（B/A/Y/X）：任一按住即 fire，上沿即 confirm */
const FACE_BUTTON_INDICES: readonly number[] = [0, 1, 2, 3];

/** +/Start 按键索引：上沿即 pause */
const PAUSE_BUTTON_INDEX = 9;

/** 左摇杆 axes 索引 */
const AXIS_X = 0;
const AXIS_Y = 1;

/** 摇杆死区：|axis| 需超过该阈值才计入方向裁决 */
const STICK_DEADZONE = 0.5;

/** 一帧手柄快照：纯数据，桥接层从 navigator.getGamepads() 转换而来 */
export interface GamepadFrame {
  buttons: readonly boolean[];
  axes: readonly number[];
}

function buttonAt(frame: GamepadFrame, index: number): boolean {
  return frame.buttons[index] ?? false;
}

function axisAt(frame: GamepadFrame, index: number): number {
  return frame.axes[index] ?? 0;
}

/** 摇杆主导轴裁决：|x| 与 |y| 都未超死区 → 无方向；否则谁绝对值大听谁的，平局取横轴 */
function stickDirection(frame: GamepadFrame): Dir | null {
  const x = axisAt(frame, AXIS_X);
  const y = axisAt(frame, AXIS_Y);
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax <= STICK_DEADZONE && ay <= STICK_DEADZONE) return null;
  return ax >= ay ? (x > 0 ? Dir.Right : Dir.Left) : y > 0 ? Dir.Down : Dir.Up;
}

/** 本帧活跃方向：十字键 4 个 + 摇杆主导 1 个的并集，dpad 按上/下/左/右固定顺序、摇杆若新增追加在末尾 */
function activeDirections(frame: GamepadFrame): Dir[] {
  const dirs: Dir[] = [];
  if (buttonAt(frame, DPAD_UP)) dirs.push(Dir.Up);
  if (buttonAt(frame, DPAD_DOWN)) dirs.push(Dir.Down);
  if (buttonAt(frame, DPAD_LEFT)) dirs.push(Dir.Left);
  if (buttonAt(frame, DPAD_RIGHT)) dirs.push(Dir.Right);
  const stick = stickDirection(frame);
  if (stick !== null && !dirs.includes(stick)) dirs.push(stick);
  return dirs;
}

export class GamepadMapper {
  /** 活跃方向，按"最近激活优先"排序（末尾最新，与 keyboard.ts DirectionStack 排序契约一致） */
  private order: Dir[] = [];
  private fireHeld = false;
  /** 上一帧面键是否有任一按住（confirm 边沿检测用） */
  private facePrevActive = false;
  /** 上一帧 +/Start 是否按住（pause 边沿检测用） */
  private pausePrevHeld = false;

  /** 喂入本帧快照（null = 未连接/无输入），返回本帧上沿触发的菜单动作列表 */
  update(frame: GamepadFrame | null): MenuAction[] {
    if (frame === null) {
      this.reset();
      return [];
    }

    const actions: MenuAction[] = [];

    // 方向：移除不再活跃的方向（保留其余相对顺序），新激活的追加到末尾
    const active = activeDirections(frame);
    this.order = this.order.filter((dir) => active.includes(dir));
    for (const dir of active) {
      if (!this.order.includes(dir)) this.order.push(dir);
    }

    // fire：面键任一按住；confirm 只在"无→有"上沿产出一次
    const faceActive = FACE_BUTTON_INDICES.some((index) => buttonAt(frame, index));
    if (!this.facePrevActive && faceActive) actions.push('confirm');
    this.facePrevActive = faceActive;
    this.fireHeld = faceActive;

    // pause：button 9 上沿
    const pauseHeld = buttonAt(frame, PAUSE_BUTTON_INDEX);
    if (!this.pausePrevHeld && pauseHeld) actions.push('pause');
    this.pausePrevHeld = pauseHeld;

    return actions;
  }

  /** 归一化为一帧 PlayerInput，契约与 DirectionStack.sample() 一致 */
  sample(): PlayerInput {
    const last = this.order.length > 0 ? this.order[this.order.length - 1] : undefined;
    return { dir: last ?? null, fire: this.fireHeld };
  }

  reset(): void {
    this.order = [];
    this.fireHeld = false;
    this.facePrevActive = false;
    this.pausePrevHeld = false;
  }
}

export interface GamepadBridgeOptions {
  onMenuAction: (action: MenuAction) => void;
  /** 连接状态变化回调（连接数 0↔1 的边沿） */
  onConnectionChange?: (connected: boolean) => void;
  /** 测试注入；默认 () => navigator.getGamepads() */
  getGamepads?: () => readonly (Gamepad | null)[];
  /** 测试注入事件目标；默认 window */
  target?: Window;
}

/** 摊平 Gamepad.buttons（GamepadButton[]）的 .pressed 为 boolean[]，axes 原样转数组 */
function toFrame(gamepad: Gamepad): GamepadFrame {
  return {
    buttons: gamepad.buttons.map((button) => button.pressed),
    axes: Array.from(gamepad.axes),
  };
}

export class GamepadBridge {
  private readonly mapper = new GamepadMapper();
  private readonly onMenuAction: (action: MenuAction) => void;
  private readonly onConnectionChange?: (connected: boolean) => void;
  private readonly getGamepads: () => readonly (Gamepad | null)[];
  private readonly target: Window;
  private isConnected = false;

  constructor(options: GamepadBridgeOptions) {
    this.onMenuAction = options.onMenuAction;
    this.onConnectionChange = options.onConnectionChange;
    this.getGamepads = options.getGamepads ?? (() => navigator.getGamepads());
    this.target = options.target ?? window;
    this.target.addEventListener('gamepadconnected', this.handleConnected as EventListener);
    this.target.addEventListener('gamepaddisconnected', this.handleDisconnected as EventListener);
  }

  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * 每 tick 轮询：取第一个非空 Gamepad 转 GamepadFrame 喂 mapper，边沿动作经 onMenuAction 上抛。
   * 连接态在此兜底纠正：部分浏览器对"页面加载前已连接"的手柄不发 gamepadconnected 事件，
   * 靠轮询发现非空 Gamepad 时也会翻转为已连接（反之轮询到全空时翻转为断开），
   * 与事件路径共用同一个 isConnected 布尔量，靠 setConnected 内的去重避免重复触发回调。
   */
  poll(): void {
    const gamepad = this.firstGamepad();
    this.setConnected(gamepad !== null);
    const frame = gamepad === null ? null : toFrame(gamepad);
    const actions = this.mapper.update(frame);
    for (const action of actions) this.onMenuAction(action);
  }

  sample(): PlayerInput {
    return this.mapper.sample();
  }

  /** 移除 gamepadconnected/disconnected 监听 */
  dispose(): void {
    this.target.removeEventListener('gamepadconnected', this.handleConnected as EventListener);
    this.target.removeEventListener('gamepaddisconnected', this.handleDisconnected as EventListener);
    this.mapper.reset();
  }

  private firstGamepad(): Gamepad | null {
    for (const pad of this.getGamepads()) {
      if (pad !== null) return pad;
    }
    return null;
  }

  private setConnected(connected: boolean): void {
    if (connected === this.isConnected) return; // 状态未变化：不重复触发回调
    this.isConnected = connected;
    this.onConnectionChange?.(connected);
  }

  private handleConnected = (): void => {
    this.setConnected(true);
  };

  private handleDisconnected = (): void => {
    this.setConnected(false);
  };
}
