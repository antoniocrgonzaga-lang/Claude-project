/**
 * The player's spaceship: blocky model, arcade flight physics,
 * fuel, planet collision, and the smooth landing / take-off sequences.
 *
 * Convention: the ship's nose points along local -Z, up is local +Y.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, easeInOut, projectOnPlane, anyPerpendicular } from './utils.js';
import { box, part, merge, paint } from './geometry.js';

const COL = { hull: 0xe9edf3, panel: 0xc9d0da, accent: 0xff7a2f, dark: 0x2a3038, mid: 0x59626e, line: 0x1c2430, blue: 0x2f6fd8 };

/** Square pyramid with its sides aligned to the axes (ConeGeometry with 4 segments, turned 45°). */
function pyramid(r, h, color, opts) {
  const g = new THREE.ConeGeometry(r, h, 4);
  g.rotateY(Math.PI / 4);
  return part(g, color, opts);
}

/** Cylinder lying along Z (engines, nozzles, intake rings). */
const tube = (rTop, rBottom, len, color, x, y, z) => part(new THREE.CylinderGeometry(rTop, rBottom, len, 8), color, { rx: Math.PI / 2, x, y, z });

/** Thin swept wing (side = 1 right, −1 left): outline in x / z, extruded downward. */
function wingGeometry(side, color) {
  const pts = [[0.7, -0.5], [3.0, 0.55], [3.0, 1.55], [0.7, 1.75]];   // root front, tip front, tip back, root back
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * side, z))), { depth: 0.16, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);        // shape y → z, extrusion → −y
  geo.translate(0, -0.07, 0);
  return paint(geo, color);
}

