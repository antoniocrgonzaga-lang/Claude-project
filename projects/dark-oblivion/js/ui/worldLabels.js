// =============================================================
// worldLabels.js — etiquetas HTML "presas" a pontos do mundo 3D:
// nomes dos itens no chão (clicáveis), portais, escadas e NPCs.
// Funciona igual aos números de dano: projetamos a posição 3D na tela.
// =============================================================
import { game } from '../game.js';

export class WorldLabels {
  constructor(container) {
    this.container = container;
    this.labels = [];
    this.free = [];
  }

  // options: { text, color, position: {x,y,z}, className, onClick }
  add({ text, color = '#ffffff', position, className = '', onClick = null }) {
    const el = this.free.pop() ?? document.createElement('div');
    if (!el.parentNode) this.container.appendChild(el);
    el.textContent = text;
    el.className = `world-label ${className}${onClick ? ' clickable' : ''}`;
    el.style.color = color;
    el.style.display = 'block';
    el.onmousedown = onClick
      ? (e) => { e.stopPropagation(); e.preventDefault(); if (e.button === 0) onClick(); }
      : null;
    const label = { el, x: position.x, y: position.y, z: position.z };
    this.labels.push(label);
    return label;
  }

  remove(label) {
    if (!label) return;
    const i = this.labels.indexOf(label);
    if (i < 0) return;
    this.labels.splice(i, 1);
    label.el.style.display = 'none';
    label.el.onmousedown = null;
    this.free.push(label.el);
  }

  update() {
    for (const label of this.labels) {
      const s = game.cam.worldToScreen(label.x, label.y, label.z);
      if (!s.visible) {
        label.el.style.visibility = 'hidden';
        continue;
      }
      label.el.style.visibility = 'visible';
      label.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
  }

  clear() {
    for (const label of [...this.labels]) this.remove(label);
  }
}
