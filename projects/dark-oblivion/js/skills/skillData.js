// =============================================================
// skillData.js — TODAS as habilidades, descritas como dados.
//
// Cada habilidade escolhe um "behavior" (comportamento), que é o código
// genérico em skills/behaviors.js. Para criar uma habilidade nova quase
// sempre basta copiar um bloco e mudar os números.
//
// Campos comuns:
//   name, class, icon, description
//   implemented  → false = aparece no jogo como "em breve"
//   behavior     → projectile | projectileAoe | multiProjectile | meleeStrike | aoeSelf
//                  | chain | channel | charged | dash | selfBuff | groundAoe | roll | passive
//                  (futuro: curse)
//   maxLevel, requiresLevel
//   requiresShield → só pode ser usada com escudo equipado
//   cost         → { base, perLevel } custo em recurso
//   cooldown     → segundos de recarga
//   castTime     → segundos em que o personagem fica "preso" executando
//   range        → alcance (habilidades corpo a corpo)
//   damage       → { source: 'spell', min, max, perLevel, type }    (magias: dano próprio)
//                  { source: 'weapon', mult, perLevel, type }       (golpes: % do dano da arma)
//                  perLevel = +X (0.15 = +15%) de dano por nível acima do 1
//   projectile   → { kind: 'orb'|'shard'|'arrow', color, speed, radius, range, scale, pierce }
//   onHit        → efeitos ao acertar (veja statusEffects.js):
//                  { effect: 'slow', amount, duration }
//                  { effect: 'stun' | 'freeze', duration }
//                  { effect: 'dot', pctOfHit, duration, damageType, id, icon, name }
//                  qualquer número pode ter "...PerLevel" (ex.: durationPerLevel)
//   params       → parâmetros do comportamento. Qualquer um pode ter "<nome>PerLevel"
//                  (ex.: radius: 4, radiusPerLevel: 0.1) para crescer com o nível.
//   passive      → { perLevel: { atributo: valor }, requiresShield }
//   resourceGain → recurso GANHO ao usar (ex.: Investida e Grito de Guerra geram Fúria)
//   animation    → animação ao usar (padrão: 'attack'; aoeSelf usa 'spin')
//
// Comportamentos "sustentados" (channel, charged) duram enquanto o botão
// direito estiver apertado; o custo é cobrado por eles mesmos.
// =============================================================

// Efeitos de dano contínuo reutilizados por várias habilidades
const BURN = { effect: 'dot', id: 'burn', name: 'Queimadura', icon: '🔥', damageType: 'fire', duration: 3, pctOfHit: 0.3 };

