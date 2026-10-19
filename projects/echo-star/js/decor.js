/**
 * Planet decoration: trees / flora, small rocks and ancient relics.
 * Purely visual (plus collision obstacles); harvestable things live in
 * resources.js. Everything repeated is drawn with InstancedMesh.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { box, part, merge, makeInstanced } from './geometry.js';
import { RNG, hashSeed } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------ ground scatter
// Small props sprinkled over the ground in clusters: grass, flowers, pebbles,
// ice crystals, ember rocks, glowing spores. Visual only (no collision);
// cleared under buildings like trees. Grass and stalks sway in the wind.

/** Shared wind clock for every swaying material. */
const SWAY = { uTime: { value: 0 }, uSway: { value: CONFIG.fx.scatterSway } };

function withSway(mat, key) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SWAY);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float sw = (sin(uTime * 1.6 + ip.x * 0.37 + ip.z * 0.29) + 0.5 * sin(uTime * 2.7 + ip.y * 0.41)) * uSway * max(position.y, 0.0);
          transformed.x += sw * 0.25;
          transformed.z += sw * 0.15;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'echo-sway-' + key;
  return mat;
}

const SCATTER_MAT = {
  sway: withSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 'std'),
  still: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
  ice: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, flatShading: true, emissive: 0x2a7f9a, emissiveIntensity: 0.35 }),
  // HDR colours (> 1) so the glowing bits bloom; instance colours tint them
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) }),
  glowSway: withSway(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) }), 'glow'),
};

function grassTuft(color, h = 0.55) {
  const c = new THREE.Color(color), parts = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.4;
    const hh = h * (0.65 + 0.35 * ((k * 3) % 5) / 4);
    parts.push(box(0.07, hh, 0.07, c.clone().offsetHSL(0, 0, ((k % 3) - 1) * 0.06),
      Math.cos(a) * 0.12, hh / 2, Math.sin(a) * 0.12, { rx: Math.sin(a) * 0.35, rz: -Math.cos(a) * 0.35 }));
  }
  return merge(parts);
}

const flowerStem = (color) => merge([
  box(0.05, 0.45, 0.05, color, 0, 0.225, 0),
  box(0.14, 0.04, 0.06, color, 0.06, 0.2, 0, { rz: 0.5 }),
]);
const flowerHead = () => merge([
  box(0.2, 0.06, 0.2, 0xffffff, 0, 0.47, 0),
  box(0.08, 0.08, 0.08, 0xffe680, 0, 0.51, 0),
]);

function pebbles(color) {
  const c = new THREE.Color(color);
  return merge([
    part(new THREE.DodecahedronGeometry(0.2, 0), c, { y: 0.06, sy: 0.6 }),
    part(new THREE.DodecahedronGeometry(0.13, 0), c.clone().offsetHSL(0, 0, 0.07), { x: 0.28, y: 0.04, z: 0.1, sy: 0.6 }),
    part(new THREE.DodecahedronGeometry(0.1, 0), c.clone().offsetHSL(0, 0, -0.06), { x: -0.2, y: 0.03, z: 0.22, sy: 0.7 }),
  ]);
}

function iceCrystal() {
  const parts = [];
  for (const [h, r, x, z, rx, rz] of [[0.75, 0.09, 0, 0, 0, 0], [0.5, 0.07, 0.14, 0.05, 0.2, -0.45], [0.42, 0.06, -0.12, 0.1, 0.3, 0.5]]) {
    const prism = new THREE.CylinderGeometry(r, r * 1.1, h, 6);
    prism.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2, 6);
    tip.translate(0, h + r, 0);
    for (const g of [prism, tip]) parts.push(part(g, 0xbfeaff, { rx, rz, x, z }));
  }
  return merge(parts);
}

