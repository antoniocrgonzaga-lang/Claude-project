/**
 * The Brood — a bio-alien faction with its own living colony.
 *
 * From the start of the game a sealed Chrysalis (the dormant Hive) rests on the
 * planet farthest from the home world, watched by a few guards. It cannot be
 * harmed while sealed and does nothing else. Once the Tech Moon is online
 * (CONFIG.brood.awakenOn) it hatches, and the colony starts to live:
 *
 *   · biomass — its own resource, from the Hive and Biomass Feeders — pays for
 *     growing new structures (CONFIG.brood.buildPlan) and hatching organisms;
 *   · purple creep spreads around every structure;
 *   · Seekers fly to other worlds to look for your colonies. A Seeker that finds
 *     one must hover over it for a while to relay its position — kill it first
 *     and the Brood still doesn't know where you are;
 *   · Brood Carriers (living transport ships) fly organisms through space to
 *     colonies the Brood has discovered and unload them nearby;
 *   · Resonance Veil Spires (and the Hive's own small field) jam the Tech Moon's
 *     targeting: the moon can't lock on to anything inside a field. Ground units,
 *     fighters, turrets and the astronaut are not affected — destroy the spires.
 *
 * Destroying the Hive kills the colony: its structures wither and the creep recedes.
 * Every Brood creature is an Actor (units.js) of the 'enemy' faction; this director
 * runs the special ones (structures, Carriers, Seekers) through think().
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, hashSeed, anyPerpendicular, makeGlowTexture, projectOnPlane } from './utils.js';
import { Grid } from './buildings.js';
import { getNav } from './navigation.js';
import { findLandSpot } from './decor.js';
import { unitModelParts, targetLocal } from './units.js';
import { SHOT_SOUND } from './audio.js';
import { RESOURCE_LABELS } from './inventory.js';

const MAX_CREEP = 20;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ================================================================ creep
// One terrain-hugging patch around the Hive. The shader draws the union of
// soft, noise-edged discs (one per structure) with pulsing magenta veins.
const CREEP_HEAD = /* glsl */`
  uniform float uCreepTime;
  uniform vec4 uCenters[${MAX_CREEP}];
  uniform int uCount;
  varying vec2 vPlane;
  float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float cFbm(vec2 p) { return cNoise(p) * 0.55 + cNoise(p * 2.1 + 3.7) * 0.3 + cNoise(p * 4.3 + 9.1) * 0.15; }
`;

