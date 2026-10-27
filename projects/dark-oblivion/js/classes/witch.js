// =============================================================
// witch.js — Bruxa Sombria (recurso: Mana)
// Domina quatro elementos: fogo, gelo, eletricidade e trevas.
// As habilidades em si ficam em skills/skillData.js.
// =============================================================

export const witch = {
  id: 'witch',
  name: 'Bruxa Sombria',
  model: 'witch', // id em data/models.js
  description: 'Feiticeira que domina fogo, gelo, eletricidade e trevas. Frágil de perto, devastadora de longe.',

  // Atributos iniciais
  attributes: { str: 10, dex: 15, int: 30, vit: 15 },
  // Atributo que aumenta o dano da classe (+1% de dano por ponto)
  primaryStat: 'int',

  // Vida = base + Vitalidade * perVit + (nível - 1) * perLevel
  hp: { base: 40, perVit: 3, perLevel: 4 },

  // Recurso: tipo 'regen' regenera sozinho com o tempo
  resource: {
    id: 'mana', name: 'Mana', color: '#2f5bd8', type: 'regen',
    base: 30, perInt: 1, perLevel: 2,   // máximo = base + Int * perInt + (nível-1) * perLevel
    regen: 2.5, regenPerInt: 0.04,      // por segundo
    startFull: true,
  },

  // Ataque do clique esquerdo
  basicAttack: { type: 'melee', range: 1.6, name: 'Golpe de Cajado' },

  // As 4 habilidades da barra (teclas 1 a 4)
  skillBar: ['fireBolt', 'iceShard', 'spark', 'drainLife'],
  // Todas as habilidades da classe (aparecem na ficha, tecla C)
  skills: ['fireBolt', 'iceShard', 'spark', 'drainLife', 'frostNova', 'fireball', 'chainLightning', 'shadowOrb', 'meteorShower', 'curseWeakness'],
  // Habilidades que já começam com nível 1
  startingSkills: { fireBolt: 1, iceShard: 1, spark: 1, drainLife: 1 },
  // Itens iniciais (ids de data/items.js), já equipados
  startingGear: ['wooden_staff', 'quilted_armor'],
};
