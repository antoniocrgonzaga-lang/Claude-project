/**
 * Wildlife species (AnimalHerd in resources.js).
 *
 * Each planet picks a few species from the pool of its biome (SPECIES[type].biomes).
 * Models face +Z, stand on y = 0 and are animated in the vertex shader (rig.js):
 * legs walk, heads dip to graze while the animal stands still, tails and
 * tentacles sway. Many species have a biome-specific colouring (and name).
 *
 *   mooblet    – the original random blocky grazer (every planet's looks differ)
 *   hopjack    – giant rabbit that travels in long hops
 *   tigrex     – giant striped cat with glowing eyes; never runs away
 *   shellback  – armoured shell-back walker (obsidian with lava seams on volcanic worlds)
 *   tuskmoth   – woolly tusked giant of the ice worlds
 *   magmander  – six-legged salamander with glowing lava cracks
 *   glowstag   – elegant deer with luminous crystal antlers
 *   driftjelly – floating jellyfish that drifts over land and water
 */
import * as THREE from 'three';
import { box, part, merge } from './geometry.js';
import { RIG, RIG_GLOW, rig, rigMerge, rigMaterial, strut, sweptWing } from './rig.js';

export const ANIMAL_BODY = rigMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, flatShading: true }), 'animal');

const EYE = 0x111111, WHITE = 0xffffff;
const blob = (r, color, o = {}) => part(new THREE.DodecahedronGeometry(r, 0), color, o);
const bx = (w, h, d, color, o) => part(new THREE.BoxGeometry(w, h, d), color, o);

/** n + 1 points along a quadratic curve a → (pulled toward c) → b. */
function arc(a, c, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([0, 1, 2].map((k) => u * u * a[k] + 2 * u * t * c[k] + t * t * b[k]));
  }
  return out;
}
/** Tapering chain of struts through points. */
function limb(pts, t0, t1, color) {
  return pts.slice(0, -1).map((p, i) => strut(p, pts[i + 1], t0 + ((t1 - t0) * i) / Math.max(1, pts.length - 2), color));
}
/** Four legs swinging in a diagonal gait (pivot at the top of each leg). */
function legs4(x, zf, zb, top, w, color, paw, amp = 0.8) {
  return [[x, zf, 1], [-x, zf, -1], [x, zb, -1], [-x, zb, 1]].map(([lx, lz, ph]) => rig(merge([
    box(w, top, w * 1.1, color, lx, top / 2, lz),
    box(w * 1.2, 0.1, w * 1.45, paw, lx, 0.05, lz + w * 0.15),
  ]), RIG.SWING, ph * amp, [lx, top, lz]));
}
/** A pair of eyes (dark, with a tiny glint) at height y, depth z, half-spacing x. */
function eyes(x, y, z, size = 0.08) {
  return [-1, 1].flatMap((s) => [box(size, size * 1.2, 0.04, EYE, s * x, y, z), box(size * 0.35, size * 0.35, 0.02, WHITE, s * x + size * 0.15, y + size * 0.2, z + 0.025)]);
}
const out = (body, glow) => [{ geo: rigMerge(body), mat: ANIMAL_BODY }, ...(glow?.length ? [{ geo: rigMerge(glow), mat: RIG_GLOW }] : [])];

