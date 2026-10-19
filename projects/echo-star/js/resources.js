/**
 * Harvestable resources on a planet.
 *
 *  ResourceField – static nodes (crystals, iron, rock, plants) drawn with
 *                  one InstancedMesh per type. Nodes shrink as they are
 *                  harvested, disappear when empty and regrow over time.
 *  AnimalHerd    – wildlife (species in animals.js) that wanders, grazes or
 *                  flees over the surface and can be captured for food.
 *
 * Node layout is deterministic from the planet seed, so a save file only
 * needs to store each node's remaining amount.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, hashSeed, clamp, projectOnPlane, anyPerpendicular, quatFromUpForward } from './utils.js';
import { box, part, merge, makeInstanced } from './geometry.js';
import { findLandSpot } from './decor.js';
import { pickSpecies, buildSpecies } from './animals.js';

export const NODE_TYPES = ['crystal', 'iron', 'rock', 'plant'];
const UP = new THREE.Vector3(0, 1, 0);

// ----------------------------------------------------------- node models
function crystalGeometry(color) {
  const parts = [];
  const shards = [
    { h: 1.9, r: 0.32, x: 0, z: 0, rx: 0, rz: 0 },
    { h: 1.3, r: 0.24, x: 0.45, z: 0.1, rx: 0.1, rz: -0.45 },
    { h: 1.1, r: 0.22, x: -0.4, z: 0.25, rx: 0.3, rz: 0.5 },
    { h: 0.9, r: 0.2, x: 0.05, z: -0.45, rx: -0.5, rz: 0.1 },
  ];
  for (const s of shards) {
    const prism = new THREE.CylinderGeometry(s.r, s.r * 1.1, s.h, 6);
    prism.translate(0, s.h / 2, 0);
    const tip = new THREE.ConeGeometry(s.r, s.r * 1.6, 6);
    tip.translate(0, s.h + s.r * 0.8, 0);
    for (const g of [prism, tip]) parts.push(part(g, color, { rx: s.rx, rz: s.rz, x: s.x, z: s.z }));
  }
  return merge(parts);
}

function ironGeometry() {
  return merge([
    part(new THREE.DodecahedronGeometry(1.0, 0), 0x5d5650, { y: 0.55, sy: 0.75 }),
    box(0.4, 0.4, 0.4, 0xc8d2da, 0.55, 0.85, 0.3, { ry: 0.6, rx: 0.4 }),
    box(0.35, 0.35, 0.35, 0xc0703a, -0.5, 0.95, 0.2, { rz: 0.5 }),
    box(0.3, 0.3, 0.3, 0xc8d2da, 0.0, 1.25, -0.35, { rx: 0.7 }),
    box(0.28, 0.28, 0.28, 0xc0703a, 0.3, 0.55, -0.7),
  ]);
}

function rockGeometry(color) {
  const c = new THREE.Color(color);
  return merge([
    part(new THREE.DodecahedronGeometry(0.9, 0), c, { y: 0.6, sy: 0.85 }),
    part(new THREE.DodecahedronGeometry(0.6, 0), c.clone().offsetHSL(0, 0, 0.08), { x: 0.8, y: 0.4, z: 0.3 }),
    box(0.9, 0.5, 0.7, c.clone().offsetHSL(0, 0, -0.05), -0.6, 0.25, -0.4, { ry: 0.4 }),
  ]);
}

function plantGeometry(leaf, berry) {
  const l = new THREE.Color(leaf);
  return merge([
    box(1.1, 0.8, 1.1, l, 0, 0.4, 0),
    box(0.8, 0.6, 0.8, l.clone().offsetHSL(0, 0, 0.08), 0.35, 0.95, 0.2),
    box(0.7, 0.5, 0.7, l.clone().offsetHSL(0, 0, -0.06), -0.35, 0.85, -0.25),
    box(0.22, 0.22, 0.22, berry, 0.55, 0.7, 0.45),
    box(0.22, 0.22, 0.22, berry, -0.5, 0.5, 0.5),
    box(0.22, 0.22, 0.22, berry, 0.1, 1.3, -0.4),
    box(0.22, 0.22, 0.22, berry, 0.6, 1.1, -0.3),
  ]);
}

// ========================================================= ResourceField
export class ResourceField {
  constructor(planet) {
    this.planet = planet;
    this.nodes = [];
    this.meshes = {};
    const rng = new RNG(hashSeed(planet.seed, 202));
    const R = CONFIG.resources;
    const b = planet.biome;

    // Planet-specific mix: biome weights × random variance.
    const mix = R.biomeMix[planet.biomeKey];
    const weights = NODE_TYPES.map((t) => mix[t] * rng.range(1 - R.mixVariance, 1 + R.mixVariance));
    const wSum = weights.reduce((a, w) => a + w, 0);
    const total = Math.round(R.nodesPerPlanet * (planet.radius / 80) ** 2);
    const counts = weights.map((w) => Math.max(3, Math.round((total * w) / wSum)));
    this.mix = Object.fromEntries(NODE_TYPES.map((t, i) => [t, counts[i]]));

    const geos = {
      crystal: crystalGeometry(0xffffff),
      iron: ironGeometry(),
      rock: rockGeometry(b.rock),
      plant: plantGeometry(b.plant, b.berry),
    };
    const mats = {
      crystal: new THREE.MeshStandardMaterial({
        vertexColors: true, color: planet.crystalColor, emissive: planet.crystalColor,
        emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.1, flatShading: true,
      }),
      iron: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.55, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
      plant: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    };

    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    NODE_TYPES.forEach((type, ti) => {
      const def = R.types[type];
      const mesh = makeInstanced(geos[type], mats[type], counts[ti]);
      let n = 0;
      for (let i = 0; i < counts[ti] * 3 && n < counts[ti]; i++) {
        const spot = findLandSpot(planet, rng, {
          maxSlope: type === 'plant' ? 0.5 : 0.8, radius: 1.8, tries: 1,
        });
        if (!spot) continue;
        const amount = rng.int(def.amount[0], def.amount[1]);
        const node = {
          id: this.nodes.length, type, index: n,
          dir: spot.dir, pos: spot.pos,
          quat: new THREE.Quaternion().setFromUnitVectors(UP, spot.dir)
            .multiply(new THREE.Quaternion().setFromAxisAngle(UP, rng.range(0, 6.28))),
          baseScale: rng.range(0.85, 1.25),
          amount, max: amount, regrow: 0,
        };
        this.nodes.push(node);
        planet.occupied.push({ pos: spot.pos, r: 1.4 });
        if (type !== 'plant') planet.obstacles.push({ pos: spot.pos, r: 0.8 * node.baseScale, node });
        mesh.setColorAt(n, c.setScalar(rng.range(0.85, 1.1)));
        n++;
      }
      mesh.count = n;
      this.meshes[type] = mesh;
      planet.group.add(mesh);
    });
    for (const node of this.nodes) this._writeMatrix(node, m);
    for (const t of NODE_TYPES) this.meshes[t].instanceMatrix.needsUpdate = true;
  }

  /** Visual size follows the remaining amount; empty nodes vanish. */
  _writeMatrix(node, m = new THREE.Matrix4()) {
    const s = node.amount > 0 ? node.baseScale * (0.45 + 0.55 * (node.amount / node.max)) : 0;
    m.compose(node.pos, node.quat, new THREE.Vector3(s, s, s));
    this.meshes[node.type].setMatrixAt(node.index, m);
    this.meshes[node.type].instanceMatrix.needsUpdate = true;
  }

  /** Nearest non-empty node within range of a planet-local position. */
  findNearest(localPos, range) {
    let best = null, bestD = range * range;
    for (const n of this.nodes) {
      if (n.amount <= 0) continue;
      const d = n.pos.distanceToSquared(localPos);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best ? { node: best, dist: Math.sqrt(bestD) } : null;
  }

  /**
   * Take up to `count` units from a node. Returns the amount actually taken.
   * Starts the regrow timer when the node empties.
   */
  harvest(node, count = 1) {
    const taken = Math.min(count, node.amount);
    node.amount -= taken;
    if (node.amount <= 0) node.regrow = CONFIG.resources.types[node.type].regrowTime;
    this._writeMatrix(node);
    return taken;
  }

  update(dt) {
    for (const n of this.nodes) {
      if (n.amount > 0 || n.regrow <= 0) continue;
      n.regrow -= dt;
      if (n.regrow <= 0) { n.amount = n.max; this._writeMatrix(n); }
    }
  }

  /** Terraforming moved the ground: keep nodes sitting on it (their obstacle shares node.pos). */
  resnap(center, radius, oldGround) {
    const dir = new THREE.Vector3();
    for (const n of this.nodes) {
      if (n.pos.distanceTo(center) > radius) continue;
      dir.copy(n.pos).normalize();
      const delta = this.planet.walkHeight(dir) - oldGround(dir);
      if (!delta) continue;
      n.pos.addScaledVector(dir, delta);
      this._writeMatrix(n);
    }
  }

  /** Obstacles from emptied nodes should not block movement. */
  isObstacleActive(o) {
    return !o.node || o.node.amount > 0;
  }

  serialize() {
    return this.nodes.map((n) => [n.amount, Math.round(n.regrow)]);
  }

  deserialize(data) {
    if (!Array.isArray(data)) return;
    data.forEach((d, i) => {
      const n = this.nodes[i];
      if (!n || !Array.isArray(d)) return;
      n.amount = clamp(d[0], 0, n.max);
      n.regrow = d[1] || 0;
      if (n.amount <= 0 && n.regrow <= 0) n.regrow = 1;
      this._writeMatrix(n);
    });
  }

  reset() {
    for (const n of this.nodes) { n.amount = n.max; n.regrow = 0; this._writeMatrix(n); }
  }
}

