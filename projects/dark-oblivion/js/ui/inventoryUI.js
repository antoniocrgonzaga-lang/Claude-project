// =============================================================
// inventoryUI.js — painel do inventário (tecla I).
//   Clique esquerdo na mochila   → equipa
//   Clique esquerdo no equipado  → tira (volta para a mochila)
//   Botão direito com a loja aberta → vende
// O painel é redesenhado inteiro quando algo muda (simples e rápido o bastante).
// =============================================================
import { game } from '../game.js';
import { events } from '../core/events.js';
import { SLOTS } from '../data/items.js';
import { rarityColor, sellPrice } from '../systems/loot.js';
import { tooltip } from './tooltip.js';

export class InventoryUI {
  constructor(ui) {
    this.ui = ui;
    this.el = document.getElementById('panel-inventory');
    this.isOpen = false;
    const rerender = () => { if (this.isOpen) this.render(); };
    events.on('inventoryChanged', rerender);
    events.on('goldChanged', rerender);
  }

  open() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
    tooltip.hide();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  cellHtml(item, player) {
    if (!item) return '';
    const usable = player.inventory.canEquip(item, player).ok;
    return `<span class="item-icon ${usable ? '' : 'unusable'}">${item.icon}</span>`;
  }

  render() {
    const player = game.player;
    const inv = player.inventory;
    tooltip.hide();
    const shopOpen = this.ui.shop.isOpen;

    this.el.innerHTML = `
      <div class="panel-header"><span>Inventário</span><button class="close-btn">✕</button></div>
      <div class="equip-grid">
        ${Object.entries(SLOTS).map(([slot, label]) => `
          <div class="equip-slot slot-${slot}" data-slot="${slot}">
            ${inv.equipment[slot] ? this.cellHtml(inv.equipment[slot], player) : `<span class="equip-label">${label}</span>`}
          </div>`).join('')}
      </div>
      <div class="bag-grid" style="grid-template-columns: repeat(${inv.cols}, 1fr)">
        ${inv.bag.map((item, i) => `<div class="bag-cell" data-index="${i}">${this.cellHtml(item, player)}</div>`).join('')}
      </div>
      <div class="inv-footer">
        <span class="gold">💰 ${player.gold}</span>
        <span class="hint">${shopOpen ? 'Botão direito: vender' : 'Clique: equipar / remover'}</span>
      </div>
    `;

    this.el.querySelector('.close-btn').addEventListener('click', () => this.close());

    // Slots equipados
    for (const el of this.el.querySelectorAll('.equip-slot')) {
      const slot = el.dataset.slot;
      const item = inv.equipment[slot];
      if (item) el.style.borderColor = rarityColor(item.rarity);
      el.addEventListener('click', () => {
        const result = inv.unequip(slot);
        if (!result.ok && result.reason) this.ui.message(result.reason);
      });
      el.addEventListener('mouseenter', (e) => {
        if (item) tooltip.showItem(item, e.clientX, e.clientY, { player, extra: [{ text: `Valor de venda: ${sellPrice(item)} ouro`, cls: 'tt-price' }] });
      });
      el.addEventListener('mouseleave', () => tooltip.hide());
    }

    // Mochila
    for (const el of this.el.querySelectorAll('.bag-cell')) {
      const index = Number(el.dataset.index);
      const item = inv.bag[index];
      if (!item) continue;
      el.style.borderColor = rarityColor(item.rarity);
      el.addEventListener('click', () => {
        const result = inv.equipFromBag(index, player);
        if (!result.ok) this.ui.message(result.reason);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.ui.shop.isOpen) this.ui.shop.sell(index);
        else this.ui.message('Fale com o ferreiro para vender itens.');
      });
      el.addEventListener('mouseenter', (e) => {
        const extra = [{ text: `Valor de venda: ${sellPrice(item)} ouro`, cls: 'tt-price' }];
        tooltip.showItem(item, e.clientX, e.clientY, { player, compare: inv.equipment[item.slot], extra });
      });
      el.addEventListener('mouseleave', () => tooltip.hide());
    }
  }
}
