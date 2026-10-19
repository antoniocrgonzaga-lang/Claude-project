/**
 * Base building (Phase 2).
 *
 *  Grid       – a square grid laid on the planet surface. It lives on the
 *               tangent plane at the Command Core and is projected onto the
 *               sphere (gnomonic projection), so cells stay square-ish.
 *  Building   – one placed structure: model, construction, production
 *               cycle, upkeep, health bar.
 *  Base       – all buildings on one planet + cell occupancy + economy.
 *  validatePlacement() – checks a proposed footprint and explains why it
 *               is invalid (shown in the build-mode tooltip).
 *
 * All numbers (costs, timers, rates) come from CONFIG.buildings / CONFIG.base.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { box, part, merge, paint } from './geometry.js';
import { projectOnPlane, anyPerpendicular, quatFromUpForward, damp, clamp } from './utils.js';
import { RESOURCE_LABELS } from './inventory.js';

const NODE_ITEM = { crystal: 'crystals', iron: 'iron', rock: 'rock' };
const ITEM_GLOW = { crystals: 0x4df3ff, iron: 0xd8e2ec, rock: 0xffb46a };

// ------------------------------------------------------------- materials
const MAT = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7, flatShading: true }),
  foundation: new THREE.MeshStandardMaterial({ color: 0x5b626e, roughness: 0.95 }),
  scaffold: new THREE.LineBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85 }),
  blueprint: new THREE.LineBasicMaterial({ color: 0x4df3ff, transparent: true, opacity: 0.7 }),
  select: new THREE.LineBasicMaterial({ color: 0x4df3ff }),
};
const glowCache = new Map();
function glowMat(color, intensity = 2.2) {
  const key = color + ':' + intensity;
  if (!glowCache.has(key)) {
    glowCache.set(key, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity }));
  }
  return glowCache.get(key);
}

const C = {
  hull: 0xe4e8ee, dark: 0x353b45, accent: 0xff7a2f, metal: 0x9aa4ae, wood: 0x8a6a45,
  concrete: 0x6b717c, trim: 0x2a2f37, panel: 0xc9d0da, hazard: 0xffc23a, red: 0xb5432f, white: 0xf2e6d0,
};

/** Shared glow of the AI cube on every Command Core — its colour shows the AI tier. */
const AI_CORE_MAT = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: CONFIG.aiTiers[0].color, emissiveIntensity: 3.0 });
export function setAITierVisual(tier) {
  AI_CORE_MAT.emissive.set(CONFIG.aiTiers[tier]?.color ?? CONFIG.aiTiers[0].color);
}

/** Wrap a merged geometry into a mesh that casts/receives shadows. */
function mesh(geo, mat = MAT.body) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Fence around a square plot of half-size s. */
function fenceParts(s, height = 0.8) {
  const parts = [];
  const n = 5;
  for (let k = 0; k <= n; k++) {
    const t = -s + (2 * s * k) / n;
    for (const [x, z] of [[t, -s], [t, s], [-s, t], [s, t]]) parts.push(box(0.2, height, 0.2, C.wood, x, height / 2, z));
  }
  for (const y of [height * 0.45, height * 0.85]) {
    parts.push(box(2 * s, 0.1, 0.1, C.wood, 0, y, -s), box(2 * s, 0.1, 0.1, C.wood, 0, y, s));
    parts.push(box(0.1, 0.1, 2 * s, C.wood, -s, y, 0), box(0.1, 0.1, 2 * s, C.wood, s, y, 0));
  }
  return parts;
}

// ================================================================ models
// ---- model-building helpers
const cyl = (rTop, rBottom, h, seg, color, opts = {}) => part(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, opts);
/** Cylinder lying along Z (barrels, pipes). */
const tubeZ = (r1, r2, len, color, x, y, z, seg = 8) => part(new THREE.CylinderGeometry(r1, r2, len, seg), color, { rx: Math.PI / 2, x, y, z });

/** Box beam between two points (truss members, cables). */
function strut(a, b, t, color) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const geo = new THREE.BoxGeometry(t, dir.length(), t);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return paint(geo, color);
}

/** Triangular roof prism running along X: base `width` deep, `height` tall, its base at height y. */
function prism(len, width, height, color, x, y, z) {
  return part(new THREE.CylinderGeometry(1, 1, len, 3), color, { sx: width / Math.sqrt(3), sz: height / 1.5, rx: -Math.PI / 2, ry: Math.PI / 2, x, y: y + height / 3, z });
}

/** A blade / spoke of length `len` sticking out from the origin at angle `a` around Z (rotors, turbines). */
function bladeZ(len, w, a, color) {
  const g = new THREE.BoxGeometry(w, len, 0.04);
  g.translate(0, len / 2 + 0.05, 0);
  g.rotateZ(a);
  return paint(g, color);
}
/** Same, around Y (roof fans). */
function bladeY(len, w, a, color) {
  const g = new THREE.BoxGeometry(len, 0.03, w);
  g.translate(len / 2 + 0.04, 0, 0);
  g.rotateY(a);
  return paint(g, color);
}

/** Concrete pad with a dark plinth: w × d footprint. */
const pad = (w, d) => [box(w + 0.2, 0.3, d + 0.2, C.trim, 0, 0.15, 0), box(w, 0.2, d, C.concrete, 0, 0.4, 0)];

/** Alternating yellow / dark hazard blocks in a row from (x0, z0) to (x1, z1). */
function hazard(n, x0, z0, x1, z1, y, h = 0.04, size = 0.3) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    parts.push(box(x0 === x1 ? 0.12 : size, h, z0 === z1 ? 0.12 : size, i % 2 ? C.dark : C.hazard, x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t));
  }
  return parts;
}

/**
 * Collects a model's parts per material: painted body, bare metal, and named
 * glowing groups. Each glow group gets its own material so the model can dim
 * it when unpowered, blink it or pulse it (build() returns them by name).
 */
class Kit {
  constructor() { this.body = []; this.metal = []; this.glows = []; }
  b(...parts) { this.body.push(...parts); return this; }
  m(...parts) { this.metal.push(...parts); return this; }
  g(name, color, intensity, ...parts) {
    let e = this.glows.find((x) => x.name === name);
    if (!e) this.glows.push((e = { name, color, intensity, parts: [] }));
    e.parts.push(...parts);
    return this;
  }
  build(group) {
    if (this.body.length) group.add(mesh(merge(this.body)));
    if (this.metal.length) group.add(mesh(merge(this.metal), MAT.metal));
    const out = {};
    for (const e of this.glows) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: e.color, emissiveIntensity: e.intensity });
      mat.userData.own = true;
      group.add(new THREE.Mesh(merge(e.parts), mat));
      out[e.name] = { mat, base: e.intensity, set(k) { mat.emissiveIntensity = e.intensity * k; } };
    }
    return out;
  }
}

/** Additive translucent material owned by one building (beams, holograms, flashes). */
function ownAdditive(color, opacity) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  mat.userData.own = true;
  return mat;
}

const blink = (time, period, on = 0.15, offset = 0) => ((time + offset) % period < on ? 1 : 0);

/**
 * Each model builder returns { group, height, animate(dt, time, active, building) }.
 * Models stand on y = 0, face +Z and fit their footprint.
 */
