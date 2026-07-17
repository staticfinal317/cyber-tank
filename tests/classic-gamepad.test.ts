import { describe, expect, it } from 'vitest';
import { GamepadBridge, GamepadMapper, type GamepadFrame } from '../src/classic/game/gamepad';
import type { MenuAction } from '../src/classic/game/keyboard';
import { Dir } from '../src/classic/core/types';

/** 构造一帧假快照：pressed 只需指定按下的按钮索引，其余按钮/轴按未按下/0 补齐 */
function frame(pressed: Partial<Record<number, boolean>>, axes: readonly number[] = [0, 0]): GamepadFrame {
  const buttons = new Array(16).fill(false) as boolean[];
  for (const [index, value] of Object.entries(pressed)) {
    buttons[Number(index)] = value ?? false;
  }
  return { buttons, axes };
}

/* ==================== GamepadMapper：方向裁决（纯逻辑） ==================== */

describe('GamepadMapper · 方向裁决（纯逻辑，可在 node 直接单测）', () => {
  it('十字键单键按下：sample().dir 为对应方向', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 12: true })); // 上
    expect(mapper.sample().dir).toBe(Dir.Up);
  });

  it('十字键多键先后按住：后按优先（最近激活的方向生效）', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 12: true })); // 上
    expect(mapper.sample().dir).toBe(Dir.Up);
    mapper.update(frame({ 12: true, 15: true })); // + 右（新激活）
    expect(mapper.sample().dir).toBe(Dir.Right);
    mapper.update(frame({ 12: true, 15: true, 13: true })); // + 下（新激活）
    expect(mapper.sample().dir).toBe(Dir.Down);
  });

  it('松开最近激活的方向后：回退到仍激活的、次新的方向', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 12: true })); // 上
    mapper.update(frame({ 12: true, 15: true })); // + 右
    mapper.update(frame({ 12: true, 15: true, 13: true })); // + 下（激活顺序：上、右、下）
    expect(mapper.sample().dir).toBe(Dir.Down);

    mapper.update(frame({ 12: true, 15: true })); // 松开下
    expect(mapper.sample().dir).toBe(Dir.Right);

    mapper.update(frame({ 12: true })); // 松开右
    expect(mapper.sample().dir).toBe(Dir.Up);

    mapper.update(frame({})); // 松开上
    expect(mapper.sample().dir).toBeNull();
  });

  it('摇杆死区内（|axis| ≤ 0.5）：不产生方向', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({}, [0.5, 0.5])); // 恰好等于死区边界，不算超过
    expect(mapper.sample().dir).toBeNull();
    mapper.update(frame({}, [0.3, -0.4]));
    expect(mapper.sample().dir).toBeNull();
  });

  it('摇杆主导轴裁决：|x|>|y| 取横轴、|y|>|x| 取纵轴，|x|=|y| 平局取横轴', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({}, [0.8, 0.2]));
    expect(mapper.sample().dir).toBe(Dir.Right);
    mapper.update(frame({}, [-0.8, 0.2]));
    expect(mapper.sample().dir).toBe(Dir.Left);
    mapper.update(frame({}, [0.2, 0.8]));
    expect(mapper.sample().dir).toBe(Dir.Down);
    mapper.update(frame({}, [0.2, -0.8]));
    expect(mapper.sample().dir).toBe(Dir.Up);
    mapper.update(frame({}, [0.6, 0.6])); // 平局：|x|=|y|，取横轴
    expect(mapper.sample().dir).toBe(Dir.Right);
    mapper.update(frame({}, [-0.6, -0.6]));
    expect(mapper.sample().dir).toBe(Dir.Left);
  });

  it('十字键与摇杆命中同一 Dir：并集语义——一方松开、另一方仍激活时方向不丢', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 12: true }, [0, -0.8])); // 十字键与摇杆都指向"上"
    expect(mapper.sample().dir).toBe(Dir.Up);
    mapper.update(frame({}, [0, -0.8])); // 松开十字键，摇杆仍指向"上"
    expect(mapper.sample().dir).toBe(Dir.Up); // 方向不丢
    mapper.update(frame({}, [0, 0])); // 摇杆回中
    expect(mapper.sample().dir).toBeNull();
  });

  it('十字键与摇杆命中不同 Dir：最近激活优先', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 12: true })); // 十字键"上"先激活
    expect(mapper.sample().dir).toBe(Dir.Up);
    mapper.update(frame({ 12: true }, [0.8, 0])); // 摇杆"右"新激活
    expect(mapper.sample().dir).toBe(Dir.Right);
    mapper.update(frame({}, [0.8, 0])); // 松开十字键"上"，摇杆"右"仍激活
    expect(mapper.sample().dir).toBe(Dir.Right);
  });
});

