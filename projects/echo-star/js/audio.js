/**
 * Sound — everything is synthesised with the Web Audio API, no audio files.
 *
 *  · One-shot effects (shots, explosions, harvesting, UI, notifications…)
 *    played with play(name, { at }). `at` is a world position: the sound
 *    gets quieter with distance from the listener and is panned left / right.
 *  · Continuous loops driven every frame from the game state: ship engine,
 *    planet wind and rumble, the Tech Moon's hum, footsteps and work noises.
 *  · Generative ambient music: slow pad chords + bells, which turns into a
 *    pulsing tension track while a rogue AI raid is coming or under way.
 *
 * Browsers only allow sound after a click / key press, so the audio context
 * is created on the first input. Volumes: CONFIG.audio + the menu sliders
 * (saved per browser). K mutes.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './utils.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

// Music: chord voicings as MIDI notes (A minor, modal), and the bell scale.
const PROGRESSIONS = {
  calm: [
    [45, 52, 55, 59, 60],   // Am9
    [41, 48, 52, 57, 64],   // Fmaj7
    [48, 55, 59, 62, 64],   // Cmaj9
    [43, 50, 55, 59, 62],   // G
    [38, 53, 57, 60, 64],   // Dm9
  ],
  tension: [
    [45, 52, 57, 60],       // Am
    [46, 53, 58, 62],       // Bb
    [45, 52, 57, 60],       // Am
    [40, 52, 56, 59],       // E
  ],
};
const BELLS = [69, 72, 74, 76, 79, 81, 84, 86, 88];
/** Footstep brightness and wind strength per biome. */
const STEP_TONE = { verdant: 900, arid: 1700, glacial: 3200, volcanic: 650, aether: 1300 };
const WIND = { verdant: 0.8, arid: 1.3, glacial: 1.5, volcanic: 0.7, aether: 0.9 };
const MODES_FLYING = new Set(['flight', 'landing', 'takeoff']);

// ================================================================ recipes
/**
 * One-shot sounds. Each: { vol, gap (min seconds between two plays), max
 * (plays at once), vary (random pitch ±), ref (distance of half volume),
 * reverb (send amount), stinger (mutes notification beeps for a moment),
 * fn(audio, time, out, pitch, opts) → duration in seconds }.
 */