export const MODELS = {
  // ---------------------------------------------------------- Command Core
  core(planet) {
    const g = new THREE.Group(), k = new Kit(), P8 = Math.PI / 8;
    k.b(box(7.6, 0.3, 7.6, C.trim, 0, 0.15, 0), box(7.2, 0.25, 7.2, C.concrete, 0, 0.42, 0));
    // octagonal hall in two tiers with a roof cap
    k.b(cyl(3.0, 3.2, 3.0, 8, C.hull, { y: 2.05, ry: P8 }));
    k.b(cyl(3.08, 3.08, 0.3, 8, C.accent, { y: 3.62, ry: P8 }));
    k.b(cyl(2.1, 2.5, 1.6, 8, C.hull, { y: 4.57, ry: P8 }));
    k.b(cyl(1.0, 2.1, 0.55, 8, C.panel, { y: 5.65, ry: P8 }));
    // entrance: frame, door, awning, step
    k.b(box(2.0, 2.3, 0.6, C.panel, 0, 1.7, 3.05), box(1.4, 1.8, 0.1, C.trim, 0, 1.47, 3.36), box(2.4, 0.14, 1.1, C.accent, 0, 2.9, 3.35));
    k.b(box(2.2, 0.12, 0.5, C.concrete, 0, 0.6, 3.55));
    k.m(box(0.06, 1.8, 0.06, C.metal, -0.72, 1.47, 3.4), box(0.06, 1.8, 0.06, C.metal, 0.72, 1.47, 3.4));
    // side annexes with vents
    for (const s of [-1, 1]) {
      k.b(box(1.1, 1.9, 2.6, C.panel, s * 3.0, 1.5, -0.6), box(1.2, 0.12, 2.7, C.accent, s * 3.0, 2.5, -0.6));
      for (let i = 0; i < 4; i++) k.m(box(0.05, 0.07, 1.8, C.trim, s * 3.56, 0.95 + i * 0.28, -0.6));
    }
    // corner pylons with aviation lights
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.m(box(0.32, 3.9, 0.32, C.metal, sx * 3.35, 2.5, sz * 3.35));
      k.b(box(0.5, 0.22, 0.5, C.accent, sx * 3.35, 4.5, sz * 3.35));
      k.g('aviation', 0xff3030, 2.6, box(0.2, 0.16, 0.2, 0xffffff, sx * 3.35, 4.69, sz * 3.35));
    }
    // window bands, door light, pad edge lights
    k.g('windows', 0x4df3ff, 2.0,
      cyl(3.13, 3.13, 0.22, 8, 0xffffff, { y: 2.6, ry: P8 }), cyl(2.36, 2.36, 0.16, 8, 0xffffff, { y: 4.9, ry: P8 }),
      box(1.0, 0.08, 0.04, 0xffffff, 0, 2.5, 3.37));
    for (const t of [-2, 0, 2]) k.g('padLights', 0x4df3ff, 1.6, box(0.16, 0.05, 0.16, 0xffffff, -3.5, 0.57, t), box(0.16, 0.05, 0.16, 0xffffff, 3.5, 0.57, t), box(0.16, 0.05, 0.16, 0xffffff, t, 0.57, -3.5));
    k.g('padLights', 0x4df3ff, 1.6, box(0.16, 0.05, 0.16, 0xffffff, -2, 0.57, 3.5), box(0.16, 0.05, 0.16, 0xffffff, 2, 0.57, 3.5));
    // antenna mast with a turning dish and a blinking tip
    k.m(box(0.18, 3.6, 0.18, C.metal, 1.6, 7.2, -1.2));
    k.g('tip', 0xff3030, 3.0, box(0.18, 0.18, 0.18, 0xffffff, 1.6, 9.08, -1.2));
    const dish = new THREE.Group();
    dish.position.set(1.6, 8.1, -1.2);
    dish.add(mesh(merge([cyl(0.75, 0.2, 0.25, 10, C.hull, { rx: 1.0, z: 0.2 }), box(0.05, 0.5, 0.05, C.metal, 0, 0.15, 0.45, { rx: 1.0 })])));
    // the base AI: a glowing cube with a holographic ring, lifted on a beam of light (tier colour)
    const ai = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), AI_CORE_MAT);
    ai.position.y = 7.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 6, 32), AI_CORE_MAT);
    ring.position.y = 7.2;
    const beamMat = ownAdditive(0xffffff, 0.12);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.95, 0.7, 8, 1, true), beamMat);
    beam.position.y = 6.25;
    const L = k.build(g);
    g.add(dish, ai, ring, beam);
    return {
      group: g, height: 9.4,
      animate(dt, time, active) {
        ai.rotation.y += dt * (active ? 1.2 : 0.2);
        ai.rotation.x += dt * (active ? 0.7 : 0.1);
        ai.position.y = ring.position.y = 7.2 + Math.sin(time * 1.5) * 0.25;
        ring.rotation.x = Math.PI / 2 + Math.sin(time * 0.7) * 0.4;
        ring.rotation.z += dt * (active ? 0.9 : 0.15);
        beamMat.color.copy(AI_CORE_MAT.emissive).multiplyScalar(active ? 1.2 : 0.3);
        dish.rotation.y += dt * 0.5;
        L.aviation.set(blink(time, 1.6, 0.2) ? 1.15 : 0.1);
        L.tip.set(blink(time, 1.6, 0.2, 0.8) ? 1 : 0.1);
        L.windows.set(active ? 1 : 0.3);
        L.padLights.set(active ? 0.8 + Math.sin(time * 2) * 0.25 : 0.2);
      },
    };
  },

  // ------------------------------------------------------------ Extractor
  extractor(planet, opts = {}) {
    const g = new THREE.Group(), k = new Kit();
    k.b(...pad(3.4, 3.4), ...hazard(7, -1.35, 1.62, 1.35, 1.62, 0.52));
    // derrick: four leaning posts with two tiers of X bracing and a crown platform
    const post = (sx, sz, y) => { const t = (y - 0.5) / 4.1; return [sx * (1.35 - 0.8 * t), y, sz * (1.35 - 0.8 * t)]; };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.m(strut(post(sx, sz, 0.5), post(sx, sz, 4.6), 0.16, C.metal));
    for (const [y0, y1] of [[0.9, 2.6], [2.6, 4.2]]) {
      for (const s of [-1, 1]) {
        k.m(strut(post(-1, s, y0), post(1, s, y1), 0.07, C.metal), strut(post(1, s, y0), post(-1, s, y1), 0.07, C.metal));
        k.m(strut(post(s, -1, y0), post(s, 1, y1), 0.07, C.metal), strut(post(s, 1, y0), post(s, -1, y1), 0.07, C.metal));
      }
    }
    k.b(box(1.5, 0.18, 1.5, C.accent, 0, 4.68, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.m(box(0.06, 0.5, 0.06, C.metal, sx * 0.7, 5.0, sz * 0.7));
    k.m(box(1.45, 0.05, 0.05, C.metal, 0, 5.22, 0.7), box(1.45, 0.05, 0.05, C.metal, 0, 5.22, -0.7), box(0.05, 0.05, 1.45, C.metal, 0.7, 5.22, 0), box(0.05, 0.05, 1.45, C.metal, -0.7, 5.22, 0));
    k.m(box(0.03, 1.9, 0.03, C.dark, 0, 4.1, 0.3));     // hoist cable
    // engine housing with exhaust, vents
    k.b(box(1.0, 0.8, 0.7, C.hull, 0.85, 0.9, -0.9), box(1.05, 0.08, 0.75, C.accent, 0.85, 1.34, -0.9));
    k.m(cyl(0.07, 0.07, 0.9, 6, C.metal, { x: 1.15, y: 1.75, z: -1.1 }), cyl(0.1, 0.1, 0.06, 6, C.dark, { x: 1.15, y: 2.22, z: -1.1 }));
    for (let i = 0; i < 3; i++) k.m(box(0.04, 0.06, 0.55, C.trim, 1.36, 0.72 + i * 0.16, -0.9));
    // control box: lamp in the resource's colour + a small screen
    k.b(box(0.6, 0.7, 0.4, C.dark, -0.9, 0.85, 0.95));
    k.g('lamp', ITEM_GLOW[opts.item] ?? 0xffffff, 2.4, box(0.4, 0.14, 0.05, 0xffffff, -0.9, 1.05, 1.17));
    k.g('screen', 0x4df3ff, 1.4, box(0.3, 0.16, 0.03, 0xffffff, -0.9, 0.78, 1.17));
    k.g('tip', 0xff3030, 3.0, box(0.12, 0.12, 0.12, 0xffffff, 0.7, 5.3, 0.7));
    // crown pulley (spokes show it turning) and the drill string
    const pulley = new THREE.Group();
    pulley.position.set(0, 5.0, 0);
    pulley.add(mesh(merge([cyl(0.32, 0.32, 0.14, 10, C.dark, { rz: Math.PI / 2 }), box(0.15, 0.58, 0.05, C.metal), box(0.15, 0.05, 0.58, C.metal)])));
    const drill = mesh(merge([
      cyl(0.2, 0.2, 2.2, 8, C.metal),
      cyl(0.38, 0.38, 0.25, 8, C.accent, { y: 1.0 }),
      ...[-0.6, -0.2, 0.2, 0.6].map((y, i) => box(0.5, 0.06, 0.12, C.dark, 0, y, 0, { ry: i * 0.8 })),   // auger flights
      part(new THREE.ConeGeometry(0.38, 0.9, 6), C.dark, { rx: Math.PI, y: -1.55 }),
    ]));
    drill.position.y = 2.4;
    const L = k.build(g);
    g.add(pulley, drill);
    return {
      group: g, height: 5.4,
      animate(dt, time, active) {
        L.lamp.set(active ? 1 : 0.15);
        L.screen.set(active ? 1 : 0.2);
        L.tip.set(blink(time, 1.4) ? 1 : 0.1);
        if (!active) return;
        drill.rotation.y += dt * 6;
        drill.position.y = 2.4 + Math.sin(time * 3) * 0.35;
        pulley.rotation.x = Math.sin(time * 3) * 2;
      },
    };
  },

  // ----------------------------------------------------------------- Farm
  farm(planet) {
    const b = planet.biome, g = new THREE.Group(), k = new Kit();
    k.b(box(7.6, 0.35, 7.6, 0x6b4a2e, 0, 0.17, 0), ...fenceParts(3.8, 0.8));
    const rows = [-2.7, -1.6, -0.5, 0.6, 1.7];
    for (const x of rows) k.b(box(0.62, 0.08, 6.4, 0x4e3420, x, 0.38, -0.2));      // furrows
    // irrigation line with sprinklers
    k.m(box(5.0, 0.1, 0.1, C.metal, -0.5, 0.62, -3.35));
    for (const x of rows) k.m(box(0.06, 0.45, 0.06, C.metal, x, 0.6, -3.35), box(0.14, 0.06, 0.14, C.metal, x, 0.85, -3.35));
    // equipment strip on the right: water tower, shed with solar roof, wind turbine
    const ex = 2.95;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.m(box(0.1, 1.3, 0.1, C.metal, ex + sx * 0.35, 1.0, 2.6 + sz * 0.35));
    k.b(cyl(0.55, 0.55, 0.9, 8, C.hull, { x: ex, y: 2.1, z: 2.6 }), part(new THREE.ConeGeometry(0.62, 0.35, 8), C.accent, { x: ex, y: 2.73, z: 2.6 }));
    k.g('water', 0x3fb6ff, 1.6, cyl(0.57, 0.57, 0.12, 8, 0xffffff, { x: ex, y: 1.95, z: 2.6 }));
    k.b(box(1.2, 1.1, 1.4, C.wood, ex, 0.9, 0.2), box(0.04, 0.8, 0.5, 0x5a4028, ex - 0.62, 0.75, 0.2));
    k.b(box(1.4, 0.06, 1.6, 0x1d3a6a, ex, 1.55, 0.2, { rz: 0.25 }));
    for (const z of [-0.3, 0.2, 0.7]) k.m(box(1.42, 0.07, 0.03, C.metal, ex, 1.57, z, { rz: 0.25 }));
    k.m(box(0.14, 3.6, 0.14, C.hull, ex, 2.15, -2.7));
    k.b(box(0.28, 0.28, 0.55, C.hull, ex, 3.95, -2.62), box(0.3, 0.06, 0.3, C.accent, ex, 4.12, -2.62));
    const blades = new THREE.Group();
    blades.position.set(ex, 3.95, -2.3);
    blades.add(mesh(merge([0, 1, 2].map((i) => bladeZ(1.0, 0.12, (i * Math.PI * 2) / 3, C.hull)).concat([cyl(0.08, 0.08, 0.12, 8, C.accent, { rx: Math.PI / 2 })]))));
    // crops: stalk, leafy top and fruit per plant; the rows grow over each production cycle
    const crops = [];
    for (const x of rows) {
      for (let j = 0; j < 6; j++) {
        const z = -2.9 + j * 1.08;
        crops.push(box(0.46, 0.6, 0.46, b.plant, x, 0.3, z), box(0.32, 0.3, 0.32, new THREE.Color(b.plant).offsetHSL(0, 0, 0.08), x, 0.72, z));
        crops.push(box(0.16, 0.16, 0.16, b.berry, x + 0.2, 0.5, z + 0.1), box(0.14, 0.14, 0.14, b.berry, x - 0.15, 0.82, z - 0.1));
      }
    }
    const cropMesh = mesh(merge(crops));
    cropMesh.position.y = 0.42;
    const L = k.build(g);
    g.add(blades, cropMesh);
    return {
      group: g, height: 4.6,
      animate(dt, time, active, building) {
        cropMesh.scale.y = 0.15 + 0.85 * (building ? building.cycleProgress : 1);
        blades.rotation.z += dt * (active ? 3 : 0.6);
        L.water.set(active ? 1 : 0.3);
      },
    };
  },

  // ---------------------------------------------------------------- Ranch
  ranch(planet) {
    const g = new THREE.Group(), k = new Kit();
    const grass = new THREE.Color(planet.biome.plant).multiplyScalar(0.8);
    k.b(box(7.6, 0.25, 7.6, grass, 0, 0.12, 0), ...fenceParts(3.8, 1.0));
    // barn: red walls, white corner trim, gable roof, X-braced door and a lit hay loft
    const bx = -1.9, bz = -2.2;
    k.b(box(3.0, 2.0, 2.4, C.red, bx, 1.25, bz), prism(3.4, 2.8, 1.0, C.dark, bx, 2.25, bz));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.14, 2.0, 0.14, C.white, bx + sx * 1.5, 1.25, bz + sz * 1.2));
    k.b(box(1.1, 1.4, 0.06, C.white, bx, 0.95, -0.97));
    k.b(box(0.08, 1.55, 0.04, C.red, bx, 0.95, -0.93, { rz: 0.66 }), box(0.08, 1.55, 0.04, C.red, bx, 0.95, -0.93, { rz: -0.66 }));
    k.b(box(0.55, 0.45, 0.05, C.white, bx, 1.95, -0.97));
    k.g('loft', 0xffd36a, 1.6, box(0.38, 0.3, 0.03, 0xffffff, bx, 1.95, -0.94));
    // silo with bands, dome and ladder
    k.b(cyl(0.7, 0.7, 3.4, 10, 0xd8dde3, { x: 2.5, y: 1.95, z: -2.5 }));
    k.b(part(new THREE.SphereGeometry(0.72, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.red, { x: 2.5, y: 3.62, z: -2.5 }));
    for (const y of [1.0, 2.0, 3.0]) k.m(cyl(0.72, 0.72, 0.08, 10, C.metal, { x: 2.5, y, z: -2.5 }));
    k.m(box(0.04, 3.2, 0.04, C.metal, 2.38, 1.9, -1.78), box(0.04, 3.2, 0.04, C.metal, 2.62, 1.9, -1.78));
    for (let i = 0; i < 9; i++) k.m(box(0.24, 0.03, 0.03, C.metal, 2.5, 0.6 + i * 0.35, -1.78));
    // hay bales, water trough, lamp post
    k.b(box(0.7, 0.45, 0.5, 0xd9b85a, 0.3, 0.47, -3.0), box(0.7, 0.45, 0.5, 0xd9b85a, 1.05, 0.47, -3.0), box(0.7, 0.45, 0.5, 0xd9b85a, 0.65, 0.92, -3.0));
    k.b(box(1.6, 0.4, 0.6, C.wood, -2.7, 0.45, 1.8));
    k.g('water', 0x3fb6ff, 1.2, box(1.45, 0.05, 0.45, 0xffffff, -2.7, 0.62, 1.8));
    k.m(box(0.15, 2.6, 0.15, C.metal, 3.3, 1.4, 3.3));
    k.g('lamp', 0xffd36a, 2.0, box(0.4, 0.4, 0.4, 0xffffff, 3.3, 2.85, 3.3));
    const L = k.build(g);
    // local creatures roam inside the pen (re-using one of this planet's walking species)
    const species = planet.herd?.species?.find((s) => !s.float) ?? planet.herd?.species?.[0];
    const critters = [];
    if (species) {
      for (let i = 0; i < 3; i++) {
        const m = mesh(species.geometry);
        m.scale.setScalar(0.7);
        g.add(m);
        critters.push({ m, phase: i * 2.1, r: 1.2 + i * 0.5 });
      }
    }
    return {
      group: g, height: 4.4,
      animate(dt, time, active) {
        L.lamp.set(active ? 1 : 0.2);
        L.loft.set(active ? 1 : 0.2);
        for (const c of critters) {
          const a = time * 0.4 + c.phase;
          c.m.position.set(1.0 + Math.cos(a) * c.r, 0.25 + Math.abs(Math.sin(time * 4 + c.phase)) * 0.12, 1.0 + Math.sin(a) * c.r);
          c.m.rotation.y = -a;
        }
      },
    };
  },

  // ------------------------------------------------------- Power Generator
  power(planet) {
    const g = new THREE.Group(), k = new Kit();
    k.b(...pad(5.4, 5.4), ...hazard(9, -2.4, 2.62, 2.4, 2.62, 0.52));
    // reactor vessel
    k.m(cyl(1.7, 1.9, 3.0, 8, C.metal, { y: 2.0 }));
    k.b(cyl(1.2, 1.7, 0.6, 8, C.hull, { y: 3.8 }), cyl(1.95, 1.95, 0.18, 8, C.accent, { y: 0.7 }));
    // radiators with fins on the diagonals
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4, x = Math.cos(a) * 2.2, z = Math.sin(a) * 2.2;
      k.b(box(0.3, 2.4, 1.3, C.hull, x, 1.75, z, { ry: -a }));
      for (let j = 0; j < 5; j++) k.m(box(0.36, 0.05, 1.1, C.trim, x, 1.0 + j * 0.35, z, { ry: -a }));
    }
    // two Tesla pylons with cables to the reactor
    for (const s of [-1, 1]) {
      const x = s * 2.35;
      k.m(cyl(0.1, 0.16, 3.4, 6, C.metal, { x, y: 2.2, z: 0 }));
      for (const y of [2.6, 3.0, 3.4]) k.b(cyl(0.32, 0.32, 0.06, 8, C.accent, { x, y, z: 0 }));
      k.g('orbs', 0xffd84d, 2.6, part(new THREE.OctahedronGeometry(0.22), 0xffffff, { x, y: 4.1, z: 0 }));
      k.m(strut([x, 3.9, 0], [s * 1.1, 4.05, 0], 0.05, C.dark));
    }
    // crystal feed hopper glowing in the planet's crystal colour
    k.b(box(1.0, 0.7, 0.8, C.dark, 0, 0.85, 2.15));
    k.g('feed', planet.crystalColor, 2.0, box(0.25, 0.25, 0.25, 0xffffff, -0.2, 1.3, 2.1, { ry: 0.5 }), box(0.2, 0.2, 0.2, 0xffffff, 0.18, 1.28, 2.25, { rx: 0.4 }));
    k.g('band', 0xffd84d, 2.2, cyl(1.95, 1.95, 0.35, 8, 0xffffff, { y: 2.5 }));
    const L = k.build(g);
    // floating crystal with an energy ring
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: planet.crystalColor, emissiveIntensity: 2.5 });
    crystalMat.userData.own = true;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.65), crystalMat);
    crystal.position.y = 5.3;
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd84d, emissiveIntensity: 2.2 });
    ringMat.userData.own = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.04, 6, 32), ringMat);
    ring.position.y = 5.3;
    g.add(crystal, ring);
    return {
      group: g, height: 6,
      animate(dt, time, active) {
        crystal.rotation.y += dt * (active ? 2 : 0.3);
        crystal.position.y = ring.position.y = 5.3 + Math.sin(time * 2) * 0.15;
        crystalMat.emissiveIntensity = active ? 2.2 + Math.sin(time * 6) * 0.6 : 0.6;
        ring.rotation.x = Math.PI / 2 + Math.sin(time * 1.1) * 0.5;
        ring.rotation.y += dt * (active ? 1.5 : 0.2);
        ringMat.emissiveIntensity = active ? 2.2 : 0.3;
        L.orbs.set(active ? 0.7 + Math.random() * 0.6 : 0.15);
        L.band.set(active ? 0.9 + Math.sin(time * 4) * 0.2 : 0.25);
        L.feed.set(active ? 1 : 0.4);
      },
    };
  },
};

