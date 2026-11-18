import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { FLAG_OPEN, FLAG_ENERGY, makeFrame } from './Track.js';
import { createShipModel } from './ShipModel.js';
import { clamp, wrapAngle, neon, canvasTexture, disposeObject } from './Utils.js';

const F = makeFrame();
const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();

let glowGeo = null;
let glowTex = null;

function sharedGlow() {
  if (!glowGeo) {
    glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    glowGeo.userData.shared = true;
    glowTex = canvasTexture(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.3)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    glowTex.userData.shared = true;
  }
  return { glowGeo, glowTex };
}

export const NO_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, boost: false, drift: false });

/**
 * Nave em coordenadas locais da pista:
 *   s = distância ao longo da spline, d = deslocamento lateral,
 *   theta = direção do nariz e phi = direção da velocidade (ambas relativas à tangente).
 */
export class Ship {
  constructor({ id, name, def, color, accent, isPlayer = false, bus = null }) {
    this.id = id;
    this.name = name;
    this.def = def;
    this.stats = def.stats;
    this.color = color ?? def.color;
    this.accent = accent ?? def.accent;
    this.isPlayer = isPlayer;
    this.bus = bus;

    this.group = new THREE.Group();
    const model = createShipModel(def.design, this.color, this.accent);
    this.body = model.group;
    this.enginePoints = model.enginePoints;
    this.length = def.design.length;
    this.group.add(this.body);

    const { glowGeo: geo, glowTex: tex } = sharedGlow();
    this.glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, color: neon(this.color, 1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.set(def.design.width * 2.6, 1, this.length * 2.2);
    this.glow.renderOrder = 4;
    this.group.add(this.glow);

    this.position = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.velocityDir = new THREE.Vector3(0, 0, -1);
    this.enginePos = new THREE.Vector3();

    // Ponta da asa no espaço local do modelo (mesmos valores de ShipModel: raiz em 12% da largura, diedro de 0,2 rad).
    const design = def.design;
    this.tipX = design.width * 0.12 + design.wingSpan * Math.cos(0.2);
    this.tipY = 0.02 - design.wingSpan * Math.sin(0.2);

    this.hideBody = false;
    this.bobPhase = Math.random() * 6.28;
    this.roll = 0;
    this.pitch = 0;
    this.rubber = 1;
    this.racePosition = 1;
    this._resetState();
  }

  _resetState() {
    this.s = 0; this.d = 0; this.theta = 0; this.phi = 0; this.v = 0;
    this.y = 0; this.vy = 0; this.lastGy = 0;
    this.steer = 0; this.slip = 0; this.turnCap = 0; this.curK = 0;
    this.airborne = false; this.falling = false; this.onShoulder = false;
    this.destroyed = false; this.destroyTimer = 0; this.invuln = 0;
    this.energy = this.stats.energy; this.boostCap = 1; this.padTimer = 0;
    this.boosting = false; this.drifting = false; this.recharging = false; this.throttle = 0;
    this.totalDist = 0; this.maxDist = 0; this.cpPassed = -1;
    this.lapsDone = 0; this.lapStart = 0; this.lastLap = null; this.bestLap = null;
    this.finished = false; this.finishTime = null;
    this.wallContact = 0;
  }

  emit(type, extra) {
    if (!this.bus) return;
    this.bus.emit(type, { ship: this, ...extra });
  }

  placeOnGrid(track, s, d) {
    this._resetState();
    this.s = track.wrap(s);
    this.d = d;
    this.totalDist = this.maxDist = this.s - track.length;
    this.cpPassed = Math.floor(this.maxDist / (track.length / CONFIG.race.checkpointsPerLap));
    track.frame(this.s, F);
    this.y = this.lastGy = F.pos.y + F.R.y * d;
    this.body.visible = true;
  }

  get energyRatio() { return this.energy / this.stats.energy; }
  get boostActive() { return this.boosting || this.padTimer > 0; }

  // ---------------------------------------------------------------- física arcade

  step(dt, input, ctx) {
    const P = CONFIG.physics;
    const TC = CONFIG.track;
    const track = ctx.track;
    const st = this.stats;

    this.invuln = Math.max(0, this.invuln - dt);
    this.wallContact = Math.max(0, this.wallContact - dt);

    if (this.destroyed) {
      this.destroyTimer -= dt;
      if (this.destroyTimer <= 0) this.respawn(track, true);
      return;
    }

    track.frame(this.s, F);
    this.curK = F.k;
    this.throttle = input.throttle;

    // Direção
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 9);
    const speedN = Math.min(1, this.v / st.maxSpeed);
    this.drifting = input.drift && this.v > 30 && !this.airborne;
    this.turnCap = st.turn * (1 - 0.3 * speedN) * Math.min(1, this.v / 25);
    const turn = this.turnCap * (this.drifting ? P.driftTurnBoost : 1) * (this.airborne ? 0.5 : 1);
    this.theta += this.steer * turn * dt;
    // Correção gradual de alinhamento com a pista (mais forte sem comando de direção).
    const assist = Math.abs(input.steer) < 0.05 ? P.alignAssist : P.alignAssist * 0.15;
    this.theta -= this.theta * Math.min(1, assist * dt);

    // Boost
    const wasBoosting = this.boosting;
    this.boosting = input.boost && this.boostCap > 0.02 && this.energy > st.energy * 0.08 && this.v > 15 && !this.falling;
    if (this.boosting) {
      this.boostCap = Math.max(0, this.boostCap - P.boostDrain * dt);
      this.energy -= P.boostEnergyCost * dt;
      if (!wasBoosting) this.emit('ship:boost');
    } else {
      this.boostCap = Math.min(1, this.boostCap + P.boostRegen * dt);
    }
    this.padTimer = Math.max(0, this.padTimer - dt);

    // Aceleração progressiva, arrasto e limite de velocidade
    let bonus = 0;
    if (this.boosting) bonus += P.boostSpeedBonus * st.boost;
    if (this.padTimer > 0) bonus += P.padSpeedBonus;
    let top = st.maxSpeed * this.rubber * (1 + bonus);
    if (this.onShoulder) top *= P.shoulderSpeedFactor;
    if (!this.falling) {
      const acc = st.accel * (bonus > 0 ? P.boostAccelFactor : 1);
      if (input.throttle > 0) this.v += acc * input.throttle * (1 - this.v / top) * dt;
      else this.v -= this.v * P.coastDrag * dt;
      if (this.v > top) this.v -= (this.v - top) * Math.min(1, (this.onShoulder ? 2.8 : 1.2) * dt);
      if (input.brake > 0) this.v = Math.max(0, this.v - P.brakeForce * input.brake * dt);
    }

    // Aderência: a velocidade gira em direção ao nariz; no drift, mais devagar.
    let diff = wrapAngle(this.theta - this.phi);
    const grip = st.grip * (track.def.grip ?? 1) * (this.drifting ? P.driftGripFactor : 1) * (this.airborne ? 0.15 : 1);
    this.phi += diff * (1 - Math.exp(-grip * dt));
    diff = wrapAngle(this.theta - this.phi);
    this.slip = diff;
    if (!this.airborne) this.v -= this.v * Math.abs(Math.sin(diff)) * P.turnScrub * (this.drifting ? 0.65 : 1) * dt;

    // Integração no referencial da pista. A rotação do referencial gera a força centrífuga.
    const vs = this.v * Math.cos(this.phi);
    const vd = this.v * Math.sin(this.phi);
    const ds = (vs * dt) / Math.max(0.35, 1 - this.d * F.k);
    const prevS = this.s;
    this.d += vd * dt;
    this.s = track.wrap(this.s + ds);
    this.totalDist += ds;
    const rot = F.k * ds;
    this.theta = wrapAngle(this.theta - rot);
    this.phi = wrapAngle(this.phi - rot);

    // Altura, saltos e quedas
    track.frame(this.s, F);
    const flags = track.flagsAt(this.s);
    const open = (flags & FLAG_OPEN) !== 0;
    const absD = Math.abs(this.d);
    const gy = F.pos.y + F.R.y * this.d;
    this.onShoulder = open && absD > TC.halfWidth && !this.airborne;

    if (!this.falling && open && absD > TC.halfWidth + TC.shoulderWidth) {
      this.falling = true;
      this.emit('ship:fall');
    }

    this.vy -= P.gravity * dt;
    this.y += this.vy * dt;
    if (!this.falling) {
      if (this.y <= gy) {
        if (this.airborne && this.vy < -18) this.emit('ship:land');
        this.y = gy;
        this.vy = (gy - this.lastGy) / dt;
        this.airborne = false;
      } else {
        this.airborne = this.y - gy > 0.25;
      }
    } else if (this.y < gy - 45) {
      this.energy = Math.max(5, this.energy - P.fallPenalty);
      this.respawn(track, false);
      return;
    }
    this.lastGy = gy;

    // Áreas de boost e plataformas de salto
    if (!this.airborne && !this.falling && ds > 0) {
      for (const pad of track.pads) {
        if (track.wrap(pad.s - prevS) > ds) continue;
        if (Math.abs(this.d - pad.d) > pad.half + 0.8) continue;
        if (pad.type === 'boost') {
          this.padTimer = P.padDuration;
          this.boostCap = Math.min(1, this.boostCap + P.padRefill);
          this.emit('ship:pad');
        } else {
          this.vy = P.jumpImpulse * (0.55 + 0.45 * speedN);
          this.airborne = true;
          this.emit('ship:jump');
        }
      }
    }

    // Recuperação de energia
    const inLane = (flags & FLAG_ENERGY) !== 0 && absD < TC.energyLaneHalf && !this.airborne;
    this.recharging = inLane && this.energy < st.energy;
    if (this.recharging) this.energy = Math.min(st.energy, this.energy + P.rechargeRate * dt);

    if (this.energy <= 0) {
      this.destroy();
      return;
    }

    this._progress(ctx);
  }

