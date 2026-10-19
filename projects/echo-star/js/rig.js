/**
 * Shared helpers for the animated, instanced unit models (player units,
 * enemies and the Brood). Units are drawn instanced, so their animation runs
 * in the vertex shader — see rigMaterial().
 */
import * as THREE from 'three';
import { box, part, merge, paint } from './geometry.js';

export const C = { hull: 0xe4e8ee, dark: 0x30343c, accent: 0xff7a2f, metal: 0x9aa4ae };
export const CYAN = 0x4df3ff, RED = 0xff3040;

// ============================================================== rigging
// Units are drawn instanced (one draw call for many units), so their
// animation runs in the vertex shader. Every vertex carries
//   aRig   = (type, param)   which joint it belongs to and how it moves
//   aPivot = joint position in model space
// and every instance carries
//   iAnim  = (walk phase, moving 0/1, random seed, working 0/1)
// written by UnitManager._render().
export const RIG = { NONE: 0, SWING: 1, SPIN: 2, FLAME: 3, TOOL: 4, DRILL: 5, ROLL: 6, LEG_Y: 7, JAW: 8, PULSE: 9, BEAM: 10, BREATHE: 11, FLAP: 12, SWAY: 13, NOD: 14 };
export const ANIM_TIME = { value: 0 };

export function rigMaterial(mat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ANIM_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime;
        attribute vec2 aRig;
        attribute vec3 aPivot;
        #ifdef USE_INSTANCING
          attribute vec4 iAnim;
        #endif
        vec3 rigRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
        vec3 rigRotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
        vec3 rigRotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          float phase = iAnim.x, moving = iAnim.y, seed = iAnim.z, working = iAnim.w;
          int type = int(aRig.x + 0.5);
          vec3 q = transformed - aPivot;
          if (type == 1) q = rigRotX(q, sin(phase) * 0.55 * moving * aRig.y);                       // legs / arms swing
          else if (type == 2) q = rigRotY(q, uTime * aRig.y + seed);                                  // rotors
          else if (type == 3) q *= (0.3 + 0.7 * moving) * (0.85 + 0.15 * sin(uTime * 38.0 + seed * 13.0));   // flames
          else if (type == 4) q = rigRotX(q, mix(sin(phase) * 0.55 * moving * aRig.y, -1.3 + sin(uTime * 11.0 + seed) * 0.7, working));   // tool arm
          else if (type == 5) q = rigRotZ(q, uTime * aRig.y * working);                              // drill
          else if (type == 6) q = rigRotX(q, phase * aRig.y);                                         // wheels roll
          else if (type == 7) q = rigRotY(q, sin(phase + aRig.y) * 0.45 * moving);                    // insect legs sweep (param = gait offset)
          else if (type == 8) q = rigRotY(q, aRig.y * (0.12 + 0.3 * working) * (0.5 + 0.5 * sin(uTime * (5.0 + 9.0 * working) + seed)));   // mandibles
          else if (type == 9) q *= 1.0 + 0.18 * sin(uTime * 3.0 + seed + aRig.y);                     // pulsing glow
          else if (type == 10) q *= working * (0.9 + 0.1 * sin(uTime * 25.0 + seed));                // beam, only while working
          else if (type == 11) q *= 1.0 + aRig.y * sin(uTime * 1.7 + seed + dot(aPivot, vec3(0.9, 0.6, 0.7)));   // organic breathing (param = amount)
          else if (type == 12) q = rigRotZ(q, sin(uTime * (8.0 + 5.0 * moving) + seed) * aRig.y);   // wing flap (param = side × amplitude)
          else if (type == 13) q = rigRotX(rigRotZ(q, sin(uTime * 1.3 + seed + aPivot.x * 2.0) * aRig.y), cos(uTime * 1.1 + seed + aPivot.z * 2.0) * aRig.y);   // tendril sway
          else if (type == 14) q = rigRotX(q, aRig.y * (working * (0.8 + 0.12 * sin(uTime * 2.6 + seed)) + (1.0 - working) * 0.06 * sin(uTime * 1.3 + seed)));   // head: dips to graze while working
          transformed = aPivot + q;
        }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'echo-unit-' + key;
  return mat;
}

export const RIG_BODY = rigMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, flatShading: true }), 'body');
export const RIG_GLOW = rigMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.7, 1.7, 1.7) }), 'glow');
export const RIG_FLAME = rigMaterial(new THREE.MeshBasicMaterial({
  vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
}), 'flame');

/** Tag a geometry as one joint (type, param, pivot). */
export function rig(geo, type = RIG.NONE, param = 0, pivot = [0, 0, 0]) {
  const n = geo.attributes.position.count;
  const r = new Float32Array(n * 2), p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { r[i * 2] = type; r[i * 2 + 1] = param; p.set(pivot, i * 3); }
  geo.setAttribute('aRig', new THREE.BufferAttribute(r, 2));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(p, 3));
  return geo;
}
/** Merge parts into one rigged geometry; parts without a joint stay still. */
export const rigMerge = (parts) => merge(parts.map((g) => (g.attributes.aRig ? g : rig(g))));

/** Box beam between two points (insect and walker legs). */
export function strut(a, b, t, color) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const geo = new THREE.BoxGeometry(t, dir.length(), t);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return paint(geo, color);
}
/** Ring of `n` tangent segments of radius r at height y (halos, rotor rings). */
export function ringOf(n, r, y, w, h, d, color) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return box(w, h, d, color, Math.cos(a) * r, y, Math.sin(a) * r, { ry: Math.PI / 2 - a });   // long side tangent to the ring
  });
}

/** Cylinder lying along Z (engines, barrels). */
export const tubeZ = (r1, r2, len, color, x, y, z, seg = 8) => part(new THREE.CylinderGeometry(r1, r2, len, seg), color, { rx: Math.PI / 2, x, y, z });
/** Square pyramid with sides aligned to the axes. */
export function pyramid(r, h, color, opts) {
  const g = new THREE.ConeGeometry(r, h, 4);
  g.rotateY(Math.PI / 4);
  return part(g, color, opts);
}
/** Thin swept wing: outline [x, z] points for the +X side, mirrored by `side`, centred at height y. */
export function sweptWing(pts, side, thick, y, color) {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * side, z))), { depth: thick, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);   // shape y → z, extrusion → −y
  geo.translate(0, y + thick / 2, 0);
  return paint(geo, color);
}
/** Flame cone pointing down (−Y) or back (−Z) from a nozzle at `at`; flickers and grows while moving. */
export function flame(r, len, color, at, back = false) {
  const g = new THREE.ConeGeometry(r, len, 8);
  g.rotateX(back ? -Math.PI / 2 : Math.PI);
  g.translate(at[0], at[1] - (back ? 0 : len / 2), at[2] - (back ? len / 2 : 0));
  return rig(paint(g, color), RIG.FLAME, 0, at);
}