// Phase 3 production buildings ------------------------------------------
Object.assign(MODELS, {
  barracks(planet) {
    const g = new THREE.Group(), k = new Kit();
    k.b(...pad(5.4, 5.4));
    // main block with parapet roof
    k.b(box(4.6, 2.6, 3.4, 0x6f7f8f, 0, 1.8, -0.8), box(4.7, 0.12, 3.5, C.accent, 0, 2.7, -0.8), box(4.8, 0.3, 3.6, C.dark, 0, 3.25, -0.8));
    k.b(box(4.4, 0.1, 3.2, 0x5a6774, 0, 3.36, -0.8));
    // entrance: frame, door, canopy, lit sign
    k.b(box(1.4, 2.0, 0.2, C.panel, 0, 1.5, 0.95), box(1.0, 1.7, 0.1, C.dark, 0, 1.35, 1.06), box(1.8, 0.12, 0.8, C.accent, 0, 2.6, 1.3));
    k.m(box(0.06, 2.0, 0.06, C.metal, -0.8, 1.55, 1.65), box(0.06, 2.0, 0.06, C.metal, 0.8, 1.55, 1.65));
    k.g('sign', 0xffd36a, 2.2, box(1.2, 0.08, 0.04, 0xffffff, 0, 2.6, 1.71));
    for (const x of [-1.6, 1.6]) {
      k.b(box(0.9, 0.6, 0.08, C.trim, x, 2.0, 0.92));
      k.g('windows', 0x7dff9a, 1.6, box(0.75, 0.45, 0.04, 0xffffff, x, 2.0, 0.97));
    }
    // sandbag wall, crates and ammo boxes in the yard
    for (let i = 0; i < 5; i++) {
      k.b(box(0.5, 0.24, 0.32, 0x9a8a62, -2.4 + i * 0.5, 0.62, 2.35), box(0.5, 0.24, 0.32, 0x8c7c56, -2.15 + i * 0.5, 0.86, 2.35));
    }
    k.b(box(0.7, 0.7, 0.7, C.wood, 2.1, 0.85, 1.6), box(0.5, 0.5, 0.5, C.wood, 2.05, 1.45, 1.6), box(0.6, 0.35, 0.4, 0x4a5a3a, 1.35, 0.68, 1.9));
    k.m(box(0.72, 0.06, 0.06, C.metal, 2.1, 0.85, 1.96));
    // flag pole, antenna
    k.m(box(0.1, 3.4, 0.1, C.metal, -2.45, 2.2, 1.4), box(0.06, 1.4, 0.06, C.metal, 1.8, 4.1, -2.0));
    k.g('tip', 0xff3030, 3.0, box(0.1, 0.1, 0.1, 0xffffff, 1.8, 4.85, -2.0));
    const flag = new THREE.Group();
    flag.position.set(-2.45, 3.6, 1.4);
    flag.add(mesh(merge([box(1.0, 0.6, 0.04, C.accent, 0.52, -0.3, 0), box(0.3, 0.3, 0.05, 0xffffff, 0.45, -0.3, 0)])));
    // rotating searchlight on the roof
    k.m(cyl(0.25, 0.3, 0.25, 8, C.metal, { x: -1.2, y: 3.55, z: -1.6 }));
    const search = new THREE.Group();
    search.position.set(-1.2, 3.68, -1.6);
    search.add(mesh(merge([box(0.4, 0.35, 0.5, C.dark, 0, 0.2, 0), box(0.06, 0.3, 0.06, C.metal, 0, 0.0, 0)])));
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff4dd, emissiveIntensity: 2.5 });
    lensMat.userData.own = true;
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.04), lensMat);
    lens.position.set(0, 0.2, 0.26);
    const beamMat = ownAdditive(0xfff1c8, 0.07);
    // narrow at the lens (y = 0), widening toward the far end (y = 7)
    const beamGeo = new THREE.CylinderGeometry(1.3, 0.14, 7, 10, 1, true);
    beamGeo.translate(0, 3.5, 0);
    beamGeo.rotateX(Math.PI / 2 + 0.25);   // forward and a little down
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 0.2, 0.28);
    search.add(lens, beam);
    const L = k.build(g);
    g.add(flag, search);
    return {
      group: g, height: 4.6,
      animate(dt, time, active) {
        flag.rotation.y = Math.sin(time * 2.2) * 0.25;
        flag.scale.x = 1 + Math.sin(time * 3.1) * 0.04;
        search.rotation.y += dt * (active ? 0.7 : 0);
        lensMat.emissiveIntensity = active ? 2.5 : 0.2;
        beam.visible = active;
        L.sign.set(active ? 1 : 0.2);
        L.windows.set(active ? 1 : 0.2);
        L.tip.set(blink(time, 1.5) ? 1 : 0.1);
      },
    };
  },

  robotics(planet) {
    const g = new THREE.Group(), k = new Kit();
    k.b(...pad(5.4, 5.4));
    // hall with pilasters and an accent band
    k.b(box(4.8, 3.2, 3.8, C.hull, 0, 2.1, -0.5), box(4.9, 0.3, 3.9, C.accent, 0, 3.75, -0.5));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.2, 3.3, 0.2, C.panel, sx * 2.42, 2.1, -0.5 + sz * 1.92));
    // bay door with segments and a hazard frame
    k.b(box(2.6, 2.4, 0.15, C.dark, 0, 1.7, 1.45));
    for (let i = 0; i < 5; i++) k.m(box(2.5, 0.04, 0.05, C.trim, 0, 0.75 + i * 0.45, 1.53));
    k.b(...hazard(7, -1.14, 1.5, 1.14, 1.5, 3.02, 0.18, 0.38));
    for (const s of [-1, 1]) k.b(...hazard(6, s * 1.4, 1.5, s * 1.4, 1.5, 0.7, 0.38, 0.18).map((p, j) => p.translate(0, j * 0.4, 0)));
    k.g('bay', 0x4df3ff, 2.0, box(2.2, 0.08, 0.05, 0xffffff, 0, 2.86, 1.56));
    for (const s of [-1, 1]) k.g('windows', 0x4df3ff, 1.4, box(0.04, 0.35, 2.6, 0xffffff, s * 2.42, 2.9, -0.5));
    // conveyor belt leaving the bay
    k.b(box(1.4, 0.35, 1.6, C.trim, 0, 0.68, 2.25), box(1.1, 0.04, 1.6, 0x1c2025, 0, 0.87, 2.25));
    k.m(box(0.08, 0.12, 1.6, C.metal, -0.6, 0.92, 2.25), box(0.08, 0.12, 1.6, C.metal, 0.6, 0.92, 2.25));
    for (const z of [1.6, 2.1, 2.6, 2.95]) k.m(cyl(0.07, 0.07, 1.3, 6, C.metal, { rz: Math.PI / 2, y: 0.75, z }));
    const crates = [0, 1].map((i) => {
      const c = mesh(merge([box(0.45, 0.35, 0.45, i ? C.accent : C.panel, 0, 0, 0), box(0.47, 0.05, 0.47, C.dark, 0, 0.1, 0)]));
      c.position.y = 1.07;
      g.add(c);
      return c;
    });
    // roof: skylights, fans, exhaust stack
    for (const x of [-1.4, 0, 1.4]) {
      k.g('sky', 0x9fe8ff, 0.7, box(1.1, 0.06, 0.9, 0xffffff, x, 3.98, -0.6, { rx: -0.35 }));
      k.m(box(1.16, 0.05, 0.05, C.metal, x, 4.12, -0.98, { rx: -0.35 }));
    }
    const fans = [-1, 1].map((s) => {
      k.m(cyl(0.45, 0.45, 0.25, 10, C.metal, { x: s * 1.2, y: 4.02, z: -1.95 }));
      const f = new THREE.Group();
      f.position.set(s * 1.2, 4.17, -1.95);
      f.add(mesh(merge([0, 1, 2, 3].map((i) => bladeY(0.36, 0.12, (i * Math.PI) / 2, C.dark)))));
      g.add(f);
      return f;
    });
    k.m(cyl(0.18, 0.2, 1.6, 8, C.metal, { x: 2.0, y: 4.6, z: -2.0 }), cyl(0.22, 0.22, 0.1, 8, C.dark, { x: 2.0, y: 5.42, z: -2.0 }));
    k.b(cyl(0.21, 0.21, 0.12, 8, C.accent, { x: 2.0, y: 4.9, z: -2.0 }));
    // articulated robot arm on the roof: turn → shoulder → elbow → claw
    const arm = new THREE.Group();
    arm.position.set(-1.7, 3.95, 0.7);
    arm.add(mesh(merge([cyl(0.3, 0.38, 0.25, 8, C.dark)])));
    const turn = new THREE.Group(), shoulder = new THREE.Group(), elbow = new THREE.Group();
    turn.position.y = 0.15;
    shoulder.position.y = 0.15;
    elbow.position.y = 1.0;
    turn.add(mesh(merge([box(0.36, 0.2, 0.36, C.accent, 0, 0.05, 0)])));
    shoulder.add(mesh(merge([box(0.2, 1.05, 0.2, C.accent, 0, 0.5, 0), cyl(0.14, 0.14, 0.3, 8, C.dark, { rz: Math.PI / 2 })])));
    elbow.add(mesh(merge([box(0.16, 0.85, 0.16, C.hull, 0, 0.42, 0), cyl(0.12, 0.12, 0.26, 8, C.dark, { rz: Math.PI / 2 }), box(0.28, 0.08, 0.14, C.dark, 0, 0.86, 0)])));
    const fingers = [-1, 1].map((s) => {
      const f = mesh(merge([box(0.05, 0.26, 0.08, C.metal, 0, 0.13, 0)]));
      f.position.set(s * 0.1, 0.88, 0);
      elbow.add(f);
      return f;
    });
    shoulder.add(elbow);
    turn.add(shoulder);
    arm.add(turn);
    const L = k.build(g);
    g.add(arm);
    return {
      group: g, height: 6,
      animate(dt, time, active) {
        L.bay.set(active ? 1 : 0.2);
        L.windows.set(active ? 1 : 0.25);
        if (!active) return;
        turn.rotation.y = Math.sin(time * 0.7) * 1.2;
        shoulder.rotation.x = -0.35 + Math.sin(time * 1.3) * 0.35;
        elbow.rotation.x = 0.9 + Math.sin(time * 1.9) * 0.4;
        const grip = 0.15 + Math.max(0, Math.sin(time * 1.9)) * 0.25;
        fingers[0].rotation.z = grip;
        fingers[1].rotation.z = -grip;
        crates.forEach((c, i) => { c.position.z = 1.5 + ((time * 0.6 + i * 0.75) % 1.5); });
        for (const f of fans) f.rotation.y += dt * 8;
      },
    };
  },

  hangar(planet) {
    const g = new THREE.Group(), k = new Kit();
    k.b(box(7.7, 0.3, 7.7, C.trim, 0, 0.15, 0), box(7.4, 0.2, 7.4, C.concrete, 0, 0.4, 0));
    // launch pad with a landing circle and an H
    k.b(box(7.0, 0.1, 3.0, 0x2f3540, 0, 0.55, 2.1));
    k.b(cyl(1.35, 1.35, 0.03, 20, C.hazard, { y: 0.615, z: 2.1 }), cyl(1.18, 1.18, 0.035, 20, 0x2f3540, { y: 0.62, z: 2.1 }));
    k.b(box(0.14, 0.03, 1.0, C.hazard, -0.32, 0.64, 2.1), box(0.14, 0.03, 1.0, C.hazard, 0.32, 0.64, 2.1), box(0.6, 0.03, 0.14, C.hazard, 0, 0.64, 2.1));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.g(i % 2 ? 'padA' : 'padB', 0xffd84d, 2.4, box(0.14, 0.06, 0.14, 0xffffff, Math.cos(a) * 1.6, 0.63, 2.1 + Math.sin(a) * 1.6));
    }
    // hangar with an arched, ribbed roof
    k.b(box(6.4, 3.4, 4.0, C.hull, 0, 2.1, -1.6));
    k.b(part(new THREE.CylinderGeometry(2.0, 2.0, 6.4, 10, 1, false, 0, Math.PI), C.hull, { rz: Math.PI / 2, y: 3.8, z: -1.6 }));
    for (const x of [-2.4, -0.8, 0.8, 2.4]) k.m(part(new THREE.CylinderGeometry(2.07, 2.07, 0.14, 10, 1, false, 0, Math.PI), C.metal, { rz: Math.PI / 2, x, y: 3.8, z: -1.6 }));
    k.b(box(6.6, 0.3, 4.2, C.accent, 0, 0.55, -1.6));
    // big door: panels, seams, hazard sill, header light
    k.b(box(4.2, 2.6, 0.2, C.dark, 0, 1.7, 0.42));
    for (const x of [-1.05, 0, 1.05]) k.m(box(0.05, 2.5, 0.05, C.trim, x, 1.7, 0.53));
    k.b(...hazard(10, -1.9, 0.53, 1.9, 0.53, 0.5, 0.16, 0.42));
    k.g('door', 0xffd84d, 2.0, box(4.0, 0.1, 0.06, 0xffffff, 0, 3.1, 0.55));
    for (const s of [-1, 1]) for (const z of [-2.6, -1.6, -0.6]) k.g('windows', 0x4df3ff, 1.3, box(0.04, 0.4, 0.6, 0xffffff, s * 3.21, 2.6, z));
    // control tower with a radar
    k.m(box(0.4, 3.0, 0.4, C.metal, 3.2, 2.1, 3.2));
    k.b(box(1.0, 0.15, 1.0, C.dark, 3.2, 3.65, 3.2), box(1.1, 0.12, 1.1, C.accent, 3.2, 4.35, 3.2));
    k.g('tower', 0x9fe8ff, 0.9, box(0.9, 0.55, 0.9, 0xffffff, 3.2, 4.0, 3.2));
    const radar = new THREE.Group();
    radar.position.set(3.2, 4.45, 3.2);
    radar.add(mesh(merge([box(0.06, 0.3, 0.06, C.metal, 0, 0.1, 0), box(0.9, 0.14, 0.08, C.hull, 0, 0.28, 0), box(0.9, 0.04, 0.12, C.accent, 0, 0.36, 0)])));
    const L = k.build(g);
    g.add(radar);
    return {
      group: g, height: 6,
      animate(dt, time, active) {
        radar.rotation.y += dt * (active ? 2 : 0.2);
        const phase = Math.floor(time * 2) % 2;
        L.padA.set(active ? (phase ? 1 : 0.1) : 0.05);
        L.padB.set(active ? (phase ? 0.1 : 1) : 0.05);
        L.door.set(active ? 0.8 + Math.sin(time * 3) * 0.2 : 0.2);
        L.windows.set(active ? 1 : 0.25);
        L.tower.set(active ? 1 : 0.3);
      },
    };
  },

  // Phase 4 --------------------------------------------------------------
  datacenter(planet) {
    const g = new THREE.Group(), k = new Kit();
    k.b(...pad(5.4, 5.4));
    k.b(box(4.8, 2.8, 3.8, 0x2b3240, 0, 1.9, -0.3), box(5.0, 0.3, 4.0, C.accent, 0, 3.45, -0.3));
    k.b(box(1.2, 1.9, 0.2, C.dark, 0, 1.45, 1.65));
    k.g('keypad', 0x7dff9a, 2.0, box(0.1, 0.14, 0.03, 0xffffff, 0.75, 1.4, 1.62));
    // server racks along the front, with two banks of status lights blinking out of step
    for (const x of [-1.8, -1.1, 1.1, 1.8]) {
      k.b(box(0.5, 2.2, 0.15, 0x1a1f28, x, 1.6, 1.62));
      for (let r = 0; r < 6; r++) k.g(r % 2 ? 'rackB' : 'rackA', r % 2 ? 0x4df3ff : 0x7dff9a, 2.0, box(0.36, 0.06, 0.04, 0xffffff, x, 0.75 + r * 0.32, 1.71));
    }
    // fibre conduits glowing along the walls
    for (const s of [-1, 1]) k.g('fiber', 0xc3a8ff, 1.8, box(0.05, 0.08, 3.6, 0xffffff, s * 2.42, 0.9, -0.3), box(0.05, 2.2, 0.08, 0xffffff, s * 2.42, 2.0, -2.15));
    // rooftop cooling units with fans
    const fans = [-1, 1].map((s) => {
      k.b(box(1.3, 0.5, 1.3, C.panel, s * 1.2, 3.85, -0.6));
      k.m(cyl(0.5, 0.5, 0.06, 12, C.trim, { x: s * 1.2, y: 4.12, z: -0.6 }));
      const f = new THREE.Group();
      f.position.set(s * 1.2, 4.17, -0.6);
      f.add(mesh(merge([0, 1, 2].map((i) => bladeY(0.42, 0.14, (i * Math.PI * 2) / 3, C.dark)))));
      g.add(f);
      return f;
    });
    // dish mast + beacon
    k.m(box(0.2, 1.8, 0.2, C.metal, 1.9, 4.3, -1.9));
    k.g('beacon', 0xc3a8ff, 2.6, box(0.25, 0.25, 0.25, 0xffffff, 1.9, 5.6, -1.9));
    const dish = new THREE.Group();
    dish.position.set(1.9, 5.15, -1.9);
    dish.add(mesh(merge([cyl(0.9, 0.3, 0.35, 10, C.hull, { rx: 0.6, z: 0.2 })])));
    // hologram of the AI's thinking above the roof (only while working)
    const holoMat = ownAdditive(0xc3a8ff, 0.85);
    holoMat.wireframe = true;
    const holo = new THREE.Group();
    holo.position.set(-0.6, 4.6, -1.9);
    holo.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), holoMat), new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.02, 4, 24), holoMat));
    const L = k.build(g);
    g.add(dish, holo);
    return {
      group: g, height: 6,
      animate(dt, time, active) {
        L.rackA.set(active ? (Math.sin(time * 9) > 0 ? 1.2 : 0.3) : 0.08);
        L.rackB.set(active ? (Math.sin(time * 7 + 1.3) > 0 ? 1.2 : 0.3) : 0.08);
        L.fiber.set(active ? 0.7 + Math.sin(time * 2.5) * 0.3 : 0.15);
        L.beacon.set(blink(time, 2, 0.6) ? 1 : 0.2);
        L.keypad.set(active ? 1 : 0.2);
        dish.rotation.y += dt * 0.3;
        for (const f of fans) f.rotation.y += dt * (active ? 9 : 0.5);
        holo.visible = active;
        holo.rotation.y += dt * 0.9;
        holo.children[1].rotation.x += dt * 1.4;
        holo.position.y = 4.6 + Math.sin(time * 1.7) * 0.12;
      },
    };
  },

  turret(planet) {
    const g = new THREE.Group(), k = new Kit(), P8 = Math.PI / 8;
    k.b(...pad(3.4, 3.4), ...hazard(7, -1.35, 1.62, 1.35, 1.62, 0.52));
    k.m(cyl(1.25, 1.5, 1.2, 8, C.metal, { y: 1.1, ry: P8 }));
    k.b(cyl(1.3, 1.3, 0.15, 8, C.accent, { y: 1.5, ry: P8 }));
    k.b(box(0.8, 0.5, 0.5, 0x4a5a3a, 0, 0.75, -1.3), box(0.82, 0.06, 0.06, C.hazard, 0, 0.95, -1.04));   // ammo box
    // rotating head: octagonal turret with armour cheeks, hatch, sensor eye, radar
    const head = new THREE.Group();
    head.position.y = 2.1;
    const hk = new Kit();
    hk.b(cyl(0.85, 0.95, 0.75, 8, C.hull, { ry: P8 }));
    hk.b(box(0.25, 0.6, 1.2, C.panel, -0.85, 0, 0.1), box(0.25, 0.6, 1.2, C.panel, 0.85, 0, 0.1), box(1.3, 0.12, 1.1, C.accent, 0, 0.42, -0.1));
    hk.m(cyl(0.25, 0.25, 0.08, 8, C.metal, { y: 0.5, z: -0.35 }));
    hk.g('eye', 0x4df3ff, 2.6, box(0.5, 0.12, 0.05, 0xffffff, 0, 0.18, 0.82));
    const HL = hk.build(head);
    // twin barrels (they kick back when firing) with a muzzle flash
    const barrels = new THREE.Group();
    barrels.position.set(0, 0.0, 0.55);
    const bk = new Kit();
    for (const s of [-1, 1]) {
      bk.m(tubeZ(0.08, 0.1, 1.5, C.dark, s * 0.3, 0, 0.75), tubeZ(0.13, 0.13, 0.5, C.metal, s * 0.3, 0, 0.3));
      bk.b(box(0.2, 0.14, 0.18, C.dark, s * 0.3, 0, 1.5));
    }
    bk.build(barrels);
    const flashMat = ownAdditive(0xffb050, 0.9);
    flashMat.color.multiplyScalar(2);
    const flash = new THREE.Group();
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), flashMat);
      f.position.set(s * 0.3, 0, 1.75);
      f.scale.z = 1.8;
      flash.add(f);
    }
    flash.visible = false;
    barrels.add(flash);
    head.add(barrels);
    const radar = new THREE.Group();
    radar.position.set(-0.45, 0.5, -0.45);
    radar.add(mesh(merge([box(0.05, 0.3, 0.05, C.metal, 0, 0.15, 0), box(0.5, 0.28, 0.04, C.hull, 0, 0.38, 0), box(0.5, 0.04, 0.06, C.accent, 0, 0.5, 0)])));
    head.add(radar);
    k.build(g);
    g.add(head);
    return {
      group: g, height: 3.2,
      animate(dt, time, active, building) {
        HL.eye.set(active ? 1 : 0.15);
        radar.rotation.y += dt * (active ? 3 : 0.3);
        // recoil + flash right after a shot (cooldown was just reset)
        const max = building?.def.weapon?.cooldown ?? 1;
        const kick = clamp(((building?.cooldown ?? 0) - (max - 0.12)) / 0.12, 0, 1);
        barrels.position.z = 0.55 - kick * 0.25;
        flash.visible = kick > 0.4;
        flash.scale.setScalar(0.35 + kick * 0.45);
        const target = building?.aimYaw;
        if (target === undefined || target === null) { if (active) head.rotation.y += dt * 0.4; return; }
        let diff = target - head.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        head.rotation.y += diff * Math.min(1, dt * 10);
      },
    };
  },
});

