/** Tiny Web Audio synth: every sound is generated, no assets to load. */

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  delay?: number;
}

export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture at least once (autoplay policy). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private ready(): AudioContext | null {
    return this.enabled && this.ctx && this.master && this.ctx.state === 'running'
      ? this.ctx
      : null;
  }

  private tone(freq: number, dur: number, opts: ToneOpts = {}): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    const peak = opts.gain ?? 0.3;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, from: number, to: number, peak = 0.25, delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  click(): void {
    this.tone(520, 0.04, { type: 'triangle', gain: 0.15 });
  }

  select(): void {
    this.tone(700, 0.06, { type: 'triangle', gain: 0.2, slideTo: 880 });
  }

  /** Pop + whoosh. `combo` raises the pitch a semitone per clean launch in a row. */
  launch(combo = 0): void {
    const f = 440 * Math.pow(2, Math.min(combo, 14) / 12);
    this.tone(f, 0.12, { type: 'sine', gain: 0.35, slideTo: f * 1.9 });
    this.noise(0.34, 500, 3200, 0.2, 0.03);
  }

  bonk(): void {
    this.tone(150, 0.2, { type: 'square', gain: 0.28, slideTo: 60, delay: 0.1 });
    this.noise(0.1, 900, 200, 0.25, 0.1);
  }

  undo(): void {
    this.tone(620, 0.14, { type: 'triangle', gain: 0.22, slideTo: 310 });
  }

  hint(): void {
    this.tone(880, 0.1, { gain: 0.2 });
    this.tone(1320, 0.16, { gain: 0.2, delay: 0.09 });
  }

  star(index: number): void {
    this.tone([784, 988, 1319][index] ?? 1319, 0.22, { type: 'triangle', gain: 0.3 });
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.26, { type: 'triangle', gain: 0.28, delay: i * 0.09 }),
    );
  }

  lose(): void {
    [392, 330, 262].forEach((f, i) =>
      this.tone(f, 0.3, { type: 'sawtooth', gain: 0.16, delay: i * 0.16 }),
    );
  }
}
