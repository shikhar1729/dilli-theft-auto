// Synthesised sound: engine, tyres, wind, boost, horns and a Delhi street hum.
// Everything is generated with Web Audio; no audio files are shipped.

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private windGain!: GainNode;
  private boostGain!: GainNode;
  private rumbleGain!: GainNode;
  private hornNodes: { gain: GainNode } | null = null;
  private noise!: AudioBuffer;
  private ambienceTimer = 2;
  muted = false;
  private rpm = 0.2;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Noise buffer shared by tyre, wind, boost and impacts.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Engine: two detuned oscillators through a low-pass filter.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 3;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    const gb = ctx.createGain(); gb.gain.value = 0.35;
    this.oscA.connect(this.engineFilter);
    this.oscB.connect(gb).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.oscA.start(); this.oscB.start();

    const loopNoise = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.squealGain = loopNoise('bandpass', 1500, 6);
    this.windGain = loopNoise('lowpass', 700, 0.7);
    this.boostGain = loopNoise('highpass', 2200, 0.8);
    this.rumbleGain = loopNoise('lowpass', 140, 1.2);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  /** Continuous sounds from the player's car. */
  update(dt: number, s: { speed: number; throttle: number; slip: number; boosting: boolean; grounded: boolean; active: boolean; rumble?: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Fake gearbox: rpm climbs within each gear band.
    const v = Math.abs(s.speed);
    const gears = [0, 9, 17, 26, 35, 46, 70];
    let g = 1;
    while (g < gears.length - 1 && v > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    const target = s.active ? 0.22 + 0.78 * Math.min(1, (v - lo) / (hi - lo)) * (0.6 + 0.4 * s.throttle) : 0.15;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
    const f = 48 + this.rpm * 120 + (s.boosting ? 22 : 0);
    this.oscA.frequency.setTargetAtTime(f, t, 0.03);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(380 + this.rpm * 1500, t, 0.05);
    this.engineGain.gain.setTargetAtTime(s.active ? 0.09 + s.throttle * 0.07 : 0.03, t, 0.08);
    const sq = s.grounded ? Math.min(1, Math.max(0, Math.abs(s.slip) - 3) / 8) : 0;
    this.squealGain.gain.setTargetAtTime(sq * 0.12, t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(0.16, (v * v) / 25000), t, 0.1);
    this.boostGain.gain.setTargetAtTime(s.boosting ? 0.06 : 0, t, 0.05);
    this.rumbleGain.gain.setTargetAtTime((s.rumble ?? 0) * 0.5, t, 0.2); // passing Metro trains

    // Distant Delhi horns now and then.
    this.ambienceTimer -= dt;
    if (this.ambienceTimer < 0) {
      this.ambienceTimer = 2.5 + Math.random() * 6;
      this.horn(0.025 + Math.random() * 0.03, 0.15 + Math.random() * 0.4, 0.8 + Math.random() * 0.5);
    }
  }

  private env(gain: number, attack: number, release: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    g.connect(this.master);
    return g;
  }

  /** Two-tone horn. Delhi's unofficial soundtrack. */
  horn(volume = 0.12, length = 0.35, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.env(volume, 0.01, length);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    f.connect(g);
    for (const hz of [392 * pitch, 494 * pitch]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz;
      o.connect(f); o.start(); o.stop(ctx.currentTime + length + 0.05);
    }
  }

  impact(strength: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.env(Math.min(0.5, 0.08 + strength * 0.02), 0.005, 0.35);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600 + strength * 30;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.connect(f).connect(g); src.start(); src.stop(ctx.currentTime + 0.4);
  }

  splash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.env(0.12, 0.02, 0.5);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.connect(f).connect(g); src.start(); src.stop(ctx.currentTime + 0.6);
  }

  tone(freqs: number[], step = 0.09, volume = 0.12, type: OscillatorType = 'sine') {
    const ctx = this.ctx;
    if (!ctx) return;
    freqs.forEach((hz, i) => {
      const t0 = ctx.currentTime + i * step;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      g.connect(this.master);
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz;
      o.connect(g); o.start(t0); o.stop(t0 + 0.4);
    });
  }

  checkpoint() { this.tone([880, 1175, 1568], 0.07, 0.1); }
  collect() { this.tone([1046, 1318, 1568, 2093], 0.06, 0.09, 'triangle'); }
  ring() { this.tone([660, 990, 1320], 0.05, 0.08, 'triangle'); }
  countdown(go: boolean) { this.tone([go ? 1046 : 523], 0.1, 0.15, 'square'); }
  finish() { this.tone([523, 659, 784, 1046, 784, 1046], 0.11, 0.12, 'triangle'); }
  kites() { this.tone([392, 523], 0.08, 0.06, 'triangle'); }
}