// ================================================================== grid

/** Footprint size in cells after rotation (90° steps). */
export function footprintOf(type, rot) {
  const [w, h] = CONFIG.buildings[type].size;
  return rot % 2 ? [h, w] : [w, h];
}

export class Grid {
  /**
   * @param planet     planet the grid lives on
   * @param originDir  planet-local unit direction of the grid origin
   * @param northHint  any vector; projected to the tangent plane → grid "north"
   */
  constructor(planet, originDir, northHint) {
    this.planet = planet;
    this.cs = CONFIG.base.cellSize;
    this.origin = originDir.clone().normalize();
    this.north = projectOnPlane(northHint.clone(), this.origin);
    if (this.north.lengthSq() < 1e-6) anyPerpendicular(this.origin, this.north);
    this.north.normalize();
    this.east = new THREE.Vector3().crossVectors(this.north, this.origin).normalize();
  }

  /** Planet-local direction → tangent-plane coordinates in metres (or null if behind). */
  toPlane(dir) {
    const k = dir.dot(this.origin) / dir.length();
    if (k < 0.2) return null;
    const R = this.planet.radius;
    const d = dir.clone().normalize();
    return { x: (d.dot(this.east) / k) * R, y: (d.dot(this.north) / k) * R };
  }

  /** Tangent-plane coordinates → planet-local unit direction. */
  toDir(x, y, out = new THREE.Vector3()) {
    const R = this.planet.radius;
    return out.copy(this.origin).addScaledVector(this.east, x / R).addScaledVector(this.north, y / R).normalize();
  }