const emberRock = () => merge([
  part(new THREE.DodecahedronGeometry(0.32, 0), 0x2a2220, { y: 0.15, sy: 0.65 }),
  part(new THREE.DodecahedronGeometry(0.2, 0), 0x3a2e2a, { x: 0.32, y: 0.08, z: 0.1, sy: 0.6 }),
]);
const emberGlow = () => merge([
  box(0.12, 0.05, 0.12, 0xff6a1a, 0.05, 0.3, 0.05, { ry: 0.6 }),
  box(0.08, 0.05, 0.16, 0xff8a2a, -0.12, 0.24, -0.05, { ry: 0.3 }),
  box(0.07, 0.04, 0.07, 0xff5a10, 0.35, 0.17, 0.12),
]);

const sporeStalk = (color) => merge([
  box(0.05, 0.32, 0.05, color, 0, 0.16, 0, { rz: 0.12 }),
  box(0.05, 0.28, 0.05, color, -0.03, 0.44, 0, { rz: -0.15 }),
]);
const sporeBall = () => merge([part(new THREE.OctahedronGeometry(0.08, 0), 0xffffff, { x: 0.01, y: 0.6 })]);

/** Scatter recipe per biome: share of the total, max slope, scale range and the instanced parts. */
const SCATTER = {
  meadow: (b, colors) => [
    { share: 0.8, maxSlope: 0.6, scale: [0.8, 1.5], parts: [{ geo: grassTuft(colors.low.clone().offsetHSL(0, 0.05, 0.02)), mat: SCATTER_MAT.sway }] },
    { share: 0.2, maxSlope: 0.5, scale: [0.8, 1.2], parts: [
      { geo: flowerStem(b.plant), mat: SCATTER_MAT.sway },
      { geo: flowerHead(), mat: SCATTER_MAT.sway, colors: [0xff5a7a, 0xffd84d, 0xffffff, 0xa98bff, 0x6ad8ff, b.berry] },
    ] },
  ],
  dry: (b) => [
    { share: 0.55, maxSlope: 0.6, scale: [0.7, 1.3], parts: [{ geo: grassTuft(0xc8b06a, 0.45), mat: SCATTER_MAT.sway }] },
    { share: 0.45, maxSlope: 0.9, scale: [0.7, 1.6], parts: [{ geo: pebbles(b.rock), mat: SCATTER_MAT.still }] },
  ],
  ice: (b) => [
    { share: 0.45, maxSlope: 0.8, scale: [0.6, 1.5], parts: [{ geo: iceCrystal(), mat: SCATTER_MAT.ice }] },
    { share: 0.55, maxSlope: 0.9, scale: [0.7, 1.5], parts: [{ geo: pebbles(0xe8f2fa), mat: SCATTER_MAT.still }] },
  ],
  embers: (b) => [
    { share: 0.45, maxSlope: 0.8, scale: [0.7, 1.6], parts: [
      { geo: emberRock(), mat: SCATTER_MAT.still },
      { geo: emberGlow(), mat: SCATTER_MAT.glow, colors: [0xffffff, 0xffc890, 0xff9a70] },
    ] },
    { share: 0.55, maxSlope: 0.9, scale: [0.7, 1.5], parts: [{ geo: pebbles(0x3a302c), mat: SCATTER_MAT.still }] },
  ],
  spores: (b) => [
    { share: 0.6, maxSlope: 0.6, scale: [0.8, 1.4], parts: [{ geo: grassTuft(b.plant, 0.5), mat: SCATTER_MAT.sway }] },
    { share: 0.4, maxSlope: 0.6, scale: [0.8, 1.5], parts: [
      { geo: sporeStalk(0xd8c8ff), mat: SCATTER_MAT.sway },
      { geo: sporeBall(), mat: SCATTER_MAT.glowSway, colors: [0x6affea, 0xff7ae0, 0xfff06a] },
    ] },
  ],
};

/**
 * Sprinkle the biome's scatter over dry land, in clusters.
 * Returns { removeNear, restore, resnap } for buildings and terraforming.
 */