// ================================================================ models
const MODELS = {
  // The original random grazer: blocky body, snout, maybe ears / horns and glowing back spines.
  mooblet(pal, rng, biome) {
    const [body, accent] = pal;
    const bw = rng.range(0.8, 1.3), bh = rng.range(0.6, 0.95), bd = rng.range(1.1, 1.8);
    const leg = rng.range(0.35, 0.7), hs = rng.range(0.5, 0.75);
    const by = leg + bh / 2, hz = bd / 2 + hs * 0.35, hy = by + bh * 0.35;
    const head = [
      box(hs, hs, hs, body, 0, hy, hz),
      box(hs * 0.5, hs * 0.3, 0.12, accent, 0, by + bh * 0.25, bd / 2 + hs * 0.86),
      ...eyes(hs * 0.22, by + bh * 0.5, bd / 2 + hs * 0.86, 0.1),
    ];
    if (rng.chance(0.5)) for (const s of [-1, 1]) head.push(box(0.12, 0.3, 0.12, accent, s * hs * 0.3, hy + hs * 0.6, bd / 2 + hs * 0.3));
    const glow = [];
    if (biome === 'aether' || rng.chance(0.25)) glow.push(rig(merge([box(0.15, 0.25, 0.15, 0x6affea, 0, by + bh / 2 + 0.12, 0.2), box(0.15, 0.2, 0.15, 0x6affea, 0, by + bh / 2 + 0.1, -0.25)]), RIG.PULSE, 0, [0, by + bh / 2, 0]));
    return out([
      box(bw, bh, bd, body, 0, by, 0),
      rig(merge(head), RIG.NOD, 0.45, [0, by + bh * 0.2, bd / 2 - 0.05]),
      rig(box(0.2, 0.2, 0.4, accent, 0, by + bh * 0.2, -bd / 2 - 0.15), RIG.SWAY, 0.3, [0, by + bh * 0.2, -bd / 2]),
      ...legs4(bw / 2 - 0.15, bd / 2 - 0.2, -bd / 2 + 0.2, leg, 0.22, accent, accent, 0.9),
    ], glow);
  },

  // Hopjack: a giant rabbit — long ears, big hind feet (both swing together for a hop), cotton tail.
  hopjack({ fur, cream, pink }) {
    const NECK = [0, 1.05, 0.38];
    const head = rig(merge([
      blob(0.34, fur, { sz: 1.15, sy: 0.95, y: 1.32, z: 0.6 }),
      blob(0.2, cream, { sx: 1.25, sy: 0.8, y: 1.2, z: 0.86 }),
      box(0.11, 0.07, 0.06, pink, 0, 1.29, 1.03),
      box(0.12, 0.09, 0.04, WHITE, 0, 1.11, 0.99),
      ...eyes(0.19, 1.42, 0.84, 0.09),
      ...[-1, 1].flatMap((s) => [
        bx(0.17, 0.82, 0.08, fur, { rx: -0.3, rz: -s * 0.2, x: s * 0.16, y: 1.96, z: 0.47 }),
        bx(0.09, 0.62, 0.02, pink, { rx: -0.3, rz: -s * 0.2, x: s * 0.16, y: 1.96, z: 0.52 }),
        box(0.12, 0.012, 0.012, cream, s * 0.22, 1.2, 0.98), box(0.12, 0.012, 0.012, cream, s * 0.22, 1.16, 0.97),   // whiskers
      ]),
    ]), RIG.NOD, 0.55, NECK);
    const hind = [-1, 1].map((s) => rig(merge([
      blob(0.32, fur, { sx: 0.72, sz: 1.2, x: s * 0.38, y: 0.5, z: -0.25 }),
      box(0.25, 0.14, 0.68, fur, s * 0.38, 0.07, -0.02),
      box(0.2, 0.03, 0.5, cream, s * 0.38, 0.0, 0.0),
    ]), RIG.SWING, 1.25, [s * 0.38, 0.62, -0.3]));
    const front = [-1, 1].map((s) => rig(merge([
      box(0.14, 0.44, 0.16, fur, s * 0.2, 0.24, 0.42),
      box(0.18, 0.08, 0.24, cream, s * 0.2, 0.04, 0.48),
    ]), RIG.SWING, -1.1, [s * 0.2, 0.48, 0.4]));
    return out([
      blob(0.62, fur, { sy: 0.9, sz: 1.2, y: 0.78, z: -0.1 }),
      blob(0.42, cream, { sy: 1.1, y: 0.72, z: 0.3 }),
      rig(blob(0.18, cream, { y: 0.86, z: -0.84 }), RIG.SWAY, 0.15, [0, 0.86, -0.75]),
      head, ...hind, ...front,
    ]);
  },

  // Tigrex: a giant striped cat — shoulders, haunches, cheek ruff, a swaying tail and glowing eyes.
  tigrex({ coat, stripe, belly, eye }) {
    const NECK = [0, 1.22, 0.82];
    const stripes = [-0.78, -0.5, -0.22, 0.06, 0.34].map((z, i) => bx(0.84, 0.48, 0.07, stripe, { rx: i % 2 ? 0.25 : -0.2, y: 1.15, z }));
    const head = rig(merge([
      box(0.58, 0.48, 0.5, coat, 0, 1.32, 1.08),
      box(0.36, 0.22, 0.24, belly, 0, 1.17, 1.38),
      box(0.13, 0.08, 0.06, 0x3a2420, 0, 1.27, 1.51),
      box(0.24, 0.1, 0.2, belly, 0, 1.04, 1.3),
      ...[-1, 1].flatMap((s) => [
        box(0.12, 0.28, 0.32, belly, s * 0.32, 1.2, 1.08),                      // cheek ruff
        box(0.16, 0.17, 0.08, coat, s * 0.2, 1.62, 0.98), box(0.08, 0.1, 0.02, belly, s * 0.2, 1.6, 1.025),
        box(0.05, 0.16, 0.02, stripe, s * 0.12, 1.47, 1.335),
        box(0.16, 0.012, 0.012, WHITE, s * 0.26, 1.15, 1.42),                    // whiskers
      ]),
      box(0.05, 0.2, 0.02, stripe, 0, 1.48, 1.335),
      box(0.13, 0.08, 0.04, EYE, 0.15, 1.4, 1.33), box(0.13, 0.08, 0.04, EYE, -0.15, 1.4, 1.33),
    ]), RIG.NOD, 0.35, NECK);
    return out([
      box(0.74, 0.66, 1.6, coat, 0, 1.0, 0),
      box(0.8, 0.78, 0.55, coat, 0, 1.06, 0.62),                                 // shoulders
      box(0.78, 0.7, 0.5, coat, 0, 1.0, -0.62),                                  // haunches
      box(0.66, 0.12, 1.3, belly, 0, 0.66, 0.05),
      ...stripes, head,
      ...legs4(0.27, 0.62, -0.62, 0.9, 0.21, coat, belly, 0.9),
      rig(merge(limb([[0, 1.2, -0.82], [0, 1.02, -1.35], [0, 1.18, -1.85], [0, 1.42, -2.12]], 0.13, 0.09, coat)), RIG.SWAY, 0.32, [0, 1.2, -0.82]),
      rig(box(0.11, 0.11, 0.2, stripe, 0, 1.45, -2.16), RIG.SWAY, 0.32, [0, 1.2, -0.82]),
    ], [rig(merge([box(0.09, 0.05, 0.03, eye, 0.15, 1.4, 1.35), box(0.09, 0.05, 0.03, eye, -0.15, 1.4, 1.35)]), RIG.NOD, 0.35, NECK)]);
  },

  // Shellback: a slow, tough walker under a domed, ridged shell.
  shellback({ shell, plate, skin, glow }) {
    const NECK = [0, 0.6, 1.0];
    const ridge = [0.72, 0.26, -0.2, -0.66];
    const body = [
      blob(1.05, shell, { sy: 0.62, sz: 1.25, y: 0.82 }),
      box(1.85, 0.14, 2.25, plate, 0, 0.5, 0),
      ...ridge.map((z) => bx(0.5, 0.16, 0.36, plate, { rx: -z * 0.4, y: 1.44 - Math.abs(z) * 0.26, z })),
      ...[-1, 1].flatMap((s) => [0.5, -0.1, -0.7].map((z) => part(new THREE.ConeGeometry(0.1, 0.28, 4), plate, { rz: -s * 1.1, x: s * 0.88, y: 0.98, z }))),
      rig(merge([
        box(0.44, 0.36, 0.5, skin, 0, 0.62, 1.35),
        box(0.3, 0.2, 0.22, skin, 0, 0.55, 1.66),
        ...eyes(0.17, 0.7, 1.6, 0.07),
        part(new THREE.ConeGeometry(0.07, 0.24, 4), plate, { rx: 0.5, y: 0.84, z: 1.52 }),
      ]), RIG.NOD, 0.4, NECK),
      ...legs4(0.72, 0.7, -0.7, 0.5, 0.32, skin, skin, 0.6),
      rig(part(new THREE.ConeGeometry(0.14, 0.45, 5), skin, { rx: -Math.PI / 2 - 0.3, y: 0.45, z: -1.35 }), RIG.SWAY, 0.2, [0, 0.45, -1.15]),
    ];
    const seams = glow ? [rig(merge([
      ...[0.49, 0.03, -0.43].map((z) => box(0.56, 0.05, 0.07, glow, 0, 1.47 - Math.abs(z) * 0.26, z)),
      box(1.9, 0.04, 2.3, glow, 0, 0.58, 0),
    ]), RIG.PULSE, 0, [0, 1.0, 0])] : [];
    return out(body, seams);
  },

  // Tuskmoth: a woolly giant — shaggy hump, curved tusks, a trunk and frost on its back.
  tuskmoth({ fur, furD, tusk, skin }) {
    const NECK = [0, 2.2, 1.0];
    const shag = [];
    for (const x of [-0.6, 0, 0.6]) for (const z of [-0.8, -0.2, 0.4]) shag.push(box(0.32, 0.42, 0.34, furD, x, 1.02 + Math.abs(x) * 0.15, z));
    const head = rig(merge([
      blob(0.6, fur, { y: 2.15, z: 1.35 }),
      ...[-1, 1].flatMap((s) => [
        box(0.1, 0.5, 0.42, furD, s * 0.58, 2.18, 1.15),
        ...limb(arc([s * 0.3, 1.78, 1.8], [s * 0.62, 0.95, 2.35], [s * 0.26, 1.25, 2.95], 4), 0.13, 0.07, tusk),
      ]),
      ...eyes(0.3, 2.3, 1.84, 0.08),
      ...limb([[0, 1.95, 1.85], [0, 1.45, 2.08], [0, 0.95, 2.05], [0, 0.6, 2.2]], 0.22, 0.12, skin),     // trunk
    ]), RIG.NOD, 0.22, NECK);
    return out([
      blob(1.15, fur, { sy: 0.85, sz: 1.3, y: 1.75, z: -0.1 }),
      blob(0.72, fur, { y: 2.55, z: 0.35 }),
      ...shag, head,
      ...legs4(0.55, 0.75, -0.85, 1.35, 0.42, furD, skin, 0.6),
      ...[[0.2, 3.1, 0.4], [-0.25, 3.0, 0.1], [0.1, 2.75, -0.6], [-0.15, 2.6, -1.0]].map(([x, y, z]) => box(0.3, 0.1, 0.3, 0xeef4ff, x, y, z)),   // frost
      rig(merge(limb([[0, 1.9, -1.55], [0, 1.5, -1.75], [0, 1.2, -1.75]], 0.08, 0.05, furD)), RIG.SWAY, 0.25, [0, 1.9, -1.55]),
    ]);
  },

  // Magmander: a six-legged salamander — basalt skin split by glowing lava cracks and a burning crest.
  magmander({ skin, dark, lava }) {
    const NECK = [0, 0.5, 0.75];
    const legs = [];
    [0.55, 0.0, -0.55].forEach((z, k) => {
      for (const s of [-1, 1]) {
        const gait = ((k % 2 === 0) === (s > 0) ? 0 : Math.PI) + (s < 0 ? Math.PI : 0);
        const hip = [s * 0.32, 0.45, z], knee = [s * 0.72, 0.55, z + 0.1], foot = [s * 0.85, 0.02, z + 0.2];
        legs.push(rig(merge([strut(hip, knee, 0.13, skin), strut(knee, foot, 0.1, dark), box(0.2, 0.06, 0.24, dark, foot[0], 0.03, foot[2] + 0.06)]), RIG.LEG_Y, gait, hip));
      }
    });
    const tail = [[0, 0.45, -0.95], [0, 0.36, -1.55], [0.1, 0.28, -2.1], [0, 0.22, -2.6]];
    return out([
      blob(0.42, skin, { sx: 1.1, sy: 0.6, sz: 1.5, y: 0.5, z: 0.2 }),
      blob(0.36, dark, { sy: 0.55, sz: 1.2, y: 0.48, z: -0.55 }),
      ...legs,
      rig(merge([
        box(0.5, 0.28, 0.62, skin, 0, 0.53, 1.05),
        box(0.44, 0.1, 0.5, dark, 0, 0.36, 1.08),
        ...[-1, 1].map((s) => part(new THREE.ConeGeometry(0.07, 0.4, 4), dark, { rx: -1.9, x: s * 0.18, y: 0.72, z: 0.88 })),
      ]), RIG.NOD, 0.25, NECK),
      rig(merge(limb(tail, 0.32, 0.1, skin)), RIG.SWAY, 0.3, tail[0]),
    ], [
      rig(merge([box(0.1, 0.06, 0.03, lava, 0.16, 0.6, 1.365), box(0.1, 0.06, 0.03, lava, -0.16, 0.6, 1.365)]), RIG.NOD, 0.25, NECK),
      rig(merge([
        ...[0.6, 0.3, 0.0, -0.3, -0.6, -0.9].map((z, i) => part(new THREE.ConeGeometry(0.08, 0.26 - i * 0.02, 4), lava, { y: 0.82 - Math.abs(z + 0.15) * 0.12, z })),
        ...[-1, 1].flatMap((s) => [box(0.03, 0.04, 0.7, lava, s * 0.44, 0.5, 0.25), box(0.03, 0.04, 0.5, lava, s * 0.38, 0.48, -0.5)]),
      ]), RIG.PULSE, 0, [0, 0.6, 0]),
    ]);
  },

  // Glowstag: a slender deer with luminous crystal antlers and glowing spots along its back.
  glowstag({ coat, coatD, belly, crystal }) {
    const NECK = [0, 1.55, 0.6];
    const antlers = [-1, 1].flatMap((s) => [
      ...limb([[s * 0.1, 2.35, 0.95], [s * 0.3, 2.85, 0.82], [s * 0.55, 3.2, 0.7]], 0.06, 0.04, crystal),
      strut([s * 0.3, 2.85, 0.82], [s * 0.2, 3.25, 0.98], 0.04, crystal),
      strut([s * 0.43, 3.02, 0.76], [s * 0.72, 3.05, 0.95], 0.035, crystal),
      part(new THREE.OctahedronGeometry(0.08), crystal, { sy: 1.8, x: s * 0.55, y: 3.25, z: 0.7 }),
      part(new THREE.OctahedronGeometry(0.06), crystal, { sy: 1.8, x: s * 0.2, y: 3.3, z: 0.98 }),
    ]);
    return out([
      box(0.55, 0.55, 1.3, coat, 0, 1.35, 0),
      box(0.6, 0.62, 0.45, coat, 0, 1.4, 0.5),
      box(0.45, 0.1, 1.1, belly, 0, 1.06, 0),
      rig(merge([
        strut([0, 1.5, 0.6], [0, 2.1, 0.85], 0.26, coat),
        box(0.3, 0.3, 0.55, coat, 0, 2.2, 1.05),
        box(0.2, 0.18, 0.2, coatD, 0, 2.12, 1.36),
        ...eyes(0.15, 2.27, 1.2, 0.07),
        ...[-1, 1].map((s) => bx(0.08, 0.26, 0.14, coat, { rz: s * 0.7, x: s * 0.22, y: 2.36, z: 0.92 })),
      ]), RIG.NOD, 0.5, NECK),
      ...legs4(0.18, 0.5, -0.5, 1.15, 0.12, coat, coatD, 1.0),
      rig(box(0.12, 0.2, 0.12, belly, 0, 1.5, -0.7), RIG.SWAY, 0.25, [0, 1.55, -0.65]),
    ], [
      rig(merge(antlers), RIG.NOD, 0.5, NECK),
      rig(merge([[0.12, 0.4], [-0.12, 0.1], [0.14, -0.2], [-0.1, -0.45]].map(([x, z]) => box(0.1, 0.03, 0.1, crystal, x, 1.63, z))), RIG.PULSE, 0, [0, 1.63, 0]),
    ]);
  },

  // Driftjelly: a floating jellyfish — breathing bell, glowing core and spots, swaying tentacles, little fins.
  driftjelly({ bell, bellD, glow }) {
    const B = [0, 2.6, 0];
    const tentacles = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return rig(merge(limb([[c * 0.5, 2.2, s * 0.5], [c * 0.6, 1.5, s * 0.6], [c * 0.45, 0.85, s * 0.45], [c * 0.55, 0.3, s * 0.55]], 0.09, 0.04, bellD)), RIG.SWAY, 0.3, [c * 0.5, 2.2, s * 0.5]);
    });
    const tips = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return rig(box(0.08, 0.08, 0.08, glow, Math.cos(a) * 0.55, 0.3, Math.sin(a) * 0.55), RIG.SWAY, 0.3, [Math.cos(a) * 0.5, 2.2, Math.sin(a) * 0.5]);
    });
    return out([
      rig(merge([
        blob(0.9, bell, { sy: 0.75, y: 2.6 }),
        ...[...Array(8)].map((_, i) => { const a = (i / 8) * Math.PI * 2; return box(0.32, 0.12, 0.12, bellD, Math.cos(a) * 0.82, 2.2, Math.sin(a) * 0.82, { ry: Math.PI / 2 - a }); }),
        ...eyes(0.25, 2.55, 0.86, 0.09),
      ]), RIG.BREATHE, 0.06, B),
      ...tentacles,
      ...[-1, 1].map((s) => rig(sweptWing([[0.75, 0.25], [1.25, 0.05], [1.3, -0.35], [0.75, -0.25]], s, 0.03, 2.45, bellD), RIG.FLAP, s * 0.35, [s * 0.75, 2.45, 0])),
    ], [
      rig(blob(0.42, glow, { sy: 0.8, y: 2.5 }), RIG.PULSE, 0, [0, 2.5, 0]),
      rig(merge([[0.4, 3.05, 0.3], [-0.45, 2.95, 0.25], [0.1, 3.15, -0.4], [-0.3, 2.85, -0.55], [0.55, 2.75, -0.35]].map(([x, y, z]) => box(0.09, 0.09, 0.09, glow, x, y, z))), RIG.BREATHE, 0.06, B),
      ...tips,
    ]);
  },
};

