/**
 * 经典复刻 · KeyboardController（薄 DOM 桥接层）测试
 *
 * DirectionStack 的纯逻辑裁决已在 classic-game.test.ts 覆盖；本文件只补 KeyboardController
 * 自身的桥接职责：keydown/keyup 转发给 DirectionStack、Enter/Esc/P 的边沿上抛、
 * 以及 D1 新增的 menuUp/menuDown 边沿上抛（含 repeat 过滤、DirectionStack 喂入不受影响）。
 */
import { describe, expect, it } from 'vitest';
import { KeyboardController, type MenuAction } from '../src/classic/game/keyboard';
import { Dir } from '../src/classic/core/types';

/** 最小 EventTarget 实现：只支持 addEventListener/removeEventListener/自定义 dispatch，够桥接层用 */
class FakeWindow {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type: string, event: FakeKeyboardEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** 桥接层只读 code/repeat 与调用 preventDefault，够构造假 KeyboardEvent */
class FakeKeyboardEvent {
  readonly code: string;
  readonly repeat: boolean;
  defaultPrevented = false;

  constructor(code: string, repeat = false) {
    this.code = code;
    this.repeat = repeat;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

function setup() {
  const target = new FakeWindow();
  const menuActions: MenuAction[] = [];
  const controller = new KeyboardController({
    onMenuAction: (action) => menuActions.push(action),
    target: target as unknown as Window,
  });
  return { target, menuActions, controller };
}

describe('KeyboardController · Enter/Esc/P 一次性菜单动作（边沿检测）', () => {
  it('Enter keydown 上抛一次 confirm，不喂入 DirectionStack', () => {
    const { target, menuActions, controller } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('Enter'));
    expect(menuActions).toEqual(['confirm']);
    expect(controller.sample()).toEqual({ dir: null, fire: false });
  });

  it('Escape/KeyP keydown 均上抛一次 pause', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('Escape'));
    target.dispatch('keydown', new FakeKeyboardEvent('KeyP'));
    expect(menuActions).toEqual(['pause', 'pause']);
  });

  it('repeat=true 的系统重复触发不会重复上抛', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('Enter'));
    target.dispatch('keydown', new FakeKeyboardEvent('Enter', true)); // 系统重复：应被过滤
    expect(menuActions).toEqual(['confirm']);
  });
});

describe('KeyboardController · menuUp/menuDown 边沿上抛（D1）', () => {
  it('ArrowUp/ArrowDown 的 keydown 边沿分别上抛 menuUp/menuDown', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp'));
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowDown'));
    expect(menuActions).toEqual(['menuUp', 'menuDown']);
  });

  it('KeyW/KeyS（WASD 映射）同样触发 menuUp/menuDown', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('KeyW'));
    target.dispatch('keydown', new FakeKeyboardEvent('KeyS'));
    expect(menuActions).toEqual(['menuUp', 'menuDown']);
  });

  it('repeat=true（按住不放的系统重复触发）不会重复上抛 menuUp/menuDown', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp'));
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp', true));
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp', true));
    expect(menuActions).toEqual(['menuUp']);
  });

  it('松开后再次按下（非 repeat）：重新上抛一次', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp'));
    target.dispatch('keyup', new FakeKeyboardEvent('ArrowUp'));
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp'));
    expect(menuActions).toEqual(['menuUp', 'menuUp']);
  });

  it('menuUp/menuDown 上抛的同时，DirectionStack 仍照常被喂入（sample().dir 正确反映按住的方向）', () => {
    const { target, controller } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp'));
    expect(controller.sample()).toEqual({ dir: Dir.Up, fire: false });
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowDown'));
    expect(controller.sample()).toEqual({ dir: Dir.Down, fire: false }); // 后按优先
    target.dispatch('keyup', new FakeKeyboardEvent('ArrowDown'));
    expect(controller.sample()).toEqual({ dir: Dir.Up, fire: false }); // 回退到仍按住的 Up
  });

  it('左右方向键不触发 menuUp/menuDown', () => {
    const { target, menuActions } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowLeft'));
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowRight'));
    expect(menuActions).toEqual([]);
  });
});

describe('KeyboardController · 方向/开火按住状态桥接（非菜单动作）', () => {
  it('keydown/keyup 分别 press/release DirectionStack，fire 键同理', () => {
    const { target, controller } = setup();
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowLeft'));
    target.dispatch('keydown', new FakeKeyboardEvent('KeyJ'));
    expect(controller.sample()).toEqual({ dir: Dir.Left, fire: true });
    target.dispatch('keyup', new FakeKeyboardEvent('ArrowLeft'));
    target.dispatch('keyup', new FakeKeyboardEvent('KeyJ'));
    expect(controller.sample()).toEqual({ dir: null, fire: false });
  });
});

describe('KeyboardController · dispose', () => {
  it('dispose 后移除 keydown/keyup 监听，并重置 DirectionStack', () => {
    const target = new FakeWindow();
    const controller = new KeyboardController({ onMenuAction: () => undefined, target: target as unknown as Window });
    target.dispatch('keydown', new FakeKeyboardEvent('ArrowUp'));
    expect(controller.sample().dir).toBe(Dir.Up);
    expect(target.listenerCount('keydown')).toBe(1);
    expect(target.listenerCount('keyup')).toBe(1);

    controller.dispose();
    expect(target.listenerCount('keydown')).toBe(0);
    expect(target.listenerCount('keyup')).toBe(0);
    expect(controller.sample()).toEqual({ dir: null, fire: false });
  });
});