/* ==================== GamepadMapper：fire（面键任一按住） ==================== */

describe('GamepadMapper · fire（面键任一按住即持续为 true）', () => {
  it('面键按住期间持续为 true，松开变回 false', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 0: true }));
    expect(mapper.sample().fire).toBe(true);
    mapper.update(frame({}));
    expect(mapper.sample().fire).toBe(false);
  });

  it('多面键（0/1/2/3）任一按住即为 true', () => {
    for (const index of [0, 1, 2, 3]) {
      const mapper = new GamepadMapper();
      mapper.update(frame({ [index]: true }));
      expect(mapper.sample().fire, `面键 ${index} 应触发 fire`).toBe(true);
    }
  });
});

/* ==================== GamepadMapper：confirm/pause 边沿检测 ==================== */

describe('GamepadMapper · confirm/pause 边沿检测（只在"无→有"上沿产出一次）', () => {
  it('confirm：面键从无到有的上沿产出一次，按住/换按其他面键不重复', () => {
    const mapper = new GamepadMapper();
    expect(mapper.update(frame({ 0: true }))).toEqual(['confirm']);
    expect(mapper.update(frame({ 0: true }))).toEqual([]); // 按住不重复
    expect(mapper.update(frame({ 1: true }))).toEqual([]); // 换按另一面键，仍处于"有面键按住"状态，非上沿
    expect(mapper.update(frame({}))).toEqual([]); // 松开
    expect(mapper.update(frame({ 2: true }))).toEqual(['confirm']); // 再次按下：新的上沿
  });

  it('pause（button 9）同理：仅"无→有"上沿产出一次', () => {
    const mapper = new GamepadMapper();
    expect(mapper.update(frame({ 9: true }))).toEqual(['pause']);
    expect(mapper.update(frame({ 9: true }))).toEqual([]); // 按住不重复
    expect(mapper.update(frame({}))).toEqual([]); // 松开
    expect(mapper.update(frame({ 9: true }))).toEqual(['pause']); // 再次按下：新的上沿
  });

  it('一帧内同时上沿 confirm + pause：两者都要产出', () => {
    const mapper = new GamepadMapper();
    const actions = mapper.update(frame({ 0: true, 9: true }));
    expect(actions).toEqual<MenuAction[]>(['confirm', 'pause']);
  });
});

/* ==================== GamepadMapper：断开 ==================== */

describe('GamepadMapper · 断开（update(null)）', () => {
  it('update(null) 后 sample() 全空，且不产生任何动作', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 12: true, 0: true }));
    expect(mapper.update(null)).toEqual([]);
    expect(mapper.sample()).toEqual({ dir: null, fire: false });
  });

  it('重连后边沿检测从"全松开"重新开始：断开前按住的面键，重连时仍按住会形成"松开→按下"上沿，触发一次 confirm（设计接受的语义，非 bug——断开即视为全松开）', () => {
    const mapper = new GamepadMapper();
    mapper.update(frame({ 0: true })); // 按住面键 0，产生一次 confirm
    mapper.update(null); // 断开：重置为全松开
    const actions = mapper.update(frame({ 0: true })); // 重连时面键 0 仍按住 → 视为"松开→按下"新上沿
    expect(actions).toEqual(['confirm']);
  });
});

/* ==================== GamepadMapper：越界索引防御 ==================== */

describe('GamepadMapper · 越界索引防御（buttons/axes 长度不足时不抛错）', () => {
  it('空 buttons/axes 数组：不抛错，按未按下/0 处理', () => {
    const mapper = new GamepadMapper();
    expect(() => mapper.update({ buttons: [], axes: [] })).not.toThrow();
    expect(mapper.sample()).toEqual({ dir: null, fire: false });
  });

  it('buttons 长度覆盖不到十字键/pause 索引：越界按未按下处理，不影响已存在的面键位', () => {
    const mapper = new GamepadMapper();
    const shortFrame: GamepadFrame = { buttons: [true, false], axes: [] }; // 只有 button0(面键)=true
    expect(() => mapper.update(shortFrame)).not.toThrow();
    expect(mapper.sample()).toEqual({ dir: null, fire: true });
  });
});

/* ==================== GamepadBridge：浏览器桥接（注入假 getGamepads + 假事件 target） ==================== */

