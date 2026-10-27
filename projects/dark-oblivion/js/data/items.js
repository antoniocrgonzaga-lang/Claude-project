// =============================================================
// items.js — bases de itens, afixos (atributos aleatórios),
// raridades e consumíveis. Só dados.
//
// Um ITEM no jogo é gerado a partir de uma BASE (ex.: "Espada Curta")
// + uma RARIDADE (comum, mágico, raro...) + AFIXOS sorteados.
// A geração fica em systems/loot.js.
// =============================================================

// Slots de equipamento (id → nome mostrado)
export const SLOTS = {
  weapon: 'Arma',
  offhand: 'Segunda Mão',
  helm: 'Capacete',
  chest: 'Peitoral',
  gloves: 'Luvas',
  boots: 'Botas',
  ring: 'Anel',
  amulet: 'Amuleto',
};

// affixes: [mínimo, máximo] de atributos aleatórios
export const RARITIES = {
  common: { name: 'Comum', color: '#e6e6e6', affixes: [0, 0], priceMult: 1 },
  magic: { name: 'Mágico', color: '#6f8cff', affixes: [1, 2], priceMult: 2.5 },
  rare: { name: 'Raro', color: '#ffe14d', affixes: [3, 4], priceMult: 6 },
  unique: { name: 'Único', color: '#d4a017', affixes: [4, 6], priceMult: 12 }, // (próxima etapa: itens únicos com nome fixo)
};
export const RARITY_ORDER = ['common', 'magic', 'rare', 'unique'];

// Chance de cada raridade de acordo com o andar (quanto mais fundo, melhor)
export function rarityWeights(floor) {
  return [
    { rarity: 'common', weight: 70 },
    { rarity: 'magic', weight: 24 + floor * 1.5 },
    { rarity: 'rare', weight: 4 + floor * 0.8 },
    { rarity: 'unique', weight: 0 }, // desligado por enquanto
  ];
}

