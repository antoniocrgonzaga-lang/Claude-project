// =============================================================
// sound.js — efeitos sonoros, todos sintetizados (sem arquivos).
//
// Uso:  game.sound.play('levelUp')
//       game.sound.play('hit', { type: 'fire', crit: true })
//
// Cada som é uma "receita" em RECIPES: uma função que monta osciladores
// e ruído filtrado com envelopes de volume. Para mudar um som, mexa nos
// números da receita (frequências em Hz, durações em segundos, ganhos 0..1).
//
// minGap evita que o mesmo som toque dezenas de vezes no mesmo instante
// (ex.: o Redemoinho acertando 8 inimigos de uma vez).
// =============================================================
import { audio, midiToFreq } from '../core/audio.js';

// ---------------- peças básicas ----------------
// Envelope: sobe até `peak` em `attack` segundos e cai até quase zero em `decay`
function envelope(param, t, attack, peak, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// Saída de um som: volume próprio + um pouco enviado ao reverb
function output(gain = 1, reverb = 0.15) {
  const out = audio.ctx.createGain();
  out.gain.value = gain;
  out.connect(audio.sfxBus);
  if (reverb > 0) {
    const send = audio.ctx.createGain();
    send.gain.value = reverb;
    out.connect(send);
    send.connect(audio.reverb);
  }
  return out;
}

// Oscilador com deslize de frequência (freq → freqEnd)
function tone(dest, t, { type = 'sine', freq, freqEnd = freq, dur, gain, attack = 0.005 }) {
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  envelope(g.gain, t, attack, gain, dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + attack + dur + 0.05);
}

// Ruído filtrado (impacto, vento, chiado). filter: tipo e frequência (com deslize opcional)
function noise(dest, t, { dur, gain, attack = 0.004, type = 'lowpass', freq = 1000, freqEnd = freq, Q = 0.8 }) {
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.noise();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = Q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd !== freq) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + dur);
  const g = ctx.createGain();
  envelope(g.gain, t, attack, gain, dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + dur + 0.05);
}

// Som metálico (sino, espada batendo no escudo): parciais "desafinadas" entre si
function metal(dest, t, { freq, ratios = [1, 1.48, 2.17, 2.9, 3.86], dur, gain }) {
  ratios.forEach((r, i) => tone(dest, t, { freq: freq * r, dur: dur / (1 + i * 0.35), gain: gain / (1 + i * 0.5), attack: 0.002 }));
}

// ---------------- receitas ----------------
const IMPACT = {
  // golpe físico: baque grave + estalo
  physical(out, t) {
    tone(out, t, { freq: 150, freqEnd: 45, dur: 0.15, gain: 0.55 });
    noise(out, t, { dur: 0.08, gain: 0.4, freq: 2200, freqEnd: 400 });
    noise(out, t, { dur: 0.04, gain: 0.2, type: 'bandpass', freq: 1100, Q: 1.5 });
  },
  // fogo: sopro abafado + estalinhos de brasa
  fire(out, t) {
    noise(out, t, { dur: 0.35, gain: 0.8, attack: 0.02, freq: 1400, freqEnd: 300 });
    tone(out, t, { freq: 95, freqEnd: 55, dur: 0.22, gain: 0.25 });
    for (let i = 0; i < 6; i++) noise(out, t + 0.03 + Math.random() * 0.3, { dur: 0.015, gain: 0.12, type: 'highpass', freq: 3000 });
  },
  // gelo: tilintar de cristais
  cold(out, t) {
    for (const f of [2093, 2794, 3520, 4186]) tone(out, t + Math.random() * 0.07, { type: 'triangle', freq: f * (0.97 + Math.random() * 0.06), dur: 0.3, gain: 0.07 });
    noise(out, t, { dur: 0.12, gain: 0.15, type: 'highpass', freq: 4000 });
    tone(out, t, { freq: 120, freqEnd: 60, dur: 0.1, gain: 0.25 });
  },
  // eletricidade: zumbido que pula de frequência
  lightning(out, t) {
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    for (let i = 0; i < 10; i++) osc.frequency.setValueAtTime(80 + Math.random() * 520, t + i * 0.018);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 3000;
    const g = ctx.createGain();
    envelope(g.gain, t, 0.003, 0.18, 0.18);
    osc.connect(f).connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.25);
    noise(out, t, { dur: 0.1, gain: 0.25, type: 'highpass', freq: 2500 });
  },
  // trevas: "vuuum" grave
  shadow(out, t) {
    tone(out, t, { freq: 95, freqEnd: 35, dur: 0.4, gain: 0.45, attack: 0.02 });
    noise(out, t, { dur: 0.35, gain: 0.3, attack: 0.03, type: 'bandpass', freq: 380, freqEnd: 180, Q: 2 });
  },
};

const LAUNCH = {
  fire(out, t) {
    noise(out, t, { dur: 0.3, gain: 0.8, attack: 0.03, freq: 300, freqEnd: 2500 });
    tone(out, t, { freq: 220, freqEnd: 440, dur: 0.25, gain: 0.1 });
  },
  cold(out, t) {
    for (const f of [1568, 2093, 2637]) tone(out, t + Math.random() * 0.05, { type: 'triangle', freq: f, freqEnd: f * 1.06, dur: 0.3, gain: 0.025, attack: 0.03 });
    noise(out, t, { dur: 0.25, gain: 0.06, attack: 0.03, type: 'highpass', freq: 5000 });
  },
  lightning(out, t) {
    tone(out, t, { type: 'sawtooth', freq: 1200, freqEnd: 200, dur: 0.12, gain: 0.05 });
    noise(out, t, { dur: 0.08, gain: 0.2, type: 'highpass', freq: 3000 });
  },
  shadow(out, t) {
    tone(out, t, { freq: 220, freqEnd: 80, dur: 0.35, gain: 0.35, attack: 0.03 });
    noise(out, t, { dur: 0.3, gain: 0.4, attack: 0.04, type: 'bandpass', freq: 500, Q: 2 });
  },
};