class CreepLayer {
  constructor(planet, grid, extent) {
    this.planet = planet;
    const step = 1.25, n = Math.ceil((extent * 2) / step);
    const pos = [], plane = [], idx = [];
    const d = new THREE.Vector3();
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -extent + i * step, y = -extent + j * step;
        grid.toDir(x, y, d);
        const p = d.multiplyScalar(planet.radius + planet.walkHeight(d) + 0.15);
        pos.push(p.x, p.y, p.z);
        plane.push(x, y);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aPlane', new THREE.Float32BufferAttribute(plane, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // make sure the normals face away from the planet centre
    const nrm = geo.attributes.normal;
    if (nrm.getX(0) * pos[0] + nrm.getY(0) * pos[1] + nrm.getZ(0) * pos[2] < 0) { idx.reverse(); geo.setIndex(idx); geo.computeVertexNormals(); }

    this.uniforms = {
      uCreepTime: { value: 0 },
      uCenters: { value: Array.from({ length: MAX_CREEP }, () => new THREE.Vector4()) },
      uCount: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.5, metalness: 0.05, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aPlane;\nvarying vec2 vPlane;')
        // nudged toward the camera so terrace edges never poke through the creep
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlane = aPlane;\ntransformed += normalize(cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz) * 0.45;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + CREEP_HEAD)
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
          float cover = -1000.0;
          for (int i = 0; i < ${MAX_CREEP}; i++) {
            if (i >= uCount) break;
            vec4 c = uCenters[i];
            if (c.z > 0.01) cover = max(cover, c.z - length(vPlane - c.xy));
          }
          float n1 = cFbm(vPlane * 0.32);
          cover += (n1 - 0.5) * 6.0;
          float cAlpha = smoothstep(0.0, 1.8, cover);
          if (cAlpha < 0.01) discard;
          float tone = cFbm(vPlane * 0.7 + 11.0);
          float wet = cFbm(vPlane * 2.3 + 2.0);
          diffuseColor.rgb = mix(vec3(0.09, 0.035, 0.11), vec3(0.24, 0.08, 0.2), tone) * (0.8 + 0.4 * wet);
          diffuseColor.a = cAlpha * 0.94;
          float v = abs(cFbm(vPlane * 0.85 + 5.3) - 0.5);
          float vein = 1.0 - smoothstep(0.0, 0.045, v);
          float pulse = 0.5 + 0.5 * sin(uCreepTime * 2.2 - length(vPlane) * 0.4);
          float edge = smoothstep(0.0, 1.8, cover) * (1.0 - smoothstep(1.8, 5.0, cover));
          totalEmissiveRadiance += vec3(1.0, 0.16, 0.6) * (vein * (0.1 + 0.45 * pulse) + edge * 0.12) * cAlpha;`);
    };
    mat.customProgramCacheKey = () => 'echo-creep';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    planet.group.add(this.mesh);
  }

  /** centers: [{ x, y, r }] in grid-plane metres. */
  update(time, centers) {
    this.uniforms.uCreepTime.value = time;
    const list = this.uniforms.uCenters.value;
    let n = 0;
    for (const c of centers) {
      if (n >= MAX_CREEP) break;
      if (c.r > 0.05) list[n++].set(c.x, c.y, c.r, 0);
    }
    this.uniforms.uCount.value = n;
    this.mesh.visible = n > 0;
  }
}

// ========================================================== veil dome
const DOME_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vView; varying vec3 vPos;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vN = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }`;
const DOME_FRAG = /* glsl */`
  uniform float uTime; uniform float uStrength; uniform float uRadius; uniform vec3 uColor;
  varying vec3 vN; varying vec3 vView; varying vec3 vPos;
  void main() {
    vec3 p = vPos * uRadius;
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.4);
    float ang = atan(p.z, p.x);
    float bands = 0.5 + 0.5 * sin(p.y * 1.4 - uTime * 2.0 + sin(ang * 7.0 + uTime * 0.9) * 0.9);
    float shimmer = 0.5 + 0.5 * sin(dot(p.xz, vec2(0.9, 1.3)) + uTime * 3.1) * sin(p.y * 2.1 - uTime * 1.6);
    float ring = 1.0 - smoothstep(0.0, 1.2, p.y);
    float a = (fres * 0.15 + bands * bands * fres * 0.1 + shimmer * 0.014 + ring * 0.18) * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

function makeDome(radius, color) {
  const geo = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uRadius: { value: radius }, uColor: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(radius);
  mesh.renderOrder = 3;
  return mesh;
}

// ======================================================= BroodDirector
export class BroodDirector {
  constructor(game) {
    this.game = game;
    const home = game.planets[0];
    // The colony lives on the planet farthest from the home world.
    this.planet = game.planets.reduce((best, p) => (p.position.distanceTo(home.position) > best.position.distanceTo(home.position) ? p : best), home);
    // Hive site: its own seed, read-only use of the planet (never changes resources or saves).
    const rng = new RNG(hashSeed(this.planet.seed, 909));
    const spot = findLandSpot(this.planet, rng, { maxSlope: 0.3, radius: 10, tries: 300 })
      ?? findLandSpot(this.planet, rng, { maxSlope: 0.6, radius: 4, tries: 300 });
    this.siteDir = spot ? spot.dir : new THREE.Vector3(0, 1, 0);
    this.grid = new Grid(this.planet, this.siteDir, anyPerpendicular(this.siteDir, new THREE.Vector3()));
    this.creep = new CreepLayer(this.planet, this.grid, CONFIG.brood.colonyRadius + 14);
    this.glowTex = makeGlowTexture(64, 'rgba(255,150,215,1)', 'rgba(255,40,160,0)');
    this.voyages = [];
    this.structures = [];
    this.garrison = [];
    this.invaders = [];
    this._clearState();
  }

  _clearState() {
    this.state = 'dormant';      // dormant | stirring | awake | dead
    this.stirT = 0;
    this.biomass = 0;
    this.waves = 0;              // invasions sent
    this.known = new Set();      // planet indices where the Brood knows you have colonies
    this.scouted = {};           // planet index → game time a Seeker found nothing there
    this.seekerT = null;
    this.invasionT = null;
    this.thinkT = 0;
    this.hive = null;
    this.seeker = null;
    this.relay = null;           // { base, planet, left } while a Seeker relays a colony's position
    this.fading = [];            // creep of dead structures, receding
    this.sealedMsgAt = -99;
    this.time = 0;
  }

  get units() { return this.game.units; }
  get alive() { return this.state !== 'dead'; }

  /** Is something hostile from the Brood coming or attacking right now? (raid music) */
  get threatActive() {
    return this.voyages.some((v) => v.type === 'broodCarrier' && v.inbound)
      || this.units.actors.some((a) => a.alive && a.type === 'broodCarrier' && a.task?.phase !== 'home')
      || this.invaders.some((a) => a.alive) || !!this.relay;
  }

  // ------------------------------------------------------------ lifecycle
  /** New game: everything back to a sealed chrysalis. */
  reset() {
    this._wipe();
    this._clearState();
    this._spawnDormant();
  }

  _wipe() {
    for (const a of [...this.structures, ...this.garrison, ...this.invaders]) this._despawn(a, true);
    if (this.seeker) this._despawn(this.seeker);
    for (const a of this.units.actors) if (a.brood && (a.type === 'broodCarrier' || a.type === 'seeker')) this._despawn(a);
    for (const v of this.voyages) v.mesh.removeFromParent();
    this.voyages = [];
    this.structures = [];
    this.garrison = [];
    this.invaders = [];
  }

  _spawnDormant() {
    const ch = this._addStructure('broodChrysalis', this.siteDir, { built: true });
    ch.invulnerable = true;
    this.hive = ch;
    for (const [type, n] of Object.entries(CONFIG.brood.dormantGuards)) for (let i = 0; i < n; i++) this._spawnGarrison(type);
  }

  /** Remove an actor without an explosion (recalled, hatched, or wiped). */
  _despawn(a, structure = false) {
    if (!a) return;
    a.alive = false;
    a.recalled = true;
    a.bar?.group.removeFromParent();
    this.units.selected = this.units.selected.filter((x) => x !== a);
    if (structure || a.structure) this._removeStructure(a);
  }

  // ---------------------------------------------------------- structures
  _addStructure(type, dir, { built = false, hp = null, growth = null } = {}) {
    const def = CONFIG.brood.structures[type];
    const planet = this.planet;
    const a = this.units.spawn(type, 'enemy', planet, dir);
    a.state = 'structure';
    a.home.copy(a.dir);
    // vary the orientation (no rng: saves only keep the direction)
    a.heading.copy(this.grid.north).applyAxisAngle(a.dir, (a.dir.x * 97 + a.dir.z * 61) % (Math.PI * 2));
    projectOnPlane(a.heading, a.dir).normalize();
    a.growth = growth ?? (built ? 1 : 0);
    a.built = a.growth >= 1;
    a.grow = a.built ? 1 : 0.25 + 0.75 * a.growth;
    a.hp = hp ?? (a.built ? def.hp : def.hp * 0.25);
    a.plane = this.grid.toPlane(a.dir) ?? { x: 0, y: 0 };
    a.creepR = a.built ? this._creepTarget(a) : 0;
    a.obstacle = { pos: a.local, r: def.radius * 0.85, brood: true };
    planet.obstacles.push(a.obstacle);
    planet._obsGrid = null;
    planet.decor.removeFloraNear(a.local, def.radius + 1.5);
    if (def.veil || type === 'broodHive') {
      a.dome = makeDome(def.veil ? CONFIG.brood.veil.radius : CONFIG.brood.veil.hiveRadius, def.veil ? 0x9a7bff : 0xc070ff);
      a.dome.position.copy(a.dir).multiplyScalar(planet.radius + planet.walkHeight(a.dir) - 0.6);
      a.dome.quaternion.setFromUnitVectors(UP, a.dir);
      planet.group.add(a.dome);
    }
    this.structures.push(a);
    return a;
  }

  _removeStructure(a) {
    const i = this.structures.indexOf(a);
    if (i >= 0) this.structures.splice(i, 1);
    const k = this.planet.obstacles.indexOf(a.obstacle);
    if (k >= 0) { this.planet.obstacles.splice(k, 1); this.planet._obsGrid = null; }
    if (a.dome) { a.dome.removeFromParent(); a.dome.material.dispose(); a.dome = null; }
    if (a.creepR > 0.1) this.fading.push({ x: a.plane.x, y: a.plane.y, r: a.creepR });
  }

  _creepTarget(a) {
    if (a.type === 'broodChrysalis') return 7;
    if (a.type === 'broodHive') return Math.min(26, 10 + 1.4 * this.structures.filter((s) => s.built && s !== a).length);
    return (a.def.radius * 2 + 4) * a.grow;
  }

  /** Count of finished, living structures of a type. */
  _have(type) {
    let n = 0;
    for (const s of this.structures) if (s.type === type && s.alive && s.built) n++;
    return n;
  }

  /** A free spot on the creep for a new structure, or null. */
  _findSite(type) {
    const def = CONFIG.brood.structures[type], planet = this.planet, B = CONFIG.brood;
    const anchors = this.structures.filter((s) => s.alive && s.built);
    const nodes = planet.resources.nodes;
    for (let tries = 0; tries < 60; tries++) {
      const anchor = anchors[Math.floor(Math.random() * anchors.length)];
      if (!anchor) return null;
      const ang = Math.random() * Math.PI * 2;
      const dist = anchor.def.radius + def.radius + 2 + Math.random() * Math.max(2, anchor.creepR * 0.6);
      const x = anchor.plane.x + Math.cos(ang) * dist, y = anchor.plane.y + Math.sin(ang) * dist;
      if (Math.hypot(x, y) > B.colonyRadius) continue;
      const dir = this.grid.toDir(x, y);
      if (planet.isSubmerged(dir) || planet.slopeAt(dir) > 0.55) continue;
      const local = planet.surfacePoint(dir, new THREE.Vector3());
      if (this.structures.some((s) => s.alive && s.local.distanceTo(local) < s.def.radius + def.radius + 2.5)) continue;
      if (nodes.some((n) => n.pos.distanceTo(local) < def.radius + 1.6)) continue;
      if (planet.obstacles.some((o) => (o.relic || o.building) && o.pos.distanceTo(local) < o.r + def.radius + 2)) continue;
      return dir;
    }
    return null;
  }

  /** Next structure of the build plan the colony lacks (destroyed ones are regrown). */
  _nextPlanItem() {
    const have = {}, want = {};
    for (const s of this.structures) if (s.alive) have[s.type] = (have[s.type] || 0) + 1;
    for (const type of CONFIG.brood.buildPlan) {
      want[type] = (want[type] || 0) + 1;
      if ((have[type] || 0) < want[type]) return type;
    }
    return null;
  }

  // ------------------------------------------------------------ organisms
  /** Unit types the colony can hatch right now. */
  _hatchable(forWave = false) {
    return Object.entries(CONFIG.brood.units).filter(([, u]) => u.cost && (!u.needs || this._have(u.needs)) && (!forWave || !u.minWave || this.waves >= u.minWave)).map(([k]) => k);
  }

  /** Random organism type, weighted (cheap swarmers most often). */
  _pickType(types, maxCost = Infinity) {
    const W = CONFIG.brood.weights;
    const ok = types.filter((t) => CONFIG.brood.units[t].cost <= maxCost);
    if (!ok.length) return null;
    let sum = 0;
    for (const t of ok) sum += W[t] ?? 1;
    let r = Math.random() * sum;
    for (const t of ok) { r -= W[t] ?? 1; if (r <= 0) return t; }
    return ok[0];
  }

  /** A dry direction within `spread` metres of `dir`. */
  _dryNear(planet, dir, spread, ground = true) {
    const t1 = anyPerpendicular(dir, new THREE.Vector3()), t2 = new THREE.Vector3().crossVectors(dir, t1);
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = (spread * (0.4 + Math.random() * 0.6) + k * 0.5) / planet.radius;
      const d = dir.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
      if (!ground || !planet.isSubmerged(d)) return d;
    }
    return dir.clone();
  }

  _spawnGarrison(type) {
    const center = this.hive?.dir ?? this.siteDir;
    const a = this.units.spawn(type, 'enemy', this.planet, this._dryNear(this.planet, center, 9 + Math.random() * 8, !CONFIG.brood.units[type].flying));
    a.home.copy(center);
    this.garrison.push(a);
    return a;
  }

  // ------------------------------------------------------------ the AI hook
  /**
   * Called by UnitManager for every Brood actor. Returns true when the director
   * handled it; ordinary organisms return false and use the shared enemy AI.
   */
  think(a, dt) {
    if (a.structure) { this._structureAI(a, dt); return true; }
    if (a.type === 'broodCarrier') { this._carrierAI(a, dt); return true; }
    if (a.type === 'seeker') { this._seekerAI(a, dt); return true; }
    return false;
  }

  _structureAI(a) {
    const w = a.def.weapon;
    a.moving = false;
    if (!w || !a.built || this.state !== 'awake' || a.witherT != null) { a.state = 'structure'; return; }
    if (a.scanT <= 0) { a.scanT = 0.4; a.target = this.units.nearestHostile(a, w.range); }
    const t = a.target;
    if (!t || !t.alive || a.edgeDistance(t) > w.range) { a.target = null; a.state = 'structure'; return; }
    a.state = 'attack';
    if (a.cooldown > 0) return;
    a.cooldown = w.cooldown;
    if (a.type === 'sporeSpitter') a.facePoint(targetLocal(t));
    const muzzle = a.worldPos.addScaledVector(a.dir, (a.type === 'broodHive' ? 5 : 3) * a.grow);
    const to = targetLocal(t).clone().add(this.planet.position).addScaledVector(a.dir, t.flying ? 0 : 0.8);
    this.units.spawnBolt('brood', muzzle, to, SHOT_SOUND[a.type]);
    t.takeDamage(w.damage, this.game, a);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const game = this.game, B = CONFIG.brood;
    this.time += dt;
    this._updateVoyages(dt);
    this._updateStructures(dt);
    this.garrison = this.garrison.filter((a) => a.alive);
    this.invaders = this.invaders.filter((a) => a.alive);
    this._retargetInvaders();

    if (this.state === 'dormant') {
      const moon = game.techMoon;
      if (B.awakenOn === 'start' ? moon.state !== 'none' : moon.complete) this._stir();
    } else if (this.state === 'stirring') {
      this.stirT -= dt;
      if (this.stirT <= 0) this._awaken();
    } else if (this.state === 'awake') {
      this.biomass = Math.min(B.maxBiomass, this.biomass + this._income() * dt);
      this.seekerT -= dt;
      this.invasionT -= dt;
      this.thinkT -= dt;
      if (this.thinkT <= 0) { this.thinkT = B.thinkInterval; this._think(); }
    }
  }

  _income() {
    let inc = this.hive?.alive ? CONFIG.brood.hiveIncome : 0;
    for (const s of this.structures) if (s.built && s.alive && s.def.income) inc += s.def.income;
    return inc;
  }

  _updateStructures(dt) {
    const B = CONFIG.brood;
    const centers = [];
    for (const a of [...this.structures]) {
      if (!a.alive) continue;
      if (a.witherT != null) {
        // the Hive is dead: the colony withers away, one structure after another
        a.witherT -= dt;
        a.creepR *= Math.exp(-dt * 0.8);
        if (a.witherT <= 0) { a.hp = 0; a.alive = false; this.units.onDeath(a, null); }
      } else if (!a.built) {
        a.growth = Math.min(1, a.growth + dt / a.def.growTime);
        a.grow = 0.25 + 0.75 * (1 - (1 - a.growth) ** 2);
        a.hp = Math.min(a.def.hp, a.hp + (a.def.hp * 0.75 * dt) / a.def.growTime);
        if (a.growth >= 1) a.built = true;
      } else if (a.grow < 1) {
        a.grow = Math.min(1, a.grow + dt * 0.09);   // the freshly hatched Hive unfurls
      }
      // regeneration paid with biomass
      if (this.state === 'awake' && a.built && a.hp < a.def.hp && this.game.time - a.lastHit > B.regen.delay && this.biomass > 0) {
        const heal = Math.min(a.def.hp - a.hp, a.def.hp * B.regen.rate * dt);
        a.hp += heal;
        this.biomass = Math.max(0, this.biomass - heal * B.regen.biomassPerHp);
      }
      const target = a.witherT != null ? 0 : this._creepTarget(a);
      a.creepR += (target - a.creepR) * (1 - Math.exp(-dt * 0.35));
      centers.push({ x: a.plane.x, y: a.plane.y, r: a.creepR });
      if (a.dome) {
        const u = a.dome.material.uniforms;
        u.uTime.value = this.game.time;
        const on = a.built && a.witherT == null && (a.type !== 'broodHive' || this.state === 'awake');
        u.uStrength.value += ((on ? 1 : 0) - u.uStrength.value) * (1 - Math.exp(-dt * 1.5));
        a.dome.visible = u.uStrength.value > 0.01;
        a.dome.scale.setScalar(u.uRadius.value * (0.3 + 0.7 * u.uStrength.value));
      }
    }
    for (const f of this.fading) { f.r *= Math.exp(-dt * 0.12); centers.push(f); }
    this.fading = this.fading.filter((f) => f.r > 0.3);
    this.creep.update(this.game.time, centers);
  }

  // ------------------------------------------------------------- awakening
  _stir() {
    this.state = 'stirring';
    this.stirT = CONFIG.brood.awakenDelay;
    this.game.audio.play('broodRoar', { pitch: 0.7, volume: 0.6 });
    this.game.hud.notify(`☣ Massive bio-signals detected on ${this.planet.name} — something vast is waking up.`, 'warn');
  }

  _awaken() {
    const B = CONFIG.brood, game = this.game;
    const dir = this.hive ? this.hive.dir.clone() : this.siteDir.clone();
    if (this.hive) this._despawn(this.hive, true);
    this.fading = [];
    this.hive = this._addStructure('broodHive', dir, { built: true });
    this.hive.grow = 0.55;
    this.hive.creepR = 7;
    this.state = 'awake';
    this.biomass = B.startBiomass;
    this.seekerT = B.seekers.firstDelay;
    this.invasionT = B.invasions.firstDelay;
    this.thinkT = 1;
    game.audio.play('broodRoar');
    game.hud.showTierUp('THE BROOD HAS AWAKENED',
      `A living hive hatched on ${this.planet.name}. It will grow, hunt for your colonies and send bio-ships against them. Destroy its Hive to end it.`,
      { title: 'BIO-ALIEN THREAT', hostile: true });
    game.hud.notify(`☣ The Brood Hive on ${this.planet.name} has hatched!`, 'warn');
  }

  /** Feedback when something shoots the sealed chrysalis. */
  onSealedHit() {
    if (this.game.time - this.sealedMsgAt < 20) return;
    this.sealedMsgAt = this.game.time;
    this.game.hud.notify('The chrysalis carapace is sealed — it cannot be harmed while it sleeps.', 'info');
  }

  // ------------------------------------------------------------- decisions
  _think() {
    const B = CONFIG.brood, game = this.game;
    if (!this.hive?.alive) return;
    // Colonies on the Brood's own world are never a secret.
    if (this.planet.bases.some((b) => b.core)) this.known.add(this.planet.index);

    // 1) invasion due → save up and launch
    let saving = false;
    if (this.invasionT <= 0) saving = !this._tryInvasion();
    else if (this.invasionT < 30) saving = true;
    // 2) seekers look for colonies
    if (this.seekerT <= 0 && !this.seeker && !this.voyages.some((v) => v.type === 'seeker')) this._launchSeeker();
    // 3) grow the colony (one structure at a time)
    const growing = this.structures.some((s) => s.alive && !s.built);
    const next = this._nextPlanItem();
    const reserve = saving ? this._invasionBudget() + B.invasions.minReserve : 0;
    if (!growing && next && this.biomass - B.structures[next].cost >= reserve) {
      const dir = this._findSite(next);
      if (dir) {
        this.biomass -= B.structures[next].cost;
        this._addStructure(next, dir);
        if (this.game.focusPlanet === this.planet) game.hud.notify(`The Brood is growing a ${B.structures[next].name}.`, 'info');
      }
    }
    // 4) keep a garrison at home
    const G = B.garrison;
    const built = this.structures.filter((s) => s.built && s.alive).length;
    if (this.garrison.length < Math.min(G.max, Math.round(G.base + G.perStructure * built))) {
      const type = this._pickType(this._hatchable(), this.biomass - reserve - B.invasions.minReserve);
      if (type) {
        this.biomass -= B.units[type].cost;
        const a = this._spawnGarrison(type);
        a.dir.copy(this._dryNear(this.planet, this.hive.dir, 5, !a.flying));
        this.units.ping(this.planet, this.hive.local, 0xff3aa0);
      }
    }
  }

  _invasionBudget() {
    const I = CONFIG.brood.invasions;
    return Math.min(I.maxBudget, I.budget + I.budgetGrowth * this.waves);
  }

  /** Known colonies the Brood can strike. */
  _targets() {
    const out = [];
    for (const idx of this.known) for (const b of this.game.planets[idx].bases) if (b.core?.built) out.push(b);
    return out;
  }

  /** Launch a Carrier wave if there is a target and enough biomass. Returns true if it went (or there is nothing to do). */
  _tryInvasion() {
    const B = CONFIG.brood, I = B.invasions;
    const targets = this._targets();
    if (!targets.length) { this.invasionT = 20; return true; }
    const budget = this._invasionBudget();
    const available = this.biomass - I.minReserve;
    if (available < budget * 0.6) return false;
    let spend = Math.min(budget, available);
    const types = this._hatchable(true), cargo = [];
    while (cargo.length < I.maxCargo) {
      const t = this._pickType(types, spend);
      if (!t) break;
      cargo.push(t);
      spend -= B.units[t].cost;
      this.biomass -= B.units[t].cost;
    }
    if (!cargo.length) return false;
    const base = targets[Math.floor(Math.random() * targets.length)];
    this.waves++;
    this.invasionT = I.interval[0] + Math.random() * (I.interval[1] - I.interval[0]);
    // the Carrier rises from beside the Hive
    const c = this.units.spawn('broodCarrier', 'enemy', this.planet, this._dryNear(this.planet, this.hive.dir, 8, false));
    c.altitude = 4;
    c.order({ kind: 'carrier', phase: 'launch', cargo, base, size: cargo.length });
    this.game.audio.play('broodRoar', { pitch: 1.3, volume: 0.5 });
    this.game.hud.notify(`☣ A Brood Carrier with ${cargo.length} organisms is lifting off from ${this.planet.name} — target: ${base.planet.name}, colony ${base.number}!`, 'warn');
    return true;
  }

  /**
   * Invaders whose colony fell move on to another one on that planet. With nothing left
   * to attack they go feral: they stay and roam, but the invasion is over.
   */
  _retargetInvaders() {
    for (const a of this.invaders) {
      const base = a.task?.base ?? a.task?.raid?.base;
      if (base && base.buildings.length) continue;
      const next = a.planet.bases.find((b) => b.buildings.length);
      if (next) { a.home.copy(next.core?.dir ?? a.dir); a.order({ kind: 'raid', base: next }); }
      else { a.home.copy(a.dir); a.order(null); a.feral = true; }
    }
    this.invaders = this.invaders.filter((a) => !a.feral);
  }

  // ---------------------------------------------------------------- Carrier
  _carrierAI(a, dt) {
    const I = CONFIG.brood.invasions, T = a.task;
    if (!T) { this._despawn(a); return; }
    a.state = 'carrier';
    switch (T.phase) {
      case 'launch':
        a.moving = true;
        a.altitude += I.climbSpeed * dt;
        if (a.altitude >= I.carrierAltitude[0]) {
          if (T.base.planet === a.planet) { T.phase = 'descend'; T.drop = this._dropPoint(T.base); }
          else this._toSpace(a, T.base.planet, T);
        }
        break;
      case 'descend': {
        T.drop ??= this._dropPoint(T.base);
        const there = a.moveTowards(T.drop, dt, 2);
        a.moving = true;
        a.altitude = Math.max(I.carrierAltitude[1], a.altitude - I.descentSpeed * dt);
        if (there && a.altitude <= I.carrierAltitude[1] + 0.01) { T.phase = 'unload'; T.t = 0.6; }
        break;
      }
      case 'unload':
        a.moving = false;
        T.t -= dt;
        if (T.t > 0) break;
        T.t = 0.45;
        if (T.cargo.length) this._hatch(T.cargo.shift(), a, T);
        else T.phase = 'leave';
        break;
      case 'leave':
        a.moving = true;
        a.altitude += I.climbSpeed * dt;
        if (a.altitude >= I.carrierAltitude[0]) {
          if (this.hive?.alive && a.planet !== this.planet) this._toSpace(a, this.planet, { kind: 'carrier', phase: 'home' });
          else this._despawn(a);
        }
        break;
      default: this._despawn(a);
    }
  }

  /** Dry landing zone dropDistance metres from the colony core, on a random side. */
  _dropPoint(base) {
    const planet = base.planet, I = CONFIG.brood.invasions;
    const core = base.core?.dir ?? base.grid.origin;
    const side = new THREE.Vector3().randomDirection();
    side.addScaledVector(core, -side.dot(core)).normalize();
    let dir = core.clone().addScaledVector(side, I.dropDistance / planet.radius).normalize();
    const nav = getNav(planet);
    const node = nav.nearestWalkable(nav.nodeAt(dir), 2000);
    if (node >= 0) dir = nav.dirOf(node, new THREE.Vector3());
    return planet.surfacePoint(dir, new THREE.Vector3());
  }

  _hatch(type, carrier, T) {
    const planet = carrier.planet, flying = !!CONFIG.brood.units[type].flying;
    const dir = this._dryNear(planet, carrier.dir, 3.5, !flying);
    const u = this.units.spawn(type, 'enemy', planet, dir);
    const base = T.base.buildings.length ? T.base : planet.bases.find((b) => b.buildings.length);
    if (base) { u.home.copy(base.core?.dir ?? dir); u.order({ kind: 'raid', base }); }
    this.invaders.push(u);
    this.units.ping(planet, u.local, 0xff3aa0);
    this.game.audio.play('broodHatch', { at: u.worldPos });
  }

  // ----------------------------------------------------------------- Seeker
  _launchSeeker() {
    const S = CONFIG.brood.seekers;
    this.seekerT = S.interval;
    // Look where you have not been found yet: never-scouted worlds first, then the oldest, nearest first.
    const cands = this.game.planets.filter((p) => p !== this.planet && !this.known.has(p.index))
      .sort((x, y) => ((this.scouted[x.index] ?? -1e9) - (this.scouted[y.index] ?? -1e9))
        || x.position.distanceTo(this.planet.position) - y.position.distanceTo(this.planet.position));
    const target = cands[0];
    if (!target) return;
    const s = this.units.spawn('seeker', 'enemy', this.planet, this._dryNear(this.planet, this.hive.dir, 6, false));
    s.altitude = 6;
    s.order({ kind: 'seek', phase: 'launch', target });
    this.seeker = s;
  }

  _seekerAI(a, dt) {
    const S = CONFIG.brood.seekers, T = a.task, planet = a.planet;
    if (!T) { this._despawn(a); return; }
    a.state = 'seek';
    a.moving = true;
    if (T.phase === 'launch') {
      a.altitude += 9 * dt;
      if (a.altitude > 45) this._toSpace(a, T.target, { kind: 'seek', phase: 'search' });
      return;
    }
    if (T.phase === 'leave') {
      a.altitude += 9 * dt;
      if (a.altitude > 45) {
        if (this.hive?.alive && planet !== this.planet) this._toSpace(a, this.planet, { kind: 'seek', phase: 'home' });
        else { this._despawn(a); if (this.seeker === a) this.seeker = null; }
      }
      return;
    }
    if (T.phase === 'home') { this._despawn(a); if (this.seeker === a) this.seeker = null; return; }
    a.altitude = Math.max(a.def.altitude, a.altitude - 6 * dt);
    if (T.relay) {
      const base = T.relay.base;
      if (!base.core?.alive) { T.relay = null; this.relay = null; return; }
      // circle over the colony while relaying its position home
      T.ang = (T.ang ?? 0) + dt * 0.3;
      const c = base.core.dir, t1 = anyPerpendicular(c, _v), t2 = _w.crossVectors(c, t1);
      const p = c.clone().addScaledVector(t1, Math.cos(T.ang) * 12 / planet.radius).addScaledVector(t2, Math.sin(T.ang) * 12 / planet.radius).normalize();
      a.moveTowards(planet.surfacePoint(p, new THREE.Vector3()), dt, 1);
      T.relay.t += dt;
      this.relay = { base, planet, left: S.relayTime - T.relay.t };
      if (T.relay.t >= S.relayTime) {
        this.known.add(planet.index);
        this.relay = null;
        T.relay = null;
        T.phase = 'leave';
        this.game.hud.notify(`☣ The Brood now knows about your colonies on ${planet.name}. Expect bio-ships.`, 'warn');
      }
      return;
    }
    // look for colonies while flying the search pattern
    T.scanT = (T.scanT ?? 0) - dt;
    if (T.scanT <= 0) {
      T.scanT = 0.5;
      const base = planet.bases.find((b) => b.core?.alive && b.core.localPos.distanceTo(a.local) < S.scanRange);
      if (base) {
        T.relay = { base, t: 0 };
        this.game.audio.play('seekerCall', { at: a.worldPos, volume: 1.4 });
        this.game.hud.notify(`☣ A Brood Seeker found colony ${base.number} on ${planet.name} and is relaying its position — destroy it within ${S.relayTime}s!`, 'warn');
        return;
      }
    }
    T.points ??= this._searchPattern(planet, a.dir);
    T.idx ??= 0;
    const wp = T.points[T.idx];
    if (!wp) { this.scouted[planet.index] = this.game.time; T.phase = 'leave'; return; }
    if (a.moveTowards(planet.surfacePoint(wp, new THREE.Vector3()), dt, 5)) T.idx++;
  }

  /** Points spread over the whole planet (Fibonacci sphere), visited nearest-first from `start`. */
  _searchPattern(planet, start) {
    const n = CONFIG.brood.seekers.waypoints, pts = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      pts.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    }
    const out = [];
    let cur = start.clone();
    while (pts.length) {
      let best = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(cur) < pts[best].distanceTo(cur)) best = i;
      cur = pts.splice(best, 1)[0];
      out.push(cur);
    }
    return out;
  }

  // ------------------------------------------------------- space voyages
  /** An actor leaves its planet: it becomes a ship flying through space toward `dest`. */
  _toSpace(a, dest, task) {
    const I = CONFIG.brood.invasions;
    const from = a.worldPos;
    const srcUp = a.dir.clone();
    let endDir, endAlt, inbound = false;
    if (task.kind === 'carrier' && task.phase !== 'home') {
      task.drop = this._dropPoint(task.base);
      endDir = task.drop.clone().normalize();
      endAlt = I.carrierAltitude[0];
      task.phase = 'descend';
      inbound = true;
    } else if (task.kind === 'seek' && task.phase === 'search') {
      endDir = this.planet.position.clone().sub(dest.position).normalize();   // arrive on the side facing the hive world
      endAlt = 45;
    } else {
      endDir = (this.hive?.dir ?? this.siteDir).clone();
      endAlt = 45;
    }
    const to = endDir.clone().multiplyScalar(dest.radius + dest.walkHeight(endDir) + endAlt).add(dest.position);
    const L = from.distanceTo(to);
    const p1 = from.clone().addScaledVector(srcUp, L * 0.3);
    const p2 = to.clone().addScaledVector(endDir, L * 0.3);
    const v = { type: a.type, hp: a.hp, task, planet: dest, dir: endDir, alt: endAlt, inbound, t: 0, curve: new THREE.CubicBezierCurve3(from, p1, p2, to) };
    v.duration = v.curve.getLength() / CONFIG.brood.voyageSpeed;
    v.mesh = this._shipMesh(a.type);
    v.mesh.position.copy(from);
    this.game.scene.add(v.mesh);
    this.voyages.push(v);
    if (a === this.seeker) this.seeker = null;
    this._despawn(a);
  }

  _shipMesh(type) {
    const g = new THREE.Group();
    for (const pt of unitModelParts(type)) {
      const m = new THREE.Mesh(pt.geo, pt.mat);
      m.castShadow = false;
      g.add(m);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff6ac8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(type === 'broodCarrier' ? 16 : 8);
    g.add(glow);
    return g;
  }

  _updateVoyages(dt) {
    const planets = this.game.planets;
    for (const v of this.voyages) {
      v.t = Math.min(1, v.t + dt / v.duration);
      const p = v.curve.getPointAt(v.t, _v);
      // never fly through a planet
      for (const pl of planets) {
        const d = _w.copy(p).sub(pl.position), len = d.length(), min = pl.radius + 30;
        if (len < min) p.copy(pl.position).addScaledVector(d.divideScalar(len || 1), min);
      }
      const tan = v.curve.getTangentAt(Math.min(v.t, 0.999), _w);
      v.mesh.position.copy(p);
      v.mesh.lookAt(p.x + tan.x, p.y + tan.y, p.z + tan.z);
      if (v.t >= 1) this._arrive(v);
    }
    this.voyages = this.voyages.filter((v) => v.t < 1);
  }

  _arrive(v) {
    v.mesh.removeFromParent();
    if (v.task.phase === 'home') return;   // docked with the Hive
    const a = this.units.spawn(v.type, 'enemy', v.planet, v.dir);
    a.altitude = v.alt;
    a.hp = v.hp;
    a.order(v.task);
    if (v.type === 'seeker') this.seeker = a;
    if (v.type === 'broodCarrier') {
      this.game.hud.notify(`☣ Brood Carrier arriving over ${v.planet.name} — it is descending near colony ${v.task.base.number}!`, 'warn');
    }
  }

  // ------------------------------------------------------------- deaths
  onActorDeath(a) {
    if (a.recalled) return;
    if (a.structure) {
      this._removeStructure(a);
      if (a.type === 'broodHive') { this._collapse(); return; }
      if (a.type === 'veilSpire' && a.witherT == null) this.game.hud.notify('Resonance Veil Spire destroyed — the Tech Moon can target that area again.', 'success');
      return;
    }
    if (a.type === 'broodCarrier' && a.task?.cargo?.length && a.task.phase !== 'home') {
      this.game.hud.notify(`Brood Carrier destroyed — ${a.task.cargo.length} organisms died with it!`, 'success');
    }
    if (a.type === 'seeker') {
      if (a.task?.relay) this.game.hud.notify('Brood Seeker destroyed before it could report your colony!', 'success');
      if (this.seeker === a) this.seeker = null;
      if (this.relay) this.relay = null;
    }
  }

  /** The Hive died: the colony withers, the creep recedes, and you salvage its remains. */
  _collapse() {
    const game = this.game;
    this.state = 'dead';
    this.hive = null;
    this.relay = null;
    let k = 0;
    for (const s of this.structures) s.witherT = 1 + k++ * 0.7;
    const reward = CONFIG.brood.destroyReward;
    for (const [res, v] of Object.entries(reward)) game.inventory.add(res, v);
    game.hud.showTierUp('BROOD HIVE DESTROYED',
      `The colony on ${this.planet.name} withers and its creep recedes. Salvaged: ${Object.entries(reward).map(([r, v]) => `${v} ${RESOURCE_LABELS[r]}`).join(', ')}.`,
      { title: 'BIO-ALIEN THREAT ENDED' });
    game.hud.notify('The Brood Hive is dead!', 'success');
  }

  // ----------------------------------------------------------- jamming
  /** Is a planet-local point inside a Resonance Veil (Tech Moon targeting can't lock on)? */
  isJammed(planet, local) {
    if (planet !== this.planet) return false;
    const V = CONFIG.brood.veil;
    for (const s of this.structures) {
      if (!s.alive || !s.built || s.witherT != null) continue;
      const r = s.def.veil ? V.radius : s.type === 'broodHive' ? V.hiveRadius : 0;
      if (r && s.local.distanceTo(local) < r) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- HUD
  /** Red banner text (null when calm). */
  alertText() {
    if (this.state === 'stirring') return `☣ BIO-SIGNAL SURGE · ${this.planet.name} · something hatches in ${Math.ceil(this.stirT)}s`;
    if (this.relay) return `☣ BROOD SEEKER RELAYING · ${this.relay.planet.name}, colony ${this.relay.base.number} · ${Math.max(0, Math.ceil(this.relay.left))}s — destroy it!`;
    const v = this.voyages.find((x) => x.inbound);
    if (v) return `☣ BROOD CARRIER → ${v.planet.name}, colony ${v.task.base.number} · ETA ${Math.ceil((1 - v.t) * v.duration)}s`;
    const c = this.units.actors.find((a) => a.alive && a.type === 'broodCarrier' && (a.task?.phase === 'descend' || a.task?.phase === 'unload'));
    if (c) return `☣ BROOD CARRIER LANDING · ${c.planet.name} · ${c.task.cargo.length} organisms aboard`;
    const inv = this.invaders.filter((a) => a.alive);
    if (inv.length) return `☣ BROOD INVASION · ${inv[0].planet.name} · ${inv.length} organisms left`;
    return null;
  }

  /** Brood ships in space, for the flight markers. */
  markers() {
    return this.voyages.map((v) => ({ position: v.mesh.position, radius: 4, name: v.type === 'broodCarrier' ? '☣ Brood Carrier' : '☣ Brood Seeker', hostile: true }));
  }

  // ---------------------------------------------------------- persistence
  serialize() {
    const S = (a) => ({ type: a.type, dir: a.dir.toArray().map((x) => +x.toFixed(5)), hp: Math.round(a.hp), g: +(a.growth ?? 1).toFixed(3) });
    const garrison = {};
    for (const a of this.garrison) if (a.alive) garrison[a.type] = (garrison[a.type] || 0) + 1;
    const busy = this.voyages.some((v) => v.inbound) || this.invaders.some((a) => a.alive);
    return {
      state: this.state, stirT: Math.round(this.stirT), biomass: Math.round(this.biomass), waves: this.waves,
      known: [...this.known], scouted: this.scouted,
      seekerT: this.seekerT == null ? null : Math.round(this.seekerT),
      // a wave in progress isn't saved: it comes back soon after loading, with a fresh warning
      invasionT: this.invasionT == null ? null : Math.round(busy ? 45 : this.invasionT),
      structures: this.structures.filter((a) => a.alive && a.witherT == null).map(S),
      garrison,
    };
  }

  deserialize(d) {
    this._wipe();
    this._clearState();
    if (!d) { this._spawnDormant(); return; }
    Object.assign(this, {
      state: ['dormant', 'stirring', 'awake', 'dead'].includes(d.state) ? d.state : 'dormant',
      stirT: d.stirT ?? 0, biomass: d.biomass ?? 0, waves: d.waves ?? 0,
      known: new Set(d.known || []), scouted: d.scouted || {},
      seekerT: d.seekerT ?? CONFIG.brood.seekers.firstDelay, invasionT: d.invasionT ?? CONFIG.brood.invasions.firstDelay,
    });
    if (this.state === 'dead') return;
    if (this.state !== 'awake') { this._spawnDormant(); return; }
    for (const s of d.structures || []) {
      if (!CONFIG.brood.structures[s.type] || s.type === 'broodChrysalis') continue;
      const a = this._addStructure(s.type, new THREE.Vector3().fromArray(s.dir), { growth: s.g ?? 1, hp: s.hp });
      if (s.type === 'broodHive') this.hive = a;
    }
    if (!this.hive) { this.state = 'dead'; for (const s of [...this.structures]) this._despawn(s, true); return; }
    for (const [type, n] of Object.entries(d.garrison || {})) {
      if (!CONFIG.brood.units[type]) continue;
      for (let i = 0; i < n; i++) this._spawnGarrison(type);
    }
  }
}