  _progress(ctx) {
    if (this.totalDist <= this.maxDist) return;
    this.maxDist = this.totalDist;
    const K = CONFIG.race.checkpointsPerLap;
    const cpIndex = Math.floor(this.maxDist / (ctx.track.length / K));
    while (this.cpPassed < cpIndex) {
      this.cpPassed++;
      if (this.cpPassed === 0 || this.finished) continue;
      if (this.cpPassed % K !== 0) {
        this.emit('ship:checkpoint', { index: this.cpPassed % K, time: ctx.raceTime });
        continue;
      }
      this.lapsDone = this.cpPassed / K;
      const lapTime = ctx.raceTime - this.lapStart;
      this.lapStart = ctx.raceTime;
      this.lastLap = lapTime;
      const best = this.bestLap == null || lapTime < this.bestLap;
      if (best) this.bestLap = lapTime;
      if (this.lapsDone >= ctx.laps) {
        this.finished = true;
        this.finishTime = ctx.raceTime;
      }
      this.emit('ship:lap', { lap: this.lapsDone, time: lapTime, best, finished: this.finished });
    }
  }

  damage(amount, strong) {
    if (this.invuln > 0 || this.destroyed || this.finished) return;
    this.energy -= amount;
    if (strong) this.invuln = CONFIG.physics.invulnTime;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyTimer = 1.7;
    this.energy = 0;
    this.v = 0;
    this.boosting = false;
    this.padTimer = 0;
    this.emit('ship:destroyed');
  }

