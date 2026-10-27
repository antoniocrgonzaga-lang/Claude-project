// =============================================================
// knight.js — Cavaleiro (recurso: Fúria)
// A Fúria começa em zero, sobe ao acertar e ao apanhar, e cai devagar
// quando ele fica alguns segundos fora de combate.
// =============================================================

export const knight = {
  id: 'knight',
  name: 'Cavaleiro',
  model: 'knight',
  description: 'Guerreiro de armadura pesada. Gera Fúria em combate e a gasta em golpes especiais.',

  attributes: { str: 30, dex: 15, int: 5, vit: 25 },
  primaryStat: 'str',

  hp: { base: 40, perVit: 3, perLevel: 6 },

  // Tipo 'fury': não regenera; ganha ao acertar/apanhar e decai fora de combate
  resource: {
    id: 'fury', name: 'Fúria', color: '#d2461a', type: 'fury',
    base: 100,            // máximo fixo
    gainOnHit: 8,         // ao acertar um ataque
    gainOnHurt: 4,        // ao receber dano
    decayDelay: 3,        // segundos sem combate antes de começar a cair
    decayPerSecond: 8,
    startFull: false,
  },

  basicAttack: { type: 'melee', range: 1.7, name: 'Ataque com Espada' },

  skillBar: ['powerStrike', 'charge', 'whirlwind', 'warCry'],
  skills: ['powerStrike', 'charge', 'whirlwind', 'warCry', 'weaponMastery', 'shieldBlock', 'rend', 'thornShield', 'berserk'],
  startingSkills: { powerStrike: 1, charge: 1, whirlwind: 1, warCry: 1 },
  startingGear: ['rusty_sword', 'buckler', 'quilted_armor'],
};
