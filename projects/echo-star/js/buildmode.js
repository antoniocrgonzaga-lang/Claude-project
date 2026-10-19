/**
 * Build mode (Phase 2): strategic top-down camera over the planet, a grid
 * overlay around the Command Core, a holographic "ghost" that shows where
 * a building would go (green = valid, red = invalid + reason), placement,
 * selection and demolition.
 *
 * Controls: WASD pan · Q/E or right-drag rotate · wheel zoom ·
 *           1–9 choose building · R rotate · left-click place/select ·
 *           right-click / Esc cancel · B exit.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { MODELS, validatePlacement, footprintOf } from './buildings.js';
import { clamp, damp, projectOnPlane, anyPerpendicular, quatFromUpForward } from './utils.js';

export const STATE_LABEL = { idle: 'Idle', move: 'Moving', gather: 'Gathering', return: 'Delivering', build: 'Building', attack: 'Attacking', wander: 'Roaming', raid: 'Raiding' };
const COLOR_OK = 0x5dff9a;
const COLOR_BAD = 0xff4d5e;

export class BuildMode {
  constructor(game) {
    this.game = game;
    this.planet = null;
    this.focusDir = new THREE.Vector3(0, 1, 0);
    this.focusH = 0;
    this.heading = new THREE.Vector3(0, 0, 1);
    this.zoom = CONFIG.base.cameraStartZoom;
    this.targetZoom = this.zoom;
    this.type = null;          // building type being placed
    this.rot = 0;              // 0..3 × 90°
    this.placement = null;     // last validatePlacement() result
    this.hover = null;
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    // Ghost preview
    this.ghostMat = new THREE.MeshBasicMaterial({ color: COLOR_OK, transparent: true, opacity: 0.45, depthWrite: false });
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    game.scene.add(this.ghost);
    this.ghostType = null;
    this.ghostPlanet = null;

    this.overlay = null;       // grid lines + range rings
    this.overlayKey = null;
    this.selected = null;      // selected building (any colony)
  }

  /** All colonies on the planet being edited. */
  get bases() { return this.planet?.bases ?? []; }

  /** Colony whose core is closest to a planet-local direction. */
  nearestBase(dir) {
    let best = null, bestA = Infinity;
    for (const b of this.bases) {
      const a = dir.angleTo(b.grid.origin);
      if (a < bestA) { bestA = a; best = b; }
    }
    return best ? { base: best, dist: bestA * this.planet.radius } : null;
  }

  // ---------------------------------------------------------- enter / exit
  enter(planet, focusWorld, headingWorld) {
    this.planet = planet;
    const dir = focusWorld.clone().sub(planet.position).normalize();
    // Jump to the nearest colony if it is reasonably close.
    const near = this.nearestBase(dir);
    if (near && near.dist < 150) dir.copy(near.base.grid.origin);
    this.focusDir.copy(dir);
    this.focusH = planet.walkHeight(dir);
    this.heading.copy(headingWorld);
    projectOnPlane(this.heading, dir);
    if (this.heading.lengthSq() < 1e-6) anyPerpendicular(dir, this.heading);
    this.heading.normalize();
    this.zoom = this.targetZoom = CONFIG.base.cameraStartZoom;
    this.setType(null);
    this.select(null);
    this._refreshOverlay();
  }

  exit() {
    this.setType(null);
    this.select(null);
    this.selectUnits([]);
    this.dragStart = null;
    this.game.hud.setSelectBox(null);
    this.ghost.visible = false;
    if (this.overlay) this.overlay.visible = false;
    this.game.hud.setBuildTip(null);
    this.planet = null;
  }

  setType(type) {
    this.type = type;
    this.placement = null;
    if (type) this.select(null);
    if (!type) {
      this.ghost.visible = false;
      this.game.hud.setBuildTip(null);
    }
  }

  /** Select a building (clears any unit selection). */
  select(b) {
    if (this.selected && this.selected !== this.game.dismantle?.target) this.selected.setSelected(false);
    this.selected = b || null;
    if (b) { b.setSelected(true); this.game.units.selected = []; }
  }

  /** Select units (clears any building selection). */
  selectUnits(list) {
    this.game.units.selected = list;
    if (list.length) this.select(null);
  }

  /** Building whose footprint contains a planet-local point (any colony). */
  _buildingAtPoint(point) {
    for (const base of this.bases) {
      const b = base.buildingAt(point);
      if (b) return b;
    }
    return null;
  }

  /** Signature of the current colonies, so the overlay redraws when one is founded / removed. */
  _basesKey() {
    return this.bases.map((b) => b.grid.origin.x.toFixed(4)).join('|');
  }

  // ------------------------------------------------------------- update
  update(dt) {
    const game = this.game, input = game.input, B = CONFIG.base;

    if (input.wasPressed('KeyB')) { game.exitBuildMode(); return; }
    if (input.wasPressed('Escape')) {
      if (this.type) this.setType(null);
      else if (this.selected) this.select(null);
      else if (game.units.selected.length) this.selectUnits([]);
      else { game.exitBuildMode(); return; }
    }
    for (const [type, def] of Object.entries(CONFIG.buildings)) {
      if (input.wasPressed('Digit' + def.key) || input.wasPressed('Numpad' + def.key)) this.setType(this.type === type ? null : type);
    }
    if (input.wasPressed('KeyR')) { this.rot = (this.rot + 1) % 4; if (this.type) game.audio.play('click'); }
    // Tab: fly the camera to the next colony on this planet.
    if (input.wasPressed('Tab') && this.bases.length) {
      const near = this.nearestBase(this.focusDir);
      const i = this.bases.indexOf(near.base);
      const next = near.dist < 5 ? this.bases[(i + 1) % this.bases.length] : near.base;
      this.focusDir.copy(next.grid.origin);
      game.audio.play('open');
      game.hud.notify(`Colony ${next.number} of ${this.bases.length}`, 'info');
    }

    this._updateCamera(dt);
    const cursor = this._pick();

    if (this.type) {
      this._updatePlacement(cursor);
      if (input.clicked(0) && this.placement?.ok) {
        game.placeBuilding(this.placement);
        if (this.type === 'core') this.setType(null);
        this._refreshOverlay();
      } else if (input.clicked(0) && this.placement) {
        game.hud.notify(this.placement.reason, 'warn');
      }
      if (input.clicked(2)) this.setType(null);
    } else {
      this._updateSelection(cursor);
    }
    if (this.overlayKey !== this._basesKey()) this._refreshOverlay();
  }

  // -------------------------------------------------- selection & orders
  /**
   * Left click: select a unit or building · left drag: box-select units
   * (Shift adds) · right click: order the selected units.
   */
  _updateSelection(cursor) {
    const game = this.game, input = game.input, units = game.units, mouse = input.mouse, cam = game.camera;
    const unitHover = units.pickActor(this.planet, cam, mouse.x, mouse.y, 'player') || units.pickActor(this.planet, cam, mouse.x, mouse.y, 'enemy');
    this.hover = unitHover ? null : this._pickBuilding() || (cursor ? this._buildingAtPoint(cursor) : null);
    let tip = null;
    if (unitHover) tip = `${unitHover.def.name} · ${Math.ceil(unitHover.hp)}/${unitHover.def.hp}${unitHover.faction === 'enemy' ? ' · hostile' : ' · ' + STATE_LABEL[unitHover.state]}`;
    else if (this.hover) tip = `${this.hover.def.name} · ${this.hover.status}`;
    game.hud.setBuildTip(tip, !unitHover || unitHover.faction === 'player', mouse.x, mouse.y);

    // left button: click or drag-box
    if (input.clicked(0)) this.dragStart = { x: mouse.x, y: mouse.y };
    if (this.dragStart && (mouse.buttons & 1) && Math.hypot(mouse.x - this.dragStart.x, mouse.y - this.dragStart.y) > 6) {
      game.hud.setSelectBox(this.dragStart.x, this.dragStart.y, mouse.x, mouse.y);
    }
    const rel = input.released(0);
    if (rel && this.dragStart) {
      const additive = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      if (rel.dist > 6) {
        const boxed = units.actorsInRect(this.planet, cam, rel.sx, rel.sy, rel.x, rel.y);
        this.selectUnits(additive ? [...new Set([...units.selected, ...boxed])] : boxed);
      } else {
        const u = units.pickActor(this.planet, cam, mouse.x, mouse.y, 'player');
        if (u) this.selectUnits(additive ? (units.selected.includes(u) ? units.selected.filter((s) => s !== u) : [...units.selected, u]) : [u]);
        else if (!additive) { this.selectUnits([]); this.select(this.hover); }
      }
      this.dragStart = null;
      game.hud.setSelectBox(null);
      if (units.selected.length || this.selected) game.audio.play('select');
    }
    // right click (not a camera drag): give orders
    const rr = input.released(2);
    if (rr && rr.dist < 6) {
      if (units.selected.length) this._command(cursor);
      else this.select(null);
    }
  }

  /** Decide what a right-click means from what is under the cursor. */
  _command(cursor) {
    const game = this.game, units = game.units, mouse = game.input.mouse;
    const sel = units.selected.filter((a) => a.alive && a.planet === this.planet);
    if (!sel.length) return;
    game.audio.play('order');
    const enemy = units.pickActor(this.planet, game.camera, mouse.x, mouse.y, 'enemy', 28);
    if (enemy) {
      units.command(sel, { kind: 'attack', target: enemy });
      units.ping(this.planet, enemy.local, 0xff4d5e);
      return;
    }
    const b = this._pickBuilding() || (cursor ? this._buildingAtPoint(cursor) : null);
    if (b && (!b.built || b.hp < b.maxHp - 0.5) && sel.some((u) => u.isBuilder)) {
      units.command(sel, { kind: 'build', building: b });
      units.ping(this.planet, b.localPos, 0xffd36a);
      return;
    }
    if (!cursor) return;
    const node = this.planet.resources.findNearest(cursor, 3)?.node;
    if (node && sel.some((u) => u.isGatherer)) {
      units.command(sel, { kind: 'gather', node });
      units.ping(this.planet, node.pos, 0x6ff6ff);
      return;
    }
    units.command(sel, { kind: 'move', point: cursor }, this.heading);
    units.ping(this.planet, cursor, 0x7dff9a);
  }

  _updateCamera(dt) {
    const input = this.game.input, B = CONFIG.base;
    const up = this.focusDir;
    // zoom
    if (input.mouse.wheel) this.targetZoom = clamp(this.targetZoom * (1 + input.mouse.wheel * 0.0012), B.cameraZoom[0], B.cameraZoom[1]);
    this.zoom = damp(this.zoom, this.targetZoom, 10, dt);
    // rotate (Q/E or right-drag)
    let yaw = input.axis('KeyE', 'KeyQ') * 1.6 * dt;
    if (input.mouse.buttons & 2) yaw -= input.mouse.dx * 0.005;
    if (yaw) this.heading.applyAxisAngle(up, yaw);
    // pan
    const fwd = input.axis('KeyS', 'KeyW') + input.axis('ArrowDown', 'ArrowUp');
    const side = input.axis('KeyA', 'KeyD') + input.axis('ArrowLeft', 'ArrowRight');
    if (fwd || side) {
      const right = new THREE.Vector3().crossVectors(this.heading, up);
      const move = this.heading.clone().multiplyScalar(clamp(fwd, -1, 1)).addScaledVector(right, clamp(side, -1, 1));
      const speed = this.zoom * B.cameraPanSpeed;
      this.focusDir.addScaledVector(move, (speed * dt) / this.planet.radius).normalize();
    }
    projectOnPlane(this.heading, this.focusDir).normalize();
    this.focusH = damp(this.focusH, this.planet.walkHeight(this.focusDir), 6, dt);
  }

  getCameraPose(pose) {
    const p = this.planet, up = this.focusDir, pitch = CONFIG.base.cameraPitch;
    pose.target.copy(up).multiplyScalar(p.radius + this.focusH).add(p.position);
    pose.position.copy(pose.target)
      .addScaledVector(this.heading, -Math.cos(pitch) * this.zoom)
      .addScaledVector(up, Math.sin(pitch) * this.zoom);
    pose.up.copy(up);
    return pose;
  }

  /**
   * Cursor → planet-local ground point. Marches the camera ray from where it
   * enters the "highest terrain" sphere until it dips below the ground, then
   * refines by bisection. Uses heightAt() instead of raycasting the mesh.
   */
  _pick() {
    const input = this.game.input, p = this.planet;
    this._ndc.set((input.mouse.x / window.innerWidth) * 2 - 1, -(input.mouse.y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.game.camera);
    const o = this.raycaster.ray.origin.clone().sub(p.position);
    const d = this.raycaster.ray.direction;
    const rMax = p.radius + p.amplitude + 1;
    const b = o.dot(d), c = o.lengthSq() - rMax * rMax, disc = b * b - c;
    if (disc < 0) return null;
    let t = Math.max(0, -b - Math.sqrt(disc));
    const tEnd = -b + Math.sqrt(disc);
    const q = new THREE.Vector3(), dir = new THREE.Vector3();
    const altitude = (tt) => {
      q.copy(o).addScaledVector(d, tt);
      const len = q.length();
      dir.copy(q).divideScalar(len);
      return len - (p.radius + p.walkHeight(dir));
    };
    let prev = t;
    while (t < tEnd) {
      const alt = altitude(t);
      if (alt <= 0) {
        let lo = prev, hi = t;                      // bisection between last above / first below
        for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (altitude(mid) > 0) lo = mid; else hi = mid; }
        altitude(hi);
        return dir.clone().multiplyScalar(p.radius + p.walkHeight(dir));
      }
      prev = t;
      t += Math.max(0.25, alt * 0.6);
    }
    return null;
  }

  /** Building whose body (not just footprint) is under the cursor. */
  _pickBuilding() {
    const ray = this.raycaster.ray;
    const inv = new THREE.Matrix4(), local = new THREE.Ray(), box = new THREE.Box3(), hit = new THREE.Vector3();
    let best = null, bestD = Infinity;
    for (const b of this.bases.flatMap((base) => base.buildings)) {
      b.group.updateWorldMatrix(true, false);
      inv.copy(b.group.matrixWorld).invert();
      local.copy(ray).applyMatrix4(inv);
      const [fw, fh] = b.footprintSize;
      box.min.set(-fw / 2, -0.5, -fh / 2);
      box.max.set(fw / 2, b.model.height, fh / 2);
      if (local.intersectBox(box, hit)) {
        const dist = hit.distanceTo(local.origin);
        if (dist < bestD) { bestD = dist; best = b; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------- placement
  _updatePlacement(cursor) {
    const game = this.game, hud = game.hud;
    if (!cursor) {
      this.ghost.visible = false;
      this.placement = null;
      hud.setBuildTip(null);
      return;
    }
    const pl = validatePlacement({
      planet: this.planet, type: this.type, rot: this.rot,
      cursorLocal: cursor, heading: this.heading, inventory: game.inventory,
      costMult: game.modifiers.costMultiplier ?? 1,
      singularity: game.singularityChoice,
      allowBlueprint: game.techMoon.automates(this.planet),
      shipLocal: game.ship.landedPlanet === this.planet ? game.ship.position.clone().sub(this.planet.position) : null,
    });
    this.placement = pl;
    hud.setBuildTip(pl.reason, pl.ok, game.input.mouse.x, game.input.mouse.y);
    if (!pl.site) { this.ghost.visible = false; return; }

    this._ensureGhost(this.type, pl.w, pl.h);
    const site = pl.site;
    const top = CONFIG.base.autoLevel ? site.level : site.maxH;   // where the levelled pad will be
    this.ghost.position.copy(site.dir).multiplyScalar(this.planet.radius + top).add(this.planet.position);
    // A new core's grid already includes the rotation; other buildings rotate on their colony grid.
    quatFromUpForward(site.dir, pl.grid.forwardAt(site.dir, pl.base ? this.rot : 0), this.ghost.quaternion);
    this.ghostMat.color.set(pl.blueprint ? 0x4df3ff : pl.ok ? COLOR_OK : COLOR_BAD);
    this.ghost.visible = true;
  }

  /** (Re)build the hologram for a building type. */
  _ensureGhost(type, w, h) {
    const key = `${type}:${w}x${h}`;
    if (this.ghostType === key && this.ghostPlanet === this.planet) return;
    this.ghost.clear();
    const model = MODELS[type](this.planet, {});
    model.group.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
    model.group.rotation.y = 0;
    this.ghost.add(model.group);
    // Footprint plate: rotated models keep their own orientation, the plate shows the cells.
    const cs = CONFIG.base.cellSize;
    const [bw, bh] = footprintOf(type, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(bw * cs, 0.15, bh * cs), this.ghostMat);
    plate.position.y = 0.1;
    this.ghost.add(plate);
    this.ghostType = key;
    this.ghostPlanet = this.planet;
  }

  // ------------------------------------------------------------ overlay
  /** Grid lines + build-radius ring around every Command Core on the planet. */
  _refreshOverlay() {
    if (this.overlay) { this.overlay.removeFromParent(); this.overlay.geometry.dispose(); this.overlay = null; }
    this.overlayKey = this._basesKey();
    if (!this.bases.length) return;
    const p = this.planet, R = CONFIG.base.buildRadius;
    const pts = [];
    const d = new THREE.Vector3();
    for (const base of this.bases) {
      const grid = base.grid, cs = grid.cs;
      const N = Math.ceil(R / cs) + 1;
      const lift = (x, y) => {
        grid.toDir(x, y, d);
        return d.clone().multiplyScalar(p.radius + p.walkHeight(d) + 0.25);
      };
      const inside = (x, y) => x * x + y * y <= (R + cs) * (R + cs);
      for (let i = -N; i <= N; i++) {
        for (let j = -N; j < N; j++) {
          // vertical line segment (x = i) and horizontal segment (y = i)
          if (inside(i * cs, j * cs) && inside(i * cs, (j + 1) * cs)) pts.push(lift(i * cs, j * cs), lift(i * cs, (j + 1) * cs));
          if (inside(j * cs, i * cs) && inside((j + 1) * cs, i * cs)) pts.push(lift(j * cs, i * cs), lift((j + 1) * cs, i * cs));
        }
      }
      // build radius ring
      const seg = 96;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        pts.push(lift(Math.cos(a0) * R, Math.sin(a0) * R), lift(Math.cos(a1) * R, Math.sin(a1) * R));
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x4df3ff, transparent: true, opacity: 0.22, depthWrite: false });
    this.overlay = new THREE.LineSegments(geo, mat);
    this.overlay.frustumCulled = false;
    p.group.add(this.overlay);
  }

  showOverlay(on) {
    if (on && !this.overlay) this._refreshOverlay();
    if (this.overlay) this.overlay.visible = on;
  }
}
