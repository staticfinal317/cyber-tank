/**
 * 经典复刻 · 界面 jingle 音符表（纯数据，零 WebAudio 依赖）
 *
 * 三首曲子均为原创作曲（仅致敬 FC 芯片音乐的方波/三角波气质，不复刻 Namco 原曲的
 * 旋律/节奏/和声）：
 * - stageStart：C 大调进行曲，两个短乐句问答 + 一句上行 + 一句收束终止式，纯八分音符律动。
 * - stageClear：C 大调级进音阶上行跑动（C4→E5）收在长音主和弦，胜利感来自"跑上去"而非琶音。
 * - gameOver：A 自然小调级进下行，带渐慢（前 6 音等长、后 2 音时值翻倍），三角波音色偏柔和。
 *
 * 音高用音名字符串书写（如 'C5'）只是为了作曲时可读；导出的 JINGLES 中已解析为具体 Hz 数值，
 * 供测试直接断言 freq > 0。
 */

export type OscShape = 'square' | 'triangle' | 'sawtooth';

export interface JingleNote {
  /** 频率 Hz，> 0 */
  freq: number;
  /** 时值，秒，> 0 */
  dur: number;
}

export interface JingleVoice {
  shape: OscShape;
  /** 该声部的包络峰值增益 */
  gain: number;
  /** 依次连续播放的音符序列 */
  notes: readonly JingleNote[];
}

export type JingleKind = 'stageStart' | 'stageClear' | 'gameOver';

export interface Jingle {
  kind: JingleKind;
  /** 声部数量 ≤ 2（旋律 + 低音/和声） */
  voices: readonly JingleVoice[];
}

const NOTE_SEMITONES: Readonly<Record<string, number>> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

const NOTE_PATTERN = /^([A-G]#?)(\d)$/;

/** A 在八度内的半音序号，作为 A4=440Hz 基准音的偏移零点 */
const A_SEMITONE = NOTE_SEMITONES.A ?? 9;

/** 音名（如 'A4'）→ 频率 Hz，A4 = 440Hz 十二平均律 */
function noteToFreq(note: string): number {
  const match = NOTE_PATTERN.exec(note);
  if (!match) throw new Error(`非法音名: ${note}`);
  const name = match[1];
  const octaveStr = match[2];
  if (!name || !octaveStr) throw new Error(`非法音名: ${note}`);
  const semitone = NOTE_SEMITONES[name];
  if (semitone === undefined) throw new Error(`非法音名: ${note}`);
  const octave = Number(octaveStr);
  const semitoneFromA4 = (octave - 4) * 12 + (semitone - A_SEMITONE);
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

function n(note: string, dur: number): JingleNote {
  return { freq: noteToFreq(note), dur };
}

/** stageStart：进行曲气质，约 2.0s。旋律方波，低音三角波按乐句给根音 */
const STAGE_START: Jingle = {
  kind: 'stageStart',
  voices: [
    {
      shape: 'square',
      gain: 0.4,
      notes: [
        // 乐句一（起）：C-E-G-C 上行
        n('C4', 0.2), n('E4', 0.1), n('G4', 0.1), n('C5', 0.2),
        // 乐句二（承）：G-E-D-C 下行呼应
        n('G4', 0.2), n('E4', 0.1), n('D4', 0.1), n('C4', 0.2),
        // 乐句三（转）：级进上行小跑
        n('E4', 0.1), n('G4', 0.1), n('A4', 0.1), n('G4', 0.1),
        // 乐句四（合）：终止式
        n('F4', 0.1), n('E4', 0.1), n('D4', 0.1), n('C4', 0.1),
      ],
    },
    {
      shape: 'triangle',
      gain: 0.28,
      notes: [
        n('C3', 0.6), // 对应乐句一：I 级
        n('G3', 0.6), // 对应乐句二：V 级
        n('F3', 0.4), // 对应乐句三：IV 级
        n('G3', 0.4), // 对应乐句四：V→I 终止前导
      ],
    },
  ],
};

/** stageClear：C 大调音阶级进上行跑动，末音在主和弦（八度同音）长音收束，约 2.0s */
const STAGE_CLEAR: Jingle = {
  kind: 'stageClear',
  voices: [
    {
      shape: 'square',
      gain: 0.42,
      notes: [
        n('C4', 0.1), n('D4', 0.1), n('E4', 0.1), n('F4', 0.1), n('G4', 0.1),
        n('A4', 0.1), n('B4', 0.1), n('C5', 0.1), n('D5', 0.1), n('E5', 0.1),
        n('C6', 1.0), // 终点长音，胜利收束
      ],
    },
    {
      shape: 'triangle',
      gain: 0.26,
      notes: [
        n('C3', 0.25), n('E3', 0.25), n('G3', 0.25), n('C4', 0.25),
        n('C3', 1.0), // 与旋律终点同时值的低音大字组 C，稳固落地
      ],
    },
  ],
};

/** gameOver：A 自然小调级进下行，末两音时值翻倍形成"渐慢"收尾，约 2.5s */
const GAME_OVER: Jingle = {
  kind: 'gameOver',
  voices: [
    {
      shape: 'triangle',
      gain: 0.38,
      notes: [
        n('A4', 0.25), n('G4', 0.25), n('F4', 0.25), n('E4', 0.25), n('D4', 0.25), n('C4', 0.25),
        n('B3', 0.5), n('A3', 0.5),
      ],
    },
    {
      shape: 'triangle',
      gain: 0.22,
      notes: [
        n('A2', 1.25), // 主和弦根音铺底
        n('E2', 0.75), // 属和弦根音，制造下行终止式的张力
        n('A2', 0.5), // 回到主和弦根音收束
      ],
    },
  ],
};

export const JINGLES: Readonly<Record<JingleKind, Jingle>> = {
  stageStart: STAGE_START,
  stageClear: STAGE_CLEAR,
  gameOver: GAME_OVER,
};

/** 单个声部的总时长（各音符 dur 之和） */
function voiceDuration(voice: JingleVoice): number {
  return voice.notes.reduce((sum, note) => sum + note.dur, 0);
}

/** 整首 jingle 的总时长 = 各声部时长的最大值 */
export function jingleDuration(jingle: Jingle): number {
  return jingle.voices.reduce((max, voice) => Math.max(max, voiceDuration(voice)), 0);
}
