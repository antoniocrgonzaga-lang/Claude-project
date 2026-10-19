/**
 * Procedural planets.
 *
 * Each planet is a "cube-sphere": six square grids bent into a sphere.
 * Heights come from 3D simplex noise, quantised into terraces for a
 * blocky low-poly look, and every triangle gets one flat colour based on
 * its height / steepness (biome palette).
 *
 * The height grid is kept in memory so walking, landing and placement can
 * query the exact terrain height in any direction with heightAt().
 */
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { CONFIG } from './config.js';
import { RNG, hashSeed, clamp, smoothstep, anyPerpendicular } from './utils.js';
import { buildDecor } from './decor.js';
import { buildClouds, buildRing } from './planetfx.js';
import { SUN_DIR } from './space.js';

// ------------------------------------------------------------------ biomes
// Visual identity of each planet type. Resource weights live in config.js.
export const BIOMES = {
  verdant: {
    label: 'Verdant', liquid: 'water', seaLevel: 0.38, shape: 1.15,
    colors: { seabed: 0x2f6f74, shore: 0xe6d49a, low: 0x6cc24a, mid: 0x48a03f, high: 0x7f8a70, peak: 0xf3f6f6, cliff: 0x7a6a58 },
    liquidColor: 0x2a8fe0, sky: 0x86c4ff, atmosphere: 0x5fb0ff,
    flora: 'oak', floraDensity: 1.0, leaf: 0x4fae3c, plant: 0x3f9e3a, berry: 0xff3b5c, fauna: 1.0, rock: 0x8c8a84,
    alt: { low: 0x93d256, mid: 0x3a8a3c }, sunset: 0xff9a5a,
    clouds: { color: 0xffffff, cover: 1 }, scatter: 'meadow', weather: 'meadow',
  },
  arid: {
    label: 'Arid', liquid: null, seaLevel: 0, shape: 1.0,
    colors: { seabed: 0xd49450, shore: 0xf0cf8a, low: 0xe7b467, mid: 0xd49450, high: 0xb4703f, peak: 0xf3dcae, cliff: 0xa25c34 },
    liquidColor: 0x000000, sky: 0xf0c08a, atmosphere: 0xffa860,
    flora: 'cactus', floraDensity: 0.35, leaf: 0x5e9c3a, plant: 0x8fa040, berry: 0xff9a2e, fauna: 0.6, rock: 0xb08360,
    alt: { low: 0xdba15e, mid: 0xc2703f }, sunset: 0xff6a3a,
    clouds: { color: 0xfff0dc, cover: 0.3 }, scatter: 'dry', weather: 'dust',
  },
  glacial: {
    label: 'Glacial', liquid: 'ice', seaLevel: 0.34, shape: 1.25,
    colors: { seabed: 0x9ac8de, shore: 0xd7ecf6, low: 0xeef8ff, mid: 0xd0e4f2, high: 0x9cb3c8, peak: 0xffffff, cliff: 0x7c93aa },
    liquidColor: 0xaee2f5, sky: 0xc4e2ff, atmosphere: 0xbde8ff,
    flora: 'pine', floraDensity: 0.6, leaf: 0x2f6b55, plant: 0x5aa596, berry: 0x6ad8ff, fauna: 0.8, rock: 0x9aa6b2,
    alt: { low: 0xd6ebf7, mid: 0xb5d3e8 }, sunset: 0xffb0d8,
    clouds: { color: 0xf2f8ff, cover: 1.4 }, scatter: 'ice', weather: 'snow',
  },
  volcanic: {
    label: 'Volcanic', liquid: 'lava', seaLevel: 0.32, shape: 1.35,
    colors: { seabed: 0x3a1a10, shore: 0x3d2c29, low: 0x332a29, mid: 0x4a3935, high: 0x5d4741, peak: 0x8b5d4a, cliff: 0x231b1b },
    liquidColor: 0xff5a1a, sky: 0x7a3226, atmosphere: 0xff5530,
    flora: 'deadtree', floraDensity: 0.25, leaf: 0x2b2522, plant: 0x8a7a3a, berry: 0xffb02e, fauna: 0.4, rock: 0x4a403c,
    alt: { low: 0x3e2f2b, mid: 0x5a2c1e }, sunset: 0xff3a1a,
    clouds: { color: 0x4a4242, emissive: 0x1c0600, cover: 0.9, opacity: 0.9 }, scatter: 'embers', weather: 'embers',
  },
  aether: {
    label: 'Aether', liquid: 'water', seaLevel: 0.36, shape: 1.1,
    colors: { seabed: 0x24425e, shore: 0xbfaee8, low: 0x8263cc, mid: 0x5e46a8, high: 0x3d8f9c, peak: 0xa6f2ea, cliff: 0x3e2f6c },
    liquidColor: 0x2fe0c8, sky: 0xa58cff, atmosphere: 0xb48cff,
    flora: 'mushroom', floraDensity: 0.8, leaf: 0xff6fd8, plant: 0x3fd0b0, berry: 0xfff06a, fauna: 1.0, rock: 0x6f6690,
    alt: { low: 0x9a7ae0, mid: 0x2f9e98 }, sunset: 0xff7ae0,
    clouds: { color: 0xf0dcff, cover: 0.9 }, scatter: 'spores', weather: 'spores',
  },
};