  footprint(type, rot) { return footprintOf(type, rot); }

  /** Lower-left cell of a w×h footprint centred as close as possible to (x, y). */
  snap(x, y, w, h) {
    return { i0: Math.round(x / this.cs - w / 2), j0: Math.round(y / this.cs - h / 2) };
  }

  center(i0, j0, w, h) {
    return { x: (i0 + w / 2) * this.cs, y: (j0 + h / 2) * this.cs };
  }

  /** Building "forward" at a direction, rotated in 90° steps. */
  forwardAt(dir, rot, out = new THREE.Vector3()) {
    out.copy(this.north);
    projectOnPlane(out, dir).normalize();
    return out.applyAxisAngle(dir, (-rot * Math.PI) / 2);
  }

  serialize() {
    return { origin: this.origin.toArray(), north: this.north.toArray() };
  }
}

/** Sample terrain under a footprint (half-cell resolution). */
export function measureFootprint(grid, i0, j0, w, h) {
  const planet = grid.planet;
  let minH = Infinity, maxH = -Infinity, sum = 0, count = 0, submerged = false;
  const d = new THREE.Vector3();
  for (let a = 0; a <= w * 2; a++) {
    for (let b = 0; b <= h * 2; b++) {
      grid.toDir((i0 + a / 2) * grid.cs, (j0 + b / 2) * grid.cs, d);
      const hh = planet.walkHeight(d);
      if (planet.isSubmerged(d)) submerged = true;
      if (hh < minH) minH = hh;
      if (hh > maxH) maxH = hh;
      sum += hh; count++;
    }
  }
  const c = grid.center(i0, j0, w, h);
  const dir = grid.toDir(c.x, c.y);
  // Auto-level height: average ground, snapped to the terrain's terrace step,
  // never below the liquid surface.
  const step = planet.amplitude / CONFIG.planet.terraceSteps;
  let level = Math.round(sum / count / step) * step;
  if (planet.hasLiquid) level = Math.max(level, planet.seaHeight + 0.3);
  return { dir, cx: c.x, cy: c.y, minH, maxH, level, submerged };
}