// ---------------------------------------------------------------
// BASES. Campos:
//   slot, icon (emoji por enquanto; depois pode virar 'assets/icons/x.png'),
//   classes (quem pode usar; sem o campo = todos), level (nível mínimo do item),
//   price (preço base), damage [min,max] e attackSpeed (armas),
//   armor, blockChance, isShield, implicit (bônus fixos da base), minRarity
// ---------------------------------------------------------------
export const ITEM_BASES = {
  // ----- Armas do Cavaleiro -----
  rusty_sword: { name: 'Espada Enferrujada', slot: 'weapon', icon: '🗡️', classes: ['knight'], damage: [3, 6], attackSpeed: 1.2, level: 1, price: 30 },
  short_sword: { name: 'Espada Curta', slot: 'weapon', icon: '🗡️', classes: ['knight'], damage: [4, 7], attackSpeed: 1.25, level: 2, price: 60 },
  broadsword: { name: 'Espada Larga', slot: 'weapon', icon: '⚔️', classes: ['knight'], damage: [6, 12], attackSpeed: 1.1, level: 5, price: 160 },
  war_axe: { name: 'Machado de Guerra', slot: 'weapon', icon: '🪓', classes: ['knight'], damage: [8, 15], attackSpeed: 0.95, level: 8, price: 260 },

  // ----- Armas da Bruxa -----
  wooden_staff: { name: 'Cajado de Madeira', slot: 'weapon', icon: '🔱', classes: ['witch'], damage: [2, 4], attackSpeed: 1.0, level: 1, price: 30, implicit: { spellDamagePct: 5 } },
  apprentice_staff: { name: 'Cajado do Aprendiz', slot: 'weapon', icon: '🔱', classes: ['witch'], damage: [3, 6], attackSpeed: 1.0, level: 3, price: 80, implicit: { spellDamagePct: 12 } },
  bone_wand: { name: 'Varinha de Osso', slot: 'weapon', icon: '🦴', classes: ['witch'], damage: [3, 5], attackSpeed: 1.3, level: 6, price: 200, implicit: { spellDamagePct: 20 } },

  // ----- Armas do Arqueiro -----
  short_bow: { name: 'Arco Curto', slot: 'weapon', icon: '🏹', classes: ['archer'], damage: [3, 6], attackSpeed: 1.3, level: 1, price: 30 },
  hunting_bow: { name: 'Arco de Caça', slot: 'weapon', icon: '🏹', classes: ['archer'], damage: [4, 8], attackSpeed: 1.3, level: 3, price: 90 },
  long_bow: { name: 'Arco Longo', slot: 'weapon', icon: '🏹', classes: ['archer'], damage: [6, 12], attackSpeed: 1.15, level: 6, price: 220 },

  // ----- Segunda mão -----
  buckler: { name: 'Broquel', slot: 'offhand', icon: '🛡️', classes: ['knight'], armor: 4, blockChance: 10, isShield: true, level: 1, price: 30 },
  kite_shield: { name: 'Escudo Pipa', slot: 'offhand', icon: '🛡️', classes: ['knight'], armor: 9, blockChance: 15, isShield: true, level: 5, price: 140 },
  crystal_orb: { name: 'Orbe de Cristal', slot: 'offhand', icon: '🔮', classes: ['witch'], level: 2, price: 70, implicit: { maxResource: 10, spellDamagePct: 5 } },
  quiver: { name: 'Aljava', slot: 'offhand', icon: '🎯', classes: ['archer'], level: 2, price: 60, implicit: { attackSpeedPct: 5 } },

  // ----- Armaduras (todas as classes) -----
  leather_cap: { name: 'Capuz de Couro', slot: 'helm', icon: '⛑️', armor: 3, level: 1, price: 20 },
  iron_helm: { name: 'Elmo de Ferro', slot: 'helm', icon: '⛑️', armor: 7, level: 4, price: 90 },
  quilted_armor: { name: 'Armadura Acolchoada', slot: 'chest', icon: '🥋', armor: 8, level: 1, price: 40 },
  chainmail: { name: 'Cota de Malha', slot: 'chest', icon: '🥋', armor: 18, level: 4, price: 150 },
  plate_mail: { name: 'Armadura de Placas', slot: 'chest', icon: '🥋', armor: 30, level: 9, price: 350 },
  leather_gloves: { name: 'Luvas de Couro', slot: 'gloves', icon: '🧤', armor: 2, level: 1, price: 20 },
  gauntlets: { name: 'Manoplas', slot: 'gloves', icon: '🧤', armor: 5, level: 5, price: 90 },
  leather_boots: { name: 'Botas de Couro', slot: 'boots', icon: '👢', armor: 2, level: 1, price: 20 },
  greaves: { name: 'Grevas', slot: 'boots', icon: '👢', armor: 5, level: 5, price: 90 },

  // ----- Joias (sempre pelo menos mágicas) -----
  ring: { name: 'Anel', slot: 'ring', icon: '💍', level: 1, price: 50, minRarity: 'magic' },
  amulet: { name: 'Amuleto', slot: 'amulet', icon: '📿', level: 1, price: 80, minRarity: 'magic' },
};

// ---------------------------------------------------------------
// AFIXOS: atributos aleatórios. {v} no texto é trocado pelo valor.
//   stat     → nome do atributo usado em entities/stats.js
//   min/max  → valor sorteado no nível 1
//   perLevel → quanto o valor cresce por nível do item
//   slots    → em que tipo de item ele pode aparecer
//   suffix   → nome usado em itens mágicos ("Espada Curta da Ferocidade")
// ---------------------------------------------------------------
const ARMOR_SLOTS = ['helm', 'chest', 'gloves', 'boots', 'offhand'];
const JEWELRY = ['ring', 'amulet'];