// How the walkable floor sits relative to the liquid surface.
// water: you wade (feet below surface) · ice: solid sheet · lava: hot crust.
const LIQUID_FLOOR = { water: -1.0, ice: 0.0, lava: -0.35 };

const CRYSTAL_COLORS = [0x4df3ff, 0xff4df0, 0x7dff6a, 0xffc94d, 0x8f7bff];

// Cube faces: normal n, and the u / v axes spanning the face (u × v = n).
const FACES = [
  { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0] },
  { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1] },
  { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

// ------------------------------------------------------------- name maker
const SYL_A = ['Ka', 'Ve', 'Zu', 'Or', 'Ny', 'Tha', 'El', 'Qua', 'Ri', 'Sol', 'Mi', 'Xe', 'Aru', 'Ty', 'Lo'];
const SYL_B = ['ra', 'lis', 'th', 'nox', 'vin', 'del', 'mar', 'ion', 'sar', 'qe', 'rin', 'tos', 'vael', 'ku'];
const SUFFIX = ['', '', '', ' Prime', ' II', ' IV', ' Minor', ' Echo'];
function makeName(rng, used) {
  for (let i = 0; i < 50; i++) {
    const n = rng.pick(SYL_A) + rng.pick(SYL_B) + (rng.chance(0.4) ? rng.pick(SYL_B) : '') + rng.pick(SUFFIX);
    if (!used.has(n)) { used.add(n); return n; }
  }
  return 'Planet ' + used.size;
}

// ================================================================= Planet
export class Planet {
  constructor({ index, seed, position, radius, biomeKey, name }) {
    this.index = index;
    this.seed = seed;
    this.name = name;
    this.biomeKey = biomeKey;
    this.biome = BIOMES[biomeKey];
    this.radius = radius;
    this.position = position.clone();

    const rng = new RNG(seed);
    this.rng = rng;
    this.noise = new SimplexNoise({ random: () => rng.random() });
    this.noiseOffset = new THREE.Vector3(rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50));
    this.amplitude = radius * CONFIG.planet.terrainAmplitude * rng.range(0.85, 1.2);
    this.contrast = rng.range(1.5, 1.9);
    this.hasLiquid = !!this.biome.liquid;
    this.seaHeight = this.hasLiquid ? this.biome.seaLevel * this.amplitude : -Infinity;
    this.liquidFloor = this.hasLiquid ? this.seaHeight + LIQUID_FLOOR[this.biome.liquid] : -Infinity;

    // Slightly shift palette hue so two planets of the same biome differ.
    const hue = rng.range(-0.04, 0.04), sat = rng.range(-0.08, 0.06);
    this.colors = {};
    for (const [k, v] of Object.entries(this.biome.colors)) {
      this.colors[k] = new THREE.Color(v).offsetHSL(hue, sat, 0);
    }
    // Detail colours: meadow / rock patches and darker rock strata on cliffs.
    this.colors.low2 = new THREE.Color(this.biome.alt.low).offsetHSL(hue, sat, 0);
    this.colors.mid2 = new THREE.Color(this.biome.alt.mid).offsetHSL(hue, sat, 0);
    this.colors.cliff2 = this.colors.cliff.clone().offsetHSL(0.01, 0.04, -0.07);
    this.colors.wetShore = this.colors.shore.clone().multiplyScalar(0.78);
    this.skyColor = new THREE.Color(this.biome.sky).offsetHSL(hue, 0, 0);
    this.crystalColor = new THREE.Color(biomeKey === 'aether' ? 0xff6af0 : rng.pick(CRYSTAL_COLORS));

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.name = 'planet-' + name;

    /** Things the player bumps into: { pos: Vector3 (local), r } */
    this.obstacles = [];
    /** Occupied spots used to keep features from overlapping. */
    this.occupied = [];
    /** Player colonies on this planet (Phase 2). Each Command Core founds one (max CONFIG.base.maxCoresPerPlanet). */
    this.bases = [];
    /** Bumped whenever buildings change, so the navigation grid refreshes its blocked cells. */
    this.navVersion = 0;

    // Grid resolution scales with radius so triangles stay ~cellSize wide.
    this.N = Math.max(24, Math.round((Math.PI / 2) * radius / CONFIG.planet.cellSize));
    this._buildHeights();
    this._buildTerrainMesh();
    if (this.hasLiquid) this._buildLiquid();
    this._buildAtmosphere();
    this.decor = buildDecor(this, new RNG(hashSeed(seed, 101)));
    this.clouds = buildClouds(this);
    this.ring = buildRing(this);
  }

  // --------------------------------------------------------- height field

  /** Raw terrain height (0..1, terraced) for a unit direction. */
  _sampleHeight01(d) {
    const o = this.noiseOffset;
    let f = CONFIG.planet.noiseFrequency, amp = 1, sum = 0, n = 0;
    for (let i = 0; i < CONFIG.planet.noiseOctaves; i++) {
      n += amp * this.noise.noise3d(d.x * f + o.x, d.y * f + o.y, d.z * f + o.z);
      sum += amp; amp *= 0.5; f *= 2.1;
    }
    n /= sum;
    let h = clamp(n * 0.5 * this.contrast + 0.5, 0, 1);
    h = Math.pow(h, this.biome.shape);
    const steps = CONFIG.planet.terraceSteps;
    return Math.round(h * steps) / steps;
  }

  _buildHeights() {
    const N = this.N, R = N + 1;
    this.heights = new Float32Array(6 * R * R);
    const d = new THREE.Vector3();
    const minH = this.hasLiquid ? this.seaHeight - CONFIG.planet.seabedDepth : -Infinity;
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          this._gridDir(f, i, j, d);
          const h = this._sampleHeight01(d) * this.amplitude;
          this.heights[f * R * R + j * R + i] = Math.max(h, minH);
        }
      }
    }
  }

  /** Unit direction of grid vertex (i, j) on face f (tangent-warped for even cells). */
  _gridDir(f, i, j, out) {
    const F = FACES[f];
    const a = Math.tan((-1 + (2 * i) / this.N) * Math.PI / 4);
    const b = Math.tan((-1 + (2 * j) / this.N) * Math.PI / 4);
    return out.set(
      F.n[0] + F.u[0] * a + F.v[0] * b,
      F.n[1] + F.u[1] * a + F.v[1] * b,
      F.n[2] + F.u[2] * a + F.v[2] * b,
    ).normalize();
  }

  /**
   * Terrain height above the base radius for any direction (planet-local).
   * Interpolates the same triangles the mesh uses, so feet match the ground.
   */
  heightAt(d, H = this.heights) {
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    let f;
    if (ax >= ay && ax >= az) f = d.x > 0 ? 0 : 1;
    else if (ay >= az) f = d.y > 0 ? 2 : 3;
    else f = d.z > 0 ? 4 : 5;
    const F = FACES[f];
    const m = 1 / Math.max(ax, ay, az);
    const cx = d.x * m, cy = d.y * m, cz = d.z * m;
    let a = cx * F.u[0] + cy * F.u[1] + cz * F.u[2];
    let b = cx * F.v[0] + cy * F.v[1] + cz * F.v[2];
    a = Math.atan(a) * 4 / Math.PI;
    b = Math.atan(b) * 4 / Math.PI;
    const N = this.N, R = N + 1;
    const gx = (a + 1) * 0.5 * N, gy = (b + 1) * 0.5 * N;
    const i = clamp(Math.floor(gx), 0, N - 1), j = clamp(Math.floor(gy), 0, N - 1);
    const fx = gx - i, fy = gy - j;
    const base = f * R * R + j * R + i;
    const h00 = H[base], h10 = H[base + 1], h01 = H[base + R], h11 = H[base + R + 1];
    // Same diagonal split as the mesh: (00,10,11) and (00,11,01).
    if (fx >= fy) return h00 + (h10 - h00) * fx + (h11 - h10) * fy;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fy;
  }

  /** Index (into heights / vertexDirs) of the grid vertex closest to a direction. Used by navigation. */
  nearestVertex(d) {
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    let f;
    if (ax >= ay && ax >= az) f = d.x > 0 ? 0 : 1;
    else if (ay >= az) f = d.y > 0 ? 2 : 3;
    else f = d.z > 0 ? 4 : 5;
    const F = FACES[f];
    const m = 1 / Math.max(ax, ay, az);
    const cx = d.x * m, cy = d.y * m, cz = d.z * m;
    const a = Math.atan(cx * F.u[0] + cy * F.u[1] + cz * F.u[2]) * 4 / Math.PI;
    const b = Math.atan(cx * F.v[0] + cy * F.v[1] + cz * F.v[2]) * 4 / Math.PI;
    const N = this.N, R = N + 1;
    const i = clamp(Math.round((a + 1) * 0.5 * N), 0, N), j = clamp(Math.round((b + 1) * 0.5 * N), 0, N);
    return f * R * R + j * R + i;
  }

  /** Height of the walkable floor (terrain, or liquid surface/crust). */
  walkHeight(d) {
    return Math.max(this.heightAt(d), this.liquidFloor);
  }

  /** True if this direction is covered by water or lava (ice counts as land). */
  isSubmerged(d) {
    return this.hasLiquid && this.biome.liquid !== 'ice' && this.heightAt(d) < this.seaHeight + 0.15;
  }

  /** Approximate slope (height change per unit distance) around a direction. */
  slopeAt(d) {
    const t1 = anyPerpendicular(d, new THREE.Vector3());
    const t2 = new THREE.Vector3().crossVectors(d, t1);
    const e = 1.5 / this.radius;
    const h0 = this.heightAt(d);
    const p = new THREE.Vector3();
    let maxDiff = 0;
    for (const t of [t1, t2]) {
      for (const s of [-1, 1]) {
        p.copy(d).addScaledVector(t, e * s).normalize();
        maxDiff = Math.max(maxDiff, Math.abs(this.heightAt(p) - h0));
      }
    }
    return maxDiff / 1.5;
  }

  /** Planet-local surface point for a direction (+ optional extra lift). */
  surfacePoint(d, out = new THREE.Vector3(), lift = 0) {
    return out.copy(d).multiplyScalar(this.radius + this.walkHeight(d) + lift);
  }

  /** Is there free space for a feature of radius r at local position p? */
  isFree(p, r) {
    for (const o of this.occupied) {
      const min = r + o.r;
      if (p.distanceToSquared(o.pos) < min * min) return false;
    }
    return true;
  }

  /** Total height of the ground along `d` measured from the planet centre. */
  groundRadius(d) {
    return this.radius + this.walkHeight(d);
  }

  /** Altitude of a world position above the ground. */
  altitudeOf(worldPos) {
    const local = worldPos.clone().sub(this.position);
    const dist = local.length();
    return dist - this.groundRadius(local.divideScalar(dist));
  }

  // --------------------------------------------------------------- meshes

  _buildTerrainMesh() {
    const N = this.N;
    const triCount = 6 * N * N * 2;
    // Unit direction of every height-grid vertex (reused when terraforming).
    this.vertexDirs = [];
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) this.vertexDirs.push(this._gridDir(f, i, j, new THREE.Vector3()));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = true;
    this.group.add(this.terrain);
    this._writeTerrainGeometry();
  }

  /** (Re)fill the terrain mesh from the height grid — called at start and after terraforming. */
  _writeTerrainGeometry() {
    const N = this.N, R = N + 1;
    const geo = this.terrain.geometry;
    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
    const dirs = this.vertexDirs;
    const vtx = (f, i, j) => {
      const k = f * R * R + j * R + i;
      return { d: dirs[k], h: this.heights[k] };
    };
    const colorRng = new RNG(hashSeed(this.seed, 7));
    const c = new THREE.Color();
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3(), mid = new THREE.Vector3();
    let w = 0;

    const pushTri = (a, b, d) => {
      p0.copy(a.d).multiplyScalar(this.radius + a.h);
      p1.copy(b.d).multiplyScalar(this.radius + b.h);
      p2.copy(d.d).multiplyScalar(this.radius + d.h);
      // Pick a colour for the whole triangle.
      const avgH = (a.h + b.h + d.h) / 3;
      e1.subVectors(p1, p0); e2.subVectors(p2, p0);
      nrm.crossVectors(e1, e2).normalize();
      mid.copy(p0).add(p1).add(p2).normalize();
      const flatness = nrm.dot(mid);
      this._terrainColor(avgH, flatness, c, mid);
      const jitter = colorRng.range(0.92, 1.07);
      c.multiplyScalar(jitter);
      for (const p of [p0, p1, p2]) {
        pos[w] = p.x; pos[w + 1] = p.y; pos[w + 2] = p.z;
        col[w] = c.r; col[w + 1] = c.g; col[w + 2] = c.b;
        w += 3;
      }
    };

    for (let f = 0; f < 6; f++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = vtx(f, i, j), b = vtx(f, i + 1, j), cc = vtx(f, i + 1, j + 1), d = vtx(f, i, j + 1);
          pushTri(a, b, cc);
          pushTri(a, cc, d);
        }
      }
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals(); // non-indexed → flat per-face normals
    geo.computeBoundingSphere();
  }

  // ----------------------------------------------------------- terraforming

  /**
   * Level the ground for a building: every height-grid vertex inside the
   * footprint (plus one cell of padding) is set to `level`, and a ring of
   * `CONFIG.base.levelBlend` metres around it ramps smoothly back to the
   * original terrain. Vertices under other buildings (`protect`) are left alone.
   *
   * @param grid    colony grid the footprint is expressed in
   * @param cx, cy  footprint centre in plane coordinates (metres)
   * @param hw, hh  footprint half-width / half-height (metres)
   * @param protect [{ dir: Vector3 (unit, local), r }] areas that must not change
   */
  levelArea(grid, cx, cy, hw, hh, level, protect = []) {
    const pad = CONFIG.base.cellSize, blend = CONFIG.base.levelBlend;
    const old = this.heights.slice();
    const minH = this.hasLiquid ? this.seaHeight - CONFIG.planet.seabedDepth : -Infinity;
    const center = grid.toDir(cx, cy);
    const reach = Math.hypot(hw, hh) + pad + blend + 1;
    const cosReach = Math.cos(reach / this.radius);
    let changed = false;
    this.vertexDirs.forEach((d, k) => {
      if (d.dot(center) < cosReach) return;
      const p = grid.toPlane(d);
      if (!p) return;
      const dx = Math.max(Math.abs(p.x - cx) - hw - pad, 0);
      const dy = Math.max(Math.abs(p.y - cy) - hh - pad, 0);
      const dist = Math.hypot(dx, dy);
      if (dist >= blend) return;
      for (const pr of protect) if (d.angleTo(pr.dir) * this.radius < pr.r) return;
      const t = 1 - smoothstep(0, blend, dist);           // 1 on the pad → 0 at the edge of the ramp
      this.heights[k] = Math.max(minH, this.heights[k] + (level - this.heights[k]) * t);
      changed = true;
    });
    if (!changed) return;
    this._terrainChanged(old, center.clone().multiplyScalar(this.radius), reach);
  }

  /** Undo all terraforming (new game). */
  resetTerrain() {
    const old = this.heights.slice();
    this._buildHeights();
    this._terrainChanged(old, new THREE.Vector3(), Infinity);
  }

  _terrainChanged(oldHeights, centerLocal, radius) {
    this.terrainDirty = true;   // mesh is rebuilt once at the next update()
    // Move things standing on the changed ground so nothing floats or sinks.
    const oldGround = (dir) => Math.max(this.heightAt(dir, oldHeights), this.liquidFloor);
    this.decor?.resnap(centerLocal, radius, oldGround);
    this.resources?.resnap(centerLocal, radius, oldGround);
    if (this.liquid) this._fillLiquidDepth(centerLocal, radius);   // shore foam follows the new ground
  }

  /**
   * Biome palette lookup by height band and steepness, with detail:
   * layered rock strata on cliffs, wet sand at the waterline and large
   * noise patches (meadows, rock fields) mixing in a second colour.
   * `dir` is the triangle's unit direction (planet-local).
   */
  _terrainColor(h, flatness, out, dir) {
    const C = this.colors;
    const t = h / this.amplitude;
    if (this.hasLiquid && h < this.seaHeight - 0.2) return out.copy(C.seabed);
    if (flatness < 0.72) {
      // two alternating rock layers per terrace step
      const layer = Math.floor((h / this.amplitude) * CONFIG.planet.terraceSteps * 2);
      return out.copy(layer % 2 ? C.cliff : C.cliff2);
    }
    if (this.hasLiquid ? h < this.seaHeight + 0.7 : t < 0.22) {
      return out.copy(this.hasLiquid && h < this.seaHeight + 0.3 ? C.wetShore : C.shore);
    }
    const patch = dir ? this.noise.noise3d(dir.x * 5.5 + 31.7, dir.y * 5.5 - 17.3, dir.z * 5.5 + 7.1) : 0;
    if (t < 0.55) out.copy(C.low).lerp(C.low2, smoothstep(0.12, 0.32, patch));
    else if (t < 0.7) out.copy(C.mid).lerp(C.mid2, smoothstep(0.08, 0.3, patch));
    else if (t < 0.84) out.copy(C.high);
    else return out.copy(C.peak);
    // gentle slopes catch a little less light than flat ground
    return out.multiplyScalar(0.9 + 0.1 * smoothstep(0.72, 0.97, flatness));
  }

  /**
   * Water, lava or ice sheet. Every vertex knows how deep the liquid is
   * above the terrain (aDepth), which drives the shader:
   *  water – rolling waves, turquoise shallows → dark depths, animated shore foam
   *  lava  – slow swell, dark cooled crust plates drifting over glowing magma
   *  ice   – faceted sheet with per-face tints and cracks
   */
  _buildLiquid() {
    const kind = this.biome.liquid;
    const detail = Math.round(clamp(this.radius / 3.4, 18, 32));
    const geo = new THREE.IcosahedronGeometry(this.radius + this.seaHeight, detail);
    geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
    this.liquidUniforms = { uTime: { value: 0 }, uWave: { value: CONFIG.fx.waveHeight } };
    let mat;
    if (kind === 'ice') {
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.1, flatShading: true, emissive: 0x06202c });
    } else if (kind === 'water') {
      const base = new THREE.Color(this.biome.liquidColor);
      Object.assign(this.liquidUniforms, {
        uShallow: { value: base.clone().lerp(new THREE.Color(0x9ff7ff), 0.4) },
        uDeep: { value: base.clone().multiplyScalar(0.42) },
      });
      mat = new THREE.MeshStandardMaterial({ color: this.biome.liquidColor, roughness: 0.1, metalness: 0.15, transparent: true, opacity: 0.85, flatShading: true });
      this._patchLiquid(mat, 'water', /* glsl */`
        float deep = smoothstep(0.0, 2.2, vDepth);
        diffuseColor.rgb = mix(uShallow, uDeep, deep);
        diffuseColor.a = mix(0.5, 0.9, deep);
        float ripple = 0.5 + 0.5 * sin(dot(vLocal, vec3(0.9, 0.7, 0.8)) + uTime * 2.0);
        float foam = 1.0 - smoothstep(0.0, 0.14 + ripple * 0.14, vDepth);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 1.0), foam * 0.85);
        diffuseColor.a = max(diffuseColor.a, foam * 0.9);`, 'color');
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0x2a0800, emissive: this.biome.liquidColor, emissiveIntensity: 1.7, roughness: 0.85, flatShading: true });
      this.liquidUniforms.uWave.value *= 0.4;
      this._patchLiquid(mat, 'lava', /* glsl */`
        // dark cooled crust broken by glowing veins and open pools of magma, all slowly drifting
        float flow = sin(dot(vLocal, vec3(0.7, 0.42, 0.56)) + uTime * 0.35) * sin(dot(vLocal, vec3(-0.34, 0.66, 0.38)) * 1.3 - uTime * 0.27)
                   + 0.35 * sin(dot(vLocal, vec3(1.9, -1.3, 1.1)) + uTime * 0.6);
        float veins = 1.0 - smoothstep(0.03, 0.16, abs(flow));
        float pools = smoothstep(0.55, 0.8, -flow) + (1.0 - smoothstep(-0.3, 0.25, vDepth));   // + hot rim at the shore
        float hot = clamp(max(veins, pools), 0.0, 1.0);
        totalEmissiveRadiance *= mix(0.035, 1.15, hot) * (0.9 + 0.15 * sin(uTime * 1.3 + vLocal.x * 0.05));
        diffuseColor.rgb = mix(vec3(0.045, 0.035, 0.035), diffuseColor.rgb, hot);`, 'emissive');
    }
    this.liquid = new THREE.Mesh(geo, mat);
    this.liquid.receiveShadow = kind !== 'lava';
    this.group.add(this.liquid);
    this._fillLiquidDepth();
    if (kind === 'ice') this._paintIce();
  }

  /**
   * Inject waves (vertex) and a colour / emissive pass (fragment) into a
   * standard material, keeping its lighting, shadows and fog.
   */
  _patchLiquid(mat, key, fragment, where) {
    const u = this.liquidUniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      const decl = 'uniform float uTime;\nuniform float uWave;\nvarying float vDepth;\nvarying vec3 vLocal;\n';
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth;\n' + decl)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          vDepth = aDepth;
          vLocal = position;
          float wave = sin(dot(position, vec3(0.31, 0.17, 0.23)) + uTime * 1.3)
                     + 0.6 * sin(dot(position, vec3(-0.19, 0.29, 0.13)) * 1.7 + uTime * 0.9);
          transformed += normalize(position) * wave * uWave * clamp(aDepth * 0.8 + 0.2, 0.15, 1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + decl + (key === 'water' ? 'uniform vec3 uShallow;\nuniform vec3 uDeep;\n' : ''))
        .replace(where === 'color' ? '#include <color_fragment>' : '#include <emissivemap_fragment>',
          (where === 'color' ? '#include <color_fragment>' : '#include <emissivemap_fragment>') + '\n' + fragment);
    };
    mat.customProgramCacheKey = () => 'echo-liquid-' + key;
  }

  /** How deep the liquid is above the terrain at every liquid vertex (recomputed after terraforming). */
  _fillLiquidDepth(centerLocal = null, radius = Infinity) {
    const geo = this.liquid.geometry, pos = geo.attributes.position, arr = geo.attributes.aDepth.array;
    const d = new THREE.Vector3();
    const c = centerLocal && Number.isFinite(radius) ? centerLocal.clone().normalize() : null;
    const cosR = c ? Math.cos(Math.min(Math.PI, (radius + 3) / this.radius)) : -2;
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      if (c && d.dot(c) < cosR) continue;
      arr[i] = this.seaHeight - this.heightAt(d);
    }
    geo.attributes.aDepth.needsUpdate = true;
  }

  /** Ice: one tint per face — clearer over deep water, a few dark cracks and white snow drifts. */
  _paintIce() {
    const geo = this.liquid.geometry, depth = geo.attributes.aDepth.array, n = geo.attributes.position.count;
    const col = new Float32Array(n * 3), rng = new RNG(hashSeed(this.seed, 808));
    const base = new THREE.Color(this.biome.liquidColor), deep = base.clone().offsetHSL(0.02, 0.1, -0.12);
    const crack = base.clone().offsetHSL(0.03, 0.15, -0.3), snow = new THREE.Color(0xf4fbff), c = new THREE.Color();
    for (let i = 0; i < n; i += 3) {
      const r = rng.random();
      if (r < 0.03) c.copy(crack);
      else if (r < 0.08) c.copy(snow);
      else c.copy(base).lerp(deep, clamp((depth[i] + depth[i + 1] + depth[i + 2]) / 3 / 2, 0, 1)).multiplyScalar(rng.range(0.93, 1.06));
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  /**
   * Atmosphere seen from space: a halo behind the planet plus a thin
   * front-facing rim. Both are lit by the sun, with a sunset tint along
   * the line between day and night.
   */
  _buildAtmosphere() {
    const R = this.radius;
    const uniforms = {
      uColor: { value: new THREE.Color(this.biome.atmosphere) },
      uSunset: { value: new THREE.Color(this.biome.sunset ?? 0xff8855) },
      uSunDir: { value: SUN_DIR },
      uOpacity: { value: 1 },
    };
    const vertexShader = /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorldNormal;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`;
    const light = /* glsl */`
      uniform vec3 uColor;
      uniform vec3 uSunset;
      uniform vec3 uSunDir;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorldNormal;
      vec3 skyLight() {
        float sun = dot(normalize(vWorldNormal), uSunDir);
        float lit = smoothstep(-0.35, 0.45, sun);
        float dusk = smoothstep(-0.4, -0.05, sun) * (1.0 - smoothstep(-0.05, 0.4, sun));
        return mix(uColor, uSunset, dusk * 0.85) * (0.12 + 1.1 * lit);
      }`;
    const common = { uniforms, vertexShader, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false };
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * CONFIG.planet.atmosphereScale, 48, 32), new THREE.ShaderMaterial({
      ...common, side: THREE.BackSide,
      fragmentShader: light + /* glsl */`
        void main() {
          // back faces: 0 at the outer rim → 1 toward the centre
          float f = clamp(-dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
          gl_FragColor = vec4(skyLight() * pow(f, 2.2) * 1.4 * uOpacity, 1.0);
        }`,
    }));
    // rim just above the highest peaks: a soft glowing edge over the planet's disc
    this.atmosphereRim = new THREE.Mesh(new THREE.SphereGeometry(R + this.amplitude * 1.05 + 1, 48, 32), new THREE.ShaderMaterial({
      ...common, side: THREE.FrontSide,
      fragmentShader: light + /* glsl */`
        void main() {
          float f = 1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
          gl_FragColor = vec4(skyLight() * (pow(f, 3.0) * 1.1 + 0.05) * uOpacity, 1.0);
        }`,
    }));
    this.group.add(this.atmosphere, this.atmosphereRim);
  }

  /** Per-frame animation (lava glow, relic hover) and halo fading. */
  update(dt, time, cameraPos) {
    if (this.terrainDirty) { this._writeTerrainGeometry(); this.terrainDirty = false; }
    if (this.liquidUniforms) this.liquidUniforms.uTime.value = time;
    // Fade the halo out as the camera enters the atmosphere.
    const dist = cameraPos.distanceTo(this.position);
    const r = this.radius * CONFIG.planet.atmosphereScale;
    const k = clamp((dist - r) / (r * 0.6), 0, 1);
    this.atmosphere.material.uniforms.uOpacity.value = k;   // shared with the rim
    this.atmosphere.visible = this.atmosphereRim.visible = k > 0.001;
    if (this.decor) {
      this.decor.setDetailVisible(dist < this.radius * CONFIG.fx.scatterViewRange);
      this.decor.update(dt, time);
    }
    this.clouds?.update(dt);
    this.ring?.update(dt);
  }
}

// ============================================================ star system

/** Generate every planet of the system from one seed. */
export function generateSolarSystem(seed) {
  const U = CONFIG.universe, P = CONFIG.planet;
  const rng = new RNG(hashSeed(seed, 1));
  const others = rng.shuffle(['arid', 'glacial', 'volcanic', 'aether']);
  const biomeOrder = ['verdant', ...others];
  const used = new Set();
  const planets = [];

  for (let i = 0; i < U.planetCount; i++) {
    const biomeKey = i < biomeOrder.length ? biomeOrder[i] : rng.pick(Object.keys(BIOMES));
    const radius = i === 0 ? 80 : rng.range(P.minRadius, P.maxRadius);
    let position = null;
    for (let attempt = 0; attempt < 300 && !position; attempt++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = i === 0 ? U.minOrbit : rng.range(U.minOrbit, U.maxOrbit);
      const cand = new THREE.Vector3(Math.cos(ang) * dist, rng.range(-U.verticalSpread, U.verticalSpread), Math.sin(ang) * dist);
      const ok = planets.every((p) => cand.distanceTo(p.position) - p.radius - radius > U.minSeparation);
      if (ok) position = cand;
    }
    if (!position) position = new THREE.Vector3(i * 1500, 0, 0);
    planets.push(new Planet({
      index: i,
      seed: hashSeed(seed, 1000 + i),
      position,
      radius,
      biomeKey,
      name: makeName(rng, used),
    }));
  }
  return planets;
}
