/**
 * Touch controls for phones and tablets.
 *
 * Adds an on-screen joystick, context buttons and gestures ON TOP of the normal
 * keyboard + mouse input — it never replaces them. On a tablet with a keyboard
 * both work at the same time (W/A/S/D on the keyboard, drag on the screen to
 * look around, tap to build). It works by feeding the existing Input object, so
 * the rest of the game doesn't need to know about touch at all:
 *
 *   - buttons and the stick press / release key codes (input.keys / pressed),
 *   - dragging adds to input.mouse.dx / dy, exactly like moving the mouse,
 *   - taps in build mode become mouse clicks at the tapped point
 *     (tap with units selected = right-click order).
 *
 * When are the controls shown? ("Touch controls" in the pause menu)
 *   Auto  phones and tablets: ALWAYS, even with a keyboard attached (many tablet
 *         keyboards have no trackpad, so there is no other way to look or click).
 *         Touch-screen laptops: after the first touch, hidden again when the
 *         mouse moves. Desktop PCs without a touch screen: never.
 *   On / Off  forced by the player (remembered in localStorage).
 *
 * Phones and tablets also get lighter graphics (applyTouchProfile, before the
 * renderer is created). Every tuning number is in CONFIG.touch (config.js).
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './utils.js';

// ------------------------------------------------------------ device check
/** What kind of device this is, decided once at start-up. */
export const DEVICE = (() => {
  const ua = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints || 0;
  const hasTouch = touchPoints > 0 || 'ontouchstart' in window;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  // iPadOS presents itself as a Mac: tell them apart by the touch screen.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const mobile = /Android|iPhone|iPod|Mobile|Silk|Kindle|Tablet/i.test(ua);
  // A phone / tablet keeps this even when a keyboard (or a trackpad) is attached.
  return { hasTouch, touchPrimary: hasTouch && (coarse || iPad || mobile) };
})();

/**
 * Lighter graphics on phones / tablets. Must run before the Game is created.
 * Only visual settings change: gameplay, resources and saves stay identical.
 */
export function applyTouchProfile() {
  const L = CONFIG.touch.lite;
  if (!DEVICE.touchPrimary || !L.enabled) return false;
  const R = CONFIG.render, U = CONFIG.universe, F = CONFIG.fx;
  R.maxPixelRatio = Math.min(R.maxPixelRatio, L.maxPixelRatio);
  R.bloom = R.bloom && L.bloom;
  R.shadowMapSize = Math.min(R.shadowMapSize, L.shadowMapSize);
  U.skyboxResolution = Math.min(U.skyboxResolution, L.skyboxResolution);
  U.starCount = Math.min(U.starCount, L.starCount);
  U.bandStarCount = Math.min(U.bandStarCount, L.bandStarCount);
  U.dustCount = Math.min(U.dustCount, L.dustCount);
  F.weatherParticles = Math.min(F.weatherParticles, L.weatherParticles);
  F.scatterPerPlanet = Math.min(F.scatterPerPlanet, L.scatterPerPlanet);
  return true;
}

// ---------------------------------------------------------------- buttons
// kind: 'hold' keeps `keys` down while touched · 'tap' presses `key` once (or runs `action`)
// · 'toggle' flips a TouchControls flag. show(game, touch) → visible · on(game, touch) → highlighted.
// Within a mode, the FIRST button sits in the bottom-right corner (under the thumb).
const isWalkingNearShip = (g) => g.player.position.distanceTo(g.ship.position) < CONFIG.player.boardRange;
const shipOnThisPlanet = (g) => g.ship.landedPlanet && g.ship.landedPlanet === g.player.planet;