function buildScatter(planet) {
  const recipe = SCATTER[planet.biome.scatter];
  const items = [];
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const allMeshes = [];
  const api = {
    items, removeNear() {}, restore() {}, resnap() {},
    setVisible(on) { for (const mesh of allMeshes) mesh.visible = on; },
  };
  if (!recipe) return api;
  const rng = new RNG(hashSeed(planet.seed, 707));
  const total = Math.round(CONFIG.fx.scatterPerPlanet * (planet.radius / 80) ** 2);
  const m = new THREE.Matrix4(), c = new THREE.Color(), off = new THREE.Vector3();
  for (const kind of recipe(planet.biome, planet.colors)) {
    const n = Math.round(total * kind.share);
    const meshes = kind.parts.map((p) => makeInstanced(p.geo, p.mat, n, { castShadow: false, receiveShadow: true }));
    let placed = 0, centre = null, left = 0;
    for (let tries = 0; tries < n * 3 && placed < n; tries++) {
      if (left <= 0) { centre = rng.unitVector(); left = rng.int(5, 14); }
      left--;
      const dir = centre.clone().addScaledVector(rng.unitVector(off), rng.range(0, 5) / planet.radius).normalize();
      if (planet.isSubmerged(dir)) continue;
      if (planet.hasLiquid && planet.biome.liquid !== 'ice' && planet.heightAt(dir) < planet.seaHeight + 0.3) continue;
      if (planet.slopeAt(dir) > kind.maxSlope) continue;
      const pos = planet.surfacePoint(dir, new THREE.Vector3());
      surfaceMatrix(dir, pos, rng.range(0, 6.28), rng.range(kind.scale[0], kind.scale[1]), m, 0.05);
      meshes.forEach((mesh, k) => {
        mesh.setMatrixAt(placed, m);
        const pal = kind.parts[k].colors;
        mesh.setColorAt(placed, pal ? c.set(rng.pick(pal)) : c.setScalar(rng.range(0.85, 1.12)));
      });
      items.push({ pos, dir, matrix: m.clone(), meshes, i: placed, removed: false });
      placed++;
    }
    for (const mesh of meshes) { mesh.count = placed; planet.group.add(mesh); allMeshes.push(mesh); }
  }
  const touch = (list) => { for (const mesh of new Set(list.flatMap((it) => it.meshes))) mesh.instanceMatrix.needsUpdate = true; };
  api.removeNear = (localPos, radius) => {
    const hit = items.filter((it) => !it.removed && it.pos.distanceTo(localPos) < radius);
    for (const it of hit) { it.removed = true; for (const mesh of it.meshes) mesh.setMatrixAt(it.i, hidden); }
    touch(hit);
  };
  api.restore = () => {
    const back = items.filter((it) => it.removed);
    for (const it of back) { it.removed = false; for (const mesh of it.meshes) mesh.setMatrixAt(it.i, it.matrix); }
    touch(back);
  };
  /** Terraforming: `ground(dir)` returns how far the ground moved under a direction. */
  api.resnap = (center, radius, ground) => {
    const moved = [];
    for (const it of items) {
      if (it.pos.distanceTo(center) > radius) continue;
      const delta = ground(it.dir);
      if (!delta) continue;
      it.pos.addScaledVector(it.dir, delta);
      const e = it.matrix.elements;
      e[12] += it.dir.x * delta; e[13] += it.dir.y * delta; e[14] += it.dir.z * delta;
      if (!it.removed) for (const mesh of it.meshes) mesh.setMatrixAt(it.i, it.matrix);
      moved.push(it);
    }
    touch(moved);
  };
  return api;
}

