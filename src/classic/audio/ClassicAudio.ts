/**
 * 经典复刻 · 程序化 8-bit 音效层（WebAudio 实时合成，零音频文件）
 *
 * 架构约束：
 * - 只依赖 core/types 的 SimEvent 类型，不 import sim/render/game 任何模块。
 * - 数据（音符表/包络参数，见 soundSpecs.ts、jingles.ts）与 WebAudio 调用（本文件）分离。
 * - 降级路径：无 WebAudio 环境（如 node 测试）时静默为空实现，仅 console.warn 一次；
 *   除此之外一律 fail fast，不吞错误。
 */

import type { SimEvent } from '../core/types';
import { type JingleKind, JINGLES } from './jingles';
import { type NoiseLayer, type OscShape, type SoundSpec, MASTER_VOLUME, getSoundSpec, resolveSoundId, type SoundId } from './soundSpecs';

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  const globalWithAudio = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return globalWithAudio.AudioContext ?? globalWithAudio.webkitAudioContext ?? null;
}

export class ClassicAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private degraded = false;
  private warned = false;

  /** 必须在用户手势回调内调用一次以解锁 AudioContext（内部惰性创建并 resume） */
  unlock(): void {
    if (this.degraded) return;
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) {
      this.degradeSilently('WebAudio 不可用');
      return;
    }
    try {
      this.context = new Ctor();
    } catch (err) {
      this.degradeSilently('AudioContext 创建失败', err);
      return;
    }
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.context.destination);
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** 每 tick 由游戏层调用；将 SimEvent 映射为即时音效（同 tick 每类最多触发一次，按解析后的音色去重） */
  handleEvents(events: readonly SimEvent[]): void {
    if (!this.context || !this.master) return; // 未 unlock 或已降级：静默忽略，不排队
    const triggered = new Set<SoundId>();
    for (const event of events) {
      const soundId = resolveSoundId(event);
      if (soundId === null) continue;
      if (triggered.has(soundId)) continue;
      triggered.add(soundId);
      this.playSpec(getSoundSpec(soundId));
    }
  }

  /** 界面 jingle：由流程层在对应时机显式触发 */
  playJingle(kind: JingleKind): void {
    if (!this.context || !this.master) return;
    const context = this.context;
    const master = this.master;
    const jingle = JINGLES[kind];
    const startAt = context.currentTime;
    for (const voice of jingle.voices) {
      let cursor = startAt;
      for (const note of voice.notes) {
        const attack = Math.min(0.01, note.dur / 4);
        this.scheduleTone(context, master, voice.shape, note.freq, note.freq, cursor, attack, note.dur, voice.gain);
        cursor += note.dur;
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.context.currentTime, 0.01);
    }
  }

  dispose(): void {
    if (this.context) {
      try {
        void this.context.close();
      } catch {
        /* 已关闭，忽略 */
      }
    }
    this.context = null;
    this.master = null;
  }

  private degradeSilently(message: string, err?: unknown): void {
    this.degraded = true;
    this.context = null;
    this.master = null;
    if (!this.warned) {
      this.warned = true;
      if (err !== undefined) console.warn(`[ClassicAudio] ${message}，音效已静音降级`, err);
      else console.warn(`[ClassicAudio] ${message}，音效已静音降级`);
    }
  }

  private playSpec(spec: SoundSpec): void {
    if (!this.context || !this.master) return;
    const context = this.context;
    const master = this.master;
    const now = context.currentTime;
    for (const layer of spec.layers) {
      const start = now + layer.startOffset;
      if (layer.kind === 'tone') {
        this.scheduleTone(context, master, layer.shape, layer.freqStart, layer.freqEnd, start, layer.attack, layer.duration, layer.gain);
      } else {
        this.scheduleNoise(context, master, layer, start);
      }
    }
  }

  private scheduleTone(
    context: AudioContext,
    master: GainNode,
    shape: OscShape,
    freqStart: number,
    freqEnd: number,
    start: number,
    attack: number,
    duration: number,
    gainPeak: number,
  ): void {
    const osc = context.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(Math.max(1, freqStart), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + Math.max(0.001, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private scheduleNoise(context: AudioContext, master: GainNode, layer: NoiseLayer, start: number): void {
    const length = Math.max(1, Math.floor(context.sampleRate * layer.duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = layer.filterType;
    filter.frequency.setValueAtTime(Math.max(1, layer.filterFreqStart), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, layer.filterFreqEnd), start + layer.duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(layer.gain, start + Math.max(0.001, layer.attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + layer.duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(start);
    source.stop(start + layer.duration + 0.02);
  }
}
