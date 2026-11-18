import * as THREE from 'three';
import { CONFIG, QUALITY, SHIPS, TRACKS, AI_ROSTER, DIFFICULTY, loadSettings } from './Config.js';
import { t, getLanguage, setLanguage } from './I18n.js';
import { EventBus, mulberry32, formatTime } from './Utils.js';
import { Track } from './Track.js';
import { Environment } from './Environment.js';
import { Ship } from './Ship.js';
import { setOutlineResolution } from './ShipModel.js';
import { PlayerShip } from './PlayerShip.js';
import { AIRacer } from './AIRacer.js';
import { CollisionSystem } from './CollisionSystem.js';
import { CameraController } from './CameraController.js';
import { Effects, PostFX } from './Effects.js';
import { AudioManager } from './AudioManager.js';
import { MusicManager } from './MusicManager.js';
import { InputManager } from './InputManager.js';
import { HUD } from './HUD.js';
import { Menu } from './Menu.js';

const State = Object.freeze({ MENU: 'menu', COUNTDOWN: 'countdown', RACING: 'racing', FINISHED: 'finished' });
const MAX_STEP = 1 / 90;
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.bus = new EventBus();
    this.settings = loadSettings();
    this.state = State.MENU;
    this.paused = false;
    this.time = 0;
    this.raceTime = 0;
    this.ships = [];
    this.ranking = [];
    this.player = null;
    this.showcase = null;
    this.track = null;
    this.environment = null;
    this.trackIndex = -1;
    this.shipIndex = 0;
    this.boostFx = 0;
    this.alarmTimer = 0;
    this.rechargeTimer = 0;
    this.wrongWayTimer = 0;
    this.resultsTimer = 0;
    this.resultsShown = false;
    this.countdown = 0;
    this.lastCount = '';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.baseFov, 1, 0.3, 5200);
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0x9a7dff, 0x1a0630, 1.1));
    this.sun = new THREE.DirectionalLight(0xffc9a0, 1.9);
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 10;
    sc.far = 320;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun, this.sun.target);

    this.input = new InputManager(this.bus);
    this.audio = new AudioManager(this.settings);
    this.music = new MusicManager(this.audio);
    this.music.play('menu');
    this.hud = new HUD();
    this.menu = new Menu(this.bus, this.settings);
    this.effects = new Effects(this.scene, this.camera);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.cameraCtl = new CameraController(this.camera);
    this.collisions = new CollisionSystem(this.bus);
    this.ctx = { track: null, ships: this.ships, player: null, input: this.input, raceTime: 0, laps: CONFIG.race.laps };

    this._bindEvents();
    this._resize();
    this.applySettings();
    this.loadTrack(0);
    this.setShowcase(0);
    this.menu.show('title');

    this._last = performance.now();
    this._loop = this._loop.bind(this);
  }

  start() {
    this.input.attach();
    requestAnimationFrame(this._loop);
  }

  // ---------------------------------------------------------------- eventos (registrados uma única vez)

  _bindEvents() {
    const bus = this.bus;
    window.addEventListener('resize', () => this._resize());
    const unlock = () => { this.audio.unlock(); this.music.start(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.inRace && !this.paused && this.state !== State.FINISHED) this.setPaused(true);
    });

    bus.on('menu:sound', (name) => this.audio.play(name));
    bus.on('menu:ship', (i) => this.setShowcase(i));
    bus.on('menu:track', (i) => { this.loadTrack(i); this.setShowcase(this.shipIndex); });
    bus.on('menu:start', ({ ship, track }) => { this.shipIndex = ship; this.loadTrack(track); this.startRace(); });
    bus.on('menu:resume', () => this.setPaused(false));
    bus.on('menu:restart', () => this.startRace());
    bus.on('menu:quit', () => this.quitToMenu());
    bus.on('settings:changed', () => this.applySettings());

    bus.on('input:pause', () => {
      if (!this.inRace || this.resultsShown) return;
      if (this.paused && this.menu.current !== 'pause') return this.menu.show('pause');
      this.setPaused(!this.paused);
    });
    bus.on('input:camera', () => {
      if (!this.inRace || this.paused) return;
      const mode = this.cameraCtl.nextMode();
      this.hud.message(t('msg.camera', { mode: t(`cam.${mode.id}`) }), { duration: 1 });
    });
    bus.on('input:reset', () => {
      const p = this.player;
      if (this.state !== State.RACING || this.paused || !p || p.destroyed || p.finished) return;
      p.v = 0;
      p.respawn(this.track, false);
    });

    bus.on('ship:collision', (e) => this._onCollision(e));
    bus.on('ship:destroyed', ({ ship }) => {
      this.effects.explosion(ship.position, ship.color);
      if (ship.isPlayer) {
        this.audio.play('explosion');
        this.cameraCtl.addShake(1.2);
        this.post.triggerFlash(0.6);
        this.hud.message(t('msg.destroyed'), { kind: 'bad', duration: 1.6 });
      } else if (this._near(ship, 150)) {
        this.audio.play('explosion', { minGap: 0.3 });
      }
    });
    bus.on('ship:fall', ({ ship }) => {
      if (!ship.isPlayer) return;
      this.audio.play('fall');
      this.hud.message(t('msg.fall'), { kind: 'bad', duration: 1.4 });
    });
    bus.on('ship:pad', ({ ship }) => {
      if (!ship.isPlayer) return;
      this.audio.play('pad');
      this.post.triggerFlash(0.3);
    });
    bus.on('ship:boost', ({ ship }) => { if (ship.isPlayer) this.audio.play('boost', { minGap: 0.25 }); });
    bus.on('ship:jump', ({ ship }) => { if (ship.isPlayer) this.audio.play('jump'); });
    bus.on('ship:land', ({ ship }) => {
      if (!ship.isPlayer) return;
      this.audio.play('land');
      this.cameraCtl.addShake(0.25);
    });
    bus.on('ship:checkpoint', ({ ship, index, time }) => {
      if (!ship.isPlayer) return;
      this.audio.play('checkpoint');
      this.hud.message(t('msg.checkpoint', { index, total: CONFIG.race.checkpointsPerLap - 1 }), { sub: formatTime(time), duration: 1.3 });
    });
    bus.on('ship:lap', (e) => this._onLap(e));
  }

  get inRace() { return this.state !== State.MENU; }

  _near(ship, dist) {
    return this.player && ship.position.distanceToSquared(this.player.position) < dist * dist;
  }

  _onCollision({ ship, intensity, side, kind, silent }) {
    const hw = CONFIG.physics.shipHalfWidth;
    _v.copy(ship.position).addScaledVector(ship.right, side * hw * (kind === 'ship' ? 0.6 : 1));
    _dir.copy(ship.forward).addScaledVector(ship.right, -side * 0.5);
    if (this._near(ship, 200)) this.effects.sparks(_v, _dir, intensity, kind === 'ship' ? 0xbfefff : 0xffc070);
    if (!ship.isPlayer || silent) return;
    if (kind === 'scrape') {
      this.audio.play('scrape', { minGap: 0.1 });
      return;
    }
    this.audio.play('collision', { intensity, minGap: 0.12 });
    this.cameraCtl.addShake(0.15 + intensity * 0.7);
  }

  _onLap({ ship, lap, time, best, finished }) {
    if (!ship.isPlayer) return;
    const laps = CONFIG.race.laps;
    if (finished) {
      this.audio.play('finish');
      this.state = State.FINISHED;
      this.resultsTimer = CONFIG.race.resultsDelay;
      const place = this._rank().indexOf(ship) + 1;
      this.hud.message(t('msg.finish'), { kind: 'final', sub: `${t('place', { n: place })} · ${formatTime(ship.finishTime)}`, duration: 3 });
      return;
    }
    this.audio.play('lap');
    if (best && lap > 1) this.hud.message(t('msg.bestLap'), { kind: 'best', sub: formatTime(time), duration: 2.2 });
    else this.hud.message(t('msg.lap', { lap }), { sub: formatTime(time), duration: 1.6 });
    if (lap === laps - 1) {
      this.hud.message(t('msg.finalLap'), { kind: 'final', duration: 2.6 });
      this.music.setTempoScale(1.07);
    }
  }

  // ---------------------------------------------------------------- configuração

  applySettings() {
    const s = this.settings;
    const q = QUALITY[s.quality];
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));

    const shadows = s.shadows;
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      this.sun.castShadow = shadows;
      this.scene.traverse((o) => { if (o.material && o.material.isMeshStandardMaterial) o.material.needsUpdate = true; });
    }

    const key = `${s.quality}|${r.getPixelRatio()}`;
    if (this._fxKey !== key) {
      this._fxKey = key;
      this.post.configure(q);
      this.effects.setQuality(q);
    }
    this._resize();
    this.audio.applyVolumes();
    if (s.language !== getLanguage()) this._applyLanguage();
  }

  _applyLanguage() {
    setLanguage(this.settings.language);
    this.menu.retranslate();
    if (this.player) {
      this.player.name = t('player.name');
      this.hud.refreshBoard();
    }
    // Os letreiros da pista são texturas: no menu, a pista é refeita no novo idioma;
    // durante a corrida, eles mudam na próxima vez que a pista for carregada.
    if (this.state === State.MENU && this.track) {
      this.loadTrack(this.trackIndex, true);
      this.setShowcase(this.shipIndex);
    }
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.effects.setViewport(h, pr);
    setOutlineResolution(w * pr, h * pr);
  }

  loadTrack(index, force = false) {
    if (this.trackIndex === index && this.track && !force) return;
    this.track?.dispose();
    this.environment?.dispose();
    const def = TRACKS[index];
    this.trackIndex = index;
    this.track = new Track(def, QUALITY[this.settings.quality]);
    this.environment = new Environment(def.palette, def.seed, def);
    this.scene.add(this.track.group, this.environment.group);
    this.scene.fog = new THREE.Fog(def.palette.fog, 260, 2300);
    this.scene.background = new THREE.Color(def.palette.fog);
    this.ctx.track = this.track;
    this.hud.buildMinimap(this.track);
    this.menu.setTrackLength(index, this.track.length);
    console.info(`[pista] ${def.name}`, this.track.stats());
  }

  setShowcase(index) {
    this.shipIndex = index;
    this._clearShowcase();
    if (this.state !== State.MENU) return;
    const def = SHIPS[index];
    this.showcase = new Ship({ id: 'showcase', name: def.name, def });
    this.showcase.placeOnGrid(this.track, this.track.length - 24, 0);
    this.scene.add(this.showcase.group);
  }

  _clearShowcase() {
    this.showcase?.dispose();
    this.showcase = null;
  }

  // ---------------------------------------------------------------- ciclo da corrida

  _clearShips() {
    this.effects.clearShips();
    for (const ship of this.ships) ship.dispose();
    this.ships.length = 0;
    this.ranking.length = 0;
    this.player = null;
    this.ctx.player = null;
  }

  startRace() {
    this.audio.unlock();
    this._clearShowcase();
    this._clearShips();

    const track = this.track;
    const rng = mulberry32((Date.now() & 0xffff) + 17);
    const total = CONFIG.race.racerCount;
    // A dificuldade é fixada na largada; mudanças feitas na pausa valem para a próxima corrida.
    this.raceDifficulty = this.settings.difficulty;
    const tuning = DIFFICULTY[this.raceDifficulty];
    AI_ROSTER.slice(0, total - 1).forEach((profile, i) => {
      const def = SHIPS.find((s) => s.id === profile.ship) || SHIPS[0];
      this.ships.push(new AIRacer({ id: `ai-${i}`, name: profile.name, def, color: profile.color, accent: profile.accent, bus: this.bus }, profile, rng, tuning));
    });
    const def = SHIPS[this.shipIndex];
    this.player = new PlayerShip({ id: 'player', name: t('player.name'), def, bus: this.bus });
    this.ships.push(this.player);
    this.ctx.player = this.player;

    // Grade de largada: adversários embaralhados, jogador na última fila.
    const slots = this.ships.map((_, i) => i);
    for (let i = slots.length - 2; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    this.ships.forEach((ship, i) => {
      const slot = track.gridSlot(ship.isPlayer ? total - 1 : slots[i]);
      ship.placeOnGrid(track, slot.s, slot.d);
      ship.updateVisual(0, 0, track);
      this.scene.add(ship.group);
      this.effects.attachShip(ship);
    });
    if (this.settings.shadows) this.scene.traverse((o) => { if (o.material?.isMeshStandardMaterial) o.material.needsUpdate = true; });

    this.raceTime = 0;
    this.ctx.raceTime = 0;
    this.boostFx = 0;
    this.wrongWayTimer = 0;
    this.resultsShown = false;
    this.countdown = 3;
    this.lastCount = '';
    this.state = State.COUNTDOWN;
    this.paused = false;
    this.audio.setPaused(false);
    this.audio.startEngine();
    this.music.play(TRACKS[this.trackIndex].id);
    this.input.captureKeys = true;

    this._rank();
    this.cameraCtl.snap(this.player);
    this.hud.reset(this.ships.length, CONFIG.race.laps);
    this.hud.show();
    this.menu.hide();
  }

  setPaused(paused) {
    if (!this.inRace || this.resultsShown) return;
    this.paused = paused;
    this.audio.setPaused(paused);
    if (paused) this.menu.show('pause');
    else this.menu.hide();
  }

  quitToMenu() {
    this.audio.setPaused(false);
    this.audio.stopEngine();
    this.music.play('menu');
    this._clearShips();
    this.state = State.MENU;
    this.paused = false;
    this.resultsShown = false;
    this.input.captureKeys = false;
    this.hud.hide();
    this.setShowcase(this.shipIndex);
    this.menu.show('title');
  }

  _rank() {
    const r = this.ranking;
    r.length = 0;
    for (const ship of this.ships) r.push(ship);
    r.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.totalDist - a.totalDist;
    });
    r.forEach((ship, i) => { ship.racePosition = i + 1; });
    return r;
  }

  _showResults() {
    this.resultsShown = true;
    const L = this.track.length;
    const goal = CONFIG.race.laps * L;
    const rows = this._rank().map((ship, i) => {
      const estimated = !ship.finished;
      const time = estimated ? this.raceTime + Math.max(0, goal - ship.totalDist) / 135 : ship.finishTime;
      return { position: i + 1, name: ship.name, ship: ship.def.name, time, best: ship.bestLap, estimated, isPlayer: ship.isPlayer };
    });
    this.hud.setLowEnergy(false);
    this.hud.setWrongWay(false);
    this.hud.clearMessages();
    this.menu.showResults(rows, this.player.racePosition, { track: TRACKS[this.trackIndex].name, difficulty: this.raceDifficulty });
  }

  // ---------------------------------------------------------------- loop principal

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    try {
      this._update(dt);
      this._render(dt);
    } catch (err) {
      if (!this._failed) {
        this._failed = true;
        console.error(err);
        this.bus.emit('game:error', err);
      }
    }
  }

  _update(dt) {
    this.input.update();
    if (this.paused) return;
    this.time += dt;
    this.track.update(dt);

    if (this.state === State.MENU) {
      if (this.showcase) {
        this.showcase.updateVisual(dt, this.time, this.track);
        this.cameraCtl.updateOrbit(dt, this.showcase.position, this.showcase.up);
        this._aimSun(this.showcase.position);
      }
      this.environment.update(this.camera, this.time);
      return;
    }

    if (this.state === State.COUNTDOWN) this._updateCountdown(dt);
    else this._simulate(dt);
    if (this.lastCount === 'go' && this.raceTime > 0.9) {
      this.lastCount = '';
      this.hud.setCountdown('');
    }

    const player = this.player;
    for (const ship of this.ships) ship.updateVisual(dt, this.time, this.track);
    this._rank();

    const boostTarget = player.boostActive && !player.destroyed ? 1 : 0;
    this.boostFx += (boostTarget - this.boostFx) * Math.min(1, dt * (boostTarget ? 6 : 2.5));

    this.cameraCtl.update(dt, player, this.track, this.boostFx);
    this.effects.update(dt, this.ships, this.boostFx, player.v);
    this.environment.update(this.camera, this.time);
    this._aimSun(player.position);
    this._feedback(dt);
    this.hud.update(dt, player, this.ranking, this.raceTime, CONFIG.race.laps);

    if (this.state === State.FINISHED && !this.resultsShown) {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) this._showResults();
    }
  }

  _updateCountdown(dt) {
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    const label = this.countdown > 0 ? String(Math.ceil(this.countdown)) : 'go';
    if (label !== this.lastCount) {
      this.lastCount = label;
      this.hud.setCountdown(label === 'go' ? t('hud.go') : label);
      this.audio.play(label === 'go' ? 'go' : 'count');
    }
    if (this.countdown <= 0 && before > 0) {
      this.state = State.RACING;
    }
  }

  _simulate(dt) {
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;
    const ctx = this.ctx;
    for (let i = 0; i < steps; i++) {
      this.raceTime += h;
      ctx.raceTime = this.raceTime;
      for (const ship of this.ships) ship.step(h, ship.getInput(ctx, h), ctx);
      this.collisions.update(this.ships, this.track, h);
    }
  }

  _feedback(dt) {
    const p = this.player;
    const speedN = Math.min(1.3, p.v / p.stats.maxSpeed);
    this.audio.updateEngine(p.destroyed ? 0 : speedN, p.throttle, p.boostActive);

    const racing = this.state === State.RACING;
    const low = racing && !p.destroyed && p.energyRatio < CONFIG.physics.lowEnergyRatio;
    this.hud.setLowEnergy(low);
    this.alarmTimer -= dt;
    if (low && this.alarmTimer <= 0) {
      this.alarmTimer = 0.85;
      this.audio.play('alarm');
    }

    this.rechargeTimer -= dt;
    if (p.recharging && this.rechargeTimer <= 0) {
      this.rechargeTimer = 0.22;
      this.audio.play('recharge');
    }

    const wrong = racing && p.v > 12 && Math.cos(p.phi) < -0.25;
    this.wrongWayTimer = wrong ? this.wrongWayTimer + dt : 0;
    this.hud.setWrongWay(this.wrongWayTimer > 0.8);
  }

  _aimSun(target) {
    this.sun.position.set(target.x + 50, target.y + 110, target.z - 90);
    this.sun.target.position.copy(target);
  }

  _render(dt) {
    const p = this.player;
    this.post.render(dt, {
      crt: this.settings.crt,
      boostFx: this.inRace ? this.boostFx : 0,
      speedN: this.inRace && p ? p.v / p.stats.maxSpeed : 0,
    });
  }
}