// ---------------------------------------------------- flora model builders
// All models stand on y = 0 and are roughly 4–5 units tall.
const FLORA = {
  oak: (b) => merge([
    box(0.5, 2.2, 0.5, 0x7a5230, 0, 1.1, 0),
    box(2.4, 1.8, 2.4, b.leaf, 0, 3.0, 0),
    box(1.5, 1.1, 1.5, new THREE.Color(b.leaf).offsetHSL(0, 0, 0.08), 0, 4.3, 0),
    box(1.0, 0.9, 1.0, new THREE.Color(b.leaf).offsetHSL(0, 0, -0.08), 1.1, 2.6, 0.4),
  ]),
  pine: (b) => merge([
    box(0.4, 1.4, 0.4, 0x5b4030, 0, 0.7, 0),
    box(2.4, 0.9, 2.4, b.leaf, 0, 1.8, 0),
    box(2.0, 0.2, 2.0, 0xf2f8ff, 0, 2.33, 0),
    box(1.7, 0.9, 1.7, b.leaf, 0, 2.8, 0),
    box(1.0, 0.9, 1.0, b.leaf, 0, 3.7, 0),
    box(0.6, 0.4, 0.6, 0xffffff, 0, 4.35, 0),
  ]),
  cactus: (b) => merge([
    box(0.7, 3.0, 0.7, b.leaf, 0, 1.5, 0),
    box(0.8, 0.4, 0.4, b.leaf, 0.6, 1.4, 0),
    box(0.4, 1.1, 0.4, b.leaf, 0.85, 2.0, 0),
    box(0.7, 0.4, 0.4, b.leaf, -0.55, 1.0, 0),
    box(0.4, 0.8, 0.4, b.leaf, -0.75, 1.5, 0),
    box(0.3, 0.25, 0.3, 0xff7ab8, 0, 3.12, 0),
  ]),
  deadtree: (b) => merge([
    box(0.45, 2.8, 0.45, 0x2b2522, 0, 1.4, 0),
    box(1.4, 0.25, 0.25, 0x2b2522, 0.55, 2.3, 0, { rz: 0.5 }),
    box(1.1, 0.22, 0.22, 0x2b2522, -0.45, 1.8, 0.1, { rz: -0.6 }),
    box(0.22, 0.22, 0.9, 0x2b2522, 0, 2.6, 0.35, { rx: 0.5 }),
    box(0.22, 0.22, 0.22, 0xff6a2a, 1.15, 2.65, 0),
    box(0.2, 0.2, 0.2, 0xff6a2a, -0.92, 2.15, 0.1),
  ]),
  mushroom: (b) => merge([
    box(0.5, 2.4, 0.5, 0xe8e0ff, 0, 1.2, 0),
    box(2.6, 0.6, 2.6, b.leaf, 0, 2.6, 0),
    box(1.6, 0.4, 1.6, new THREE.Color(b.leaf).offsetHSL(0, 0, 0.1), 0, 3.05, 0),
    box(0.3, 0.12, 0.3, 0xffffff, 0.8, 2.95, 0.5),
    box(0.3, 0.12, 0.3, 0xffffff, -0.6, 2.95, -0.7),
    box(0.25, 0.12, 0.25, 0xffffff, 0.2, 3.3, -0.3),
  ]),
};

function rockGeometry(color) {
  return merge([
    part(new THREE.IcosahedronGeometry(0.6, 0), color, { sy: 0.7 }),
    part(new THREE.IcosahedronGeometry(0.35, 0), new THREE.Color(color).offsetHSL(0, 0, 0.06), { x: 0.5, y: 0.05, z: 0.2, sy: 0.8 }),
  ]);
}

/**
 * Find a random spot on land.
 * Returns { dir, pos } in planet-local space, or null.
 */
export function findLandSpot(planet, rng, { maxSlope = 0.6, minHeightAboveSea = 0.4, radius = 1, tries = 12 } = {}) {
  const dir = new THREE.Vector3();
  for (let i = 0; i < tries; i++) {
    rng.unitVector(dir);
    if (planet.isSubmerged(dir)) continue;
    if (planet.hasLiquid && planet.heightAt(dir) < planet.seaHeight + minHeightAboveSea && planet.biome.liquid !== 'ice') continue;
    if (planet.slopeAt(dir) > maxSlope) continue;
    const pos = planet.surfacePoint(dir, new THREE.Vector3());
    if (!planet.isFree(pos, radius)) continue;
    return { dir: dir.clone(), pos };
  }
  return null;
}

/** Compose an instance matrix standing on the surface. */
export function surfaceMatrix(dir, pos, yaw, scale, out = new THREE.Matrix4(), sink = 0.15) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  const p = pos.clone().addScaledVector(dir, -sink * scale);
  return out.compose(p, q, new THREE.Vector3(scale, scale, scale));
}

