// =============================================================
// inventory.js — mochila em grid + slots de equipamento.
//
// Nesta versão cada item ocupa UMA célula da mochila. (No futuro dá
// para trocar por itens de tamanhos diferentes, estilo Diablo.)
//
// Sempre que algo muda, chamamos onChange() — o Player usa isso para
// recalcular os atributos e avisar a interface.
// =============================================================
import { SLOTS } from '../data/items.js';

export class Inventory {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.bag = new Array(cols * rows).fill(null);
    this.equipment = Object.fromEntries(Object.keys(SLOTS).map((slot) => [slot, null]));
    this.onChange = null;
  }

  changed() { this.onChange?.(); }

  freeIndex() { return this.bag.indexOf(null); }
  isFull() { return this.freeIndex() === -1; }

  // Coloca na primeira célula livre. Devolve false se estiver cheio.
  add(item) {
    const i = this.freeIndex();
    if (i === -1) return false;
    this.bag[i] = item;
    this.changed();
    return true;
  }

  removeAt(index) {
    const item = this.bag[index];
    this.bag[index] = null;
    if (item) this.changed();
    return item;
  }

  // Verifica se o jogador pode usar o item: { ok, reason }
  canEquip(item, player) {
    if (!item || !SLOTS[item.slot]) return { ok: false, reason: 'Esse item não pode ser equipado.' };
    if (item.classes && !item.classes.includes(player.classDef.id)) return { ok: false, reason: 'Sua classe não pode usar esse item.' };
    if (player.level < item.reqLevel) return { ok: false, reason: `Requer nível ${item.reqLevel}.` };
    return { ok: true, reason: '' };
  }

  // Equipa o item da mochila; o que estava equipado volta para o lugar dele
  equipFromBag(index, player) {
    const item = this.bag[index];
    const check = this.canEquip(item, player);
    if (!check.ok) return check;
    const previous = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    this.bag[index] = previous; // pode ser null
    this.changed();
    return { ok: true, reason: '' };
  }

  // Tira do corpo e coloca na mochila
  unequip(slot) {
    const item = this.equipment[slot];
    if (!item) return { ok: false, reason: '' };
    const i = this.freeIndex();
    if (i === -1) return { ok: false, reason: 'Inventário cheio!' };
    this.bag[i] = item;
    this.equipment[slot] = null;
    this.changed();
    return { ok: true, reason: '' };
  }

  // Equipa direto (usado nos itens iniciais), sem verificar nada
  equipDirect(item) {
    this.equipment[item.slot] = item;
    this.changed();
  }

  // ---------- salvar / carregar ----------
  toJSON() {
    return { bag: this.bag, equipment: this.equipment };
  }

  load(data) {
    const size = this.cols * this.rows;
    this.bag = (data.bag ?? []).slice(0, size);
    while (this.bag.length < size) this.bag.push(null);
    for (const slot of Object.keys(this.equipment)) this.equipment[slot] = data.equipment?.[slot] ?? null;
    this.changed();
  }
}
