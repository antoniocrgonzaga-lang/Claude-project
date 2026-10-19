/**
 * Models of the Brood — the bio-alien faction (brood.js).
 *
 * Living creatures and organic structures in the same instanced, shader-
 * animated style as the other units (see rig.js): chitin plates, bone spikes
 * and sinew, with glowing biomass (magenta), acid (green) and resonance (violet).
 * Ground models stand on y = 0 and face +Z; flyers are centred on their origin.
 * Each model returns [body (casts shadows), glowing bits, optional flames].
 */
import * as THREE from 'three';
import { part, merge, paint } from './geometry.js';
import { RIG, RIG_BODY, RIG_GLOW, RIG_FLAME, rig, rigMerge, strut, sweptWing, flame } from './rig.js';

// palette
const CH = 0x4a2a64, CHD = 0x33204a, CHL = 0x6a3a8a;          // chitin
const FLESH = 0x9a4270, FLESH_D = 0x6a2a54, SINEW = 0x2c1a3a;
const BONE = 0xd9ccb4, BONE_D = 0xa8987c, EGG = 0x9a7468;
const BIO = 0xff3aa0, ACID = 0xb8ff3a, AMBER = 0xffb03a, VEIL = 0x9a7bff, EMBER = 0xb02a78;

// ------------------------------------------------------------ helpers
const blob = (r, color, o = {}) => part(new THREE.DodecahedronGeometry(r, 0), color, o);
const ico = (r, color, o = {}, detail = 0) => part(new THREE.IcosahedronGeometry(r, detail), color, o);
const V = (p) => new THREE.Vector3(...p);

/** Cone from `a` (base) pointing to `b` (tip). */
function spike(a, b, r, color, seg = 5) {
  const A = V(a), d = V(b).sub(A);
  const len = d.length();
  const g = new THREE.ConeGeometry(r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(A.x, A.y, A.z);
  return paint(g, color);
}

/** n + 1 points along a quadratic curve a → (pulled toward c) → b. */
function arc(a, c, b, n) {
  const A = V(a), C = V(c), B = V(b), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * A.x + 2 * u * t * C.x + t * t * B.x, u * u * A.y + 2 * u * t * C.y + t * t * B.y, u * u * A.z + 2 * u * t * C.z + t * t * B.z]);
  }
  return out;
}

/** Tapering chain of struts through points, optionally ending in a spike. */
function limb(pts, t0, t1, color, tip = 0) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const k = pts.length > 2 ? i / (pts.length - 2) : 0;
    out.push(strut(pts[i], pts[i + 1], t0 + (t1 - t0) * k, color));
  }
  if (tip) {
    const a = V(pts[pts.length - 2]), b = V(pts[pts.length - 1]);
    out.push(spike(pts[pts.length - 1], b.clone().add(b.clone().sub(a).normalize().multiplyScalar(tip)).toArray(), t1 * 0.6, color));
  }
  return out;
}

/** Roots spreading over the ground around a structure. */
function roots(n, r0, r1, thick, color = CHD, twist = 0.4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
    const b = a + twist * (i % 2 ? 1 : -1);
    const mid = (r0 + r1) / 2;
    out.push(...limb([
      [Math.cos(a) * r0, thick * 1.4, Math.sin(a) * r0],
      [Math.cos((a + b) / 2) * mid, thick * 0.9, Math.sin((a + b) / 2) * mid],
      [Math.cos(b) * r1, 0.02, Math.sin(b) * r1],
    ], thick, thick * 0.45, color));
  }
  return out;
}

/** Plate standing at angle `a` around the Y axis, its thin side facing out; `lean` tilts the top outward. */
function plate(w, h, d, color, a, r, y, lean) {
  return part(new THREE.BoxGeometry(w, h, d), color, { rx: lean, ry: Math.PI / 2 - a, x: Math.cos(a) * r, y, z: Math.sin(a) * r });
}

/** Insect leg (hip → knee → foot) that sweeps with the gait. */
function bugLeg(hip, knee, foot, t, gait, color = SINEW) {
  return rig(merge([strut(hip, knee, t, color), strut(knee, foot, t * 0.75, color), spike(knee, [knee[0] * 1.15, knee[1] + 0.25, knee[2]], t * 0.5, BONE)]), RIG.LEG_Y, gait, hip);
}

