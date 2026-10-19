/**
 * Threats (Phase 3).
 *
 *  Alien nests  – some planets (never the home world) host nests of hostile
 *                 Crawlers that roam nearby and attack anything of yours that
 *                 comes close. Nests slowly regrow their crawlers.
 *  Rogue AI raids – once you have a Command Core, a rival AI faction sends
 *                 periodic raids of drones (and later walkers) at one of your
 *                 colonies. Raids grow over time.
 *
 * The actors themselves live in UnitManager (units.js); this module only
 * decides when and where they appear. Balance numbers: CONFIG.aliens / CONFIG.raids.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, hashSeed } from './utils.js';
import { box, part, merge } from './geometry.js';
import { findLandSpot } from './decor.js';

const NEST_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
/** Bioluminescent parts of every nest (eggs, veins, the crater's glow); pulsed in update(). HDR so it blooms. */
const NEST_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6) });

/**
 * Alien nest: a lumpy organic mound with a crater, a crown of leaning
 * spikes, curling tendrils and a clutch of eggs; glowing veins run over it.
 * Returns { body, glow } geometries.
 */
function nestGeometry() {
  const rng = new RNG(4040);
  const body = [
    part(new THREE.DodecahedronGeometry(1.8, 1), 0x2a1838, { sy: 0.42, y: 0.25 }),
    part(new THREE.DodecahedronGeometry(1.1, 0), 0x341e46, { sy: 0.5, y: 0.55, x: 0.3, z: -0.2 }),
    part(new THREE.CylinderGeometry(0.62, 0.85, 0.35, 7), 0x14081c, { y: 0.82 }),                     // crater
  ];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rng.range(-0.15, 0.15), r = rng.range(1.0, 1.35);
    const lean = rng.range(0.3, 0.55), h = rng.range(1.3, 2.3);
    body.push(part(new THREE.ConeGeometry(0.28, h, 5), k % 2 ? 0x5a2f74 : 0x6b3a88,
      { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.55 + h * 0.4, rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean }));
  }
  // tendrils curling out over the ground
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.4;
    body.push(box(0.16, 0.12, 1.1, 0x3b2350, Math.cos(a) * 2.0, 0.0, Math.sin(a) * 2.0, { ry: Math.PI / 2 - a, rx: 0.1 }));
    body.push(box(0.12, 0.1, 0.6, 0x3b2350, Math.cos(a + 0.25) * 2.6, -0.04, Math.sin(a + 0.25) * 2.6, { ry: Math.PI / 2 - a - 0.6 }));
  }
  const glow = [
    part(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 7), 0xff5ab8, { y: 1.0 }),                        // crater glow
  ];
  // clutch of eggs around the mound
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.2, r = rng.range(1.5, 1.9);
    glow.push(part(new THREE.SphereGeometry(0.26, 6, 4), 0xa0287a, { sx: 0.85, sy: 1.25, sz: 0.85, x: Math.cos(a) * r, y: 0.32, z: Math.sin(a) * r }));
  }
  // veins running down the mound
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.6;
    glow.push(box(0.06, 0.05, 0.9, 0xff3aa0, Math.cos(a) * 1.15, 0.62, Math.sin(a) * 1.15, { ry: Math.PI / 2 - a, rx: -0.35 }));
  }
  return { body: merge(body), glow: merge(glow) };
}

export class EnemyDirector {
  constructor(game) {
    this.game = game;
    this.nests = [];
    this.raid = { timer: null, count: 0, active: false, warned: false, target: null, raiders: [] };
    this._nestGeo = nestGeometry();
  }