// ============================================================ AnimalHerd

export class AnimalHerd {
  constructor(planet) {
    this.planet = planet;
    this.animals = [];
    this.species = [];
    const A = CONFIG.animals;
    const rng = new RNG(hashSeed(planet.seed, 303));
    this.rng = rng;
    const total = Math.round(A.perPlanet * planet.biome.fauna * (planet.radius / 80) ** 2);
    // the home world always gets the most variety
    const n = planet.index === 0 ? A.speciesPerPlanet[1] : rng.int(A.speciesPerPlanet[0], A.speciesPerPlanet[1]);
    const types = pickSpecies(rng, planet.biomeKey, n);

    for (const type of types) {
      const sp = buildSpecies(type, rng, planet.biomeKey);
      const count = Math.max(2, Math.round(total / types.length));
      // one InstancedMesh per model part, each with per-instance animation data (iAnim, see rig.js)
      sp.meshes = sp.parts.map((pt, k) => {
        const geo = pt.geo.clone();
        const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
        anim.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iAnim', anim);
        const mesh = makeInstanced(geo, pt.mat, count, { castShadow: k === 0, receiveShadow: k === 0 });
        planet.group.add(mesh);
        return mesh;
      });
      this.species.push(sp);
      for (let i = 0; i < count; i++) {
        const spot = findLandSpot(planet, rng, { maxSlope: 0.6, radius: 0.5, tries: 20 });
        const dir = spot ? spot.dir : rng.unitVector();
        this.animals.push({
          species: sp, index: i,
          dir: dir.clone(), home: dir.clone(),
          heading: anyPerpendicular(dir, new THREE.Vector3()),
          state: 'idle', timer: rng.range(0, 3), hop: rng.range(0, 6), bob: rng.range(0, 6), seed: rng.range(0, 6.28),
          grazing: false, moving: false,
          alive: !!spot, respawn: spot ? 0 : 5,
          pos: new THREE.Vector3(), scale: rng.range(0.8, 1.15) * sp.size,
          captured: false,
        });
      }
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    for (const a of this.animals) this._place(a, this._lift(a, 0));
    this._flush();
  }

  /** Height above the ground: hops while moving, hovering for floaters. */
  _lift(a, speed) {
    const sp = a.species;
    if (sp.float) return sp.float + Math.sin(a.bob) * 0.25;
    return speed > 0 ? Math.abs(Math.sin(a.hop)) * sp.hopHeight : 0;
  }

  _place(a, lift) {
    const p = this.planet;
    p.surfacePoint(a.dir, a.pos, lift);
    this._s.setScalar(a.alive ? a.scale : 0);
    quatFromUpForward(a.dir, a.heading, this._q);
    this._m.compose(a.pos, this._q, this._s);
    // shader animation: walk phase, moving, seed, grazing (head down)
    const graze = a.grazing && !a.moving && !a.captured ? 1 : 0;
    for (const mesh of a.species.meshes) {
      mesh.setMatrixAt(a.index, this._m);
      mesh.geometry.attributes.iAnim.setXYZW(a.index, a.hop, a.moving ? 1 : 0, a.seed, graze);
    }
  }

  _flush() {
    for (const s of this.species) {
      for (const mesh of s.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.attributes.iAnim.needsUpdate = true;
      }
    }
  }

  /**
   * Wander / flee AI. `playerLocal` is the player's planet-local position
   * (or null when the player is not on this planet).
   */
  update(dt, playerLocal) {
    const A = CONFIG.animals;
    const p = this.planet;
    const rng = this.rng;
    const next = new THREE.Vector3();
    const away = new THREE.Vector3();

    for (const a of this.animals) {
      const sp = a.species;
      a.bob += dt * 1.6;
      if (!a.alive) {
        a.respawn -= dt;
        if (a.respawn <= 0) {
          const spot = findLandSpot(p, rng, { maxSlope: 0.6, radius: 0.5, tries: 5 });
          if (spot) { a.dir.copy(spot.dir); a.alive = true; a.captured = false; }
          else a.respawn = 3;
        }
        a.moving = false;
        this._place(a, 0);
        continue;
      }
      if (a.captured) { a.moving = false; this._place(a, this._lift(a, 0)); continue; }

      let speed = 0;
      const near = playerLocal && a.pos.distanceTo(playerLocal) < A.fleeDistance;
      if (near && sp.skittish) {
        // Run directly away from the player.
        away.copy(a.pos).sub(playerLocal);
        projectOnPlane(away, a.dir);
        if (away.lengthSq() > 1e-4) a.heading.lerp(away.normalize(), 1 - Math.exp(-8 * dt)).normalize();
        speed = A.fleeSpeed * sp.speedMul;
        a.state = 'flee';
        a.grazing = false;
      } else {
        a.timer -= dt;
        if (a.timer <= 0) {
          a.state = rng.chance(0.55) ? 'walk' : 'idle';
          a.grazing = a.state === 'idle' && rng.chance(0.65);
          a.timer = rng.range(1.5, 4.5);
          // Turn by a random angle; drift back toward home if far away.
          a.heading.applyAxisAngle(a.dir, rng.range(-1.6, 1.6));
          if (a.dir.angleTo(a.home) > 0.35) {
            away.copy(a.home).sub(a.dir);
            projectOnPlane(away, a.dir);
            if (away.lengthSq() > 1e-6) a.heading.lerp(away.normalize(), 0.7).normalize();
          }
        }
        if (a.state === 'walk') speed = A.walkSpeed * sp.speedMul;
      }

      if (speed > 0) {
        next.copy(a.dir).addScaledVector(a.heading, (speed * dt) / p.radius).normalize();
        // floaters drift over water and cliffs; walkers turn around
        if (!sp.float && (p.isSubmerged(next) || p.slopeAt(next) > 0.9)) {
          a.heading.negate();
        } else {
          a.dir.copy(next);
        }
        a.hop += dt * speed * sp.hopRate;
      }
      a.moving = speed > 0;
      projectOnPlane(a.heading, a.dir);
      if (a.heading.lengthSq() < 1e-6) anyPerpendicular(a.dir, a.heading);
      a.heading.normalize();
      this._place(a, this._lift(a, speed));
    }
    this._flush();
  }

  findNearest(localPos, range) {
    let best = null, bestD = range * range;
    for (const a of this.animals) {
      if (!a.alive) continue;
      // big animals can be reached from farther away; floaters from below
      const d = Math.max(0, a.pos.distanceTo(localPos) - (a.scale - 1) * 1.2 - a.species.float);
      if (d * d < bestD) { bestD = d * d; best = a; }
    }
    return best ? { animal: best, dist: Math.sqrt(bestD) } : null;
  }

  /** Freeze an animal while the player is capturing it. */
  setCapturing(animal, on) {
    animal.captured = on;
  }

  capture(animal) {
    animal.alive = false;
    animal.captured = false;
    animal.respawn = CONFIG.animals.respawnTime;
    this._place(animal, 0);
    this._flush();
  }
}