export const SKILLS = {
  // ======================= BRUXA SOMBRIA =======================
  fireBolt: {
    name: 'Seta de Fogo', class: 'witch', icon: '🔥',
    description: 'Dispara uma seta flamejante que causa dano de fogo no primeiro inimigo atingido.',
    implemented: true, behavior: 'projectile',
    cost: { base: 5, perLevel: 0.5 }, cooldown: 0.35, castTime: 0.3,
    damage: { source: 'spell', min: 7, max: 12, perLevel: 0.15, type: 'fire' },
    projectile: { kind: 'orb', color: 0xff6a1a, speed: 17, radius: 0.3, range: 15, scale: 1.1 },
  },
  iceShard: {
    name: 'Estilhaço de Gelo', class: 'witch', icon: '❄️',
    description: 'Lança um estilhaço de gelo que causa dano de frio e deixa o alvo mais lento.',
    implemented: true, behavior: 'projectile',
    cost: { base: 7, perLevel: 0.5 }, cooldown: 0.5, castTime: 0.3,
    damage: { source: 'spell', min: 5, max: 9, perLevel: 0.14, type: 'cold' },
    projectile: { kind: 'shard', color: 0x9ad8ff, speed: 15, radius: 0.3, range: 14, scale: 1.2 },
    onHit: [{ effect: 'slow', amount: 0.45, duration: 2.5, durationPerLevel: 0.1 }],
  },
  spark: {
    name: 'Faísca', class: 'witch', icon: '⚡',
    description: 'Um raio que atinge o alvo e salta em cadeia para inimigos próximos.',
    implemented: true, behavior: 'chain',
    cost: { base: 7, perLevel: 0.6 }, cooldown: 0.6, castTime: 0.3,
    damage: { source: 'spell', min: 3, max: 14, perLevel: 0.15, type: 'lightning' },
    params: { jumps: 3, jumpsPerLevel: 0.2, jumpRange: 5, range: 10 }, // +1 salto a cada 5 níveis
    vfx: { color: 0xfff27a },
  },
  drainLife: {
    name: 'Drenar Vida', class: 'witch', icon: '🩸',
    description: 'Segure o botão direito para canalizar energia sombria num alvo: dano contínuo que recupera parte da vida da bruxa.',
    implemented: true, behavior: 'channel',
    cost: { base: 6, perLevel: 0.5 }, cooldown: 0, castTime: 0,
    damage: { source: 'spell', min: 8, max: 11, perLevel: 0.12, type: 'shadow' }, // por segundo
    params: { tickRate: 0.25, leechPct: 0.4, range: 8, costPerSecond: true },
    vfx: { color: 0x9a30ff },
  },
  frostNova: {
    name: 'Nova Congelante', class: 'witch', icon: '🌨️', requiresLevel: 5,
    description: 'Uma onda de gelo explode ao redor da bruxa, ferindo e CONGELANDO todos os inimigos na área. Depois de descongelar, eles continuam lentos.',
    implemented: true, behavior: 'aoeSelf', animation: 'attack',
    cost: { base: 15, perLevel: 1 }, cooldown: 6, castTime: 0.35,
    damage: { source: 'spell', min: 8, max: 14, perLevel: 0.12, type: 'cold' },
    params: { radius: 4, radiusPerLevel: 0.1 },
    onHit: [
      { effect: 'freeze', duration: 1.5, durationPerLevel: 0.08 },
      { effect: 'slow', amount: 0.5, duration: 4 },
    ],
    vfx: { color: 0x9ad8ff, burst: true },
  },
  fireball: {
    name: 'Bola de Fogo', class: 'witch', icon: '☄️', requiresLevel: 6,
    description: 'Projétil que explode ao tocar em algo, causando dano de fogo em área e deixando os inimigos queimando.',
    implemented: true, behavior: 'projectileAoe',
    cost: { base: 14, perLevel: 1 }, cooldown: 1.0, castTime: 0.4,
    damage: { source: 'spell', min: 14, max: 24, perLevel: 0.15, type: 'fire' },
    params: { radius: 2.5, radiusPerLevel: 0.05 },
    projectile: { kind: 'orb', color: 0xff5a10, speed: 14, radius: 0.35, range: 15, scale: 1.7 },
    onHit: [BURN],
  },
  chainLightning: {
    name: 'Corrente de Relâmpagos', class: 'witch', icon: '🌩️', requiresLevel: 8,
    description: 'Reação em cadeia: um raio poderoso que salta de inimigo em inimigo, eletrocutando cada um por um instante. Salta mais vezes e mais longe a cada nível.',
    implemented: true, behavior: 'chain',
    cost: { base: 16, perLevel: 1 }, cooldown: 1, castTime: 0.35,
    damage: { source: 'spell', min: 8, max: 26, perLevel: 0.14, type: 'lightning' },
    params: { jumps: 5, jumpsPerLevel: 0.34, jumpRange: 6, jumpRangePerLevel: 0.05, range: 12 },
    onHit: [{ effect: 'stun', duration: 0.25 }],
    vfx: { color: 0x9ac8ff, beam: { width: 0.11, jagged: 0.5, duration: 0.25, segments: 8 } },
  },
  shadowOrb: {
    name: 'Orbe Sombrio', class: 'witch', icon: '🔮', requiresLevel: 10,
    description: 'Invoca um orbe de trevas que flutua ao redor da bruxa. Parte de todo dano recebido é absorvida pela MANA em vez da vida.',
    implemented: true, behavior: 'selfBuff',
    cost: { base: 20, perLevel: 1 }, cooldown: 25, castTime: 0.3,
    params: {
      duration: 20, durationPerLevel: 0.5,
      mods: { manaShieldPct: 35, manaShieldCost: 1.5 },          // 35% do dano vai para a mana; 1.5 de mana por ponto
      modsPerLevel: { manaShieldPct: 2.5, manaShieldCost: -0.05 },
      visual: { type: 'orb', color: 0x9a30ff },
    },
    vfx: { color: 0x9a30ff },
  },
  meteorShower: {
    name: 'Chuva de Meteoros', class: 'witch', icon: '🌠', requiresLevel: 12,
    description: 'Meteoros caem do céu sobre a área escolhida, explodindo em fogo e deixando os inimigos queimando.',
    implemented: true, behavior: 'groundAoe',
    cost: { base: 30, perLevel: 1.5 }, cooldown: 8, castTime: 0.5,
    damage: { source: 'spell', min: 12, max: 20, perLevel: 0.14, type: 'fire' }, // por meteoro
    params: {
      range: 12, radius: 3.5, radiusPerLevel: 0.05, count: 8, countPerLevel: 0.5,
      duration: 2.2, impactRadius: 1.4, drop: 'meteor', dropSize: 0.5,
    },
    onHit: [BURN],
    vfx: { color: 0xff5a1a },
  },
  curseWeakness: {
    name: 'Maldição de Fraqueza', class: 'witch', icon: '💀', requiresLevel: 12,
    description: 'Amaldiçoa os inimigos numa área, reduzindo o dano que causam.',
    implemented: false, behavior: 'curse',
    cost: { base: 12, perLevel: 0.5 }, cooldown: 8, castTime: 0.3,
    params: { radius: 4, duration: 8, mods: { damagePct: -30 } },
  },

  // ======================= CAVALEIRO =======================
  powerStrike: {
    name: 'Golpe Poderoso', class: 'knight', icon: '⚔️',
    description: 'Um golpe único e devastador com a arma.',
    implemented: true, behavior: 'meleeStrike',
    cost: { base: 15, perLevel: 0 }, cooldown: 0.6, castTime: 0.4, range: 1.9,
    damage: { source: 'weapon', mult: 2.6, perLevel: 0.12, type: 'physical' },
    vfx: { color: 0xffd27a },
  },
  charge: {
    name: 'Investida', class: 'knight', icon: '🐎',
    description: 'Avança até o inimigo clicado, causando dano e atordoando por pouco tempo. Gera Fúria.',
    implemented: true, behavior: 'dash',
    cost: { base: 0, perLevel: 0 }, cooldown: 5, castTime: 0.2, resourceGain: 15,
    damage: { source: 'weapon', mult: 1.5, perLevel: 0.1, type: 'physical' },
    params: { maxDistance: 9, speed: 22 },
    onHit: [{ effect: 'stun', duration: 1.0, durationPerLevel: 0.05 }],
  },
  whirlwind: {
    name: 'Redemoinho', class: 'knight', icon: '🌀',
    description: 'Gira com a espada, acertando todos os inimigos ao redor.',
    implemented: true, behavior: 'aoeSelf',
    cost: { base: 25, perLevel: 0 }, cooldown: 1.0, castTime: 0.45,
    damage: { source: 'weapon', mult: 1.3, perLevel: 0.1, type: 'physical' },
    params: { radius: 2.6 },
    vfx: { color: 0xdedede },
  },
  warCry: {
    name: 'Grito de Guerra', class: 'knight', icon: '📯',
    description: 'Aumenta o dano e a armadura por alguns segundos. Gera Fúria.',
    implemented: true, behavior: 'selfBuff',
    cost: { base: 0, perLevel: 0 }, cooldown: 18, castTime: 0.3, resourceGain: 30,
    params: { duration: 8, mods: { damagePct: 20, armor: 15 }, modsPerLevel: { damagePct: 3, armor: 3 } },
    vfx: { color: 0xff5a2a },
  },
  rend: {
    name: 'Dilacerar', class: 'knight', icon: '🩸', requiresLevel: 5,
    description: 'Um corte profundo que causa dano e faz o inimigo SANGRAR, continuando a perder vida por alguns segundos. O sangramento ignora armadura.',
    implemented: true, behavior: 'meleeStrike',
    cost: { base: 12, perLevel: 0 }, cooldown: 0.8, castTime: 0.4, range: 1.9,
    damage: { source: 'weapon', mult: 1.6, perLevel: 0.1, type: 'physical' },
    onHit: [{
      effect: 'dot', id: 'bleed', name: 'Sangramento', icon: '🩸', damageType: 'bleed',
      pctOfHit: 1.0, pctOfHitPerLevel: 0.08, duration: 5, durationPerLevel: 0.1,
    }],
    vfx: { color: 0xd01818 },
  },
  thornShield: {
    name: 'Escudo de Espinhos', class: 'knight', icon: '🛡️', requiresLevel: 8, requiresShield: true,
    description: 'Reforça o escudo com espinhos: mais bloqueio e armadura, e todo golpe recebido (mesmo bloqueado) devolve uma porcentagem do dano ao atacante. Requer escudo.',
    implemented: true, behavior: 'selfBuff',
    cost: { base: 20, perLevel: 0 }, cooldown: 16, castTime: 0.3,
    params: {
      duration: 8, durationPerLevel: 0.25,
      mods: { reflectPct: 30, blockChance: 8, armor: 10 },
      modsPerLevel: { reflectPct: 4, blockChance: 1, armor: 3 },
      visual: { type: 'aura', color: 0xbfd0ff },
    },
    vfx: { color: 0xbfd0ff },
  },
  berserk: {
    name: 'Fúria Berserker', class: 'knight', icon: '😡', requiresLevel: 12,
    description: 'Entra em fúria cega: cresce, ganha muito dano e velocidade de ataque, mas perde parte da armadura. A perda de armadura diminui a cada nível.',
    implemented: true, behavior: 'selfBuff',
    cost: { base: 40, perLevel: 0 }, cooldown: 22, castTime: 0.3,
    params: {
      duration: 8, durationPerLevel: 0.3,
      mods: { damagePct: 35, attackSpeedPct: 15, armorPct: -35 },
      modsPerLevel: { damagePct: 5, attackSpeedPct: 1.5, armorPct: 0.8 },
      visual: { type: 'aura', color: 0xff2a10, grow: 1.15 },
    },
    vfx: { color: 0xff2a10 },
  },
  weaponMastery: {
    name: 'Maestria com Armas', class: 'knight', icon: '🗡️',
    description: 'Passiva: aumenta o dano físico a cada ponto investido.',
    implemented: true, behavior: 'passive',
    passive: { perLevel: { damagePct: 6 } },
  },
  shieldBlock: {
    name: 'Bloqueio com Escudo', class: 'knight', icon: '🔰',
    description: 'Passiva: aumenta a chance de bloquear golpes físicos. Requer um escudo equipado.',
    implemented: true, behavior: 'passive',
    passive: { perLevel: { blockChance: 3 }, requiresShield: true },
  },

  // ======================= ELFO ARQUEIRO =======================
  rapidFire: {
    name: 'Tiro Rápido', class: 'archer', icon: '💨',
    description: 'Passiva: aumenta a velocidade de ataque a cada ponto investido.',
    implemented: true, behavior: 'passive',
    passive: { perLevel: { attackSpeedPct: 8 } },
  },
  multiShot: {
    name: 'Tiro Múltiplo', class: 'archer', icon: '🏹',
    description: 'Dispara de 3 a 5 flechas em leque (uma flecha extra a cada 3 níveis).',
    implemented: true, behavior: 'multiProjectile',
    cost: { base: 10, perLevel: 0.5 }, cooldown: 0.6, castTime: 0.3,
    damage: { source: 'weapon', mult: 0.8, perLevel: 0.06, type: 'physical' },
    params: { count: 3, maxCount: 5, extraEvery: 3, spreadDeg: 36 },
    projectile: { kind: 'arrow', color: 0xe8d9b0, speed: 22, radius: 0.25, range: 13 },
  },
  focusedShot: {
    name: 'Tiro Concentrado', class: 'archer', icon: '🎯',
    description: 'Segure para carregar; ao soltar, a flecha atravessa todos os inimigos em linha.',
    implemented: true, behavior: 'charged',
    cost: { base: 12, perLevel: 0.5 }, cooldown: 1, castTime: 0,
    damage: { source: 'weapon', mult: 1.2, perLevel: 0.1, type: 'physical' },
    params: { maxCharge: 1.2, maxMult: 3.5 },
    projectile: { kind: 'arrow', color: 0xfff0a0, speed: 30, radius: 0.3, range: 18, pierce: true },
  },
  roll: {
    name: 'Rolamento', class: 'archer', icon: '🤸',
    description: 'Esquiva rápida na direção do mouse. Você fica invulnerável durante o rolamento.',
    implemented: true, behavior: 'roll',
    cost: { base: 8, perLevel: 0 }, cooldown: 2.5, castTime: 0,
    params: { distance: 5, distancePerLevel: 0.15, duration: 0.3, invulnerable: true },
  },
  poisonArrow: {
    name: 'Flecha Venenosa', class: 'archer', icon: '🧪', requiresLevel: 5,
    description: 'Flecha embebida em veneno que ATRAVESSA os inimigos e envenena cada um: dano contínuo que ignora armadura.',
    implemented: true, behavior: 'projectile',
    cost: { base: 9, perLevel: 0.5 }, cooldown: 0.5, castTime: 0.3,
    damage: { source: 'weapon', mult: 0.9, perLevel: 0.07, type: 'physical' },
    projectile: { kind: 'arrow', color: 0x8ee04a, speed: 24, radius: 0.25, range: 15, pierce: true },
    onHit: [{
      effect: 'dot', id: 'poison', name: 'Veneno', icon: '☠️', damageType: 'poison',
      pctOfHit: 1.2, pctOfHitPerLevel: 0.08, duration: 4, durationPerLevel: 0.1,
    }],
  },
  eagleEye: {
    name: 'Olho de Águia', class: 'archer', icon: '🦅', requiresLevel: 5,
    description: 'Passiva: aumenta a chance de acerto crítico e o dano dos críticos.',
    implemented: true, behavior: 'passive',
    passive: { perLevel: { critChance: 1.5, critDamagePct: 8 } },
  },
  arrowRain: {
    name: 'Chuva de Flechas', class: 'archer', icon: '🌧️', requiresLevel: 8,
    description: 'Uma chuva de flechas cai sobre a área escolhida, ferindo e retardando os inimigos. Mais flechas e área maior a cada nível.',
    implemented: true, behavior: 'groundAoe',
    cost: { base: 18, perLevel: 1 }, cooldown: 6, castTime: 0.4,
    damage: { source: 'weapon', mult: 0.55, perLevel: 0.05, type: 'physical' }, // por flecha
    params: {
      range: 13, radius: 3, radiusPerLevel: 0.05, count: 14, countPerLevel: 1,
      duration: 2, impactRadius: 1.0, drop: 'streak', dropSize: 0.9, fallTime: 0.3,
    },
    onHit: [{ effect: 'slow', amount: 0.3, duration: 1.5 }],
    vfx: { color: 0xe8d9b0 },
  },
  explosiveArrow: {
    name: 'Flecha Explosiva', class: 'archer', icon: '💥', requiresLevel: 10,
    description: 'Flecha com pólvora que explode ao acertar, causando dano de fogo em área e queimando os inimigos.',
    implemented: true, behavior: 'projectileAoe',
    cost: { base: 14, perLevel: 0.8 }, cooldown: 1.2, castTime: 0.3,
    damage: { source: 'weapon', mult: 1.4, perLevel: 0.1, type: 'fire' },
    params: { radius: 2.4, radiusPerLevel: 0.05 },
    projectile: { kind: 'arrow', color: 0xff8844, speed: 24, radius: 0.3, range: 15, scale: 1.3 },
    onHit: [BURN],
  },
};

// Completa os campos que faltam e guarda o próprio id dentro de cada habilidade
for (const [id, skill] of Object.entries(SKILLS)) {
  skill.id = id;
  skill.maxLevel ??= 20;
  skill.requiresLevel ??= 1;
  skill.onHit ??= [];
  skill.cost ??= { base: 0, perLevel: 0 };
  skill.cooldown ??= 0;
}
