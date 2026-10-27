// =============================================================
// shop.js (dados) — o que o ferreiro vende.
// A lógica de comprar/vender fica em systems/shop.js.
// =============================================================

export const SHOP = {
  merchantName: 'Brom, o Ferreiro',

  // Consumíveis sempre disponíveis (chaves de CONSUMABLES em data/items.js)
  consumables: ['hp', 'res', 'scroll'],

  // Bases vendidas como itens comuns. Só aparecem as que tiverem nível
  // até (nível do jogador ou andar mais fundo) + 2.
  baseStock: [
    'rusty_sword', 'short_sword', 'broadsword',
    'wooden_staff', 'apprentice_staff', 'bone_wand',
    'short_bow', 'hunting_bow', 'long_bow',
    'buckler', 'kite_shield', 'crystal_orb', 'quiver',
    'leather_cap', 'iron_helm', 'quilted_armor', 'chainmail',
    'leather_gloves', 'gauntlets', 'leather_boots', 'greaves',
  ],

  // Itens mágicos aleatórios sorteados a cada visita ao vilarejo
  magicItemsCount: 3,

  // Multiplicador de preço de compra (1 = preço normal)
  priceMultiplier: 1.0,
};
