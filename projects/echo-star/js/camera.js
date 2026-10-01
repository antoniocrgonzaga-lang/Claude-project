/* ==========================================================================
   camera.js — Câmera com suavização e transições cinematográficas
   --------------------------------------------------------------------------
   A cada frame o jogo diz "onde a câmera DEVERIA estar" (pose desejada) e o
   CameraRig decide como chegar lá:
     - normalmente: segue a pose com uma suavização (efeito de "elástico");
     - quando muda o modo (sair/entrar na nave, 1ª/3ª pessoa): faz uma
       transição com easing durante alguns segundos (startTransition).
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  ES.CameraRig = class CameraRig {
    constructor(camera) {
      this.camera = camera;
      this.pos = camera.position.clone();
      this.quat = camera.quaternion.clone();
      this.fov = camera.fov;
      this.trans = null;
    }

    /** Começa uma transição suave a partir da pose atual até a pose desejada (que continua mudando). */
    startTransition(duration) {
      this.trans = {
        t: 0, dur: duration,
        fromPos: this.pos.clone(), fromQuat: this.quat.clone(), fromFov: this.fov,
      };
    }

    get transitioning() { return !!this.trans; }

    /**
     * @param {number} dt
     * @param {{pos:THREE.Vector3, quat:THREE.Quaternion, fov:number, kPos:number, kQuat:number}} d  pose desejada
     *        kPos/kQuat = rigidez da suavização (maior = mais colado; Infinity = sem suavização)
     */
    update(dt, d) {
      const tr = this.trans;
      if (tr) {
        tr.t += dt;
        const a = ES.smoothstep(0, 1, tr.t / tr.dur);
        this.pos.lerpVectors(tr.fromPos, d.pos, a);
        this.quat.slerpQuaternions(tr.fromQuat, d.quat, a);
        this.fov = ES.lerp(tr.fromFov, d.fov, a);
        if (tr.t >= tr.dur) this.trans = null;
      } else {
        if (isFinite(d.kPos)) this.pos.lerp(d.pos, 1 - Math.exp(-d.kPos * dt)); else this.pos.copy(d.pos);
        if (isFinite(d.kQuat)) this.quat.slerp(d.quat, 1 - Math.exp(-d.kQuat * dt)); else this.quat.copy(d.quat);
        this.fov = ES.damp(this.fov, d.fov, 4, dt);
      }
      this.camera.position.copy(this.pos);
      this.camera.quaternion.copy(this.quat);
      if (Math.abs(this.camera.fov - this.fov) > 0.01) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    /** Teletransporta a câmera (sem transição) para a pose dada. */
    snapTo(d) {
      this.trans = null;
      this.pos.copy(d.pos);
      this.quat.copy(d.quat);
      this.fov = d.fov;
    }
  };
})();
