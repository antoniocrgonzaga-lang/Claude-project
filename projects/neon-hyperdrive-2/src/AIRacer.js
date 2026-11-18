import { CONFIG, DIFFICULTY } from './Config.js';
import { Ship } from './Ship.js';
import { FLAG_OPEN } from './Track.js';
import { clamp } from './Utils.js';

/**
 * Piloto automático: segue pontos de referência ao longo da spline com deslocamento lateral variável
 * (trajetória por dentro das curvas, faixa preferida, desvio e ultrapassagem).
 */
export class AIBrain {
  constructor({ skill = 0.85, aggression = 0.6 } = {}, rng = Math.random, tuning = DIFFICULTY.casual) {
    this.skill = skill;
    this.tuning = tuning;
    this.aggression = aggression;
    this.rng = rng;
    this.laneBias = (rng() - 0.5) * 2;
    this.lanePhase = rng() * 6.28;
    this.mistakeTimer = 4 + rng() * 8;
    this.mistake = 0;
    this.mistakeDir = 1;
    this.avoidSide = 1;
    this.avoidTimer = 0;
    this.wantBoost = false;
    this.out = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false };
  }

  compute(ship, ctx, dt) {
    const track = ctx.track;
    const W = CONFIG.track.halfWidth;
    const A = CONFIG.ai;
    const tune = this.tuning;
    const out = this.out;
    const v = ship.v;
    const look = 18 + v * 0.4;

    // Curvatura atual, à frente (trajetória) e máxima no horizonte de frenagem.
    const kNow = ship.curK;
    const kAhead = track.curvatureAt(ship.s + look * 1.6);
    const horizon = 30 + v * 1.1;
    let kMax = Math.abs(kNow);
    for (let i = 1; i <= 5; i++) kMax = Math.max(kMax, Math.abs(track.curvatureAt(ship.s + (horizon * i) / 5)));

    // Deslocamento lateral desejado: por dentro da curva + faixa pessoal nas retas.
    const line = clamp(kAhead * A.lineGain, -1, 1);
    const personal = this.laneBias * 0.4 + 0.3 * Math.sin(ship.totalDist * 0.0035 + this.lanePhase);
    let targetD = line * W * 0.52 * this.skill + personal * W * 0.6 * (1 - Math.abs(line));
    if (track.flagsAt(ship.s + look) & FLAG_OPEN) targetD *= 0.45;

    // Evita colisões simples e tenta ultrapassar quem está logo à frente.
    this.avoidTimer -= dt;
    let blocker = null;
    let nearest = Infinity;
    const reach = 14 + v * 0.25;
    for (const other of ctx.ships) {
      if (other === ship || other.destroyed || other.falling) continue;
      const gap = track.delta(ship.s, other.s);
      if (gap <= 0 || gap > reach || gap > nearest) continue;
      if (Math.abs(other.d - ship.d) > 4.4 || other.v > v + 8) continue;
      nearest = gap;
      blocker = other;
    }
    if (blocker) {
      if (this.avoidTimer <= 0) {
        this.avoidSide = blocker.d > targetD ? -1 : 1;
        if (Math.abs(blocker.d + this.avoidSide * 6.5) > W - 4) this.avoidSide *= -1;
      }
      this.avoidTimer = 0.9;
      targetD = blocker.d + this.avoidSide * 6.5;
    } else if (this.avoidTimer > 0) {
      targetD += this.avoidSide * 3;
    }
    targetD = clamp(targetD, -(W - 4), W - 4);

    // Direção: compensa a curvatura (feedforward) e corrige o desvio lateral.
    const cap = Math.max(0.25, ship.turnCap);
    const thetaDes = Math.atan2(targetD - ship.d, look);
    let steer = (kNow * v) / cap + (thetaDes - ship.theta) * 2.4;

    // Velocidade alvo conforme a curva mais fechada à frente.
    const cornerRate = ship.stats.turn * 0.72 * (0.88 + 0.3 * this.skill) * tune.corner;
    const vTarget = cornerRate / Math.max(kMax, 1e-5);
    let throttle = v < vTarget ? 1 : 0;
    const brake = v > vTarget * 1.1 ? 1 : 0;

    // Erros ocasionais: pequenas guinadas e alívio do acelerador.
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeTimer = ((5 + this.rng() * 10) / (1.3 - this.skill)) * tune.mistakeGap;
      this.mistake = 0.45 + this.rng() * 0.45;
      this.mistakeDir = this.rng() < 0.5 ? -1 : 1;
    }
    if (this.mistake > 0) {
      this.mistake -= dt;
      steer += this.mistakeDir * 0.4;
      throttle *= 0.4;
    }

    // Boost estratégico: retas, com carga e energia de sobra.
    const straight = kMax < 0.0016;
    if (!this.wantBoost && straight && ship.boostCap > 0.85 - this.aggression * 0.3 - tune.boostEager && ship.energyRatio > 0.5 - tune.boostEager * 0.5) this.wantBoost = true;
    if (this.wantBoost && (kMax > 0.004 || ship.boostCap < 0.12 || ship.energyRatio < 0.35)) this.wantBoost = false;

    // Rubber banding discreto e configurável (nunca acelera quem está à frente do jogador).
    const rb = tune.rubberBand;
    let rubber = 1;
    if (A.rubberBandEnabled && ctx.player && ctx.player !== ship && !ctx.player.finished) {
      const gap = ship.totalDist - ctx.player.totalDist;
      if (gap < -rb.farBehind) rubber += rb.maxHelp * Math.min(1, (-gap - rb.farBehind) / rb.range);
      else if (gap > rb.farAhead) rubber -= rb.maxSlow * Math.min(1, (gap - rb.farAhead) / rb.range);
    }
    ship.rubber = rubber;

    out.steer = clamp(steer, -1, 1);
    out.throttle = throttle;
    out.brake = brake;
    out.boost = this.wantBoost;
    out.drift = Math.abs(steer) > 1.25 && v > 70;
    return out;
  }
}

export class AIRacer extends Ship {
  constructor(options, profile, rng, tuning = DIFFICULTY.casual) {
    super(options);
    this.brain = new AIBrain(profile, rng, tuning);
    // Variação individual de velocidade máxima, conforme a habilidade e a dificuldade.
    const scale = tuning.speedBase + profile.skill * tuning.speedSkill;
    this.stats = { ...this.stats, maxSpeed: this.stats.maxSpeed * scale };
  }

  getInput(ctx, dt) {
    return this.brain.compute(this, ctx, dt);
  }
}
