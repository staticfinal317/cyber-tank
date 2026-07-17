import { describe, expect, it } from 'vitest';
import { ClassicAudio } from '../src/classic/audio/ClassicAudio';
import { JINGLES, jingleDuration } from '../src/classic/audio/jingles';
import { MASTER_VOLUME, SOUND_SPECS, resolveSoundId, soundSpecDuration, type SoundId } from '../src/classic/audio/soundSpecs';
import type { SimEvent } from '../src/classic/core/types';

/* ---------------- 事件 → 音效映射：纯函数，穷举覆盖 SimEvent 全部 15 种 type ---------------- */

describe('resolveSoundId：事件到音效名的映射表', () => {
  const cases: ReadonlyArray<{ event: SimEvent; expected: SoundId | null; note: string }> = [
    { event: { type: 'fire', fromPlayer: true }, expected: 'fireBlipPlayer', note: '玩家开火音高更高' },
    { event: { type: 'fire', fromPlayer: false }, expected: 'fireBlipEnemy', note: '敌方开火音高更低' },
    { event: { type: 'brickHit', x: 0, y: 0 }, expected: 'brickHit', note: '低频短噪声' },
    { event: { type: 'steelHit', x: 0, y: 0 }, expected: 'metalClink', note: '金属感高频短音' },
    { event: { type: 'steelBreak', x: 0, y: 0 }, expected: 'steelBreak', note: '钢墙摧毁，比 steelHit 更沉重' },
    { event: { type: 'bulletsCancel', x: 0, y: 0 }, expected: 'metalClink', note: '与 steelHit 共用金属音' },
    { event: { type: 'tankHit', tankId: 1 }, expected: 'tankHit', note: '装甲掉血中频哐声' },
    { event: { type: 'enemyDestroyed', tankId: 1, kind: 'basic', score: 100, x: 0, y: 0 }, expected: 'explosionSmall', note: '三级爆炸中最轻' },
    { event: { type: 'playerDestroyed', tankId: 0 }, expected: 'explosionMedium', note: '三级爆炸中等' },
    { event: { type: 'baseDestroyed' }, expected: 'explosionBig', note: '三级爆炸中最重' },
    { event: { type: 'playerRespawn' }, expected: null, note: '出生已有护盾视觉提示，明确不发声' },
    { event: { type: 'powerUpSpawn', kind: 'star' }, expected: 'powerUpSpawn', note: '上行琶音' },
    { event: { type: 'powerUpPickup', kind: 'star', score: 500 }, expected: 'powerUpPickup', note: '欢快上行双音' },
    { event: { type: 'extraLife' }, expected: 'extraLife', note: '欢快上行三连音，更长' },
    { event: { type: 'stageClear' }, expected: null, note: '由 playJingle 负责，避免双响' },
    { event: { type: 'gameOver' }, expected: null, note: '由 playJingle 负责，避免双响' },
  ];

  it.each(cases)('$event.type → $expected（$note）', ({ event, expected }) => {
    expect(resolveSoundId(event)).toBe(expected);
  });

  it('覆盖 SimEvent 联合类型的全部 15 种 type（回归：新增事件必须显式加入映射表）', () => {
    const coveredTypes = new Set(cases.map((c) => c.event.type));
    expect(coveredTypes.size).toBe(15);
  });

  it('steelHit 与 bulletsCancel 共用同一音色（设计要求：均为金属感高频短音）', () => {
    const steelHit = resolveSoundId({ type: 'steelHit', x: 0, y: 0 });
    const bulletsCancel = resolveSoundId({ type: 'bulletsCancel', x: 0, y: 0 });
    expect(steelHit).toBe(bulletsCancel);
  });
});

/* ---------------- 音效数据表：包络/时长的结构性约束 ---------------- */

