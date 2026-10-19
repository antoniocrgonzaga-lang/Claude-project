/**
 * The Tech Moon (Phase 5).
 *
 * An artificial moon built in orbit once the base AI reaches ASI. Original
 * design: a geodesic lattice frame, filled panel by panel with hull plates,
 * a crystal "mind" core glowing through the seams, an orbital weapon ring
 * and two polar spires.
 *
 * Construction runs through CONFIG.techMoon.stages (paid when each starts).
 * Once complete the moon:
 *   · fires beam cannons at enemies on the planet it orbits
 *   · produces resources passively
 *   · automates that planet: idle gatherers go to work, blueprints get built,
 *     production buildings with Auto-recruit keep training, construction is faster
 *   · travels to other planets, carrying your units and beaming them down.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, easeInOut, makeGlowTexture, anyPerpendicular, clamp } from './utils.js';
import { RESOURCE_LABELS } from './inventory.js';
import { scaledCost, validatePlacement } from './buildings.js';
import { getNav } from './navigation.js';

const ORBIT_NORMAL = new THREE.Vector3(0.18, 1, 0.12).normalize();
const _tmp1 = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _tmp3 = new THREE.Vector3();
const E1 = anyPerpendicular(ORBIT_NORMAL, new THREE.Vector3());
const E2 = new THREE.Vector3().crossVectors(ORBIT_NORMAL, E1);

export class TechMoon {
  constructor(game) {
    this.game = game;
    this.reset();
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.name = 'tech-moon';
    game.scene.add(this.group);
    this.position = this.group.position;
    this._buildModel();
    this.beams = [];
  }

  reset() {
    this.state = 'none';        // none | building | complete
    this.stage = 0;             // index into CONFIG.techMoon.stages (== length when complete)
    this.progress = 0;          // 0..1 within the current stage
    this.paid = false;          // current stage's cost has been paid
    this.planet = null;         // planet it orbits / is heading to
    this.angle = 0;             // orbit angle
    this.travel = null;         // { from, duration, t }
    this.cargo = [];            // units carried between planets
    this.carryUnits = true;
    this.weaponCd = 0;
    this.autoT = 0;
    this.waitingFor = '';
    // ASI Architect (autonomous builder) and its drop capsule
    if (this.architect?.alive) { this.architect.alive = false; this.architect.bar?.group.removeFromParent(); }
    this.architect = null;
    this.archRespawn = 3;
    this.archStatus = '';
    this.autoColonize = true;
    this.planT = 0;
    if (this.drop) this.drop.mesh.removeFromParent();
    this.drop = null;
    this.fireSupportAt = -99;
    if (this.group) this.group.visible = false;
    if (this.guardians) this.guardians.visible = false;
  }

  get complete() { return this.state === 'complete'; }
  get stages() { return CONFIG.techMoon.stages; }

  /** True when the moon is parked above `planet` and running its automation there. */
  automates(planet) {
    return this.complete && !this.travel && this.planet === planet;
  }

  // ================================================================ model
  _buildModel() {
    const r = CONFIG.techMoon.radius;
    const rng = new RNG(4242);

    // Geodesic frame (glowing edges)
    const frameGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(r * 1.01, 2));
    this.frameMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, toneMapped: false });
    this.frameMat.color.setRGB(0.35, 1.4, 1.8);
    this.frame = new THREE.LineSegments(frameGeo, this.frameMat);
    this.frameCount = frameGeo.attributes.position.count;
    this.group.add(this.frame);

    // Hull plates: every triangle of an icosphere, shrunk a little so seams show,
    // in shuffled order so drawRange reveals them scattered across the sphere.
    const src = new THREE.IcosahedronGeometry(r * 0.99, 2);
    const p = src.attributes.position;
    const tris = [];
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const m = a.clone().add(b).add(c).divideScalar(3);
      tris.push([a, b, c].map((v) => v.sub(m).multiplyScalar(0.9).add(m)));
    }
    rng.shuffle(tris);
    const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
    const palette = [0xb8bfcb, 0x9aa3b2, 0x7d8696, 0x4f5868, 0xa8b0bd, 0xff7a2f];
    const c = new THREE.Color();
    tris.forEach((t, i) => {
      c.set(rng.chance(0.05) ? palette[5] : palette[Math.floor(rng.random() * 5)]);
      t.forEach((v, k) => { pos.set([v.x, v.y, v.z], i * 9 + k * 3); col.set([c.r, c.g, c.b], i * 9 + k * 3); });
    });
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    hullGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    hullGeo.computeVertexNormals();
    this.hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.45, flatShading: true }));
    this.hull.castShadow = true;
    this.hullTris = tris.length;
    this.group.add(this.hull);

    // Inner sphere glowing through the seams (lit by the reactor)
    this.innerMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false });
    this.inner = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.93, 3), this.innerMat);
    this.group.add(this.inner);

    // Crystal mind core
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe6d6ff, emissiveIntensity: 3 });
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.38, 0), this.coreMat);
    this.group.add(this.core);

    // Orbital weapon ring with cannon pylons + polar spires
    this.armament = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.4, metalness: 0.6, flatShading: true });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7df9ff, emissiveIntensity: 3 });
    this.ring = new THREE.Group();
    this.ring.add(new THREE.Mesh(new THREE.TorusGeometry(r * 1.5, r * 0.05, 4, 64), metal));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), this.glowMat);
      light.position.set(Math.cos(a) * r * 1.5, 0, Math.sin(a) * r * 1.5);
      this.ring.add(light);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const pylon = new THREE.Group();
      pylon.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 4.5), metal));
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.6), this.glowMat);
      tip.position.z = 2.5;
      pylon.add(tip);
      pylon.position.set(Math.cos(a) * r * 1.62, 0, Math.sin(a) * r * 1.62);
      pylon.lookAt(Math.cos(a) * r * 3, 0, Math.sin(a) * r * 3);
      this.ring.add(pylon);
    }
    this.ring.rotation.x = 0.35;
    this.armament.add(this.ring);
    for (const s of [1, -1]) {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.9, 6), metal);
      spire.position.y = s * r * 1.35;
      if (s < 0) spire.rotation.x = Math.PI;
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.08), this.glowMat);
      cap.position.y = s * r * 1.85;
      this.armament.add(spire, cap);
    }
    this.group.add(this.armament);

    // Soft halo once awake
    this.haloMat = new THREE.SpriteMaterial({ map: makeGlowTexture(256), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(r * 4);
    this.group.add(this.halo);

    // Beam pool
    this.beamGeo = new THREE.CylinderGeometry(0.45, 0.45, 1, 6, 1, true);
    this.beamGeo.translate(0, 0.5, 0);

    // Guardian drones: large escorts orbiting the moon (own group, follows the moon)
    const G = CONFIG.techMoon.guardians;
    this.guardians = new THREE.Group();
    this.guardians.visible = false;
    this.guardians.rotation.set(0.5, 0, 0.25);
    this.game.scene.add(this.guardians);
    this.guardianDrones = [];
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xc8ced8, roughness: 0.4, metalness: 0.5, flatShading: true });
    for (let k = 0; k < G.count; k++) {
      const d = new THREE.Group();
      d.add(new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), hullMat));
      for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(x ? 3.4 : 0.6, 0.5, z ? 3.4 : 0.6), hullMat);
        arm.position.set(x * 2.2, 0, z * 2.2);
        const pod = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.glowMat);
        pod.position.set(x * 4, 0, z * 4);
        d.add(arm, pod);
      }
      const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), this.coreMat);
      eye.position.y = -1.8;
      d.add(eye);
      const a = (k / G.count) * Math.PI * 2;
      d.position.set(Math.cos(a) * G.orbitRadius, 0, Math.sin(a) * G.orbitRadius);
      this.guardians.add(d);
      this.guardianDrones.push({ mesh: d, cd: k * 0.2 });
    }

    // Drop capsule that carries the Architect down to the surface
    const cap = new THREE.Group();
    cap.add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.7, 3, 8), hullMat));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.6, 8), hullMat);
    nose.position.y = 2.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.18, 4, 16), this.glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.4;
    cap.add(nose, ring);
    this.capsuleModel = cap;
  }

  /** Show construction progress on the model. */
  _applyVisuals() {
    const s = this.complete ? this.stages.length : this.stage, p = this.complete ? 1 : this.progress;
    const at = (i) => (s > i ? 1 : s === i ? p : 0);     // completion of stage i
    // Frame draws in during stage 0, then dims as the hull covers it.
    this.frame.geometry.setDrawRange(0, Math.floor(this.frameCount * at(0) / 2) * 2);
    this.frameMat.opacity = 0.9 - 0.55 * at(1);
    this.hull.geometry.setDrawRange(0, Math.floor(this.hullTris * at(1)) * 3);
    this.innerMat.opacity = at(2);
    this.innerMat.color.set(this.coreMat.emissive).multiplyScalar(0.9 * at(2));
    this.core.scale.setScalar(0.35 + 0.65 * Math.min(1, (at(0) + at(1) + at(2)) / 3));
    this.armament.scale.setScalar(Math.max(0.001, at(3)));
    this.armament.visible = at(3) > 0;
    this.haloMat.opacity = 0.12 * at(4);
    this.haloMat.color.set(this.coreMat.emissive);
    this.glowMat.emissiveIntensity = 0.8 + 1.2 * at(4);
  }

  // =============================================================== project
  /** Can the player start the project above this planet? Returns a reason or null. */
  startBlocker(planet) {
    if (this.game.aiTier < 3) return 'Requires the ASI tier';
    if (this.state !== 'none') return 'The Tech Moon already exists';
    if (!planet || !planet.bases.some((b) => b.core?.built)) return 'Needs a Command Core on that planet';
    return null;
  }

  startProject(planet) {
    const why = this.startBlocker(planet);
    if (why) { this.game.hud.notify(`Tech Moon: ${why}`, 'warn'); return; }
    this.state = 'building';
    this.stage = 0; this.progress = 0; this.paid = false;
    this.planet = planet;
    this.angle = Math.random() * Math.PI * 2;
    this.group.visible = true;
    this._placeInOrbit();
    this.game.hud.notify(`Tech Moon project started above ${planet.name}!`, 'tier');
  }

  // ================================================================ update
  update(dt) {
    if (this.state === 'none') return;
    const T = CONFIG.techMoon, game = this.game;
    this.coreMat.emissive.set(CONFIG.aiTiers[Math.min(game.aiTier, 3)].color);
    if (this.state === 'building') this._updateConstruction(dt);

    if (this.travel) this._updateTravel(dt);
    else { this.angle += dt * T.orbitSpeed; this._placeInOrbit(); }

    // animation
    this.core.rotation.y += dt * 0.6;
    this.core.rotation.x += dt * 0.3;
    this.ring.rotation.y += dt * 0.12;
    this.group.rotation.y += dt * 0.02;
    this._applyVisuals();
    this._updateBeams(dt);

    // guardian drones escort the moon once it is complete
    this.guardians.visible = this.complete;
    this.guardians.position.copy(this.position);
    this.guardians.rotation.y += dt * 0.35;
    for (const g of this.guardianDrones) g.mesh.rotation.y += dt * 1.5;

    if (!this.complete) return;
    // passive resources (also while travelling)
    for (const [k, v] of Object.entries(T.income)) game.inventory.add(k, (v / 60) * dt);
    if (this.travel) return;
    this._updateWeapons(dt);
    this._updateGuardians(dt);
    this._reportJamming();
    this._updateArchitect(dt);
    this.autoT -= dt;
    if (this.autoT <= 0) { this.autoT = T.autoInterval; this._automate(); }
  }

  _updateConstruction(dt) {
    const game = this.game, def = this.stages[this.stage];
    if (!this.paid) {
      let missing = Object.entries(def.cost).filter(([k, v]) => game.inventory.get(k) < v)
        .map(([k, v]) => `${Math.ceil(v - game.inventory.get(k))} ${RESOURCE_LABELS[k]}`).join(', ');
      // Energy can't exceed storage: tell the player when the cost is above their cap.
      if (def.cost.energy > game.energyCap) missing = `${def.cost.energy} Energy storage (now ${game.energyCap} — build more Power Generators)` + (missing ? ', ' + missing : '');
      this.waitingFor = missing;
      if (missing) return;
      game.inventory.spend(def.cost);
      this.paid = true;
      game.hud.notify(`Tech Moon · stage ${this.stage + 1}/${this.stages.length}: ${def.name} under way`, 'info');
    }
    this.waitingFor = '';
    this.progress += (dt * (game.modifiers.buildSpeed ?? 1)) / def.time;
    if (this.progress < 1) return;
    this.stage++;
    this.progress = 0;
    this.paid = false;
    if (this.stage >= this.stages.length) {
      this.state = 'complete';
      game.hud.showTierUp('TECH MOON ONLINE', 'Beam cannons armed · passive resources · planetary automation · interplanetary travel (press M).');
      game.hud.notify('The Tech Moon is complete!', 'tier');
      game.save(true);
    } else {
      game.hud.notify(`Tech Moon: ${def.name} complete`, 'success');
    }
  }

  _orbitPoint(planet, angle, out = new THREE.Vector3()) {
    const d = CONFIG.techMoon.orbitAltitude + planet.radius;
    return out.copy(E1).multiplyScalar(Math.cos(angle) * d).addScaledVector(E2, Math.sin(angle) * d).add(planet.position);
  }

  _placeInOrbit() {
    if (this.planet) this._orbitPoint(this.planet, this.angle, this.position);
  }

  // ================================================================ travel
  travelTo(planet) {
    if (!this.complete) { this.game.hud.notify('The Tech Moon must be finished before it can travel.', 'warn'); return; }
    if (planet === this.planet) {
      if (!this.travel) this.game.hud.notify(`The Tech Moon is already above ${planet.name}.`, 'info');
      return;
    }
    this._recallArchitect();
    this.game.audio.play('moonWarp');
    if (this.travel) {
      // Already flying: change course from where it is now (cargo stays aboard).
      this.planet = planet;
      const dist = this.position.distanceTo(this._orbitPoint(planet, this.angle));
      this.travel = { from: this.position.clone(), t: 0, duration: Math.max(4, dist / CONFIG.techMoon.travelSpeed) };
      this.game.hud.notify(`Tech Moon changing course to ${planet.name} — ETA ${Math.round(this.travel.duration)}s`, 'tier');
      return;
    }
    const from = this.planet;
    // Board every unit on the planet we are leaving.
    if (this.carryUnits && from) {
      for (const a of this.game.units.playerUnits.filter((u) => u.planet === from)) {
        this.cargo.push({ type: a.type, hp: a.hp });
        a.alive = false;
        if (a.bar) a.bar.group.removeFromParent();
      }
      this.game.units.actors = this.game.units.actors.filter((a) => a.alive);
      this.game.units.selected = this.game.units.selected.filter((a) => a.alive);
    }
    this.planet = planet;
    const dist = this.position.distanceTo(this._orbitPoint(planet, this.angle));
    this.travel = { from: this.position.clone(), t: 0, duration: Math.max(4, dist / CONFIG.techMoon.travelSpeed) };
    const n = this.cargo.length;
    this.game.hud.notify(`Tech Moon leaving for ${planet.name}${n ? ` with ${n} unit${n > 1 ? 's' : ''} aboard` : ''} — ETA ${Math.round(this.travel.duration)}s`, 'tier');
  }

  /**
   * Shortcut (N): bring the moon to the planet the explorer is on / near.
   * Explains why when it can't.
   */
  summonTo(planet) {
    const hud = this.game.hud;
    if (this.state === 'none') { hud.notify(this.game.aiTier < 3 ? 'No Tech Moon yet — it unlocks at AI tier ASI.' : 'No Tech Moon yet — press M to start building it.', 'warn'); return; }
    if (!this.complete) { hud.notify(`The Tech Moon is still under construction (stage ${this.stage + 1}/${this.stages.length}).`, 'warn'); return; }
    if (!planet) { hud.notify('Fly closer to a planet to call the Tech Moon there.', 'warn'); return; }
    this.travelTo(planet);
  }

  _updateTravel(dt) {
    const tr = this.travel;
    tr.t = Math.min(1, tr.t + dt / tr.duration);
    const to = this._orbitPoint(this.planet, this.angle);
    this.position.lerpVectors(tr.from, to, easeInOut(tr.t));
    if (tr.t >= 1) this._arrive();
  }

  _arrive() {
    this.travel = null;
    this._placeInOrbit();
    this.game.audio.play('moonWarp', { pitch: 1.4, volume: 0.6 });
    const planet = this.planet;
    if (this.cargo.length) this._beamDown(planet);
    this.game.hud.notify(`Tech Moon in orbit above ${planet.name}.`, 'success');
  }

  /** Units aboard are beamed down to dry land below the moon. */
  _beamDown(planet) {
    const nav = getNav(planet);
    const below = this.position.clone().sub(planet.position).normalize();
    const node = nav.nearestWalkable(nav.nodeAt(below), 5000);
    const centre = node >= 0 ? nav.dirOf(node, new THREE.Vector3()) : below;
    const n = this.cargo.length;
    this.game.audio.play('beamDown', { at: planet.surfacePoint(centre).add(planet.position) });
    this.cargo.forEach((c, i) => {
      let dir = centre;
      for (let k = 0; k < 12; k++) {
        const a = (i / n) * Math.PI * 2 + k, r = (2 + i * 0.5 + k) / planet.radius;
        const t1 = anyPerpendicular(centre, new THREE.Vector3());
        const t2 = new THREE.Vector3().crossVectors(centre, t1);
        const cand = centre.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
        if (!planet.isSubmerged(cand)) { dir = cand; break; }
      }
      const a = this.game.units.spawn(c.type, 'player', planet, dir);
      a.hp = c.hp;
      this._fireBeam(this.position, a.worldPos, 0x7dff9a, 0.5);
    });
    this.game.hud.notify(`${n} unit${n > 1 ? 's' : ''} beamed down to ${planet.name}.`, 'success');
    this.cargo = [];
  }

  // =============================================================== weapons
  /** Can a beam from `from` reach `to` without passing through the planet? */
  _lineOfSight(from, to) {
    const c = this.planet.position;
    const d = _tmp1.copy(to).sub(from);
    const t = clamp(_tmp2.copy(c).sub(from).dot(d) / d.lengthSq(), 0, 1);
    const closest = _tmp2.copy(from).addScaledVector(d, t);
    return closest.distanceTo(c) > this.planet.radius - 1;
  }

  /** Is this planet-local point inside / near one of your colonies? */
  _nearColony(local) {
    const reach = CONFIG.base.buildRadius + 20;
    return this.planet.bases.find((b) => b.core && b.core.localPos.distanceTo(local) < reach) ?? null;
  }

  /**
   * Visible enemies on the planet below, those threatening a colony first.
   * Targets inside a Brood Resonance Veil can't be locked on to (counted in this.jammed).
   */
  _visibleTargets(from, range) {
    const brood = this.game.brood;
    let jammed = 0;
    const list = this.game.units.actors
      .filter((a) => a.faction === 'enemy' && a.alive && !a.invulnerable && a.planet === this.planet)
      .map((a) => {
        const w = a.worldPos;
        return { a, w, d: w.distanceTo(from), colony: this._nearColony(a.local) };
      })
      .filter((t) => t.d < range && this._lineOfSight(from, t.w))
      .filter((t) => (brood?.isJammed(this.planet, t.a.local) ? (jammed++, false) : true))
      .sort((x, y) => (!!y.colony - !!x.colony) || x.d - y.d);
    this._jamSample = Math.max(this._jamSample ?? -1, jammed);
    return list;
  }

  /** Tell the player (rarely) when a Resonance Veil hides targets from the moon. */
  _reportJamming() {
    const game = this.game;
    if ((this._jamSample ?? -1) >= 0) { this.jamShown = this._jamSample; this._jamSample = -1; }
    const n = this.jamShown ?? 0;
    if (n > 0 && game.time - (this.jamMsgAt ?? -99) > 60) {
      this.jamMsgAt = game.time;
      game.hud.notify(`Tech Moon sensors jammed by a Resonance Veil on ${this.planet.name} — ${n} target${n > 1 ? 's' : ''} hidden. Destroy the Veil Spires with ground forces or fighters.`, 'warn');
    }
  }

  /** Main cannons: several beams per volley — fire support for colonies in view. */
  _updateWeapons(dt) {
    const W = CONFIG.techMoon.weapon, game = this.game;
    this.weaponCd -= dt;
    if (this.weaponCd > 0) return;
    const targets = this._visibleTargets(this.position, W.range).slice(0, W.targets);
    if (!targets.length) return;
    this.weaponCd = W.cooldown;
    const color = CONFIG.aiTiers[Math.min(game.aiTier, 3)].color;
    for (const { a, w } of targets) {
      this._fireBeam(this.position, w, color, 0.35, 1.4);
      a.takeDamage(W.damage * (game.modifiers.damage ?? 1), game, null);
    }
    game.audio.play('moonBeam', { at: targets[0].w });
    const defended = targets.find((t) => t.colony)?.colony;
    if (defended && game.time - this.fireSupportAt > 20) {
      this.fireSupportAt = game.time;
      game.hud.notify(`Tech Moon fire support engaging near colony ${defended.number} on ${this.planet.name}`, 'tier');
    }
  }

  /** Guardian drones: each picks its own visible target and fires a thinner beam. */
  _updateGuardians(dt) {
    const G = CONFIG.techMoon.guardians, game = this.game;
    for (const g of this.guardianDrones) {
      g.cd -= dt;
      if (g.cd > 0) continue;
      const from = g.mesh.getWorldPosition(_tmp3);
      const t = this._visibleTargets(from, G.range)[0];
      if (!t) { g.cd = 0.3; continue; }
      g.cd = G.cooldown;
      this._fireBeam(from.clone(), t.w, 0x7df9ff, 0.25, 0.6);
      game.audio.play('guardianBeam', { at: t.w });
      t.a.takeDamage(G.damage * (game.modifiers.damage ?? 1), game, null);
    }
  }

  _fireBeam(from, to, color, life, width = 1) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    mat.color.set(color).multiplyScalar(3);
    const beam = new THREE.Mesh(this.beamGeo, mat);
    const dir = to.clone().sub(from);
    beam.position.copy(from);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    beam.scale.set(width, dir.length(), width);
    beam.userData.width = width;
    this.game.scene.add(beam);
    this.beams.push({ mesh: beam, t: 0, life });
  }

  _updateBeams(dt) {
    for (const b of this.beams) {
      b.t += dt;
      b.mesh.material.opacity = Math.max(0, 1 - b.t / b.life);
      b.mesh.scale.x = b.mesh.scale.z = (b.mesh.userData.width ?? 1) * (1 + b.t * 3);
      if (b.t >= b.life) { b.mesh.removeFromParent(); b.mesh.material.dispose(); }
    }
    this.beams = this.beams.filter((b) => b.t < b.life);
  }

  // ======================================================= ASI Architect
  /**
   * The Architect is the ASI's own builder robot. It is dropped from the moon
   * in a capsule, founds a colony if the planet has none (near you if you are
   * there) and lays out a starter colony as blueprints the moon pays for.
   * If it is destroyed, the moon launches a new one after a delay.
   */
  _updateArchitect(dt) {
    const A = CONFIG.techMoon.architect, game = this.game;
    if (this.drop) {
      this._updateDrop(dt);
      if (this.drop?.phase === 'down') return;
    }
    const arch = this.architect;
    if (!arch || !arch.alive) {
      if (arch && !arch.alive && !arch.recalled) {
        this.architect = null;
        this.archRespawn = A.respawnTime;
        game.hud.notify(`ASI Architect destroyed — the moon launches a new one in ${A.respawnTime}s.`, 'warn');
      }
      if (this.drop) return;
      this.archRespawn -= dt;
      this.archStatus = `New Architect launching in ${Math.max(0, Math.ceil(this.archRespawn))}s`;
      if (this.archRespawn <= 0) this._launchArchitect();
      return;
    }
    this.planT -= dt;
    if (this.planT > 0) return;
    this.planT = A.planInterval;
    this._plan();
  }

  /** Where new things go: near the explorer if on this planet, else near the ship, else under the moon. */
  _siteCenter() {
    const game = this.game, planet = this.planet;
    if (game.player.group.visible && game.player.planet === planet) return game.player.position.clone().sub(planet.position).normalize();
    if (game.ship.landedPlanet === planet) return game.ship.position.clone().sub(planet.position).normalize();
    return this.position.clone().sub(planet.position).normalize();
  }

  _launchArchitect() {
    const planet = this.planet, game = this.game;
    const core = planet.bases.find((b) => b.core)?.core;
    let dir = core ? core.dir.clone() : this._siteCenter();
    const nav = getNav(planet);
    const node = nav.nearestWalkable(nav.nodeAt(dir), 5000);
    if (node >= 0) dir = nav.dirOf(node, new THREE.Vector3());
    const to = dir.clone().multiplyScalar(planet.radius + planet.walkHeight(dir) + 2).add(planet.position);
    const mesh = this.capsuleModel.clone();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.position.copy(this.position);
    game.scene.add(mesh);
    this.drop = { mesh, from: this.position.clone(), to, dir, t: 0, phase: 'down' };
    game.audio.play('capsule', { at: to });
    this.archStatus = 'Architect capsule descending';
    game.hud.notify(`Tech Moon launching an ASI Architect to ${planet.name}`, 'tier');
  }

  _updateDrop(dt) {
    const d = this.drop, A = CONFIG.techMoon.architect;
    d.t = Math.min(1, d.t + dt / A.dropTime);
    if (d.phase === 'down') {
      d.mesh.position.lerpVectors(d.from, d.to, easeInOut(d.t));
      if (d.t >= 1) {
        const a = this.game.units.spawn('architect', 'player', this.planet, d.dir);
        this.architect = a;
        this.planT = 0.5;
        this._fireBeam(this.position, a.worldPos, 0xe6d6ff, 0.6, 0.8);
        d.phase = 'up'; d.t = 0; d.from = d.to.clone();
      }
    } else {
      d.mesh.position.lerpVectors(d.from, this.position, easeInOut(d.t));
      d.mesh.scale.setScalar(1 - d.t * 0.8);
      if (d.t >= 1) { d.mesh.removeFromParent(); this.drop = null; }
    }
  }

  /** Take the Architect back aboard (the moon is leaving). */
  _recallArchitect() {
    const a = this.architect;
    if (a?.alive) {
      a.recalled = true;
      a.alive = false;
      a.bar?.group.removeFromParent();
      this.game.units.actors = this.game.units.actors.filter((x) => x !== a);
      this.game.units.selected = this.game.units.selected.filter((x) => x !== a);
    }
    if (this.drop) { this.drop.mesh.removeFromParent(); this.drop = null; }
    this.architect = null;
    this.archRespawn = 2;   // relaunched shortly after arriving
  }

  /** One planning step of the Architect. */
  _plan() {
    const game = this.game, planet = this.planet, arch = this.architect;
    // 1) keep working on anything unfinished or damaged on this planet
    const jobs = planet.bases.flatMap((b) => b.buildings)
      .filter((b) => b.alive && !b.planned && (!b.built || b.hp < b.maxHp - 0.5))
      .sort((x, y) => x.localPos.distanceTo(arch.local) - y.localPos.distanceTo(arch.local));
    if (jobs.length) {
      const job = jobs[0];
      if (arch.state !== 'build' || arch.task?.building !== job) arch.order({ kind: 'build', building: job });
      this.archStatus = `${job.built ? 'Repairing' : 'Building'} ${job.def.name}`;
      return;
    }
    if (!this.autoColonize) { this.archStatus = 'Auto-colonize off · standing by for repairs'; return; }
    // 2) no colony here yet → found one
    if (!planet.bases.length) { this._foundColony(); return; }
    // 3) a blueprint is still waiting for resources → wait for it
    const pending = planet.bases.flatMap((b) => b.buildings).find((b) => b.planned);
    if (pending) { this.archStatus = `Waiting for resources · ${pending.def.name} blueprint`; return; }
    // 4) next building of the starter plan
    const base = planet.bases
      .filter((b) => b.core)
      .sort((x, y) => x.core.localPos.distanceTo(arch.local) - y.core.localPos.distanceTo(arch.local))[0];
    if (!base) { this.archStatus = 'Standing by'; return; }
    const type = this._nextPlanItem(base);
    if (!type) {
      this.archStatus = `Colony ${base.number} on ${planet.name} is set up · standing by`;
      if (arch.state === 'idle' && arch.local.distanceTo(base.core.localPos) > 14) {
        const beside = base.grid.toDir(9, 0);
        arch.order({ kind: 'move', point: beside.multiplyScalar(planet.radius + planet.walkHeight(beside)) });
      }
      return;
    }
    const pl = this._findSite(base, type);
    if (!pl) { (base.asiSkip ??= new Set()).add(type); return; }   // no room for it here
    const b = game.placeBuilding(pl, planet, true);
    if (b) {
      this.archStatus = `Planned a ${b.def.name}`;
      game.hud.notify(`ASI Architect planned a ${b.def.name} · colony ${base.number}, ${planet.name}`, 'info');
    }
  }

  /** First building of the starter plan the colony still lacks (respecting repeats like 3 extractors). */
  _nextPlanItem(base) {
    const game = this.game, plan = CONFIG.techMoon.architect.buildPlan;
    const have = {};
    for (const b of base.buildings) have[b.type] = (have[b.type] || 0) + 1;
    const want = {};
    for (const type of plan) {
      want[type] = (want[type] || 0) + 1;
      const def = CONFIG.buildings[type];
      if (base.asiSkip?.has(type) || def.phase > CONFIG.phase) continue;
      if (def.requires && game.singularityChoice !== def.requires) continue;
      if ((have[type] || 0) < want[type]) return type;
    }
    return null;
  }

  _placementCtx(type, dir, heading) {
    const game = this.game, planet = this.planet;
    return {
      planet, type, rot: 0, cursorLocal: planet.surfacePoint(dir, new THREE.Vector3()), heading,
      inventory: game.inventory, costMult: game.modifiers.costMultiplier ?? 1,
      shipLocal: game.ship.landedPlanet === planet ? game.ship.position.clone().sub(planet.position) : null,
      singularity: game.singularityChoice, allowBlueprint: true,
    };
  }

  /** A valid spot for `type` inside the colony, searching outward in rings. */
  _findSite(base, type) {
    for (let r = 7; r <= CONFIG.base.buildRadius; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        const dir = base.grid.toDir(Math.cos(a + r) * r, Math.sin(a + r) * r);
        const pl = validatePlacement(this._placementCtx(type, dir, base.grid.north));
        if (pl.ok) return pl;
      }
    }
    return null;
  }

  /** Found a colony near the explorer (or under the moon). Waits for resources if needed. */
  _foundColony() {
    const game = this.game, planet = this.planet;
    const center = this._siteCenter();
    const t1 = anyPerpendicular(center, new THREE.Vector3()), t2 = new THREE.Vector3().crossVectors(center, t1);
    let short = null;
    for (let r = 12; r <= 72; r += 6) {          // start a little away from you / your ship
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const dir = center.clone().addScaledVector(t1, Math.cos(a) * r / planet.radius).addScaledVector(t2, Math.sin(a) * r / planet.radius).normalize();
        const pl = validatePlacement({ ...this._placementCtx('core', dir, t1), allowBlueprint: false });
        if (pl.ok) {
          const b = game.placeBuilding(pl, planet, true);
          if (b) {
            this.architect.order({ kind: 'build', building: b });
            this.archStatus = `Founding a colony on ${planet.name}`;
            game.hud.notify(`ASI Architect is founding a colony on ${planet.name}!`, 'tier');
          }
          return;
        }
        if (pl.reason.startsWith('Not enough')) short = pl.reason;
      }
    }
    this.archStatus = short ? `Waiting to found a colony · ${short}` : 'No valid colony site nearby';
  }

  // ============================================================ automation
  _automate() {
    const game = this.game, planet = this.planet, units = game.units;
    // 1) idle gatherers on this planet go back to work
    for (const u of units.actors) {
      if (u.faction !== 'player' || u.planet !== planet || !u.isGatherer || u.state !== 'idle') continue;
      const node = units.findNode(u, null);
      if (node) u.order({ kind: 'gather', node });
    }
    for (const base of planet.bases) {
      for (const b of base.buildings) {
        // 2) blueprints are paid for and started as soon as resources allow
        if (b.planned) {
          const cost = scaledCost(b.type, game.modifiers.costMultiplier);
          if (game.inventory.canAfford(cost)) {
            game.inventory.spend(cost);
            b.planned = false;
            game.hud.notify(`Tech Moon started building a ${b.def.name}`, 'info');
          }
          continue;
        }
        // 3) Auto-recruit keeps production buildings busy
        if (b.autoRecruit && b.built && b.def.trains && !b.queue.length) {
          const options = b.def.trains.filter((t) => !game.trainBlocker(b, t));
          if (options.length) game.trainUnit(b, options[(b.recruitIdx = ((b.recruitIdx ?? -1) + 1)) % options.length]);
        }
      }
    }
  }

  // ================================================================= panel
  /** HTML + live fields for the Tech Moon panel (M). */
  panel() {
    const game = this.game, S = this.stages;
    const here = game.focusPlanet;
    if (this.state === 'none') {
      const candidates = game.planets.filter((p) => p.bases.some((b) => b.core?.built));
      const why = game.aiTier < 3 ? 'Requires the ASI tier (Tier 3). Evolve the base AI first.' : null;
      const list = candidates.map((p) => `<button class="moon-btn" data-action="moon:start:${p.index}">BUILD ABOVE ${p.name.toUpperCase()}${p === here ? ' (here)' : ''}</button>`).join('');
      return {
        key: `none:${game.aiTier}:${candidates.length}`,
        html: `<div class="panel-title">TECH MOON</div>
          <p>A mobile artificial moon built by your ASI: beam cannons, passive resources, planetary automation and interplanetary travel.</p>
          ${S.map((s, i) => `<div class="info-row"><span>${i + 1}. ${s.name}</span><b>${costText(s.cost)}</b></div>`).join('')}
          <p class="moon-why">${why ?? (candidates.length ? 'Choose a planet with a Command Core to build above:' : 'Needs a planet with a finished Command Core.')}</p>
          ${why ? '' : list}
          <p class="small">Press M to close.</p>`,
      };
    }
    if (this.state === 'building') {
      const cur = S[this.stage];
      return {
        key: `building:${this.stage}`,
        html: `<div class="panel-title">TECH MOON · CONSTRUCTION · ${this.planet.name.toUpperCase()}</div>
          ${S.map((s, i) => `<div class="stage ${i < this.stage ? 'done' : i === this.stage ? 'current' : ''}">
            <span>${i < this.stage ? '✓' : i + 1}. ${s.name}</span><small>${costText(s.cost)} · ${s.time}s</small></div>`).join('')}
          <div class="bar"><div class="fill ai" data-f="progress"></div></div>
          <div class="info-status" data-f="status"></div>
          <p>${cur.desc}</p>
          <p class="small">Each stage is paid automatically when you have the resources. Press M to close.</p>`,
        fields: {
          progress: this.progress,
          status: this.waitingFor ? `Waiting for resources: ${this.waitingFor}` : `${cur.name} · ${Math.floor(this.progress * 100)}%`,
        },
      };
    }
    // complete
    const T = CONFIG.techMoon;
    const others = game.planets.filter((p) => p !== this.planet);
    const explorerAt = game.explorerPlanet;
    const summon = explorerAt && explorerAt !== this.planet
      ? `<button class="moon-btn summon" data-action="moon:travel:${explorerAt.index}">SUMMON HERE (N)<small>to ${explorerAt.name}, where you are</small></button>`
      : '';
    return {
      key: `complete:${this.planet?.index}:${!!this.travel}:${this.carryUnits}:${this.autoColonize}:${explorerAt?.index}`,
      html: `<div class="panel-title">TECH MOON · ONLINE</div>
        <div class="info-status" data-f="status"></div>
        <div class="info-row"><span>Beam cannons</span><b>${T.weapon.targets} × ${T.weapon.damage} dmg / ${T.weapon.cooldown}s</b></div>
        <div class="info-row"><span>Passive income</span><b>${Object.entries(T.income).map(([k, v]) => `+${v} ${RESOURCE_LABELS[k]}`).join(' · ')} / min</b></div>
        <p>Automation on the planet below: idle gatherers are put to work, <b>blueprints</b> are built when resources allow,
        <b>Auto-recruit</b> buildings keep training and construction is ${T.buildSpeedBonus}× faster.</p>
        <p>Tip: in build mode you can place buildings you can't afford yet — they become blueprints.</p>
        <div class="info-row"><span>Guardian drones</span><b>${T.guardians.count} × ${T.guardians.damage} dmg</b></div>
        <div class="info-row"><span>ASI Architect</span><b data-f="arch"></b></div>
        ${summon}
        <button class="moon-btn toggle ${this.autoColonize ? 'on' : ''}" data-action="moon:colonize">ARCHITECT AUTO-COLONIZE: ${this.autoColonize ? 'ON' : 'OFF'}<small>founds a colony and builds a starter base where the moon orbits</small></button>
        <button class="moon-btn toggle ${this.carryUnits ? 'on' : ''}" data-action="moon:carry">CARRY UNITS WHEN TRAVELLING: ${this.carryUnits ? 'ON' : 'OFF'}</button>
        <div class="panel-title" style="margin-top:10px">TRAVEL TO</div>
        <div class="moon-travel">${others.map((p) => `<button class="moon-btn" data-action="moon:travel:${p.index}">${p.name}<small>${p.biome.label}${p.bases.length ? ' · colony' : ''}${p.hostile ? ' · ⚠' : ''}</small></button>`).join('')}</div>
        <p class="small">Press M to close.</p>`,
      fields: {
        status: this.travel
          ? `Travelling to ${this.planet.name} · ${Math.ceil((1 - this.travel.t) * this.travel.duration)}s${this.cargo.length ? ` · ${this.cargo.length} units aboard` : ''}`
          : `In orbit above ${this.planet.name}${this.jamShown ? ` · ⚠ sensors jammed: ${this.jamShown} target${this.jamShown > 1 ? 's' : ''} hidden by a Resonance Veil` : ''}`,
        arch: this.travel ? 'Aboard the moon' : this.archStatus || '—',
      },
    };
  }

  /** Short status for the AI panel. */
  statusLine() {
    if (this.state === 'none') return 'Tech Moon available — press M';
    if (this.state === 'building') {
      const s = this.stages[this.stage];
      return `Tech Moon: ${s.name} (${this.stage + 1}/${this.stages.length}) ${this.waitingFor ? '· waiting for resources' : Math.floor(this.progress * 100) + '%'} — M`;
    }
    return this.travel ? `Tech Moon travelling to ${this.planet.name} — M` : `Tech Moon above ${this.planet.name} — M`;
  }

  // ========================================================== persistence
  serialize() {
    if (this.state === 'none') return null;
    return {
      state: this.state, stage: this.stage, progress: +this.progress.toFixed(4), paid: this.paid,
      planet: this.planet?.index ?? 0, angle: +this.angle.toFixed(3), carry: this.carryUnits,
      cargo: this.cargo, travelling: !!this.travel, autoColonize: this.autoColonize,
    };
  }

  deserialize(d) {
    this.reset();
    if (!d) return;
    Object.assign(this, { state: d.state, stage: d.stage, progress: d.progress, paid: d.paid, angle: d.angle, carryUnits: d.carry ?? true, autoColonize: d.autoColonize ?? true });
    this.planet = this.game.planets[d.planet] ?? this.game.planets[0];
    this.cargo = d.cargo || [];
    this.group.visible = true;
    this._placeInOrbit();
    if (this.cargo.length) this._beamDown(this.planet);   // a save during travel lands on arrival
  }
}

function costText(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${RESOURCE_LABELS[k]}`).join(', ');
}
