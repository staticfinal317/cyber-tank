/**
 * 经典复刻 · 音效数据表（纯数据，零 WebAudio 依赖，可在 node 环境下单测）
 *
 * 设计原则：
 * 1. 每个 SoundSpec 由若干 SoundLayer（音调层/噪声层）叠加而成，每层自带独立的
 *    起始延迟（startOffset）+ attack/decay 包络，供 ClassicAudio 引擎按层调度 WebAudio 节点。
 * 2. 本文件只描述"要发出什么声音"，不触碰 AudioContext——保证纯函数可测。
 * 3. 事件 → 音色的映射（resolveSoundId）为穷举 switch，新增 SimEvent 分支时 TS 会在
 *    default 分支报错（never 收窄失败），避免漏映射。
 */

import type { SimEvent } from '../core/types';

export type OscShape = 'square' | 'triangle' | 'sawtooth';

interface SoundLayerBase {
  /** 相对该音效起始时间的延迟（秒），用于同一音效内的多音符编排（如琶音） */
  startOffset: number;
  /** 起音时间（秒），gain 从 0 线性升到峰值所需时长 */
  attack: number;
  /** 该层总时长（秒，含衰减），从 startOffset 起算 */
  duration: number;
  /** 包络峰值增益（0-1），与主音量总线相乘后为最终响度 */
  gain: number;
}

/** 音调层：OscillatorNode，频率可做指数滑音（如金属音的"快速下滑"） */
export interface ToneLayer extends SoundLayerBase {
  kind: 'tone';
  shape: OscShape;
  freqStart: number;
  freqEnd: number;
}

/** 噪声层：白噪声 AudioBuffer 过一个可扫频的 BiquadFilter */
export interface NoiseLayer extends SoundLayerBase {
  kind: 'noise';
  filterType: BiquadFilterType;
  filterFreqStart: number;
  filterFreqEnd: number;
}

export type SoundLayer = ToneLayer | NoiseLayer;

export type SoundId =
  | 'fireBlipPlayer'
  | 'fireBlipEnemy'
  | 'brickHit'
  | 'metalClink'
  | 'steelBreak'
  | 'tankHit'
  | 'explosionSmall'
  | 'explosionMedium'
  | 'explosionBig'
  | 'powerUpSpawn'
  | 'powerUpPickup'
  | 'extraLife';

export interface SoundSpec {
  id: SoundId;
  layers: readonly SoundLayer[];
}

/** 音效总时长（秒）= 各层 startOffset+duration 的最大值 */
export function soundSpecDuration(spec: SoundSpec): number {
  return spec.layers.reduce((max, layer) => Math.max(max, layer.startOffset + layer.duration), 0);
}

/** 主总线音量：默认适度，避免吓到小朋友 */
export const MASTER_VOLUME = 0.25;