/** 最小 EventTarget 实现：只支持 addEventListener/removeEventListener/自定义 dispatch，够桥接层用 */
class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({} as Event);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** 构造一个假 Gamepad：只填充 buttons/axes（桥接层只读这两项），其余字段用 as unknown as Gamepad 跳过 */
function fakeGamepad(pressedIndices: readonly number[], axes: readonly number[] = []): Gamepad {
  const maxIndex = pressedIndices.length > 0 ? Math.max(...pressedIndices) : -1;
  const buttons = Array.from({ length: maxIndex + 1 }, (_, i) => ({ pressed: pressedIndices.includes(i) }));
  return { buttons, axes } as unknown as Gamepad;
}

describe('GamepadBridge · 浏览器桥接（注入假 getGamepads + 假事件 target）', () => {
  it('poll 发现已连接手柄（getGamepads 返回非空）：触发 onConnectionChange(true)', () => {
    const target = new FakeEventTarget();
    const connectionChanges: boolean[] = [];
    let pads: readonly (Gamepad | null)[] = [null];
    const bridge = new GamepadBridge({
      onMenuAction: () => undefined,
      onConnectionChange: (connected) => connectionChanges.push(connected),
      getGamepads: () => pads,
      target: target as unknown as Window,
    });
    expect(bridge.connected).toBe(false); // 构造时未轮询，尚未发现手柄

    pads = [fakeGamepad([0])];
    bridge.poll();
    expect(bridge.connected).toBe(true);
    expect(connectionChanges).toEqual([true]);
  });

  it('拔掉后 poll 全空：触发 onConnectionChange(false)', () => {
    const target = new FakeEventTarget();
    const connectionChanges: boolean[] = [];
    let pads: readonly (Gamepad | null)[] = [fakeGamepad([])];
    const bridge = new GamepadBridge({
      onMenuAction: () => undefined,
      onConnectionChange: (connected) => connectionChanges.push(connected),
      getGamepads: () => pads,
      target: target as unknown as Window,
    });
    bridge.poll();
    expect(bridge.connected).toBe(true);

    pads = [null];
    bridge.poll();
    expect(bridge.connected).toBe(false);
    expect(connectionChanges).toEqual([true, false]);
  });

  it('事件路径与轮询路径共用同一连接状态，不重复触发回调', () => {
    const target = new FakeEventTarget();
    const connectionChanges: boolean[] = [];
    const pads: readonly (Gamepad | null)[] = [fakeGamepad([])];
    const bridge = new GamepadBridge({
      onMenuAction: () => undefined,
      onConnectionChange: (connected) => connectionChanges.push(connected),
      getGamepads: () => pads,
      target: target as unknown as Window,
    });

    target.dispatch('gamepadconnected'); // 事件路径先触发
    expect(connectionChanges).toEqual([true]);

    bridge.poll(); // 轮询路径发现同样已连接，状态未变化，不应重复触发
    expect(connectionChanges).toEqual([true]);

    target.dispatch('gamepaddisconnected'); // 事件路径断开（即便此刻 getGamepads 仍返回手柄，事件路径直接置 false）
    expect(connectionChanges).toEqual([true, false]);

    bridge.poll(); // 轮询发现手柄仍在，翻转回 true——验证两条路径确实共用同一状态且不重复触发
    expect(connectionChanges).toEqual([true, false, true]);
  });

  it('dispose 后移除 gamepadconnected/disconnected 监听', () => {
    const target = new FakeEventTarget();
    const bridge = new GamepadBridge({
      onMenuAction: () => undefined,
      getGamepads: () => [null],
      target: target as unknown as Window,
    });
    expect(target.listenerCount('gamepadconnected')).toBe(1);
    expect(target.listenerCount('gamepaddisconnected')).toBe(1);

    bridge.dispose();
    expect(target.listenerCount('gamepadconnected')).toBe(0);
    expect(target.listenerCount('gamepaddisconnected')).toBe(0);
  });

  it('poll 后 sample() 返回归一化的 PlayerInput，且边沿动作经 onMenuAction 上抛', () => {
    const target = new FakeEventTarget();
    const menuActions: MenuAction[] = [];
    const pads: readonly (Gamepad | null)[] = [fakeGamepad([12, 0])]; // 十字键"上" + 面键 0（fire & confirm 上沿）
    const bridge = new GamepadBridge({
      onMenuAction: (action) => menuActions.push(action),
      getGamepads: () => pads,
      target: target as unknown as Window,
    });

    bridge.poll();
    expect(bridge.sample()).toEqual({ dir: Dir.Up, fire: true });
    expect(menuActions).toEqual(['confirm']);
  });
});
