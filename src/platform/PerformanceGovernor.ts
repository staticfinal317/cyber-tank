export type RenderQuality = 'high' | 'balanced' | 'battery';
export type QualitySetting = RenderQuality | 'auto';

const DOWN: Record<RenderQuality, RenderQuality> = { high: 'balanced', balanced: 'battery', battery: 'battery' };
const UP: Record<RenderQuality, RenderQuality> = { high: 'high', balanced: 'high', battery: 'balanced' };

/** Small, deterministic quality governor. It reacts to sustained frame cost, never to a single spike. */
export class PerformanceGovernor {
  level: RenderQuality;
  fps = 60;
  private samples: number[] = [];
  private cooldown = 0;

  constructor(private setting: QualitySetting = 'auto') {
    this.level = setting === 'auto' ? 'balanced' : setting;
  }

  setSetting(setting: QualitySetting): RenderQuality {
    this.setting = setting;
    this.samples = [];
    this.cooldown = 0;
    this.level = setting === 'auto' ? 'balanced' : setting;
    return this.level;
  }

  sample(frameSeconds: number): RenderQuality | undefined {
    const dt = Math.max(1 / 240, Math.min(.1, frameSeconds));
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.samples.push(dt);
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
}
