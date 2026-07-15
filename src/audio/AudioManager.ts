import type { SeasonId, WeatherId } from '../core/types';

interface AmbientProfile {
  filter: BiquadFilterType;
  frequency: number;
  noise: number;
  pad: number;
  notes: [number, number];
}

export const AMBIENT_PROFILES: Record<SeasonId, AmbientProfile> = {
  spring: { filter: 'bandpass', frequency: 1650, noise: .015, pad: .008, notes: [196, 293.66] },
  summer: { filter: 'lowpass', frequency: 620, noise: .025, pad: .011, notes: [73.42, 110] },
  autumn: { filter: 'bandpass', frequency: 940, noise: .021, pad: .007, notes: [146.83, 220] },
  winter: { filter: 'highpass', frequency: 2100, noise: .012, pad: .009, notes: [329.63, 493.88] },
};

interface AmbientLayer {
  season: SeasonId;
  weather: WeatherId;
  master: GainNode;
  noiseGain: GainNode;
  filter: BiquadFilterNode;
  source: AudioBufferSourceNode;
  pads: OscillatorNode[];
  padGains: GainNode[];
}

export class AudioManager {
  private context?: AudioContext;
  private ambient?: AmbientLayer;
  private ambientWarningAt = -10;
  private _enabled = true;
  private musicEnabled = true;
  private masterVolume = .55;
  private output?: GainNode;

  get enabled(): boolean { return this._enabled; }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this.context && this.ambient) this.ambient.master.gain.setTargetAtTime(this.musicEnabled ? 1 : .0001, this.context.currentTime, .12);
  }

  setPreferences(music: boolean, sfx: boolean, masterVolume: number): void {
    this.musicEnabled = music; this._enabled = sfx; this.masterVolume = Math.max(0, Math.min(1, masterVolume));
    if (this.context && this.output) this.output.gain.setTargetAtTime(this.masterVolume, this.context.currentTime, .08);
    if (this.context && this.ambient) this.ambient.master.gain.setTargetAtTime(music ? 1 : .0001, this.context.currentTime, .12);
  }

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext(); this.output = this.context.createGain(); this.output.gain.value = this.masterVolume; this.output.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setExpeditionAmbience(season: SeasonId, weather: WeatherId): void {
    this.unlock();
    if (!this.context) return;
    if (this.ambient?.season === season && this.ambient.weather === weather) return;
    this.stopAmbience(.12);
    const context = this.context; const profile = AMBIENT_PROFILES[season]; const now = context.currentTime;
    const master = context.createGain(); master.gain.setValueAtTime(.0001, now); master.gain.exponentialRampToValueAtTime(this.musicEnabled ? 1 : .0001, now + .7); master.connect(this.output ?? context.destination);
    const noiseGain = context.createGain(); noiseGain.gain.value = profile.noise;
    const filter = context.createBiquadFilter(); filter.type = profile.filter; filter.frequency.value = profile.frequency; filter.Q.value = season === 'autumn' ? .9 : .45;
    const source = context.createBufferSource(); source.buffer = this.createLoopNoise(context); source.loop = true;
    source.connect(filter).connect(noiseGain).connect(master); source.start();
    const pads = profile.notes.map((note, index) => {
      const osc = context.createOscillator(); const gain = context.createGain();
      osc.type = index === 0 ? 'sine' : 'triangle'; osc.frequency.value = note; osc.detune.value = index ? 7 : -5;
      gain.gain.value = profile.pad * (index ? .42 : 1); osc.connect(gain).connect(master); osc.start();
      return { osc, gain };
    });
    this.ambient = { season, weather, master, noiseGain, filter, source, pads: pads.map((item) => item.osc), padGains: pads.map((item) => item.gain) };
  }

  updateAmbience(intensity: number, warning: boolean): void {
    if (!this.context || !this.ambient) return;
    const now = this.context.currentTime; const profile = AMBIENT_PROFILES[this.ambient.season]; const mix = Math.max(0, Math.min(1, intensity));
    this.ambient.noiseGain.gain.setTargetAtTime(profile.noise * (.55 + mix * .75), now, .8);
    this.ambient.filter.frequency.setTargetAtTime(profile.frequency * (.82 + mix * .48), now, 1.1);
    this.ambient.padGains.forEach((gain, index) => gain.gain.setTargetAtTime(profile.pad * (index ? .42 : 1) * (1 - mix * .24), now, 1.2));
    if (warning && now - this.ambientWarningAt > 4.5) {
      this.ambientWarningAt = now;
      this.noise(.55, .022 + mix * .018, 260);
      if (this.ambient.season === 'summer') this.tone(88, 42, .75, 'sine', .022);
      if (this.ambient.season === 'winter') this.tone(880, 420, .32, 'triangle', .014);
    }
  }

  stopAmbience(fade = .45): void {
    if (!this.context || !this.ambient) return;
    const layer = this.ambient; const now = this.context.currentTime; this.ambient = undefined;
    layer.master.gain.cancelScheduledValues(now); layer.master.gain.setTargetAtTime(.0001, now, Math.max(.03, fade / 4));
    window.setTimeout(() => {
      try { layer.source.stop(); layer.pads.forEach((pad) => pad.stop()); } catch { /* already stopped */ }
      layer.master.disconnect();
    }, Math.ceil(fade * 1000) + 120);
  }

  shot(pitch = 1): void { this.tone(120 * pitch, 260 * pitch, .045, 'sawtooth', .028); }
  hit(heavy = false): void { this.noise(heavy ? .18 : .07, heavy ? .08 : .035); }
  pickup(): void {
    this.tone(520, 850, .09, 'sine', .04);
    window.setTimeout(() => this.tone(780, 1080, .1, 'sine', .035), 55);
  }
  ability(): void { this.tone(180, 680, .22, 'triangle', .045); }
  wave(): void { this.tone(260, 520, .16, 'square', .025); }

  private createLoopNoise(context: AudioContext): AudioBuffer {
    const length = context.sampleRate * 3; const buffer = context.createBuffer(1, length, context.sampleRate); const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) { const white = Math.random() * 2 - 1; last = last * .985 + white * .015; data[i] = last * 4.2; }
    return buffer;
  }

  private tone(from: number, to: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this._enabled || !this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator(); const gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain).connect(this.output ?? this.context.destination); osc.start(now); osc.stop(now + duration);
  }

  private noise(duration: number, volume: number, frequency = 850): void {
    if (!this._enabled || !this.context) return;
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.context.createBufferSource(); const filter = this.context.createBiquadFilter(); const gain = this.context.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = frequency; gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.output ?? this.context.destination); source.start();
  }
}