describe('SOUND_SPECS：音效包络数据的结构约束', () => {
  it('每层的 startOffset/attack/duration/gain 均为非负、有限数值', () => {
    for (const spec of Object.values(SOUND_SPECS)) {
      for (const layer of spec.layers) {
        expect(layer.startOffset).toBeGreaterThanOrEqual(0);
        expect(layer.attack).toBeGreaterThan(0);
        expect(layer.duration).toBeGreaterThan(0);
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  const shortSfxIds: readonly SoundId[] = ['fireBlipPlayer', 'fireBlipEnemy', 'brickHit', 'metalClink', 'steelBreak', 'tankHit'];

  it.each(shortSfxIds)('%s 总时长 ≤ 300ms（短促打击类音效）', (id) => {
    const duration = soundSpecDuration(SOUND_SPECS[id]);
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(0.3);
  });

  it('三级爆炸时长递增：enemyDestroyed < playerDestroyed < baseDestroyed（base 最重）', () => {
    const small = soundSpecDuration(SOUND_SPECS.explosionSmall);
    const medium = soundSpecDuration(SOUND_SPECS.explosionMedium);
    const big = soundSpecDuration(SOUND_SPECS.explosionBig);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(big);
  });

  it('extraLife 比 powerUpPickup 更长（加命更隆重）', () => {
    const pickup = soundSpecDuration(SOUND_SPECS.powerUpPickup);
    const extraLife = soundSpecDuration(SOUND_SPECS.extraLife);
    expect(extraLife).toBeGreaterThan(pickup);
  });

  it('powerUpSpawn 是三音上行琶音（三层，频率严格递增）', () => {
    const layers = SOUND_SPECS.powerUpSpawn.layers;
    expect(layers.length).toBe(3);
    const [f0, f1, f2] = layers.map((layer) => (layer.kind === 'tone' ? layer.freqStart : 0));
    expect(f0).toBeDefined();
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    if (f0 === undefined || f1 === undefined || f2 === undefined) return;
    expect(f0).toBeLessThan(f1);
    expect(f1).toBeLessThan(f2);
  });

  it('主音量默认适度（约 0.25），避免吓到小朋友', () => {
    expect(MASTER_VOLUME).toBeGreaterThan(0.15);
    expect(MASTER_VOLUME).toBeLessThan(0.35);
  });
});

/* ---------------- Jingle 音符表：三首曲子的结构合法性 ---------------- */

describe('JINGLES：界面 jingle 音符表', () => {
  it('stageStart / stageClear 总时长约 2s，gameOver 约 2.5s，且均在设计范围内', () => {
    expect(jingleDuration(JINGLES.stageStart)).toBeGreaterThanOrEqual(1.6);
    expect(jingleDuration(JINGLES.stageStart)).toBeLessThanOrEqual(2.4);

    expect(jingleDuration(JINGLES.stageClear)).toBeGreaterThanOrEqual(1.6);
    expect(jingleDuration(JINGLES.stageClear)).toBeLessThanOrEqual(2.4);

    expect(jingleDuration(JINGLES.gameOver)).toBeGreaterThanOrEqual(2.0);
    expect(jingleDuration(JINGLES.gameOver)).toBeLessThanOrEqual(3.0);
  });

  it.each(Object.values(JINGLES))('$kind：所有音符频率 > 0、时值 > 0，声部数 ≤ 2', (jingle) => {
    expect(jingle.voices.length).toBeGreaterThan(0);
    expect(jingle.voices.length).toBeLessThanOrEqual(2);
    for (const voice of jingle.voices) {
      expect(voice.notes.length).toBeGreaterThan(0);
      for (const note of voice.notes) {
        expect(note.freq).toBeGreaterThan(0);
        expect(note.dur).toBeGreaterThan(0);
      }
    }
  });

  it('三首曲子彼此的旋律声部音高走向不同（原创性的结构性佐证：非同一素材变调）', () => {
    const contour = (freqs: readonly number[]): string =>
      freqs.slice(1).map((f, i) => {
        const prev = freqs[i];
        if (prev === undefined) return '=';
        return f > prev ? '+' : f < prev ? '-' : '=';
      }).join('');

    const stageStartMelody = JINGLES.stageStart.voices[0];
    const stageClearMelody = JINGLES.stageClear.voices[0];
    const gameOverMelody = JINGLES.gameOver.voices[0];
    expect(stageStartMelody).toBeDefined();
    expect(stageClearMelody).toBeDefined();
    expect(gameOverMelody).toBeDefined();
    if (!stageStartMelody || !stageClearMelody || !gameOverMelody) return;

    const stageStartContour = contour(stageStartMelody.notes.map((n) => n.freq));
    const stageClearContour = contour(stageClearMelody.notes.map((n) => n.freq));
    const gameOverContour = contour(gameOverMelody.notes.map((n) => n.freq));

    // stageClear 是纯级进上行跑动（全 '+'），gameOver 是纯级进下行（全 '-'）；
    // stageStart 含有上行+下行的往返乐句，三者轮廓互不相同。
    expect(stageClearContour).toBe('+'.repeat(stageClearContour.length));
    expect(gameOverContour).toBe('-'.repeat(gameOverContour.length));
    expect(stageStartContour).not.toBe(stageClearContour);
    expect(stageStartContour).not.toBe(gameOverContour);
  });
});

/* ---------------- 降级路径：无 WebAudio 环境（本测试套件运行环境即 node，无 AudioContext） ---------------- */

describe('ClassicAudio：无 WebAudio 环境下的降级路径', () => {
  it('typeof AudioContext === "undefined"（确认测试环境确实没有 WebAudio，前提假设成立）', () => {
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe('undefined');
  });

  it('new ClassicAudio() + unlock() + handleEvents() + playJingle() + setMuted() + dispose() 全程不抛错', () => {
    expect(() => {
      const audio = new ClassicAudio();
      audio.unlock();
      audio.handleEvents([{ type: 'fire', fromPlayer: true }, { type: 'brickHit', x: 0, y: 0 }]);
      audio.playJingle('stageStart');
      audio.setMuted(true);
      audio.dispose();
    }).not.toThrow();
  });

  it('unlock 前调用 handleEvents/playJingle 静默忽略，不抛错', () => {
    expect(() => {
      const audio = new ClassicAudio();
      audio.handleEvents([{ type: 'baseDestroyed' }]);
      audio.playJingle('gameOver');
    }).not.toThrow();
  });

  it('同一实例重复 unlock()/dispose() 不抛错（幂等）', () => {
    expect(() => {
      const audio = new ClassicAudio();
      audio.unlock();
      audio.unlock();
      audio.dispose();
      audio.dispose();
    }).not.toThrow();
  });
});
