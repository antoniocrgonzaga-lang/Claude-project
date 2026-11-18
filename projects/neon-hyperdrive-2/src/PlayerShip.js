import { Ship, NO_INPUT } from './Ship.js';
import { AIBrain } from './AIRacer.js';

export class PlayerShip extends Ship {
  constructor(options) {
    super({ ...options, isPlayer: true });
    // Após cruzar a chegada, a nave segue em piloto automático atrás da tela de resultado.
    this.autopilot = new AIBrain({ skill: 0.85, aggression: 0 });
  }

  getInput(ctx, dt) {
    if (this.finished) {
      const out = this.autopilot.compute(this, ctx, dt);
      out.boost = false;
      out.throttle *= 0.7;
      return out;
    }
    return ctx.input ? ctx.input.state : NO_INPUT;
  }
}
