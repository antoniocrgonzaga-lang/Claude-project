/* ==========================================================================
   fx.js — Efeitos visuais pequenos: sombra, pulso de eco e faíscas de coleta
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;
  const _Z = new THREE.Vector3(0, 0, 1);

  /* Sombra redonda simples sob a nave/personagem (ajuda a perceber a altura). */
  ES.BlobShadow = class BlobShadow {
    constructor(scene) {
      this.mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24),
        new THREE.MeshBasicMaterial({
          color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        })
      );
      this.mesh.visible = false;
      scene.add(this.mesh);
    }
    place(point, normal, size, opacity) {
      this.mesh.visible = true;
      this.mesh.position.copy(point).addScaledVector(normal, 0.07);
      this.mesh.quaternion.setFromUnitVectors(_Z, normal);
      this.mesh.scale.setScalar(size);
      this.mesh.material.opacity = opacity;
    }
    hide() { this.mesh.visible = false; }
  };

  /* Pulso de eco: uma bolha de luz que se expande a partir do jogador. */
  ES.EchoPulse = class EchoPulse {
    constructor(scene) {
      this.mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uFade: { value: 0 }, uColor: { value: new THREE.Color(0x49f2ff) } },
        vertexShader: [
          'varying vec3 vN; varying vec3 vV;',
          'void main(){',
          '  vec4 wp = modelMatrix * vec4(position, 1.0);',
          '  vN = normalize(mat3(modelMatrix) * normal);',
          '  vV = normalize(cameraPosition - wp.xyz);',
          '  gl_Position = projectionMatrix * viewMatrix * wp;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform float uFade; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;',
          'void main(){',
          '  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);',
          '  gl_FragColor = vec4(uColor, f * uFade * 0.85);',
          '}',
        ].join('\n'),
      });
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.mat);
      this.mesh.visible = false;
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);
      this.t = 0;
      this.dur = 2.1;
      this.maxRadius = 95;
    }
    emit(worldPos) {
      this.mesh.position.copy(worldPos);
      this.t = 0;
      this.mesh.visible = true;
    }
    update(dt) {
      if (!this.mesh.visible) return;
      this.t += dt;
      const k = this.t / this.dur;
      if (k >= 1) { this.mesh.visible = false; return; }
      const ease = 1 - Math.pow(1 - k, 2.2);
      this.mesh.scale.setScalar(0.5 + ease * this.maxRadius);
      this.mat.uniforms.uFade.value = Math.pow(1 - k, 1.4);
    }
  };

  /* Faíscas quando você coleta um recurso. */
  ES.Burst = class Burst {
    constructor(scene) {
      this.items = [];
      const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      for (let i = 0; i < 48; i++) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
        mesh.visible = false;
        scene.add(mesh);
        this.items.push({ mesh, vel: new THREE.Vector3(), life: 0 });
      }
      this.cursor = 0;
    }
    emit(pos, up, color, count) {
      count = count || 14;
      for (let n = 0; n < count; n++) {
        const it = this.items[this.cursor++ % this.items.length];
        it.mesh.visible = true;
        it.mesh.position.copy(pos);
        it.mesh.material.color.setHex(color);
        it.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
          .multiplyScalar(3 + Math.random() * 5).addScaledVector(up, 2 + Math.random() * 3);
        it.life = 0.8;
      }
    }
    update(dt) {
      for (const it of this.items) {
        if (!it.mesh.visible) continue;
        it.life -= dt;
        if (it.life <= 0) { it.mesh.visible = false; continue; }
        it.vel.multiplyScalar(Math.exp(-2.2 * dt));
        it.mesh.position.addScaledVector(it.vel, dt);
        it.mesh.rotation.x += dt * 5; it.mesh.rotation.y += dt * 4;
        it.mesh.material.opacity = Math.min(1, it.life / 0.5);
        it.mesh.scale.setScalar(0.4 + it.life);
      }
    }
  };
})();
