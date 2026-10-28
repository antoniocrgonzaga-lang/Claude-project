// =============================================================
// shopUI.js — painel da loja do ferreiro.
// Abre junto com o inventário: à esquerda o que ele vende, à direita
// a sua mochila (botão direito num item = vender).
// Fecha sozinho se o jogador se afastar do ferreiro.
// =============================================================
import { game } from '../game.js';
import { events } from '../core/events.js';
import { SHOP } from '../data/shop.js';
import { CONSUMABLES } from '../data/items.js';
import { CONFIG } from '../config.js';
import { shop } from '../systems/shop.js';
import { rarityColor } from '../systems/loot.js';
import { tooltip, esc } from './tooltip.js';

export class ShopUI {
  constructor(ui) {
    this.ui = ui;
    this.el = document.getElementById('panel-shop');
    this.isOpen = false;
    this.merchantPos = null;
    const rerender = () => { if (this.isOpen) this.render(); };
    for (const name of ['shopChanged', 'goldChanged', 'potionsChanged', 'inventoryChanged']) events.on(name, rerender);
  }

  open(merchantPos) {
    this.merchantPos = merchantPos;
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    tooltip.hide();
    if (this.ui.inventory.isOpen) this.ui.inventory.render(); // atualiza a dica "vender"
  }

  // Fecha se o jogador andou para longe
  update() {
    if (!this.isOpen || !this.merchantPos) return;
    const p = game.player;
    if (p.distanceToPoint(this.merchantPos.x, this.merchantPos.z) > 5) this.close();
  }

  sell(bagIndex) {
    const result = shop.sellFromBag(game.player, bagIndex);
    if (result.reason) this.ui.message(result.reason, '#e8c050');
  }

  render() {
    const player = game.player;
    tooltip.hide();
    const resName = player.classDef.resource.name;

    this.el.innerHTML = `
      <div class="panel-header"><span>${esc(SHOP.merchantName)}</span><button class="close-btn">✕</button></div>
      <div class="shop-gold">Seu ouro: <b>💰 ${player.gold}</b></div>

      <div class="section-title">Consumíveis</div>
      ${SHOP.consumables.map((key) => {
        const c = CONSUMABLES[key];
        const name = key === 'res' ? `Poção de ${resName}` : c.name;
        return `
          <div class="shop-row">
            <span class="shop-icon">${c.icon}</span>
            <span class="shop-name">${esc(name)} <small>(você tem ${player.potions[key]}/${CONFIG.potions.maxStack})</small></span>
            <span class="shop-price">${shop.consumablePrice(key)}</span>
            <button class="btn small buy-consumable" data-key="${key}">Comprar</button>
          </div>`;
      }).join('')}

      <div class="section-title">Equipamentos</div>
      <div class="shop-grid">
        ${shop.stock.map((item, i) => `
          <div class="shop-item" data-index="${i}" style="border-color:${rarityColor(item.rarity)}">
            <span class="item-icon ${player.inventory.canEquip(item, player).ok ? '' : 'unusable'}">${item.icon}</span>
            <span class="shop-item-price ${player.gold < shop.buyPrice(item) ? 'expensive' : ''}">${shop.buyPrice(item)}</span>
          </div>`).join('') || '<div class="empty">Nada à venda.</div>'}
      </div>
      <div class="shop-hint">Clique num equipamento para comprar.<br>Botão direito num item da sua mochila para vender (${Math.round(CONFIG.economy.sellRatio * 100)}% do valor).</div>
    `;

    this.el.querySelector('.close-btn').addEventListener('click', () => this.close());

    for (const btn of this.el.querySelectorAll('.buy-consumable')) {
      btn.addEventListener('click', () => {
        const result = shop.buyConsumable(player, btn.dataset.key);
        if (!result.ok) this.ui.message(result.reason);
      });
    }

    for (const el of this.el.querySelectorAll('.shop-item')) {
      const index = Number(el.dataset.index);
      const item = shop.stock[index];
      el.addEventListener('click', () => {
        const result = shop.buyItem(player, index);
        this.ui.message(result.reason, result.ok ? rarityColor(item.rarity) : undefined);
      });
      el.addEventListener('mouseenter', (e) => {
        tooltip.showItem(item, e.clientX, e.clientY, {
          player,
          compare: player.inventory.equipment[item.slot],
          extra: [{ text: `Preço: ${shop.buyPrice(item)} ouro`, cls: 'tt-price' }],
        });
      });
      el.addEventListener('mouseleave', () => tooltip.hide());
    }
  }
}