// ============================================================= catalogue
/**
 * biomes   relative chance to appear on a planet of that biome
 * palettes colouring per biome (falls back to `default`); `name` overrides the species name there
 * food     × CONFIG.animals.foodYield when captured
 * skittish chance a herd runs from the astronaut · speed × CONFIG.animals.walkSpeed / fleeSpeed
 * size     × the random instance scale · hop [height m, rate] · float (hover height, crosses water)
 */
export const SPECIES = {
  mooblet: {
    names: ['Glorp', 'Mooblet', 'Trundle', 'Fluffin', 'Snorx', 'Bramble'],
    biomes: { verdant: 1, arid: 0.4, aether: 0.6 },
    palettes: { default: [[0xf5e6c8, 0x8a5a3b], [0xd9d9e8, 0x5a5a7a], [0xffb38a, 0x7a3b2b], [0xa6e3a1, 0x3b6b3b], [0xc9a6ff, 0x4b3b7a], [0x9fe8ff, 0x2f5f7a]] },
    food: 1, skittish: 0.5, speed: 1, hop: [0.3, 2.2],
  },
  hopjack: {
    name: 'Hopjack', biomes: { verdant: 1, arid: 0.8, glacial: 1 },
    palettes: {
      default: { fur: 0xa8805c, cream: 0xf2e6d0, pink: 0xf2a0b0 },
      arid: { fur: 0xd2a86e, cream: 0xf5e3c0, pink: 0xe89a88, name: 'Dune Hopjack' },
      glacial: { fur: 0xf2f4f8, cream: 0xd8e2ee, pink: 0xf0a6ba, name: 'Snow Hopjack' },
    },
    food: 1, skittish: 0.85, speed: 1.3, size: 1.1, hop: [0.9, 0.95],
  },
  tigrex: {
    name: 'Tigrex', biomes: { verdant: 1, arid: 0.8, glacial: 0.8 },
    palettes: {
      default: { coat: 0xe8862e, stripe: 0x241a14, belly: 0xf6ead8, eye: 0xffc23a },
      arid: { coat: 0xd9b26a, stripe: 0x7a5530, belly: 0xf3e4c4, eye: 0xffd24a, name: 'Dune Tigrex' },
      glacial: { coat: 0xeef1f5, stripe: 0x2a2e38, belly: 0xffffff, eye: 0x6ad8ff, name: 'Frost Tigrex' },
    },
    food: 1.6, skittish: 0, speed: 1.05, size: 1.05, hop: [0.12, 2.2],
  },
  shellback: {
    name: 'Shellback', biomes: { arid: 1.2, volcanic: 1 },
    palettes: {
      default: { shell: 0xc99a5b, plate: 0x8a5a32, skin: 0xb58a62 },
      volcanic: { shell: 0x2e2826, plate: 0x4a3a34, skin: 0x5a4a44, glow: 0xff7a2a, name: 'Obsidian Shellback' },
    },
    food: 1.8, skittish: 0, speed: 0.55, hop: [0.05, 1.5],
  },
  tuskmoth: {
    name: 'Tuskmoth', biomes: { glacial: 1.3 },
    palettes: { default: [{ fur: 0x8a6a52, furD: 0x6a4e3a, tusk: 0xf2ead8, skin: 0x5a4a44 }, { fur: 0xd8d2c8, furD: 0xb0a89c, tusk: 0xfff8e8, skin: 0x6a6460 }] },
    food: 3, skittish: 0, speed: 0.6, hop: [0.08, 1.4],
  },
  magmander: {
    name: 'Magmander', biomes: { volcanic: 1.3 },
    palettes: { default: { skin: 0x3a302c, dark: 0x221c1a, lava: 0xff6a1a } },
    food: 1.2, skittish: 0.5, speed: 1.1, hop: [0.04, 2.6],
  },
  glowstag: {
    name: 'Glowstag', biomes: { aether: 1 },
    palettes: { default: [{ coat: 0xb9a6e8, coatD: 0x6a5a9a, belly: 0xf0e8ff, crystal: 0x6affea }, { coat: 0x8fd6c8, coatD: 0x3f7a70, belly: 0xe8fff8, crystal: 0xff7ae8 }] },
    food: 1.3, skittish: 0.9, speed: 1.35, hop: [0.25, 2.0],
  },
  driftjelly: {
    name: 'Driftjelly', biomes: { aether: 1, verdant: 0.25 },
    palettes: { default: [{ bell: 0xff9ad8, bellD: 0xc0609a, glow: 0x9affff }, { bell: 0x9ad8ff, bellD: 0x5a8ac0, glow: 0xffe36a }] },
    food: 0.8, skittish: 0.3, speed: 0.7, float: 0.9, hop: [0, 1],
  },
};

