// =============================================================
// damageNumbers.js — números de dano flutuantes.
//
// São <div>s HTML (texto fica nítido e é fácil de estilizar no CSS).
// A cada quadro, convertemos a posição 3D em pixels da tela e movemos
// a <div> com transform (operação barata para o navegador).
// As <div>s ficam num pool e são reaproveitadas.
// =============================================================
import { game } from '../game.js';

export class DamageNumbers {
  constructor(container) {
    this.container = container;
    this.free = [];
    this.active = [];
  }

  createElement() {
    const el = document.createElement('div');
    this.container.appendChild(el);
    return el;
  }

  // pos = { x, y, z } no mundo
  spawn(pos, text, { color = '#ffffff', crit = false, cls = '' } = {}) {
    const el = this.free.pop() ?? this.createElement();
    el.textContent = crit ? `${text}!` : text;
    el.className = `dmg-number ${cls}${crit ? ' crit' : ''}`;
    el.style.color = color;
    el.style.display = 'block';
    this.active.push({
      el,
      x: pos.x + (Math.random() - 0.5) * 0.6,
      y: pos.y,
      z: pos.z,
      t: 0,
      life: crit ? 1.1 : 0.85,
    });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const n = this.active[i];
      n.t += dt;
      const p = n.t / n.life;
      if (p >= 1) {
        n.el.style.display = 'none';
        this.free.push(n.el);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }
      const s = game.cam.worldToScreen(n.x, n.y + p * 1.2, n.z); // sobe enquanto some
      n.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      n.el.style.opacity = String(1 - p * p);
    }
  }

  clear() {
    for (const n of this.active) {
      n.el.style.display = 'none';
      this.free.push(n.el);
    }
    this.active.length = 0;
  }
}
