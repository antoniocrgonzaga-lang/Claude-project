// =============================================================
// waypointUI.js — menu de destinos dos waypoints.
//
// Abre ao usar um waypoint no Oblivion, ou o Portal do Oblivion no
// vilarejo (quando já existe algum waypoint ativado).
// Lista: Vilarejo (se estiver no Oblivion), Andar 1 (se estiver no
// vilarejo) e todos os waypoints ativados.
// Fecha sozinho se o jogador se afastar.
// =============================================================
import { game } from '../game.js';
import { tooltip } from './tooltip.js';

export class WaypointUI {
  constructor(ui) {
    this.ui = ui;
    this.el = document.getElementById('panel-waypoint');
    this.isOpen = false;
    this.openedAt = null;
  }

  destinations() {
    const player = game.player;
    const world = game.world;
    const here = world.kind === 'dungeon' ? world.floor : 0;
    const list = [];
    if (world.kind === 'dungeon') {
      list.push({ icon: '🏘️', label: 'Vilarejo de Corvália', go: () => world.goTo('village') });
    } else {
      list.push({ icon: '🔥', label: 'Oblivion — Andar 1', go: () => world.goTo('dungeon', 1) });
    }
    for (const floor of player.waypoints) {
      if (floor === here) continue;
      list.push({ icon: '🌀', label: `Oblivion — Andar ${floor}`, go: () => world.goTo('dungeon', floor) });
    }
    return list;
  }

  open() {
    const list = this.destinations();
    this.isOpen = true;
    this.openedAt = game.player.position.clone();
    tooltip.hide();
    this.el.innerHTML = `
      <div class="panel-header"><span>Portais de Retorno</span><button class="close-btn">✕</button></div>
      <div class="waypoint-sub">Para onde deseja viajar?</div>
      <div class="waypoint-list">
        ${list.map((d, i) => `<button class="btn waypoint-btn" data-index="${i}"><span>${d.icon}</span> ${d.label}</button>`).join('')}
      </div>
    `;
    this.el.querySelector('.close-btn').addEventListener('click', () => this.close());
    for (const btn of this.el.querySelectorAll('.waypoint-btn')) {
      btn.addEventListener('click', () => {
        this.close();
        list[Number(btn.dataset.index)].go();
      });
    }
    this.el.classList.remove('hidden');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  update() {
    if (!this.isOpen || !this.openedAt) return;
    if (game.player.distanceToPoint(this.openedAt.x, this.openedAt.z) > 4) this.close();
  }
}