/** Up to `count` different species for a biome, picked by weight. */
export function pickSpecies(rng, biome, count) {
  const pool = Object.entries(SPECIES).filter(([, s]) => s.biomes[biome]).map(([k, s]) => ({ k, w: s.biomes[biome] }));
  const out = [];
  while (out.length < count && pool.length) {
    let r = rng.random() * pool.reduce((t, p) => t + p.w, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
    out.push(pool.splice(i, 1)[0].k);
  }
  return out;
}

/** Build one species for a planet: { type, name, parts [{ geo, mat }], geometry (body), behaviour… }. */
export function buildSpecies(type, rng, biome) {
  const S = SPECIES[type];
  let pal = S.palettes[biome] ?? S.palettes.default;
  if (Array.isArray(pal)) pal = rng.pick(pal);   // several colourings: pick one per planet
  const parts = MODELS[type](pal, rng, biome);
  parts[0].geo.userData.shared = true;   // re-used by Ranch buildings: never disposed with them
  return {
    type,
    name: pal.name ?? S.name ?? rng.pick(S.names),
    parts,
    geometry: parts[0].geo,
    skittish: rng.chance(S.skittish),
    speedMul: S.speed * rng.range(0.85, 1.15),
    food: S.food,
    size: S.size ?? 1,
    hopHeight: S.hop[0],
    hopRate: S.hop[1],
    float: S.float ?? 0,
  };
}