export const RECIPES = {
  // espada/cajado cortando o ar
  swing: { minGap: 0.06, gain: 0.8, reverb: 0.05, play(out, t) {
    noise(out, t, { dur: 0.18, gain: 1.1, attack: 0.05, type: 'bandpass', freq: 500, freqEnd: 2200, Q: 1.2 });
  } },

  // acertou um inimigo. opts: { type: 'physical'|'fire'|'cold'|'lightning'|'shadow', crit }
  hit: { minGap: 0.04, gain: 0.8, reverb: 0.12, play(out, t, { type = 'physical', crit = false } = {}) {
    (IMPACT[type] ?? IMPACT.physical)(out, t);
    if (crit) { // crítico: um "clang" a mais por cima
      metal(out, t, { freq: 880, dur: 0.4, gain: 0.12 });
      tone(out, t, { freq: 180, freqEnd: 40, dur: 0.2, gain: 0.35 });
    }
  } },

  // o jogador levou um golpe
  hurt: { minGap: 0.12, gain: 0.7, reverb: 0.08, play(out, t) {
    tone(out, t, { freq: 105, freqEnd: 52, dur: 0.17, gain: 0.5 });
    noise(out, t, { dur: 0.1, gain: 0.35, freq: 900, freqEnd: 300 });
  } },

  // golpe aparado pelo escudo
  block: { minGap: 0.08, gain: 0.7, reverb: 0.25, play(out, t) {
    metal(out, t, { freq: 620, dur: 0.5, gain: 0.14 });
    noise(out, t, { dur: 0.03, gain: 0.3, type: 'highpass', freq: 1500 });
  } },

  // corda do arco + flecha zunindo
  bow: { minGap: 0.05, gain: 0.8, reverb: 0.08, play(out, t) {
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.pluck(45, 0.9);
    src.playbackRate.value = src.buffer.tuning;
    const g = audio.ctx.createGain();
    envelope(g.gain, t, 0.002, 0.45, 0.25);
    src.connect(g).connect(out);
    src.start(t); src.stop(t + 0.3);
    noise(out, t + 0.02, { dur: 0.15, gain: 0.12, attack: 0.02, type: 'highpass', freq: 3000, freqEnd: 1500 });
  } },

  // magia sendo lançada. opts: { type }
  cast: { minGap: 0.05, gain: 0.8, reverb: 0.3, play(out, t, { type = 'fire' } = {}) {
    (LAUNCH[type] ?? LAUNCH.fire)(out, t);
  } },

  // subiu de nível: arpejo de sinos subindo (Ré maior) e um brilho no fim
  levelUp: { minGap: 0.5, gain: 0.9, reverb: 0.6, play(out, t) {
    [74, 78, 81, 86].forEach((midi, i) => {
      const f = midiToFreq(midi), at = t + i * 0.12;
      tone(out, at, { freq: f, dur: 1.6, gain: 0.16, attack: 0.004 });
      tone(out, at, { freq: f * 2, dur: 0.8, gain: 0.05, attack: 0.004 });
      tone(out, at, { type: 'triangle', freq: f * 3.01, dur: 0.4, gain: 0.02, attack: 0.004 });
    });
    tone(out, t, { type: 'triangle', freq: midiToFreq(50), dur: 1.6, gain: 0.12, attack: 0.05 }); // Ré grave por baixo
    noise(out, t + 0.3, { dur: 1.0, gain: 0.05, attack: 0.4, type: 'highpass', freq: 6000 });
  } },

  // bebeu uma poção: três goles borbulhantes + um brilho suave (vida = mais grave; recurso = mais agudo)
  potion: { minGap: 0.3, gain: 0.8, reverb: 0.15, play(out, t, { kind = 'hp' } = {}) {
    [0, 0.13, 0.27].forEach((dt, i) => tone(out, t + dt, { freq: 260 + i * 30, freqEnd: 600 + i * 60, dur: 0.09, gain: 0.4 }));
    noise(out, t, { dur: 0.35, gain: 0.08, attack: 0.03, type: 'bandpass', freq: 700, Q: 3 });
    const base = kind === 'hp' ? 72 : 79;
    [0, 4, 7].forEach((st, i) => tone(out, t + 0.4 + i * 0.05, { freq: midiToFreq(base + st), dur: 0.6, gain: 0.04, attack: 0.02 }));
  } },
};

// ---------------- tocador ----------------
export class SoundSystem {
  constructor() {
    this.last = new Map(); // nome → quando tocou pela última vez
  }

  play(name, opts) {
    if (!audio.ready || audio.ctx.state !== 'running') return;
    const recipe = RECIPES[name];
    if (!recipe) { console.warn(`[sound] Som desconhecido: ${name}`); return; }
    const t = audio.now;
    const key = name + (opts?.type ?? '');
    if (t - (this.last.get(key) ?? -1) < (recipe.minGap ?? 0)) return;
    this.last.set(key, t);
    recipe.play(output(recipe.gain ?? 1, recipe.reverb ?? 0.15), t + 0.005, opts);
  }
}
