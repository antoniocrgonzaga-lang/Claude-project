// =============================================================
// archer.js — Elfo Arqueiro (recurso: Foco, funciona como mana)
// =============================================================

export const archer = {
  id: 'archer',
  name: 'Elfo Arqueiro',
  model: 'archer',
  description: 'Atirador ágil que mantém distância. Usa Foco para disparos especiais e esquivas.',

  attributes: { str: 12, dex: 30, int: 13, vit: 18 },
  primaryStat: 'dex',

  hp: { base: 40, perVit: 3, perLevel: 5 },

  resource: {
    id: 'focus', name: 'Foco', color: '#3fae5a', type: 'regen',
    base: 40, perInt: 0.5, perLevel: 1,
    regen: 3.5, regenPerInt: 0.03,
    startFull: true,
  },

  // Ataque básico à distância: dispara uma flecha
  basicAttack: {
    type: 'projectile', range: 11, name: 'Flecha',
    projectile: { kind: 'arrow', color: 0xe8d9b0, speed: 22, radius: 0.25, range: 13 },
  },

  skillBar: ['multiShot', 'focusedShot', 'roll', 'rapidFire'],
  skills: ['rapidFire', 'multiShot', 'focusedShot', 'roll', 'poisonArrow', 'eagleEye', 'arrowRain', 'explosiveArrow'],
  startingSkills: { multiShot: 1, focusedShot: 1, roll: 1 }, // Tiro Rápido é passiva: começa em 0
  startingGear: ['short_bow', 'quilted_armor'],
};
