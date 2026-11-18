/**
 * Áudio procedural com Web Audio API.
 * Para substituir qualquer efeito por um arquivo, use loadSample('nome', 'caminho.ogg'):
 * play('nome') passa a tocar o arquivo em vez do sintetizador.
 */
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.samples = new Map();
    this.lastPlayed = new Map();
    this.engine = null;

    this.synth = {
      menu: () => this._tone({ freq: 660, to: 990, dur: 0.09, type: 'square', vol: 0.18 }),
      back: () => this._tone({ freq: 520, to: 330, dur: 0.1, type: 'square', vol: 0.16 }),
      count: () => this._tone({ freq: 440, dur: 0.22, type: 'square', vol: 0.3 }),
      go: () => {
        this._tone({ freq: 880, dur: 0.6, type: 'square', vol: 0.3 });
        this._tone({ freq: 1320, dur: 0.6, type: 'sawtooth', vol: 0.12 });
      },
      boost: () => {
        this._noise({ dur: 0.7, vol: 0.4, freq: 500, to: 5000, q: 1.2 });
        this._tone({ freq: 180, to: 760, dur: 0.55, type: 'sawtooth', vol: 0.2 });
      },
      pad: () => {
        this._noise({ dur: 0.5, vol: 0.35, freq: 900, to: 7000, q: 1.5 });
        this._tone({ freq: 330, to: 1320, dur: 0.35, type: 'triangle', vol: 0.28 });
      },
      collision: ({ intensity = 0.5 } = {}) => {
        this._noise({ dur: 0.18 + intensity * 0.2, vol: 0.25 + intensity * 0.5, freq: 1800, to: 200, q: 0.7 });
        this._tone({ freq: 110, to: 40, dur: 0.22, type: 'sine', vol: 0.3 + intensity * 0.4 });
      },
      scrape: () => this._noise({ dur: 0.12, vol: 0.14, freq: 3200, to: 2200, q: 3 }),
      explosion: () => {
        this._noise({ dur: 1.1, vol: 0.8, freq: 1200, to: 60, q: 0.5 });
        this._tone({ freq: 90, to: 25, dur: 0.9, type: 'sawtooth', vol: 0.45 });
      },
      checkpoint: () => {
        this._tone({ freq: 880, dur: 0.09, type: 'triangle', vol: 0.3 });
        this._tone({ freq: 1320, dur: 0.16, type: 'triangle', vol: 0.3, delay: 0.09 });
      },
      lap: () => [660, 880, 1100, 1320].forEach((f, i) => this._tone({ freq: f, dur: 0.14, type: 'square', vol: 0.2, delay: i * 0.08 })),
      finish: () => [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.3, delay: i * 0.12 })),
      recharge: () => this._tone({ freq: 500, to: 1000, dur: 0.14, type: 'sine', vol: 0.2 }),
      alarm: () => this._tone({ freq: 980, to: 700, dur: 0.16, type: 'square', vol: 0.2 }),
      jump: () => this._tone({ freq: 240, to: 620, dur: 0.25, type: 'sine', vol: 0.3 }),
      land: () => this._tone({ freq: 140, to: 60, dur: 0.16, type: 'sine', vol: 0.4 }),
      fall: () => this._tone({ freq: 700, to: 90, dur: 0.9, type: 'sawtooth', vol: 0.2 }),
    };
  }

  /** Deve ser chamado a partir de um gesto do usuário (política de autoplay dos navegadores). */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.engineBus = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        const comp = this.ctx.createDynamicsCompressor();
        this.sfxBus.connect(this.master);
        this.engineBus.connect(this.master);
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.noiseBuffer = this._makeNoise();
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
    } catch (err) {
      console.warn('Áudio indisponível:', err);
      this.ctx = null;
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.sfxBus.gain.value = s.sfx;
    this.engineBus.gain.value = s.engine;
    this.musicBus.gain.value = s.music;
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) this.ctx.suspend();
    else this.ctx.resume();
  }

  async loadSample(name, url) {
    if (!this.ctx) this.unlock();
    if (!this.ctx) return false;
    try {
      const data = await (await fetch(url)).arrayBuffer();
      this.samples.set(name, await this.ctx.decodeAudioData(data));
      return true;
    } catch (err) {
      console.warn(`Falha ao carregar o som "${name}":`, err);
      return false;
    }
  }

  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = opts.minGap ?? 0.04;
    if (now - (this.lastPlayed.get(name) ?? -1) < gap) return;
    this.lastPlayed.set(name, now);

    const sample = this.samples.get(name);
    if (sample) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample;
      const gain = this.ctx.createGain();
      gain.gain.value = opts.volume ?? 1;
      src.connect(gain).connect(this.sfxBus);
      src.start();
      return;
    }
    this.synth[name]?.(opts);
  }

  // ---------------------------------------------------------------- motor

  startEngine() {
    if (!this.ctx || this.engine) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 4;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 5;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuffer;
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 2400;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;

    osc1.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(out);
    hiss.connect(hissFilter).connect(hissGain).connect(out);
    out.connect(this.engineBus);
    for (const node of [osc1, osc2, lfo, hiss]) node.start();
    this.engine = { out, filter, osc1, osc2, lfo, hiss, hissGain, hissFilter };
  }

  updateEngine(speedN, throttle, boosting) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    const freq = 52 + speedN * 210 + (boosting ? 40 : 0);
    e.osc1.frequency.setTargetAtTime(freq, t, 0.06);
    e.osc2.frequency.setTargetAtTime(freq * 0.502, t, 0.06);
    e.filter.frequency.setTargetAtTime(280 + speedN * 2200 + throttle * 500, t, 0.08);
    e.out.gain.setTargetAtTime(0.1 + throttle * 0.08 + speedN * 0.06, t, 0.1);
    e.hissGain.gain.setTargetAtTime(boosting ? 0.55 : speedN * 0.12, t, 0.08);
    e.hissFilter.frequency.setTargetAtTime(1500 + speedN * 3500, t, 0.1);
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    try {
      e.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      const stopAt = this.ctx.currentTime + 0.3;
      for (const node of [e.osc1, e.osc2, e.lfo, e.hiss]) node.stop(stopAt);
    } catch { /* contexto já encerrado */ }
  }

  // ---------------------------------------------------------------- síntese

  _makeNoise() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _tone({ freq, to, dur = 0.2, type = 'sine', vol = 0.3, delay = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.3, vol = 0.3, freq = 1000, to, q = 1, delay = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t0);
    if (to) filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }
}