  // ------------------------------------------------------------- nests
  /** (Re)create nests on hostile planets and fill them with crawlers. */
  setupNests() {
    for (const n of this.nests) n.mesh.removeFromParent();
    this.nests = [];
    this.game.units.clear('enemy');
    const A = CONFIG.aliens;
    for (const planet of this.game.planets) {
      const rng = new RNG(hashSeed(planet.seed, 404));
      planet.hostile = planet.index !== 0 && rng.chance(A.hostileChance);
      if (!planet.hostile) continue;
      const count = rng.int(A.nestsPerPlanet[0], A.nestsPerPlanet[1]);
      for (let i = 0; i < count; i++) {
        let spot = null;
        for (let t = 0; t < 10 && !spot; t++) {
          const s = findLandSpot(planet, rng, { maxSlope: 0.7, radius: 3, tries: 20 });
          if (s && this._farFromColonies(planet, s.pos)) spot = s;
        }
        if (!spot) continue;
        const mesh = new THREE.Group();
        const body = new THREE.Mesh(this._nestGeo.body, NEST_MAT);
        body.castShadow = body.receiveShadow = true;
        mesh.add(body, new THREE.Mesh(this._nestGeo.glow, NEST_GLOW));
        mesh.position.copy(spot.pos);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spot.dir);
        mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.4));   // vary the look (no rng draw)
        planet.group.add(mesh);
        const nest = { planet, dir: spot.dir, pos: spot.pos, mesh, size: rng.int(A.perNest[0], A.perNest[1]), crawlers: [], regrow: A.respawnTime };
        for (let k = 0; k < nest.size; k++) this._spawnCrawler(nest);
        this.nests.push(nest);
      }
    }
  }

  _farFromColonies(planet, pos) {
    const brood = this.game.brood;
    if (brood && planet === brood.planet && brood.siteDir.clone().multiplyScalar(planet.radius).distanceTo(pos) < CONFIG.brood.colonyRadius + 25) return false;
    return planet.bases.every((b) => b.grid.origin.clone().multiplyScalar(planet.radius).distanceTo(pos) > CONFIG.aliens.minDistanceFromColony + CONFIG.base.buildRadius);
  }

  _spawnCrawler(nest) {
    const off = new THREE.Vector3().randomDirection().multiplyScalar(3 / nest.planet.radius);
    const dir = nest.dir.clone().add(off).normalize();
    const a = this.game.units.spawn('crawler', 'enemy', nest.planet, dir);
    a.home.copy(nest.dir);
    nest.crawlers.push(a);
  }

  // ------------------------------------------------------------- update
  update(dt) {
    // Nests breathe: their eggs and veins pulse slowly.
    NEST_GLOW.color.setScalar(1.1 + 0.6 * (0.5 + 0.5 * Math.sin(this.game.time * 1.8)));
    // Nests regrow one crawler at a time.
    for (const nest of this.nests) {
      nest.crawlers = nest.crawlers.filter((c) => c.alive);
      if (nest.crawlers.length >= nest.size) { nest.regrow = CONFIG.aliens.respawnTime; continue; }
      nest.regrow -= dt;
      if (nest.regrow <= 0) { nest.regrow = CONFIG.aliens.respawnTime; this._spawnCrawler(nest); }
    }
    this._updateRaids(dt);
  }

  // ------------------------------------------------------------- raids
  _colonies() {
    return this.game.planets.flatMap((p) => p.bases.filter((b) => b.core?.built));
  }

  _updateRaids(dt) {
    const R = CONFIG.raids, raid = this.raid, game = this.game;
    const colonies = this._colonies();

    if (raid.active) {
      raid.raiders = raid.raiders.filter((a) => a.alive);
      if (!raid.raiders.length) {
        raid.active = false;
        raid.timer = R.interval[0] + Math.random() * (R.interval[1] - R.interval[0]);
        game.hud.notify(colonies.length ? 'Raid repelled! The rogue AI will be back…' : 'The raiders withdrew.', colonies.length ? 'success' : 'info');
      } else if (!raid.target || !raid.target.buildings.length) {
        // Colony wiped out — remaining raiders move on to another one on the same planet.
        const next = raid.target?.planet.bases.find((b) => b.buildings.length);
        if (next) { raid.target = next; for (const a of raid.raiders) a.order({ kind: 'raid', base: next }); }
        else if (!colonies.length) {
          // Nothing left to attack: the raiders withdraw.
          for (const a of raid.raiders) { a.alive = false; a.mgr.onDeath(a, null); }
          raid.raiders = [];
        }
      }
      return;
    }

    if (!colonies.length) { raid.warned = false; return; }   // the clock only runs once you have a colony
    if (raid.timer === null) raid.timer = R.firstDelay;
    raid.timer -= dt;
    if (raid.timer <= R.warning && !raid.warned) {
      raid.warned = true;
      raid.target = this._pickTarget(colonies);
      game.audio.play('raidAlarm');
      game.hud.notify(`⚠ Rogue AI raid detected — heading for ${raid.target.planet.name}, colony ${raid.target.number}!`, 'warn');
    }
    if (raid.timer <= 0) this._launchRaid();
  }

  /** Prefer a colony on the planet the player is on (so they can defend it). */
  _pickTarget(colonies) {
    const here = this.game.focusPlanet;
    const local = colonies.filter((c) => c.planet === here);
    const pool = local.length ? local : colonies;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _launchRaid() {
    const R = CONFIG.raids, raid = this.raid;
    let target = raid.target;
    if (!target || !target.core?.built) target = this._pickTarget(this._colonies());
    if (!target) { raid.timer = 30; return; }
    const planet = target.planet;
    const size = Math.min(R.maxSize, R.baseSize + R.growth * raid.count);
    const walkers = raid.count + 1 >= R.walkersFrom ? Math.floor(size / 3) : 0;
    // Approach from a random direction, spawnDistance metres from the core.
    const origin = target.grid.origin;
    const side = new THREE.Vector3().randomDirection();
    side.addScaledVector(origin, -side.dot(origin)).normalize();
    const center = origin.clone().addScaledVector(side, R.spawnDistance / planet.radius).normalize();
    raid.raiders = [];
    for (let i = 0; i < size; i++) {
      const type = i < walkers ? 'rogueWalker' : 'rogueDrone';
      let dir = center.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(6 / planet.radius)).normalize();
      if (type === 'rogueWalker') {
        for (let k = 0; k < 20 && planet.isSubmerged(dir); k++) dir = center.clone().add(new THREE.Vector3().randomDirection().multiplyScalar((6 + k * 2) / planet.radius)).normalize();
      }
      const a = this.game.units.spawn(type, 'enemy', planet, dir);
      a.order({ kind: 'raid', base: target });
      raid.raiders.push(a);
    }
    raid.active = true;
    raid.warned = false;
    raid.count++;
    raid.target = target;
    this.game.audio.play('raidAlarm', { pitch: 1.12 });
    this.game.hud.notify(`⚠ RAID! ${size} rogue AI units attacking ${planet.name}, colony ${target.number}`, 'warn');
  }

  /** Text for the HUD alert banner (null when calm). */
  alertText() {
    const raid = this.raid;
    if (raid.active) return `⚠ RAID IN PROGRESS · ${raid.target?.planet.name ?? ''} · ${raid.raiders.filter((a) => a.alive).length} raiders left`;
    if (raid.warned && raid.timer > 0) return `⚠ ROGUE AI RAID IN ${Math.ceil(raid.timer)}s · ${raid.target?.planet.name}, colony ${raid.target?.number}`;
    return null;
  }

  serialize() {
    // An active raid isn't saved; after loading it comes back with a fresh warning.
    const timer = this.raid.active ? CONFIG.raids.warning + 10 : this.raid.timer;
    return { timer, count: this.raid.count };
  }

  deserialize(d) {
    this.raid = { timer: d?.timer ?? null, count: d?.count ?? 0, active: false, warned: false, target: null, raiders: [] };
  }

  reset() {
    this.deserialize(null);
    this.setupNests();
  }
}
