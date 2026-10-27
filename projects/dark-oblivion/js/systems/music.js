// =============================================================
// music.js — toca as músicas de data/music.js com instrumentos sintetizados:
//   violão de 12 cordas → cordas dedilhadas (audio.pluck) com a oitava dobrada
//   bordão             → dois osciladores graves bem abafados
//   sino               → parciais longas de um sino de igreja, com muito eco
//
// Temas "ambient" (kind: 'ambient', ex.: o Oblivion) não têm partitura fixa: a cada
// compasso sorteamos o que toca, conforme a SEÇÃO da forma (vazio, pulso, violão,
// tensão). Instrumentos extras: violoncelo (arco), glissando de violino, tambor pesado,
// batidas de metal distantes, arrasto de corrente e vento/ronco contínuos.
// O violão desses temas passa por um eco (delay) com repetições que vão abafando.
//
// Uso:  game.music.play('village')   (entra devagar, em fade)
//       game.music.stop()            (sai devagar)
//
// Agendamento: a cada 0,25 s olhamos 1,5 s à frente e marcamos no relógio do
// áudio as notas dos compassos que começam nesse intervalo. O relógio do áudio
// é preciso; o setInterval não precisa ser (o navegador o atrasa em abas escondidas).
// =============================================================
import { audio, midiToFreq } from '../core/audio.js';
import { THEMES, CHORDS } from '../data/music.js';

const LOOKAHEAD = 1.5;   // segundos agendados à frente
const TICK_MS = 250;
const FADE_IN = 3;
const FADE_OUT = 2;

export class MusicSystem {
  constructor() {
    this.current = null; // { id, theme, bars, gain, barIndex, nextBar, timer, drone }
    this.wanted = null;  // tema pedido antes de o áudio ser liberado (tela inicial)
  }

  play(id) {
    this.wanted = id;
    audio.whenReady(() => {
      if (this.wanted !== id || this.current?.id === id) return;
      this.stop();
      this.start(id);
    });
  }

  stop() {
    this.wanted = null;
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    clearInterval(cur.timer);
    const t = audio.now;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
    cur.gain.gain.linearRampToValueAtTime(0, t + FADE_OUT);
    for (const node of cur.drone) node.stop(t + FADE_OUT + 0.1);
    setTimeout(() => cur.gain.disconnect(), (FADE_OUT + 4) * 1000); // espera o eco das últimas notas
  }

  start(id) {
    const theme = THEMES[id];
    if (!theme) { console.warn(`[music] Tema desconhecido: ${id}`); return; }
    const ctx = audio.ctx, t = audio.now;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + FADE_IN);
    gain.connect(audio.musicBus);
    const send = ctx.createGain(); // eco: a música vai bem "molhada", como numa nave de igreja
    send.gain.value = 0.7;
    gain.connect(send);
    send.connect(audio.reverb);

    // a partitura vira uma lista de compassos tocada em loop
    const bars = [];
    for (const sec of theme.sections ?? []) {
      sec.chords.forEach((chord, i) => bars.push({ chord, pattern: sec.pattern, melody: sec.melody[i] ?? [] }));
    }

    this.current = { id, theme, bars, gain, barIndex: 0, nextBar: t + 0.3, drone: startDrone(gain, theme, t) };
    if (theme.kind === 'ambient') {
      const amb = theme.ambient;
      // forma: cada seção vira N compassos seguidos (ex.: 4 de "vazio", 4 de "pulso"...)
      this.current.form = amb.form.flatMap(([kind, n]) => Array(n).fill(kind));
      this.current.guitarBus = makeDelayBus(gain, amb.delay);
      this.current.drone.push(...startAmbience(gain, amb.ambience, t));
    }
    this.current.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  schedule() {
    const cur = this.current;
    if (!cur) return;
    const now = audio.now;
    if (cur.nextBar < now) cur.nextBar = now + 0.1; // a aba ficou parada: recomeça do agora
    const { theme, bars } = cur;
    const barLength = theme.eighth * theme.barEighths;
    while (cur.nextBar < now + LOOKAHEAD) {
      const bar = bars[cur.barIndex % bars.length];
      if (theme.kind === 'ambient') playAmbientBar(cur, cur.nextBar, cur.barIndex);
      else {
        if (theme.bell && cur.barIndex % theme.bell.every === 0) bell(cur.gain, cur.nextBar, theme.bell.midi);
        playBar(cur.gain, cur.nextBar, bar, theme);
      }
      cur.barIndex++;
      cur.nextBar += barLength;
    }
  }
}

