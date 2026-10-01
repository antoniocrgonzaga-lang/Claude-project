/* ==========================================================================
   player.js — O astronauta blocado (estilo Lego) e o controle a pé
   --------------------------------------------------------------------------
   Andar num planeta redondo: a cada frame
     1. "cima" = direção do centro do planeta até o jogador;
     2. o vetor "heading" (para onde a câmera/corpo olha) é mantido paralelo ao chão;
     3. movemos o jogador ao longo da superfície e depois ajustamos a altura
        com planet.groundAt() (o chão calculado exatamente, sem raycast).
   O modelo olha para +Z (frente).
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  const CFG = {
    walk: 8.5,          // velocidade andando
    run: 15,            // velocidade correndo (Shift)
    jump: 11,           // impulso do pulo
    gravity: 26,        // gravidade (planetas pequenos = gravidade baixa, pulos altos)
    bodyRadius: 0.6,    // raio de colisão com árvores/pedras
    mouseSens: 0.0025,
  };

  const _up = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wish = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _newPos = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  ES.Player = class Player {
    constructor(scene) {
      this.group = new THREE.Group();
      this.group.visible = false;
      scene.add(this.group);

      this.planet = null;
      this.pos = new THREE.Vector3();
      this.up = new THREE.Vector3(0, 1, 0);
      this.heading = new THREE.Vector3(0, 0, -1);   // direção da câmera, paralela ao chão
      this.facing = new THREE.Vector3(0, 0, -1);    // direção do corpo
      this.vel = new THREE.Vector3();
      this.rad = 0;                                 // distância do centro do planeta
      this.vUp = 0;
      this.grounded = true;
      this.camPitch = 0.18;
      this.camDist = 7.5;
      this.firstPerson = false;
      this.walkPhase = 0;
      this.moveAmount = 0;
      this.speedNow = 0;
      this.justLanded = false;
      this.ground = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) };

      this._build();
    }

    /* ======================= MODELO ======================= */
    _build() {
      const mat = (color, extra) => new THREE.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 10, specular: 0x111111 }, extra || {}));
      // "emissive" dá um brilho próprio leve ao traje, para o astronauta continuar visível à noite.
      const suit = mat(0xf2f5f8, { emissive: 0x2a2f3a }), pants = mat(0x2d4a8a, { emissive: 0x0e1830 }), skin = mat(0xffd23f, { emissive: 0x3a2e08 }), pack = mat(0x6f7c8a, { emissive: 0x1a1e24 });
      const orange = mat(0xff7a2e), dark = new THREE.MeshBasicMaterial({ color: 0x1a1a22 });
      const glow = new THREE.MeshBasicMaterial({ color: 0x49f2ff });
      const visor = new THREE.MeshPhongMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.28, shininess: 100, depthWrite: false });
      const box = (w, h, d, material, x, y, z, parent) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
        m.position.set(x, y, z);
        (parent || this.model).add(m);
        return m;
      };

      this.model = new THREE.Group();
      this.model.scale.setScalar(0.85);
      this.group.add(this.model);

      // Pernas (pivô no quadril, para balançar ao andar).
      this.legL = new THREE.Group(); this.legL.position.set(-0.28, 0.85, 0);
      this.legR = new THREE.Group(); this.legR.position.set(0.28, 0.85, 0);
      for (const leg of [this.legL, this.legR]) {
        box(0.46, 0.85, 0.5, pants, 0, -0.425, 0, leg);
        box(0.5, 0.18, 0.62, mat(0x22262e), 0, -0.8, 0.06, leg);        // bota
        this.model.add(leg);
      }
      // Tronco.
      box(1.1, 0.95, 0.6, suit, 0, 1.325, 0);
      box(0.9, 0.22, 0.06, orange, 0, 1.45, 0.33);                       // faixa no peito
      box(0.2, 0.2, 0.06, glow, 0.25, 1.1, 0.33);                        // luzinha
      // Braços (pivô no ombro).
      this.armL = new THREE.Group(); this.armL.position.set(-0.74, 1.72, 0);
      this.armR = new THREE.Group(); this.armR.position.set(0.74, 1.72, 0);
      for (const arm of [this.armL, this.armR]) {
        box(0.34, 0.85, 0.36, suit, 0, -0.4, 0, arm);
        box(0.3, 0.22, 0.32, skin, 0, -0.9, 0, arm);                      // mão
        this.model.add(arm);
      }
      // Cabeça estilo Lego + capacete de vidro.
      box(0.8, 0.72, 0.8, skin, 0, 2.2, 0);
      box(0.11, 0.16, 0.05, dark, -0.18, 2.27, 0.41);                    // olhos
      box(0.11, 0.16, 0.05, dark, 0.18, 2.27, 0.41);
      box(0.34, 0.06, 0.05, dark, 0, 2.05, 0.41);                        // sorriso
      box(1.02, 0.96, 1.02, visor, 0, 2.2, 0);                           // capacete
      box(1.08, 0.12, 1.08, orange, 0, 1.78, 0);                         // anel do capacete
      // Mochila + antena.
      box(0.85, 1.0, 0.36, pack, 0, 1.35, -0.48);
      box(0.12, 0.5, 0.12, pack, 0.3, 2.05, -0.5);
      box(0.18, 0.18, 0.18, glow, 0.3, 2.35, -0.5);

      // Lanterna do capacete (liga à noite).
      this.headlamp = new THREE.PointLight(0xfff0cc, 0, 48, 1.4);
      this.headlamp.position.set(0, 2.4, 0.5);
      this.group.add(this.headlamp);
    }

    /* ======================= SPAWN ======================= */
    /** Coloca o personagem na superfície perto de worldPos, olhando para headingHint. */
    spawnAt(planet, worldPos, headingHint) {
      this.planet = planet;
      _dir.copy(worldPos).sub(planet.center).normalize();
      const g = planet.groundAt(_dir);
      this.rad = g.r;
      this.pos.copy(planet.center).addScaledVector(_dir, this.rad);
      this.up.copy(_dir);
      this.heading.copy(headingHint).addScaledVector(this.up, -headingHint.dot(this.up));
      if (this.heading.lengthSq() < 1e-4) this.heading.set(1, 0, 0).cross(this.up);
      this.heading.normalize();
      this.facing.copy(this.heading);
      this.vel.set(0, 0, 0);
      this.vUp = 0;
      this.grounded = true;
      this.group.visible = true;
      this._applyTransform();
    }

    hide() { this.group.visible = false; }

    /* ======================= ATUALIZAÇÃO ======================= */
    update(dt, input) {
      const planet = this.planet;
      this.justLanded = false;
      _up.copy(this.pos).sub(planet.center).normalize();
      this.up.copy(_up);

      // --- Olhar (mouse / setas) ---
      const m = input.takeMouse();
      const turn = -m.x * CFG.mouseSens + ((input.down('ArrowLeft') ? 1 : 0) - (input.down('ArrowRight') ? 1 : 0)) * 1.9 * dt;
      const tilt = -m.y * 0.0022 + ((input.down('ArrowUp') ? 1 : 0) - (input.down('ArrowDown') ? 1 : 0)) * 1.2 * dt;
      const lo = this.firstPerson ? -1.4 : -0.5, hi = this.firstPerson ? 1.4 : 1.1;
      this.camPitch = ES.clamp(this.camPitch + tilt, lo, hi);
      if (input.wheel) this.camDist = ES.clamp(this.camDist + input.wheel * 0.006, 3.5, 16);

      // Mantém "heading" paralelo ao chão (o "cima" muda conforme andamos pela esfera).
      this.heading.addScaledVector(_up, -this.heading.dot(_up));
      if (this.heading.lengthSq() < 1e-6) this.heading.set(1, 0, 0).cross(_up);
      this.heading.normalize().applyAxisAngle(_up, turn);
      _right.crossVectors(this.heading, _up);       // frente × cima = direita

      // --- Movimento desejado ---
      const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      _wish.set(0, 0, 0).addScaledVector(this.heading, f).addScaledVector(_right, s);
      const hasInput = _wish.lengthSq() > 0;
      if (hasInput) _wish.normalize();
      const topSpeed = input.shift() ? CFG.run : CFG.walk;
      _wish.multiplyScalar(hasInput ? topSpeed : 0);

      this.vel.addScaledVector(_up, -this.vel.dot(_up));   // velocidade sempre paralela ao chão
      this.vel.lerp(_wish, 1 - Math.exp(-(this.grounded ? 14 : 3.5) * dt));
      this.speedNow = this.vel.length();

      // --- Pulo ---
      if (this.grounded && input.pressed('Space')) {
        this.vUp = CFG.jump;
        this.grounded = false;
      }

      // --- Mover, desviar de obstáculos, ajustar à altura do chão ---
      _newPos.copy(this.pos).addScaledVector(this.vel, dt);
      planet.pushOutObstacles(_newPos, CFG.bodyRadius);
      _dir.copy(_newPos).sub(planet.center).normalize();
      const g = planet.groundAt(_dir);

      if (this.grounded) {
        if (g.r >= this.rad) this.rad = g.r;                          // degrau para cima: sobe na hora
        else this.rad = Math.max(g.r, ES.damp(this.rad, g.r, 26, dt)); // para baixo: desce rápido
        if (this.rad - g.r > 0.55) { this.grounded = false; this.vUp = 0; }   // borda alta: começa a cair
      } else {
        this.vUp -= CFG.gravity * dt;
        this.rad += this.vUp * dt;
        if (this.rad <= g.r) {
          this.rad = g.r;
          if (this.vUp < -6) this.justLanded = true;
          this.vUp = 0;
          this.grounded = true;
        }
      }
      this.pos.copy(planet.center).addScaledVector(_dir, this.rad);
      this.up.copy(_dir);
      this.ground.point.copy(planet.center).addScaledVector(_dir, g.r);
      this.ground.normal.copy(g.normal);

      // --- Corpo vira para onde andamos (1ª pessoa: para onde olhamos) ---
      this.facing.addScaledVector(this.up, -this.facing.dot(this.up));
      if (this.facing.lengthSq() < 1e-6) this.facing.copy(this.heading);
      this.facing.normalize();
      const want = (hasInput && !this.firstPerson) ? _wish : this.heading;
      if (want.lengthSq() > 1e-6) {
        _x.copy(want).normalize();
        // Ângulo (com sinal) de "facing" até "want", em torno do eixo "cima".
        _t.crossVectors(this.facing, _x);
        const ang = Math.atan2(this.up.dot(_t), this.facing.dot(_x));
        this.facing.applyAxisAngle(this.up, ang * (1 - Math.exp(-(this.firstPerson ? 30 : 13) * dt)));
      }

      this._animate(dt);
      this._applyTransform();
    }

    _animate(dt) {
      const moving = ES.clamp(this.speedNow / CFG.run, 0, 1.15);
      this.moveAmount = ES.damp(this.moveAmount, this.grounded ? moving : 0, 12, dt);
      this.walkPhase += this.speedNow * dt * 0.75;
      const sw = Math.sin(this.walkPhase) * 0.85 * ES.clamp(this.moveAmount * 1.6, 0, 1);
      if (this.grounded) {
        this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
        this.armL.rotation.x = -sw * 0.9; this.armR.rotation.x = sw * 0.9;
        const idle = Math.sin(performance.now() * 0.002) * 0.03;
        this.armL.rotation.z = -0.05 - idle; this.armR.rotation.z = 0.05 + idle;
        this.model.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.09 * this.moveAmount;
      } else {
        // No ar: braços para cima, pernas abertas.
        this.legL.rotation.x = ES.damp(this.legL.rotation.x, 0.35, 12, dt);
        this.legR.rotation.x = ES.damp(this.legR.rotation.x, -0.25, 12, dt);
        this.armL.rotation.x = ES.damp(this.armL.rotation.x, -2.5, 12, dt);
        this.armR.rotation.x = ES.damp(this.armR.rotation.x, -2.5, 12, dt);
        this.model.position.y = 0;
      }
      this.model.visible = !(this.firstPerson);   // em 1ª pessoa não vemos o próprio corpo
    }

    _applyTransform() {
      this.group.position.copy(this.pos);
      _x.crossVectors(this.up, this.facing).normalize();   // eixo X local do modelo
      _m.makeBasis(_x, this.up, this.facing);
      this.group.quaternion.setFromRotationMatrix(_m);
    }

    /** Posição dos olhos (para câmera em primeira pessoa e pulso de eco). */
    eyePosition(out) { return out.copy(this.pos).addScaledVector(this.up, 1.85); }

    /** Direção para onde a câmera olha, a partir de heading e camPitch. */
    lookDirection(out) {
      return out.copy(this.heading).multiplyScalar(Math.cos(this.camPitch)).addScaledVector(this.up, Math.sin(this.camPitch));
    }
  };
})();