  /** Reposiciona a nave no centro da pista (queda, destruição ou tecla R). */
  respawn(track, restoreEnergy) {
    track.frame(this.s, F);
    this.d = 0;
    this.theta = this.phi = 0;
    this.v = Math.min(this.v, 30);
    this.steer = 0;
    this.y = F.pos.y + 2.5;
    this.lastGy = F.pos.y;
    this.vy = 0;
    this.falling = false;
    this.airborne = true;
    this.destroyed = false;
    this.onShoulder = false;
    this.padTimer = 0;
    this.invuln = 2.2;
    if (restoreEnergy) this.energy = this.stats.energy * CONFIG.physics.respawnEnergy;
    this.emit('ship:respawn');
  }

  /** Define a velocidade lateral preservando a componente longitudinal (usado nas colisões). */
  setLateralVelocity(vd) {
    const vs = this.v * Math.cos(this.phi);
    this.v = Math.hypot(vs, vd);
    this.phi = Math.atan2(vd, vs);
  }

  get lateralVelocity() { return this.v * Math.sin(this.phi); }

  // ---------------------------------------------------------------- apresentação

  updateVisual(dt, time, track) {
    const hover = CONFIG.physics.hoverHeight;
    track.frame(this.s, F);
    const gy = F.pos.y + F.R.y * this.d;
    const air = Math.max(-60, this.y - gy);

    const c = Math.cos(this.theta), s = Math.sin(this.theta);
    this.forward.copy(F.T).multiplyScalar(c).addScaledVector(F.R, s).normalize();
    this.up.copy(F.U);
    this.right.crossVectors(this.forward, this.up).normalize();
    this.velocityDir.copy(F.T).multiplyScalar(Math.cos(this.phi)).addScaledVector(F.R, Math.sin(this.phi)).normalize();

    this.position.copy(F.pos).addScaledVector(F.R, this.d).addScaledVector(F.U, hover);
    this.position.y += air;

    _back.copy(this.forward).negate();
    _right.copy(this.right);
    _m.makeBasis(_right, this.up, _back);
    this.group.quaternion.setFromRotationMatrix(_m);
    this.group.position.copy(this.position);

    // Inclinação nas curvas, arfagem nos saltos e oscilação de flutuação.
    const k = Math.min(1, dt * 8);
    const rollTarget = clamp(-this.steer * 0.42 - this.slip * 0.45, -0.55, 0.55);
    const pitchTarget = this.airborne || this.falling ? clamp(this.vy * 0.012, -0.5, 0.3) : (this.boostActive ? 0.03 : 0);
    this.roll += (rollTarget - this.roll) * k;
    this.pitch += (pitchTarget - this.pitch) * k;
    const bob = Math.sin(time * 3.1 + this.bobPhase) * 0.1;
    this.body.rotation.set(this.pitch + Math.sin(time * 2.3 + this.bobPhase) * 0.012, 0, this.roll);
    // A nave sobe ao inclinar para que a ponta da asa mais baixa nunca atravesse o piso.
    const tipDrop = this.tipX * Math.sin(Math.abs(this.roll)) - this.tipY * Math.cos(this.roll);
    const lift = Math.max(0, tipDrop + 0.1 + 0.3 - hover);
    this.body.position.y = (this.airborne ? 0 : bob) + lift;

    const blink = this.invuln > 0 && Math.floor(time * 18) % 2 === 0;
    this.body.visible = !this.destroyed && !this.hideBody && !blink;

    const grounded = clamp(1 - air / 6, 0, 1);
    this.glow.visible = !this.destroyed && !this.falling;
    this.glow.position.y = -(hover + Math.max(0, air)) + 0.14;
    this.glow.material.opacity = (0.45 + 0.35 * Math.min(1, this.v / this.stats.maxSpeed)) * grounded;

    this.enginePos.copy(this.position).addScaledVector(this.forward, -this.length * 0.56);
  }

  dispose() {
    this.group.removeFromParent();
    disposeObject(this.group);
  }
}
