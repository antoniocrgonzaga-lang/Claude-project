// =============================================================
// camera.js — câmera isométrica com projeção ORTOGRÁFICA.
//
// Na projeção ortográfica não existe perspectiva: objetos longe e perto
// têm o mesmo tamanho (como em Diablo/Darkstone). Por isso o "zoom" não
// é aproximar a câmera, e sim mudar quanto do mundo cabe na tela
// (viewSize).
//
// A câmera fica num ponto ao redor do jogador definido por:
//   yaw   = ângulo horizontal (45° no início; Z/X giram de 90 em 90°)
//   pitch = inclinação para baixo
// =============================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class IsoCamera {
  constructor() {
    const c = CONFIG.camera;
    this.viewSize = c.viewSize;
    this.targetViewSize = c.viewSize;
    this.yaw = Math.PI / 4;
    this.targetYaw = this.yaw;
    this.pitch = THREE.MathUtils.degToRad(c.pitchDeg);
    this.distance = c.distance;
    this.target = new THREE.Vector3(); // ponto que a câmera olha (o jogador)

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this._v = new THREE.Vector3();
    this._screen = { x: 0, y: 0, visible: false };
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.aspect = width / height;
    this.updateProjection();
  }

  updateProjection() {
    const half = this.viewSize / 2;
    this.camera.left = -half * this.aspect;
    this.camera.right = half * this.aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  // Scroll do mouse: direction > 0 afasta, < 0 aproxima
  zoom(direction) {
    const c = CONFIG.camera;
    const factor = direction > 0 ? 1.12 : 1 / 1.12;
    this.targetViewSize = THREE.MathUtils.clamp(this.targetViewSize * factor, c.minViewSize, c.maxViewSize);
  }

  // Gira 90° (dir = +1 ou -1)
  rotate(dir) {
    this.targetYaw += dir * Math.PI / 2;
  }

  // Pula direto para a posição (sem suavizar) — usado ao trocar de área
  snapTo(position) {
    this.target.copy(position);
    this.yaw = this.targetYaw;
    this.applyTransform();
  }

  update(dt, followPosition) {
    const c = CONFIG.camera;
    // "1 - exp(-k*dt)" é um jeito de suavizar que funciona igual em qualquer FPS
    this.target.lerp(followPosition, 1 - Math.exp(-c.followSpeed * dt));
    this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-c.rotateSpeed * dt));

    if (Math.abs(this.targetViewSize - this.viewSize) > 0.001) {
      this.viewSize += (this.targetViewSize - this.viewSize) * (1 - Math.exp(-10 * dt));
      this.updateProjection();
    }
    this.applyTransform();
  }

  applyTransform() {
    const cosP = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cosP * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cosP * this.distance,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  // Converte um ponto 3D do mundo em pixels da tela.
  // Devolve sempre o MESMO objeto (para não criar lixo a cada chamada).
  worldToScreen(x, y, z) {
    const v = this._v.set(x, y, z).project(this.camera); // agora v.x e v.y vão de -1 a 1
    const out = this._screen;
    out.x = (v.x + 1) / 2 * this.width;
    out.y = (1 - v.y) / 2 * this.height;
    out.visible = v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
    return out;
  }
}
