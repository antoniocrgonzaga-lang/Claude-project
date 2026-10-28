// =============================================================
// shop.js (lógica) — comprar e vender com o ferreiro.
// Os dados (o que é vendido) ficam em data/shop.js.
// Todas as funções devolvem { ok, reason } para a interface mostrar.
// =============================================================
import { SHOP } from '../data/shop.js';
import { ITEM_BASES, CONSUMABLES } from '../data/items.js';
import { CONFIG } from '../config.js';
import { createItem, randomItem, sellPrice } from './loot.js';
import { events } from '../core/events.js';

export const shop = {
  stock: [],

  // Gera o estoque. Chamado sempre que o jogador entra no vilarejo.
  refreshStock(player) {
    const maxLevel = Math.max(player.level, player.deepestFloor) + 2;
    const ilvl = Math.max(1, player.level);
    this.stock = SHOP.baseStock
      .filter((id) => (ITEM_BASES[id].level ?? 1) <= maxLevel)
      .map((id) => createItem(id, 'common', ilvl));
    for (let i = 0; i < SHOP.magicItemsCount; i++) {
      this.stock.push(randomItem(ilvl + 1, { rarity: 'magic', classId: player.classDef.id }));
    }
    events.emit('shopChanged');
  },

  buyPrice(item) {
    return Math.round(item.price * SHOP.priceMultiplier);
  },

  consumablePrice(key) {
    return Math.round(CONSUMABLES[key].price * SHOP.priceMultiplier);
  },

  buyItem(player, index) {
    const item = this.stock[index];
    if (!item) return { ok: false, reason: '' };
    const price = this.buyPrice(item);
    if (player.gold < price) return { ok: false, reason: 'Ouro insuficiente.' };
    if (!player.inventory.add(item)) return { ok: false, reason: 'Inventário cheio!' };
    player.addGold(-price);
    this.stock.splice(index, 1);
    events.emit('shopChanged');
    return { ok: true, reason: `Comprou: ${item.name}` };
  },

  sellFromBag(player, bagIndex) {
    const item = player.inventory.bag[bagIndex];
    if (!item) return { ok: false, reason: '' };
    const price = sellPrice(item);
    player.inventory.removeAt(bagIndex);
    player.addGold(price);
    return { ok: true, reason: `Vendeu ${item.name} por ${price} de ouro.` };
  },

  buyConsumable(player, key) {
    const price = this.consumablePrice(key);
    if (player.gold < price) return { ok: false, reason: 'Ouro insuficiente.' };
    if (player.potions[key] >= CONFIG.potions.maxStack) return { ok: false, reason: 'Você já tem o máximo disso.' };
    player.potions[key]++;
    player.addGold(-price);
    events.emit('potionsChanged');
    return { ok: true, reason: '' };
  },
};
