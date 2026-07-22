/**
 * 经典复刻 · 联机帧协议（纯数据结构与编解码函数，无网络 IO）
 *
 * D1 只定义帧形状与编解码，真实收发（WebSocket）留给 D3。
 * 三种帧共享判别字段 `t`，供 lockstep 层与未来的传输层按类型分派。
 */
import { Dir, type PlayerInput } from '../core/types';

/** 输入帧：某 slot 在某 tick 的按键状态；dir 用 -1..3 编码（-1=无方向） */
export interface InputFrame {
  t: 'in';
  tick: number;
  slot: number;
  dir: number;
  fire: number;
}

/** 流程指令帧：确认/暂停等非逐帧输入的控制信号 */
export interface CmdFrame {
  t: 'cmd';
  tick: number;
  slot: number;
  cmd: 'confirm' | 'pause';
}

/** 哈希帧：某 slot 在某 tick 结束时的世界哈希，供失步比对 */
export interface HashFrame {
  t: 'h';
  tick: number;
  slot: number;
  hash: number;
}

export type Frame = InputFrame | CmdFrame | HashFrame;

/** 将玩家输入编码为可传输的输入帧（dir: null → -1） */
export function encodeInput(slot: number, tick: number, input: PlayerInput): InputFrame {
  return {
    t: 'in',
    tick,
    slot,
    dir: input.dir === null ? -1 : input.dir,
    fire: input.fire ? 1 : 0,
  };
}

/** 将输入帧解码为玩家输入（-1 → null，0-3 → Dir）；dir 越界时 fail fast */
export function decodeInput(frame: InputFrame): PlayerInput {
  if (!Number.isInteger(frame.dir) || frame.dir < -1 || frame.dir > 3) {
    throw new Error(`InputFrame.dir 越界：${frame.dir}`);
  }
  return {
    dir: frame.dir === -1 ? null : (frame.dir as Dir),
    fire: frame.fire !== 0,
  };
}

/** 序列化为 JSON 字符串，供 D3 的传输层直接发送 */
export function serialize(frame: Frame): string {
  return JSON.stringify(frame);
}

/** 解析 JSON 字符串为帧；`t` 非法（不是 in/cmd/h 之一）时抛错 */
export function parse(raw: string): Frame {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('t' in value)) {
    throw new Error('帧解析失败：不是合法的帧对象');
  }
  const t = (value as { t: unknown }).t;
  if (t !== 'in' && t !== 'cmd' && t !== 'h') {
    throw new Error(`帧解析失败：未知的帧类型 t=${String(t)}`);
  }
  return value as Frame;
}