const SOUNDS = {
  // ---------------------------------------------------------- weapons
  blaster: { vol: 0.3, gap: 0.05, max: 3, fn(a, t, out, p) {
    const o = a._o(t, 'square', 1500 * p, 0.16, a._f(t, 'lowpass', 3800, 1, a._e(t, 1, 0.003, 0.14, out)));
    o.frequency.exponentialRampToValueAtTime(240 * p, t + 0.14);
    const z = a._o(t, 'sawtooth', 2400 * p, 0.08, a._e(t, 0.3, 0.002, 0.06, out));
    z.frequency.exponentialRampToValueAtTime(800 * p, t + 0.07);
    return 0.18;
  } },
  laser: { vol: 0.2, gap: 0.04, max: 5, fn(a, t, out, p) {
    const o = a._o(t, 'triangle', 1150 * p, 0.12, a._e(t, 1, 0.002, 0.11, out));
    o.frequency.exponentialRampToValueAtTime(230 * p, t + 0.11);
    a._n(t, 0.04, a._f(t, 'highpass', 5000, 0.7, a._e(t, 0.3, 0.001, 0.03, out)));
    return 0.14;
  } },
  heavyLaser: { vol: 0.26, gap: 0.05, max: 4, fn(a, t, out, p) {
    const o = a._o(t, 'sawtooth', 760 * p, 0.2, a._f(t, 'lowpass', 2200, 1, a._e(t, 0.8, 0.003, 0.18, out)));
    o.frequency.exponentialRampToValueAtTime(110 * p, t + 0.18);
    const s = a._o(t, 'sine', 210 * p, 0.14, a._e(t, 0.8, 0.002, 0.12, out));
    s.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    return 0.22;
  } },
  turret: { vol: 0.28, gap: 0.08, max: 3, fn(a, t, out, p) {
    for (const d of [0, 0.075]) {
      const o = a._o(t + d, 'square', 950 * p, 0.07, a._f(t + d, 'lowpass', 3000, 1, a._e(t + d, 0.8, 0.002, 0.06, out)));
      o.frequency.exponentialRampToValueAtTime(300 * p, t + d + 0.06);
    }
    return 0.17;
  } },
  enemyLaser: { vol: 0.24, gap: 0.05, max: 5, fn(a, t, out, p) {
    const bp = a._f(t, 'bandpass', 1000, 1.5, a._e(t, 1, 0.004, 0.2, out));
    const o = a._o(t, 'sawtooth', 420 * p, 0.22, bp);
    const o2 = a._o(t, 'square', 433 * p, 0.22, bp);
    o.frequency.exponentialRampToValueAtTime(85 * p, t + 0.2);
    o2.frequency.exponentialRampToValueAtTime(90 * p, t + 0.2);
    return 0.24;
  } },
  heavyEnemy: { vol: 0.3, gap: 0.08, max: 3, fn(a, t, out, p) {
    const o = a._o(t, 'sawtooth', 260 * p, 0.34, a._f(t, 'lowpass', 1300, 1.5, a._e(t, 1, 0.005, 0.32, out)));
    o.frequency.exponentialRampToValueAtTime(50 * p, t + 0.32);
    a._n(t, 0.15, a._f(t, 'lowpass', 900, 0.7, a._e(t, 0.6, 0.003, 0.13, out)));
    return 0.36;
  } },
  bite: { vol: 0.28, gap: 0.08, max: 3, vary: 0.25, fn(a, t, out, p) {
    a._n(t, 0.1, a._f(t, 'bandpass', 1100 * p, 4, a._e(t, 1, 0.004, 0.09, out)));
    const o = a._o(t, 'square', 170 * p, 0.12, a._f(t, 'lowpass', 900, 1, a._e(t, 0.4, 0.004, 0.1, out)));
    o.frequency.exponentialRampToValueAtTime(80, t + 0.1);
    return 0.13;
  } },

  // ------------------------------------------------------- explosions
  explosion: { vol: 0.55, gap: 0.05, max: 6, ref: 35, reverb: 0.35, fn(a, t, out, p) {
    const len = 0.9;
    const lp = a._f(t, 'lowpass', 2400 * p, 0.7, a._e(t, 1, 0.005, len, out));
    lp.frequency.exponentialRampToValueAtTime(160, t + len);
    a._n(t, len, lp);
    const o = a._o(t, 'sine', 130 * p, 0.5, a._e(t, 1.2, 0.004, 0.45, out));
    o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    return len;
  } },
  bigExplosion: { vol: 0.8, gap: 0.2, max: 3, ref: 60, reverb: 0.5, fn(a, t, out, p) {
    const len = 1.8;
    const lp = a._f(t, 'lowpass', 1800 * p, 0.7, a._e(t, 1, 0.01, len, out));
    lp.frequency.exponentialRampToValueAtTime(90, t + len);
    a._n(t, len, lp);
    for (let k = 0; k < 6; k++) {   // debris crackle
      const d = rand(0.05, 0.9);
      a._n(t + d, 0.06, a._f(t + d, 'bandpass', rand(1800, 4200), 3, a._e(t + d, 0.6, 0.002, 0.05, out)));
    }
    const o = a._o(t, 'sine', 95 * p, 0.9, a._e(t, 1.4, 0.005, 0.85, out));
    o.frequency.exponentialRampToValueAtTime(28, t + 0.85);
    return len;
  } },

  // ------------------------------------------------------ the astronaut
  hurt: { vol: 0.42, gap: 0.15, max: 2, fn(a, t, out, p) {
    const o = a._o(t, 'square', 220 * p, 0.24, a._f(t, 'lowpass', 1200, 1, a._e(t, 0.8, 0.003, 0.22, out)));
    o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    a._n(t, 0.12, a._f(t, 'bandpass', 800, 1, a._e(t, 0.7, 0.002, 0.11, out)));
    return 0.26;
  } },
  teleport: { vol: 0.4, gap: 1, max: 1, reverb: 0.4, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 300, 0.7, a._e(t, 0.8, 0.05, 0.6, out));
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
    for (let k = 0; k < 5; k++) a._bell(t + 0.08 * k, mtof(BELLS[k * 2] + 12), 0.2, 0.5, out);
    return 0.9;
  } },
  footstep: { vol: 0.2, gap: 0.12, max: 2, vary: 0.25, fn(a, t, out, p, o) {
    a._n(t, 0.07, a._f(t, 'bandpass', (o.tone ?? 1200) * p, 1.2, a._e(t, 1, 0.004, 0.06, out)));
    a._o(t, 'sine', 90 * p, 0.05, a._e(t, 0.4, 0.003, 0.04, out));
    return 0.08;
  } },
  jump: { vol: 0.12, gap: 0.2, max: 1, fn(a, t, out, p) {
    a._n(t, 0.12, a._f(t, 'highpass', 2000, 0.7, a._e(t, 0.6, 0.01, 0.1, out)));
    const o = a._o(t, 'sine', 220 * p, 0.1, a._e(t, 0.5, 0.005, 0.08, out));
    o.frequency.exponentialRampToValueAtTime(340 * p, t + 0.08);
    return 0.13;
  } },
  land: { vol: 0.16, gap: 0.2, max: 1, fn(a, t, out, p, o) {
    a._n(t, 0.11, a._f(t, 'lowpass', (o.tone ?? 1200) * 0.6, 0.8, a._e(t, 1, 0.004, 0.1, out)));
    const s = a._o(t, 'sine', 110 * p, 0.1, a._e(t, 0.7, 0.003, 0.09, out));
    s.frequency.exponentialRampToValueAtTime(50, t + 0.09);
    return 0.12;
  } },

  // ------------------------------------------------------- harvesting
  mine_crystal: { vol: 0.2, gap: 0.08, max: 4, vary: 0.2, fn(a, t, out, p) {
    a._o(t, 'sine', 2600 * p, 0.13, a._e(t, 1, 0.002, 0.12, out));
    a._o(t, 'sine', 3900 * p, 0.09, a._e(t, 0.4, 0.002, 0.08, out));
    return 0.14;
  } },
  mine_iron: { vol: 0.24, gap: 0.08, max: 4, vary: 0.15, fn(a, t, out, p) {
    a._o(t, 'triangle', 820 * p, 0.16, a._e(t, 1, 0.002, 0.15, out));
    a._o(t, 'triangle', 1960 * p, 0.11, a._e(t, 0.5, 0.002, 0.1, out));
    a._n(t, 0.03, a._f(t, 'highpass', 3000, 0.7, a._e(t, 0.6, 0.001, 0.025, out)));
    return 0.17;
  } },
  mine_rock: { vol: 0.3, gap: 0.08, max: 4, vary: 0.2, fn(a, t, out, p) {
    a._n(t, 0.1, a._f(t, 'lowpass', 900 * p, 0.8, a._e(t, 1, 0.002, 0.09, out)));
    const o = a._o(t, 'sine', 140 * p, 0.09, a._e(t, 0.7, 0.002, 0.08, out));
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    return 0.11;
  } },
  mine_plant: { vol: 0.22, gap: 0.1, max: 3, vary: 0.25, fn(a, t, out, p) {
    a._n(t, 0.14, a._f(t, 'bandpass', 3000 * p, 1, a._e(t, 1, 0.02, 0.12, out)));
    return 0.15;
  } },
  capture: { vol: 0.16, gap: 0.1, max: 2, vary: 0.15, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 520 * p, 0.16, a._e(t, 1, 0.01, 0.14, out));
    o.frequency.exponentialRampToValueAtTime(780 * p, t + 0.15);
    return 0.17;
  } },
  wrench: { vol: 0.24, gap: 0.1, max: 2, vary: 0.15, fn(a, t, out, p) {
    for (const d of [0, 0.06]) a._o(t + d, 'square', 300 * p, 0.04, a._f(t + d, 'bandpass', 1500, 2, a._e(t + d, 1, 0.001, 0.035, out)));
    return 0.11;
  } },
  hammer: { vol: 0.26, gap: 0.09, max: 4, ref: 22, vary: 0.2, fn(a, t, out, p) {
    a._o(t, 'triangle', 1400 * p, 0.07, a._e(t, 1, 0.001, 0.06, out));
    a._n(t, 0.03, a._f(t, 'highpass', 2500, 0.7, a._e(t, 0.7, 0.001, 0.025, out)));
    a._o(t, 'sine', 220 * p, 0.06, a._e(t, 0.6, 0.001, 0.05, out));
    return 0.08;
  } },

  // ------------------------------------------------- collecting things
  collect_crystal: { vol: 0.32, gap: 0.1, max: 2, reverb: 0.4, vary: 0.04, fn(a, t, out, p) {
    [84, 88, 91].forEach((m, i) => a._bell(t + i * 0.06, mtof(m) * p, 0.5, 0.6, out));
    return 0.9;
  } },
  collect_iron: { vol: 0.34, gap: 0.1, max: 2, reverb: 0.15, fn(a, t, out, p) {
    a._o(t, 'triangle', 523 * p, 0.5, a._e(t, 1, 0.002, 0.45, out));
    a._o(t, 'triangle', 1318 * p, 0.35, a._e(t, 0.5, 0.002, 0.3, out));
    a._n(t, 0.03, a._f(t, 'highpass', 2500, 0.7, a._e(t, 0.8, 0.001, 0.025, out)));
    return 0.5;
  } },
  collect_rock: { vol: 0.4, gap: 0.1, max: 2, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 110 * p, 0.22, a._e(t, 1, 0.003, 0.2, out));
    o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    a._n(t, 0.25, a._f(t, 'lowpass', 1200, 0.7, a._e(t, 0.7, 0.003, 0.24, out)));
    a._n(t + 0.12, 0.12, a._f(t + 0.12, 'bandpass', 1800, 2, a._e(t + 0.12, 0.4, 0.002, 0.1, out)));
    return 0.3;
  } },
  collect_plant: { vol: 0.3, gap: 0.1, max: 2, reverb: 0.2, fn(a, t, out, p) {
    [67, 74].forEach((m, i) => a._o(t + i * 0.07, 'triangle', mtof(m) * p, 0.3, a._e(t + i * 0.07, 0.8, 0.003, 0.25, out)));
    return 0.4;
  } },
  collect_animal: { vol: 0.32, gap: 0.2, max: 1, reverb: 0.2, fn(a, t, out, p) {
    for (const [d, f] of [[0, 800], [0.1, 1000]]) {
      const o = a._o(t + d, 'sine', f * p, 0.09, a._e(t + d, 0.8, 0.005, 0.08, out));
      o.frequency.exponentialRampToValueAtTime(f * 2 * p, t + d + 0.08);
    }
    a._o(t + 0.2, 'triangle', 400 * p, 0.12, a._e(t + 0.2, 0.7, 0.002, 0.1, out));
    return 0.35;
  } },
  pickup: { vol: 0.2, gap: 0.12, max: 2, ref: 25, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 988 * p, 0.12, a._e(t, 1, 0.003, 0.1, out));
    o.frequency.setValueAtTime(1480 * p, t + 0.05);
    return 0.13;
  } },

  // -------------------------------------------------------- building
  place: { vol: 0.4, gap: 0.1, max: 2, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 160 * p, 0.32, a._e(t, 1, 0.003, 0.3, out));
    o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
    a._n(t, 0.12, a._f(t, 'lowpass', 1500, 0.7, a._e(t, 0.6, 0.002, 0.11, out)));
    const r = a._o(t + 0.05, 'triangle', 440 * p, 0.3, a._e(t + 0.05, 0.25, 0.05, 0.22, out));
    r.frequency.exponentialRampToValueAtTime(880 * p, t + 0.3);
    return 0.38;
  } },
  dismantle: { vol: 0.4, gap: 0.2, max: 2, fn(a, t, out, p) {
    const bp = a._f(t, 'bandpass', 1400, 2, a._e(t, 1, 0.01, 0.5, out));
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    a._n(t, 0.5, bp);
    const o = a._o(t, 'square', 300 * p, 0.42, a._f(t, 'lowpass', 900, 1, a._e(t, 0.4, 0.005, 0.4, out)));
    o.frequency.exponentialRampToValueAtTime(80, t + 0.4);
    return 0.55;
  } },

  // ------------------------------------------------------------ UI
  click: { vol: 0.18, gap: 0.03, max: 2, vary: 0.05, fn(a, t, out, p) {
    a._o(t, 'sine', 1500 * p, 0.05, a._e(t, 1, 0.001, 0.035, out));
    return 0.05;
  } },
  select: { vol: 0.2, gap: 0.05, max: 2, vary: 0.05, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 900 * p, 0.07, a._e(t, 1, 0.003, 0.06, out));
    o.frequency.exponentialRampToValueAtTime(1350 * p, t + 0.06);
    return 0.07;
  } },
  order: { vol: 0.22, gap: 0.08, max: 1, vary: 0.03, fn(a, t, out, p) {
    a._o(t, 'triangle', 660 * p, 0.07, a._e(t, 1, 0.003, 0.06, out));
    a._o(t + 0.07, 'triangle', 990 * p, 0.08, a._e(t + 0.07, 1, 0.003, 0.07, out));
    return 0.16;
  } },
  open: { vol: 0.2, gap: 0.1, max: 1, vary: 0.02, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 500 * p, 0.14, a._e(t, 1, 0.01, 0.12, out));
    o.frequency.exponentialRampToValueAtTime(900 * p, t + 0.12);
    a._n(t, 0.12, a._f(t, 'highpass', 4000, 0.7, a._e(t, 0.15, 0.03, 0.08, out)));
    return 0.15;
  } },
  close: { vol: 0.18, gap: 0.1, max: 1, vary: 0.02, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 900 * p, 0.14, a._e(t, 1, 0.005, 0.12, out));
    o.frequency.exponentialRampToValueAtTime(480 * p, t + 0.12);
    return 0.15;
  } },

  // ---------------------------------------------------- notifications
  noteInfo: { vol: 0.15, gap: 0.3, max: 1, vary: 0, fn(a, t, out) {
    a._o(t, 'sine', 1046, 0.2, a._e(t, 1, 0.005, 0.18, out));
    a._o(t + 0.06, 'sine', 1568, 0.22, a._e(t + 0.06, 0.6, 0.005, 0.2, out));
    return 0.3;
  } },
  noteSuccess: { vol: 0.2, gap: 0.3, max: 1, vary: 0, reverb: 0.25, fn(a, t, out) {
    [72, 76, 79].forEach((m, i) => a._o(t + i * 0.07, 'triangle', mtof(m), 0.32, a._e(t + i * 0.07, 0.8, 0.004, 0.3, out)));
    return 0.5;
  } },
  noteWarn: { vol: 0.22, gap: 0.6, max: 1, vary: 0, fn(a, t, out) {
    a._o(t, 'square', 587, 0.11, a._f(t, 'lowpass', 2000, 1, a._e(t, 0.7, 0.004, 0.1, out)));
    a._o(t + 0.14, 'square', 440, 0.15, a._f(t + 0.14, 'lowpass', 2000, 1, a._e(t + 0.14, 0.7, 0.004, 0.14, out)));
    return 0.3;
  } },
  noteTier: { vol: 0.28, gap: 0.8, max: 1, vary: 0, reverb: 0.5, fn(a, t, out) {
    for (const m of [60, 67, 72, 76]) a._o(t, 'sine', mtof(m), 1.5, a._e(t, 0.3, 0.05, 1.4, out));
    [84, 88, 91].forEach((m, i) => a._bell(t + 0.15 + i * 0.09, mtof(m), 0.25, 0.8, out));
    return 1.6;
  } },
  tierUp: { vol: 0.45, gap: 1, max: 1, vary: 0, reverb: 0.6, stinger: true, fn(a, t, out) {
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.4);
    g.gain.setTargetAtTime(0.0001, t + 1.4, 0.6);
    const lp = a._f(t, 'lowpass', 300, 2, g);
    lp.frequency.exponentialRampToValueAtTime(5000, t + 1.2);
    lp.frequency.exponentialRampToValueAtTime(800, t + 3.2);
    for (const m of [48, 55, 60, 64, 67]) {
      a._o(t, 'sawtooth', mtof(m), 3.6, lp);
      a._o(t, 'sawtooth', mtof(m) * 1.006, 3.6, lp);
    }
    [79, 84, 88, 91].forEach((m, i) => a._bell(t + 0.5 + i * 0.12, mtof(m), 0.3, 1.6, out));
    return 3.8;
  } },
  raidAlarm: { vol: 0.32, gap: 3, max: 1, vary: 0, stinger: true, fn(a, t, out, p) {
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.1);
    g.gain.setValueAtTime(0.5, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    const lp = a._f(t, 'lowpass', 2000, 1, g);
    const o = a._o(t, 'sawtooth', 520 * p, 2.6, lp);
    const o2 = a._o(t, 'square', 523 * p, 2.6, lp);
    for (let k = 0; k < 3; k++) {
      for (const osc of [o, o2]) {
        osc.frequency.linearRampToValueAtTime(820 * p, t + k * 0.8 + 0.4);
        osc.frequency.linearRampToValueAtTime(520 * p, t + k * 0.8 + 0.8);
      }
    }
    return 2.7;
  } },

  // -------------------------------------------------------------- ship
  landing: { vol: 0.4, gap: 1, max: 1, ref: 30, vary: 0, fn(a, t, out) {
    const len = CONFIG.ship.landingDuration;
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.3);
    g.gain.setValueAtTime(0.8, t + len - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const bp = a._f(t, 'bandpass', 1800, 0.8, g);
    bp.frequency.exponentialRampToValueAtTime(300, t + len);
    a._n(t, len, bp);
    a._o(t, 'sine', 70, len, a._f(t, 'lowpass', 200, 0.7, g));
    return len;
  } },
  touchdown: { vol: 0.45, gap: 1, max: 1, ref: 30, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 120 * p, 0.27, a._e(t, 1, 0.003, 0.25, out));
    o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    a._n(t + 0.05, 0.6, a._f(t + 0.05, 'highpass', 2000, 0.7, a._e(t + 0.05, 0.3, 0.02, 0.55, out)));
    a._o(t + 0.05, 'square', 300 * p, 0.05, a._f(t + 0.05, 'bandpass', 1200, 2, a._e(t + 0.05, 0.6, 0.001, 0.04, out)));
    return 0.7;
  } },
  takeoff: { vol: 0.45, gap: 1, max: 1, ref: 30, vary: 0, fn(a, t, out) {
    const len = CONFIG.ship.takeoffDuration + 0.4;
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const bp = a._f(t, 'bandpass', 300, 0.8, g);
    bp.frequency.exponentialRampToValueAtTime(2200, t + len);
    a._n(t, len, bp);
    const o = a._o(t, 'sine', 50, len, g);
    o.frequency.exponentialRampToValueAtTime(110, t + len);
    return len;
  } },
  hatch: { vol: 0.3, gap: 0.5, max: 1, ref: 25, fn(a, t, out, p) {
    a._n(t, 0.35, a._f(t, 'highpass', 2500, 0.7, a._e(t, 0.6, 0.02, 0.32, out)));
    const o = a._o(t + 0.3, 'sine', 180 * p, 0.12, a._e(t + 0.3, 1, 0.002, 0.1, out));
    o.frequency.exponentialRampToValueAtTime(90, t + 0.4);
    return 0.45;
  } },
  scrape: { vol: 0.4, gap: 0.25, max: 1, ref: 30, fn(a, t, out, p) {
    a._n(t, 0.38, a._f(t, 'bandpass', 900 * p, 4, a._e(t, 1, 0.01, 0.35, out)));
    a._o(t, 'sawtooth', 70 * p, 0.38, a._f(t, 'lowpass', 400, 1, a._e(t, 0.5, 0.01, 0.35, out)));
    return 0.4;
  } },

  // --------------------------------------------------------- Tech Moon
  moonBeam: { vol: 0.55, gap: 0.3, max: 2, ref: 70, reverb: 0.4, fn(a, t, out, p) {
    const lp = a._f(t, 'lowpass', 5000, 1, a._e(t, 0.8, 0.005, 0.9, out));
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.9);
    const o = a._o(t, 'sawtooth', 1800 * p, 0.95, lp);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.9);
    const s = a._o(t, 'sine', 3000 * p, 0.55, a._e(t, 0.3, 0.003, 0.5, out));
    s.frequency.exponentialRampToValueAtTime(800, t + 0.5);
    a._n(t, 0.6, a._f(t, 'bandpass', 4000, 1, a._e(t, 0.4, 0.003, 0.55, out)));
    const b = a._o(t, 'sine', 90, 0.4, a._e(t, 1, 0.003, 0.35, out));
    b.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    return 1;
  } },
  guardianBeam: { vol: 0.28, gap: 0.12, max: 3, ref: 50, reverb: 0.2, fn(a, t, out, p) {
    const o = a._o(t, 'sawtooth', 1300 * p, 0.37, a._f(t, 'lowpass', 3500, 1, a._e(t, 0.8, 0.003, 0.35, out)));
    o.frequency.exponentialRampToValueAtTime(200, t + 0.35);
    const s = a._o(t, 'sine', 2600 * p, 0.27, a._e(t, 0.3, 0.003, 0.25, out));
    s.frequency.exponentialRampToValueAtTime(900, t + 0.25);
    return 0.4;
  } },
  moonWarp: { vol: 0.5, gap: 1, max: 1, vary: 0, reverb: 0.6, stinger: true, fn(a, t, out, p) {
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    const s = a._o(t, 'sine', 40 * p, 3.2, g);
    s.frequency.exponentialRampToValueAtTime(110 * p, t + 1.5);
    s.frequency.exponentialRampToValueAtTime(35 * p, t + 3.1);
    const lp = a._f(t, 'lowpass', 200, 3, g);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 1.5);
    lp.frequency.exponentialRampToValueAtTime(200, t + 3.1);
    a._o(t, 'sawtooth', 80 * p, 3.2, a._gain(0.35, lp));
    a._n(t, 3.2, a._gain(0.4, lp));
    return 3.3;
  } },
  beamDown: { vol: 0.35, gap: 1, max: 1, ref: 60, reverb: 0.5, fn(a, t, out) {
    const o = a._o(t, 'sine', 400, 0.8, a._e(t, 0.5, 0.05, 0.7, out));
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.7);
    for (let k = 0; k < 6; k++) a._bell(t + 0.06 * k, mtof(BELLS[Math.floor(Math.random() * BELLS.length)] + 12), 0.25, 0.6, out);
    return 1.1;
  } },
  capsule: { vol: 0.5, gap: 2, max: 1, ref: 60, vary: 0, reverb: 0.3, fn(a, t, out) {
    const drop = CONFIG.techMoon.architect.dropTime;
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + drop * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + drop);
    const bp = a._f(t, 'bandpass', 3000, 1.2, g);
    bp.frequency.exponentialRampToValueAtTime(400, t + drop);
    a._n(t, drop, bp);
    const hit = t + drop - 0.05;
    const o = a._o(hit, 'sine', 110, 0.65, a._e(hit, 1.2, 0.004, 0.6, out));
    o.frequency.exponentialRampToValueAtTime(35, hit + 0.6);
    a._n(hit, 0.5, a._f(hit, 'lowpass', 1500, 0.7, a._e(hit, 0.8, 0.004, 0.45, out)));
    return drop + 0.7;
  } },

  // ---------------------------------------------------------- the Brood
  acidSpit: { vol: 0.26, gap: 0.06, max: 4, vary: 0.2, fn(a, t, out, p) {
    const bp = a._f(t, 'bandpass', 1400 * p, 2, a._e(t, 1, 0.004, 0.18, out));
    bp.frequency.exponentialRampToValueAtTime(380 * p, t + 0.18);
    a._n(t, 0.2, bp);
    const o = a._o(t + 0.03, 'sine', 240 * p, 0.14, a._e(t + 0.03, 0.6, 0.004, 0.12, out));
    o.frequency.exponentialRampToValueAtTime(90 * p, t + 0.16);
    return 0.24;
  } },
  sporeShot: { vol: 0.32, gap: 0.08, max: 3, vary: 0.15, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 160 * p, 0.2, a._e(t, 1, 0.004, 0.18, out));
    o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    a._n(t + 0.02, 0.3, a._f(t, 'highpass', 2500, 0.7, a._e(t + 0.02, 0.4, 0.01, 0.26, out)));
    return 0.34;
  } },
  broodHatch: { vol: 0.3, gap: 0.12, max: 3, vary: 0.25, fn(a, t, out, p) {
    const bp = a._f(t, 'bandpass', 600 * p, 3, a._e(t, 1, 0.01, 0.3, out));
    bp.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.3);
    a._n(t, 0.32, bp);
    const o = a._o(t, 'triangle', 110 * p, 0.3, a._e(t, 0.5, 0.01, 0.28, out));
    o.frequency.exponentialRampToValueAtTime(70, t + 0.28);
    return 0.36;
  } },
  seekerCall: { vol: 0.3, gap: 2, max: 1, ref: 60, vary: 0.05, reverb: 0.5, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 520 * p, 1.8, a._e(t, 1, 0.15, 1.6, out));
    o.frequency.linearRampToValueAtTime(880 * p, t + 0.6);
    o.frequency.linearRampToValueAtTime(410 * p, t + 1.7);
    a._o(t, 'sine', 9, 1.8, a._gain(40, o.frequency));   // eerie warble
    a._o(t, 'sine', 780 * p, 1.6, a._e(t, 0.3, 0.2, 1.3, out));
    return 1.9;
  } },
  broodRoar: { vol: 0.6, gap: 3, max: 1, vary: 0, reverb: 0.6, stinger: true, fn(a, t, out, p) {
    const len = 3.2;
    const g = a._gain(0, out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = a._f(t, 'lowpass', 300 * p, 4, g);
    lp.frequency.linearRampToValueAtTime(900 * p, t + 0.8);
    lp.frequency.exponentialRampToValueAtTime(150, t + len);
    for (const f of [46, 47.5, 69]) {
      const o = a._o(t, 'sawtooth', f * p, len, lp);
      o.frequency.linearRampToValueAtTime(f * p * 0.8, t + len);
      a._o(t, 'sine', 6 + f / 20, len, a._gain(f * 0.06, o.frequency));   // growl vibrato
    }
    a._n(t, len, a._gain(0.5, a._f(t, 'bandpass', 500 * p, 1.5, g)));
    return len + 0.2;
  } },

  // ----------------------------------------------------- planet life
  critter: { vol: 0.09, gap: 0.4, max: 2, vary: 0.4, fn(a, t, out, p) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const d = k * 0.09;
      const o = a._o(t + d, 'sine', 2000 * p, 0.06, a._e(t + d, 1, 0.005, 0.05, out));
      o.frequency.exponentialRampToValueAtTime(2800 * p, t + d + 0.05);
    }
    return n * 0.09 + 0.1;
  } },
  lavaBlub: { vol: 0.14, gap: 0.3, max: 2, vary: 0.3, fn(a, t, out, p) {
    const o = a._o(t, 'sine', 70 * p, 0.17, a._e(t, 1, 0.01, 0.15, out));
    o.frequency.exponentialRampToValueAtTime(140 * p, t + 0.15);
    a._n(t, 0.2, a._f(t, 'lowpass', 400, 1, a._e(t, 0.6, 0.01, 0.18, out)));
    return 0.22;
  } },
  iceCreak: { vol: 0.08, gap: 1, max: 1, vary: 0.3, fn(a, t, out, p) {
    const o = a._o(t, 'sawtooth', 180 * p, 0.45, a._f(t, 'bandpass', 1200, 8, a._e(t, 1, 0.05, 0.38, out)));
    o.frequency.exponentialRampToValueAtTime(140 * p, t + 0.4);
    return 0.46;
  } },
};

