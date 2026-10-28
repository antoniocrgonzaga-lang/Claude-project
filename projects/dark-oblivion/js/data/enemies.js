// =============================================================
// enemies.js — tipos de inimigo (só dados, sem lógica).
//
// Para criar um inimigo novo: copie um bloco, mude o id, os números
// e o `model` (que precisa existir em data/models.js). Depois adicione
// o tipo na SPAWN_TABLE para ele aparecer no Oblivion.
//
// Os valores são do ANDAR 1. Em andares mais fundos, vida/dano/XP são
// multiplicados (veja CONFIG.floor em config.js e computeEnemyStats em stats.js).
// =============================================================
import { CONFIG } from '../config.js';

export const ENEMIES = {
  imp: {
    name: 'Diabrete',
    model: 'imp',
    behavior: 'melee',      // 'melee' (corpo a corpo) ou 'ranged' (à distância)
    levelOffset: 0,         // nível = andar + levelOffset
    hp: 24,
    damage: [2, 4],
    damageType: 'physical', // physical | fire | cold | lightning | shadow
    armor: 3,
    resist: {},             // ex.: { fire: 25 } = 25% de resistência a fogo
    moveSpeed: 4.6,
    attackRange: 1.1,
    attackCooldown: 0.9,    // segundos entre ataques
    attackWindup: 0.2,      // tempo entre "começar" o golpe e o dano acontecer
    aggroRange: 9,          // distância em que ele percebe o jogador
    xp: 10,
    gold: [1, 6],
    goldChance: 0.6,
    itemChance: 0.12,
    potionChance: 0.06,
  },

  brute: {
    name: 'Demônio Bruto',
    model: 'brute',
    behavior: 'melee',
    levelOffset: 1,
    hp: 85,
    damage: [8, 13],
    damageType: 'physical',
    armor: 12,
    resist: { fire: 25 },
    moveSpeed: 2.3,
    attackRange: 1.6,
    attackCooldown: 1.8,
    attackWindup: 0.45,
    aggroRange: 8,
    xp: 32,
    gold: [5, 18],
    goldChance: 0.85,
    itemChance: 0.35,
    potionChance: 0.15,
  },

  cultist: {
    name: 'Cultista',
    model: 'cultist',
    behavior: 'ranged',
    levelOffset: 0,
    hp: 34,
    damage: [5, 8],
    damageType: 'fire',
    armor: 4,
    resist: { fire: 40 },
    moveSpeed: 3.2,
    attackRange: 8,
    attackCooldown: 2.0,
    attackWindup: 0.5,
    aggroRange: 11,
    xp: 20,
    gold: [3, 12],
    goldChance: 0.7,
    itemChance: 0.2,
    potionChance: 0.1,
    // Projétil lançado (usa o mesmo sistema das magias do jogador)
    projectile: { kind: 'orb', color: 0xff4411, speed: 9, radius: 0.35, range: 14, scale: 1.3 },
  },
};