/** One landing leg hanging from its pivot, `len` metres long (foot pad bottom at −len). */
function legGeometry(len) {
  return merge([
    box(0.24, 0.12, 0.24, COL.dark, 0, -0.06, 0),
    box(0.15, len * 0.5, 0.15, COL.mid, 0, -0.12 - len * 0.25, 0),
    box(0.2, 0.1, 0.2, COL.dark, 0, -0.12 - len * 0.5, 0),
    box(0.09, len * 0.4, 0.09, 0xc0c8d2, 0, -len * 0.73, 0),             // shock-absorber piston
    box(0.06, len * 0.45, 0.06, COL.accent, 0.12, -len * 0.45, 0, { rz: 0.12 }),   // hydraulic line
    box(0.2, 0.12, 0.2, COL.dark, 0, -len + 0.14, 0),
    box(0.58, 0.08, 0.58, COL.accent, 0, -len + 0.04, 0),
    box(0.16, 0.06, 0.34, COL.dark, 0, -len + 0.03, 0.4),               // toe
  ]);
}

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Ship {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'ship';
    this._buildModel();

    this.velocity = new THREE.Vector3();
    this.angVel = new THREE.Vector3();   // keyboard-driven pitch / yaw / roll rates
    this.speed = 0;                      // forward speed set by the throttle
    this.fuel = CONFIG.ship.fuelMax;
    this.thrust = 0;                     // 0..1 visual engine level
    this.boosting = false;
    this.gear = 0;                       // landing gear 0 = retracted, 1 = deployed
    this.landedPlanet = null;
    this.anim = null;                    // active landing / take-off animation
    this.camQuat = new THREE.Quaternion();
    this.orbitYaw = 0;                   // camera orbit while landed
    this.orbitPitch = 0;
    this.lastScrape = 0;
  }

  get position() { return this.group.position; }
  get quaternion() { return this.group.quaternion; }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.group.quaternion); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.group.quaternion); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.group.quaternion); }

  // --------------------------------------------------------------- model
  /**
   * Low-poly explorer ship. Parts are vertex-coloured and merged per
   * material (painted hull, bare metal, glass, engine glow, lights) so the
   * detailed model stays a handful of draw calls.
   */
  _buildModel() {
    const C = COL;
    const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.22, flatShading: true });
    const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.75, flatShading: true });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a2230, emissive: 0x2ad4ff, emissiveIntensity: 0.16, roughness: 0.06, metalness: 0.55, flatShading: true });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x5ff0ff, emissiveIntensity: 2 });   // engines, follows thrust
    // Small lights: HDR colours so they bloom; animateLights() blinks them.
    this.lights = {};
    for (const [k, c] of Object.entries({ red: 0xff2a2a, green: 0x2aff6a, beacon: 0xff3030, strobe: 0xffffff, landing: 0xfff4dd, sensor: 0x5ff0ff, glint: 0x9fdfff })) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3) });
      this.lights[k] = { mat, base: mat.color.clone(), parts: [] };
    }
    const L = this.lights;
    const P = [], M = [], G = [], E = [];   // paint, metal, glass, engine glow

    // ---- fuselage
    P.push(box(1.6, 1.0, 4.6, C.hull, 0, 0, 0));
    P.push(box(1.3, 0.3, 4.0, C.panel, 0, -0.6, 0.1));                     // belly
    P.push(box(0.5, 0.22, 2.4, C.panel, 0, 0.6, 1.1));                     // dorsal spine
    P.push(box(1.32, 0.85, 1.2, C.hull, 0, -0.05, -2.85));                 // nose section
    P.push(pyramid(0.85, 1.4, C.hull, { sz: 0.72, rx: -Math.PI / 2, y: -0.08, z: -4.15 }));
    P.push(box(1.34, 0.87, 0.14, C.accent, 0, -0.05, -3.35));              // nose band
    L.sensor.parts.push(box(0.14, 0.14, 0.14, 0xffffff, 0, -0.08, -4.86));
    P.push(box(0.9, 0.22, 1.3, C.dark, 0, -0.55, -2.75));                  // chin
    for (const s of [-1, 1]) L.landing.parts.push(box(0.16, 0.06, 0.16, 0xffffff, s * 0.28, -0.67, -3.2));
    P.push(box(1.2, 0.7, 0.6, C.panel, 0, 0.05, 2.55));                    // engine block
    P.push(box(0.1, 0.42, 0.9, C.dark, 0, -0.85, 2.0));                    // ventral fin

    // ---- cockpit: canopy, sloped windshield, frame
    G.push(box(1.15, 0.55, 1.6, 0xffffff, 0, 0.75, -0.95));
    G.push(box(1.1, 0.4, 1.06, 0xffffff, 0, 0.66, -2.12, { rx: -0.645 }));
    // reflections on the glass
    L.glint.parts.push(box(0.5, 0.02, 0.06, 0xffffff, -0.15, 1.03, -1.25, { ry: 0.5 }), box(0.3, 0.02, 0.05, 0xffffff, 0.2, 1.03, -0.6, { ry: 0.5 }));
    L.glint.parts.push(box(0.5, 0.02, 0.07, 0xffffff, -0.12, 0.83, -2.25, { rx: -0.645, ry: 0.4 }));
    for (const s of [-1, 1]) P.push(box(0.07, 0.6, 1.62, C.hull, s * 0.6, 0.76, -0.95));
    P.push(box(0.06, 0.05, 1.62, C.hull, 0, 1.04, -0.95));
    P.push(box(1.24, 0.62, 0.1, C.hull, 0, 0.75, -0.12));
    P.push(box(1.36, 0.1, 2.7, C.dark, 0, 0.46, -1.25));                   // sill
    P.push(box(1.3, 0.35, 1.2, C.hull, 0, 0.65, 0.5));                     // dorsal hump
    for (let k = 0; k < 3; k++) P.push(box(0.9, 0.04, 0.1, C.line, 0, 0.83, 0.2 + k * 0.22));
    P.push(box(0.26, 0.06, 0.26, C.dark, 0, 0.83, 0.95));
    L.beacon.parts.push(box(0.18, 0.12, 0.18, 0xffffff, 0, 0.9, 0.95));
    M.push(box(0.03, 0.55, 0.03, C.mid, 0.35, 1.05, 0.4), box(0.03, 0.35, 0.03, C.mid, -0.35, 0.95, 0.6));

    for (const s of [-1, 1]) {
      // ---- hull side: panel lines, livery stripes, air intakes, RCS thrusters
      for (const z of [-1.7, -0.3, 1.1]) P.push(box(0.02, 0.9, 0.04, C.line, s * 0.81, 0, z));
      P.push(box(0.02, 0.04, 4.4, C.line, s * 0.81, 0.18, 0));
      P.push(box(0.02, 0.14, 3.2, C.accent, s * 0.81, -0.22, 0.3));
      P.push(box(0.02, 0.05, 3.2, C.blue, s * 0.81, -0.33, 0.3));
      P.push(box(0.3, 0.5, 1.1, C.dark, s * 0.92, -0.08, -0.55));
      P.push(box(0.34, 0.08, 1.12, C.accent, s * 0.92, 0.2, -0.55));
      M.push(box(0.12, 0.12, 0.12, C.mid, s * 0.67, 0.15, -3.1), box(0.12, 0.12, 0.12, C.mid, s * 0.67, 0.15, 1.9));

      // ---- swept wing with stripe, flap line, root fairing, tip pod, winglet, under-wing pod
      P.push(wingGeometry(s, C.hull));
      P.push(box(2.5, 0.03, 0.26, C.accent, s * 1.85, -0.06, 0.22, { ry: -s * 0.428 }));
      P.push(box(2.0, 0.025, 0.06, C.line, s * 1.85, -0.06, 1.45));
      P.push(box(0.4, 0.32, 2.0, C.panel, s * 0.85, -0.12, 0.55));
      P.push(box(0.32, 0.36, 1.3, C.accent, s * 3.08, -0.12, 1.0));
      P.push(box(0.1, 0.75, 0.9, C.hull, s * 3.18, 0.3, 1.15, { rz: -s * 0.3 }));
      (s < 0 ? L.red : L.green).parts.push(box(0.14, 0.14, 0.12, 0xffffff, s * 3.08, -0.1, 0.32));
      M.push(box(0.22, 0.22, 1.0, C.mid, s * 1.95, -0.36, 0.75));
      P.push(box(0.24, 0.24, 0.18, C.accent, s * 1.95, -0.36, 0.2), box(0.06, 0.12, 0.6, C.dark, s * 1.95, -0.24, 0.75));

      // ---- engine nacelle: intake ring, body, cooling fins, nozzle, glowing core
      const x = s * 1.05, y = 0.05;
      P.push(tube(0.53, 0.53, 0.16, C.accent, x, y, 0.85));
      P.push(tube(0.4, 0.4, 0.05, C.line, x, y, 0.77));
      M.push(tube(0.46, 0.5, 1.9, C.mid, x, y, 1.75));
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        M.push(box(0.06, 0.2, 0.55, C.dark, x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.5, 2.3, { rz: a + Math.PI / 2 }));
      }
      M.push(tube(0.36, 0.47, 0.42, C.dark, x, y, 2.86));
      E.push(tube(0.32, 0.32, 0.04, 0xffffff, x, y, 3.07));

      // ---- canted twin tail fins with accent tips and strobes
      const rz = -s * 0.38, fx = s * 0.42, fy = 1.0, ux = s * Math.sin(0.38), uy = Math.cos(0.38);
      P.push(box(0.14, 1.1, 1.25, C.hull, fx, fy, 1.95, { rz }));
      P.push(box(0.16, 0.2, 0.7, C.accent, fx + ux * 0.47, fy + uy * 0.47, 2.05, { rz }));
      L.strobe.parts.push(box(0.1, 0.08, 0.1, 0xffffff, fx + ux * 0.6, fy + uy * 0.6, 2.3));
    }
    // centre booster
    M.push(tube(0.22, 0.3, 0.35, C.dark, 0, 0.08, 3.0));
    E.push(tube(0.2, 0.2, 0.04, 0xffffff, 0, 0.08, 3.18));

    const model = new THREE.Group();
    this.group.add(model);
    const addMesh = (parts, mat, shadows = true) => {
      const m = new THREE.Mesh(merge(parts), mat);
      m.castShadow = m.receiveShadow = shadows;
      model.add(m);
    };
    addMesh(P, paintMat);
    addMesh(M, metalMat);
    addMesh(G, glassMat);
    addMesh(E, this.glowMat, false);
    for (const l of Object.values(L)) addMesh(l.parts, l.mat, false);

    // ---- engine flames: an outer cyan cone and a white-hot core (additive, pointing back along +Z)
    const flameGeo = new THREE.ConeGeometry(0.28, 1, 8);
    flameGeo.rotateX(Math.PI / 2);   // tip toward +Z
    flameGeo.translate(0, 0, 0.5);   // base at the nozzle
    const outerMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    outerMat.color.setRGB(0.5, 1.5, 1.9);
    const coreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    coreMat.color.setRGB(2.4, 2.8, 3.0);
    this.flames = [[-1.05, 0.05, 3.08, 1], [1.05, 0.05, 3.08, 1], [0, 0.08, 3.2, 0.55]].map(([x, y, z, size]) => {
      const outer = new THREE.Mesh(flameGeo, outerMat);
      const core = new THREE.Mesh(flameGeo, coreMat);
      outer.position.set(x, y, z);
      core.position.set(x, y, z + 0.02);
      model.add(outer, core);
      return { outer, core, size };
    });

    // ---- landing gear: pivots hang from the hull and scale out
    this.legs = [[0, -0.72, -2.2], [-1.6, -0.25, 1.2], [1.6, -0.25, 1.2]].map(([x, y, z]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const leg = new THREE.Mesh(legGeometry(y + CONFIG.ship.gearHeight), metalMat);
      leg.castShadow = true;
      pivot.add(leg);
      model.add(pivot);
      return pivot;
    });

    // ---- landing light: lights the ground below the nose while the gear is down
    this.landingLight = new THREE.SpotLight(0xfff1dc, 0, 45, 0.6, 0.6, 1.2);
    this.landingLight.position.set(0, -0.6, -3.0);
    this.landingLight.target.position.set(0, -8, -11);
    model.add(this.landingLight, this.landingLight.target);
    this.lightT = 0;
    this._applyGear();
  }

  _applyGear() {
    const g = Math.max(0.02, this.gear);
    for (const l of this.legs) { l.scale.y = g; l.visible = this.gear > 0.02; }
  }

  /**
   * Navigation lights (called every frame by the game, also while you are
   * on foot): steady red / green wingtips, a red beacon flash, white tail
   * strobes double-flashing, landing lights while the gear is down.
   */
  animateLights(dt) {
    const t = (this.lightT += dt), L = this.lights;
    const set = (l, k) => l.mat.color.copy(l.base).multiplyScalar(k);
    set(L.glint, 0.25);
    set(L.red, 1);
    set(L.green, 1);
    set(L.sensor, 0.6 + 0.4 * Math.sin(t * 3));
    set(L.beacon, t % 1.3 < 0.14 ? 1.2 : 0.06);
    const s = t % 1.7;
    set(L.strobe, s < 0.05 || (s > 0.15 && s < 0.2) ? 1.5 : 0.04);
    const gear = clamp(this.gear, 0, 1);
    set(L.landing, 0.08 + gear);
    this.landingLight.intensity = gear * 14;
  }

  // -------------------------------------------------------------- state
  /** Put the ship somewhere in space facing a point. */
  placeInSpace(position, lookAt) {
    this.group.position.copy(position);
    _m.lookAt(position, lookAt, AY);
    this.group.quaternion.setFromRotationMatrix(_m);
    this.camQuat.copy(this.group.quaternion);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.gear = 0;
    this.landedPlanet = null;
    this.anim = null;
    this._applyGear();
  }

  /** Snap the ship to a landed pose (used when loading a save). */
  setLanded(planet, position, quaternion) {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    this.camQuat.copy(quaternion);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.gear = 1;
    this.landedPlanet = planet;
    this.anim = null;
    this._applyGear();
  }

  // ------------------------------------------------------------- flight
  updateFlight(dt, input, planet) {
    const c = CONFIG.ship;
    const q = this.group.quaternion;
    const fwd = this.forward(new THREE.Vector3());
    const up = this.up(new THREE.Vector3());

    // ---- rotation: mouse is direct, keyboard uses smoothed rates
    let pitch = -input.mouse.dy * c.mouseSensitivity;
    let yaw = -input.mouse.dx * c.mouseSensitivity;
    const kPitch = input.axis('ArrowDown', 'ArrowUp');
    const kYaw = input.axis('KeyD', 'KeyA') + input.axis('ArrowRight', 'ArrowLeft');
    const kRoll = input.axis('KeyE', 'KeyQ');
    this.angVel.x = damp(this.angVel.x, kPitch * c.pitchRate, 6, dt);
    this.angVel.y = damp(this.angVel.y, clamp(kYaw, -1, 1) * c.yawRate, 6, dt);
    this.angVel.z = damp(this.angVel.z, kRoll * c.rollRate, 6, dt);
    pitch += this.angVel.x * dt;
    yaw += this.angVel.y * dt;
    let roll = this.angVel.z * dt;

    // ---- altitude info + auto-level near planets
    let altitude = Infinity;
    if (planet) {
      const local = _v.copy(this.position).sub(planet.position);
      const dist = local.length();
      local.divideScalar(dist);
      altitude = dist - planet.groundRadius(local);
      if (kRoll === 0) {
        const strength = 1 - THREE.MathUtils.smoothstep(altitude, planet.radius * 0.3, planet.radius * 1.2);
        const rp = projectOnPlane(_v2.copy(local), fwd);
        if (strength > 0 && rp.lengthSq() > 0.01) {
          rp.normalize();
          const ang = Math.atan2(_v.crossVectors(up, rp).dot(fwd), up.dot(rp));
          roll += -ang * c.autoLevel * strength * dt;
        }
      }
    }

    q.multiply(_q.setFromAxisAngle(AX, pitch));
    q.multiply(_q.setFromAxisAngle(AY, yaw));
    q.multiply(_q.setFromAxisAngle(AZ, roll));
    q.normalize();
    this.forward(fwd);
    this.up(up);

    // ---- throttle
    const thrusting = input.isDown('KeyW');
    const braking = input.isDown('KeyS');
    this.boosting = thrusting && this.fuel > 0 && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    const nearFactor = clamp(altitude / c.nearPlanetSlowdown, c.minNearSpeedFactor, 1);
    let maxSpeed = c.maxSpeed * (this.boosting ? c.boostMultiplier : 1) * nearFactor;
    if (this.fuel <= 0) maxSpeed *= c.emptyFuelSpeedFactor;

    if (thrusting) {
      this.speed += (this.boosting ? c.boostAcceleration : c.acceleration) * dt;
      this.fuel = Math.max(0, this.fuel - c.fuelBurn * (this.boosting ? c.boostFuelMultiplier : 1) * dt);
    }
    if (braking) this.speed -= c.brakeDeceleration * dt;
    if (this.speed > maxSpeed) this.speed = damp(this.speed, maxSpeed, 2.5, dt);
    this.speed = Math.max(this.speed, -c.maxReverse);

    const strafe = input.axis('KeyC', 'Space');
    const desired = _v2.copy(fwd).multiplyScalar(this.speed).addScaledVector(up, strafe * c.strafeSpeed);
    this.velocity.lerp(desired, 1 - Math.exp(-c.handling * dt));
    this.position.addScaledVector(this.velocity, dt);

    if (planet) this._collide(planet);

    this.thrust = damp(this.thrust, thrusting ? (this.boosting ? 1 : 0.6) : 0.1, 6, dt);
    this.gear = damp(this.gear, 0, 4, dt);
    this._updateVisuals(dt);
    return altitude;
  }

  /** Keep the ship above the terrain; scraping kills inward velocity. */
  _collide(planet) {
    const local = _v.copy(this.position).sub(planet.position);
    const dist = local.length();
    const dir = local.divideScalar(dist);
    const minR = planet.groundRadius(dir) + CONFIG.ship.collisionClearance;
    if (dist < minR) {
      this.position.copy(planet.position).addScaledVector(dir, minR);
      const inward = this.velocity.dot(dir);
      if (inward < 0) this.velocity.addScaledVector(dir, -inward);
      this.speed *= 0.6;
      this.lastScrape = performance.now();
    }
  }

  _updateVisuals(dt) {
    const t = this.thrust;
    for (const f of this.flames) {
      const flicker = 1 + (Math.random() - 0.5) * 0.18;
      const w = (0.6 + t * 0.6) * f.size, len = (0.2 + t * (this.boosting ? 4.5 : 2.6)) * f.size * flicker;
      f.outer.scale.set(w, w, len);
      f.core.scale.set(w * 0.45, w * 0.45, len * 0.6);
      f.outer.visible = f.core.visible = t > 0.05;
    }
    this.glowMat.emissiveIntensity = 0.9 + t * 1.6;
    this._applyGear();
  }

  // --------------------------------------------------- landing / takeoff

  /** Choose a flat, dry spot under the ship and start the landing sequence. */
  startLanding(planet) {
    const c = CONFIG.ship;
    const dir = this.position.clone().sub(planet.position).normalize();
    const spot = this._findLandingSpot(planet, dir);
    const groundR = planet.groundRadius(spot);
    const target = planet.position.clone().addScaledVector(spot, groundR + c.gearHeight);
    const hover = target.clone().addScaledVector(spot, c.landingHoverHeight);

    // Final orientation: up = surface normal, nose = current nose flattened.
    const fwd = projectOnPlane(this.forward(new THREE.Vector3()), spot);
    if (fwd.lengthSq() < 1e-4) anyPerpendicular(spot, fwd);
    fwd.normalize();
    const z = fwd.clone().negate();
    const x = new THREE.Vector3().crossVectors(spot, z).normalize();
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, spot, z));

    this.anim = {
      type: 'landing', t: 0, planet,
      startPos: this.position.clone(), startQuat: this.quaternion.clone(),
      hover, target, targetQuat,
    };
    this.velocity.set(0, 0, 0);
    this.speed = 0;
  }

  _findLandingSpot(planet, dir) {
    let best = dir.clone(), bestScore = Infinity;
    const t1 = anyPerpendicular(dir, new THREE.Vector3());
    const t2 = new THREE.Vector3().crossVectors(dir, t1);
    const cand = new THREE.Vector3();
    for (let ring = 0; ring <= 3; ring++) {
      const r = (ring * 6) / planet.radius;
      const steps = ring === 0 ? 1 : 10;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        cand.copy(dir).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
        let score = planet.slopeAt(cand) * 10 + ring * 0.4;
        if (planet.isSubmerged(cand)) score += 100;
        if (score < bestScore) { bestScore = score; best = cand.clone(); }
      }
    }
    return best;
  }

  /** Returns true when the landing has finished. */
  updateLanding(dt) {
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / CONFIG.ship.landingDuration);
    if (a.t < 0.6) {
      const k = easeInOut(a.t / 0.6);
      this.position.lerpVectors(a.startPos, a.hover, k);
      this.quaternion.slerpQuaternions(a.startQuat, a.targetQuat, k);
      this.thrust = damp(this.thrust, 0.35, 4, dt);
    } else {
      const k = easeInOut((a.t - 0.6) / 0.4);
      this.position.lerpVectors(a.hover, a.target, k);
      this.quaternion.copy(a.targetQuat);
      this.gear = Math.min(1, k * 1.6);
      this.thrust = damp(this.thrust, 0.2 * (1 - k), 4, dt);
    }
    this._updateVisuals(dt);
    if (a.t >= 1) {
      this.landedPlanet = a.planet;
      this.anim = null;
      this.gear = 1;
      this.thrust = 0;
      this._updateVisuals(dt);
      return true;
    }
    return false;
  }

  startTakeoff() {
    const up = this.up(new THREE.Vector3());
    this.anim = {
      type: 'takeoff', t: 0,
      startPos: this.position.clone(),
      target: this.position.clone().addScaledVector(up, CONFIG.ship.takeoffAltitude),
    };
  }

  /** Returns true when the take-off has finished (ship is flying). */
  updateTakeoff(dt) {
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / CONFIG.ship.takeoffDuration);
    const k = easeInOut(a.t);
    this.position.lerpVectors(a.startPos, a.target, k);
    this.gear = 1 - Math.min(1, a.t * 2);
    this.thrust = 0.5 + 0.3 * Math.sin(a.t * Math.PI);
    this._updateVisuals(dt);
    if (a.t >= 1) {
      this.anim = null;
      this.landedPlanet = null;
      this.speed = 8;
      this.velocity.copy(this.forward(new THREE.Vector3())).multiplyScalar(this.speed);
      return true;
    }
    return false;
  }

  /** While landed: refuel and let the mouse orbit the camera. */
  updateLanded(dt, input) {
    this.fuel = Math.min(CONFIG.ship.fuelMax, this.fuel + CONFIG.ship.refuelRate * dt);
    this.orbitYaw -= input.mouse.dx * 0.004;
    this.orbitPitch = clamp(this.orbitPitch + input.mouse.dy * 0.003, -0.25, 0.9);
    this.thrust = damp(this.thrust, 0, 4, dt);
    this._updateVisuals(dt);
  }

  // ------------------------------------------------------------- camera
  /** Chase-camera pose. Rotation is smoothed, position is rigid (no lag at speed). */
  getCameraPose(dt, landed, pose) {
    const c = CONFIG.ship;
    this.camQuat.slerp(this.quaternion, 1 - Math.exp(-c.cameraDamping * dt));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camQuat);
    const offset = new THREE.Vector3(...(landed ? c.landedCameraOffset : c.cameraOffset));
    if (landed) {
      offset.applyAxisAngle(AX, -this.orbitPitch).applyAxisAngle(AY, this.orbitYaw);
    } else {
      offset.z += Math.min(Math.abs(this.speed) * 0.02, 6);
      this.orbitYaw = damp(this.orbitYaw, 0, 3, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, 3, dt);
    }
    offset.applyQuaternion(this.camQuat);
    pose.position.copy(this.position).add(offset);
    if (landed) {
      pose.target.copy(this.position).addScaledVector(up, 1.2);
    } else {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
      pose.target.copy(this.position).addScaledVector(fwd, c.cameraLookAhead).addScaledVector(up, 1.5);
    }
    pose.up.copy(up);
    return pose;
  }

  // ---------------------------------------------------------------- save
  serialize() {
    return {
      pos: this.position.toArray(),
      quat: this.quaternion.toArray(),
      fuel: this.fuel,
      landed: this.landedPlanet ? this.landedPlanet.index : -1,
    };
  }
}
