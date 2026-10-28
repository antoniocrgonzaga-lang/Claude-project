// =============================================================
// audio.js — o "motor" de som (Web Audio API), sem arquivos de áudio:
// todos os sons e a música são SINTETIZADOS por código.
//
// Caminho do som:
//
//   efeitos ──► sfxBus ───┐
//   música ───► musicBus ─┼──► master ──► compressor ──► alto-falantes
//   (envio) ──► reverb ───┘     (o reverb dá o "eco de catedral")
//
// O navegador só deixa tocar som depois que o jogador clica ou aperta
// uma tecla. Por isso o contexto é criado em unlock(), chamado pelo
// main.js no primeiro clique/tecla.
//
// Peças reaproveitadas por sfx (systems/sound.js) e música (systems/music.js):
//   pluck(midi)  → corda dedilhada (algoritmo Karplus-Strong), em cache;
//                  toque com playbackRate = buffer.tuning (afinação exata)
//   noise()      → buffer de ruído branco (vento, impacto, chiado)
//   midiToFreq   → nota MIDI (60 = Dó central) para frequência em Hz
// =============================================================
import { CONFIG } from '../config.js';

const MUTE_KEY = 'darkOblivion.musicMuted';

export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export const audio = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  reverb: null,       // entrada do reverb (mande um pouco de cada som para cá)
  ready: false,
  musicMuted: readMuted(),
  _pluckCache: new Map(),
  _noise: null,
  _onReady: [],

  // Primeiro clique/tecla: cria o contexto de áudio (ou o retoma, se o navegador o pausou)
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // navegador sem Web Audio: o jogo segue sem som
      this.setup(new Ctx());
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  // Monta os barramentos num contexto (também usado com OfflineAudioContext para testes)
  setup(ctx) {
    this.ctx = ctx;
    this._pluckCache.clear();
    this._noise = null;
    const vol = CONFIG.audio;

    const compressor = ctx.createDynamicsCompressor(); // evita estourar com muitos sons juntos
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = vol.master;
    this.master.connect(compressor);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = vol.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicMuted ? 0 : vol.music;
    this.musicBus.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, vol.reverbSeconds, 2.6);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = vol.reverbLevel;
    convolver.connect(reverbOut);
    reverbOut.connect(this.master);
    this.reverb = convolver;

    this.ready = true;
    for (const fn of this._onReady.splice(0)) fn();
  },

  // Executa fn assim que o áudio estiver liberado (na hora, se já estiver)
  whenReady(fn) {
    if (this.ready) fn(); else this._onReady.push(fn);
  },

  get now() { return this.ctx?.currentTime ?? 0; },

  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    try { localStorage.setItem(MUTE_KEY, this.musicMuted ? '1' : '0'); } catch { /* sem localStorage: só nesta sessão */ }
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicMuted ? 0 : CONFIG.audio.music, this.now, 0.2);
    return this.musicMuted;
  },

  // Buffer de 1 s de ruído branco (compartilhado)
  noise() {
    if (!this._noise) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  },

  // Corda dedilhada (Karplus-Strong): uma rajada de ruído circula numa "linha de atraso"
  // do tamanho de um período da nota; a média de amostras vizinhas vai abafando o som,
  // como uma corda de violão perdendo energia. brightness 0..1 = quão "metálico" é o ataque.
  pluck(midi, brightness = 0.5) {
    const key = midi + '|' + brightness;
    let buf = this._pluckCache.get(key);
    if (buf) return buf;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const freq = midiToFreq(midi);
    const period = sr / freq;
    const N = Math.max(2, Math.round(period - 0.5)); // a média de 2 amostras atrasa meia amostra
    const seconds = Math.min(4, 1.2 + 260 / freq); // notas graves soam por mais tempo
    buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const d = buf.getChannelData(0);
    // ataque: ruído suavizado (menos brilho = ruído mais filtrado)
    let last = 0;
    const smooth = 0.15 + (1 - brightness) * 0.7;
    for (let i = 0; i < N; i++) {
      last = last * smooth + (Math.random() * 2 - 1) * (1 - smooth);
      d[i] = last;
    }
    // queda: cada volta perde um pouco (graves perdem menos por segundo)
    const decay = Math.pow(0.001, 1 / (seconds * freq)); // chega a -60 dB no fim do buffer
    for (let i = N; i < d.length; i++) {
      const prev = i - N - 1 >= 0 ? d[i - N - 1] : d[i - N];
      d[i] = decay * 0.5 * (d[i - N] + prev);
    }
    // normaliza o pico
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak;
    // A linha de atraso tem tamanho inteiro (N + 0,5 amostras), então a nota sai um tiquinho
    // desafinada. Quem toca o buffer multiplica a velocidade por isto para corrigir.
    buf.tuning = (N + 0.5) / period;
    this._pluckCache.set(key, buf);
    return buf;
  },
};

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

// "Resposta de impulso" do reverb: ruído estéreo que vai sumindo (como o eco
// de uma sala de pedra). Os agudos somem mais rápido que os graves.
function makeImpulse(ctx, seconds, power) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.2 + t * 0.7; // filtro passa-baixa cada vez mais forte
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - t, power);
    }
  }
  return buf;
}