// Um compasso: dedilhado do acorde + notas da melodia
function playBar(dest, t0, bar, theme) {
  const notes = CHORDS[bar.chord];
  const e = theme.eighth;
  const human = () => (Math.random() - 0.5) * 0.016; // ninguém toca perfeitamente no tempo
  if (bar.pattern === 'strum') {
    // rasgueado suave: as cordas soam uma depois da outra, rapidinho (duas vezes no compasso)
    [0, 3].forEach((beat, k) => notes.forEach((midi, i) =>
      guitar(dest, t0 + beat * e + i * 0.035 + human(), midi, (k === 0 ? 0.34 : 0.2), -0.3 + i * 0.2)));
  } else {
    bar.pattern.forEach((idx, i) => {
      const midi = notes[idx];
      const vel = (i === 0 ? 0.4 : 0.27) * (0.85 + Math.random() * 0.3); // o baixo um pouco mais forte
      guitar(dest, t0 + i * e + human(), midi, vel, -0.35 + idx * 0.22);
    });
  }
  for (const [start, midi] of bar.melody) {
    guitar(dest, t0 + start * e + human(), midi, 0.5 * (0.9 + Math.random() * 0.2), 0.1, 0.75, false);
  }
}

// Uma nota do violão de 12 cordas: a corda + a "irmã" uma oitava acima (nas cordas graves)
function guitar(dest, t, midi, vel, pan = 0, brightness = 0.55, doubled = true) {
  pluckAt(dest, t, midi, vel, pan, brightness, 1);
  if (doubled && midi < 64) pluckAt(dest, t + 0.012, midi + 12, vel * 0.38, -pan, brightness, 1.0025);
}

function pluckAt(dest, t, midi, vel, pan, brightness, rate) {
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.pluck(midi, brightness);
  // rate: a corda dobrada fica um tiquinho desafinada da principal (o "brilho" do 12 cordas)
  src.playbackRate.value = rate * src.buffer.tuning;
  const g = ctx.createGain();
  g.gain.value = vel;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(g).connect(p).connect(dest);
  src.start(Math.max(t, audio.now));
}

// Bordão: Ré e Lá graves, abafados, com o filtro "respirando" devagar
function startDrone(dest, theme, t) {
  const ctx = audio.ctx;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  filter.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05, t + 6);
  filter.connect(g).connect(dest);
  const nodes = [];
  for (const midi of theme.drone ?? []) {
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      nodes.push(osc);
    }
  }
  const lfo = ctx.createOscillator(); // abre e fecha o filtro a cada ~14 s
  lfo.frequency.value = 0.07;
  const depth = ctx.createGain();
  depth.gain.value = 140;
  lfo.connect(depth).connect(filter.frequency);
  lfo.start(t);
  nodes.push(lfo);
  return nodes;
}

// Sino distante: parciais de um sino de igreja (o "hum" uma oitava abaixo, a terça menor...)
function bell(dest, t, midi) {
  const ctx = audio.ctx;
  const f = midiToFreq(midi);
  const partials = [[0.5, 0.05, 6], [1, 0.06, 4.5], [1.19, 0.035, 3.5], [1.5, 0.025, 3], [2, 0.03, 2.5], [2.52, 0.015, 2], [3, 0.012, 1.5]];
  for (const [ratio, gain, dur] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }
}

