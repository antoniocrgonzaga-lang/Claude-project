import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { makeFrame } from './Track.js';

const F = makeFrame();
const _desired = new THREE.Vector3();
const _target = new THREE.Vector3();
const _ahead = new THREE.Vector3();

/** Câmera em terceira pessoa com três modos (próxima, distante, cockpit). */
export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.modeIndex = 0;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.roll = 0;
    this.shake = 0;
    this.dist = CONFIG.camera.modes[0].dist;
    this.fov = CONFIG.camera.baseFov;
    this.orbit = 0;
  }

  get mode() { return CONFIG.camera.modes[this.modeIndex]; }

  nextMode() {
    this.modeIndex = (this.modeIndex + 1) % CONFIG.camera.modes.length;
    return this.mode;
  }

  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  snap(ship) {
    this.dir.copy(ship.forward);
    this.up.copy(ship.up);
    this.roll = 0;
    this.shake = 0;
  }

  update(dt, ship, track, boostFx) {
    const C = CONFIG.camera;
    const mode = this.mode;
    const cam = this.camera;
    const speedN = Math.min(1.3, ship.v / ship.stats.maxSpeed);

    // Direção suavizada: mistura nariz e vetor velocidade para não girar bruscamente no drift.
    _desired.copy(ship.forward).multiplyScalar(mode.cockpit ? 1 : 0.55).addScaledVector(ship.velocityDir, mode.cockpit ? 0 : 0.45).normalize();
    this.dir.lerp(_desired, 1 - Math.exp(-(mode.cockpit ? 14 : 6.5) * dt)).normalize();
    this.up.lerp(ship.up, 1 - Math.exp(-5 * dt)).normalize();

    const rollTarget = ship.steer * 0.07 + ship.slip * 0.1;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 4);

    ship.hideBody = !!mode.cockpit;
    if (mode.cockpit) {
      cam.position.copy(ship.position).addScaledVector(this.up, 0.75).addScaledVector(ship.forward, -0.4);
      _target.copy(cam.position).addScaledVector(this.dir, 30);
    } else {
      const distTarget = mode.dist + boostFx * 3.2 + speedN * 1.6;
      this.dist += (distTarget - this.dist) * Math.min(1, dt * 3);
      cam.position.copy(ship.position).addScaledVector(this.dir, -this.dist).addScaledVector(this.up, mode.height);

      // Antecipação: olha parcialmente para um ponto mais à frente na pista.
      _target.copy(ship.position).addScaledVector(this.dir, mode.look).addScaledVector(this.up, 1.6);
      if (!ship.falling) {
        track.frame(ship.s + 26 + ship.v * 0.16, F);
        _ahead.copy(F.pos).addScaledVector(F.R, ship.d * 0.7).addScaledVector(F.U, 2);
        _target.lerp(_ahead, 0.32);
      }
    }

    if (this.shake > 0.001) {
      const a = this.shake * 0.7;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.position.z += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-7 * dt);
    }

    cam.up.copy(this.up).applyAxisAngle(this.dir, this.roll);
    cam.lookAt(_target);

    const fovTarget = C.baseFov + C.speedFov * Math.min(1, speedN) + C.boostFov * boostFx + (mode.cockpit ? 6 : 0);
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Câmera orbital usada nos menus. */
  updateOrbit(dt, target, up) {
    const cam = this.camera;
    this.orbit += dt * 0.35;
    cam.position.set(target.x + Math.cos(this.orbit) * 11, target.y + 3.4, target.z + Math.sin(this.orbit) * 11);
    cam.up.copy(up);
    cam.lookAt(target.x, target.y + 0.4, target.z);
    if (cam.fov !== 55) {
      cam.fov = this.fov = 55;
      cam.updateProjectionMatrix();
    }
  }
}
