export class AudioManager {
  private context?: AudioContext;
  enabled = true;

  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  shot(pitch = 1): void { this.tone(120 * pitch, 260 * pitch, .045, 'sawtooth', .028); }
  hit(heavy = false): void { this.noise(heavy ? .18 : .07, heavy ? .08 : .035); }
  pickup(): void {
    this.tone(520, 850, .09, 'sine', .04);
    window.setTimeout(() => this.tone(780, 1080, .1, 'sine', .035), 55);
  }
  ability(): void { this.tone(180, 680, .22, 'triangle', .045); }
  wave(): void { this.tone(260, 520, .16, 'square', .025); }

  private tone(from: number, to: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator(); const gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain).connect(this.context.destination); osc.start(now); osc.stop(now + duration);
  }

  private noise(duration: number, volume: number): void {
    if (!this.enabled || !this.context) return;
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.context.createBufferSource(); const filter = this.context.createBiquadFilter(); const gain = this.context.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 850; gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.context.destination); source.start();
  }
}