/** Height the building will stand at (levelled pad, or the highest ground). */
const standHeight = (site) => (CONFIG.base.autoLevel ? site.level : site.maxH);

/** Building cost after modifiers (e.g. Quantum Economy in Phase 4). */
export function scaledCost(type, mult = 1) {
  const out = {};
  for (const [k, v] of Object.entries(CONFIG.buildings[type].cost)) out[k] = Math.ceil(v * mult);
  return out;
}

/**
 * The colony a point belongs to: the closest one whose build radius
 * contains it. Returns { base, x, y } (plane coords in that base's grid) or null.
 */
export function colonyAt(planet, localDir) {
  let best = null;
  for (const base of planet.bases) {
    const p = base.grid.toPlane(localDir);
    if (!p) continue;
    const d = Math.hypot(p.x, p.y);
    if (d <= CONFIG.base.buildRadius && (!best || d < best.d)) best = { base, x: p.x, y: p.y, d };
  }
  return best;
}

/**
 * Check whether a building can go where the cursor points.
 * ctx: { planet, type, rot, cursorLocal, heading, inventory, costMult, shipLocal }
 * Returns { ok, reason, base, grid, i0, j0, w, h, site, node, cost }.
 * `base` is the colony the building joins (null for a new Command Core).
 */
export function validatePlacement(ctx) {
  const { planet, type, rot, cursorLocal, heading, inventory, costMult = 1, shipLocal } = ctx;
  const def = CONFIG.buildings[type];
  const B = CONFIG.base;
  const res = { ok: false, reason: '', type, rot, base: null };
  if (def.phase > CONFIG.phase) { res.reason = `Unlocks in Phase ${def.phase}`; return res; }
  if (def.requires && ctx.singularity !== def.requires) {
    res.reason = `Requires the ${CONFIG.singularity[def.requires].name} singularity`;
    return res;
  }
  if (!MODELS[type]) { res.reason = 'Not available yet'; return res; }

  const cursorDir = cursorLocal.clone().normalize();
  let grid, i0, j0, base = null;
  const [w, h] = footprintOf(type, rot);
  if (type === 'core') {
    // Each core founds a new colony with its own grid: centred on the cursor, rotated with R.
    const north = heading.clone().applyAxisAngle(cursorDir, (-rot * Math.PI) / 2);
    grid = new Grid(planet, cursorDir, north);
    i0 = -w / 2; j0 = -h / 2;
  } else {
    const col = colonyAt(planet, cursorDir);
    if (!col) {
      res.reason = planet.bases.length ? 'Outside every colony — build near a Command Core' : 'Build a Command Core first';
      return res;
    }
    base = col.base;
    grid = base.grid;
    ({ i0, j0 } = grid.snap(col.x, col.y, w, h));
  }
  Object.assign(res, { base, grid, i0, j0, w, h });
  const site = measureFootprint(grid, i0, j0, w, h);
  res.site = site;
  res.cost = scaledCost(type, costMult);
  const center = site.dir.clone().multiplyScalar(planet.radius + standHeight(site));
  res.center = center;
  const half = (Math.max(w, h) * grid.cs) / 2;

  if (base && Math.hypot(site.cx, site.cy) > B.buildRadius) { res.reason = 'Too far from the Command Core'; return res; }
  if (type === 'core') {
    if (planet.bases.length >= B.maxCoresPerPlanet) { res.reason = `Limit reached: ${B.maxCoresPerPlanet} Command Cores per planet`; return res; }
    for (const other of planet.bases) {
      const oc = other.grid.origin.clone().multiplyScalar(planet.radius);
      if (oc.distanceTo(center) < B.minCoreSpacing) { res.reason = `Too close to another colony (min ${B.minCoreSpacing} m)`; return res; }
    }
  }
  if (site.submerged) { res.reason = 'Cannot build on liquid'; return res; }
  if (!B.autoLevel && site.maxH - site.minH > B.maxUnevenness) { res.reason = 'Ground too uneven'; return res; }
  if (base && !base.isFree(i0, j0, w, h)) { res.reason = 'Space occupied'; return res; }
  // Colonies may border each other: also keep clear of buildings from the other colonies.
  for (const other of planet.bases) {
    if (other === base) continue;
    for (const b of other.buildings) {
      const ob = (Math.max(b.w, b.h) * grid.cs) / 2;
      if (b.localPos.distanceTo(center) < (half + ob) * 0.9) { res.reason = 'Space occupied'; return res; }
    }
  }
  if (shipLocal && center.distanceTo(shipLocal) < half + B.shipClearance) { res.reason = 'Too close to your ship'; return res; }
  for (const n of planet.resources.nodes) {
    if (n.pos.distanceTo(center) < half * 1.05 + 0.6) { res.reason = 'Blocked by a resource node'; return res; }
  }
  for (const o of planet.obstacles) {
    if (o.relic && o.pos.distanceTo(center) < half + 2) { res.reason = 'Blocked by an ancient relic'; return res; }
  }
  if (type === 'extractor') {
    let best = null, bestD = half + B.extractorReach;
    for (const n of planet.resources.nodes) {
      if (!NODE_ITEM[n.type] || n.tapped) continue;
      const d = n.pos.distanceTo(center);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best) { res.reason = 'Place next to a Crystal, Iron or Stone node'; return res; }
    res.node = best;
  }
  const missing = Object.entries(res.cost).find(([k, v]) => inventory.get(k) < v);
  if (missing && ctx.allowBlueprint && type !== 'core') {
    // With the Tech Moon overhead, unaffordable buildings can be queued as blueprints.
    res.ok = true;
    res.blueprint = true;
    res.reason = `Blueprint — the Tech Moon builds it when you have ${RESOURCE_LABELS[missing[0]]}`;
    return res;
  }
  if (missing) { res.reason = `Not enough ${RESOURCE_LABELS[missing[0]]} (${Math.floor(inventory.get(missing[0]))}/${missing[1]})`; return res; }
  res.ok = true;
  res.reason = res.node ? `Drills ${CONFIG.resources.types[res.node.type].label}` : 'Click to build';
  return res;
}