// ======================= TEMAS AMBIENT =======================
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Um compasso sorteado: o que pode tocar depende da seção atual da forma
function playAmbientBar(cur, t0, index) {
  const theme = cur.theme, A = theme.ambient, e = theme.eighth;
  const barLen = e * theme.barEighths;
  const sec = A.sections[cur.form[index % cur.form.length]];
  const dest = cur.gain;

  // violoncelo: nota longa a cada 2 compassos; às vezes uma 2ª voz dissonante entra depois
  if (index % 2 === 0 && Math.random() < sec.cello) {
    const midi = pick(A.cello.notes);
    cello(dest, t0, midi, barLen * 2 - 0.4, A.cello.vel, -0.15);
    if (Math.random() < (sec.celloSecond ?? 0)) cello(dest, t0 + e * 3, midi + pick(A.cello.second), barLen * 1.4, A.cello.vel * 0.55, 0.25);
  }
  // tambor pesado (padrões espaçados)
  if (Math.random() < sec.drums) for (const [off, v] of pick(A.drums.patterns)) drum(dest, t0 + off * e, v * A.drums.vel);
  // violão de 12 cordas: um motivo curto e dissonante, que o eco repete
  if (Math.random() < sec.guitar) {
    const start = pick([0, 1, 2, 4]);
    const pan = Math.random() * 0.8 - 0.4;
    for (const [off, midi] of pick(A.guitar.motifs)) {
      guitar(cur.guitarBus, t0 + (start + off) * e + (Math.random() - 0.5) * 0.02, midi, A.guitar.vel * (0.85 + Math.random() * 0.3), pan, 0.6);
    }
  }
  // glissando de violino: uma nota aguda que escorrega devagar
  if (Math.random() < (sec.gliss ?? 0)) {
    const [from, to, bars] = pick(A.violin.glides);
    violin(dest, t0 + Math.random() * e * 3, from, to, bars * barLen, A.violin.vel);
  }
  // sons do lugar: metal batendo longe, corrente arrastando
  if (Math.random() < (sec.clank ?? 0)) clank(dest, t0 + Math.random() * barLen, A.ambience.clankVel);
  if (Math.random() < (sec.scrape ?? 0)) scrape(dest, t0 + Math.random() * barLen * 0.5, 2.5 + Math.random() * 2, A.ambience.scrapeVel);
}

// Eco (delay) com realimentação: cada repetição sai mais baixa e mais abafada
function makeDelayBus(dest, cfg) {
  const ctx = audio.ctx;
  const bus = ctx.createGain();
  bus.connect(dest); // som direto
  const delay = ctx.createDelay(2);
  delay.delayTime.value = cfg.time;
  const feedback = ctx.createGain();
  feedback.gain.value = cfg.feedback;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = cfg.tone;
  const wet = ctx.createGain();
  wet.gain.value = cfg.wet;
  bus.connect(delay);
  delay.connect(tone).connect(feedback).connect(delay);
  tone.connect(wet).connect(dest);
  return bus;
}

// Violoncelo: duas serras levemente desafinadas, filtro que "abre" com o arco e vibrato
function cello(dest, t, midi, dur, vel, pan = 0) {
  const ctx = audio.ctx;
  const f = midiToFreq(midi);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(260, t);
  filter.frequency.linearRampToValueAtTime(900, t + 1.4);
  filter.frequency.linearRampToValueAtTime(500, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + 1.3);          // o arco entra devagar
  g.gain.setValueAtTime(vel, t + dur);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.8); // e sai devagar
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  filter.connect(g).connect(p).connect(dest);
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 4.6 + Math.random() * 0.6;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(7, t + 2); // vibrato em cents, entra depois do ataque
  vibrato.connect(depth);
  for (const detune of [-5, 5]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = detune;
    depth.connect(osc.detune);
    osc.connect(filter);
    osc.start(t); osc.stop(t + dur + 2);
  }
  vibrato.start(t); vibrato.stop(t + dur + 2);
}

