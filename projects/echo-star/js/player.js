/**
 * Third-person astronaut that walks on spherical planets.
 *
 * "Up" is always the direction away from the planet centre, so the player
 * can walk all the way around a world. The camera keeps its own forward
 * vector on the tangent plane; WASD moves relative to it.
 *
 * Model convention: the character faces local +Z, local +Y is up,
 * the group origin is at the feet.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, projectOnPlane, anyPerpendicular, quatFromUpForward } from './utils.js';
import { box, part, merge } from './geometry.js';

const SUIT = { suit: 0xf0f2f5, panel: 0xd5dbe3, accent: 0xff7a2f, dark: 0x30343c, sole: 0x1b1e23, metal: 0x9aa3ad, gold: 0xd9a441, blue: 0x2f6fd8 };
const SUIT_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08, flatShading: true });
const METAL_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7, flatShading: true });
/** Small static lights (chest panel, wrist screen, visor glint): HDR colours so they bloom. */
const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) });

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _push = new THREE.Vector3();

export class Player {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'player';
    this._buildModel();

    this.planet = null;
    this.position = this.group.position;  // world position of the feet
    this.up = new THREE.Vector3(0, 1, 0);
    this.camForward = new THREE.Vector3(0, 0, 1);
    this.facing = new THREE.Vector3(0, 0, 1);
    this.hVel = new THREE.Vector3();       // tangential velocity
    this.vVel = 0;                         // vertical (radial) velocity
    this.pitch = 0.35;
    this.grounded = true;
    this.walkPhase = 0;
    this.action = null;                    // 'harvest' while E is held on a target
    this.actionTime = 0;
    // Phase 3 combat
    this.hp = CONFIG.player.hp;
    this.lastHit = -99;
    this.fireCooldown = 0;
  }

  // --------------------------------------------------------------- model
  /**
   * Blocky astronaut built from vertex-coloured parts merged per joint
   * (hips → knees, shoulders → elbows, head) so it can walk naturally and
   * still be only a few draw calls.
   */
  _buildModel() {
    const S = SUIT;
    const visor = new THREE.MeshStandardMaterial({ color: 0x082a36, emissive: 0x1fd1ff, emissiveIntensity: 1.1, roughness: 0.12, metalness: 0.5, flatShading: true });
    this.blinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.4) });   // antenna tips + pack status light
    const add = (parent, parts, mat, shadows = true) => {
      const m = new THREE.Mesh(merge(parts), mat);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      parent.add(m);
      return m;
    };
    const body = new THREE.Group();
    this.group.add(body);
    this.body = body;

    // ---- legs: hip pivot → thigh (+ holster on the right) → knee pivot → shin + boot
    this.knees = [];
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.21, 0.78, 0);
      const thigh = [
        box(0.36, 0.4, 0.4, S.suit, 0, -0.19, 0),
        box(0.38, 0.06, 0.42, S.dark, 0, -0.1, 0),
        box(0.06, 0.16, 0.22, S.panel, s * 0.2, -0.24, 0),            // thigh pocket
      ];
      if (s > 0) thigh.push(box(0.1, 0.24, 0.18, S.dark, 0.23, -0.2, 0.04));   // holster
      add(hip, thigh, SUIT_MAT);
      if (s > 0) add(hip, [box(0.06, 0.12, 0.1, S.metal, 0.24, -0.05, 0.07)], METAL_MAT);   // blaster grip
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      add(knee, [
        box(0.3, 0.14, 0.1, S.accent, 0, -0.02, 0.2),                 // knee pad
        box(0.33, 0.3, 0.38, S.suit, 0, -0.16, 0),
        box(0.36, 0.06, 0.4, S.panel, 0, -0.26, 0),                   // boot cuff
        box(0.38, 0.14, 0.5, S.dark, 0, -0.33, 0.04),                 // boot
        box(0.4, 0.04, 0.52, S.sole, 0, -0.39, 0.04),                 // sole
      ], SUIT_MAT);
      add(knee, [box(0.3, 0.07, 0.05, S.metal, 0, -0.32, 0.3)], METAL_MAT);   // toe cap
      body.add(hip);
      this.knees.push(knee);
      return hip;
    });

    // ---- torso: hips, belt with pouches, chest plate + control unit, mission patch, collar
    add(body, [
      box(0.84, 0.22, 0.46, S.panel, 0, 0.86, 0),
      box(0.92, 0.12, 0.5, S.dark, 0, 0.98, 0),
      box(0.16, 0.14, 0.1, S.panel, -0.28, 0.96, 0.26), box(0.16, 0.14, 0.1, S.panel, 0.3, 0.96, 0.26),
      box(0.08, 0.14, 0.18, S.dark, -0.47, 0.96, 0), box(0.08, 0.14, 0.18, S.dark, 0.47, 0.96, 0),
      box(0.9, 0.6, 0.5, S.suit, 0, 1.33, 0),
      box(0.64, 0.3, 0.06, S.panel, 0, 1.38, 0.27),
      box(0.3, 0.18, 0.05, S.dark, 0.14, 1.31, 0.3),
      box(0.12, 0.12, 0.02, S.blue, -0.2, 1.45, 0.3), box(0.06, 0.06, 0.025, S.accent, -0.2, 1.45, 0.31),
      box(0.04, 0.42, 0.04, S.dark, -0.33, 1.3, 0.26),                // suit hose
      box(0.94, 0.07, 0.52, S.accent, 0, 1.56, 0),                    // collar stripe
    ], SUIT_MAT);
    add(body, [box(0.16, 0.1, 0.04, S.metal, 0, 0.98, 0.26), box(0.62, 0.1, 0.5, S.metal, 0, 1.64, 0)], METAL_MAT);
    add(body, [
      box(0.05, 0.04, 0.02, 0x7dff9a, 0.06, 1.34, 0.33), box(0.05, 0.04, 0.02, 0xffd84d, 0.14, 1.34, 0.33),
      box(0.05, 0.04, 0.02, 0x4df3ff, 0.22, 1.34, 0.33), box(0.2, 0.03, 0.02, 0x4df3ff, 0.14, 1.27, 0.33),
    ], GLOW_MAT, false);

    // ---- life-support pack: oxygen tanks, vents, status light, antenna, jump-jet nozzles
    add(body, [
      box(0.66, 0.7, 0.3, S.panel, 0, 1.28, -0.39),
      box(0.68, 0.08, 0.32, S.accent, 0, 1.66, -0.39),
      box(0.18, 0.05, 0.05, S.dark, 0, 1.56, -0.56), box(0.18, 0.05, 0.05, S.dark, 0, 1.48, -0.56),
      box(0.5, 0.1, 0.2, S.dark, 0, 0.9, -0.42),                      // jet manifold
    ], SUIT_MAT);
    add(body, [
      ...[-1, 1].flatMap((s) => [
        part(new THREE.CylinderGeometry(0.11, 0.11, 0.6, 8), S.metal, { x: s * 0.22, y: 1.26, z: -0.6 }),
        part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), S.dark, { x: s * 0.22, y: 1.59, z: -0.6 }),
        part(new THREE.CylinderGeometry(0.06, 0.09, 0.12, 8), S.dark, { x: s * 0.2, y: 0.8, z: -0.42 }),
      ]),
      box(0.03, 0.45, 0.03, S.dark, 0.27, 1.9, -0.42),
    ], METAL_MAT);
    add(body, [box(0.06, 0.26, 0.03, 0xffffff, 0, 1.22, -0.555), box(0.07, 0.07, 0.07, 0xffffff, 0.27, 2.14, -0.42)], this.blinkMat, false);
    // jump-jet flames (visible while airborne)
    const jetGeo = new THREE.ConeGeometry(0.08, 0.5, 8);
    jetGeo.rotateX(Math.PI);
    jetGeo.translate(0, -0.25, 0);
    const jetMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    jetMat.color.setRGB(3, 1.5, 0.45);
    this.jets = [-1, 1].map((s) => {
      const j = new THREE.Mesh(jetGeo, jetMat);
      j.position.set(s * 0.2, 0.74, -0.42);
      j.visible = false;
      body.add(j);
      return j;
    });
    this.jetLevel = 0;

    // ---- arms: shoulder pivot → upper arm + pad → elbow pivot → forearm, cuff, glove (wrist computer on the left)
    this.elbows = [];
    this.arms = [-1, 1].map((s) => {
      const sh = new THREE.Group();
      sh.position.set(s * 0.58, 1.5, 0);
      add(sh, [box(0.36, 0.16, 0.4, S.accent, 0, 0.02, 0), box(0.27, 0.36, 0.3, S.suit, 0, -0.17, 0)], SUIT_MAT);
      const el = new THREE.Group();
      el.position.y = -0.36;
      sh.add(el);
      const fore = [
        box(0.24, 0.08, 0.28, S.dark, 0, 0, 0),
        box(0.25, 0.26, 0.29, S.suit, 0, -0.16, 0),
        box(0.28, 0.06, 0.31, S.panel, 0, -0.3, 0),
        box(0.22, 0.17, 0.24, S.dark, 0, -0.41, 0.02),
        box(0.07, 0.1, 0.08, S.dark, -s * 0.12, -0.38, 0.1),          // thumb
      ];
      if (s < 0) fore.push(box(0.06, 0.16, 0.2, S.dark, -0.14, -0.14, 0));
      add(el, fore, SUIT_MAT);
      if (s < 0) add(el, [box(0.02, 0.1, 0.14, 0x4df3ff, -0.175, -0.14, 0)], GLOW_MAT, false);   // wrist screen
      body.add(sh);
      this.elbows.push(el);
      return sh;
    });

    // ---- helmet: shell, side + back plates, wrap-around visor with gold brow, lamp, comm discs, antenna
    const head = new THREE.Group();
    head.position.set(0, 1.62, 0);
    add(head, [
      box(0.4, 0.08, 0.4, S.dark, 0, 0.03, 0),
      box(0.62, 0.54, 0.58, S.suit, 0, 0.33, 0),
      box(0.5, 0.08, 0.46, S.suit, 0, 0.63, 0),
      box(0.06, 0.42, 0.36, S.panel, -0.33, 0.33, -0.07), box(0.06, 0.42, 0.36, S.panel, 0.33, 0.33, -0.07),
      box(0.48, 0.42, 0.05, S.panel, 0, 0.33, -0.31),
      box(0.6, 0.05, 0.07, S.gold, 0, 0.5, 0.3),
      box(0.6, 0.04, 0.07, S.dark, 0, 0.17, 0.3),
      box(0.12, 0.1, 0.14, S.dark, 0.37, 0.47, 0.1),
      box(0.03, 0.32, 0.03, S.dark, 0.2, 0.78, -0.12),
    ], SUIT_MAT);
    add(head, [-1, 1].map((s) => part(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), S.metal, { rz: Math.PI / 2, x: s * 0.37, y: 0.3, z: -0.05 })), METAL_MAT);
    add(head, [
      box(0.52, 0.29, 0.06, 0xffffff, 0, 0.33, 0.3),
      box(0.05, 0.22, 0.16, 0xffffff, -0.3, 0.33, 0.22), box(0.05, 0.22, 0.16, 0xffffff, 0.3, 0.33, 0.22),
    ], visor);
    add(head, [
      box(0.14, 0.03, 0.01, 0xffffff, -0.12, 0.41, 0.335, { rz: 0.5 }),   // visor glint
      box(0.08, 0.07, 0.02, 0xfff0c8, 0.37, 0.47, 0.175),                 // helmet lamp
    ], GLOW_MAT, false);
    add(head, [box(0.07, 0.07, 0.07, 0xffffff, 0.2, 0.97, -0.12)], this.blinkMat, false);
    body.add(head);
    this.head = head;
    this.blinkT = 0;
  }

  // ------------------------------------------------------------- spawning
  /** Place the player on a planet at (roughly) a world position. */
  spawn(planet, worldPos, forwardHint) {
    this.planet = planet;
    const local = worldPos.clone().sub(planet.position).normalize();
    planet.surfacePoint(local, this.position).add(planet.position);
    this.up.copy(local);
    this.camForward.copy(forwardHint || anyPerpendicular(local));
    projectOnPlane(this.camForward, this.up).normalize();
    this.facing.copy(this.camForward);
    this.hVel.set(0, 0, 0);
    this.vVel = 0;
    this.pitch = 0.35;
    this.group.visible = true;
    this._orient();
  }

  // --------------------------------------------------------------- update
  /**
   * @param obstacles extra obstacles in world space: [{ pos, r }]
   */
  /** True when the player is pressing a movement key this frame (cancels auto-walk). */
  static manualMove(input) {
    return input.isDown('KeyW') || input.isDown('KeyA') || input.isDown('KeyS') || input.isDown('KeyD');
  }

  update(dt, input, obstacles = [], autoDir = null) {
    const P = CONFIG.player;
    const planet = this.planet;
    const center = planet.position;
    this.up.copy(this.position).sub(center).normalize();
    const up = this.up;

    // ---- mouse look (yaw rotates camForward around up)
    this.camForward.applyAxisAngle(up, -input.mouse.dx * P.mouseSensitivity);
    this.pitch = clamp(this.pitch + input.mouse.dy * P.mouseSensitivity, P.cameraMinPitch, P.cameraMaxPitch);
    projectOnPlane(this.camForward, up);
    if (this.camForward.lengthSq() < 1e-6) anyPerpendicular(up, this.camForward);
    this.camForward.normalize();
    const right = _v.crossVectors(this.camForward, up).normalize();

    // ---- desired horizontal movement
    const fwdIn = input.axis('KeyS', 'KeyW');
    const sideIn = input.axis('KeyA', 'KeyD');
    const move = new THREE.Vector3().addScaledVector(this.camForward, fwdIn).addScaledVector(right, sideIn);
    let moving = move.lengthSq() > 0.01;
    let running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    // Auto-walk (ship locator): follow the given direction when no keys are pressed,
    // and slowly turn the camera to look where we are going.
    if (!moving && autoDir) {
      move.copy(autoDir);
      projectOnPlane(move, up);
      moving = move.lengthSq() > 1e-6;
      running = true;
      if (moving && input.mouse.dx === 0) this.camForward.lerp(_w.copy(move).normalize(), 1 - Math.exp(-2.5 * dt)).normalize();
    }
    if (moving) move.normalize();
    const speed = this.action ? 0 : running ? P.runSpeed : P.walkSpeed;
    move.multiplyScalar(speed);
    projectOnPlane(this.hVel, up);
    this.hVel.lerp(move, 1 - Math.exp(-P.acceleration * dt));

    // ---- jump + gravity
    if (this.grounded && input.wasPressed('Space') && !this.action) {
      this.vVel = P.jumpVelocity;
      this.grounded = false;
    }
    this.vVel -= P.gravity * dt;
    this.position.addScaledVector(this.hVel, dt).addScaledVector(up, this.vVel * dt);

    // ---- simple obstacle push-out (trees, rocks, ship)
    const local = this.position.clone().sub(center);
    for (const o of planet.obstacles) {
      if (planet.resources && !planet.resources.isObstacleActive(o)) continue;
      this._pushOut(local, o.pos, o.r);
    }
    for (const o of obstacles) {
      this._pushOut(local, _push.copy(o.pos).sub(center), o.r);
    }
    this.position.copy(local).add(center);

    // ---- ground snap
    const dist = local.length();
    const dir = local.divideScalar(dist);
    const groundR = planet.groundRadius(dir);
    if (dist <= groundR) {
      this.position.copy(center).addScaledVector(dir, groundR);
      this.vVel = 0;
      this.grounded = true;
    } else {
      this.grounded = dist - groundR < 0.05 && this.vVel <= 0;
    }
    this.up.copy(dir);

    // ---- face the movement direction (or the target while harvesting)
    const hSpeed = this.hVel.length();
    if (hSpeed > 0.3) {
      _v.copy(this.hVel).normalize();
      this.facing.lerp(_v, 1 - Math.exp(-10 * dt));
    }
    projectOnPlane(this.facing, this.up);
    if (this.facing.lengthSq() < 1e-6) this.facing.copy(this.camForward);
    this.facing.normalize();
    this._orient();
    this._animate(dt, hSpeed);
  }

  /** Push a planet-local point out of a circular obstacle (on the tangent plane). */
  _pushOut(local, obstaclePos, r) {
    const min = r + CONFIG.player.radius;
    const dx = local.x - obstaclePos.x, dy = local.y - obstaclePos.y, dz = local.z - obstaclePos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > (min + 3) * (min + 3)) return;
    const n = this.up;
    const diff = new THREE.Vector3(dx, dy, dz);
    projectOnPlane(diff, n);
    const d = diff.length();
    // Only collide if roughly at the same height (lets you jump on/over small things).
    const vertical = Math.abs(dx * n.x + dy * n.y + dz * n.z);
    if (d < min && d > 1e-4 && vertical < 2.5) {
      local.addScaledVector(diff.divideScalar(d), min - d);
    }
  }

  _orient() {
    quatFromUpForward(this.up, this.facing, this.group.quaternion);
  }

  _animate(dt, hSpeed) {
    const moving = hSpeed > 0.4 && this.grounded;
    this.walkPhase += dt * (moving ? hSpeed * 1.6 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * Math.min(1, hSpeed / 6) * 0.8 : 0;
    const air = this.grounded ? 0 : 1;
    const stride = Math.min(1, hSpeed / 6);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.legs[i].rotation.x = damp(this.legs[i].rotation.x, swing * s - air * 0.4 * s, 14, dt);
      this.arms[i].rotation.x = damp(this.arms[i].rotation.x, -swing * s * 0.9 - air * 0.9, 14, dt);
      this.arms[i].rotation.z = damp(this.arms[i].rotation.z, (i === 0 ? -1 : 1) * air * 0.3, 10, dt);
      // knees bend while a leg swings forward; elbows stay a little bent and pump with the stride
      const knee = moving ? (0.12 + 0.8 * Math.max(0, -Math.cos(this.walkPhase) * s)) * stride : 0;
      this.knees[i].rotation.x = damp(this.knees[i].rotation.x, knee + air * 0.7, 14, dt);
      this.elbows[i].rotation.x = damp(this.elbows[i].rotation.x, -0.22 - Math.abs(swing) * 0.4 - air * 0.3, 12, dt);
    }
    if (this.action === 'harvest') {
      this.actionTime += dt;
      // right arm chops, left arm braces
      this.arms[1].rotation.x = -1.6 + Math.sin(this.actionTime * 11) * 0.9;
      this.elbows[1].rotation.x = -0.45 + Math.sin(this.actionTime * 11) * 0.35;
      this.arms[0].rotation.x = -0.6;
      this.elbows[0].rotation.x = -0.9;
    } else {
      this.actionTime = 0;
    }
    // jump jets fire while airborne; antenna and pack lights blink
    this.jetLevel = damp(this.jetLevel, air, 12, dt);
    for (const j of this.jets) {
      j.visible = this.jetLevel > 0.05;
      j.scale.set(1, this.jetLevel * (0.75 + Math.random() * 0.5), 1);
    }
    this.blinkT += dt;
    this.blinkMat.color.setRGB(3, 1.2, 0.4).multiplyScalar(this.blinkT % 1.4 < 0.18 ? 1 : 0.12);
    // small idle bob of the body
    this.body.position.y = moving ? Math.abs(Math.cos(this.walkPhase)) * 0.06 : damp(this.body.position.y, 0, 8, dt);
  }

  // --------------------------------------------------------------- camera
  getCameraPose(pose, dt = 0.016) {
    const P = CONFIG.player;
    const planet = this.planet;
    const up = this.up;
    pose.target.copy(this.position).addScaledVector(up, P.cameraTargetHeight);
    // Boom direction from the target back toward the camera.
    const boom = new THREE.Vector3()
      .addScaledVector(this.camForward, -Math.cos(this.pitch))
      .addScaledVector(up, Math.sin(this.pitch));
    pose.position.copy(pose.target).addScaledVector(boom, P.cameraDistance);
    // Trees between the camera and the player turn translucent.
    planet.decor.setGhosted(this._occluders(pose.target, boom, P.cameraDistance));
    // keep the camera above the ground
    const local = _v.copy(pose.position).sub(planet.position);
    const d = local.length();
    local.divideScalar(d);
    const minR = planet.groundRadius(local) + 0.7;
    if (d < minR) pose.position.copy(planet.position).addScaledVector(local, minR);
    pose.up.copy(up);
    return pose;
  }

  /**
   * Ray-sphere test from the camera target back along the boom against the
   * canopy and trunk of nearby trees. Returns the flora instance indices
   * that hide the player.
   */
  _occluders(target, boom, maxDist) {
    const planet = this.planet;
    const out = [];
    const c = new THREE.Vector3(), oc = new THREE.Vector3(), oUp = new THREE.Vector3();
    for (const o of planet.obstacles) {
      if (o.flora === undefined) continue;
      c.copy(o.pos).add(planet.position);
      if (c.distanceToSquared(target) > (maxDist + 6) ** 2) continue;
      oUp.copy(o.pos).normalize();
      for (const [h, r] of [[o.cam * 2.1, o.cam * 1.1], [1.0, 0.5]]) {   // canopy, trunk
        oc.copy(target).sub(c).addScaledVector(oUp, -h);
        const b = oc.dot(boom);
        const cc = oc.lengthSq() - r * r;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const tEnter = -b - Math.sqrt(disc), tExit = -b + Math.sqrt(disc);
        if (tExit > 0 && tEnter < maxDist) { out.push(o.flora); break; }
      }
    }
    return out.sort((a, b) => a - b);
  }

  serialize() {
    return {
      planet: this.planet ? this.planet.index : -1,
      pos: this.position.toArray(),
      forward: this.camForward.toArray(),
    };
  }
}