// ---------------------------------------------------------------
// CHEFES — aparecem a cada CONFIG.world.bossEvery andares, guardando a escadaria.
// Campos extras:
//   boss, stunImmune, slowResist (0.5 = lentidão pela metade),
//   enrageAtHpPct (entra em fúria: mais rápido), guaranteedDrops,
//   finalBoss (o último chefe: ao morrer, o jogador vence o jogo)
//   abilities: [
//     { type: 'nova', ... }   → onda de fogo ao redor, com aviso no chão (windup)
//     { type: 'volley', ... } → anel de projéteis em todas as direções (count; mais na fúria)
//     { type: 'summon', ... } → convoca servos ao chegar a certas % de vida
//   ]
// ---------------------------------------------------------------
export const BOSSES = {
  bossDemon: {
    name: 'Belzorath, o Carcereiro',
    model: 'bossDemon',
    behavior: 'melee',
    boss: true,
    levelOffset: 2,
    hp: 340,
    damage: [8, 13],
    damageType: 'physical',
    armor: 20,
    resist: { fire: 50, cold: 20 },
    moveSpeed: 2.6,
    attackRange: 2.2,
    attackCooldown: 1.7,
    attackWindup: 0.55,
    aggroRange: 10,
    xp: 350,
    gold: [80, 150],
    goldChance: 1,
    itemChance: 0,
    potionChance: 1,
    stunImmune: true,
    slowResist: 0.5,
    enrageAtHpPct: 0.3,
    guaranteedDrops: [{ rarity: 'rare' }, { rarity: 'rare' }, { rarity: 'magic' }],
    abilities: [
      { type: 'nova', cooldown: 7, initialDelay: 3, windup: 1.2, radius: 4.5, triggerRange: 4, damageMult: 1.3, damageType: 'fire', color: 0xff3300 },
      { type: 'summon', atHpPct: [0.66, 0.33], enemy: 'imp', count: 3 },
    ],
  },

  // Primeiro chefe (andar 5): lobisomem demoníaco, rápido, com garras e rachaduras de fogo
  werewolf: {
    name: 'Fenrak, o Lobisomem Acorrentado',
    model: 'werewolf',
    behavior: 'melee',
    boss: true,
    levelOffset: 2,
    hp: 360,
    damage: [9, 14],
    damageType: 'physical',
    armor: 16,
    resist: { fire: 40, cold: 30, shadow: 20 },
    moveSpeed: 3.2,          // mais rápido que o Belzorath: é uma fera
    attackRange: 2.3,
    attackCooldown: 1.4,
    attackWindup: 0.45,      // o tempo da patada (a animação acerta junto)
    aggroRange: 11,
    xp: 380,
    gold: [90, 160],
    goldChance: 1,
    itemChance: 0,
    potionChance: 1,
    stunImmune: true,
    slowResist: 0.5,
    enrageAtHpPct: 0.35,     // em fúria: mais rápido
    guaranteedDrops: [{ rarity: 'rare' }, { rarity: 'rare' }, { rarity: 'magic' }],
    abilities: [
      // as rachaduras do corpo explodem em fogo em volta dele (com aviso no chão)
      { type: 'nova', cooldown: 7, initialDelay: 4, windup: 1.1, radius: 4.2, triggerRange: 3.8, damageMult: 1.25, damageType: 'fire', color: 0xff4a10 },
      // uiva e chama a matilha de diabretes
      { type: 'summon', atHpPct: [0.66, 0.33], enemy: 'imp', count: 3 },
    ],
  },

  // CHEFE FINAL — guarda o último andar (CONFIG.world.maxFloor)
  finalBoss: {
    name: 'Vorthrax, Senhor do Oblivion',
    model: 'finalBoss',
    behavior: 'melee',
    boss: true,
    finalBoss: true,
    levelOffset: 3,
    hp: 750,
    damage: [10, 16],
    damageType: 'physical',
    armor: 30,
    resist: { fire: 50, cold: 30, lightning: 30, shadow: 50 },
    moveSpeed: 2.4,
    attackRange: 2.8,
    attackCooldown: 1.6,
    attackWindup: 0.6,
    aggroRange: 12,
    xp: 2000,
    gold: [400, 700],
    goldChance: 1,
    itemChance: 0,
    potionChance: 1,
    stunImmune: true,
    slowResist: 0.6,
    enrageAtHpPct: 0.35,
    guaranteedDrops: [{ rarity: 'rare' }, { rarity: 'rare' }, { rarity: 'rare' }, { rarity: 'rare' }, { rarity: 'magic' }, { rarity: 'magic' }],
    abilities: [
      { type: 'nova', cooldown: 6, initialDelay: 3, windup: 1.1, radius: 5.5, triggerRange: 5, damageMult: 1.4, damageType: 'fire', color: 0xff3300 },
      { type: 'volley', cooldown: 5, initialDelay: 5, windup: 0.8, count: 12, enragedCount: 18, triggerRange: 14, damageMult: 0.7, damageType: 'shadow', color: 0xa040ff,
        projectile: { kind: 'orb', speed: 8, radius: 0.4, range: 16, scale: 1.5 } },
      { type: 'summon', atHpPct: [0.75, 0.25], enemy: 'brute', count: 2 },
      { type: 'summon', atHpPct: [0.5], enemy: 'cultist', count: 4 },
    ],
  },
};
Object.assign(ENEMIES, BOSSES); // chefes também são inimigos (mesma classe Enemy)

// Qual chefe aparece em cada andar de chefe: no andar 5, Fenrak (o lobisomem); no último
// andar, o chefe final; nos outros, Belzorath (que fica mais forte a cada vez)
export function bossForFloor(floor) {
  if (floor >= CONFIG.world.maxFloor) return 'finalBoss';
  if (floor === 5) return 'werewolf'; // primeiro chefe
  return 'bossDemon';
}

// Quais inimigos aparecem em cada andar e com que frequência.
// weight = peso no sorteio; weightPerFloor aumenta o peso a cada andar.
export const SPAWN_TABLE = [
  { type: 'imp', minFloor: 1, weight: 6, weightPerFloor: 0 },
  { type: 'cultist', minFloor: 1, weight: 2.5, weightPerFloor: 0.4 },
  { type: 'brute', minFloor: 1, weight: 1.2, weightPerFloor: 0.6 },
];

export function spawnWeightsForFloor(floor) {
  return SPAWN_TABLE
    .filter((e) => floor >= e.minFloor)
    .map((e) => ({ type: e.type, weight: e.weight + e.weightPerFloor * (floor - 1) }));
}
