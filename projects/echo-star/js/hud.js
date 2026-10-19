/**
 * HTML overlay HUD. All DOM lives in index.html; this module only updates
 * it. Text is cached per element so the DOM is touched only on changes.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RESOURCE_KEYS } from './inventory.js';
import { fmt, clamp } from './utils.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      tierNum: $('ai-tier-num'), tierName: $('ai-tier-name'), tierBar: $('ai-progress'), tierNext: $('ai-next'),
      speed: $('hud-speed'), speedBar: $('hud-speed-bar'), fuel: $('hud-fuel'), fuelBar: $('hud-fuel-bar'),
      planet: $('hud-planet'), planetInfo: $('hud-planet-info'),
      prompt: $('prompt'), promptText: $('prompt-text'), promptBar: $('prompt-progress'),
      notifications: $('notifications'), hints: $('hints'), markers: $('markers'),
      floaters: $('floaters'), mode: $('mode-badge'), help: $('help'), crosshair: $('crosshair'),
      suitBar: $('hud-suit-bar'), selectBox: $('select-box'), alert: $('alert'), hurt: $('hurt'),
    };
    this.res = {};
    for (const k of RESOURCE_KEYS) {
      const box = document.querySelector(`.res[data-res="${k}"]`);
      this.res[k] = { box, value: box.querySelector('b'), last: -1 };
    }
    this.floatersList = [];
    this.markerEls = [];

    // Build mode UI
    this.build = {
      root: $('build-ui'), menu: $('build-menu'), info: $('build-info'), tip: $('build-tip'),
      flight: $('flight-panel'), items: {}, infoKey: null,
    };
    /** Set by the game: called with an action name ('demolish') from info-panel buttons. */
    this.onBuildAction = null;
    /** Set by the game: sound hooks for notifications and the tier-up banner. */
    this.onNotify = null;
    this.onTierUp = null;

    // Tech Moon panel (Phase 5)
    this.moon = { el: $('moon-panel'), key: null };
    this.moon.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.moon.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a && this.onBuildAction) this.onBuildAction(a.dataset.action);
    });
    this.build.info.addEventListener('mousedown', (e) => e.preventDefault());
    this.build.info.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a && this.onBuildAction) this.onBuildAction(a.dataset.action);
    });
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  _text(el, text) {
    if (el._t !== text) { el.textContent = text; el._t = text; }
  }
  _width(el, frac) {
    const w = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    if (el._w !== w) { el.style.width = w; el._w = w; }
  }

  // --------------------------------------------------------- resources
  /** @param energyCap storage limit shown next to energy ("45 / 150") */
  updateResources(inv, energyCap = null) {
    for (const k of RESOURCE_KEYS) {
      const r = this.res[k];
      const v = Math.floor(inv.get(k));
      if (k === 'energy' && energyCap !== null) {
        this._text(r.value, `${fmt(v)} / ${fmt(energyCap)}`);
        r.box.classList.toggle('full', v >= energyCap - 0.5);
        r.last = v;
        continue;
      }
      if (v !== r.last) {
        if (r.last >= 0 && v > r.last) {
          r.box.classList.remove('bump');
          void r.box.offsetWidth; // restart the CSS animation
          r.box.classList.add('bump');
        }
        r.last = v;
        this._text(r.value, fmt(v));
      }
    }
  }

  // ----------------------------------------------------------- AI tier
  /** Highlight the AI panel and show the Evolve button when an evolution is affordable. */
  setEvolveReady(ready) {
    this.el.evolve ??= $('ai-evolve');
    this.el.aiPanel ??= $('ai-panel');
    this.el.evolve.classList.toggle('hidden', !ready);
    this.el.aiPanel.classList.toggle('ready', ready);
  }

  /** Big "AI evolved" banner. opts: { title (small line above), hostile (red styling, no chime) }. */
  showTierUp(name, desc, { title = 'BASE AI EVOLVED', hostile = false } = {}) {
    const el = $('tierup');
    if (!hostile) this.onTierUp?.();
    el.classList.toggle('hostile', hostile);
    el.querySelector('.t1').textContent = title;
    $('tierup-name').textContent = name;
    $('tierup-desc').textContent = desc;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._tierTimer);
    this._tierTimer = setTimeout(() => el.classList.add('hidden'), 5200);
  }

  /** Singularity path picker. `onPick(key)` is called with 'swarm' | 'defense' | 'quantum'. */
  showChoice(options, onPick) {
    const wrap = $('choice-cards');
    wrap.innerHTML = '';
    for (const [key, o] of Object.entries(options)) {
      const b = document.createElement('button');
      b.className = 'choice-card';
      b.innerHTML = `<span class="icon">${o.icon}</span><span class="name">${o.name.toUpperCase()}</span><span class="desc">${o.desc}</span>`;
      b.addEventListener('click', () => { $('choice').classList.add('hidden'); onPick(key); });
      wrap.appendChild(b);
    }
    $('choice').classList.remove('hidden');
  }

  updateAI(tier, compute, note) {
    const tiers = CONFIG.aiTiers;
    const cur = tiers[tier], next = tiers[tier + 1];
    this._text(this.el.tierNum, `TIER ${tier}`);
    this._text(this.el.tierName, cur.name.toUpperCase());
    if (next) {
      const frac = compute / next.compute;   // evolving spends the Compute, so progress restarts each tier
      this._width(this.el.tierBar, frac);
      this._text(this.el.tierNext, note || `Next: ${next.name} · ${fmt(compute)} / ${fmt(next.compute)} Compute`);
    } else {
      this._width(this.el.tierBar, 1);
      this._text(this.el.tierNext, note || 'Maximum tier reached');
    }
  }

  // ----------------------------------------------------------- flight
  updateFlight({ speed, maxSpeed, fuel, location, info, suit = 1 }) {
    this._width(this.el.suitBar, suit);
    this.el.suitBar.classList.toggle('low', suit < 0.3);
    this._text(this.el.speed, String(Math.round(Math.abs(speed))));
    this._width(this.el.speedBar, Math.abs(speed) / maxSpeed);
    this._text(this.el.fuel, String(Math.round(fuel)));
    this._width(this.el.fuelBar, fuel / CONFIG.ship.fuelMax);
    this.el.fuelBar.classList.toggle('low', fuel < 20);
    this._text(this.el.planet, location);
    this._text(this.el.planetInfo, info);
  }

  setMode(text) { this._text(this.el.mode, text); }

  /** Red banner for raids (null hides it). */
  setAlert(text) {
    this.el.alert.classList.toggle('hidden', !text);
    if (text) this._text(this.el.alert, text);
  }

  /** Brief red vignette when the astronaut is hit. */
  flashHurt() {
    const h = this.el.hurt;
    h.classList.remove('on');
    void h.offsetWidth;
    h.classList.add('on');
  }

  /** Drag-selection rectangle in screen pixels (null hides it). */
  setSelectBox(x0, y0, x1, y1) {
    const b = this.el.selectBox;
    if (x0 === null || x0 === undefined) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    Object.assign(b.style, {
      left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px',
      width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px',
    });
  }
  setHints(text) { this._text(this.el.hints, text); }
  setCrosshair(on) { this.el.crosshair.style.display = on ? 'block' : 'none'; }

  // ----------------------------------------------------------- prompt
  setPrompt(text, progress = -1) {
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    this._text(this.el.promptText, text);
    this.el.promptBar.parentElement.style.visibility = progress >= 0 ? 'visible' : 'hidden';
    if (progress >= 0) this._width(this.el.promptBar, progress);
  }

  // ---------------------------------------------------- notifications
  notify(text, kind = 'info') {
    this.onNotify?.(kind);
    const div = document.createElement('div');
    div.className = `note ${kind}`;
    div.textContent = text;
    this.el.notifications.prepend(div);
    while (this.el.notifications.children.length > 5) this.el.notifications.lastChild.remove();
    setTimeout(() => div.classList.add('fade'), CONFIG.hud.notificationSeconds * 1000);
    setTimeout(() => div.remove(), CONFIG.hud.notificationSeconds * 1000 + 600);
  }

  toggleHelp() { this.el.help.classList.toggle('hidden'); }

  // ---------------------------------------------- floating "+2 Iron" text
  spawnFloater(text, worldPos, color = '#fff') {
    const div = document.createElement('div');
    div.className = 'floater';
    div.textContent = text;
    div.style.color = color;
    this.el.floaters.appendChild(div);
    this.floatersList.push({ div, pos: worldPos.clone(), t: 0 });
  }

  updateFloaters(dt, camera) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.floatersList.length - 1; i >= 0; i--) {
      const f = this.floatersList[i];
      f.t += dt;
      if (f.t > 1.3) { f.div.remove(); this.floatersList.splice(i, 1); continue; }
      _v.copy(f.pos).project(camera);
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h - f.t * 60;
      f.div.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      f.div.style.opacity = String(1 - Math.max(0, f.t - 0.8) / 0.5);
      f.div.style.display = _v.z < 1 ? 'block' : 'none';
    }
  }

  // --------------------------------------------------------- build mode

  /** Create one button per building in CONFIG.buildings. */
  initBuildMenu(onSelect) {
    for (const [type, def] of Object.entries(CONFIG.buildings)) {
      const btn = document.createElement('button');
      btn.className = 'build-item';
      btn.tabIndex = -1;
      btn.title = def.desc;
      const costs = Object.keys(def.cost)
        .map((k) => `<span class="c" data-c="${k}"><i class="ico ${k}"></i><b></b></span>`).join('');
      btn.innerHTML = `<span class="key">${def.key}</span><span class="bname">${def.name}</span>`
        + `<span class="bcost">${costs}</span><span class="lock">Phase ${def.phase}</span>`;
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
      btn.addEventListener('click', () => onSelect(type));
      this.build.menu.appendChild(btn);
      this.build.items[type] = btn;
    }
  }

  showBuildUI(on) {
    this.build.root.classList.toggle('hidden', !on);
    this.build.flight.classList.toggle('hidden', on);
    if (!on) { this.setBuildTip(null); this.build.infoKey = null; }
  }

  updateBuildMenu(selected, inventory, costMult = 1, singularity = null) {
    for (const [type, btn] of Object.entries(this.build.items)) {
      const def = CONFIG.buildings[type];
      btn.classList.toggle('selected', type === selected);
      // Must be a real boolean: classList.toggle(name, undefined) would flip the class every frame.
      const needsPath = !!def.requires && singularity !== def.requires;
      btn.classList.toggle('locked', def.phase > CONFIG.phase || needsPath);
      this._text(btn.querySelector('.lock'), def.phase > CONFIG.phase ? `Phase ${def.phase}` : needsPath ? CONFIG.singularity[def.requires].name : '');
      for (const c of btn.querySelectorAll('.c')) {
        const k = c.dataset.c;
        const v = Math.ceil(def.cost[k] * costMult);
        this._text(c.lastChild, String(v));
        c.classList.toggle('short', inventory.get(k) < v);
      }
    }
  }

  /** Tooltip that follows the cursor while placing (null hides it). */
  setBuildTip(text, ok = true, x = 0, y = 0) {
    const tip = this.build.tip;
    if (!text) { tip.classList.add('hidden'); return; }
    tip.classList.remove('hidden');
    tip.classList.toggle('bad', !ok);
    this._text(tip, text);
    tip.style.transform = `translate(${x + 18}px, ${y + 14}px)`;
  }

  /**
   * Right-hand info panel. `html` is only re-rendered when `key` changes;
   * `fields` update [data-f] elements every frame (numbers set bar widths).
   */
  setBuildInfo(key, html, fields = {}) {
    const el = this.build.info;
    if (this.build.infoKey !== key) {
      el.innerHTML = html;
      this.build.infoKey = key;
    }
    for (const [f, v] of Object.entries(fields)) {
      const n = el.querySelector(`[data-f="${f}"]`);
      if (!n) continue;
      if (typeof v === 'number') this._width(n, v);
      else this._text(n, v);
    }
  }

  // ------------------------------------------------------- ship locator
  /**
   * Marker pointing at the landed ship while on foot. When the ship is off
   * screen (or behind the camera) the marker sticks to the screen edge and
   * its arrow points toward the ship.
   */
  updateShipMarker(camera, worldPos, text, show, auto) {
    const el = (this.el.shipMarker ??= $('ship-marker'));
    if (!show) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('auto', auto);
    this._text(el.lastChild, text);
    const behind = _v.copy(worldPos).applyMatrix4(camera.matrixWorldInverse).z > 0;
    _v.copy(worldPos).project(camera);
    let x = _v.x, y = _v.y;
    if (behind) { x = -x; y = -y; }
    const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.85;
    if (edge) {
      const k = 0.9 / Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85, 1e-6);
      x *= k; y *= k;
    }
    const w = window.innerWidth, h = window.innerHeight;
    const sx = (x * 0.5 + 0.5) * w, sy = (-y * 0.5 + 0.5) * h;
    el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    // arrow: points down at the ship when visible, toward it from the screen edge otherwise
    const ang = edge ? Math.atan2(sy - h / 2, sx - w / 2) * 180 / Math.PI - 90 : 0;
    el.firstChild.style.transform = `rotate(${ang}deg)`;
    el.classList.toggle('edge', edge);
  }

  // ------------------------------------------------------- Tech Moon panel
  get moonPanelOpen() { return !this.moon.el.classList.contains('hidden'); }

  showMoonPanel(on) {
    this.moon.el.classList.toggle('hidden', !on);
    if (!on) this.moon.key = null;
  }

  /** model: { key, html, fields } from TechMoon.panel() */
  setMoonPanel(model) {
    const el = this.moon.el;
    if (this.moon.key !== model.key) { el.innerHTML = model.html; this.moon.key = model.key; }
    for (const [f, v] of Object.entries(model.fields || {})) {
      const n = el.querySelector(`[data-f="${f}"]`);
      if (!n) continue;
      if (typeof v === 'number') this._width(n, v); else this._text(n, v);
    }
  }

  // ----------------------------------------------- planet markers (space)
  updateMarkers(planets, camera, refPos, visible) {
    while (this.markerEls.length < planets.length) {
      const d = document.createElement('div');
      d.className = 'marker';
      d.innerHTML = '<span class="dot"></span><span class="name"></span><span class="dist"></span>';
      this.el.markers.appendChild(d);
      this.markerEls.push(d);
    }
    const w = window.innerWidth, h = window.innerHeight;
    planets.forEach((p, i) => {
      const el = this.markerEls[i];
      if (!visible) { el.style.display = 'none'; return; }
      _v.copy(p.position).applyMatrix4(camera.matrixWorldInverse);
      const dist = refPos.distanceTo(p.position) - p.radius;
      if (_v.z > 0 || dist < p.radius * 0.6) { el.style.display = 'none'; return; }
      _v.copy(p.position).project(camera);
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      el.style.display = 'flex';
      el.classList.toggle('hostile', !!p.hostile);
      el.style.transform = `translate(${x}px, ${y}px)`;
      this._text(el.children[1], p.name);
      this._text(el.children[2], dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m');
    });
  }
}
