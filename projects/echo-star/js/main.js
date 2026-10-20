/**
 * ECHO STAR — entry point.
 *
 * The Game class owns the renderer, the world (space + planets), the ship,
 * the player and the HUD, and runs a small state machine:
 *
 *   flight ──L──▶ landing ──▶ landed ──F──▶ walking
 *     ▲                         │  ▲           │
 *     └──── takeoff ◀────L──────┘  └─────F─────┘
 *                         landed / walking ──B──▶ build ──B──▶ back
 *
 * Phase 1: exploration core (fly, land, walk, harvest every resource type).
 * Phase 2: base building (build mode, grid placement, production economy).
 * Phase 3: units (train, select, command), alien nests, rogue AI raids, energy storage.
 * Phase 4: Data Center → Compute → AI tiers (AGI, Singularity with a chosen path).
 * Phase 5: ASI tier and the Tech Moon (orbital construction, weapons, automation, travel).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CONFIG } from './config.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Inventory, RESOURCE_LABELS } from './inventory.js';
import { SpaceEnvironment } from './space.js';
import { generateSolarSystem } from './planet.js';
import { ResourceField, AnimalHerd } from './resources.js';
import { Ship } from './ship.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Base, scaledCost, setAITierVisual } from './buildings.js';
import { BuildMode, STATE_LABEL } from './buildmode.js';
import { UnitManager } from './units.js';
import { EnemyDirector } from './enemies.js';
import { TechMoon } from './techmoon.js';
import { BroodDirector } from './brood.js';
import { getNav } from './navigation.js';
import { AudioSystem } from './audio.js';
import { WeatherParticles, CLOUD_FADE, setCloudShadows } from './planetfx.js';
import { saveGame, loadGame, clearSave } from './save.js';
import { TouchControls, applyTouchProfile } from './touch.js';
import { clamp, damp } from './utils.js';

const MODE = { FLIGHT: 'flight', LANDING: 'landing', LANDED: 'landed', TAKEOFF: 'takeoff', WALKING: 'walking', BUILD: 'build' };
const RES_COLORS = { crystals: '#6ff6ff', iron: '#c9d3dc', rock: '#d9b98f', food: '#9dff7a', energy: '#ffe14d', compute: '#c3a8ff' };

/** Which camera a mode uses — switching between kinds triggers a smooth blend. */
const cameraKind = (mode) => (mode === MODE.WALKING ? 'player' : mode === MODE.BUILD ? 'build' : 'ship');

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this._initRenderer();
    this.input = new Input(this.canvas);
    this.hud = new HUD();
    this.audio = new AudioSystem(this);
    this.hud.onNotify = (kind) => this.audio.notify(kind);
    this.hud.onTierUp = () => this.audio.play('tierUp');
    this.inventory = new Inventory(CONFIG.inventory.start);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = true;
    this.mode = MODE.FLIGHT;
    this.aiTier = 0;
    this.singularityChoice = null;     // 'swarm' | 'defense' | 'quantum' once chosen
    this.choosing = false;             // the Singularity picker is open (simulation paused)
    // Multipliers changed by AI tiers (and later the Tech Moon) — see _recomputeModifiers().
    this.modifiers = {};
    this._recomputeModifiers();
    this.buildReturn = MODE.WALKING;   // mode to go back to when leaving build mode
    this.lastPowerWarn = -999;
    this.harvest = { target: null, progress: 0 };
    this.dismantle = { target: null, progress: 0 };   // building being taken apart on foot (hold X)
    this.autosaveTimer = 0;
    this.pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };

    this._buildWorld();
    const save = loadGame();
    if (save) this.deserialize(save); else this.newGame();
    this._initMenu(!!save);
    // On-screen joystick / buttons / gestures for phones and tablets (js/touch.js).
    this.touch = new TouchControls(this);

    // Prime the camera so the first frame is already in place.
    this._cameraPose(0.016);
    this.camera.position.copy(this.pose.position);
    this.camera.lookAt(this.pose.target);

    window.addEventListener('beforeunload', () => this.save(true));
    document.getElementById('loading').classList.add('hidden');
    this._loop();
  }

  // ============================================================== setup
  _initRenderer() {
    const R = CONFIG.render;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, R.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = R.exposure;
    this.renderer.shadowMap.enabled = R.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(R.fov, window.innerWidth / window.innerHeight, R.near, R.far);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (R.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), R.bloomStrength, R.bloomRadius, R.bloomThreshold);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      if (!w || !h) return; // minimised / hidden window
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    });
  }

  _buildWorld() {
    this.space = new SpaceEnvironment(this.scene, CONFIG.seed, this.renderer);
    this.planets = generateSolarSystem(CONFIG.seed);
    for (const p of this.planets) {
      p.resources = new ResourceField(p);
      p.herd = new AnimalHerd(p);
      this.scene.add(p.group);
    }
    this.weather = new WeatherParticles(this.scene);
    this.ship = new Ship();
    this.scene.add(this.ship.group);
    this.player = new Player();
    this.player.group.visible = false;
    this.scene.add(this.player.group);
    this.rig = new CameraRig(this.camera);
    this.units = new UnitManager(this);
    this.enemies = new EnemyDirector(this);
    this.techMoon = new TechMoon(this);
    this.brood = new BroodDirector(this);
    this.energyCap = CONFIG.energy.baseCapacity;
    this.build = new BuildMode(this);
    this.hud.initBuildMenu((type) => {
      this.audio.play('select');
      this.build.setType(this.build.type === type ? null : type);
    });
    this.hud.onBuildAction = (action) => this._buildAction(action);
    const evolveBtn = document.getElementById('ai-evolve');
    evolveBtn.addEventListener('mousedown', (e) => e.preventDefault());
    evolveBtn.addEventListener('click', () => this.tryEvolve());

    // Pulsing ring that marks the current harvest target.
    const ringGeo = new THREE.RingGeometry(0.95, 1.15, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0x6ff6ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);
  }

  _initMenu(hasSave) {
    const overlay = document.getElementById('overlay');
    const play = document.getElementById('btn-play');
    const fresh = document.getElementById('btn-new');
    play.textContent = hasSave ? 'Continue' : 'Launch';
    play.addEventListener('click', () => this.resume());
    let confirmNew = false;
    fresh.addEventListener('click', () => {
      if (!confirmNew) {
        confirmNew = true;
        fresh.textContent = 'Click again to confirm';
        setTimeout(() => { confirmNew = false; fresh.textContent = 'New Game'; }, 3000);
        return;
      }
      confirmNew = false;
      fresh.textContent = 'New Game';
      clearSave();
      this.newGame();
      this.resume();
    });
    this.overlay = overlay;

    // Clicking the canvas grabs the mouse; losing pointer lock pauses.
    // Build mode needs a free cursor, so it never grabs the mouse.
    this.canvas.addEventListener('click', () => {
      if (!this.paused && !this.input.locked && this.mode !== MODE.BUILD) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (locked) this._hadLock = true;
      else if (this._releasingLock) {
        this._releasingLock = false;   // we released it on purpose (entering build mode)
        this._hadLock = false;
      } else {
        this._lockLostAt = performance.now();
        if (this._hadLock && !this.paused) this.pause();
      }
    };
    // Esc toggles pause when pointer lock is not in use (with lock, the browser
    // releases the mouse on Esc and the lock-change handler above pauses).
    // In build mode Esc cancels / exits instead (handled by BuildMode).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || this.input.locked) return;
      if (this.hud.moonPanelOpen && !this.paused) {
        this.toggleMoonPanel(false);
        this.input.pressed.delete('Escape');   // don't also cancel / leave build mode
        return;
      }
      if (this.mode === MODE.BUILD && !this.paused) return;
      if (performance.now() - (this._lockLostAt || 0) < 400) return;
      if (this.paused) this.resume(); else this.pause();
    });
  }

  pause() {
    this.paused = true;
    this._hadLock = false;
    this.overlay.classList.remove('hidden');
    document.getElementById('btn-play').textContent = 'Continue';
    this.save(true);
  }

  resume() {
    this.audio.unlock();
    document.activeElement?.blur?.();   // a volume slider must not keep the keyboard
    this.paused = false;
    this.overlay.classList.add('hidden');
    this.hud.show();
    if (this.mode !== MODE.BUILD) this.input.requestLock();
    this.clock.getDelta();
  }

  // ========================================================== new / save
  newGame() {
    if (this.mode === MODE.BUILD) this.exitBuildMode();
    this.inventory.reset(CONFIG.inventory.start);
    for (const p of this.planets) {
      for (const b of [...p.bases]) b.destroy();
      p.resetTerrain();
      p.decor.restoreFlora();
      p.resources.reset();
    }
    const home = this.planets[0];
    // Start in orbit on the sunlit side of the home planet, facing it.
    const dir = this.space.sunDir.clone().add(new THREE.Vector3(0.3, 0.35, 0.2)).normalize();
    const pos = home.position.clone().addScaledVector(dir, home.radius + 190);
    this.ship.placeInSpace(pos, home.position);
    this.ship.fuel = CONFIG.ship.fuelMax;
    this.player.group.visible = false;
    this.player.planet = null;
    this.player.hp = CONFIG.player.hp;
    this.units.clear();
    this.enemies.reset();
    this.brood.reset();
    this.aiTier = 0;
    this.singularityChoice = null;
    this.choosing = false;
    document.getElementById('choice').classList.add('hidden');
    this._recomputeModifiers();
    this.techMoon.reset();
    this.hud.showMoonPanel(false);
    this._setMode(MODE.FLIGHT, false);
    this.time = 0;
    this.hud.notify(`Welcome, Commander. Fly to ${home.name} and press L to land.`, 'tier');
  }

  serialize() {
    let mode = this.mode;
    if (mode === MODE.LANDING || mode === MODE.TAKEOFF) mode = MODE.FLIGHT;
    if (mode === MODE.BUILD) mode = this.buildReturn;
    return {
      version: CONFIG.version,
      seed: CONFIG.seed,
      time: this.time,
      mode,
      inventory: this.inventory.toJSON(),
      aiTier: this.aiTier,
      singularity: this.singularityChoice,
      ship: this.ship.serialize(),
      player: mode === MODE.WALKING ? this.player.serialize() : null,
      planets: this.planets.map((p) => p.resources.serialize()),
      bases: this.planets.flatMap((p) => p.bases.map((b) => b.serialize())),
      units: this.units.serialize(),
      enemies: this.enemies.serialize(),
      techMoon: this.techMoon.serialize(),
      brood: this.brood.serialize(),
      suit: Math.round(this.player.hp),
    };
  }

  deserialize(d) {
    try {
      this.inventory.fromJSON(d.inventory);
      this.time = d.time || 0;
      this.aiTier = d.aiTier || 0;
      this.singularityChoice = CONFIG.singularity[d.singularity] ? d.singularity : null;
      this._recomputeModifiers();
      if (this.aiTier >= 2 && !this.singularityChoice) setTimeout(() => this._openSingularityChoice(), 0);
      d.planets?.forEach((pd, i) => this.planets[i]?.resources.deserialize(pd));
      for (const bd of d.bases || []) {
        const planet = this.planets[bd.planet];
        if (planet && planet.bases.length < CONFIG.base.maxCoresPerPlanet) Base.deserialize(planet, bd);
      }
      this.units.clear();
      this.units.deserialize(d.units, this.planets);
      this.enemies.deserialize(d.enemies);
      this.enemies.setupNests();   // nests are regenerated (away from your colonies)
      this.brood.deserialize(d.brood);
      this.techMoon.deserialize(d.techMoon);
      this.player.hp = d.suit ?? CONFIG.player.hp;
      const s = d.ship;
      const pos = new THREE.Vector3().fromArray(s.pos);
      const quat = new THREE.Quaternion().fromArray(s.quat);
      this.ship.fuel = s.fuel ?? CONFIG.ship.fuelMax;
      const landedPlanet = this.planets[s.landed];
      if (landedPlanet && (d.mode === MODE.LANDED || d.mode === MODE.WALKING)) {
        this.ship.setLanded(landedPlanet, pos, quat);
        if (d.mode === MODE.WALKING && d.player) {
          this.player.spawn(landedPlanet, new THREE.Vector3().fromArray(d.player.pos), new THREE.Vector3().fromArray(d.player.forward));
          this._setMode(MODE.WALKING, false);
        } else {
          this._setMode(MODE.LANDED, false);
        }
      } else {
        this.ship.placeInSpace(pos, pos.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(quat)));
        this.ship.quaternion.copy(quat);
        this.ship.camQuat.copy(quat);
        this._setMode(MODE.FLIGHT, false);
      }
      this.hud.notify('Progress loaded.', 'info');
    } catch (err) {
      console.warn('Bad save, starting fresh', err);
      this.newGame();
    }
  }

  save(silent = false) {
    if (saveGame(this.serialize()) && !silent) this.hud.notify('Game saved', 'info');
  }

  // =============================================================== modes
  _setMode(mode, transition = true) {
    const prev = this.mode;
    if (prev === MODE.WALKING && mode !== MODE.WALKING) {
      this.autoWalk = null;
      this.player.planet?.decor.setGhosted([]);
      this._setDismantleTarget(null);
    }
    this.mode = mode;
    if (transition && cameraKind(prev) !== cameraKind(mode)) this.rig.startTransition();
    // The astronaut stays visible in build mode if they were on foot.
    this.player.group.visible = mode === MODE.WALKING || (mode === MODE.BUILD && this.buildReturn === MODE.WALKING);
    this._clearHarvest();
  }

  // ======================================================== AI evolution
  /** Rebuild every gameplay modifier from the current AI tier and Singularity path. */
  _recomputeModifiers() {
    const m = { gatherSpeed: 1, gatherYield: 1, production: 1, buildSpeed: 1, costMultiplier: 1, damage: 1, unitSpeed: 1, autoRepair: null };
    for (let t = 1; t <= this.aiTier; t++) {
      for (const [k, v] of Object.entries(CONFIG.aiTiers[t]?.bonus || {})) m[k] *= v;
    }
    const path = this.aiTier >= 2 ? CONFIG.singularity[this.singularityChoice] : null;
    if (path) {
      if (path.unitSpeed) m.unitSpeed *= path.unitSpeed;
      if (path.costMultiplier) m.costMultiplier *= path.costMultiplier;
      if (path.repairPerSec) m.autoRepair = { rate: path.repairPerSec, delay: path.repairDelay };
    }
    this.modifiers = m;
    setAITierVisual(this.aiTier);
  }

  get hasDataCenter() {
    return this.planets.some((p) => p.bases.some((b) => b.buildings.some((x) => x.type === 'datacenter' && x.built)));
  }

  /** Each requirement of the next AI tier: [{ key, label, have, need, ok }]. */
  evolveRequirements() {
    const next = CONFIG.aiTiers[this.aiTier + 1];
    if (!next) return [];
    const req = { compute: next.compute, ...next.cost };
    return Object.entries(req).map(([k, need]) => {
      const have = Math.floor(this.inventory.get(k));
      return { key: k, label: RESOURCE_LABELS[k], have, need, ok: have >= need };
    });
  }

  /** "15 Crystals" style list of what is still missing for the next tier. */
  evolveMissingText() {
    return this.evolveRequirements().filter((r) => !r.ok).map((r) => `${r.need - r.have} ${r.label}`).join(', ');
  }

  /** Why the AI can't evolve right now, or null when it can. */
  evolveBlocker() {
    const next = CONFIG.aiTiers[this.aiTier + 1];
    if (!next) return 'Maximum tier reached';
    if ((next.phase ?? 0) > CONFIG.phase) return `${next.name} unlocks in Phase ${next.phase}`;
    if (this.aiTier >= 2 && !this.singularityChoice) return 'Choose a Singularity path first';
    const missing = this.evolveMissingText();
    if (missing) return `still missing ${missing}`;
    return null;
  }

  tryEvolve() {
    const why = this.evolveBlocker();
    if (why) { this.hud.notify(`Cannot evolve yet: ${why}`, 'warn'); return; }
    const next = CONFIG.aiTiers[this.aiTier + 1];
    this.inventory.add('compute', -next.compute);
    this.inventory.spend(next.cost);
    this.aiTier++;
    this._recomputeModifiers();
    this.hud.showTierUp(`TIER ${this.aiTier} · ${next.name.toUpperCase()}`, next.desc);
    this.hud.notify(`Base AI evolved to ${next.name}!`, 'tier');
    if (this.aiTier === 2) this._openSingularityChoice();
    this.save(true);
  }

  /** Pause and let the player pick a Singularity path. */
  _openSingularityChoice() {
    this.choosing = true;
    if (this.input.locked) { this._releasingLock = true; this.input.exitLock(); }
    this.hud.showChoice(CONFIG.singularity, (key) => {
      this.singularityChoice = key;
      this.choosing = false;
      this._recomputeModifiers();
      const path = CONFIG.singularity[key];
      this.hud.showTierUp(path.name.toUpperCase(), path.desc);
      this.hud.notify(`Singularity path chosen: ${path.name}`, 'tier');
      if (this.mode !== MODE.BUILD) this.input.requestLock();
      this.clock.getDelta();
      this.save(true);
    });
  }

  // ============================================================ Tech Moon
  /**
   * The planet the explorer is on or near (for summoning the Tech Moon):
   * on foot / in build mode → that planet, landed → the landing planet,
   * flying → the nearest planet if within 600 m of its surface.
   */
  get explorerPlanet() {
    if (this.mode === MODE.WALKING) return this.player.planet;
    if (this.mode === MODE.BUILD) return this.build.planet;
    if (this.ship.landedPlanet) return this.ship.landedPlanet;
    if (this.ship.anim?.planet) return this.ship.anim.planet;
    const near = this.nearestPlanet(this.ship.position);
    return near.altitude < 600 ? near.planet : null;
  }

  /** N: call the Tech Moon to the explorer's planet. */
  summonTechMoon() {
    this.techMoon.summonTo(this.explorerPlanet);
  }

  /** M opens / closes the Tech Moon panel (frees the mouse so its buttons can be clicked). */
  toggleMoonPanel(force) {
    const open = force ?? !this.hud.moonPanelOpen;
    if (open && this.aiTier < 3 && this.techMoon.state === 'none') {
      this.hud.notify('The Tech Moon unlocks at AI tier ASI (Tier 3).', 'warn');
      return;
    }
    this.hud.showMoonPanel(open);
    this.audio.play(open ? 'open' : 'close');
    if (open) {
      this.hud.setMoonPanel(this.techMoon.panel());
      if (this.input.locked) { this._releasingLock = true; this.input.exitLock(); }
    } else if (this.mode !== MODE.BUILD) {
      this.input.requestLock();
    }
  }

  _moonAction(cmd, arg) {
    const moon = this.techMoon;
    if (cmd === 'start') moon.startProject(this.planets[+arg]);
    else if (cmd === 'travel') moon.travelTo(this.planets[+arg]);
    else if (cmd === 'carry') moon.carryUnits = !moon.carryUnits;
    else if (cmd === 'colonize') moon.autoColonize = !moon.autoColonize;
  }

  // ---------------------------------------------------------- build mode
  enterBuildMode() {
    const walking = this.mode === MODE.WALKING;
    const planet = walking ? this.player.planet : this.ship.landedPlanet;
    if (!planet) return;
    this.buildReturn = this.mode;
    const focus = walking ? this.player.position : this.ship.position;
    const heading = walking ? this.player.camForward : this.ship.forward(new THREE.Vector3());
    this.build.enter(planet, focus, heading);
    if (this.input.locked) { this._releasingLock = true; this.input.exitLock(); }
    this._setMode(MODE.BUILD);
    this.audio.play('open');
    this.hud.setPrompt(null);
    this.hud.showBuildUI(true);
    if (!planet.bases.length) this.hud.notify('Build mode: place a Command Core (key 1) to found your colony.', 'tier');
  }

  exitBuildMode() {
    this.build.exit();
    this.hud.showBuildUI(false);
    this.audio.play('close');
    this._setMode(this.buildReturn || MODE.WALKING);
    this.input.requestLock();
  }

  /** Pay for and start constructing a building from a valid placement. */
  placeBuilding(pl, planet = this.build.planet, quiet = false) {
    // Blueprints (Tech Moon) are placed without paying — the moon pays when it can.
    if (!pl.blueprint && !this.inventory.spend(pl.cost)) return null;
    // A Command Core founds a new colony; everything else joins the colony it was placed in.
    const base = pl.base || new Base(planet, pl.grid);
    const b = base.add(pl.type, pl.i0, pl.j0, pl.rot, pl.blueprint ? { planned: true } : null, pl.node || null);
    if (this.build.selected) this.build.select(null);
    if (!quiet) {
      this.audio.play('place', { at: b.localPos.clone().add(planet.position) });
      const name = b.def.name;
      this.hud.notify(b.type === 'core'
        ? `Command Core under construction — colony ${base.number}/${CONFIG.base.maxCoresPerPlanet} on ${planet.name}.`
        : pl.blueprint ? `Blueprint placed: ${name} — the Tech Moon will build it.` : `Construction started: ${name}`, 'info');
    }
    return b;
  }

  demolishSelected() {
    if (this.build.selected) this.demolish(this.build.selected);
  }

  /** Resources returned when a building is taken down (full while still under construction). */
  refundFor(b) {
    if (b.planned) return {};   // blueprints were never paid for
    const share = b.built ? CONFIG.base.demolishRefund : 1;
    const cost = scaledCost(b.type, this.modifiers.costMultiplier);
    return Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.floor(v * share)]));
  }

  /** A Command Core can only go once the rest of its colony is gone. */
  canDemolish(b) {
    return !(b.type === 'core' && b.base.buildings.length > 1);
  }

  /**
   * Take a building down and refund part of its cost.
   * Used by the build-mode Demolish button and by dismantling on foot.
   */
  demolish(b) {
    const base = b.base;
    if (!this.canDemolish(b)) {
      this.hud.notify('Dismantle every other building of this colony before its Command Core.', 'warn');
      return false;
    }
    if (this.build.selected === b) this.build.select(null);
    if (this.dismantle.target === b) this.dismantle = { target: null, progress: 0 };
    const refund = this.refundFor(b);
    for (const [k, v] of Object.entries(refund)) this.inventory.add(k, v);
    // Units still waiting in its training queue are fully refunded.
    for (const job of b.queue) for (const [k, v] of Object.entries(CONFIG.units[job.type].cost)) this.inventory.add(k, v);
    const text = Object.entries(refund).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${RESOURCE_LABELS[k]}`).join('  ');
    if (text) this.hud.spawnFloater(text, b.localPos.clone().add(b.planet.position).addScaledVector(b.dir, 3), '#ffd36a');
    this.audio.play('dismantle', { at: b.localPos.clone().add(b.planet.position) });
    base.remove(b);
    if (!base.buildings.length) base.destroy();
    const pct = Math.round((b.built ? CONFIG.base.demolishRefund : 1) * 100);
    this.hud.notify(`${b.def.name} dismantled — ${pct}% of its cost recovered`, 'success');
    return true;
  }

  /** Called by a Building when construction finishes. */
  onBuildingComplete(b) {
    this.hud.notify(b.type === 'core'
      ? `Command Core online — base AI initialised on ${b.planet.name}.`
      : `${b.def.name} online on ${b.planet.name}`, 'success');
  }

  /** Called by a Building every time it produces resources. */
  onProduce(b, item, amount) {
    if (b.def.cycle < 3) return; // the core's trickle would spam the screen
    const world = b.localPos.clone().add(b.planet.position);
    if (world.distanceTo(this.camera.position) > 140) return;
    world.addScaledVector(b.dir, b.model.height + 2);
    const n = amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10;
    this.hud.spawnFloater(`+${n} ${RESOURCE_LABELS[item]}`, world, RES_COLORS[item]);
  }

  /** Planet whose surface is closest to a world position. */
  nearestPlanet(pos) {
    let best = null, bestAlt = Infinity;
    for (const p of this.planets) {
      const alt = pos.distanceTo(p.position) - p.radius;
      if (alt < bestAlt) { bestAlt = alt; best = p; }
    }
    return { planet: best, altitude: bestAlt };
  }

  /** Planet the action currently happens on / near. */
  get focusPlanet() {
    if (this.mode === MODE.BUILD) return this.build.planet;
    if (this.mode === MODE.WALKING) return this.player.planet;
    if (this.ship.landedPlanet) return this.ship.landedPlanet;
    if (this.ship.anim?.planet) return this.ship.anim.planet;
    return this.nearestPlanet(this.ship.position).planet;
  }

  get focusPosition() {
    if (this.mode === MODE.BUILD) return this.pose.target;
    return this.mode === MODE.WALKING ? this.player.position : this.ship.position;
  }

  // ================================================================ loop
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.touch.update(dt);   // feeds touch input into this.input before the game reads it
    if (!this.paused && !this.choosing) this._update(dt);
    this.audio.update(dt, this.paused || this.choosing);
    if (window.innerWidth && window.innerHeight) this.composer.render();
    this.input.endFrame();
  }

  _update(dt) {
    const input = this.input;
    this.time += dt;
    if (input.wasPressed('KeyH')) this.hud.toggleHelp();
    if (input.wasPressed('KeyU')) this.tryEvolve();
    if (input.wasPressed('KeyM')) this.toggleMoonPanel();
    if (input.wasPressed('KeyN')) this.summonTechMoon();
    if (input.wasPressed('KeyK')) this.audio.toggleMute();
    this.ship.animateLights(dt);

    switch (this.mode) {
      case MODE.FLIGHT: this._updateFlight(dt); break;
      case MODE.LANDING:
        if (this.ship.updateLanding(dt)) {
          this._setMode(MODE.LANDED);
          this.audio.play('touchdown', { at: this.ship.position });
          this.hud.notify(`Touchdown on ${this.ship.landedPlanet.name}. Press F to step outside.`, 'success');
        }
        break;
      case MODE.LANDED: this._updateLanded(dt); break;
      case MODE.TAKEOFF:
        if (this.ship.updateTakeoff(dt)) this._setMode(MODE.FLIGHT);
        break;
      case MODE.WALKING: this._updateWalking(dt); break;
      case MODE.BUILD: this.build.update(dt); break;
    }

    // --- world simulation: only the planet we are near needs live animals,
    // but every colony keeps producing wherever the player is.
    const focus = this.focusPlanet;
    this._updateEnergyCap();
    let unpowered = false;
    for (const p of this.planets) {
      p.update(dt, this.time, this.camera.position);
      p.resources.update(dt);
      for (const base of p.bases) {
        base.update(dt, this);
        if (base.buildings.some((b) => b.built && !b.powered)) unpowered = true;
      }
    }
    if (unpowered && this.time - this.lastPowerWarn > 30) {
      this.lastPowerWarn = this.time;
      this.hud.notify('Energy depleted — buildings offline. Build a Power Generator and feed it crystals.', 'warn');
    }
    if (focus && this.focusPosition.distanceTo(focus.position) < focus.radius * 3) {
      const playerLocal = this.player.group.visible && this.player.planet === focus ? this.player.position.clone().sub(focus.position) : null;
      focus.herd.update(dt, playerLocal);
    }

    // --- Phase 3: units, enemies, raids, suit regeneration
    this.astronautTarget;            // refresh the astronaut's position for enemy targeting
    this.units.update(dt);
    this.enemies.update(dt);
    this.brood.update(dt);
    this.techMoon.update(dt);
    if (this.hud.moonPanelOpen) this.hud.setMoonPanel(this.techMoon.panel());
    if (this.time - this.player.lastHit > CONFIG.player.regenDelay) {
      this.player.hp = Math.min(CONFIG.player.hp, this.player.hp + CONFIG.player.regenRate * dt);
    }
    // energy storage limit (core trickle, generators)
    if (this.inventory.get('energy') > this.energyCap) this.inventory.items.energy = this.energyCap;

    this._cameraPose(dt);
    this.rig.apply(this.pose, dt);
    const fovTarget = CONFIG.render.fov + (this.mode === MODE.FLIGHT ? clamp(this.ship.speed / (CONFIG.ship.maxSpeed * CONFIG.ship.boostMultiplier), 0, 1) * CONFIG.ship.speedFovBoost : 0);
    this.camera.fov = damp(this.camera.fov, fovTarget, 3, dt);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const camPlanet = this.nearestPlanet(this.camera.position).planet;
    this.space.update(dt, this.camera, this.focusPosition, camPlanet, this.mode === MODE.FLIGHT ? this.ship.speed : 0);
    this.weather.update(dt, this.camera, camPlanet, this.space, this.renderer);
    // Clouds near the camera fade out — from much farther in the high build-mode view.
    CLOUD_FADE.value = this.mode === MODE.BUILD ? this.build.zoom * 1.1 + 12 : CONFIG.fx.cloudFadeNear;
    setCloudShadows(this.mode !== MODE.BUILD);
    this._updateHUD(dt);

    this.autosaveTimer += dt;
    if (this.autosaveTimer > CONFIG.save.autosaveSeconds && [MODE.FLIGHT, MODE.LANDED, MODE.WALKING, MODE.BUILD].includes(this.mode)) {
      this.autosaveTimer = 0;
      this.save(true);
    }
  }

  /** Energy storage: a little by default, more for every finished Command Core and Power Generator. */
  _updateEnergyCap() {
    const E = CONFIG.energy;
    let cap = E.baseCapacity;
    for (const p of this.planets) for (const base of p.bases) for (const b of base.buildings) {
      if (!b.built) continue;
      if (b.type === 'core') cap += E.perCore;
      if (b.type === 'power') cap += E.perGenerator;
    }
    this.energyCap = cap;
  }

  // ------------------------------------------------------------ combat
  /** The astronaut as something enemies can target (null when not on foot). */
  get astronautTarget() {
    if (!this.player.group.visible || !this.player.planet) return null;
    const t = (this._astro ??= {
      radius: 0.5, flying: false, local: new THREE.Vector3(), alive: true, isAstronaut: true,
      takeDamage: (amount) => this.damagePlayer(amount),
    });
    t.planet = this.player.planet;
    t.local.copy(this.player.position).sub(t.planet.position);
    t.alive = this.player.hp > 0 && this.player.group.visible;
    return t;
  }

  damagePlayer(amount) {
    const pl = this.player;
    if (pl.hp <= 0 || this.paused) return;
    pl.hp -= amount;
    pl.lastHit = this.time;
    this.hud.flashHurt();
    this.audio.play('hurt');
    if (pl.hp > 0) return;
    this.audio.play('teleport');
    // Suit breached: recovered at the ship, full health.
    pl.hp = CONFIG.player.hp;
    if (this.mode === MODE.BUILD) this.exitBuildMode();
    this.hud.notify('Suit breached! Emergency teleport back to your ship.', 'warn');
    if (this.ship.landedPlanet) {
      const right = this.ship.right(new THREE.Vector3());
      const fwd = this.ship.forward(new THREE.Vector3());
      this.player.spawn(this.ship.landedPlanet, this.ship.position.clone().addScaledVector(right, 4.5).addScaledVector(fwd, 1.5), fwd);
      this.rig.startTransition(0.6);
    }
  }

  /** The astronaut's blaster fires automatically at the nearest hostile in range. */
  _updateBlaster(dt) {
    const pl = this.player, B = CONFIG.player.blaster;
    pl.fireCooldown -= dt;
    if (pl.fireCooldown > 0) return;
    const local = pl.position.clone().sub(pl.planet.position);
    // Keep shooting the same enemy while it lives and stays in range (focus fire).
    let t = pl.blasterTarget;
    if (!t || !t.alive || t.planet !== pl.planet || t.local.distanceTo(local) - t.radius > B.range) {
      t = pl.blasterTarget = this.units.nearestEnemyTo(pl.planet, local, B.range);
    }
    if (!t) return;
    pl.fireCooldown = B.cooldown;
    const from = pl.position.clone().addScaledVector(pl.up, 1.3);
    this.units.spawnBolt('player', from, t.worldPos.addScaledVector(t.dir, t.flying ? 0 : 0.6), 'blaster');
    t.takeDamage(B.damage * (this.modifiers.damage ?? 1), this, this.astronautTarget);
  }

  onBuildingDestroyed(b) {
    const base = b.base;
    this.audio.play('bigExplosion', { at: b.localPos.clone().add(b.planet.position) });
    if (this.build.selected === b) this.build.select(null);
    if (this.dismantle.target === b) this.dismantle = { target: null, progress: 0 };
    if (b.type === 'core') {
      this.hud.notify(`Colony ${base.number} on ${b.planet.name} has fallen — its Command Core was destroyed!`, 'warn');
      base.destroy();
    } else {
      this.hud.notify(`${b.def.name} destroyed on ${b.planet.name}!`, 'warn');
      base.remove(b);
      if (!base.buildings.length) base.destroy();
    }
  }

  /** A building is being shot: idle defenders nearby rally to it, and the player is warned. */
  onBuildingAttacked(b, source) {
    if ((b._rallyAt ?? -9) > this.time - 1) return;   // at most once per second per building
    b._rallyAt = this.time;
    for (const u of this.units.actors) {
      if (u.faction !== 'player' || u.planet !== b.planet || !u.hasWeapon) continue;
      if (u.state !== 'idle' && !(u.state === 'attack' && u.task?.auto && !u.task.target?.alive)) continue;
      if (u.local.distanceTo(b.localPos) > CONFIG.unitRules.defendRadius) continue;
      u.order({ kind: 'attack', target: source, auto: true, origin: u.local.clone() });
    }
    if (this.time - (this._attackWarnAt ?? -99) > 25) {
      this._attackWarnAt = this.time;
      this.hud.notify(`${b.def.name} under attack on ${b.planet.name}, colony ${b.base.number}!`, 'warn');
    }
  }

  onActorKilled(a) {
    // (raiders that withdraw are removed with health left: no explosion)
    if (a.hp <= 0 && a.structure) this.audio.play('bigExplosion', { at: a.worldPos, pitch: 1.2 });
    else if (a.hp <= 0) this.audio.play('explosion', { at: a.worldPos, pitch: a.def.radius >= 0.9 ? 0.75 : a.flying ? 1.25 : 1 });
    if (a.faction === 'enemy') {
      const world = a.worldPos.addScaledVector(a.dir, 1.5);
      if (world.distanceTo(this.camera.position) < 120) this.hud.spawnFloater(`${a.def.name} destroyed`, world, '#ff8a8a');
    }
  }

  onUnitDelivered(a, item, amount) {
    const world = a.worldPos.addScaledVector(a.dir, 2);
    this.audio.play('pickup', { at: world });
    if (world.distanceTo(this.camera.position) < 120) this.hud.spawnFloater(`+${amount} ${RESOURCE_LABELS[item]}`, world, RES_COLORS[item]);
  }

  // --------------------------------------------------------- training
  /**
   * Unit limit shared by all unit types: grows by perCoreBonus (33.3%) of the
   * base limit for every finished Command Core, on any planet.
   */
  get unitCap() {
    const R = CONFIG.unitRules;
    let cores = 0;
    for (const p of this.planets) for (const b of p.bases) if (b.core?.built) cores++;
    return Math.min(R.hardCap, Math.round(R.baseUnits * (1 + R.perCoreBonus * cores)));
  }

  /** Why a unit can't be queued right now (or null if it can). */
  trainBlocker(b, type) {
    const u = CONFIG.units[type];
    if (u.tier > this.aiTier) return `Requires AI tier ${CONFIG.aiTiers[u.tier].name}`;
    if (!b.built) return 'Building not finished';
    if (b.queue.length >= CONFIG.unitRules.queueMax) return 'Queue full';
    // units already alive + units waiting in every queue must fit under the limit
    let queued = 0;
    for (const p of this.planets) for (const base of p.bases) for (const x of base.buildings) queued += x.queue?.length ?? 0;
    if (this.units.playerCount() + queued >= this.unitCap) {
      return this.unitCap >= CONFIG.unitRules.hardCap
        ? `Unit limit reached (${this.unitCap})`
        : `Unit limit reached (${this.unitCap}) — another Command Core raises it`;
    }
    if (!this.inventory.canAfford(u.cost)) return 'Not enough resources';
    return null;
  }

  trainUnit(b, type) {
    const why = this.trainBlocker(b, type);
    if (why) { this.hud.notify(`${CONFIG.units[type].name}: ${why}`, 'warn'); return; }
    this.inventory.spend(CONFIG.units[type].cost);
    b.queue.push({ type, t: 0 });
  }

  cancelTraining(b, index) {
    const job = b.queue[index];
    if (!job) return;
    for (const [k, v] of Object.entries(CONFIG.units[job.type].cost)) this.inventory.add(k, v);
    b.queue.splice(index, 1);
  }

  /** Buttons in the build-mode info panel. */
  _buildAction(action) {
    const [cmd, arg] = action.split(':');
    const b = this.build.selected;
    this.audio.play('click');
    if (cmd === 'demolish') this.demolishSelected();
    else if (cmd === 'evolve') this.tryEvolve();
    else if (cmd === 'moon') this._moonAction(...action.split(':').slice(1));
    else if (cmd === 'autorecruit' && b) b.autoRecruit = !b.autoRecruit;
    else if (cmd === 'train' && b) this.trainUnit(b, arg);
    else if (cmd === 'cancel' && b) this.cancelTraining(b, +arg);
    else if (cmd === 'stop') for (const u of this.units.selected) u.order(null);
    else if (cmd === 'gather') {
      for (const u of this.units.selected) {
        if (!u.isGatherer) continue;
        const node = this.units.findNode(u, null);
        if (node) u.order({ kind: 'gather', node });
      }
    }
  }

  _cameraPose(dt) {
    if (this.mode === MODE.WALKING) this.player.getCameraPose(this.pose, dt);
    else if (this.mode === MODE.BUILD) this.build.getCameraPose(this.pose);
    else this.ship.getCameraPose(dt, this.mode === MODE.LANDED, this.pose);
  }

  // ------------------------------------------------------------ flight
  _updateFlight(dt) {
    const near = this.nearestPlanet(this.ship.position);
    const altitude = this.ship.updateFlight(dt, this.input, near.planet);
    this.flightAltitude = altitude;
    // The Tech Moon (with its ring) is solid: push the ship out.
    if (this.techMoon.state !== 'none') {
      const minD = CONFIG.techMoon.radius * 1.7;
      const off = this.ship.position.clone().sub(this.techMoon.position);
      const d = off.length();
      if (d < minD) {
        off.divideScalar(d || 1);
        this.ship.position.copy(this.techMoon.position).addScaledVector(off, minD);
        const inward = this.ship.velocity.dot(off);
        if (inward < 0) this.ship.velocity.addScaledVector(off, -inward);
      }
    }
    if (altitude < CONFIG.ship.landingRange) {
      this.hud.setPrompt(`[L] Land on ${near.planet.name}`);
      if (this.input.wasPressed('KeyL')) {
        this.ship.startLanding(near.planet);
        this._setMode(MODE.LANDING);
        this.audio.play('landing', { at: this.ship.position });
        this.hud.notify(`Landing sequence engaged — ${near.planet.name}`, 'info');
      }
    } else {
      this.hud.setPrompt(null);
    }
    if (performance.now() - this.ship.lastScrape < 100) this.audio.play('scrape', { at: this.ship.position });
    if (performance.now() - this.ship.lastScrape < 100 && !this._scrapeWarned) {
      this._scrapeWarned = true;
      this.hud.notify('Hull scraping terrain! Pull up.', 'warn');
      setTimeout(() => { this._scrapeWarned = false; }, 4000);
    }
    if (this.ship.fuel <= 0 && !this._fuelWarned) {
      this._fuelWarned = true;
      this.hud.notify('Fuel depleted — emergency thrusters only. Land to refuel.', 'warn');
    }
    if (this.ship.fuel > 5) this._fuelWarned = false;
  }

  _updateLanded(dt) {
    this.ship.updateLanded(dt, this.input);
    this.hud.setPrompt('[F] Step outside   ·   [L] Take off   ·   [B] Build');
    if (this.input.wasPressed('KeyB')) this.enterBuildMode();
    else if (this.input.wasPressed('KeyF')) this._exitShip();
    else if (this.input.wasPressed('KeyL')) {
      this.audio.play('takeoff', { at: this.ship.position });
      this.ship.startTakeoff();
      this._setMode(MODE.TAKEOFF);
    }
  }

  _exitShip() {
    const planet = this.ship.landedPlanet;
    // Step out beside the right wing, looking forward and slightly away from the ship.
    const right = this.ship.right(new THREE.Vector3());
    const fwd = this.ship.forward(new THREE.Vector3());
    const spawn = this.ship.position.clone().addScaledVector(right, 4.5).addScaledVector(fwd, 1.5);
    this.player.spawn(planet, spawn, fwd.addScaledVector(right, 0.5));
    this._setMode(MODE.WALKING);
    this.audio.play('hatch', { at: this.ship.position });
  }

  // ----------------------------------------------------------- walking
  _updateWalking(dt) {
    const planet = this.player.planet;
    if (this.input.wasPressed('KeyB')) { this.enterBuildMode(); return; }
    if (this.input.wasPressed('KeyG')) this.toggleAutoWalk();
    const holdingE = this.input.isDown('KeyE');
    const holdingX = this.input.isDown('KeyX');
    this.player.action = (holdingE && this.harvest.target) || (holdingX && this.dismantle.target) ? 'harvest' : null;
    const autoDir = this._autoWalkDir(dt);
    this.player.update(dt, this.input, [{ pos: this.ship.position, r: CONFIG.player.shipCollisionRadius }], autoDir);
    this._updateBlaster(dt);

    const shipDist = this.player.position.distanceTo(this.ship.position);
    const nearShip = shipDist < CONFIG.player.boardRange;
    if (nearShip && this.input.wasPressed('KeyF')) {
      this.audio.play('hatch', { at: this.ship.position });
      this.player.group.visible = false;
      this._setMode(MODE.LANDED);
      this.hud.setPrompt(null);
      return;
    }

    // --- find the closest harvest target (node or animal)
    const local = this.player.position.clone().sub(planet.position);
    const range = CONFIG.player.interactRange;
    const node = planet.resources.findNearest(local, range + 0.8);
    const animal = planet.herd.findNearest(local, range);
    let target = null;
    if (node && (!animal || node.dist <= animal.dist)) target = { kind: 'node', node: node.node, pos: node.node.pos };
    else if (animal) target = { kind: 'animal', animal: animal.animal, pos: animal.animal.pos };

    // Switching target resets progress.
    const prev = this.harvest.target;
    const same = prev && target && (prev.node === target.node && prev.animal === target.animal);
    if (!same) this._clearHarvest();
    this.harvest.target = target;

    // --- nearby structure that can be dismantled (hold X)
    const struct = this._updateDismantle(dt, planet, holdingX);
    const extras = [];
    if (this.autoWalk) extras.push(`Auto-walking to ship · ${Math.round(shipDist)} m · [G] stop`);
    if (struct) extras.push(struct.label);
    if (nearShip) extras.push('[F] Board ship');
    const shipHint = extras.length ? '   ·   ' + extras.join('   ·   ') : '';
    const structProgress = struct && holdingX ? struct.progress : -1;
    if (!target) {
      this.targetRing.visible = false;
      this.hud.setPrompt(extras.length ? extras.join('   ·   ') : null, structProgress);
      return;
    }

    // --- prompt text + ring marker
    let label, time;
    if (target.kind === 'node') {
      const def = CONFIG.resources.types[target.node.type];
      label = `[Hold E] Harvest ${def.label} (${target.node.amount} left)`;
      time = def.harvestTime;
    } else {
      label = `[Hold E] Capture ${target.animal.species.name}`;
      time = CONFIG.animals.captureTime;
    }
    if (holdingE) {
      if (target.kind === 'animal') planet.herd.setCapturing(target.animal, true);
      this.harvest.progress += (dt * this.modifiers.gatherSpeed) / time;
      if (this.harvest.progress >= 1) {
        this.harvest.progress = 0;
        this._completeHarvest(planet, target);
      }
    } else if (this.harvest.progress > 0) {
      this._clearHarvest();
      this.harvest.target = target;
    }
    if (this.harvest.target) this._placeRing(planet, target.pos, target.kind === 'animal' ? 0xffd36a : 0x6ff6ff);
    this.hud.setPrompt(label + shipHint, holdingE ? this.harvest.progress : structProgress);
  }

  // ------------------------------------------------- ship locator / auto-walk
  /** G: walk automatically to the landed ship (press again — or move — to stop). */
  toggleAutoWalk() {
    if (this.autoWalk) { this._stopAutoWalk('Auto-walk stopped.'); return; }
    if (this.ship.landedPlanet !== this.player.planet) {
      this.hud.notify('Your ship is not on this planet.', 'warn');
      return;
    }
    if (this.player.position.distanceTo(this.ship.position) < CONFIG.player.boardRange) {
      this.hud.notify('You are already at your ship — press F to board.', 'info');
      return;
    }
    this.autoWalk = { path: null, idx: 0, repathT: 0 };
    this.hud.notify('Ship locator on — walking to your ship (G or WASD to stop).', 'info');
  }

  _stopAutoWalk(message = null, kind = 'info') {
    this.autoWalk = null;
    if (message) this.hud.notify(message, kind);
  }

  /** Direction (world, tangent) the astronaut should walk this frame, or null. */
  _autoWalkDir(dt) {
    const aw = this.autoWalk;
    if (!aw) return null;
    const pl = this.player, planet = pl.planet;
    if (Player.manualMove(this.input)) { this._stopAutoWalk('Auto-walk stopped.'); return null; }
    if (this.ship.landedPlanet !== planet) { this._stopAutoWalk('Your ship left this planet.', 'warn'); return null; }
    if (pl.position.distanceTo(this.ship.position) < CONFIG.player.boardRange - 1) {
      this._stopAutoWalk('Arrived at your ship — press F to board.', 'success');
      return null;
    }
    // Route over dry land (same path-finding as the units), refreshed every 2 s.
    const nav = getNav(planet);
    const from = pl.position.clone().sub(planet.position).normalize();
    const to = this.ship.position.clone().sub(planet.position).normalize();
    aw.repathT -= dt;
    if (aw.repathT <= 0) {
      aw.repathT = 2;
      aw.path = nav.lineClear(from, to) ? null : nav.findPath(from, to, THREE.Vector3);
      aw.idx = 0;
    }
    let aim = to;
    if (aw.path) {
      while (aw.idx < aw.path.length - 1 && from.angleTo(aw.path[aw.idx]) * planet.radius < 2) aw.idx++;
      aim = aw.path[aw.idx];
    }
    return aim.clone().multiplyScalar(planet.radius + planet.walkHeight(aim)).add(planet.position).sub(pl.position);
  }

  // ------------------------------------------------------- dismantling
  /** Closest building whose footprint edge is within reach of the astronaut. */
  _nearestStructure(planet) {
    const reach = CONFIG.base.dismantleRange;
    const p = new THREE.Vector3();
    let best = null, bestD = reach;
    for (const base of planet.bases) {
      for (const b of base.buildings) {
        if (b.localPos.distanceTo(p.copy(this.player.position).sub(planet.position)) > 12) continue;
        b.group.updateWorldMatrix(true, false);
        b.group.worldToLocal(p.copy(this.player.position));
        const [fw, fh] = b.footprintSize;
        const d = Math.hypot(Math.max(Math.abs(p.x) - fw / 2, 0), Math.max(Math.abs(p.z) - fh / 2, 0));
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    return best;
  }

  /** Highlight the building in reach (selection box + health bar). */
  _setDismantleTarget(b) {
    if (this.dismantle.target === b) return;
    if (this.dismantle.target && this.build.selected !== this.dismantle.target) this.dismantle.target.setSelected(false);
    this.dismantle = { target: b, progress: 0 };
    if (b) b.setSelected(true);
  }

  /** Hold X next to a building to take it apart and recover part of its cost. */
  _updateDismantle(dt, planet, holding) {
    this._setDismantleTarget(this._nearestStructure(planet));
    const b = this.dismantle.target;
    if (!b) return null;
    if (!this.canDemolish(b)) {
      this.dismantle.progress = 0;
      return { label: `${b.def.name}: dismantle this colony's other buildings first`, progress: -1 };
    }
    const refund = Object.entries(this.refundFor(b)).filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${RESOURCE_LABELS[k]}`).join(', ');
    const label = `[Hold X] Dismantle ${b.def.name}${refund ? ` (+${refund})` : ''}`;
    if (!holding) { this.dismantle.progress = 0; return { label, progress: 0 }; }
    this.dismantle.progress += dt / CONFIG.base.dismantleTime;
    if (this.dismantle.progress >= 1) {
      this.demolish(b);
      return null;
    }
    return { label, progress: this.dismantle.progress };
  }

  _completeHarvest(planet, target) {
    const world = target.pos.clone().add(planet.position);
    const up = target.pos.clone().normalize();
    world.addScaledVector(up, 2);
    if (target.kind === 'node') {
      const def = CONFIG.resources.types[target.node.type];
      planet.resources.harvest(target.node, 1);
      const gained = Math.round(def.yield * this.modifiers.gatherYield);
      this.inventory.add(def.item, gained);
      this.audio.play('collect_' + target.node.type);
      this.hud.spawnFloater(`+${gained} ${RESOURCE_LABELS[def.item]}`, world, RES_COLORS[def.item]);
      if (target.node.amount <= 0) {
        this.hud.notify(`${def.label} depleted`, 'info');
        this._clearHarvest();
      }
    } else {
      planet.herd.capture(target.animal);
      this.audio.play('collect_animal');
      const gained = Math.round(CONFIG.animals.foodYield * target.animal.species.food * this.modifiers.gatherYield);
      this.inventory.add('food', gained);
      this.hud.spawnFloater(`+${gained} Food`, world, RES_COLORS.food);
      this.hud.notify(`Captured a ${target.animal.species.name}!`, 'success');
      this._clearHarvest();
    }
  }

  _clearHarvest() {
    const t = this.harvest.target;
    if (t && t.kind === 'animal' && t.animal.alive) this.focusPlanet?.herd.setCapturing(t.animal, false);
    this.harvest.target = null;
    this.harvest.progress = 0;
    if (this.targetRing) this.targetRing.visible = false;
  }

  _placeRing(planet, localPos, color) {
    const up = localPos.clone().normalize();
    this.targetRing.position.copy(localPos).add(planet.position).addScaledVector(up, 0.12);
    this.targetRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const s = 1.3 + Math.sin(this.time * 6) * 0.12;
    this.targetRing.scale.setScalar(s);
    this.targetRing.material.color.set(color);
    this.targetRing.visible = true;
  }

  // ---------------------------------------------------------------- HUD
  _updateHUD(dt) {
    const hud = this.hud;
    hud.updateResources(this.inventory, this.energyCap);
    hud.setAlert(this.enemies.alertText() ?? this.brood.alertText());
    // AI panel: what is needed for the next tier.
    const hasColony = this.planets.some((p) => p.bases.some((b) => b.core));
    const next = CONFIG.aiTiers[this.aiTier + 1];
    const why = this.evolveBlocker();
    let note = null;
    if (!hasColony && this.techMoon.state === 'none') note = 'No colony yet — land, press B and place a Command Core.';
    else if (!next) note = `ASI online · ${this.techMoon.statusLine()}`;
    else if ((next.phase ?? 0) > CONFIG.phase) note = `Next: ${next.name} — arrives in Phase ${next.phase}`;
    else if (!this.hasDataCenter && this.inventory.get('compute') < next.compute) note = `Build a Data Center (key 9) to generate Compute for ${next.name}.`;
    else if (!why) note = `${next.name} ready! Press U or click EVOLVE.`;
    else {
      // e.g. "Next: AGI · Compute ✓ · Crystals 45/60 ✗ · Iron ✓ — missing 15 Crystals"
      const parts = this.evolveRequirements().map((r) => (r.ok ? `${r.label} ✓` : `${r.label} ${r.have}/${r.need} ✗`));
      note = `Next: ${next.name} · ${parts.join(' · ')}${why ? ' — ' + why : ''}`;
    }
    if (this.singularityChoice) note += ` · Path: ${CONFIG.singularity[this.singularityChoice].name}`;
    hud.updateAI(this.aiTier, this.inventory.get('compute'), note);
    hud.setEvolveReady(!why && !this.choosing);

    const focus = this.focusPlanet;
    const ship = this.ship;
    let location = 'Deep Space', info = '';
    if (this.mode === MODE.WALKING) {
      location = focus.name;
      info = `${focus.biome.label} world${this._threatTag(focus)} · Ship ${Math.round(this.player.position.distanceTo(ship.position))} m away`;
    } else if (ship.landedPlanet) {
      location = ship.landedPlanet.name;
      info = `${ship.landedPlanet.biome.label} world · Landed · Refuelling`;
    } else if (focus) {
      const alt = this.nearestPlanet(ship.position).altitude;
      location = alt < 600 ? focus.name : 'Deep Space';
      info = alt < 600 ? `${focus.biome.label} world${this._threatTag(focus)} · Altitude ${Math.round(Math.max(0, alt))} m` : `Nearest: ${focus.name} (${(alt / 1000).toFixed(1)} km)`;
    }
    hud.updateFlight({
      speed: this.mode === MODE.WALKING ? 0 : ship.velocity.length(),
      maxSpeed: CONFIG.ship.maxSpeed * CONFIG.ship.boostMultiplier,
      fuel: ship.fuel, location, info, suit: this.player.hp / CONFIG.player.hp,
    });

    const modeNames = { flight: 'FLIGHT', landing: 'LANDING', landed: 'LANDED', takeoff: 'TAKE-OFF', walking: 'ON FOOT', build: 'BUILD MODE' };
    hud.setMode(modeNames[this.mode]);
    const hints = {
      flight: 'W/S throttle · Mouse or A/D steer · ↑/↓ pitch · Q/E roll · Space/C rise/sink · Shift boost · H help',
      landing: 'Autopilot landing…',
      landed: 'F step outside · L take off · B build mode · Drag/mouse to orbit camera · H help',
      takeoff: 'Lifting off…',
      walking: 'WASD move · Shift run · Space jump · Hold E harvest/capture · Hold X dismantle · G walk to ship · F board ship · B build mode · H help',
      build: '1–9 build · Click/drag select units · Right-click order · R rotate · WASD pan · Q/E rotate · Wheel zoom · Tab next colony · B exit',
    };
    if (this.mode === MODE.BUILD) this._updateBuildUI();
    const moonHint = this.techMoon.complete && hints[this.mode].includes('H help') ? ' · M moon panel · N summon moon' : '';
    hud.setHints(hints[this.mode] + moonHint);
    hud.setCrosshair(this.mode === MODE.FLIGHT);
    if (this.mode === MODE.LANDING || this.mode === MODE.TAKEOFF) hud.setPrompt(null);
    // Planet markers in flight (+ the Tech Moon once it exists).
    const markers = [...this.planets, ...this.brood.markers()];
    if (this.techMoon.state !== 'none') markers.push({ position: this.techMoon.position, radius: CONFIG.techMoon.radius, name: 'Tech Moon' });
    hud.updateMarkers(markers, this.camera, ship.position, this.mode === MODE.FLIGHT);
    // Ship locator while on foot: when the ship is far away or auto-walk is on.
    const onFootHere = this.mode === MODE.WALKING && ship.landedPlanet === this.player.planet;
    const shipDist = onFootHere ? this.player.position.distanceTo(ship.position) : 0;
    const shipTop = ship.position.clone().addScaledVector(this.player.up, 3);
    hud.updateShipMarker(this.camera, shipTop, `${this.autoWalk ? 'AUTO · ' : ''}SHIP · ${Math.round(shipDist)} m`,
      onFootHere && (shipDist > 15 || !!this.autoWalk), !!this.autoWalk);
    hud.updateFloaters(dt, this.camera);
  }

  /** " · ⚠ hostile fauna" / " · ☣ Brood hive" for the location panel. */
  _threatTag(planet) {
    const brood = this.brood.planet === planet && this.brood.alive;
    return (planet.hostile ? ' · ⚠ hostile fauna' : '') + (brood ? (this.brood.state === 'awake' ? ' · ☣ Brood hive' : ' · ☣ sealed chrysalis') : '');
  }

  /** Build menu affordability + the info panel (selected building or colony overview). */
  _updateBuildUI() {
    const hud = this.hud, build = this.build, bases = build.bases;
    const maxCores = CONFIG.base.maxCoresPerPlanet;
    hud.updateBuildMenu(build.type, this.inventory, this.modifiers.costMultiplier, this.singularityChoice);
    const fmtRate = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(v && Math.abs(v) < 10 ? 1 : 0) + ' / min';

    // ---- selected units
    const sel = this.units.selected.filter((a) => a.alive);
    if (sel.length) {
      const counts = {};
      for (const a of sel) counts[a.def.name] = (counts[a.def.name] || 0) + 1;
      const list = Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join(' · ');
      const orders = {};
      for (const a of sel) orders[STATE_LABEL[a.state]] = (orders[STATE_LABEL[a.state]] || 0) + 1;
      const hp = sel.reduce((s, a) => s + a.hp, 0), max = sel.reduce((s, a) => s + a.def.hp, 0);
      const gatherers = sel.some((a) => a.isGatherer);
      hud.setBuildInfo('units:' + list, `
        <div class="panel-title">${sel.length} UNIT${sel.length > 1 ? 'S' : ''} SELECTED</div>
        <p><b>${list}</b></p>
        <div class="info-row"><span>Health</span><b data-f="hpText"></b></div>
        <div class="bar"><div class="fill hp" data-f="hp"></div></div>
        <div class="info-row"><span>Orders</span><b data-f="orders"></b></div>
        <p>Right-click: <b>ground</b> move · <b>resource</b> gather · <b>unfinished / damaged building</b> build or repair · <b>enemy</b> attack.</p>
        <div class="btn-row"><button data-action="stop">STOP</button>${gatherers ? '<button data-action="gather">GATHER NEAREST</button>' : ''}</div>`, {
        hpText: `${Math.round(hp)} / ${max}`,
        hp: hp / max,
        orders: Object.entries(orders).map(([n, c]) => `${c} ${n.toLowerCase()}`).join(', '),
      });
      return;
    }

    const b = build.selected;
    if (b) {
      const d = b.def;
      b.uid ??= Math.random().toString(36).slice(2);
      // Production buildings: train buttons + queue.
      const costText = (cost) => Object.entries(cost).map(([k, v]) => `${v} ${RESOURCE_LABELS[k]}`).join(' · ');
      const training = d.trains ? `
        <div class="train-row">${d.trains.map((t) => `<button class="train" data-action="train:${t}" data-train="${t}" title="${CONFIG.units[t].desc}">
          ${CONFIG.units[t].name}<span>${costText(CONFIG.units[t].cost)} · ${CONFIG.units[t].time}s</span></button>`).join('')}</div>
        <div class="bar"><div class="fill cycle" data-f="qbar"></div></div>
        <div class="queue">${Array.from({ length: CONFIG.unitRules.queueMax }, (_, i) => `<button class="qslot" data-action="cancel:${i}" data-f="q${i}" title="Click to cancel (full refund)"></button>`).join('')}</div>
        ${this.techMoon.automates(b.planet) ? `<button class="moon-btn toggle ${b.autoRecruit ? 'on' : ''}" data-action="autorecruit">TECH MOON AUTO-RECRUIT: ${b.autoRecruit ? 'ON' : 'OFF'}</button>` : ''}` : '';
      // Data Center / Command Core: AI evolution requirements + button.
      const nextTier = CONFIG.aiTiers[this.aiTier + 1];
      const showEvo = (b.type === 'datacenter' || b.type === 'core') && nextTier && (nextTier.phase ?? 0) <= CONFIG.phase;
      const evolution = showEvo ? `
        <div class="evo">
          <div class="panel-title">AI EVOLUTION · NEXT: ${nextTier.name.toUpperCase()}</div>
          ${this.evolveRequirements().map((r) => `<div class="info-row"><span>${r.label}</span><b data-f="req-${r.key}"></b></div>`).join('')}
          <button class="evo-btn" data-action="evolve" data-f="evoBtn"></button>
        </div>` : '';
      const out = Object.entries(b.outputs()).map(([k, v]) => `+${v} ${RESOURCE_LABELS[k]}`).join(', ');
      const inp = Object.entries(d.input).map(([k, v]) => `${v} ${RESOURCE_LABELS[k]}`).join(', ');
      const prod = d.cycle > 0 ? `${inp ? inp + ' → ' : ''}${out} every ${d.cycle}s` : '';
      const html = `
        <div class="panel-title">${d.name.toUpperCase()} · COLONY ${b.base.number}</div>
        <div class="info-status" data-f="status"></div>
        <div class="info-row"><span>Health</span><b data-f="hpText"></b></div>
        <div class="bar"><div class="fill hp" data-f="hp"></div></div>
        ${d.cycle > 0 ? `<div class="info-row"><span>Production</span><b>${prod}</b></div>
          <div class="bar"><div class="fill cycle" data-f="cycle"></div></div>` : ''}
        ${d.upkeep ? `<div class="info-row"><span>Upkeep</span><b>−${d.upkeep} Energy / s</b></div>` : ''}
        <p>${d.desc}</p>
        ${training}
        ${evolution}
        <button class="danger" data-action="demolish">DEMOLISH</button>`;
      const fields = {
        status: b.status,
        hpText: `${Math.round(b.hp)} / ${b.maxHp}`,
        hp: b.hp / b.maxHp,
        cycle: b.built ? b.cycleProgress : b.progress,
      };
      if (showEvo) {
        for (const r of this.evolveRequirements()) fields['req-' + r.key] = r.ok ? `${r.have} / ${r.need} ✓` : `${r.have} / ${r.need} ✗ (need ${r.need - r.have} more)`;
        const why = this.evolveBlocker();
        fields.evoBtn = why ? `EVOLVE — ${why}` : `EVOLVE TO ${nextTier.name.toUpperCase()} (U)`;
      }
      if (d.trains) {
        const job = b.queue[0];
        fields.qbar = job ? job.t / CONFIG.units[job.type].time : 0;
        for (let i = 0; i < CONFIG.unitRules.queueMax; i++) fields['q' + i] = b.queue[i] ? `✕ ${CONFIG.units[b.queue[i].type].name}` : '';
      }
      hud.setBuildInfo(`b:${b.uid}:${this.aiTier}:${b.autoRecruit}:${b.planned}:${this.techMoon.automates(b.planet)}`, html, fields);
      hud.build.info.querySelector('.evo-btn')?.classList.toggle('ready', !this.evolveBlocker());
      // grey out units that can't be trained right now
      for (const btn of hud.build.info.querySelectorAll('[data-train]')) {
        const why = this.trainBlocker(b, btn.dataset.train);
        btn.classList.toggle('locked', !!why && why.startsWith('Requires'));
        btn.classList.toggle('short', why === 'Not enough resources');
        btn.title = why ? `${CONFIG.units[btn.dataset.train].desc} — ${why}` : CONFIG.units[btn.dataset.train].desc;
      }
      return;
    }

    if (!bases.length) {
      hud.setBuildInfo('nobase', `
        <div class="panel-title">NEW COLONY</div>
        <p>Choose the <b>Command Core</b> (key <b>1</b>) and place it on flat, dry ground.
        It houses the base AI and is required for every other building.</p>
        <p>Rotate with <b>R</b> — the core's orientation sets the colony grid.</p>
        <p>Each planet supports up to <b>${maxCores} Command Cores</b>, so you can found outposts next to distant resources.</p>`);
      return;
    }

    // Planet-wide overview: every colony's production summed.
    const rates = {};
    const counts = {};
    for (const base of bases) {
      for (const [k, v] of Object.entries(base.rates(this))) rates[k] = (rates[k] || 0) + v;
      for (const x of base.buildings) counts[x.def.name] = (counts[x.def.name] || 0) + 1;
    }
    // Unit upkeep on this planet (food for humans, energy for robots / drones).
    const here = this.units.playerUnits.filter((a) => a.planet === build.planet);
    for (const a of here) {
      rates.food = (rates.food || 0) - (a.def.foodPerMin || 0);
      rates.energy = (rates.energy || 0) - (a.def.energyPerSec || 0) * 60;
    }
    const list = Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join(' · ');
    const keys = ['energy', 'food', 'crystals', 'iron', 'rock'];
    const unitsLine = `<div class="info-row"><span>Units here / total</span><b data-f="units"></b></div>`
      + `<div class="info-row"><span>Energy storage</span><b data-f="cap"></b></div>`;
    const slots = bases.length < maxCores
      ? `You can found ${maxCores - bases.length} more colon${maxCores - bases.length > 1 ? 'ies' : 'y'} here (key <b>1</b>, at least ${CONFIG.base.minCoreSpacing} m apart).`
      : 'All Command Core slots on this planet are in use.';
    hud.setBuildInfo('base:' + list, `
      <div class="panel-title">${build.planet.name.toUpperCase()} · CORES ${bases.length} / ${maxCores}</div>
      <p>${list}</p>
      ${keys.map((k) => `<div class="info-row"><span>${RESOURCE_LABELS[k]}</span><b data-f="${k}"></b></div>`).join('')}
      ${unitsLine}
      <p>${slots}</p>
      <p>Click a building to inspect it · click / drag to select units · <b>Tab</b> jumps between colonies.</p>`,
    {
      ...Object.fromEntries(keys.map((k) => [k, fmtRate(rates[k] || 0)])),
      units: `${here.length} / ${this.units.playerCount()} (max ${this.unitCap})`,
      cap: `${Math.floor(this.inventory.get('energy'))} / ${this.energyCap}`,
    });
  }
}

// Boot once fonts/DOM are ready.
window.addEventListener('DOMContentLoaded', () => {
  try {
    applyTouchProfile();   // lighter graphics on phones / tablets (before the renderer exists)
    window.game = new Game();
  } catch (err) {
    console.error(err);
    document.getElementById('loading').textContent = 'Failed to start: ' + err.message;
  }
});