// Violino em glissando: nota aguda e fina escorregando de `from` para `to`
function violin(dest, t, from, to, dur, vel) {
  const ctx = audio.ctx;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  filter.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.9);
  g.gain.setValueAtTime(vel, t + dur * 0.75);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.random() * 1.2 - 0.6;
  filter.connect(g).connect(p).connect(dest);
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.8;
  const depth = ctx.createGain();
  depth.gain.value = 14;
  vibrato.connect(depth);
  for (const [type, level] of [['sawtooth', 0.6], ['triangle', 1]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(midiToFreq(from), t);
    osc.frequency.setValueAtTime(midiToFreq(from), t + dur * 0.15);
    osc.frequency.exponentialRampToValueAtTime(midiToFreq(to), t + dur * 0.85);
    depth.connect(osc.detune);
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(filter);
    osc.start(t); osc.stop(t + dur + 1.4);
  }
  vibrato.start(t); vibrato.stop(t + dur + 1.4);
}

// Tambor pesado: corpo grave que despenca de tom + pele + baque de ruído
function drum(dest, t, vel) {
  const ctx = audio.ctx;
  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(95, t);
  body.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(vel, t + 0.008);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  body.connect(bg).connect(dest);
  body.start(t); body.stop(t + 1.3);
  const skin = ctx.createOscillator();
  skin.type = 'triangle';
  skin.frequency.setValueAtTime(190, t);
  skin.frequency.exponentialRampToValueAtTime(95, t + 0.12);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.005);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  skin.connect(sg).connect(dest);
  skin.start(t); skin.stop(t + 0.3);
  const n = ctx.createBufferSource();
  n.buffer = audio.noise();
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.value = 420;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.005);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  n.connect(nf).connect(ng).connect(dest);
  n.start(t, Math.random() * 0.5); n.stop(t + 0.35);
}

// Metal batendo ao longe (correntes, portas de ferro): parciais desafinadas, abafadas
function clank(dest, t, vel) {
  const ctx = audio.ctx;
  const base = 260 + Math.random() * 260;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.random() * 1.6 - 0.8;
  filter.connect(p).connect(dest);
  [1, 1.47, 2.09, 2.76, 3.81].forEach((r, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = base * r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel / (1 + i * 0.6), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / (1 + i * 0.3));
    osc.connect(g).connect(filter);
    osc.start(t); osc.stop(t + 1.7);
  });
}

// Arrasto (corrente/pedra raspando): ruído num filtro estreito que desliza
function scrape(dest, t, dur, vel) {
  const ctx = audio.ctx;
  const n = ctx.createBufferSource();
  n.buffer = audio.noise();
  n.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 7;
  f.frequency.setValueAtTime(220 + Math.random() * 120, t);
  f.frequency.exponentialRampToValueAtTime(600 + Math.random() * 400, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.random() * 1.6 - 0.8;
  n.connect(f).connect(g).connect(p).connect(dest);
  n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.1);
}

// Fundo contínuo: vento passando pelos túneis + ronco grave da terra (devolve os nós para parar)
function startAmbience(dest, cfg, t) {
  const ctx = audio.ctx;
  const nodes = [];
  const layer = (type, freq, q, level, lfoRate, lfoDepth) => {
    const n = ctx.createBufferSource();
    n.buffer = audio.noise();
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 5);
    n.connect(f).connect(g).connect(dest);
    const lfo = ctx.createOscillator(); // o vento "respira": o filtro sobe e desce devagar
    lfo.frequency.value = lfoRate;
    const d = ctx.createGain();
    d.gain.value = lfoDepth;
    lfo.connect(d).connect(f.frequency);
    n.start(t); lfo.start(t);
    nodes.push(n, lfo);
  };
  layer('bandpass', 420, 0.7, cfg.windVel, 0.05, 260);
  layer('lowpass', 110, 0.5, cfg.rumbleVel, 0.03, 40);
  return nodes;
}
