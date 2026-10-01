/* ==========================================================================
   ship.js — A nave: modelo 3D, física de voo, pouso e decolagem
   --------------------------------------------------------------------------
   Estados da nave (ship.state):
     FLIGHT   voando livremente (você controla)
     LANDING  pouso automático em andamento (curva suave até o chão)
     LANDED   pousada — o jogador pode sair (F) ou decolar (Espaço)
     TAKEOFF  decolagem automática, depois volta para FLIGHT

   A nave aponta para -Z (convenção do Three.js, igual à câmera).
   Física "arcade": a nave vai para onde o nariz aponta (o deslize lateral é
   amortecido), com aceleração, turbo e um pouco de inércia ao soltar o motor.
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  /* Ajustes de voo — mexa aqui para mudar a "sensação" da nave. */
  const CFG = {
    maxSpeed: 70,          // velocidade máxima normal
    boostSpeed: 210,       // velocidade máxima com turbo (Shift)
    accel: 55,             // aceleração normal
    boostAccel: 150,       // aceleração com turbo
    reverseSpeed: 22,      // velocidade máxima de ré
    coastDrag: 0.22,       // quanto a nave desacelera sozinha ao soltar o motor (por segundo)
    brakeDrag: 2.6,        // força do freio (X ou S)
    lateralDrag: 2.6,      // amortecimento do deslize lateral (faz a nave "seguir o nariz")
    pitchRate: 1.15, yawRate: 0.95, rollRate: 1.9,    // velocidades de giro (rad/s) pelo teclado
    mouseSens: 0.0024,     // sensibilidade do mouse
    fuelUse: 0.55,         // consumo de combustível por segundo (acelerando)
    boostFuelUse: 3.6,     // consumo com turbo
    emptyAccelK: 0.3,      // sem combustível: aceleração reduzida a 30%...
    emptyMaxSpeed: 26,     // ...e velocidade máxima reduzida
  };

  const HOVER = 1.3;       // altura do centro da nave acima do chão quando pousada
  const _X = new THREE.Vector3(1, 0, 0);
  const _Y = new THREE.Vector3(0, 1, 0);
  const _Z = new THREE.Vector3(0, 0, 1);
  const _fwd = new THREE.Vector3();
  const _lat = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _qa = new THREE.Quaternion();
  const _qb = new THREE.Quaternion();
  const _qc = new THREE.Quaternion();

  ES.Ship = class Ship {
    constructor(scene) {
      this.group = new THREE.Group();
      scene.add(this.group);
      this.pos = this.group.position;
      this.quat = this.group.quaternion;
      this.vel = new THREE.Vector3();
      this.speed = 0;
      this.fuel = 100;
      this.maxFuel = 100;
      this.state = 'FLIGHT';
      this.throttle = 0;         // 0..1, para HUD e som
      this.boosting = false;
      this.legs = 0;             // 0 = trem de pouso recolhido, 1 = estendido
      this.planet = null;        // planeta onde está pousada
      this.rates = { pitch: 0, yaw: 0, roll: 0 };
      this.mouseAcc = { x: 0, y: 0 };
      this._prev = new THREE.Vector3();
      this._build();
    }

    static get HOVER() { return HOVER; }

    /* ======================= MODELO ======================= */
    _build() {
      const mat = (color, extra) => new THREE.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 25, specular: 0x222a33 }, extra || {}));
      const hull = mat(0xdfe7ee), accent = mat(0x1fc8c0), dark = mat(0x2a3442);
      const glass = new THREE.MeshPhongMaterial({ color: 0x7fe8ff, emissive: 0x1a6f86, shininess: 90, flatShading: true });
      const add = (parent, geo, material, x, y, z, rx, ry, rz) => {
        const m = new THREE.Mesh(geo, material);
        m.position.set(x, y, z);
        if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
        parent.add(m);
        return m;
      };

      this.model = new THREE.Group();     // grupo que balança (bank) sem afetar a física
      this.group.add(this.model);
      const M = this.model;

      add(M, new THREE.BoxGeometry(1.7, 0.9, 3.4), hull, 0, 0, 0.2);                    // fuselagem
      const nose = add(M, new THREE.ConeGeometry(1.05, 2.4, 4), hull, 0, 0, -2.7);      // nariz
      nose.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
      add(M, new THREE.BoxGeometry(1.72, 0.12, 2.2), accent, 0, 0.5, 0.7);              // faixa de destaque
      add(M, new THREE.BoxGeometry(1.0, 0.5, 1.4), glass, 0, 0.62, -0.7);               // cabine
      add(M, new THREE.BoxGeometry(0.14, 1.2, 1.4), accent, 0, 0.95, 1.65);             // aleta traseira
      for (const sx of [-1, 1]) {
        add(M, new THREE.BoxGeometry(3.3, 0.13, 1.9), hull, sx * 2.2, -0.12, 0.95, 0, 0, sx * 0.07);   // asas
        add(M, new THREE.BoxGeometry(0.13, 0.75, 1.0), accent, sx * 3.85, 0.2, 1.15);                  // pontas
        add(M, new THREE.CylinderGeometry(0.34, 0.4, 1.3, 8), dark, sx * 0.75, -0.05, 2.0, Math.PI / 2, 0, 0);  // motores
      }

      // Chamas dos motores (crescem com o acelerador).
      this.flames = [];
      this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa24d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      this.flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(sx * 0.75, -0.05, 2.65);
        const outer = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.6, 8), this.flameMat);
        outer.rotation.x = Math.PI / 2; outer.position.z = 0.8;
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.0, 8), this.flameCoreMat);
        core.rotation.x = Math.PI / 2; core.position.z = 0.5;
        g.add(outer, core);
        M.add(g);
        this.flames.push(g);
      }

      // Trem de pouso: o grupo escala em Y a partir do topo (recolhe/estende).
      this.gear = new THREE.Group();
      this.gear.position.y = -0.45;
      M.add(this.gear);
      const legPos = [[-1.0, 1.1], [1.0, 1.1], [0, -1.0]];
      for (const p of legPos) {
        add(this.gear, new THREE.BoxGeometry(0.14, 0.85, 0.14), dark, p[0], -0.42, p[1]);
        add(this.gear, new THREE.BoxGeometry(0.55, 0.08, 0.55), accent, p[0], -0.85, p[1]);
      }

      // Luz da cabine: ilumina a nave no lado escuro dos planetas.
      this.light = new THREE.PointLight(0xbfe9ff, 0.7, 30, 1.5);
      this.light.position.set(0, 1.4, 0);
      M.add(this.light);
    }

    /* ======================= VOO ======================= */
    /** Atualiza o voo livre. input = ES.Input, planets = lista de planetas (para colisão). */
    updateFlight(dt, input, planets) {
      const r = this.rates;

      // --- Rotação: teclado (suavizado) + mouse (acumulado e suavizado) ---
      const pitchT = (input.down('ArrowUp') ? 1 : 0) - (input.down('ArrowDown') ? 1 : 0);
      const yawT = (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) - (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0);
      const rollT = (input.down('KeyQ') ? 1 : 0) - (input.down('KeyE') ? 1 : 0);
      const k = 1 - Math.exp(-7 * dt);
      r.pitch += (pitchT * CFG.pitchRate - r.pitch) * k;
      r.yaw += (yawT * CFG.yawRate - r.yaw) * k;
      r.roll += (rollT * CFG.rollRate - r.roll) * k;

      const m = input.takeMouse();
      this.mouseAcc.x += m.x; this.mouseAcc.y += m.y;
      const ka = 1 - Math.exp(-18 * dt);
      const mx = this.mouseAcc.x * ka, my = this.mouseAcc.y * ka;
      this.mouseAcc.x -= mx; this.mouseAcc.y -= my;

      const dPitch = r.pitch * dt - my * CFG.mouseSens;
      const dYaw = r.yaw * dt - mx * CFG.mouseSens;
      const dRoll = r.roll * dt;
      _qa.setFromAxisAngle(_X, dPitch);
      _qb.setFromAxisAngle(_Y, dYaw);
      _qc.setFromAxisAngle(_Z, dRoll);
      this.quat.multiply(_qa).multiply(_qb).multiply(_qc).normalize();

      // Inclinação visual ao curvar (só estética).
      const yawRate = dYaw / Math.max(dt, 1e-4);
      const bank = ES.clamp(-yawRate * 0.35, -0.6, 0.6);
      this.model.rotation.z = ES.damp(this.model.rotation.z, bank, 6, dt);

      // --- Propulsão ---
      _fwd.set(0, 0, -1).applyQuaternion(this.quat);
      const wantFwd = input.down('KeyW');
      const wantRev = input.down('KeyS');
      const hasFuel = this.fuel > 0;
      this.boosting = wantFwd && input.shift() && hasFuel;

      let vF = this.vel.dot(_fwd);
      _lat.copy(this.vel).addScaledVector(_fwd, -vF);
      _lat.multiplyScalar(Math.exp(-CFG.lateralDrag * dt));     // a nave "segue o nariz"

      let accel = this.boosting ? CFG.boostAccel : CFG.accel;
      let maxS = this.boosting ? CFG.boostSpeed : CFG.maxSpeed;
      if (!hasFuel) { accel *= CFG.emptyAccelK; maxS = CFG.emptyMaxSpeed; }

      if (wantFwd) {
        if (vF < maxS) vF = Math.min(maxS, vF + accel * dt);
        else vF = ES.damp(vF, maxS, 1.2, dt);                    // saiu do turbo: volta à velocidade normal
      } else if (wantRev || input.down('KeyX')) {
        vF *= Math.exp(-CFG.brakeDrag * dt);
        if (wantRev && vF < 1) vF = Math.max(-CFG.reverseSpeed, vF - CFG.accel * 0.6 * dt);
      } else {
        vF *= Math.exp(-CFG.coastDrag * dt);
      }
      this.vel.copy(_fwd).multiplyScalar(vF).add(_lat);
      this.speed = this.vel.length();

      // --- Combustível e acelerador (para HUD/som/chamas) ---
      if (wantFwd && hasFuel) this.fuel = Math.max(0, this.fuel - (this.boosting ? CFG.boostFuelUse : CFG.fuelUse) * dt);
      const thrTarget = wantFwd ? (this.boosting ? 1 : 0.7) : (wantRev ? 0.15 : 0);
      this.throttle = ES.damp(this.throttle, thrTarget, 6, dt);

      // --- Integração e colisão com planetas ---
      this.pos.addScaledVector(this.vel, dt);
      this._collide(planets);
    }

    /** Impede a nave de atravessar o chão: empurra para fora e remove a velocidade "para dentro". */
    _collide(planets, margin) {
      margin = margin || 2.3;
      for (const p of planets) {
        _a.copy(this.pos).sub(p.center);
        const dist = _a.length();
        if (dist > p.outerRadius + margin + 2) continue;
        _a.divideScalar(dist);
        const g = p.groundAt(_a);
        const minR = g.r + margin;
        if (dist < minR) {
          this.pos.copy(p.center).addScaledVector(_a, minR);
          const vr = this.vel.dot(_a);
          if (vr < 0) this.vel.addScaledVector(_a, -vr * 1.15);   // leve "quique" para fora
        }
      }
    }

    /* ======================= POUSO ======================= */
    /** Inicia o pouso automático no planeta dado. */
    beginLanding(planet) {
      const L = (this.landing = {});
      L.planet = planet;
      const dir0 = new THREE.Vector3().copy(this.pos).sub(planet.center).normalize();
      const spot = planet.findClearSpot(dir0, 6.5);          // ponto livre de árvores/pedras
      const g = planet.groundAt(spot);
      const up = spot.clone().lerp(g.normal, 0.6).normalize();  // inclina um pouco com o terreno
      L.up = up;
      L.p0 = this.pos.clone();
      L.p1 = spot.clone().multiplyScalar(g.r).addScaledVector(up, HOVER).add(planet.center);
      L.q0 = this.quat.clone();

      // Orientação final: mesma direção "para frente" de agora, mas paralela ao chão.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
      fwd.addScaledVector(up, -fwd.dot(up));
      if (fwd.lengthSq() < 1e-3) {
        // Nariz apontando direto para o planeta: usa o "teto" da nave como direção.
        fwd.set(0, 1, 0).applyQuaternion(this.quat);
        fwd.addScaledVector(up, -fwd.dot(up));
      }
      if (fwd.lengthSq() < 1e-6) fwd.set(Math.abs(up.x) < 0.9 ? 1 : 0, Math.abs(up.x) < 0.9 ? 0 : 1, 0).cross(up);
      fwd.normalize();
      const zAxis = fwd.clone().negate();
      const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
      L.q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, up, zAxis));

      const dist = L.p0.distanceTo(L.p1);
      L.dur = ES.clamp(3.4 + dist / 32, 3.8, 8.5);
      L.t = 0;
      // Tangente inicial: conserva parte da velocidade atual, para a curva ficar suave.
      L.m0 = this.vel.clone();
      const mlen = Math.min(L.m0.length() * L.dur * 0.5, dist * 1.1);
      if (L.m0.lengthSq() > 1e-4) L.m0.setLength(mlen); else L.m0.set(0, 0, 0);
      this.state = 'LANDING';
      this.planet = planet;
    }

    /** Retorna true quando o pouso termina. */
    updateLanding(dt) {
      const L = this.landing;
      this._prev.copy(this.pos);
      L.t = Math.min(1, L.t + dt / L.dur);
      const t = L.t, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2;   // curva de Hermite
      this.pos.copy(L.p0).multiplyScalar(h00).addScaledVector(L.m0, h10).addScaledVector(L.p1, h01);
      this.quat.slerpQuaternions(L.q0, L.q1, ES.smoothstep(0, 0.78, t));
      this.legs = ES.smoothstep(0.22, 0.6, t);
      this.model.rotation.z = ES.damp(this.model.rotation.z, 0, 4, dt);
      this.throttle = ES.damp(this.throttle, 0.25 * (1 - t), 4, dt);
      this._collide([L.planet], 0.95);

      this.vel.copy(this.pos).sub(this._prev).divideScalar(Math.max(dt, 1e-4));
      this.speed = this.vel.length();
      if (t >= 1) {
        this.pos.copy(L.p1);
        this.quat.copy(L.q1);
        this.vel.set(0, 0, 0);
        this.speed = 0;
        this.legs = 1;
        this.throttle = 0;
        this.state = 'LANDED';
        return true;
      }
      return false;
    }

    /* ======================= DECOLAGEM ======================= */
    beginTakeoff() {
      const planet = this.planet;
      this.takeoff = {
        t: 0, dur: 3.0,
        p0: this.pos.clone(),
        up: this.pos.clone().sub(planet.center).normalize(),
        q0: this.quat.clone(),
        q1: this.quat.clone().multiply(_qa.setFromAxisAngle(_X, 0.42)),   // nariz sobe um pouco
      };
      this.state = 'TAKEOFF';
    }

    updateTakeoff(dt) {
      const T = this.takeoff;
      this._prev.copy(this.pos);
      T.t = Math.min(1, T.t + dt / T.dur);
      const e = ES.smoothstep(0, 1, T.t);
      this.pos.copy(T.p0).addScaledVector(T.up, 34 * e);
      this.quat.slerpQuaternions(T.q0, T.q1, ES.smoothstep(0.1, 1, T.t));
      this.legs = 1 - ES.smoothstep(0.35, 0.75, T.t);
      this.throttle = ES.damp(this.throttle, 0.8, 4, dt);
      this.vel.copy(this.pos).sub(this._prev).divideScalar(Math.max(dt, 1e-4));
      this.speed = this.vel.length();
      if (T.t >= 1) {
        this.state = 'FLIGHT';
        this.legs = 0;
        this.vel.copy(T.up).multiplyScalar(12);
        return true;
      }
      return false;
    }

    /* ======================= VISUAL ======================= */
    updateVisuals(dt, time) {
      // Chamas: tamanho e brilho seguem o acelerador, com leve tremida.
      const flick = 0.9 + 0.1 * Math.sin(time * 60) + 0.05 * Math.sin(time * 97);
      const len = (0.15 + this.throttle * (this.boosting ? 2.6 : 1.5)) * flick;
      for (const f of this.flames) { f.scale.set(1, 1, Math.max(0.01, len)); f.visible = this.throttle > 0.03; }
      this.flameMat.opacity = 0.35 + 0.55 * this.throttle;
      this.flameCoreMat.opacity = 0.5 + 0.5 * this.throttle;
      this.gear.scale.y = Math.max(0.001, this.legs);
      this.gear.visible = this.legs > 0.01;
    }
  };
})();
