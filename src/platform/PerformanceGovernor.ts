export type RenderQuality = 'high' | 'balanced' | 'battery';
export type QualitySetting = RenderQuality | 'auto';
export interface PerformanceSnapshot { fps: number; p95Ms: number; worstMs: number; longFrameRate: number; samples: number }

const DOWN: Record<RenderQuality, RenderQuality> = { high: 'balanced', balanced: 'battery', battery: 'battery' };
const UP: Record<RenderQuality, RenderQuality> = { high: 'high', balanced: 'high', battery: 'balanced' };

/** Small, deterministic quality governor. It reacts to sustained frame cost, never to a single spike. */
export class PerformanceGovernor {
  level: RenderQuality;
  fps = 60;
  private samples: number[] = [];
  private history: number[] = [];
  private cooldown = 0;

  constructor(private setting: QualitySetting = 'auto') {
    this.level = setting === 'auto' ? 'balanced' : setting;
  }

  setSetting(setting: QualitySetting): RenderQuality {
    this.setting = setting;
    this.samples = [];
    this.history = [];
    this.cooldown = 0;
    this.level = setting === 'auto' ? 'balanced' : setting;
    return this.level;
  }

  sample(frameSeconds: number): RenderQuality | undefined {
    const dt = Math.max(1 / 240, Math.min(.1, frameSeconds));
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.samples.push(dt);
    this.history.push(dt);
    if (this.history.length > 1800) this.history.splice(0, this.history.length - 1800);
    if (this.samples.length < 72) return undefined;

    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples = [];
    this.fps = Math.round(1 / average);
    if (this.setting !== 'auto' || this.cooldown > 0) return undefined;

    const next = average > 1 / 43 ? DOWN[this.level] : average < 1 / 57 ? UP[this.level] : this.level;
    if (next === this.level) return undefined;
    this.level = next;
    this.cooldown = 2.5;
    return next;
  }

  snapshot(): PerformanceSnapshot {
    if (!this.history.length) return { fps: this.fps, p95Ms: 0, worstMs: 0, longFrameRate: 0, samples: 0 };
    const sorted = [...this.history].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0;
    const worst = sorted[sorted.length - 1] ?? 0;
    const long = this.history.filter((value) => value > .025).length;
    return { fps: this.fps, p95Ms: Math.round(p95 * 10000) / 10, worstMs: Math.round(worst * 10000) / 10, longFrameRate: Math.round(long / this.history.length * 1000) / 10, samples: this.history.length };
  }
}