/** Which shot sound each unit / enemy type makes. */
export const SHOT_SOUND = {
  soldier: 'laser', scoutDrone: 'laser', architect: 'laser', combatBot: 'heavyLaser', fighter: 'heavyLaser',
  crawler: 'bite', rogueDrone: 'enemyLaser', rogueWalker: 'heavyEnemy',
  skitter: 'bite', ravager: 'bite', spitter: 'acidSpit', wasp: 'acidSpit', sporeSpitter: 'sporeShot', broodHive: 'sporeShot',
};

// ============================================================ AudioSystem
export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.settings = this._loadSettings();
    this.voices = new Map();          // sound name → { last, active }
    this.activeVoices = 0;
    this.lastStinger = -9;
    this.listener = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.music = { next: 0, idx: 0, mode: null, root: 45, beat: 0, beatAt: 0 };
    this.walk = { phase: 0, grounded: true, workT: 0 };
    this._bindMenu();
    // The context may only start after a user gesture.
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
  }

  // ============================================================ settings
  _loadSettings() {
    const A = CONFIG.audio;
    const s = { master: A.master, music: A.music, sfx: A.sfx, muted: false };
    try { Object.assign(s, JSON.parse(localStorage.getItem(A.storageKey) || '{}')); } catch { /* defaults */ }
    return s;
  }

  _saveSettings() {
    try { localStorage.setItem(CONFIG.audio.storageKey, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  /** Volume sliders in the pause menu. */
  _bindMenu() {
    for (const key of ['master', 'music', 'sfx']) {
      const el = document.getElementById('vol-' + key);
      if (!el) continue;
      el.value = Math.round(this.settings[key] * 100);
      el.addEventListener('input', () => {
        this.settings[key] = el.value / 100;
        if (key === 'master') this.settings.muted = false;
        this._applyVolumes();
        this._saveSettings();
      });
      // a sample so the new level can be heard
      el.addEventListener('change', () => { if (key !== 'music') this.play('collect_crystal'); });
    }
    this._showMuted();
  }

  _showMuted() {
    const el = document.getElementById('mute-state');
    if (el) el.textContent = this.settings.muted ? 'Sound muted — press K' : 'K mutes the sound';
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this._applyVolumes();
    this._saveSettings();
    this._showMuted();
    this.game.hud.notify(this.settings.muted ? 'Sound muted (K)' : 'Sound on (K)', 'info');
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    for (const [bus, verb, v] of [[this.musicBus, this.musicVerb, s.music], [this.sfxBus, this.sfxVerb, s.sfx]]) {
      bus.gain.setTargetAtTime(v, t, 0.05);
      verb.gain.setTargetAtTime(v, t, 0.05);
    }
  }

  // =============================================================== graph
  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();   // keeps big battles from clipping
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = this._gain(0, this.master);
    this.sfxBus = this._gain(0, this.master);
    this.ambBus = this._gain(1, this.sfxBus);
    // Procedural reverb (decaying noise impulse) shared by music and big effects.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverb.connect(this._gain(0.9, this.master));
    // Reverb sends follow their bus volume (so the music slider also turns down the music's echo).
    this.musicVerb = this._gain(0, this.reverb);
    this.sfxVerb = this._gain(0, this.reverb);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this._applyVolumes();
    this._buildLoops();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Continuous sounds, faded in and out every frame by _updateLoops(). */
  _buildLoops() {
    const ctx = this.ctx;
    const L = (this.loops = {});
    // --- ship engine: two detuned saws + sub through a lowpass, plus hiss and a boost whine
    const eng = this._gain(0, this.ambBus);
    const engPan = ctx.createStereoPanner();
    engPan.connect(eng);
    const lp = this._f(0, 'lowpass', 400, 2, engPan);
    const o1 = this._loopOsc('sawtooth', 50, lp), o2 = this._loopOsc('sawtooth', 50.6, lp);
    const sub = this._loopOsc('sine', 25, this._gain(0.8, lp));
    const hissBp = this._f(0, 'bandpass', 1000, 0.7, null);
    const hiss = this._gain(0, engPan);
    hissBp.connect(hiss);
    this._loopNoise(hissBp);
    const whine = this._gain(0, engPan);
    const wo = this._loopOsc('sine', 600, whine);
    L.engine = { gain: eng, pan: engPan, lp, o1, o2, sub, hissBp, hiss, whine, wo };
    // --- wind: noise through a band-pass whose centre drifts slowly
    const wind = this._gain(0, this.ambBus);
    const wbp = this._f(0, 'bandpass', 650, 0.8, wind);
    this._loopNoise(wbp);
    const lfo = this._loopOsc('sine', 0.13, this._gain(260, wbp.frequency));
    L.wind = { gain: wind, bp: wbp, lfo };
    // --- deep rumble (volcanic worlds, landing / take-off)
    const rumble = this._gain(0, this.ambBus);
    this._loopNoise(this._f(0, 'lowpass', 120, 0.7, rumble));
    L.rumble = { gain: rumble };
    // --- Tech Moon hum
    const hum = this._gain(0, this.ambBus);
    const hlp = this._f(0, 'lowpass', 420, 1, hum);
    for (const [f, g] of [[55, 0.6], [82.5, 0.35], [110.4, 0.25], [164.8, 0.12]]) this._loopOsc('sine', f, this._gain(g, hlp));
    L.hum = { gain: hum };
  }

  // ============================================================ helpers
  _gain(value, dest) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  /** Oscillator from t for dur seconds. */
  _o(t, type, freq, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  /** White noise from t for dur seconds. */
  _n(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.connect(dest);
    s.start(t, Math.random() * 1.9);
    s.stop(t + dur + 0.05);
    return s;
  }

  /** Gain envelope: exponential attack to `peak`, then decay to silence. */
  _e(t, peak, attack, decay, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  _f(t, type, freq, q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  /** Bell: sine plus an inharmonic partial, long decay. */
  _bell(t, freq, peak, decay, dest) {
    this._o(t, 'sine', freq, decay + 0.05, this._e(t, peak, 0.004, decay, dest));
    this._o(t, 'sine', freq * 2.76, decay * 0.5, this._e(t, peak * 0.25, 0.003, decay * 0.45, dest));
  }

  _loopOsc(type, freq, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start();
    return o;
  }

  _loopNoise(dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.connect(dest);
    s.start(0, Math.random() * 1.9);
    return s;
  }

  // ========================================================= one-shots
  /**
   * Play a sound. opts: { at: world position, volume, pitch, pan, tone }.
   * Positioned sounds fade with distance from the listener and are skipped
   * when too far. Each sound has a minimum gap and a voice limit, so a big
   * battle can't flood the mixer.
   */
  play(name, opts = {}) {
    if (!this.ready || this.settings.muted) return;
    const R = SOUNDS[name];
    if (!R) return;
    const ctx = this.ctx, now = ctx.currentTime;
    let v = this.voices.get(name);
    if (!v) this.voices.set(name, (v = { last: -9, active: 0 }));
    if (now - v.last < (R.gap ?? 0.03) || v.active >= (R.max ?? 4) || this.activeVoices >= CONFIG.audio.maxVoices) return;
    let gain = (R.vol ?? 0.5) * (opts.volume ?? 1), pan = opts.pan ?? 0;
    if (opts.at) {
      const s = this._spatial(opts.at, R.ref ?? CONFIG.audio.refDistance);
      if (!s) return;
      gain *= s.gain;
      pan = s.pan;
    }
    if (gain < 0.004) return;
    const out = this._gain(gain, null);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    out.connect(panner).connect(this.sfxBus);
    let send = null;
    if (R.reverb) { send = this._gain(R.reverb, this.sfxVerb); out.connect(send); }
    const pitch = (opts.pitch ?? 1) * (1 + (Math.random() - 0.5) * 2 * (R.vary ?? 0.06));
    const dur = R.fn(this, now + 0.005, out, pitch, opts);
    if (R.stinger) this.lastStinger = now;
    v.last = now; v.active++; this.activeVoices++;
    setTimeout(() => {
      v.active--; this.activeVoices--;
      out.disconnect(); panner.disconnect(); send?.disconnect();
    }, (dur + 0.25) * 1000);
  }

  /** HUD notification beep (skipped right after a big stinger like the raid alarm). */
  notify(kind) {
    if (!this.ready || this.ctx.currentTime - this.lastStinger < 1.5) return;
    this.play({ success: 'noteSuccess', warn: 'noteWarn', tier: 'noteTier' }[kind] ?? 'noteInfo');
  }

  /** Distance attenuation + stereo pan for a world position (null = too far). */
  _spatial(pos, ref) {
    const A = CONFIG.audio;
    const d = this._d.copy(pos).sub(this.listener);
    const dist = d.length();
    if (dist > A.maxDistance * Math.max(1, ref / A.refDistance)) return null;
    const gain = 1 / (1 + (dist / ref) ** 2);
    const pan = dist > 0.5 ? clamp(d.dot(this._right) / dist, -1, 1) * 0.75 : 0;
    return { gain, pan };
  }

  // ============================================================ per frame
  update(dt, paused) {
    if (!this.ready) return;
    const game = this.game;
    // Listener: the camera — in build mode a point just above the ground being viewed.
    if (game.mode === 'build') this.listener.copy(game.pose.target).addScaledVector(game.pose.up, 12);
    else this.listener.copy(game.camera.position);
    this._right.set(1, 0, 0).applyQuaternion(game.camera.quaternion);
    const planet = game.nearestPlanet(this.listener).planet;
    this._updateLoops(paused, planet);
    this._updateMusic(paused);
    if (paused) return;
    this._updateWalking(dt, planet);
    this._updateWork(dt, planet);
    this._updateAmbience(dt, planet);
  }

  _updateLoops(paused, planet) {
    const game = this.game, ship = game.ship, L = this.loops, t = this.ctx.currentTime;
    const set = (param, v, tc = 0.12) => param.setTargetAtTime(v, t, tc);
    const flying = MODES_FLYING.has(game.mode);
    const speedFrac = clamp(Math.abs(ship.speed) / (CONFIG.ship.maxSpeed * CONFIG.ship.boostMultiplier), 0, 1);
    const thrust = ship.thrust;
    const air = paused ? 0 : (game.space.air ?? 0);

    // engine: loud while flying, a quiet idle hum when landed nearby
    const s = paused ? null : this._spatial(ship.position, 30);
    const eg = s ? s.gain * (flying ? 0.035 + thrust * 0.14 : ship.landedPlanet ? 0.015 : 0) : 0;
    const E = L.engine;
    const f = 38 + thrust * 30 + speedFrac * 45;
    set(E.gain.gain, eg);
    set(E.pan.pan, s ? s.pan * 0.6 : 0);
    set(E.o1.frequency, f);
    set(E.o2.frequency, f * 1.012);
    set(E.sub.frequency, f / 2);
    set(E.lp.frequency, 250 + thrust * 900 + speedFrac * 1400 + (ship.boosting ? 1500 : 0));
    set(E.hiss.gain, 0.05 + thrust * 0.25 + speedFrac * 0.2);
    set(E.hissBp.frequency, 600 + speedFrac * 2500);
    set(E.whine.gain, ship.boosting ? 0.05 : 0);
    set(E.wo.frequency, 600 + speedFrac * 900);

    // wind: inside an atmosphere; stronger on dry / icy worlds and when flying fast
    const windy = planet ? WIND[planet.biomeKey] ?? 1 : 0;
    set(L.wind.gain.gain, air * windy * (0.09 + (flying ? speedFrac * 0.35 : 0)), 0.4);
    // rumble: volcanic ground, landing and take-off
    const shipRumble = (game.mode === 'landing' || game.mode === 'takeoff') && s ? 0.4 * s.gain : 0;
    set(L.rumble.gain.gain, (planet?.biomeKey === 'volcanic' ? air * 0.3 : 0) + shipRumble, 0.4);
    // Tech Moon hum near the moon
    const moon = game.techMoon;
    let hum = 0;
    if (!paused && moon.state !== 'none') {
      const k = clamp(1 - this.listener.distanceTo(moon.position) / 420, 0, 1);
      hum = 0.14 * k * k;
    }
    set(L.hum.gain.gain, hum, 0.3);
  }

  // ---------------------------------------------------------------- music
  /** Generative score: a chord every few seconds, bells on top, bass pulse during raids. */
  _updateMusic(paused) {
    const A = CONFIG.audio, m = this.music, t = this.ctx.currentTime;
    const raid = this.game.enemies.raid;
    const tension = !paused && (raid.active || (raid.warned && raid.timer > 0) || !!this.game.brood?.threatActive);
    if (m.next < t) m.next = t + 0.1;   // first chord, or after the tab was hidden
    if (t >= m.next - 0.25) {
      const mode = tension ? 'tension' : 'calm';
      if (mode !== m.mode) { m.mode = mode; m.idx = 0; }
      const prog = PROGRESSIONS[mode];
      const chord = prog[m.idx++ % prog.length];
      const len = tension ? A.tensionChordSeconds : A.musicChordSeconds;
      const air = this.game.space.air ?? 0, day = this.game.space.day ?? 0;
      const bright = tension ? 0.2 : 0.3 + 0.5 * air * day;
      this._pad(chord, m.next, len, bright);
      m.root = chord[0];
      if (!tension) {
        const bells = Math.floor(Math.random() * (2 + 2 * air * day));
        for (let k = 0; k < bells; k++) {
          this._bell(m.next + rand(0.5, len - 0.5), mtof(BELLS[Math.floor(Math.random() * BELLS.length)]), rand(0.025, 0.05), 3, this._musicOut(0.8));
        }
      }
      m.next += len;
    }
    // raid: pulsing bass in eighths with a soft kick on the beat
    if (tension) {
      if (m.beatAt < t) m.beatAt = t + 0.05;
      while (m.beatAt < t + 0.2) {
        this._bass(m.beatAt, m.root, m.beat % 2 === 0);
        m.beat++;
        m.beatAt += A.tensionStep;
      }
    }
  }

  /** A gain into the music bus with some of it sent to the reverb. */
  _musicOut(reverb, dest = this.musicBus) {
    const g = this._gain(1, dest);
    const send = this._gain(reverb, this.musicVerb);
    g.connect(send);
    setTimeout(() => { g.disconnect(); send.disconnect(); }, 16000);
    return g;
  }

  _pad(notes, t0, len, bright) {
    const attack = Math.min(3, len * 0.4), release = 4;
    const out = this._musicOut(0.7);
    const g = this._gain(0, out);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.4, t0 + attack);
    g.gain.setValueAtTime(0.4, t0 + len);
    g.gain.setTargetAtTime(0, t0 + len, release / 3);
    const base = 450 + bright * 1000;
    const lp = this._f(t0, 'lowpass', base, 0.6, g);
    lp.frequency.linearRampToValueAtTime(base * 1.6, t0 + len * 0.6);
    lp.frequency.linearRampToValueAtTime(base, t0 + len + release);
    const end = len + release;
    for (const n of notes) {
      const fr = mtof(n);
      this._o(t0, 'triangle', fr, end, this._gain(0.22, lp));
      this._o(t0, 'sawtooth', fr * 1.004, end, this._gain(0.06, lp));
    }
  }

  _bass(t, root, accent) {
    const out = this._musicOut(0.15);
    const fr = mtof(root - 12);
    const lp = this._f(t, 'lowpass', accent ? 520 : 340, 4, this._e(t, accent ? 0.32 : 0.22, 0.005, 0.2, out));
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.2);
    this._o(t, 'sawtooth', fr, 0.22, lp);
    if (accent) {
      const k = this._o(t, 'sine', 95, 0.2, this._e(t, 0.5, 0.003, 0.18, out));
      k.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    }
  }

  // --------------------------------------------------- footsteps & work
  _updateWalking(dt, planet) {
    const game = this.game, pl = game.player, w = this.walk;
    if (game.mode !== 'walking' || !pl.planet) { w.grounded = true; return; }
    const tone = STEP_TONE[pl.planet.biomeKey] ?? 1200;
    const step = Math.floor(pl.walkPhase / Math.PI);
    if (step !== w.phase) {
      w.phase = step;
      if (pl.grounded) this.play('footstep', { at: pl.position, tone });
    }
    if (w.grounded && !pl.grounded && pl.vVel > 1) this.play('jump', { at: pl.position });
    if (!w.grounded && pl.grounded) this.play('land', { at: pl.position, tone });
    w.grounded = pl.grounded;
    // harvesting (hold E) and dismantling (hold X): rhythmic tool sounds
    if (pl.action !== 'harvest') { w.workT = 0; return; }
    w.workT -= dt;
    if (w.workT > 0) return;
    w.workT = 0.32;
    const target = game.input.isDown('KeyE') ? game.harvest.target : null;
    if (target?.kind === 'node') this.play('mine_' + target.node.type);
    else if (target?.kind === 'animal') this.play('capture');
    else if (game.dismantle.target) this.play('wrench');
  }

  /** Units building or gathering near the listener make work noises. */
  _updateWork(dt, planet) {
    if (!planet) return;
    for (const a of this.game.units.actors) {
      if (a.faction !== 'player' || a.planet !== planet || a.moving) continue;
      if (a.state === 'build' && Math.random() < dt * 2.5) this.play('hammer', { at: a.worldPos });
      else if (a.state === 'gather' && a.task?.node && Math.random() < dt * 1.4) this.play('mine_' + a.task.node.type, { at: a.worldPos, volume: 0.7 });
    }
  }

  /** Little signs of life on the surface: critters, lava, cracking ice. */
  _updateAmbience(dt, planet) {
    const air = this.game.space.air ?? 0, day = this.game.space.day ?? 0;
    if (!planet || air < 0.3) return;
    const b = planet.biomeKey, r = Math.random(), pan = rand(-0.8, 0.8);
    if ((b === 'verdant' || b === 'aether') && day > 0.3) {
      if (r < dt * 0.35 * air) this.play('critter', { pan, volume: air, pitch: b === 'aether' ? 0.7 : 1 });
    } else if (b === 'volcanic') {
      if (r < dt * 0.4 * air) this.play('lavaBlub', { pan, volume: air });
    } else if (b === 'glacial') {
      if (r < dt * 0.12 * air) this.play('iceCreak', { pan, volume: air });
    }
  }
}