// =============================================================== builder
export function buildDecor(planet, rng) {
  const b = planet.biome;
  const area = (planet.radius / 80) ** 2;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const animated = [];
  const relics = [];

  // ---- relics first so they get the best spots
  const relicCount = rng.int(CONFIG.planet.monoliths[0], CONFIG.planet.monoliths[1]);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x161922, roughness: 0.4, metalness: 0.6 });
  const glyphMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: planet.crystalColor, emissiveIntensity: 2.4 });
  for (let i = 0; i < relicCount; i++) {
    const spot = findLandSpot(planet, rng, { maxSlope: 0.35, radius: 4, tries: 30 });
    if (!spot) continue;
    const relic = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 0.7), slabMat);
    slab.position.y = 3.2; slab.castShadow = true; slab.receiveShadow = true;
    const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.2, 0.74), glyphMat);
    glyph.position.y = 3.4;
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), glyphMat);
    cube.position.y = 8.2;
    const ring = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 3.2), slabMat);
    ring.position.y = 0.05; ring.receiveShadow = true;
    relic.add(slab, glyph, cube, ring);
    relic.quaternion.setFromUnitVectors(UP, spot.dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rng.range(0, 6.28)));
    relic.position.copy(spot.pos);
    planet.group.add(relic);
    planet.occupied.push({ pos: spot.pos, r: 4 });
    planet.obstacles.push({ pos: spot.pos, r: 1.1, relic: true });
    animated.push({ cube, phase: rng.range(0, 6.28) });
    relics.push(relic);
  }

  // ---- flora (trees, cacti, mushrooms…)
  const floraGeo = FLORA[b.flora](b);
  const floraMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const floraTarget = Math.round(CONFIG.planet.floraPerPlanet * b.floraDensity * area);
  const floraMesh = makeInstanced(floraGeo, floraMat, floraTarget);
  const floraMatrices = [];
  const floraObstacles = [];
  let n = 0;
  for (let i = 0; i < floraTarget * 2 && n < floraTarget; i++) {
    const spot = findLandSpot(planet, rng, { maxSlope: 0.5, radius: 1.6, tries: 1 });
    if (!spot) continue;
    const s = rng.range(0.75, 1.35);
    surfaceMatrix(spot.dir, spot.pos, rng.range(0, 6.28), s, m);
    floraMesh.setMatrixAt(n, m);
    floraMatrices.push(m.clone());
    floraMesh.setColorAt(n, c.setScalar(rng.range(0.85, 1.12)));
    planet.occupied.push({ pos: spot.pos, r: 1.2 * s });
    // r = trunk (blocks walking), cam = canopy size (ghosted when hiding the player)
    const obstacle = { pos: spot.pos, r: 0.45 * s, cam: 1.4 * s, flora: n };
    planet.obstacles.push(obstacle);
    floraObstacles.push(obstacle);
    n++;
  }
  floraMesh.count = n;
  planet.group.add(floraMesh);

  // Translucent copy used for trees that block the camera's view of the player.
  const GHOST_MAX = 12;
  const ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, transparent: true, opacity: 0.22, depthWrite: false });
  const ghostMesh = makeInstanced(floraGeo, ghostMat, 0, { castShadow: false, receiveShadow: false });
  ghostMesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(GHOST_MAX * 16), 16);
  ghostMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  planet.group.add(ghostMesh);
  let ghosted = [];
  const removed = new Set();   // trees cleared by buildings
  const removedObstacles = [];
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  // ---- small decorative rocks (no collision)
  const rockMesh = makeInstanced(rockGeometry(b.rock), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), Math.round(CONFIG.planet.decorRocksPerPlanet * area));
  let r = 0;
  for (let i = 0; i < rockMesh.count * 2 && r < rockMesh.count; i++) {
    const spot = findLandSpot(planet, rng, { maxSlope: 0.9, radius: 0.6, tries: 1, minHeightAboveSea: 0 });
    if (!spot) continue;
    rockMesh.setMatrixAt(r, surfaceMatrix(spot.dir, spot.pos, rng.range(0, 6.28), rng.range(0.5, 1.4), m, 0.25));
    rockMesh.setColorAt(r, c.setScalar(rng.range(0.85, 1.1)));
    r++;
  }
  rockMesh.count = r;
  planet.group.add(rockMesh);

  // ---- ground scatter (own seed: adding it never moves trees or resources)
  const scatter = buildScatter(planet);

  return {
    flora: floraMesh,
    rocks: rockMesh,
    /** Swap the given flora instances to the translucent ghost mesh. */
    setGhosted(indices) {
      indices = indices.slice(0, GHOST_MAX);
      if (indices.length === ghosted.length && indices.every((v, i) => v === ghosted[i])) return;
      for (const i of ghosted) floraMesh.setMatrixAt(i, removed.has(i) ? hidden : floraMatrices[i]);
      indices.forEach((idx, k) => {
        floraMesh.setMatrixAt(idx, hidden);
        ghostMesh.setMatrixAt(k, floraMatrices[idx]);
      });
      ghostMesh.count = indices.length;
      floraMesh.instanceMatrix.needsUpdate = true;
      ghostMesh.instanceMatrix.needsUpdate = true;
      ghosted = indices;
    },
    /** Remove trees within `radius` of a planet-local point (cleared for a building). */
    removeFloraNear(localPos, radius) {
      let count = 0;
      for (let k = planet.obstacles.length - 1; k >= 0; k--) {
        const o = planet.obstacles[k];
        if (o.flora === undefined || o.pos.distanceTo(localPos) > radius) continue;
        removed.add(o.flora);
        removedObstacles.push(o);
        floraMesh.setMatrixAt(o.flora, hidden);
        planet.obstacles.splice(k, 1);
        count++;
      }
      if (count) floraMesh.instanceMatrix.needsUpdate = true;
      scatter.removeNear(localPos, radius);
      return count;
    },
    /**
     * The ground changed (terraforming): lift / lower everything within
     * `radius` of `center` by how much the ground moved under it.
     */
    resnap(center, radius, oldGround) {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), dir = new THREE.Vector3();
      const shift = (pos) => {
        if (pos.distanceTo(center) > radius) return 0;
        dir.copy(pos).normalize();
        const delta = planet.walkHeight(dir) - oldGround(dir);
        if (delta) pos.addScaledVector(dir, delta);
        return delta;
      };
      floraMatrices.forEach((mat, i) => {
        mat.decompose(p, q, s);
        const delta = shift(p);
        if (!delta) return;
        mat.compose(p, q, s);
        if (floraObstacles[i]) floraObstacles[i].pos.addScaledVector(dir, delta);
        if (!removed.has(i) && !ghosted.includes(i)) floraMesh.setMatrixAt(i, mat);
      });
      floraMesh.instanceMatrix.needsUpdate = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < rockMesh.count; i++) {
        rockMesh.getMatrixAt(i, m);
        m.decompose(p, q, s);
        if (!shift(p)) continue;
        rockMesh.setMatrixAt(i, m.compose(p, q, s));
      }
      rockMesh.instanceMatrix.needsUpdate = true;
      for (const r of relics) shift(r.position);
      scatter.resnap(center, radius, (d) => planet.walkHeight(d) - oldGround(d));
    },
    /** Bring back every cleared tree (new game). */
    restoreFlora() {
      for (const o of removedObstacles) {
        floraMesh.setMatrixAt(o.flora, floraMatrices[o.flora]);
        planet.obstacles.push(o);
      }
      removed.clear();
      removedObstacles.length = 0;
      floraMesh.instanceMatrix.needsUpdate = true;
      scatter.restore();
    },
    /** Ground scatter is only drawn when the camera is near this planet. */
    setDetailVisible(on) { scatter.setVisible(on); },
    update(dt, time) {
      SWAY.uTime.value = time;
      for (const a of animated) {
        a.cube.position.y = 8.2 + Math.sin(time * 1.2 + a.phase) * 0.4;
        a.cube.rotation.y += dt * 0.8;
        a.cube.rotation.x += dt * 0.5;
      }
    },
  };
}
