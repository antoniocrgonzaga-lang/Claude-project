// =============================================================
// loot.js — geração de itens e itens caídos no chão.
//
// Parte 1: funções que CRIAM itens (createItem, randomItem).
//   Um item é um objeto simples (só dados), assim ele vai direto para
//   o localStorage sem conversão:
//   { uid, baseId, name, rarity, slot, ilvl, reqLevel, damage, armor, affixes: [...], price, ... }
//
// Parte 2: GroundItems — itens/ouro/poções no chão, com um mesh
//   reaproveitado (pool) e uma etiqueta HTML clicável com o nome colorido.
// =============================================================
import * as THREE from 'three';
import { ITEM_BASES, AFFIXES, RARITIES, RARITY_ORDER, RARE_NAME_PARTS, STAT_TEXT, SLOTS, CONSUMABLES, rarityWeights } from '../data/items.js';
import { CLASSES } from '../classes/index.js';
import { CONFIG } from '../config.js';
import { random } from '../core/rng.js';
import { Pool } from '../core/pool.js';
import { getStandardMaterial } from '../core/materials.js';
import { events } from '../core/events.js';
import { game } from '../game.js';

// ======================= PARTE 1: CRIAR ITENS =======================

function makeUid() {
  return 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function rollRarity(floor) {
  return random.weighted(rarityWeights(floor)).rarity;
}

// Cria um item a partir de uma base. ilvl = "nível do item" (afeta os valores dos afixos)
export function createItem(baseId, rarity = 'common', ilvl = 1) {
  const base = ITEM_BASES[baseId];
  if (!base) throw new Error(`Base de item desconhecida: ${baseId}`);

  // Joias nunca são comuns
  if (base.minRarity && RARITY_ORDER.indexOf(rarity) < RARITY_ORDER.indexOf(base.minRarity)) rarity = base.minRarity;
  const rarityDef = RARITIES[rarity];

  const item = {
    uid: makeUid(),
    baseId,
    rarity,
    ilvl,
    name: base.name,
    baseName: base.name,
    slot: base.slot,
    icon: base.icon,
    classes: base.classes ?? null,
    reqLevel: Math.max(base.level ?? 1, Math.floor(ilvl * 0.7)),
    damage: base.damage ? [...base.damage] : null,
    attackSpeed: base.attackSpeed ?? null,
    armor: base.armor ? Math.round(base.armor * (1 + ilvl * 0.04)) : 0,
    blockChance: base.blockChance ?? 0,
    isShield: !!base.isShield,
    implicit: { ...(base.implicit ?? {}) },
    affixes: [],
    price: 0,
  };

  // Sorteia os afixos (sem repetir)
  const [minA, maxA] = rarityDef.affixes;
  const count = random.int(minA, maxA);
  const pool = random.shuffle(AFFIXES.filter((a) => a.slots.includes(base.slot)));
  for (let i = 0; i < count && i < pool.length; i++) {
    const a = pool[i];
    const value = Math.max(1, Math.round(random.range(a.min, a.max) + ilvl * a.perLevel * random.range(0.5, 1)));
    item.affixes.push({ id: a.id, stat: a.stat, value });
  }

  // Nome
  if (rarity === 'magic' && item.affixes.length) {
    const first = AFFIXES.find((a) => a.id === item.affixes[0].id);
    item.name = `${base.name} ${first.suffix}`;
  } else if (rarity === 'rare' || rarity === 'unique') {
    item.name = `${random.pick(RARE_NAME_PARTS.first)} ${random.pick(RARE_NAME_PARTS.second)}`;
  }

  item.price = Math.round(base.price * rarityDef.priceMult + item.affixes.length * 15 * (1 + ilvl * 0.1));
  return item;
}

// Item aleatório. options.rarity força uma raridade; options.classId prefere bases da classe.
export function randomItem(ilvl, options = {}) {
  const bases = Object.entries(ITEM_BASES).filter(([, b]) =>
    (b.level ?? 1) <= ilvl + 1 &&
    (!options.classId || !b.classes || b.classes.includes(options.classId)));
  const [baseId] = random.pick(bases);
  const rarity = options.rarity ?? rollRarity(options.floor ?? 1);
  return createItem(baseId, rarity, ilvl);
}

export function sellPrice(item) {
  return Math.max(1, Math.floor(item.price * CONFIG.economy.sellRatio));
}

// Soma dos atributos do item (bônus fixos da base + afixos). Usado em stats.js
export function itemStats(item) {
  const out = { ...(item.implicit ?? {}) };
  for (const a of item.affixes ?? []) out[a.stat] = (out[a.stat] ?? 0) + a.value;
  return out;
}

export function rarityColor(rarity) {
  return RARITIES[rarity]?.color ?? '#ffffff';
}

// Linhas de texto do tooltip do item: [{ text, cls }]
export function itemTooltipLines(item, player) {
  const lines = [];
  const slotName = SLOTS[item.slot] ?? item.slot;
  const classNames = item.classes ? item.classes.map((c) => CLASSES[c]?.name ?? c).join(', ') : null;
  lines.push({ text: `${slotName} • ${RARITIES[item.rarity].name}`, cls: 'tt-type' });
  if (item.damage) lines.push({ text: `Dano: ${item.damage[0]}–${item.damage[1]}`, cls: '' });
  if (item.attackSpeed) lines.push({ text: `Ataques por segundo: ${item.attackSpeed.toFixed(2)}`, cls: '' });
  if (item.armor) lines.push({ text: `Armadura: ${item.armor}`, cls: '' });
  if (item.blockChance) lines.push({ text: `Chance de bloqueio: ${item.blockChance}%`, cls: '' });
  for (const [stat, value] of Object.entries(item.implicit ?? {})) {
    lines.push({ text: (STAT_TEXT[stat] ?? `${stat} {v}`).replace('{v}', value), cls: 'tt-implicit' });
  }
  for (const a of item.affixes) {
    lines.push({ text: (STAT_TEXT[a.stat] ?? `${a.stat} {v}`).replace('{v}', a.value), cls: 'tt-affix' });
  }
  if (player) {
    if (item.reqLevel > 1) lines.push({ text: `Requer nível ${item.reqLevel}`, cls: player.level < item.reqLevel ? 'tt-bad' : 'tt-req' });
    if (classNames) lines.push({ text: `Classe: ${classNames}`, cls: item.classes.includes(player.classDef.id) ? 'tt-req' : 'tt-bad' });
  }
  return lines;
}

// ======================= PARTE 2: ITENS NO CHÃO =======================

const BAG_GEOMETRY = new THREE.BoxGeometry(0.42, 0.22, 0.32).translate(0, 0.11, 0);
const GOLD_GEOMETRY = new THREE.CylinderGeometry(0.2, 0.25, 0.12, 10).translate(0, 0.06, 0);
const POTION_GEOMETRY = new THREE.CylinderGeometry(0.09, 0.14, 0.34, 8).translate(0, 0.17, 0);

// Materiais com um pouco de brilho próprio, para aparecerem no escuro do Oblivion
function lootMaterials() {
  return {
    common: getStandardMaterial(0xd8d8d8, { emissive: 0x222222 }),
    magic: getStandardMaterial(0x5b7cff, { emissive: 0x1a2a99 }),
    rare: getStandardMaterial(0xffe14d, { emissive: 0x665500 }),
    unique: getStandardMaterial(0xd4a017, { emissive: 0x664400 }),
    gold: getStandardMaterial(0xffcc33, { emissive: 0x553300, metalness: 0.8, roughness: 0.3 }),
    hp: getStandardMaterial(0xdd2222, { emissive: 0x550000 }),
    res: getStandardMaterial(0x2255ee, { emissive: 0x001a66 }),
    scroll: getStandardMaterial(0xe8d8a8, { emissive: 0x333022 }),
  };
}

export class GroundItems {
  constructor(scene) {
    this.scene = scene;
    this.entries = [];
    this.materials = null; // criados na primeira vez
    const makeMesh = (geometry) => () => {
      const mesh = new THREE.Mesh(geometry);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    this.pools = {
      bag: new Pool(makeMesh(BAG_GEOMETRY), (m) => { m.visible = false; }),
      gold: new Pool(makeMesh(GOLD_GEOMETRY), (m) => { m.visible = false; }),
      potion: new Pool(makeMesh(POTION_GEOMETRY), (m) => { m.visible = false; }),
    };
  }

  // kind: 'item' | 'gold' | 'potion'
  // data: o item (kind item), a quantidade (gold) ou o tipo 'hp'|'res'|'scroll' (potion)
  drop(kind, data, x, z) {
    this.materials ??= lootMaterials();
    const entry = { kind, x, z, alive: true, t: 0, item: null, amount: 0, potionType: null, mesh: null, label: null, poolName: null };
    let text, color;

    if (kind === 'gold') {
      entry.amount = data;
      entry.poolName = 'gold';
      entry.mesh = this.pools.gold.acquire();
      entry.mesh.material = this.materials.gold;
      text = `${data} de Ouro`;
      color = '#e8c050';
    } else if (kind === 'potion') {
      entry.potionType = data;
      entry.poolName = data === 'scroll' ? 'bag' : 'potion';
      entry.mesh = this.pools[entry.poolName].acquire();
      entry.mesh.material = this.materials[data];
      text = data === 'res' ? `Poção de ${game.player?.classDef.resource.name ?? 'Recurso'}` : CONSUMABLES[data].name;
      color = data === 'hp' ? '#ff6b6b' : data === 'res' ? '#7fa2ff' : '#e8d8a8';
    } else {
      entry.item = data;
      entry.poolName = 'bag';
      entry.mesh = this.pools.bag.acquire();
      entry.mesh.material = this.materials[data.rarity] ?? this.materials.common;
      text = data.name;
      color = rarityColor(data.rarity);
    }

    entry.mesh.position.set(x, 0, z);
    entry.mesh.rotation.y = Math.random() * Math.PI * 2;
    entry.mesh.visible = true;
    entry.label = game.labels.add({
      text, color,
      position: { x, y: 0.55, z },
      className: 'label-item',
      onClick: () => events.emit('groundItemClicked', entry),
    });
    this.entries.push(entry);
    return entry;
  }

  remove(entry) {
    if (!entry.alive) return;
    entry.alive = false;
    this.pools[entry.poolName].release(entry.mesh);
    game.labels.remove(entry.label);
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
  }

  // O jogador pega o item. Devolve true se conseguiu.
  pickup(entry, player) {
    if (!entry.alive) return false;
    if (entry.kind === 'gold') {
      player.addGold(entry.amount);
    } else if (entry.kind === 'potion') {
      if (player.potions[entry.potionType] >= CONFIG.potions.maxStack) {
        game.ui.message('Você não consegue carregar mais disso.');
        return false;
      }
      player.potions[entry.potionType]++;
      events.emit('potionsChanged');
    } else {
      if (!player.inventory.add(entry.item)) {
        game.ui.message('Inventário cheio!');
        return false;
      }
      game.ui.message(`Pegou: ${entry.item.name}`, rarityColor(entry.item.rarity));
    }
    this.remove(entry);
    return true;
  }

  // Sorteia o que um inimigo derruba ao morrer
  dropFromEnemy(enemy, floor) {
    const def = enemy.def;
    const drops = [];
    if (random.chance(def.goldChance ?? 0.6)) {
      const amount = Math.round(random.range(def.gold[0], def.gold[1]) * (1 + CONFIG.floor.goldPerFloor * (floor - 1)));
      drops.push(['gold', Math.max(1, amount)]);
    }
    if (random.chance(def.potionChance ?? 0)) drops.push(['potion', random.chance(0.6) ? 'hp' : 'res']);
    if (random.chance(0.02)) drops.push(['potion', 'scroll']);
    if (random.chance((def.itemChance ?? 0) + 0.01 * (floor - 1))) {
      const ilvl = Math.max(1, enemy.level + random.int(0, 1));
      drops.push(['item', randomItem(ilvl, { floor })]);
    }
    // Drops garantidos (chefes): ex.: [{ rarity: 'rare' }, { rarity: 'magic' }]
    for (const g of def.guaranteedDrops ?? []) {
      drops.push(['item', randomItem(enemy.level + 1, { floor, rarity: g.rarity })]);
    }

    // Espalha os drops ao redor do inimigo (só em chão livre)
    const grid = game.world.grid;
    for (const [kind, data] of drops) {
      let x = enemy.position.x, z = enemy.position.z;
      const spread = def.boss ? 2.2 : 1.3; // chefe espalha mais (são muitos drops)
      for (let tries = 0; tries < 6; tries++) {
        const a = Math.random() * Math.PI * 2, r = random.range(0.5, spread);
        const tx = enemy.position.x + Math.cos(a) * r, tz = enemy.position.z + Math.sin(a) * r;
        if (grid.isWalkableWorld(tx, tz)) { x = tx; z = tz; break; }
      }
      this.drop(kind, data, x, z);
    }
  }

  update(dt) {
    const player = game.player;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.t += dt;
      // pequeno "pulo" ao cair
      e.mesh.position.y = e.t < 0.4 ? Math.sin((e.t / 0.4) * Math.PI) * 0.5 : 0;
      // ouro e poções são pegos automaticamente ao passar por cima
      if (player?.alive && e.kind !== 'item') {
        if (Math.hypot(player.position.x - e.x, player.position.z - e.z) < CONFIG.player.autoPickupRange) this.pickup(e, player);
      }
    }
  }

  clear() {
    for (const e of [...this.entries]) this.remove(e);
  }
}