const PAD = {
  flight: [
    { id: 'thrust', label: 'Thrust', icon: '⏫', kind: 'hold', keys: ['KeyW'] },
    { id: 'brake', label: 'Brake', icon: '⏬', kind: 'hold', keys: ['KeyS'] },
    { id: 'boost', label: 'Boost', icon: '🔥', kind: 'hold', keys: ['KeyW', 'ShiftLeft'] },
    { id: 'rise', label: 'Up', icon: '▲', kind: 'hold', keys: ['Space'] },
    { id: 'sink', label: 'Down', icon: '▼', kind: 'hold', keys: ['KeyC'] },
    { id: 'land', label: 'Land', icon: '⤓', kind: 'tap', key: 'KeyL', primary: true,
      show: (g) => g.flightAltitude < CONFIG.ship.landingRange },
  ],
  landed: [
    { id: 'exit', label: 'Step out', icon: '🚶', kind: 'tap', key: 'KeyF', primary: true },
    { id: 'takeoff', label: 'Take off', icon: '⤒', kind: 'tap', key: 'KeyL' },
    { id: 'build', label: 'Build', icon: '🏗', kind: 'tap', key: 'KeyB' },
  ],
  walking: [
    { id: 'jump', label: 'Jump', icon: '⤴', kind: 'tap', key: 'Space' },
    { id: 'harvest', label: 'Harvest', icon: '✋', kind: 'hold', keys: ['KeyE'], on: (g) => !!g.harvest.target },
    { id: 'board', label: 'Board', icon: '🚀', kind: 'tap', key: 'KeyF', primary: true, show: isWalkingNearShip },
    { id: 'locator', label: 'To ship', icon: '⌖', kind: 'tap', key: 'KeyG',
      show: (g) => shipOnThisPlanet(g) && !isWalkingNearShip(g), on: (g) => !!g.autoWalk },
    { id: 'dismantle', label: 'Dismantle', icon: '🔧', kind: 'hold', keys: ['KeyX'], show: (g) => !!g.dismantle.target },
    { id: 'build', label: 'Build', icon: '🏗', kind: 'tap', key: 'KeyB' },
  ],
  build: [
    { id: 'place', label: 'Place', icon: '✔', kind: 'tap', primary: true, show: (g) => !!g.build.type,
      on: (g) => !!g.build.placement?.ok, action: (g, t) => t.input.mouse.clicks.push(0) },
    { id: 'rotate', label: 'Rotate', icon: '⟳', kind: 'tap', key: 'KeyR', show: (g) => !!g.build.type },
    { id: 'cancel', label: 'Cancel', icon: '✖', kind: 'tap', key: 'Escape',
      show: (g) => !!(g.build.type || g.build.selected || g.units.selected.length) },
    { id: 'exitbuild', label: 'Exit', icon: '⏏', kind: 'tap', key: 'KeyB' },
    { id: 'next', label: 'Colony', icon: '⇥', kind: 'tap', key: 'Tab', show: (g) => g.build.bases.length > 1 },
    { id: 'box', label: 'Box select', icon: '⬚', kind: 'toggle', flag: 'boxMode',
      show: (g) => !g.build.type, on: (g, t) => t.boxMode },
  ],
};

const SYSTEM = [
  { id: 'pause', label: 'Pause', icon: 'Ⅱ', kind: 'tap', action: (g) => g.pause() },
  { id: 'help', label: 'Help', icon: '?', kind: 'tap', action: (g) => g.hud.toggleHelp() },
  { id: 'moon', label: 'Moon', icon: '☾', kind: 'tap', key: 'KeyM',
    show: (g) => g.aiTier >= 3 || g.techMoon.state !== 'none', on: (g) => g.hud.moonPanelOpen },
  { id: 'summon', label: 'Summon', icon: '⇊', kind: 'tap', key: 'KeyN', show: (g) => g.techMoon.state === 'complete' },
  { id: 'fullscreen', label: 'Full', icon: '⛶', kind: 'tap', show: () => fullscreenSupported(),
    on: () => !!fullscreenElement(), action: () => toggleFullscreen() },
];

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const fullscreenSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (fullscreenElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el)?.catch?.(() => {});
  } catch { /* not allowed here: ignore */ }
}

