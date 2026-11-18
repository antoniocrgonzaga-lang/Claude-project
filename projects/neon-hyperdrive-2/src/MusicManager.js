import { SONGS } from './Songs.js';

const PITCH = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7, 12], 7: [0, 4, 7, 10], 9: [0, 4, 7, 10, 14],
  maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
  sus2: [0, 2, 7], sus4: [0, 5, 7],
};
const LOOKAHEAD = 0.35;
const TICK_MS = 50;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function noteToMidi(name) {
  const m = /^([a-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Nota inválida: ${name}`);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function parseChord(symbol) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  const iv = m && QUALITY[m[3]];
  if (!iv) throw new Error(`Acorde inválido: ${symbol}`);
  const pc = (PITCH[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { pc, iv, bass: 28 + ((pc - 4 + 12) % 12), mid: 48 + pc };
}

function parsePhrase(bars) {
  const events = new Map();
  let step = 0;
  bars.forEach((bar, i) => {
    let used = 0;
    for (const token of bar.trim().split(/\s+/)) {
      const [name, lenText] = token.split(':');
      const len = Number(lenText);
      if (name !== '-') events.set(step + used, { midi: noteToMidi(name), len });
      used += len;
    }
    if (used !== 16) console.warn(`[música] compasso ${i + 1} soma ${used} passos (esperado 16): ${bar}`);
    step += 16;
  });
  return { events, total: step };
}

function compile(song) {
  const phrases = {};
  for (const [name, bars] of Object.entries(song.phrases || {})) phrases[name] = parsePhrase(bars);
  const prog = song.prog.map(parseChord);
  let start = 0;
  const sections = song.sections.map((sec) => {
    const out = {
      ...sec, start,
      on: new Set(sec.layers),
      chords: sec.prog ? sec.prog.map(parseChord) : prog,
      phrase: sec.lead ? phrases[sec.lead] : null,
      kit: song.drums[sec.drums || 'main'],
    };
    start += sec.bars;
    return out;
  });
  return { def: song, sections, totalBars: start };
}

/**
 * Trilha sonora procedural: sequenciador de passos com agendamento antecipado sobre a Web Audio API.
 * Nenhum arquivo de áudio é usado; todos os instrumentos são sintetizados.
 */
export class MusicManager {
  constructor(audio) {
    this.audio = audio;
    this.compiled = new Map();
    this.desired = null;
    this.current = null;
    this.tempoScale = 1;
    this.timer = null;
    this.impulse = null;
  }

  /** Escolhe a música; a troca acontece assim que o áudio estiver liberado. */
  play(id) {
    this.desired = SONGS[id] ? id : null;
    this.tempoScale = 1;
    this.start();
  }

  setTempoScale(scale) { this.tempoScale = scale; }

  start() {
    if (this.timer || !this.audio.ctx) return;
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  _tick() {
    const ctx = this.audio.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.desired !== this.current?.id) this._switch(this.desired);
    const cur = this.current;
    if (!cur) return;
    const now = ctx.currentTime;
    if (cur.nextTime < now - 0.1) cur.nextTime = now + 0.05;
    while (cur.nextTime < now + LOOKAHEAD) {
      const stepDur = 60 / (cur.song.def.bpm * this.tempoScale) / 4;
      const swing = cur.step % 2 === 1 ? (cur.song.def.swing || 0) * stepDur : 0;
      try {
        this._scheduleStep(cur, cur.step, cur.nextTime + swing, stepDur);
      } catch (err) {
        console.error('[música]', err);
        this.desired = null;
        return;
      }
      cur.nextTime += stepDur;
      cur.step++;
    }
  }

  _switch(id) {
    const ctx = this.audio.ctx;
    const old = this.current;
    if (old) {
      old.out.gain.cancelScheduledValues(ctx.currentTime);
      old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      setTimeout(() => { try { old.out.disconnect(); } catch { /* já desconectado */ } }, 1500);
    }
    this.current = id ? this._createState(id, ctx, this.audio.musicBus) : null;
  }

  _createState(id, ctx, destination) {
    if (!this.compiled.has(id)) this.compiled.set(id, compile(SONGS[id]));
    const song = this.compiled.get(id);
    const def = song.def;

    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.setTargetAtTime(0.55 * (def.volume ?? 1), ctx.currentTime, 0.25);
    out.connect(destination);

    // Eco sincronizado (colcheia pontuada) e reverberação por convolução.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = (60 / def.bpm) * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 2600;
    delay.connect(delayTone).connect(feedback).connect(delay);
    delayTone.connect(out);

    const reverb = ctx.createConvolver();
    reverb.buffer = this._impulse(ctx);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.55;
    reverb.connect(reverbGain).connect(out);

    // Cadeia de distorção compartilhada pelas guitarras.
    let dist = null;
    if (def.guitar) {
      dist = ctx.createGain();
      dist.gain.value = 5;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 3.2);
      shaper.curve = curve;
      shaper.oversample = '2x';
      const cabLow = ctx.createBiquadFilter();
      cabLow.type = 'lowpass';
      cabLow.frequency.value = 3600;
      const cabHigh = ctx.createBiquadFilter();
      cabHigh.type = 'highpass';
      cabHigh.frequency.value = 110;
      const level = ctx.createGain();
      level.gain.value = 0.2;
      dist.connect(shaper).connect(cabLow).connect(cabHigh).connect(level).connect(out);
      const room = ctx.createGain();
      room.gain.value = 0.12;
      level.connect(room).connect(reverb);
    }

    return { id, song, ctx, out, delay, reverb, dist, step: 0, nextTime: ctx.currentTime + 0.08, noise: this.audio.noiseBuffer };
  }

  _impulse(ctx) {
    if (this.impulse && this.impulse.sampleRate === ctx.sampleRate) return this.impulse;
    const length = Math.floor(ctx.sampleRate * 1.7);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    this.impulse = buffer;
    return buffer;
  }

  // ---------------------------------------------------------------- sequenciador

  _scheduleStep(S, globalStep, t, d) {
    const { song } = S;
    const def = song.def;
    const sb = globalStep % 16;
    const bar = Math.floor(globalStep / 16) % song.totalBars;
    let sec = song.sections[0];
    for (const s of song.sections) if (bar >= s.start) sec = s;
    const barIn = bar - sec.start;
    const chord = sec.chords[barIn % sec.chords.length];
    const on = sec.on;

    if (on.has('drums')) {
      const kit = sec.kit;
      const fill = barIn === sec.bars - 1 && sb >= 12;
      if (barIn === 0 && sb === 0 && bar !== 0) this._crash(S, t);
      if (kit.kick[sb] !== '.') this._kick(S, t, 1);
      if (fill) {
        if (sb % 2 === 0 || def.bpm < 150) this._tom(S, t, 0.5 + (sb - 12) * 0.1, 190 - (sb - 12) * 22);
      } else if (kit.snare[sb] !== '.') {
        this._snare(S, t, kit.snare[sb] === 'X' ? 1 : 0.6);
      }
      const h = kit.hat[sb];
      if (h !== '.') this._hat(S, t, (sb % 4 === 0 ? 1 : 0.6) * (def.hatLevel ?? 1), h === 'o');
    }

    if (on.has('bass')) {
      const iv = (sec.bass || def.bass.pattern)[sb];
      if (iv != null) this._bass(S, t, chord.bass + iv, d * def.bass.len, def.bass.tone);
    }

    if (on.has('pad') && sb === 0) this._pad(S, t, chord.iv.map((i) => chord.mid + i), d * 16, def.pad?.volume ?? 0.8);

    if (on.has('keys')) {
      const r = def.keys.rhythm[sb];
      if (r !== '.') {
        const notes = chord.iv.map((i) => chord.mid + 12 + i);
        const len = d * def.keys.len * (r === 'X' ? 1.6 : 1);
        if (def.keys.voice === 'epiano') this._epiano(S, t, notes, len, def.keys.volume * (r === 'X' ? 1 : 0.75));
        else this._organ(S, t, notes, len, def.keys.volume);
      }
    }

    if (on.has('arp')) {
      const idx = def.arp.pattern[sb];
      if (idx != null) {
        const n = chord.iv.length;
        const midi = chord.mid + 12 + chord.iv[idx % n] + 12 * Math.floor(idx / n);
        this._pluck(S, t, midi, d * 0.9, def.arp.volume);
      }
    }

    if (on.has('guitar')) {
      const r = (sec.guitar || def.guitar.rhythm)[sb];
      if (r !== '.') this._guitar(S, t, chord.bass + 12, r === 'X' ? d * (sec.guitar ? 7 : 1.9) : d * 0.55);
    }

    if (on.has('lead') && sec.phrase) {
      const ev = sec.phrase.events.get((barIn * 16 + sb) % sec.phrase.total);
      if (ev) {
        this._lead(S, t, ev.midi, ev.len * d, def.lead.voice, def.lead.volume);
        if (def.lead.harmony) this._lead(S, t, ev.midi + def.lead.harmony, ev.len * d, def.lead.voice, def.lead.volume * 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- instrumentos

  _osc(S, type, freq, t, stop, detune = 0) {
    const o = S.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start(t);
    o.stop(stop);
    return o;
  }

  /** Envelope de ganho: ataque linear, sustentação e queda exponencial. */
  _env(S, t, peak, attack, hold, release) {
    const g = S.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  _noise(S, t, dur, type, freq, peak, q = 0.7) {
    const src = S.ctx.createBufferSource();
    src.buffer = S.noise;
    const filter = S.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this._env(S, t, peak, 0.001, 0, dur);
    src.connect(filter).connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return g;
  }

  _send(S, node, delay = 0, reverb = 0) {
    node.connect(S.out);
    if (delay > 0) {
      const g = S.ctx.createGain();
      g.gain.value = delay;
      node.connect(g).connect(S.delay);
    }
    if (reverb > 0) {
      const g = S.ctx.createGain();
      g.gain.value = reverb;
      node.connect(g).connect(S.reverb);
    }
  }

  _kick(S, t, v) {
    const o = this._osc(S, 'sine', 150, t, t + 0.3);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.1);
    const g = this._env(S, t, 0.95 * v, 0.002, 0.02, 0.2);
    o.connect(g).connect(S.out);
    this._noise(S, t, 0.02, 'highpass', 2500, 0.18 * v).connect(S.out);
  }

  _snare(S, t, v) {
    this._send(S, this._noise(S, t, 0.17, 'highpass', 1400, 0.42 * v), 0, 0.3);
    const o = this._osc(S, 'triangle', 200, t, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.1);
    o.connect(this._env(S, t, 0.3 * v, 0.001, 0, 0.11)).connect(S.out);
  }

  _hat(S, t, v, open) {
    this._noise(S, t, open ? 0.2 : 0.035, 'highpass', 7800, 0.13 * v).connect(S.out);
  }

  _tom(S, t, v, freq) {
    const o = this._osc(S, 'sine', freq, t, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.2);
    this._send(S, o.connect(this._env(S, t, 0.5 * v, 0.002, 0.01, 0.2)), 0, 0.2);
  }

  _crash(S, t) {
    this._send(S, this._noise(S, t, 1.3, 'highpass', 5200, 0.2), 0, 0.3);
  }

  _bass(S, t, midi, dur, tone) {
    const f = hz(midi);
    const end = t + dur + 0.1;
    const filter = S.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const round = tone === 'round';
    filter.Q.value = round ? 1 : 5;
    filter.frequency.setValueAtTime(round ? 700 : tone === 'grit' ? 2600 : 2000, t);
    filter.frequency.exponentialRampToValueAtTime(round ? 260 : 320, t + Math.min(dur, 0.16));
    const g = this._env(S, t, round ? 0.5 : 0.36, 0.004, Math.max(0, dur - 0.05), 0.06);
    this._osc(S, round ? 'triangle' : 'sawtooth', f, t, end).connect(filter);
    this._osc(S, round ? 'sine' : 'square', f * (round ? 2 : 0.5), t, end, 4).connect(filter);
    filter.connect(g).connect(S.out);
  }

  _pluck(S, t, midi, dur, vol) {
    const filter = S.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(3400, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = this._env(S, t, 0.1 * vol, 0.002, 0, dur);
    this._osc(S, 'square', hz(midi), t, t + dur + 0.05).connect(filter).connect(g);
    this._send(S, g, 0.3, 0.1);
  }

  _pad(S, t, notes, dur, vol) {
    const filter = S.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(800, t + dur);
    const g = this._env(S, t, 0.05 * vol, 0.25, Math.max(0, dur - 0.45), 0.4);
    for (const midi of notes) {
      for (const detune of [-8, 8]) this._osc(S, 'sawtooth', hz(midi), t, t + dur + 0.3, detune).connect(filter);
    }
    filter.connect(g);
    this._send(S, g, 0, 0.35);
  }

  /** Piano elétrico por síntese FM simples (portadora e moduladora em 1:1). */
  _epiano(S, t, notes, dur, vol) {
    const g = this._env(S, t, 0.085 * vol, 0.004, 0, Math.max(0.25, dur * 1.5));
    const end = t + dur * 1.5 + 0.3;
    for (const midi of notes) {
      const f = hz(midi);
      const carrier = this._osc(S, 'sine', f, t, end);
      const mod = this._osc(S, 'sine', f, t, end);
      const index = S.ctx.createGain();
      index.gain.setValueAtTime(f * 1.7, t);
      index.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.35);
      mod.connect(index).connect(carrier.frequency);
      carrier.connect(g);
    }
    this._send(S, g, 0.12, 0.3);
  }

  _organ(S, t, notes, dur, vol) {
    const g = this._env(S, t, 0.05 * vol, 0.004, Math.max(0, dur - 0.03), 0.04);
    const filter = S.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3000;
    for (const midi of notes) {
      const f = hz(midi);
      this._osc(S, 'square', f, t, t + dur + 0.1).connect(filter);
      this._osc(S, 'sine', f * 2, t, t + dur + 0.1).connect(filter);
    }
    filter.connect(g);
    this._send(S, g, 0.1, 0.15);
  }

  _lead(S, t, midi, dur, voice, vol) {
    const f = hz(midi);
    const end = t + dur + 0.15;
    const filter = S.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const soft = voice === 'soft';
    filter.frequency.setValueAtTime(soft ? 1500 : 4200, t);
    filter.frequency.exponentialRampToValueAtTime(soft ? 1000 : 2200, t + Math.max(0.05, dur));
    const g = this._env(S, t, (soft ? 0.14 : 0.1) * vol, soft ? 0.02 : 0.008, Math.max(0, dur - 0.06), 0.1);
    const types = soft ? ['triangle', 'sine'] : voice === 'square' ? ['square', 'square'] : ['sawtooth', 'square'];
    const oscs = [this._osc(S, types[0], f, t, end, -6), this._osc(S, types[1], soft ? f * 2 : f, t, end, 6)];

    // Vibrato tardio nas notas mais longas.
    if (dur > 0.22) {
      const lfo = this._osc(S, 'sine', 5.6, t, end);
      const depth = S.ctx.createGain();
      depth.gain.setValueAtTime(0, t + 0.15);
      depth.gain.linearRampToValueAtTime(16, t + 0.4);
      lfo.connect(depth);
      for (const o of oscs) depth.connect(o.detune);
    }
    for (const o of oscs) o.connect(filter);
    filter.connect(g);
    this._send(S, g, 0.28, 0.22);
  }

  /** Power chord (tônica, quinta, oitava) enviado à distorção compartilhada. */
  _guitar(S, t, midi, dur) {
    const g = this._env(S, t, 0.22, 0.003, Math.max(0, dur - 0.03), 0.04);
    for (const iv of [0, 7, 12]) this._osc(S, 'sawtooth', hz(midi + iv), t, t + dur + 0.08, iv * 0.4).connect(g);
    g.connect(S.dist);
  }
}
