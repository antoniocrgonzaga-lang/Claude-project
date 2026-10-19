/**
 * Camera rig: every frame the active mode supplies a desired pose
 * { position, target, up }. When the mode changes (ship ↔ walking ↔ base
 * view) the rig blends smoothly from where the camera was to the new pose,
 * arcing slightly upward so it does not clip through terrain.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { easeInOut } from './utils.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.blend = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
  }

  /** Begin a smooth blend from the current camera pose. */
  startTransition(duration = CONFIG.camera.transitionTime) {
    this.blend = {
      t: 0,
      duration,
      pos: this.camera.position.clone(),
      quat: this.camera.quaternion.clone(),
    };
  }

  get transitioning() { return !!this.blend; }

  apply(pose, dt) {
    this._m.lookAt(pose.position, pose.target, pose.up);
    this._q.setFromRotationMatrix(this._m);
    const cam = this.camera;
    if (this.blend) {
      const b = this.blend;
      b.t = Math.min(1, b.t + dt / b.duration);
      const k = easeInOut(b.t);
      this._p.lerpVectors(b.pos, pose.position, k).addScaledVector(pose.up, Math.sin(Math.PI * k) * 2.5);
      cam.position.copy(this._p);
      cam.quaternion.slerpQuaternions(b.quat, this._q, k);
      if (b.t >= 1) this.blend = null;
    } else {
      cam.position.copy(pose.position);
      cam.quaternion.copy(this._q);
    }
  }
}
