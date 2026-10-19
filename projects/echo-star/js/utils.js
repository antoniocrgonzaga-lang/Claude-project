/**
 * Small shared helpers: seeded random numbers, math easing and
 * vector utilities used across modules.
 */
import * as THREE from 'three';

// ------------------------------------------------------------ seeded RNG

/** mulberry32: tiny, fast, good-enough seeded PRNG. Returns floats in [0,1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic random generator. Same seed → same sequence. */
export class RNG {
  constructor(seed) {
    this._next = mulberry32(seed);
  }
  random() { return this._next(); }
  range(a, b) { return a + (b - a) * this._next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
  chance(p) { return this._next() < p; }
  /** Uniformly distributed point on the unit sphere. */
  unitVector(out = new THREE.Vector3()) {
    const u = this.range(-1, 1);
    const th = this.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - u * u);
    return out.set(s * Math.cos(th), u, s * Math.sin(th));
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Mix two integers into a new seed (used to derive per-planet seeds). */
export function hashSeed(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ------------------------------------------------------------------ math

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Frame-rate independent exponential smoothing toward a target. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

// --------------------------------------------------------------- vectors

/** Remove the component of v along unit normal n (in place). */
export function projectOnPlane(v, n) {
  return v.addScaledVector(n, -v.dot(n));
}

/** Any unit vector perpendicular to unit vector n. */
export function anyPerpendicular(n, out = new THREE.Vector3()) {
  if (Math.abs(n.y) < 0.9) out.set(0, 1, 0); else out.set(1, 0, 0);
  return projectOnPlane(out, n).normalize();
}

const _bx = new THREE.Vector3();
const _bm = new THREE.Matrix4();
/**
 * Build a quaternion whose local +Y is `up` and local +Z is `forward`
 * (forward is re-projected to be perpendicular to up).
 */
export function quatFromUpForward(up, forward, out = new THREE.Quaternion()) {
  const f = forward.clone();
  projectOnPlane(f, up);
  if (f.lengthSq() < 1e-8) anyPerpendicular(up, f);
  f.normalize();
  _bx.crossVectors(up, f).normalize();
  _bm.makeBasis(_bx, up, f);
  return out.setFromRotationMatrix(_bm);
}

// -------------------------------------------------------------- textures

/** Soft radial glow texture (used by sun, nebulae, markers). */
export function makeGlowTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Format big numbers compactly for the HUD (1234 → 1.2k). */
export function fmt(n) {
  n = Math.floor(n);
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
