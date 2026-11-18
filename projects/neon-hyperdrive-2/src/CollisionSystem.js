import { CONFIG } from './Config.js';
import { FLAG_OPEN } from './Track.js';

/** Colisões arcade em coordenadas da pista: barreiras laterais e contato entre naves. */
export class CollisionSystem {
  constructor(bus) {
    this.bus = bus;
  }

  update(ships, track, dt) {
    for (const ship of ships) this._walls(ship, track, dt);
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) this._pair(ships[i], ships[j], track);
    }
  }

  _walls(ship, track, dt) {
    if (ship.destroyed || ship.falling) return;
    if (track.flagsAt(ship.s) & FLAG_OPEN) return;
    const P = CONFIG.physics;
    const limit = CONFIG.track.halfWidth - P.shipHalfWidth;
    if (Math.abs(ship.d) <= limit) return;

    const side = Math.sign(ship.d);
    ship.d = side * limit;
    const outward = ship.lateralVelocity * side;
    if (outward > 0) {
      // Empurra a nave de volta sem interromper a corrida.
      ship.setLateralVelocity(-side * outward * 0.45);
      ship.theta *= 0.55;
      ship.v *= 1 - Math.min(0.3, outward / 220);
      const strong = outward > 22;
      if (outward > 9) ship.damage(outward * P.wallDamage, strong);
      this.bus.emit('ship:collision', { ship, intensity: Math.min(1, outward / 45), side, kind: 'wall' });
    } else if (ship.wallContact <= 0) {
      this.bus.emit('ship:collision', { ship, intensity: 0.08, side, kind: 'scrape' });
    }
    ship.wallContact = 0.12;
    ship.v -= ship.v * 0.35 * dt;
  }

  _pair(a, b, track) {
    if (a.destroyed || b.destroyed || a.falling || b.falling) return;
    const P = CONFIG.physics;
    const ds = track.delta(a.s, b.s);
    const minS = P.shipHalfLength * 2;
    if (Math.abs(ds) >= minS) return;
    const dd = b.d - a.d;
    const minD = P.shipHalfWidth * 2;
    if (Math.abs(dd) >= minD) return;
    if (Math.abs(a.y - b.y) > 2.2) return;

    const overlapD = minD - Math.abs(dd);
    const overlapS = minS - Math.abs(ds);
    let impact;

    if (overlapD / minD < overlapS / minS) {
      // Contato lateral: separa e troca parte da velocidade lateral.
      const dir = dd >= 0 ? 1 : -1;
      a.d -= dir * overlapD * 0.5;
      b.d += dir * overlapD * 0.5;
      const va = a.lateralVelocity, vb = b.lateralVelocity;
      const closing = (va - vb) * dir;
      impact = Math.max(0, closing);
      if (closing > 0) {
        a.setLateralVelocity(va - dir * closing * 0.85);
        b.setLateralVelocity(vb + dir * closing * 0.85);
      }
      a.setLateralVelocity(a.lateralVelocity - dir * 4);
      b.setLateralVelocity(b.lateralVelocity + dir * 4);
    } else {
      // Toque traseiro: quem vem atrás perde velocidade, quem está à frente ganha um empurrão.
      const rear = ds > 0 ? a : b;
      const front = ds > 0 ? b : a;
      impact = Math.max(0, rear.v - front.v);
      if (impact > 0) {
        const avg = (rear.v + front.v) * 0.5;
        rear.v = avg - 3;
        front.v = avg + 3;
      }
    }

    if (impact > 7) {
      const strong = impact > 24;
      a.damage(impact * P.shipDamage, strong);
      b.damage(impact * P.shipDamage, strong);
    }
    if (impact > 3) {
      const intensity = Math.min(1, impact / 40);
      this.bus.emit('ship:collision', { ship: a, other: b, intensity, side: Math.sign(dd) || 1, kind: 'ship' });
      this.bus.emit('ship:collision', { ship: b, other: a, intensity, side: -Math.sign(dd) || -1, kind: 'ship', silent: true });
    }
  }
}