export const AFFIXES = [
  { id: 'dmgFlat', stat: 'damageFlat', text: '+{v} de Dano', min: 1, max: 3, perLevel: 0.25, slots: ['weapon', 'gloves', ...JEWELRY], suffix: 'da Ferocidade' },
  { id: 'dmgPct', stat: 'damagePct', text: '+{v}% de Dano', min: 5, max: 15, perLevel: 1, slots: ['weapon', 'amulet'], suffix: 'do Massacre' },
  { id: 'spellPct', stat: 'spellDamagePct', text: '+{v}% de Dano Mágico', min: 5, max: 12, perLevel: 1, slots: ['weapon', 'offhand', 'helm', ...JEWELRY], suffix: 'do Feiticeiro' },
  { id: 'hp', stat: 'maxHp', text: '+{v} de Vida', min: 5, max: 15, perLevel: 2, slots: [...ARMOR_SLOTS, ...JEWELRY], suffix: 'da Vitalidade' },
  { id: 'res', stat: 'maxResource', text: '+{v} de Recurso Máximo', min: 4, max: 10, perLevel: 1, slots: ['helm', 'offhand', ...JEWELRY], suffix: 'da Mente' },
  { id: 'str', stat: 'str', text: '+{v} de Força', min: 1, max: 4, perLevel: 0.3, slots: ['weapon', 'helm', 'chest', 'gloves', 'boots', ...JEWELRY], suffix: 'do Touro' },
  { id: 'dex', stat: 'dex', text: '+{v} de Destreza', min: 1, max: 4, perLevel: 0.3, slots: ['weapon', 'helm', 'chest', 'gloves', 'boots', ...JEWELRY], suffix: 'do Lince' },
  { id: 'int', stat: 'int', text: '+{v} de Inteligência', min: 1, max: 4, perLevel: 0.3, slots: ['weapon', 'helm', 'chest', 'gloves', 'boots', ...JEWELRY], suffix: 'da Coruja' },
  { id: 'vit', stat: 'vit', text: '+{v} de Vitalidade', min: 1, max: 4, perLevel: 0.3, slots: ['helm', 'chest', 'gloves', 'boots', ...JEWELRY], suffix: 'do Urso' },
  { id: 'armor', stat: 'armor', text: '+{v} de Armadura', min: 3, max: 8, perLevel: 1, slots: ARMOR_SLOTS, suffix: 'do Baluarte' },
  { id: 'resFire', stat: 'resFire', text: '+{v}% Resistência a Fogo', min: 5, max: 15, perLevel: 0.5, slots: [...ARMOR_SLOTS, ...JEWELRY], suffix: 'da Salamandra' },
  { id: 'resCold', stat: 'resCold', text: '+{v}% Resistência a Gelo', min: 5, max: 15, perLevel: 0.5, slots: [...ARMOR_SLOTS, ...JEWELRY], suffix: 'do Inverno' },
  { id: 'resLightning', stat: 'resLightning', text: '+{v}% Resistência a Raios', min: 5, max: 15, perLevel: 0.5, slots: [...ARMOR_SLOTS, ...JEWELRY], suffix: 'da Tempestade' },
  { id: 'atkSpd', stat: 'attackSpeedPct', text: '+{v}% Velocidade de Ataque', min: 4, max: 10, perLevel: 0.3, slots: ['weapon', 'gloves', 'ring'], suffix: 'da Rapidez' },
  { id: 'moveSpd', stat: 'moveSpeedPct', text: '+{v}% Velocidade de Movimento', min: 5, max: 12, perLevel: 0.2, slots: ['boots'], suffix: 'do Vento' },
  { id: 'crit', stat: 'critChance', text: '+{v}% Chance de Crítico', min: 1, max: 4, perLevel: 0.1, slots: ['weapon', 'gloves', 'helm', ...JEWELRY], suffix: 'da Precisão' },
  { id: 'lifeOnHit', stat: 'lifeOnHit', text: '+{v} de Vida por Acerto', min: 1, max: 3, perLevel: 0.2, slots: ['weapon', 'gloves', 'ring'], suffix: 'do Vampiro' },
];

// Texto de cada atributo (usado também pelos bônus "implicit" das bases)
export const STAT_TEXT = Object.fromEntries(AFFIXES.map((a) => [a.stat, a.text]));

// Nomes aleatórios para itens raros: "Lamento" + "Carmesim"
export const RARE_NAME_PARTS = {
  first: ['Lamento', 'Presságio', 'Sussurro', 'Juramento', 'Grito', 'Pacto', 'Eco', 'Fardo', 'Destino', 'Tormento'],
  second: ['Carmesim', 'do Abismo', 'de Oblivion', 'das Cinzas', 'do Vazio', 'Infernal', 'Imortal', 'da Ruína', 'do Eclipse', 'Abissal'],
};

// ---------------------------------------------------------------
// CONSUMÍVEIS (ficam num "cinto" com contador, não no inventário).
// As chaves (hp, res, scroll) são as mesmas de player.potions.
// ---------------------------------------------------------------
export const CONSUMABLES = {
  hp: { name: 'Poção de Vida', icon: '❤️', price: 25, key: 'Q', description: 'Recupera 45% da vida.' },
  res: { name: 'Poção de Recurso', icon: '💧', price: 25, key: 'W', description: 'Recupera 50% de Mana / Fúria / Foco.' },
  scroll: { name: 'Pergaminho de Portal', icon: '📜', price: 40, key: 'T', description: 'Abre um portal de volta ao vilarejo (só no Oblivion).' },
};
