// =============================================================
// combat.js — fórmulas de dano.
//
// Fluxo de um golpe:
//   1. quem ataca calcula o dano bruto (arma ou magia)
//   2. dealDamage() aplica crítico, bloqueio, armadura/resistência
//   3. escudo de mana (Orbe Sombrio) absorve parte com a mana
//   4. o alvo perde vida e aparece o número flutuante
//   5. espinhos (Escudo de Espinhos) devolvem parte do golpe a quem atacou
//   (cada golpe também toca um som: bloqueio, impacto ou o jogador apanhando)
//
// Armadura (só dano físico):  redução = armadura / (armadura + 50 + 5 * nível do atacante)
// Resistência (elemental):    redução = resistência% (máximo 75%)
// Sangramento, veneno e espinhos ignoram armadura e resistências.
// =============================================================
import { CONFIG } from '../config.js';
import { game } from '../game.js';

export const DAMAGE_COLORS = {
  physical: '#ffffff',
  fire: '#ff8a3d',
  cold: '#8fd3ff',
  lightning: '#ffe95c',
  shadow: '#c58cff',
  bleed: '#e02a2a',
  poison: '#7ee04a',
  reflect: '#d8e0ff',
};

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

// Dano de uma habilidade em um nível específico. Devolve { amount, type }.
export function computeSkillDamage(caster, def, level) {
  const d = def.damage;
  if (!d) return { amount: 0, type: 'physical' };
  const s = caster.stats;
  const levelMult = 1 + (d.perLevel ?? 0) * (level - 1);
  let amount;
  if (d.source === 'weapon') {
    // % do dano da arma (que já inclui os bônus de atributo e equipamento)
    amount = rand(s.damageMin, s.damageMax) * (d.mult ?? 1) * levelMult;
  } else {
    // Magia: dano próprio, aumentado pelo "poder mágico" (Inteligência + itens)
    amount = rand(d.min, d.max) * levelMult * (1 + (s.spellPower ?? 0) / 100);
  }
  return { amount, type: d.type ?? 'physical' };
}

// Escudo de Espinhos: o alvo devolve parte do golpe (bruto) a quem atacou
function reflectDamage(attacker, target, rawAmount) {
  const pct = target.stats.reflectPct ?? 0;
  if (pct <= 0 || !attacker?.alive || attacker === target) return;
  dealDamage(target, attacker, { amount: rawAmount * pct / 100, type: 'reflect', canCrit: false, canBlock: false, procs: false });
}

// Aplica dano de `attacker` em `target`. attacker pode ser null (ex.: lava, armadilha).
// procs: false → dano "secundário" (dots, espinhos): não gera Fúria, não cura por acerto
//                e não é refletido (evita reflexo infinito).
// sound: false → não toca o som do impacto (danos muito frequentes, como o Drenar Vida).
// Devolve { damage, crit, blocked } ou null se não acertou.
export function dealDamage(attacker, target, { amount, type = 'physical', canCrit = true, canBlock = true, procs = true, sound = true }) {
  if (!target || !target.alive || target.invulnerable) return null;

  const aStats = attacker?.stats ?? {};
  const tStats = target.stats;
  let damage = amount;
  let crit = false;

  if (canCrit && Math.random() * 100 < (aStats.critChance ?? 0)) {
    damage *= aStats.critMultiplier ?? CONFIG.combat.critMultiplier;
    crit = true;
  }

  const textPos = { x: target.position.x, y: target.position.y + target.height, z: target.position.z };
  const isPlayer = target.team === 'player';

  if (type === 'physical') {
    // Bloqueio com escudo anula o golpe físico (os espinhos devolvem mesmo assim)
    if (canBlock && Math.random() * 100 < (tStats.blockChance ?? 0)) {
      game.damageNumbers.spawn(textPos, 'Bloqueio!', { color: '#c8d0ff', cls: 'block' });
      game.sound.play('block');
      if (procs) reflectDamage(attacker, target, amount);
      return { damage: 0, crit: false, blocked: true };
    }
    const armor = tStats.armor ?? 0;
    const attackerLevel = attacker?.level ?? 1;
    const reduction = armor / (armor + CONFIG.combat.armorConstant + 5 * attackerLevel);
    damage *= 1 - reduction;
  } else {
    const res = Math.min(CONFIG.combat.maxResist, tStats.resist?.[type] ?? 0);
    damage *= 1 - res / 100;
  }

  damage = Math.max(1, Math.round(damage));

  // Orbe Sombrio: parte do dano sai da mana em vez da vida
  const absorbed = Math.min(damage, Math.round(target.absorbDamage?.(damage) ?? 0));
  const hpDamage = damage - absorbed;
  target.takeDamage(hpDamage, type, attacker);

  if (hpDamage > 0 || !absorbed) {
    game.damageNumbers.spawn(textPos, String(hpDamage), {
      color: isPlayer ? '#ff4040' : DAMAGE_COLORS[type] ?? '#ffffff',
      crit,
      cls: isPlayer ? 'player-hurt' : '',
    });
  }
  // Som: o jogador apanhando, ou o golpe dele acertando (dots e espinhos não fazem barulho)
  if (isPlayer) game.sound.play('hurt');
  else if (procs && sound) game.sound.play('hit', { type, crit });

  if (absorbed > 0) {
    game.damageNumbers.spawn({ ...textPos, y: textPos.y + 0.35 }, `🔮${absorbed}`, { color: '#b58cff', cls: 'absorbed' });
  }

  if (procs) {
    attacker?.onDealtDamage?.(target, damage);
    reflectDamage(attacker, target, amount);
  }
  return { damage, crit, blocked: false };
}
