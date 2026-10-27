// =============================================================
// stats.js — calcula os atributos FINAIS.
//
// Jogador: base da classe + pontos distribuídos + equipamento
//          + passivas aprendidas + buffs ativos.
// Inimigo: valores do data/enemies.js multiplicados pelo andar.
//
// Fórmulas principais (jogador):
//   Vida máx.      = base + Vitalidade * perVit + (nível-1) * perLevel + itens
//   Dano da arma   = (dano da arma + dano fixo dos itens) * (1 + atributo principal/100 + dano%/100)
//   Poder mágico % = Inteligência + dano mágico % dos itens
//   Armadura       = itens + Destreza / 5
//   Crítico %      = 5 + Destreza * 0.05 + itens
// =============================================================
import { CONFIG } from '../config.js';
import { itemStats } from '../systems/loot.js';
import { SKILLS } from '../skills/skillData.js';
import { getBuffMods } from '../skills/statusEffects.js';

export function computePlayerStats(player) {
  const cls = player.classDef;
  const equipment = player.inventory.equipment;

  // "bonus" acumula tudo que vem de itens, passivas e buffs
  const bonus = {};
  const add = (stat, value) => { bonus[stat] = (bonus[stat] ?? 0) + value; };

  // 1) Equipamento
  let itemArmor = 0, itemBlock = 0;
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    itemArmor += item.armor ?? 0;
    itemBlock += item.blockChance ?? 0;
    for (const [stat, value] of Object.entries(itemStats(item))) add(stat, value);
  }

  // 2) Passivas aprendidas
  for (const [id, level] of Object.entries(player.skillLevels)) {
    const def = SKILLS[id];
    if (!def?.implemented || def.behavior !== 'passive' || level <= 0) continue;
    if (def.passive.requiresShield && !equipment.offhand?.isShield) continue;
    for (const [stat, value] of Object.entries(def.passive.perLevel)) add(stat, value * level);
  }

  // 3) Buffs temporários (Grito de Guerra, Berserker, Orbe Sombrio...)
  for (const [stat, value] of Object.entries(getBuffMods(player, !!equipment.offhand?.isShield))) add(stat, value);

  // Atributos
  const str = cls.attributes.str + player.allocated.str + (bonus.str ?? 0);
  const dex = cls.attributes.dex + player.allocated.dex + (bonus.dex ?? 0);
  const int = cls.attributes.int + player.allocated.int + (bonus.int ?? 0);
  const vit = cls.attributes.vit + player.allocated.vit + (bonus.vit ?? 0);
  const primary = { str, dex, int }[cls.primaryStat] ?? 0;

  const s = { str, dex, int, vit };

  s.maxHp = Math.round(cls.hp.base + vit * cls.hp.perVit + (player.level - 1) * cls.hp.perLevel + (bonus.maxHp ?? 0));
  s.hpRegen = 0.3 + vit * 0.01; // vida por segundo (bem pouquinho)

  const r = cls.resource;
  if (r.type === 'fury') {
    s.maxResource = r.base + (bonus.maxResource ?? 0);
    s.resourceRegen = 0;
  } else {
    s.maxResource = Math.round(r.base + int * (r.perInt ?? 0) + (player.level - 1) * (r.perLevel ?? 0) + (bonus.maxResource ?? 0));
    s.resourceRegen = r.regen + int * (r.regenPerInt ?? 0);
  }

  // Dano da arma (sem arma: soco de 1–3)
  const weapon = equipment.weapon;
  const wMin = weapon?.damage?.[0] ?? 1;
  const wMax = weapon?.damage?.[1] ?? 3;
  const damageMult = 1 + primary / 100 + (bonus.damagePct ?? 0) / 100;
  s.damageMin = (wMin + (bonus.damageFlat ?? 0)) * damageMult;
  s.damageMax = (wMax + (bonus.damageFlat ?? 0)) * damageMult;
  s.spellPower = int + (bonus.spellDamagePct ?? 0);

  // armorPct: % sobre a armadura total (o Berserker usa valor negativo)
  s.armor = Math.max(0, Math.round((itemArmor + dex / 5 + (bonus.armor ?? 0)) * (1 + (bonus.armorPct ?? 0) / 100)));
  s.attackSpeed = (weapon?.attackSpeed ?? 1.0) * (1 + (bonus.attackSpeedPct ?? 0) / 100);
  s.moveSpeed = CONFIG.player.baseMoveSpeed * (1 + (bonus.moveSpeedPct ?? 0) / 100);
  s.critChance = CONFIG.combat.baseCrit + dex * 0.05 + (bonus.critChance ?? 0);
  s.critMultiplier = CONFIG.combat.critMultiplier + (bonus.critDamagePct ?? 0) / 100;
  s.blockChance = Math.min(CONFIG.combat.blockCap, itemBlock + (bonus.blockChance ?? 0));
  s.lifeOnHit = bonus.lifeOnHit ?? 0;
  s.reflectPct = bonus.reflectPct ?? 0;                     // Escudo de Espinhos
  s.manaShieldPct = Math.min(85, bonus.manaShieldPct ?? 0); // Orbe Sombrio: % do dano que vai para a mana
  s.manaShieldCost = Math.max(0.3, bonus.manaShieldCost ?? 1); // mana gasta por ponto de dano absorvido
  s.resist = {
    fire: bonus.resFire ?? 0,
    cold: bonus.resCold ?? 0,
    lightning: bonus.resLightning ?? 0,
    shadow: bonus.resShadow ?? 0,
  };
  return s;
}

export function computeEnemyStats(def, floor) {
  const f = Math.max(0, floor - 1);
  const fl = CONFIG.floor;
  const dmgMult = 1 + fl.damagePerFloor * f;
  return {
    level: floor + (def.levelOffset ?? 0),
    maxHp: Math.round(def.hp * (1 + fl.hpPerFloor * f)),
    damageMin: def.damage[0] * dmgMult,
    damageMax: def.damage[1] * dmgMult,
    armor: Math.round(def.armor * (1 + fl.armorPerFloor * f)),
    resist: { fire: 0, cold: 0, lightning: 0, shadow: 0, ...def.resist },
    critChance: 0,
    blockChance: 0,
    xp: Math.round(def.xp * (1 + fl.xpPerFloor * f)),
  };
}