export const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  // 开火：方波短 blip，玩家音高更高更亮，敌方略低略闷，便于听感区分
  fireBlipPlayer: {
    id: 'fireBlipPlayer',
    layers: [
      { kind: 'tone', shape: 'square', freqStart: 950, freqEnd: 600, startOffset: 0, attack: 0.002, duration: 0.05, gain: 0.5 },
    ],
  },
  fireBlipEnemy: {
    id: 'fireBlipEnemy',
    layers: [
      { kind: 'tone', shape: 'square', freqStart: 620, freqEnd: 420, startOffset: 0, attack: 0.002, duration: 0.05, gain: 0.4 },
    ],
  },

  // 命中砖块：低频短噪声（原版"哒"声的气质）
  brickHit: {
    id: 'brickHit',
    layers: [
      { kind: 'noise', filterType: 'lowpass', filterFreqStart: 650, filterFreqEnd: 300, startOffset: 0, attack: 0.001, duration: 0.07, gain: 0.55 },
    ],
  },

  // 命中钢墙 / 子弹对消：共用同一音色——方波快速下滑的金属感高频短音
  metalClink: {
    id: 'metalClink',
    layers: [
      { kind: 'tone', shape: 'square', freqStart: 1700, freqEnd: 700, startOffset: 0, attack: 0.001, duration: 0.08, gain: 0.45 },
    ],
  },

  // 钢墙被摧毁（满级炮弹专属稀有事件）：比 metalClink 更沉重的崩裂——噪声崩塌 + 低频闷响
  steelBreak: {
    id: 'steelBreak',
    layers: [
      { kind: 'noise', filterType: 'lowpass', filterFreqStart: 1200, filterFreqEnd: 200, startOffset: 0, attack: 0.001, duration: 0.16, gain: 0.5 },
      { kind: 'tone', shape: 'triangle', freqStart: 160, freqEnd: 80, startOffset: 0.02, attack: 0.005, duration: 0.14, gain: 0.35 },
    ],
  },

  // 装甲坦克掉血未死：中频"哐"——带通噪声 + 短促方波顿音
  tankHit: {
    id: 'tankHit',
    layers: [
      { kind: 'noise', filterType: 'bandpass', filterFreqStart: 700, filterFreqEnd: 700, startOffset: 0, attack: 0.001, duration: 0.09, gain: 0.5 },
      { kind: 'tone', shape: 'square', freqStart: 320, freqEnd: 180, startOffset: 0, attack: 0.002, duration: 0.1, gain: 0.4 },
    ],
  },

  // 敌方坦克被摧毁：噪声爆炸（三级爆炸中最短最轻）
  explosionSmall: {
    id: 'explosionSmall',
    layers: [
      { kind: 'noise', filterType: 'lowpass', filterFreqStart: 2000, filterFreqEnd: 150, startOffset: 0, attack: 0.002, duration: 0.18, gain: 0.6 },
      { kind: 'tone', shape: 'triangle', freqStart: 120, freqEnd: 50, startOffset: 0, attack: 0.002, duration: 0.16, gain: 0.35 },
    ],
  },

  // 玩家坦克被摧毁：比 explosionSmall 更长更响
  explosionMedium: {
    id: 'explosionMedium',
    layers: [
      { kind: 'noise', filterType: 'lowpass', filterFreqStart: 2200, filterFreqEnd: 120, startOffset: 0, attack: 0.002, duration: 0.32, gain: 0.75 },
      { kind: 'tone', shape: 'triangle', freqStart: 100, freqEnd: 40, startOffset: 0, attack: 0.002, duration: 0.3, gain: 0.45 },
    ],
  },

  // 基地被摧毁：三级爆炸中最长最重（游戏结束的分量感）
  explosionBig: {
    id: 'explosionBig',
    layers: [
      { kind: 'noise', filterType: 'lowpass', filterFreqStart: 2400, filterFreqEnd: 90, startOffset: 0, attack: 0.003, duration: 0.5, gain: 0.85 },
      { kind: 'tone', shape: 'sawtooth', freqStart: 80, freqEnd: 30, startOffset: 0, attack: 0.003, duration: 0.48, gain: 0.55 },
    ],
  },

  // 道具出现：三音上行琶音，醒目提示
  powerUpSpawn: {
    id: 'powerUpSpawn',
    layers: [
      { kind: 'tone', shape: 'square', freqStart: 523.25, freqEnd: 523.25, startOffset: 0, attack: 0.003, duration: 0.09, gain: 0.4 },
      { kind: 'tone', shape: 'square', freqStart: 659.25, freqEnd: 659.25, startOffset: 0.09, attack: 0.003, duration: 0.09, gain: 0.4 },
      { kind: 'tone', shape: 'square', freqStart: 783.99, freqEnd: 783.99, startOffset: 0.18, attack: 0.003, duration: 0.12, gain: 0.42 },
    ],
  },

  // 道具拾取：欢快上行双音
  powerUpPickup: {
    id: 'powerUpPickup',
    layers: [
      { kind: 'tone', shape: 'square', freqStart: 659.25, freqEnd: 659.25, startOffset: 0, attack: 0.003, duration: 0.09, gain: 0.4 },
      { kind: 'tone', shape: 'square', freqStart: 880, freqEnd: 880, startOffset: 0.09, attack: 0.003, duration: 0.13, gain: 0.42 },
    ],
  },

  // 加命：欢快上行三连音，末音延长，比 powerUpPickup 更长更隆重
  extraLife: {
    id: 'extraLife',
    layers: [
      { kind: 'tone', shape: 'square', freqStart: 523.25, freqEnd: 523.25, startOffset: 0, attack: 0.003, duration: 0.14, gain: 0.42 },
      { kind: 'tone', shape: 'square', freqStart: 659.25, freqEnd: 659.25, startOffset: 0.14, attack: 0.003, duration: 0.14, gain: 0.44 },
      { kind: 'tone', shape: 'square', freqStart: 783.99, freqEnd: 783.99, startOffset: 0.28, attack: 0.005, duration: 0.32, gain: 0.46 },
    ],
  },
};

export function getSoundSpec(id: SoundId): SoundSpec {
  return SOUND_SPECS[id];
}

/**
 * 事件 → 音色映射（穷举，纯函数，可脱离 WebAudio 测试）。
 * 返回 null 表示"该事件本身不发声"（有明确设计理由，见各分支注释）。
 */
export function resolveSoundId(event: SimEvent): SoundId | null {
  switch (event.type) {
    case 'fire':
      return event.fromPlayer ? 'fireBlipPlayer' : 'fireBlipEnemy';
    case 'brickHit':
      return 'brickHit';
    case 'steelHit':
      return 'metalClink';
    case 'bulletsCancel':
      return 'metalClink';
    case 'steelBreak':
      return 'steelBreak';
    case 'tankHit':
      return 'tankHit';
    case 'enemyDestroyed':
      return 'explosionSmall';
    case 'playerDestroyed':
      return 'explosionMedium';
    case 'baseDestroyed':
      return 'explosionBig';
    case 'powerUpSpawn':
      return 'powerUpSpawn';
    case 'powerUpPickup':
      return 'powerUpPickup';
    case 'extraLife':
      return 'extraLife';
    case 'playerRespawn':
      // 出生已有护盾视觉提示；紧贴 playerDestroyed 的爆炸音之后再叠加音效会显得拥挤，故静音
      return null;
    case 'stageClear':
      // 由 playJingle('stageClear') 负责播放，避免与事件音效双响
      return null;
    case 'gameOver':
      // 由 playJingle('gameOver') 负责播放，避免与事件音效双响
      return null;
    default: {
      const exhaustive: never = event;
      throw new Error(`未映射的 SimEvent 类型: ${JSON.stringify(exhaustive)}`);
    }
  }
}
