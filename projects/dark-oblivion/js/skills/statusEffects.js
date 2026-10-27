// =============================================================
// statusEffects.js — efeitos temporários em personagens.
//
// Tipos:
//   slow   → reduz velocidade de movimento (amount 0.45 = -45%) e um pouco a de ataque
//   stun   → impede qualquer ação
//   freeze → congelado: igual ao stun, mas com um bloco de gelo em volta.
//            Chefes imunes a atordoamento ficam só bem lentos.
//   dot    → dano contínuo (sangramento, veneno, queimadura). O dano pode ser:
//              dps fixo:        { dps: 5, dpsPerLevel: 0.1 }
//              % do golpe:      { pctOfHit: 0.6, pctOfHitPerLevel: 0.05 }
//                               (60% do dano do golpe, espalhado pela duração)
//   buff   → modificadores de atributo (mods: { damagePct: 20, armor: 15 })
//
// Cada entidade tem uma lista `effects`. Aplicar um efeito que já existe
// apenas renova a duração e fica com o valor mais forte (não acumula).
//
// `visual` (opcional) desenha algo enquanto o efeito durar — veja effectVisuals.js:
//   { type: 'aura' | 'orb' | 'ice', color, grow }
// =============================================================
import { dealDamage } from '../systems/combat.js';

// Ícone padrão de cada tipo (mostrado no HUD do jogador)
const DEFAULT_ICONS = { slow: '❄️', stun: '💫', freeze: '🧊', dot: '🔥', buff: '✨' };
// Visual padrão de cada tipo
const DEFAULT_VISUALS = { freeze: { type: 'ice' } };

// Valor que cresce com o nível: base + porNível * (nível - 1)
function scaled(base, perLevel, level) {
  return (base ?? 0) + (perLevel ?? 0) * (level - 1);
}

// context.hitDamage = dano do golpe que causou o efeito (para dots em "% do golpe")
export function applyEffect(target, spec, level = 1, source = null, context = {}) {
  if (!target.alive) return null;
  // Chefes imunes a atordoamento: o congelamento vira uma lentidão forte
  if (spec.effect === 'freeze' && target.def?.stunImmune) {
    spec = { effect: 'slow', amount: 0.6, duration: spec.duration, durationPerLevel: spec.durationPerLevel };
  }
  if (spec.effect === 'stun' && target.def?.stunImmune) return null;
  let amount = spec.amount ?? 0;
  if (spec.effect === 'slow' && target.def?.slowResist) amount *= 1 - target.def.slowResist;

  const duration = scaled(spec.duration ?? 1, spec.durationPerLevel, level);
  const id = spec.id ?? spec.effect;

  let dps = 0;
  if (spec.effect === 'dot') {
    dps = spec.pctOfHit
      ? (context.hitDamage ?? 0) * scaled(spec.pctOfHit, spec.pctOfHitPerLevel, level) / duration
      : (spec.dps ?? 0) * (1 + (spec.dpsPerLevel ?? 0) * (level - 1));
    if (dps <= 0) return null;
  }

  const existing = target.effects.find((e) => e.id === id);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    existing.duration = Math.max(existing.duration, duration);
    existing.amount = Math.max(existing.amount, amount);
    existing.dps = Math.max(existing.dps, dps);
    existing.source = source;
    if (spec.mods) { // buff renovado: usa os valores novos
      existing.mods = spec.mods;
      target.recalcStats?.();
    }
    return existing;
  }

  const effect = {
    id,
    type: spec.effect,
    icon: spec.icon ?? DEFAULT_ICONS[spec.effect] ?? '•',
    name: spec.name ?? '',
    amount,
    dps,
    damageType: spec.damageType ?? 'physical',
    mods: spec.mods ?? null,
    requiresShield: !!spec.requiresShield, // buff que só vale com escudo equipado
    visual: spec.visual ?? DEFAULT_VISUALS[spec.effect] ?? null,
    duration,
    remaining: duration,
    source,
    tick: 0,
  };
  target.effects.push(effect);
  if (effect.type === 'buff') target.recalcStats?.();
  return effect;
}

export function updateEffects(target, dt) {
  let buffsChanged = false;
  for (let i = target.effects.length - 1; i >= 0; i--) {
    const e = target.effects[i];
    e.remaining -= dt;
    // Dano contínuo: aplicado a cada meio segundo.
    // procs: false → não gera Fúria, não cura por acerto e não é refletido.
    if (e.type === 'dot' && target.alive) {
      e.tick += dt;
      if (e.tick >= 0.5) {
        e.tick -= 0.5;
        dealDamage(e.source, target, { amount: e.dps * 0.5, type: e.damageType, canCrit: false, canBlock: false, procs: false });
      }
    }
    if (e.remaining <= 0) {
      target.effects.splice(i, 1);
      if (e.type === 'buff') buffsChanged = true;
    }
  }
  if (buffsChanged) target.recalcStats?.();
}

// Lentidões não acumulam: vale a mais forte
export function moveSpeedMultiplier(target) {
  let slow = 0;
  for (const e of target.effects) if (e.type === 'slow') slow = Math.max(slow, e.amount);
  return 1 - slow;
}

export function attackSpeedMultiplier(target) {
  let slow = 0;
  for (const e of target.effects) if (e.type === 'slow') slow = Math.max(slow, e.amount);
  return 1 - slow * 0.5;
}

// Atordoado ou congelado: não age
export function isStunned(target) {
  return target.effects.some((e) => e.type === 'stun' || e.type === 'freeze');
}

// Usado para pintar a barra de vida de azul
export function isSlowed(target) {
  return target.effects.some((e) => e.type === 'slow' || e.type === 'freeze');
}

// Soma de todos os modificadores de buffs ativos (usado em entities/stats.js).
// hasShield = false ignora os buffs que exigem escudo (ex.: Escudo de Espinhos).
export function getBuffMods(target, hasShield = true) {
  const mods = {};
  for (const e of target.effects) {
    if (e.type !== 'buff' || !e.mods) continue;
    if (e.requiresShield && !hasShield) continue;
    for (const [k, v] of Object.entries(e.mods)) mods[k] = (mods[k] ?? 0) + v;
  }
  return mods;
}

export function clearEffects(target) {
  target.effects.length = 0;
  target.recalcStats?.();
}