// ============================================================ health bar
const BAR_W = 3.2;
/** Billboard health bar: { group, set(fraction, color) }. Also used by units. */
export function makeBar() {
  const group = new THREE.Group();
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x0b1020, transparent: true, opacity: 0.8, depthWrite: false }));
  bg.scale.set(BAR_W + 0.2, 0.42, 1);
  const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5dff9a, depthWrite: false }));
  fill.scale.set(BAR_W, 0.26, 1);
  bg.renderOrder = 10; fill.renderOrder = 11;
  group.add(bg, fill);
  return {
    group,
    set(frac, color) {
      const f = Math.max(0.001, Math.min(1, frac));
      fill.scale.x = BAR_W * f;
      fill.center.set(0.5 / f, 0.5);   // keeps the left edge fixed
      fill.material.color.set(color);
    },
  };
}

// ============================================================== Building
export class Building {
  constructor(base, type, i0, j0, rot, state = null, level = null) {
    this.base = base;
    this.planet = base.planet;
    this.type = type;
    this.def = CONFIG.buildings[type];
    this.i0 = i0; this.j0 = j0; this.rot = rot;
    const grid = base.grid;
    [this.w, this.h] = grid.footprint(type, rot);
    const site = measureFootprint(grid, i0, j0, this.w, this.h);
    this.dir = site.dir;
    // `level` is the pad height chosen by Base.add when auto-levelling.
    this.level = level ?? site.maxH;
    this.localPos = site.dir.clone().multiplyScalar(this.planet.radius + this.level);
    this.node = null;
    this.item = null;

    this.progress = state?.progress ?? 0;
    this.built = this.progress >= 1;
    this.hp = state?.hp ?? this.def.hp * (this.built ? 1 : 0.1);
    this.cycleT = state?.cycleT ?? 0;
    /** Units waiting to be trained: [{ type, t (seconds done) }] */
    this.queue = (state?.queue || []).filter((q) => CONFIG.units[q.type]).map((q) => ({ type: q.type, t: q.t || 0 }));
    /** Blueprint: placed but not paid yet — the Tech Moon starts it when resources allow. */
    this.planned = !!state?.planned;
    /** Production buildings: keep training automatically (Tech Moon automation). */
    this.autoRecruit = !!state?.autoRecruit;
    this.powered = true;
    this.waiting = false;
    this.status = '';

    // --- scene graph: group (on surface) → foundation + model + scaffold + bar
    this.group = new THREE.Group();
    this.group.position.copy(this.localPos);
    quatFromUpForward(site.dir, grid.forwardAt(site.dir, rot), this.group.quaternion);
    // The group is already rotated, so model-space sizes use the unrotated footprint.
    const [w0, h0] = footprintOf(type, 0);
    const fw = w0 * grid.cs, fh = h0 * grid.cs;
    const fHeight = Math.max(0, this.level - site.minH) + 0.8;
    const foundation = new THREE.Mesh(new THREE.BoxGeometry(fw, fHeight, fh), MAT.foundation);
    foundation.position.y = 0.05 - fHeight / 2;
    foundation.receiveShadow = true;
    this.group.add(foundation);
    this.footprintSize = [fw, fh];
    this.planet.group.add(this.group);
    this._modelOpts = {};
  }

