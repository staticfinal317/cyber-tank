/**
 * 经典复刻 · 延迟式确定性 lockstep 缓冲（纯逻辑，无 IO/定时器）
 *
 * 两端只同步 (masterSeed, 每 tick 的输入数组)，不同步游戏状态；
 * 本地 tick T 采样的输入标记为在 tick T+delay 生效，用固定延迟吸收网络抖动。
 * 调用方负责喂入本地/远端输入并在 inputsReady 后推进各自的 World。
 */
import type { PlayerInput } from '../core/types';
import type { CmdFrame } from './protocol';

type Cmd = CmdFrame['cmd'];

export interface LockstepBufferOptions {
  localSlot: number;
  /** 参与者总数（对齐 World.tick 的 inputs 长度契约） */
  playerCount: number;
  /** 输入延迟档：本地 tick T 采样的输入在 tick T+delay 生效，默认 3（建议 2-6） */
  delay?: number;
}

export class LockstepBuffer {
  readonly localSlot: number;
  readonly playerCount: number;
  readonly delay: number;

  private readonly inputs = new Map<number, (PlayerInput | undefined)[]>();
  private readonly cmds = new Map<number, (Cmd | undefined)[]>();
  private readonly hashes = new Map<number, Map<number, number>>();

  constructor(options: LockstepBufferOptions) {
    if (!Number.isInteger(options.playerCount) || options.playerCount < 1) {
      throw new Error(`playerCount 必须是正整数，实际 ${String(options.playerCount)}`);
    }
    if (!Number.isInteger(options.localSlot) || options.localSlot < 0 || options.localSlot >= options.playerCount) {
      throw new Error(`localSlot 越界：${String(options.localSlot)}`);
    }
    const delay = options.delay ?? 3;
    if (!Number.isInteger(delay) || delay < 0) {
      throw new Error(`delay 必须是非负整数，实际 ${String(delay)}`);
    }
    this.localSlot = options.localSlot;
    this.playerCount = options.playerCount;
    this.delay = delay;
  }

  private assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.playerCount) {
      throw new Error(`slot 越界：${String(slot)}`);
    }
  }

  private inputSlotsFor(tick: number): (PlayerInput | undefined)[] {
    let slots = this.inputs.get(tick);
    if (!slots) {
      slots = new Array<PlayerInput | undefined>(this.playerCount).fill(undefined);
      this.inputs.set(tick, slots);
    }
    return slots;
  }

  private cmdSlotsFor(tick: number): (Cmd | undefined)[] {
    let slots = this.cmds.get(tick);
    if (!slots) {
      slots = new Array<Cmd | undefined>(this.playerCount).fill(undefined);
      this.cmds.set(tick, slots);
    }
    return slots;
  }

  /** 记录本地 slot 在该 tick 的输入 */
  submitLocalInput(tick: number, input: PlayerInput): void {
    this.inputSlotsFor(tick)[this.localSlot] = input;
  }

  /** 记录对方 slot 在该 tick 的输入 */
  submitRemoteInput(tick: number, slot: number, input: PlayerInput): void {
    this.assertSlot(slot);
    this.inputSlotsFor(tick)[slot] = input;
  }

  /** 该 tick 全部 playerCount 个 slot 的输入是否都到齐 */
  inputsReady(tick: number): boolean {
    const slots = this.inputs.get(tick);
    if (!slots) return false;
    for (let i = 0; i < this.playerCount; i += 1) {
      if (slots[i] === undefined) return false;
    }
    return true;
  }

  /** 齐了返回按 slot 顺序排列的输入数组（下标=playerIndex），没齐返回 null */
  inputsForTick(tick: number): readonly PlayerInput[] | null {
    if (!this.inputsReady(tick)) return null;
    const slots = this.inputs.get(tick);
    if (!slots) return null;
    return slots as PlayerInput[];
  }

  /** 记录本地 slot 在该 tick 发出的流程指令（confirm/pause） */
  submitLocalCmd(tick: number, cmd: Cmd): void {
    this.cmdSlotsFor(tick)[this.localSlot] = cmd;
  }

  /** 记录对方 slot 在该 tick 发出的流程指令 */
  submitRemoteCmd(tick: number, slot: number, cmd: Cmd): void {
    this.assertSlot(slot);
    this.cmdSlotsFor(tick)[slot] = cmd;
  }

  /** 该 tick 各 slot 已知的流程指令（下标=slot，未提交为 undefined）；无任何记录时返回 null */
  cmdForTick(tick: number): readonly (Cmd | undefined)[] | null {
    const slots = this.cmds.get(tick);
    if (!slots) return null;
    return slots;
  }

  /** 记录本地 slot 在该 tick 的世界哈希 */
  recordLocalHash(tick: number, hash: number): void {
    this.hashSlotsFor(tick).set(this.localSlot, hash);
  }

  /** 记录对方 slot 在该 tick 的世界哈希 */
  recordRemoteHash(tick: number, slot: number, hash: number): void {
    this.assertSlot(slot);
    this.hashSlotsFor(tick).set(slot, hash);
  }

  private hashSlotsFor(tick: number): Map<number, number> {
    let slots = this.hashes.get(tick);
    if (!slots) {
      slots = new Map<number, number>();
      this.hashes.set(tick, slots);
    }
    return slots;
  }

  /**
   * 失步比对：同 tick 本地哈希与任一对方哈希都已记录且不等，则 desync=true。
   * 本地或对方哈希缺失时不判定失步（数据不足，非"未失步"的强断言）。
   */
  checkDesync(tick: number): { desync: boolean; localHash?: number; remoteHash?: number } {
    const slots = this.hashes.get(tick);
    if (!slots) return { desync: false };
    const localHash = slots.get(this.localSlot);
    if (localHash === undefined) return { desync: false };
    for (const [slot, hash] of slots) {
      if (slot === this.localSlot) continue;
      if (hash !== localHash) {
        return { desync: true, localHash, remoteHash: hash };
      }
    }
    return { desync: false, localHash };
  }

  /** 清理已消费的旧 tick（< beforeTick），防内存增长 */
  gc(beforeTick: number): void {
    for (const map of [this.inputs, this.cmds, this.hashes]) {
      for (const tick of map.keys()) {
        if (tick < beforeTick) map.delete(tick);
      }
    }
  }
}