// ============================================================== models
export const BROOD_MODELS = {
  // Skitter: small, fast pack hunter — four sweeping legs and two bone scythes that slash when it attacks.
  skitter: () => {
    const legs = [];
    [[0.3, 0], [-0.3, Math.PI]].forEach(([z, off]) => {
      for (const s of [-1, 1]) {
        const dz = Math.sign(z);
        legs.push(bugLeg([s * 0.22, 0.5, z], [s * 0.6, 0.66, z + 0.12 * dz], [s * 0.74, 0.02, z + 0.28 * dz], 0.09, off + (s < 0 ? Math.PI : 0)));
      }
    });
    const scythes = [-1, 1].map((s) => rig(merge([
      strut([s * 0.2, 0.62, 0.42], [s * 0.36, 0.98, 0.66], 0.09, CH),
      strut([s * 0.36, 0.98, 0.66], [s * 0.3, 0.52, 1.1], 0.06, BONE),
      spike([s * 0.3, 0.52, 1.1], [s * 0.26, 0.24, 1.22], 0.045, BONE),
    ]), RIG.TOOL, s * 0.6, [s * 0.2, 0.62, 0.42]));
    return [
      { geo: rigMerge([
        ...legs, ...scythes,
        blob(0.42, CH, { sx: 0.9, sy: 0.7, sz: 1.25, y: 0.58, z: 0.05 }),
        part(new THREE.BoxGeometry(0.62, 0.08, 0.5), CHD, { rx: -0.15, y: 0.86, z: 0.18 }),
        part(new THREE.BoxGeometry(0.56, 0.08, 0.46), CHL, { rx: 0.2, y: 0.82, z: -0.26 }),
        blob(0.24, CHD, { sx: 1, sy: 0.8, sz: 1.3, y: 0.6, z: 0.62 }),                                  // head
        ...[-1, 1].map((s) => spike([s * 0.1, 0.52, 0.8], [s * 0.04, 0.44, 1.0], 0.04, BONE)),          // mandibles
        spike([0, 0.86, 0.42], [0, 1.28, 0.1], 0.07, BONE),                                             // crest
        ...[-1, 1].map((s) => spike([s * 0.18, 0.82, 0.22], [s * 0.34, 1.16, -0.08], 0.06, BONE)),
        strut([0, 0.6, -0.42], [0, 0.46, -0.86], 0.12, CH),                                             // tail
        spike([0, 0.46, -0.86], [0, 0.62, -1.22], 0.06, BONE),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        ...[-1, 1].map((s) => part(new THREE.BoxGeometry(0.07, 0.06, 0.04), AMBER, { x: s * 0.1, y: 0.65, z: 0.9 })),
        ...[-1, 1].map((s) => part(new THREE.BoxGeometry(0.05, 0.04, 0.04), AMBER, { x: s * 0.17, y: 0.7, z: 0.84 })),
        rig(merge([part(new THREE.BoxGeometry(0.06, 0.04, 0.55), BIO, { y: 0.93, z: 0.02 })]), RIG.PULSE, 0, [0, 0.93, 0]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Spitter: a hooded serpent that slithers on a segmented tail and spits acid from a glowing sac.
  spitter: () => {
    const tail = [0, 1, 2, 3, 4].map((i) => {
      const r = 0.32 - i * 0.045, z = -0.12 - i * 0.3;
      return rig(blob(r, i % 2 ? CH : CHD, { sx: 1.15, sy: 0.75, sz: 1.1, y: r * 0.75, z }), RIG.LEG_Y, i * 0.9, [0, r * 0.75, z + 0.3]);
    });
    const arms = [-1, 1].map((s) => rig(merge([
      strut([s * 0.24, 1.18, 0.34], [s * 0.42, 0.86, 0.56], 0.08, CH),
      spike([s * 0.42, 0.86, 0.56], [s * 0.36, 0.72, 0.92], 0.05, BONE),
    ]), RIG.SWING, s * 0.6, [s * 0.24, 1.18, 0.34]));
    const hood = [-1, 1].flatMap((s) => [
      part(new THREE.BoxGeometry(0.5, 0.78, 0.06), CHL, { ry: s * 0.5, rz: -s * 0.25, x: s * 0.3, y: 1.52, z: 0.18 }),
      spike([s * 0.48, 1.84, 0.04], [s * 0.74, 2.28, -0.18], 0.05, BONE),
      spike([s * 0.55, 1.46, 0.06], [s * 0.86, 1.6, -0.14], 0.05, BONE),
    ]);
    const torso = rig(merge([
      part(new THREE.CylinderGeometry(0.2, 0.3, 1.05, 6), CH, { rx: 0.15, y: 0.86, z: 0.18 }),
      ...[0.56, 0.76, 0.96, 1.16].map((y) => part(new THREE.BoxGeometry(0.26, 0.12, 0.06), BONE_D, { rx: 0.15, y, z: 0.4 + (y - 0.56) * 0.12 })),
      blob(0.26, CHD, { sx: 1, sy: 0.85, sz: 1.4, y: 1.55, z: 0.42 }),
      part(new THREE.BoxGeometry(0.24, 0.08, 0.4), CHD, { rx: 0.35, y: 1.38, z: 0.6 }),                 // lower jaw
      ...hood,
    ]), RIG.SWAY, 0.05, [0, 0.4, 0.1]);
    return [
      { geo: rigMerge([...tail, ...arms, torso]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(merge([
          ...[-1, 1].flatMap((s) => [
            part(new THREE.BoxGeometry(0.06, 0.05, 0.04), AMBER, { x: s * 0.1, y: 1.62, z: 0.76 }),
            part(new THREE.BoxGeometry(0.04, 0.04, 0.04), AMBER, { x: s * 0.17, y: 1.66, z: 0.7 }),
          ]),
          part(new THREE.BoxGeometry(0.16, 0.04, 0.12), ACID, { y: 1.45, z: 0.74 }),                     // acid in the mouth
        ]), RIG.SWAY, 0.05, [0, 0.4, 0.1]),
        rig(blob(0.22, ACID, { sx: 0.9, sy: 1.2, sz: 0.7, y: 1.0, z: -0.12 }), RIG.PULSE, 0, [0, 1.0, -0.12]),   // acid sac
      ]), mat: RIG_GLOW },
    ];
  },

  // Behemoth: a living siege beast — armoured scales, bone back-spikes and two huge kaiser blades that slam down.
  ravager: () => {
    const legs = [];
    for (const [z, fs] of [[0.9, 1], [-0.9, -1]]) {
      for (const s of [-1, 1]) {
        const hip = [s * 0.75, 1.5, z], knee = [s * 1.08, 0.92, z + 0.25], foot = [s * 1.02, 0.1, z + 0.1];
        legs.push(rig(merge([
          strut(hip, knee, 0.38, CH), strut(knee, foot, 0.3, CHD),
          ...[-0.18, 0, 0.18].map((dx) => spike([foot[0] + dx, 0.12, foot[2] + 0.1], [foot[0] + dx * 1.6, 0.02, foot[2] + 0.5], 0.07, BONE)),
          spike(knee, [knee[0] * 1.2, knee[1] + 0.3, knee[2] - 0.2], 0.1, BONE),
        ]), RIG.SWING, s * fs * 0.6, hip));
      }
    }
    const blades = [-1, 1].map((s) => rig(merge(
      limb(arc([s * 0.75, 2.0, 1.1], [s * 1.6, 3.0, 2.0], [s * 1.0, 1.25, 3.2], 4), 0.22, 0.1, BONE, 0.5),
    ), RIG.TOOL, s * 0.35, [s * 0.75, 2.0, 1.1]));
    const body = [
      ...legs, ...blades,
      blob(1.05, CH, { sx: 1.1, sy: 0.85, sz: 1.55, y: 1.78 }),
      blob(0.8, FLESH_D, { sx: 1.1, sy: 0.6, sz: 1.3, y: 1.32 }),                                     // belly
      ...[0, 1, 2, 3, 4].map((i) => part(new THREE.BoxGeometry(1.7 - 0.1 * i, 0.16, 0.62), i % 2 ? CHL : CHD,
        { rx: -0.25, y: 2.56 - Math.abs(i - 1.5) * 0.12, z: 1.0 - i * 0.5 })),                       // armour scales
      ...[0.6, 0, -0.6].map((z) => spike([0, 2.62, z], [0, 3.35, z - 0.35], 0.13, BONE)),
      ...[-1, 1].flatMap((s) => [0.5, -0.4].map((z) => spike([s * 0.9, 2.3, z], [s * 1.45, 2.8, z - 0.3], 0.09, BONE))),
      blob(0.55, CHD, { sx: 1.1, sy: 0.8, sz: 1.2, y: 1.3, z: 1.75 }),                                // head
      part(new THREE.BoxGeometry(0.7, 0.18, 0.6), CHD, { rx: 0.2, y: 0.95, z: 1.92 }),
      ...[-1, 1].map((s) => spike([s * 0.28, 1.0, 2.1], [s * 0.4, 1.05, 2.6], 0.07, BONE)),          // tusks
      strut([0, 1.72, -1.5], [0, 1.2, -2.3], 0.36, CH),                                              // tail
      spike([0, 1.2, -2.3], [0, 0.9, -3.0], 0.15, BONE),
    ];
    return [
      { geo: rigMerge(body), mat: RIG_BODY },
      { geo: rigMerge([
        ...[-1, 1].flatMap((s) => [0, 1, 2].map((k) => part(new THREE.BoxGeometry(0.08, 0.07, 0.05), AMBER, { x: s * (0.16 + k * 0.1), y: 1.42 + k * 0.05, z: 2.36 - k * 0.07 }))),
        rig(merge([0, 1, 2, 3].map((i) => part(new THREE.BoxGeometry(0.9, 0.05, 0.08), BIO, { rx: -0.25, y: 2.6 - Math.abs(i - 1.5) * 0.12, z: 0.75 - i * 0.5 }))), RIG.PULSE, 0, [0, 2.5, 0]),
        rig(merge([-1, 1].map((s) => blob(0.22, BIO, { x: s * 0.55, y: 1.15, z: 0.2 }))), RIG.PULSE, 1.5, [0, 1.15, 0.2]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Wasp: a fast bio-flyer on two pairs of leathery wings; spits acid glaives.
  wasp: () => {
    const wingA = [[0.2, 0.25], [1.6, 0.55], [1.95, 0.1], [1.25, -0.35], [0.2, -0.15]];
    const wingB = [[0.15, -0.05], [1.1, -0.2], [1.25, -0.6], [0.15, -0.4]];
    const wings = [-1, 1].flatMap((s) => [
      rig(merge([sweptWing(wingA, s, 0.03, 0.12, FLESH_D), strut([s * 0.2, 0.15, 0.2], [s * 1.6, 0.15, 0.55], 0.05, BONE)]), RIG.FLAP, s * 0.55, [s * 0.2, 0.12, 0.1]),
      rig(merge([sweptWing(wingB, s, 0.03, 0.08, FLESH), strut([s * 0.15, 0.1, -0.05], [s * 1.1, 0.1, -0.2], 0.04, BONE)]), RIG.FLAP, s * 0.42, [s * 0.15, 0.08, -0.1]),
    ]);
    return [
      { geo: rigMerge([
        ...wings,
        blob(0.24, CHD, { sz: 1.3, z: 0.7 }),
        blob(0.32, CH, { sy: 0.85, sz: 1.2, z: 0.25 }),
        blob(0.28, CH, { sz: 1.3, y: -0.05, z: -0.25 }),
        blob(0.22, CHD, { y: -0.15, z: -0.64 }),
        blob(0.16, CH, { y: -0.3, z: -0.94 }),
        spike([0, -0.32, -1.04], [0, -0.62, -1.44], 0.07, BONE),
        ...[-1, 1].map((s) => spike([s * 0.1, -0.05, 0.9], [s * 0.04, -0.14, 1.16], 0.04, BONE)),
        spike([0, 0.25, 0.4], [0, 0.55, 0.1], 0.06, BONE),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        ...[-1, 1].map((s) => part(new THREE.BoxGeometry(0.07, 0.05, 0.04), ACID, { x: s * 0.1, y: 0.06, z: 0.98 })),
        rig(blob(0.14, ACID, { y: -0.12, z: -0.62 }), RIG.PULSE, 0, [0, -0.12, -0.62]),
        part(new THREE.BoxGeometry(0.1, 0.04, 0.06), ACID, { y: -0.08, z: 1.0 }),
      ]), mat: RIG_GLOW },
    ];
  },

  // Seeker: a floating eye-bulb that scouts other worlds for colonies, trailing slow-swaying tendrils.
  seeker: () => {
    const tendrils = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return rig(merge(limb([[c * 0.4, -0.35, s * 0.4], [c * 0.55, -1.15, s * 0.55], [c * 0.42, -1.95, s * 0.42], [c * 0.5, -2.6, s * 0.5]], 0.12, 0.05, FLESH)), RIG.SWAY, 0.28, [c * 0.4, -0.35, s * 0.4]);
    });
    const tips = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return rig(part(new THREE.BoxGeometry(0.09, 0.09, 0.09), BIO, { x: c * 0.5, y: -2.6, z: s * 0.5 }), RIG.SWAY, 0.28, [c * 0.4, -0.35, s * 0.4]);
    });
    const fins = [-1, 1].map((s) => rig(sweptWing([[0.6, 0.3], [1.3, 0.1], [1.4, -0.4], [0.6, -0.3]], s, 0.03, -0.05, FLESH_D), RIG.FLAP, s * 0.3, [s * 0.6, 0, 0]));
    return [
      { geo: rigMerge([
        ...tendrils, ...fins,
        blob(0.75, FLESH_D, { sy: 0.8 }),
        blob(0.82, CH, { sy: 0.45, y: 0.26 }),                                                         // chitin cap
        ...[0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.4; return spike([Math.cos(a) * 0.5, 0.45, Math.sin(a) * 0.5], [Math.cos(a) * 0.9, 0.95, Math.sin(a) * 0.9], 0.07, BONE); }),
        part(new THREE.BoxGeometry(0.07, 0.34, 0.05), 0x120a18, { y: 0, z: 0.8 }),                      // slit pupil
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(blob(0.3, AMBER, { sz: 0.5, z: 0.64 }), RIG.PULSE, 0, [0, 0, 0.64]),
        ...tips,
      ]), mat: RIG_GLOW },
    ];
  },

  // Brood Carrier: a living transport ship — armoured whale-like hull, slow membrane fins,
  // glowing cargo sacs full of organisms, a toothed maw and magenta bio-jets.
  broodCarrier: () => {
    const fins = [-1, 1].map((s) => rig(merge([
      sweptWing([[0.8, 1.2], [4.0, 0.2], [4.6, -1.2], [2.8, -1.7], [0.8, -1.0]], s, 0.08, -0.1, FLESH_D),
      ...[[4.0, 0.2], [4.6, -1.2], [2.8, -1.7]].map(([x, z]) => strut([s * 0.8, -0.06, 0], [s * x, -0.06, z], 0.07, BONE)),
    ]), RIG.SWAY, 0.12, [s * 0.8, 0, 0]));
    const tendrils = [-0.6, 0, 0.6].map((x) => rig(merge(limb([[x, -0.8, -2.2], [x * 1.2, -1.8, -2.8], [x, -2.6, -3.2]], 0.14, 0.06, FLESH)), RIG.SWAY, 0.2, [x, -0.8, -2.2]));
    const ribs = [1.6, 0.6, -0.4, -1.4].flatMap((z) => limb(arc([-1.5, 0.1, z], [0, -2.2, z], [1.5, 0.1, z], 4), 0.12, 0.12, BONE));
    const body = [
      ...fins, ...tendrils, ...ribs,
      blob(1.6, CH, { sx: 1.1, sy: 0.75, sz: 2.3 }),
      ...[0, 1, 2, 3, 4, 5].map((i) => part(new THREE.BoxGeometry(2.4 - 0.2 * Math.abs(i - 2), 0.2, 1.05), i % 2 ? CHL : CHD,
        { rx: -0.12, y: 1.08 - 0.06 * Math.abs(i - 2), z: 2.6 - i }) ),                                // dorsal scales
      ...[1.6, 0.4, -0.8, -2.0].map((z) => spike([0, 1.15, z], [0, 1.95, z - 0.5], 0.16, BONE)),
      ...[1.2, 0, -1.2].map((z) => blob(0.55, FLESH, { sy: 0.8, y: -1.0, z })),                      // cargo sacs
      blob(0.95, CHD, { sx: 1.1, sy: 0.8, z: 3.3 }),                                                // head
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2; return spike([Math.cos(a) * 0.55, Math.sin(a) * 0.4, 4.0], [Math.cos(a) * 0.3, Math.sin(a) * 0.22, 4.5], 0.08, BONE); }),
      ...limb([[0, 0.1, -3.2], [0, 0.0, -4.3], [0, 0.2, -5.3]], 0.7, 0.3, CH),                       // tail
      sweptWing([[0.1, -4.8], [1.4, -5.6], [0.1, -5.4]], 1, 0.06, 0.2, CHL),
      sweptWing([[0.1, -4.8], [1.4, -5.6], [0.1, -5.4]], -1, 0.06, 0.2, CHL),
    ];
    return [
      { geo: rigMerge(body), mat: RIG_BODY },
      { geo: rigMerge([
        ...[-1, 1].flatMap((s) => [0, 1, 2].map((k) => part(new THREE.BoxGeometry(0.06, 0.12, 0.12), AMBER, { x: s * (0.98 - k * 0.06), y: 0.28 - k * 0.12, z: 3.5 - k * 0.22 }))),
        rig(merge([1.2, 0, -1.2].map((z) => blob(0.32, BIO, { sy: 0.8, y: -1.22, z }))), RIG.PULSE, 0, [0, -1.2, 0]),
        part(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 8), BIO, { rx: Math.PI / 2, z: 4.12 }),     // glowing gullet
      ]), mat: RIG_GLOW },
      { geo: rigMerge([-1, 1].map((s) => flame(0.38, 1.8, BIO, [s * 0.75, -0.1, -3.4], true))), mat: RIG_FLAME },
    ];
  },

  // ----------------------------------------------------------- structures
  // Brood Chrysalis: the dormant hive — a sealed, slowly breathing cocoon wrapped in bone ribs.
  broodChrysalis: () => {
    const plates = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k / 8) * Math.PI * 2;
      return plate(1.75, 3.6, 0.28, k % 2 ? CHL : CHD, a, 2.2, 3.3, -0.22);
    });
    const ribs = [0, 1, 2, 3, 4, 5].flatMap((k) => {
      const a = (k / 6) * Math.PI * 2 + 0.3, c = Math.cos(a), s = Math.sin(a);
      return limb(arc([c * 2.5, 0.8, s * 2.5], [c * 3.3, 4.4, s * 3.3], [c * 0.4, 7.4, s * 0.4], 5), 0.26, 0.16, BONE);
    });
    return [
      { geo: rigMerge([
        ...roots(10, 2.6, 6.6, 0.42),
        blob(3.2, FLESH_D, { sx: 1.1, sy: 0.35, sz: 1.1, y: 0.3 }),
        rig(merge([ico(2.6, CH, { sy: 1.55, y: 3.4 }, 1), ...plates]), RIG.BREATHE, 0.012, [0, 3.4, 0]),
        ...ribs,
        spike([0, 7.2, 0], [0, 8.5, 0], 0.28, BONE),
        ...[0, 1, 2, 3, 4].map((k) => { const a = k * 1.26; return spike([Math.cos(a) * 3.0, 0.5, Math.sin(a) * 3.0], [Math.cos(a) * 3.6, 1.8, Math.sin(a) * 3.6], 0.18, BONE_D); }),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(merge([0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
          const a = (k / 8 + 1 / 16) * Math.PI * 2;
          return plate(0.08, 2.6, 0.08, EMBER, a, 2.55, 3.3, -0.22);
        })), RIG.PULSE, 0, [0, 3.3, 0]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Brood Hive: the awakened heart of the colony — burst-open carapace petals, a beating flesh heart
  // and a glowing mind-core cradled by a crown of bone horns.
  broodHive: () => {
    const petals = [0, 1, 2, 3, 4, 5].map((k) => {
      const a = (k / 6) * Math.PI * 2 + 0.25;
      return rig(plate(1.9, 3.4, 0.3, k % 2 ? CHL : CH, a, 2.9, 1.9, 0.45), RIG.BREATHE, 0.025, [Math.cos(a) * 2.5, 0.4, Math.sin(a) * 2.5]);
    });
    const horns = [0, 1, 2, 3, 4, 5, 6].flatMap((k) => {
      const a = (k / 7) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return limb(arc([c * 1.9, 3.8, s * 1.9], [c * 2.8, 6.6, s * 2.8], [c * 0.9, 8.4, s * 0.9], 4), 0.24, 0.1, BONE, 0.5);
    });
    const tendrils = [0, 1, 2, 3].map((k) => {
      const a = (k / 4) * Math.PI * 2 + 0.6, c = Math.cos(a), s = Math.sin(a);
      return rig(merge(limb([[c * 0.6, 4.3, s * 0.6], [c * 1.5, 5.4, s * 1.5], [c * 2.3, 5.6, s * 2.3], [c * 2.9, 5.0, s * 2.9]], 0.18, 0.07, FLESH)), RIG.SWAY, 0.14, [c * 0.6, 4.3, s * 0.6]);
    });
    const sacs = [0, 1, 2, 3, 4].map((k) => { const a = (k / 5) * Math.PI * 2 + 0.9; return [Math.cos(a) * 3.7, 0.55, Math.sin(a) * 3.7]; });
    return [
      { geo: rigMerge([
        ...roots(14, 3.0, 8.0, 0.45),
        blob(3.6, FLESH_D, { sx: 1.1, sy: 0.4, sz: 1.1, y: 0.3 }),
        ...petals, ...horns, ...tendrils,
        rig(ico(1.9, FLESH, { sy: 1.25, y: 3.0 }, 1), RIG.BREATHE, 0.05, [0, 3.0, 0]),                // heart
        ...sacs.map(([x, y, z]) => blob(0.62, FLESH, { sy: 0.8, x, y, z })),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k / 8) * Math.PI * 2; return spike([Math.cos(a) * 3.4, 0.6, Math.sin(a) * 3.4], [Math.cos(a) * 4.1, 2.0, Math.sin(a) * 4.1], 0.2, BONE_D); }),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(blob(0.75, BIO, { y: 5.0 }), RIG.PULSE, 0, [0, 5.0, 0]),                                  // mind-core
        rig(merge([0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2; return strut([Math.cos(a) * 0.4, 4.7, Math.sin(a) * 0.4], [Math.cos(a + 0.4) * 1.8, 2.6, Math.sin(a + 0.4) * 1.8], 0.09, BIO); })),
          RIG.BREATHE, 0.05, [0, 3.0, 0]),                                                           // veins on the heart
        rig(merge(sacs.map(([x, y, z]) => blob(0.3, ACID, { x, y: y + 0.15, z }))), RIG.PULSE, 2, [0, 0.7, 0]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Biomass Feeder: a fleshy sac in a bone cage that digests the soil into biomass.
  feederPod: () => {
    const ribs = [0, 1, 2, 3, 4].flatMap((k) => {
      const a = (k / 5) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return limb(arc([c * 1.1, 0.3, s * 1.1], [c * 1.5, 1.6, s * 1.5], [c * 0.4, 2.7, s * 0.4], 3), 0.1, 0.07, BONE);
    });
    const tendrils = [0, 1, 2].map((k) => {
      const a = (k / 3) * Math.PI * 2 + 0.5, c = Math.cos(a), s = Math.sin(a);
      return rig(merge(limb([[c * 0.2, 2.75, s * 0.2], [c * 0.6, 3.4, s * 0.6], [c * 0.9, 3.5, s * 0.9]], 0.08, 0.04, FLESH)), RIG.SWAY, 0.25, [c * 0.2, 2.75, s * 0.2]);
    });
    return [
      { geo: rigMerge([
        ...roots(6, 1.0, 3.2, 0.22),
        blob(1.3, FLESH_D, { sy: 0.4, y: 0.2 }),
        rig(ico(1.05, FLESH, { sy: 1.3, y: 1.45 }), RIG.BREATHE, 0.06, [0, 1.4, 0]),
        ...ribs, ...tendrils,
        part(new THREE.TorusGeometry(0.34, 0.12, 5, 8), CHD, { rx: Math.PI / 2, y: 2.72 }),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(blob(0.3, ACID, { sy: 0.5, y: 2.74 }), RIG.PULSE, 0, [0, 2.74, 0]),
        rig(merge([0, 1, 2, 3].map((k) => { const a = (k / 4) * Math.PI * 2 + 0.3; return strut([Math.cos(a) * 0.95, 0.9, Math.sin(a) * 0.95], [Math.cos(a + 0.5) * 0.7, 2.2, Math.sin(a + 0.5) * 0.7], 0.06, BIO); })),
          RIG.BREATHE, 0.06, [0, 1.4, 0]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Spore Spitter: a defensive stalk that turns its mouth toward intruders and spits acid spores (also hits flyers).
  sporeSpitter: () => {
    const P = [0, 0.4, 0];
    return [
      { geo: rigMerge([
        ...roots(5, 0.8, 2.6, 0.2),
        blob(1.0, CHD, { sy: 0.45, y: 0.2 }),
        rig(merge([
          strut([0, 0.4, 0], [0, 1.6, 0.15], 0.44, CH),
          strut([0, 1.6, 0.15], [0, 2.6, 0.0], 0.36, CHL),
          ...[0.9, 1.9].map((y) => part(new THREE.TorusGeometry(0.28, 0.08, 4, 7), BONE_D, { rx: Math.PI / 2, y })),
          blob(0.6, CHD, { sy: 0.9, sz: 1.2, y: 3.0, z: 0.2 }),
          part(new THREE.CylinderGeometry(0.36, 0.2, 0.5, 6), CH, { rx: Math.PI / 2, y: 3.0, z: 0.86 }),
          ...[-1, 0, 1].map((x) => spike([x * 0.3, 3.3, -0.1], [x * 0.5, 3.9, -0.6], 0.09, BONE)),
        ]), RIG.SWAY, 0.05, P),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(merge([
          part(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 6), ACID, { rx: Math.PI / 2, y: 3.0, z: 1.12 }),
          ...[-1, 1].map((s) => part(new THREE.BoxGeometry(0.08, 0.06, 0.04), AMBER, { x: s * 0.3, y: 3.25, z: 0.82 })),
          ...[[0.25, 1.3], [-0.24, 2.1]].map(([x, y]) => blob(0.16, ACID, { x, y, z: 0.12 })),
        ]), RIG.SWAY, 0.05, P),
      ]), mat: RIG_GLOW },
    ];
  },

  // Brood Pit: a bubbling acid pool ringed with flesh and eggs under arching bones — hatches heavier organisms.
  broodPit: () => {
    const rim = [...Array(11)].map((_, k) => { const a = (k / 11) * Math.PI * 2; return blob(0.55, k % 2 ? FLESH_D : CHD, { sy: 0.6, x: Math.cos(a) * 2.0, y: 0.3, z: Math.sin(a) * 2.0 }); });
    const arches = [0.4, 0.4 + Math.PI / 2].flatMap((a) => limb(arc([Math.cos(a) * 2.2, 0.4, Math.sin(a) * 2.2], [0, 4.2, 0], [-Math.cos(a) * 2.2, 0.4, -Math.sin(a) * 2.2], 6), 0.17, 0.17, BONE));
    const eggs = [0.3, 1.5, 2.6, 3.9, 5.1].map((a) => [Math.cos(a) * 2.55, 0.55, Math.sin(a) * 2.55]);
    return [
      { geo: rigMerge([
        ...roots(8, 2.2, 4.4, 0.24),
        part(new THREE.CylinderGeometry(2.1, 2.3, 0.3, 11), CHD, { y: 0.1 }),
        ...rim, ...arches,
        rig(merge(eggs.map(([x, y, z]) => ico(0.38, EGG, { sy: 1.35, x, y, z }))), RIG.BREATHE, 0.05, [0, 0.55, 0]),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(part(new THREE.CylinderGeometry(1.75, 1.75, 0.06, 11), ACID, { y: 0.3 }), RIG.PULSE, 0, [0, 0.3, 0]),
        rig(merge(eggs.map(([x, y, z]) => blob(0.12, BIO, { x: x * 1.06, y: y + 0.1, z: z * 1.06 }))), RIG.PULSE, 1, [0, 0.6, 0]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Bio-Spire: a tall twisted tower that breeds flyers; its crown glows.
  broodSpire: () => {
    const levels = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ y: 0.9 + i * 1.15, r: 1.0 - i * 0.11, x: Math.sin(i * 0.9) * 0.25, z: Math.cos(i * 0.9) * 0.25 - 0.25 }));
    const P = [0, 0.3, 0];
    return [
      { geo: rigMerge([
        ...roots(7, 1.2, 4.0, 0.3),
        blob(1.4, CHD, { sy: 0.5, y: 0.3 }),
        rig(merge([
          ...levels.map((l, i) => blob(l.r, i % 2 ? CH : CHL, { sy: 1.1, x: l.x, y: l.y, z: l.z })),
          ...levels.flatMap((l, i) => [0, 1].map((k) => { const a = i * 1.7 + k * Math.PI; return spike([l.x + Math.cos(a) * l.r * 0.8, l.y, l.z + Math.sin(a) * l.r * 0.8], [l.x + Math.cos(a) * (l.r + 0.8), l.y + 0.7, l.z + Math.sin(a) * (l.r + 0.8)], 0.12, BONE); })),
          ico(0.7, FLESH, { y: 9.1 }),
          ...[0, 1, 2].map((k) => { const a = k * 2.1; return spike([Math.cos(a) * 0.4, 9.4, Math.sin(a) * 0.4], [Math.cos(a) * 0.9, 10.5, Math.sin(a) * 0.9], 0.12, BONE); }),
        ]), RIG.SWAY, 0.02, P),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(blob(0.42, BIO, { y: 9.1, z: 0.35 }), RIG.SWAY, 0.02, P),
        rig(merge(levels.filter((_, i) => i % 2).map((l) => part(new THREE.BoxGeometry(0.1, 0.5, 0.1), BIO, { x: l.x, y: l.y, z: l.z + l.r * 0.95 }))), RIG.SWAY, 0.02, P),
      ]), mat: RIG_GLOW },
    ];
  },

  // Resonance Veil Spire: a crystal-crowned stalk whose resonance jams the Tech Moon's targeting sensors nearby.
  veilSpire: () => {
    const crystals = [[0, 5.6, 0, 1.6, 0], [0.45, 5.0, 0.2, 1.1, 0.4], [-0.4, 5.1, -0.25, 1.2, -0.45], [0.1, 5.0, -0.5, 0.9, -0.3]];
    return [
      { geo: rigMerge([
        ...roots(6, 1.0, 3.6, 0.26),
        blob(1.2, CHD, { sy: 0.5, y: 0.25 }),
        strut([0, 0.3, 0], [0, 4.3, 0], 0.55, CH),
        ...[0, 1, 2, 3, 4, 5].map((k) => { const a = k * 1.1, y = 0.8 + k * 0.6; return strut([Math.cos(a) * 0.32, y, Math.sin(a) * 0.32], [Math.cos(a + 1.1) * 0.32, y + 0.6, Math.sin(a + 1.1) * 0.32], 0.12, BONE); }),
        blob(0.75, CHL, { sy: 0.6, y: 4.3 }),
        ...crystals.map(([x, y, z, h, tilt]) => part(new THREE.OctahedronGeometry(0.32), 0x5a46b0, { sy: h * 1.8, rz: tilt, x, y, z })),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        rig(ico(0.42, VEIL, { y: 5.0 }), RIG.PULSE, 0, [0, 5.0, 0]),
        rig(merge([0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2; return part(new THREE.OctahedronGeometry(0.2), VEIL, { sy: 1.8, x: Math.cos(a) * 1.5, y: 5.3, z: Math.sin(a) * 1.5 }); })), RIG.SPIN, 0.8, [0, 5.3, 0]),
      ]), mat: RIG_GLOW },
    ];
  },
};

/** Health-bar height above each Brood model's origin. */
export const BROOD_BAR_HEIGHT = {
  skitter: 1.5, spitter: 2.6, ravager: 3.9, wasp: 1.0, seeker: 1.4, broodCarrier: 2.8,
  broodChrysalis: 9.2, broodHive: 9.6, feederPod: 3.8, sporeSpitter: 4.2, broodPit: 4.6, broodSpire: 11, veilSpire: 7.2,
};