  /** Called by Base.add once node links are known (extractor colour etc.). */
  _buildModel() {
    const m = MODELS[this.type](this.planet, this._modelOpts);
    this.model = m;
    this.group.add(m.group);
    const [fw, fh] = this.footprintSize;
    this.scaffold = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fw * 0.96, m.height, fh * 0.96)), MAT.scaffold);
    this.scaffold.position.y = m.height / 2;
    this.group.add(this.scaffold);
    this.bar = makeBar();
    this.bar.group.position.y = m.height + 1.2;
    this.group.add(this.bar.group);
    this._applyVisuals(0, 0, false);
  }

  get maxHp() { return this.def.hp; }
  get cycleProgress() { return this.def.cycle > 0 ? Math.min(1, this.cycleT / this.def.cycle) : 0; }
  get active() { return this.built && this.powered && !this.waiting; }

  /** Resources produced per cycle (extractors depend on their node). */
  outputs() {
    if (this.type === 'extractor') return this.item ? { [this.item]: this.def.nodeOutput } : {};
    return this.def.output;
  }

  /** Builders (workers) add construction progress on top of the automatic rate. */
  addBuildProgress(seconds) {
    if (this.built || this.planned) return;
    this.progress = Math.min(1, this.progress + seconds / this.def.buildTime);
    this.hp = Math.min(this.def.hp, this.hp + (this.def.hp * 0.9 * seconds) / this.def.buildTime);
  }

  /** Damage from enemies. Returns true if this hit destroyed the building. */
  takeDamage(amount, game, source = null) {
    if (this.removed || this.hp <= 0) return false;
    this.hp -= amount;
    this.lastHit = game.time;
    if (source) game.onBuildingAttacked(this, source);
    if (this.hp <= 0) { game.onBuildingDestroyed(this); return true; }
    return false;
  }

  get alive() { return !this.removed && this.hp > 0; }
  /** Rough radius for targeting / weapon range checks. */
  get radius() { return (Math.max(this.w, this.h) * CONFIG.base.cellSize) / 2; }

  update(dt, game) {
    const def = this.def, inv = game.inventory, mods = game.modifiers;
    if (this.planned) {
      this.status = 'Blueprint · waiting for resources';
      this._applyVisuals(dt, game.time, game.mode === 'build' || this.selected);
      return;
    }
    if (!this.built) {
      // The Tech Moon overhead speeds construction up.
      const speed = (mods.buildSpeed ?? 1) * (game.techMoon?.automates(this.planet) ? CONFIG.techMoon.buildSpeedBonus : 1);
      this.progress = Math.min(1, this.progress + (dt * speed) / def.buildTime);
      this.hp = Math.min(this.hp + (def.hp * 0.9 * dt * speed) / def.buildTime, def.hp);
      this.status = `Under construction · ${Math.floor(this.progress * 100)}%`;
      if (this.progress >= 1) {
        this.built = true;
        this.hp = Math.max(this.hp, def.hp * 0.95);
        this.cycleT = 0;
        game.onBuildingComplete(this);
      }
    } else {
      // Upkeep applies to every finished building that has one.
      const cost = def.upkeep * dt;
      this.powered = cost <= 0 || inv.get('energy') >= cost;
      if (this.powered && cost > 0) inv.add('energy', -cost);
      this.waiting = false;
      if (!this.powered) {
        this.status = 'No power';
      } else {
        this.status = 'Online';
        if (def.cycle > 0) this._updateProduction(dt, game);
        if (def.trains) this._updateTraining(dt, game);
        if (def.weapon) this._updateTurret(dt, game);
      }
      // Predictive Defense: damaged buildings slowly repair themselves.
      const rep = game.modifiers.autoRepair;
      if (rep && this.hp < def.hp && game.time - (this.lastHit ?? -99) > rep.delay) {
        this.hp = Math.min(def.hp, this.hp + def.hp * rep.rate * dt);
      }
    }
    this._applyVisuals(dt, game.time, game.mode === 'build' || this.selected);
  }

  _updateProduction(dt, game) {
    const def = this.def, inv = game.inventory, mods = game.modifiers;
    this.cycleT += dt;
    if (this.cycleT < def.cycle) return;
    const out = this.outputs();
    // Generators idle while energy storage is full — no crystals are wasted.
    if (out.energy && inv.get('energy') + out.energy * (mods.production ?? 1) > game.energyCap + 0.001 && def.cycle > 1) {
      this.cycleT = def.cycle;
      this.waiting = true;
      this.status = 'Standby · energy storage full';
      return;
    }
    if (!inv.canAfford(def.input)) {
      this.cycleT = def.cycle;
      this.waiting = true;
      const need = Object.keys(def.input).find((k) => inv.get(k) < def.input[k]);
      this.status = `Waiting for ${RESOURCE_LABELS[need]}`;
      return;
    }
    inv.spend(def.input);
    this.cycleT -= def.cycle;
    for (const [k, v] of Object.entries(out)) {
      const amount = v * (mods.production ?? 1);
      inv.add(k, amount);
      game.onProduce(this, k, amount);
    }
  }

  /** Defense Turret: aim at and shoot the nearest enemy in range. */
  _updateTurret(dt, game) {
    const w = this.def.weapon;
    this.cooldown = Math.max(0, (this.cooldown ?? 0) - dt);
    this.scanT = (this.scanT ?? 0) - dt;
    if (this.scanT <= 0 || !this.target?.alive) {
      this.scanT = 0.3;
      this.target = game.units.nearestEnemyTo(this.planet, this.localPos, w.range + this.radius);
    }
    const t = this.target;
    if (!t || !t.alive || t.local.distanceTo(this.localPos) - t.radius > w.range + this.radius) {
      this.target = null;
      this.aimYaw = null;
      this.status = 'Online · scanning';
      return;
    }
    // aim the head (angle in the building's own frame)
    const p = this.group.worldToLocal(t.worldPos);
    this.aimYaw = Math.atan2(p.x, p.z);
    this.status = `Engaging ${t.def.name}`;
    if (this.cooldown > 0) return;
    this.cooldown = w.cooldown;
    const muzzle = this.localPos.clone().addScaledVector(this.dir, 2.2).add(this.planet.position);
    game.units.spawnBolt('player', muzzle, t.worldPos, 'turret');
    t.takeDamage(w.damage * (game.modifiers.damage ?? 1), game, this);
  }

  /** Production queue of Barracks / Robotics Factory / Hangar. */
  _updateTraining(dt, game) {
    const job = this.queue[0];
    if (!job) { this.status = 'Online · idle'; return; }
    const udef = CONFIG.units[job.type];
    if (!game.units.canSpawnMore()) { this.status = `Unit limit reached (${game.unitCap})`; this.waiting = true; return; }
    job.t += dt * (game.modifiers.production ?? 1);
    this.status = `Training ${udef.name} · ${Math.floor((job.t / udef.time) * 100)}%`;
    if (job.t >= udef.time) {
      this.queue.shift();
      game.units.spawnFrom(job.type, this);
    }
  }

  _applyVisuals(dt, time, showBars) {
    const h = this.model.height;
    this.model.group.position.y = this.built ? 0 : -(1 - this.progress) * h * 0.92;
    this.model.group.visible = !this.planned;   // blueprints show only the cyan scaffold
    this.scaffold.visible = !this.built;
    this.scaffold.material = this.planned ? MAT.blueprint : MAT.scaffold;
    this.model.animate(dt, time, this.active, this);
    const damaged = this.hp < this.maxHp - 0.5;
    this.bar.group.visible = showBars || !this.built || damaged;
    if (!this.built) this.bar.set(this.progress, 0xffa040);
    else this.bar.set(this.hp / this.maxHp, !this.powered ? 0xff4d5e : this.waiting ? 0xffd84d : 0x5dff9a);
  }

  setSelected(on) {
    this.selected = on;
    if (on && !this.selBox) {
      const [fw, fh] = this.footprintSize;
      this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fw + 0.3, 0.4, fh + 0.3)), MAT.select);
      this.selBox.position.y = 0.2;
      this.group.add(this.selBox);
    }
    if (this.selBox) this.selBox.visible = on;
  }

  serialize() {
    return {
      type: this.type, i0: this.i0, j0: this.j0, rot: this.rot,
      progress: +this.progress.toFixed(4), hp: Math.round(this.hp), cycleT: +this.cycleT.toFixed(2),
      node: this.node ? this.node.id : -1,
      queue: this.queue.map((q) => ({ type: q.type, t: +q.t.toFixed(2) })),
      planned: this.planned || undefined,
      autoRecruit: this.autoRecruit || undefined,
    };
  }

  dispose() {
    this.group.removeFromParent();
    if (this.pipe) this.pipe.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose?.();   // (ranch critters share the herd's geometry)
      if (o.material?.userData?.own) o.material.dispose();   // per-building glow / beam materials
    });
  }
}

// ================================================================== Base
export class Base {
  constructor(planet, grid) {
    this.planet = planet;
    this.grid = grid;
    this.buildings = [];
    this.cells = new Map();     // "i,j" → building
    planet.bases.push(this);
  }

  /** 1-based colony number on its planet (Colony 1, 2, 3). */
  get number() { return this.planet.bases.indexOf(this) + 1; }

  get core() { return this.buildings.find((b) => b.type === 'core'); }

  isFree(i0, j0, w, h) {
    for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + h; j++) if (this.cells.has(i + ',' + j)) return false;
    return true;
  }

  /** Create a building. `node` links an Extractor to its resource node. */
  add(type, i0, j0, rot, state = null, node = null) {
    let level = null;
    if (CONFIG.base.autoLevel) {
      // Terraform a flat pad first (leaving other buildings' ground untouched).
      const [w, h] = footprintOf(type, rot);
      const site = measureFootprint(this.grid, i0, j0, w, h);
      level = site.level;
      const protect = this.planet.bases.flatMap((base) => base.buildings).map((b) => ({
        dir: b.dir, r: (Math.max(b.w, b.h) * this.grid.cs) / 2 * Math.SQRT2 + 0.3,
      }));
      this.planet.levelArea(this.grid, site.cx, site.cy, (w * this.grid.cs) / 2, (h * this.grid.cs) / 2, level, protect);
    }
    const b = new Building(this, type, i0, j0, rot, state, level);
    if (node) {
      b.node = node;
      node.tapped = b;
      b.item = NODE_ITEM[node.type];
      b._modelOpts.item = b.item;
    }
    b._buildModel();
    if (node) this._addPipe(b);
    for (let i = i0; i < i0 + b.w; i++) for (let j = j0; j < j0 + b.h; j++) this.cells.set(i + ',' + j, b);
    // Clear trees under the footprint and block walking through the building.
    const half = (Math.max(b.w, b.h) * this.grid.cs) / 2;
    this.planet.decor.removeFloraNear(b.localPos, half * Math.SQRT2 + 1.0);   // corners + canopy overhang
    b.obstacle = { pos: b.localPos, r: (Math.min(b.w, b.h) * this.grid.cs) / 2 * 0.95, building: b };
    this.planet.obstacles.push(b.obstacle);
    this.buildings.push(b);
    this.planet.navVersion++;
    return b;
  }

  /** Conveyor pipe from an Extractor down to the node it drills. */
  _addPipe(b) {
    const a = b.localPos.clone().addScaledVector(b.dir, 0.4);
    const n = b.node.pos.clone().addScaledVector(b.node.dir, 0.4);
    const len = a.distanceTo(n);
    const pipe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, len), glowMat(ITEM_GLOW[b.item], 1.2));
    pipe.position.copy(a).add(n).multiplyScalar(0.5);
    pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().sub(a).normalize());
    this.planet.group.add(pipe);
    b.pipe = pipe;
  }

  remove(b) {
    for (let i = b.i0; i < b.i0 + b.w; i++) for (let j = b.j0; j < b.j0 + b.h; j++) this.cells.delete(i + ',' + j);
    const k = this.planet.obstacles.indexOf(b.obstacle);
    if (k >= 0) this.planet.obstacles.splice(k, 1);
    if (b.node) b.node.tapped = null;
    b.removed = true;   // units targeting it will notice
    this.buildings.splice(this.buildings.indexOf(b), 1);
    this.planet.navVersion++;
    b.dispose();
  }

  /** Building whose footprint contains a planet-local point, if any. */
  buildingAt(localPoint) {
    const p = this.grid.toPlane(localPoint);
    if (!p) return null;
    const i = Math.floor(p.x / this.grid.cs), j = Math.floor(p.y / this.grid.cs);
    return this.cells.get(i + ',' + j) || null;
  }

  update(dt, game) {
    for (const b of this.buildings) b.update(dt, game);
  }

  /** Theoretical production per minute of every finished building (for the HUD). */
  rates(game) {
    const r = {};
    const add = (k, v) => { r[k] = (r[k] || 0) + v; };
    for (const b of this.buildings) {
      if (!b.built) continue;
      const d = b.def;
      if (d.upkeep) add('energy', -d.upkeep * 60);
      if (d.cycle > 0) {
        const perMin = 60 / d.cycle;
        for (const [k, v] of Object.entries(b.outputs())) add(k, v * perMin * (game.modifiers.production ?? 1));
        for (const [k, v] of Object.entries(d.input)) add(k, -v * perMin);
      }
    }
    return r;
  }

  serialize() {
    return { planet: this.planet.index, grid: this.grid.serialize(), buildings: this.buildings.map((b) => b.serialize()) };
  }

  static deserialize(planet, data) {
    const grid = new Grid(planet, new THREE.Vector3().fromArray(data.grid.origin), new THREE.Vector3().fromArray(data.grid.north));
    const base = new Base(planet, grid);
    for (const s of data.buildings) {
      if (!CONFIG.buildings[s.type] || !MODELS[s.type]) continue;
      const node = s.node >= 0 ? planet.resources.nodes[s.node] : null;
      base.add(s.type, s.i0, s.j0, s.rot, s, node);
    }
    return base;
  }

  destroy() {
    for (const b of [...this.buildings]) this.remove(b);
    const i = this.planet.bases.indexOf(this);
    if (i >= 0) this.planet.bases.splice(i, 1);
  }
}