// ---------------------------------------------------------------- controls
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.setting = this._loadSetting();   // 'auto' | 'on' | 'off'
    this.touchSeen = false;               // touch laptops: a finger touched the screen
    this.held = new Map();                // key code → how many touch controls hold it
    this.physical = new Set();            // keys held on a real keyboard (never released by touch)
    this.stickKeys = [];
    this.stick = null;                    // { id, ox, oy, vx, vy }
    this.look = null;                     // { id, lx, ly }
    this.buildTouches = new Map();        // build-mode fingers: id → { x, y, sx, sy, lx, ly, moved }
    this.pinch = null;
    this.box = null;                      // box selection being dragged (build mode)
    this.boxMode = false;
    this.lastBuildType = null;
    this.cursor = null;                   // build mode: last tapped point (where the hologram / tip go)
    this.visible = false;

    this._buildDom();
    this._buildSettings();
    this._bindEvents();
  }

  /** Should the controls be used right now (ignoring pause)? */
  get enabled() {
    if (this.setting === 'on') return true;
    if (this.setting === 'off') return false;
    if (DEVICE.touchPrimary) return true;           // phones & tablets: always, keyboard or not
    return DEVICE.hasTouch && this.touchSeen;       // touch laptops: after a touch
  }

  // -------------------------------------------------------------- DOM
  _buildDom() {
    const root = (this.root = document.createElement('div'));
    root.id = 'touch-ui';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="t-stick hidden"><div class="t-knob"></div></div>
      <div class="t-pad"></div>
      <div class="t-sys"></div>`;
    document.body.appendChild(root);
    this.stickEl = root.querySelector('.t-stick');
    this.knobEl = root.querySelector('.t-knob');
    this.padButtons = {};
    const pad = root.querySelector('.t-pad');
    for (const [mode, defs] of Object.entries(PAD)) {
      this.padButtons[mode] = defs.map((def) => this._makeButton(def, pad, mode));
    }
    const sys = root.querySelector('.t-sys');
    this.sysButtons = SYSTEM.map((def) => this._makeButton(def, sys, 'system'));

    // Portrait hint (also visible over the menu).
    this.rotateEl = document.createElement('div');
    this.rotateEl.id = 't-rotate';
    this.rotateEl.textContent = '⟲ Rotate your device to landscape for the best experience';
    document.body.appendChild(this.rotateEl);
  }

  _makeButton(def, parent, mode) {
    const el = document.createElement('button');
    el.type = 'button';
    el.tabIndex = -1;
    el.className = 't-btn hidden' + (def.primary ? ' primary' : '');
    el.dataset.id = def.id;
    el.dataset.mode = mode;
    el.innerHTML = `<span class="t-ico">${def.icon}</span><span class="t-lbl">${def.label}</span>`;
    const b = { def, el, down: false };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this._press(b);
    });
    const up = () => this._release(b);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('mousedown', (e) => e.preventDefault());    // never steal keyboard focus
    el.addEventListener('contextmenu', (e) => e.preventDefault());  // long-press menu
    parent.appendChild(el);
    return b;
  }

  _press(b) {
    if (b.down) return;
    b.down = true;
    b.el.classList.add('down');
    const { def } = b;
    if (def.kind === 'hold') def.keys.forEach((k) => this._keyDown(k));
    else if (def.kind === 'toggle') this[def.flag] = !this[def.flag];
    else if (def.action) def.action(this.game, this);
    else this.input.pressed.add(def.key);
    if (def.kind !== 'hold') this.game.audio.play('click');
  }

  _release(b) {
    if (!b.down) return;
    b.down = false;
    b.el.classList.remove('down');
    if (b.def.kind === 'hold') b.def.keys.forEach((k) => this._keyUp(k));
  }

  /** "Touch controls: Auto / On / Off" in the pause menu (only on devices with a touch screen). */
  _buildSettings() {
    const box = document.querySelector('.audio-settings');
    if (!box || (!DEVICE.hasTouch && this.setting === 'auto')) return;   // PCs: menu unchanged
    const row = document.createElement('div');
    row.className = 'touch-setting';
    row.innerHTML = '<span>Touch controls</span>' + ['auto', 'on', 'off']
      .map((v) => `<button type="button" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
    row.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.v;
      if (!v) return;
      this.setting = v;
      try { localStorage.setItem(CONFIG.touch.storageKey, v); } catch { /* private mode */ }
      this._markSetting(row);
      this.game.audio.play('click');
    });
    box.appendChild(row);
    this._markSetting(row);
  }

  _markSetting(row) {
    for (const btn of row.querySelectorAll('button')) btn.classList.toggle('active', btn.dataset.v === this.setting);
  }

  _loadSetting() {
    try {
      const v = localStorage.getItem(CONFIG.touch.storageKey);
      return v === 'on' || v === 'off' ? v : 'auto';
    } catch { return 'auto'; }
  }

  // ----------------------------------------------------------- events
  _bindEvents() {
    const canvas = this.game.canvas;
    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
    // Touch laptops ("Auto"): a touch anywhere turns the controls on, a real mouse turns them off.
    window.addEventListener('pointerdown', (e) => { if (isTouch(e)) this.touchSeen = true; }, true);
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !(e.movementX || e.movementY)) return;   // browsers send still "fake" moves too
      this.cursor = null;   // a real mouse / trackpad moved: it points again
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.touchSeen = false;
    });
    // Real keyboard keys: touch controls must never release a key the player is holding.
    window.addEventListener('keydown', (e) => this.physical.add(e.code), true);
    window.addEventListener('keyup', (e) => this.physical.delete(e.code), true);
    window.addEventListener('blur', () => this.physical.clear());
  }

  _onDown(e) {
    if (!isTouch(e) || !this.visible) return;
    e.preventDefault();   // no emulated mouse events (they would click in build mode)
    const x = e.clientX, y = e.clientY, mode = this.game.mode;
    if (mode === 'build') {
      this._buildDown({ id: e.pointerId, x, y, sx: x, sy: y, lx: x, ly: y, moved: false });
    } else if (!this.stick && this._stickMode(mode) && x < window.innerWidth * 0.45) {
      this.stick = { id: e.pointerId, ox: x, oy: y, vx: 0, vy: 0 };
      this.stickEl.classList.add('active');
      this._moveStick(x, y);
    } else if (!this.look) {
      this.look = { id: e.pointerId, lx: x, ly: y };
    }
  }

  _onMove(e) {
    if (!isTouch(e)) return;
    const x = e.clientX, y = e.clientY;
    if (this.stick?.id === e.pointerId) {
      this._moveStick(x, y);
    } else if (this.look?.id === e.pointerId) {
      const k = CONFIG.touch.lookSensitivity;
      this.input.mouse.dx += (x - this.look.lx) * k;
      this.input.mouse.dy += (y - this.look.ly) * k;
      this.look.lx = x;
      this.look.ly = y;
    } else if (this.buildTouches.has(e.pointerId)) {
      this._buildMove(e.pointerId, x, y);
    }
  }

  _onUp(e) {
    if (!isTouch(e)) return;
    if (this.stick?.id === e.pointerId) this._endStick();
    if (this.look?.id === e.pointerId) this.look = null;
    if (this.buildTouches.has(e.pointerId)) this._buildUp(e.pointerId);
  }

  // ------------------------------------------------------------ stick
  _stickMode(mode) { return mode === 'flight' || mode === 'walking'; }

  _moveStick(x, y) {
    const s = this.stick, R = CONFIG.touch.joystickRadius;
    let dx = x - s.ox, dy = y - s.oy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    const mag = Math.min(len, R) / R;
    const dead = CONFIG.touch.joystickDeadZone;
    const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / (mag || 1);
    s.vx = (dx / R) * k;
    s.vy = (-dy / R) * k;   // screen y grows downwards: push up = positive
    this.stickEl.style.left = `${s.ox}px`;
    this.stickEl.style.top = `${s.oy}px`;
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _endStick() {
    this.stick = null;
    this.stickEl.classList.remove('active');
    this.stickEl.style.left = this.stickEl.style.top = '';
    this.knobEl.style.transform = '';
    this._setStickKeys([]);
  }

  /** Turn the stick into steering (flight) or W/A/S/D + run (on foot). Runs every frame. */
  _applyStick(dt, mode) {
    const T = CONFIG.touch, x = this.stick?.vx ?? 0, y = this.stick?.vy ?? 0;
    if (mode === 'flight') {
      // Same scale as the keyboard turn rates, applied like a mouse movement (analogue).
      const S = CONFIG.ship, k = (T.flightSteer * dt) / S.mouseSensitivity;
      this.input.mouse.dx += x * S.yawRate * k;
      this.input.mouse.dy += (T.invertFlightY ? y : -y) * S.pitchRate * k;
      this._setStickKeys([]);
    } else if (mode === 'walking') {
      const th = T.walkThreshold, keys = [];
      if (y > th) keys.push('KeyW');
      if (y < -th) keys.push('KeyS');
      if (x > th) keys.push('KeyD');
      if (x < -th) keys.push('KeyA');
      if (Math.hypot(x, y) > T.runThreshold) keys.push('ShiftLeft');
      this._setStickKeys(keys);
    } else {
      this._setStickKeys([]);
    }
  }

  _setStickKeys(keys) {
    for (const k of this.stickKeys) if (!keys.includes(k)) this._keyUp(k);
    for (const k of keys) if (!this.stickKeys.includes(k)) this._keyDown(k);
    this.stickKeys = keys;
  }

  // ------------------------------------------------------------- keys
  _keyDown(code) {
    const n = this.held.get(code) || 0;
    this.held.set(code, n + 1);
    if (n === 0 && !this.input.keys.has(code)) this.input.pressed.add(code);
    this.input.keys.add(code);
  }

  _keyUp(code) {
    const n = (this.held.get(code) || 0) - 1;
    if (n > 0) { this.held.set(code, n); return; }
    this.held.delete(code);
    if (!this.physical.has(code)) this.input.keys.delete(code);
  }

  // ------------------------------------------------------- build mode
  // 1 finger: tap = click (select / place the hologram / order) · drag = pan the camera
  //           (or draw a selection box when "Box select" is on)
  // 2 fingers: pinch = zoom · twist = rotate the view
  _buildDown(p) {
    this.buildTouches.set(p.id, p);
    if (this.buildTouches.size === 2) {
      const [a, b] = this.buildTouches.values();
      this.pinch = { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
      for (const q of this.buildTouches.values()) q.moved = true;   // a pinch is never a tap
      if (this.box) this._cancelBox();
    }
  }

  _buildMove(id, x, y) {
    const p = this.buildTouches.get(id), B = this.game.build;
    p.x = x;
    p.y = y;
    if (this.pinch && this.buildTouches.size >= 2) {
      const [a, b] = this.buildTouches.values();
      const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const Z = CONFIG.base.cameraZoom;
      if (d > 10) B.targetZoom = clamp(B.targetZoom * (this.pinch.d / d), Z[0], Z[1]);
      let turn = ang - this.pinch.ang;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      B.heading.applyAxisAngle(B.focusDir, turn);
      this.pinch = { d, ang };
      return;
    }
    if (!p.moved && Math.hypot(x - p.sx, y - p.sy) > CONFIG.touch.tapMaxMove) {
      p.moved = true;
      if (this.boxMode && !B.type && !this.box) this.box = { id, sx: p.sx, sy: p.sy, started: false };
    }
    if (!p.moved) return;
    if (this.box?.id !== id) this._pan(x - p.lx, y - p.ly);
    p.lx = x;
    p.ly = y;
  }

  _buildUp(id) {
    const p = this.buildTouches.get(id);
    this.buildTouches.delete(id);
    if (this.buildTouches.size < 2) this.pinch = null;
    if (this.box?.id === id) { this._endBox(p); return; }
    // No time limit: on a slow device the finger-up event can arrive late, and a still finger is a tap anyway.
    if (!p.moved) this._buildTap(p.x, p.y);
  }

  /** Drag the ground under the finger: moves the build camera's focus point. */
  _pan(dx, dy) {
    const B = this.game.build, up = B.focusDir;
    const right = new THREE.Vector3().crossVectors(B.heading, up);
    const k = (B.zoom * CONFIG.touch.buildPanSpeed) / (B.planet.radius * window.innerHeight);
    up.addScaledVector(right, -dx * k).addScaledVector(B.heading, dy * k).normalize();
  }

  _buildTap(x, y) {
    const g = this.game, B = g.build, m = this.input.mouse;
    this.cursor = { x, y };
    m.x = x;
    m.y = y;
    if (B.type) return;   // the hologram jumps to the tap; "Place" confirms
    const ordering = g.units.selected.some((a) => a.alive && a.planet === B.planet)
      && !g.units.pickActor(B.planet, g.camera, x, y, 'player');
    this._click(ordering ? 2 : 0, x, y);   // with units selected, a tap on the ground = order
  }

  _click(button, x, y) {
    const m = this.input.mouse;
    m.clicks.push(button);
    m.releases.push({ button, x, y, sx: x, sy: y, dist: 0 });
  }

  _endBox(p) {
    const m = this.input.mouse, b = this.box;
    m.x = p.x;
    m.y = p.y;
    m.buttons = 0;
    m.releases.push({ button: 0, x: p.x, y: p.y, sx: b.sx, sy: b.sy, dist: Math.hypot(p.x - b.sx, p.y - b.sy) });
    this.box = null;
  }

  _cancelBox() {
    this.input.mouse.buttons = 0;
    this.game.build.dragStart = null;
    this.game.hud.setSelectBox(null);
    this.box = null;
  }

  // ------------------------------------------------------------ frame
  /** Called every frame by the game loop, BEFORE the game reads its input. */
  update(dt) {
    const g = this.game, on = this.enabled;
    document.body.classList.toggle('touch-on', on);
    // A locked pointer freezes every finger at the lock position: no pointer lock with touch.
    this.input.lockDisabled = on;
    if (on && this.input.locked) {
      g._releasingLock = true;   // released on purpose: don't pause the game
      this.input.exitLock();
    }
    const show = on && !g.paused && !g.choosing;
    if (show !== this.visible) {
      this.visible = show;
      this.root.classList.toggle('hidden', !show);
      if (!show) this._releaseAll();
    }
    if (!show) return;

    const mode = g.mode;
    const stickMode = this._stickMode(mode);
    if (!stickMode && this.stick) this._endStick();
    this.stickEl.classList.toggle('hidden', !stickMode);
    if (mode !== 'build' && this.buildTouches.size) { this.buildTouches.clear(); this.pinch = null; if (this.box) this._cancelBox(); }
    this._applyStick(dt, mode);

    if (mode === 'build') this._updateBuild();
    this._refreshButtons(mode);
  }

  _updateBuild() {
    const B = this.game.build, m = this.input.mouse;
    // A building was just picked (menu, keys 1–9…): show its hologram in the middle of the screen.
    if (B.type && B.type !== this.lastBuildType) this.cursor = { x: window.innerWidth / 2, y: window.innerHeight * 0.55 };
    this.lastBuildType = B.type;
    // Keep the "mouse" on the tapped point: the browser may move the mouse position on its own
    // (it re-sends the last real mouse position to refresh hover effects).
    if (this.cursor && !this.box) { m.x = this.cursor.x; m.y = this.cursor.y; }
    // Box selection = a left-button drag of the mouse.
    if (this.box) {
      const p = this.buildTouches.get(this.box.id);
      if (!this.box.started) {
        this.box.started = true;
        m.x = this.box.sx;
        m.y = this.box.sy;
        m.buttons = 1;
        m.clicks.push(0);
      } else if (p) {
        m.x = p.x;
        m.y = p.y;
      }
    }
  }

  _refreshButtons(mode) {
    const g = this.game;
    for (const [m, list] of Object.entries(this.padButtons)) {
      for (const b of list) this._showButton(b, m === mode && (!b.def.show || b.def.show(g, this)));
    }
    for (const b of this.sysButtons) this._showButton(b, !b.def.show || b.def.show(g, this));
  }

  _showButton(b, visible) {
    b.el.classList.toggle('hidden', !visible);
    if (!visible) { this._release(b); return; }
    if (b.def.on) b.el.classList.toggle('on', !!b.def.on(this.game, this));
  }

  /** Let go of everything (game paused, controls hidden…). */
  _releaseAll() {
    if (this.stick) this._endStick();
    this.look = null;
    this.buildTouches.clear();
    this.pinch = null;
    if (this.box) this._cancelBox();
    for (const list of [...Object.values(this.padButtons), this.sysButtons]) for (const b of list) this._release(b);
    for (const code of [...this.held.keys()]) {
      this.held.delete(code);
      if (!this.physical.has(code)) this.input.keys.delete(code);
    }
    this.stickKeys = [];
  }
}

function isTouch(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; }
