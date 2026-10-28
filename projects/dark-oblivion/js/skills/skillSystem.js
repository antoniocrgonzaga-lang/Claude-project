// =============================================================
// skillSystem.js — regras gerais de uso das habilidades:
// nível aprendido, custo, recarga, chamada do comportamento e
// atualização das habilidades "sustentadas" (segurar o botão).
// =============================================================
import { SKILLS } from './skillData.js';
import { BEHAVIORS, skillCost, skillRange, inSkillRange, param, buffMods } from './behaviors.js';
import { computeSkillDamage } from '../systems/combat.js';
import { game } from '../game.js';

export { skillCost, skillRange, inSkillRange, computeSkillDamage };

export function getSkill(id) {
  return SKILLS[id];
}

// O jogador pode colocar um ponto nesta habilidade agora?
export function canLearnSkill(player, id) {
  const def = SKILLS[id];
  if (!def || !def.implemented || def.class !== player.classDef.id) return false;
  const level = player.skillLevels[id] ?? 0;
  return player.skillPoints > 0 && level < def.maxLevel && player.level >= def.requiresLevel;
}

function notify(text) {
  game.ui?.message(text); // a UI já evita repetir a mesma mensagem várias vezes seguidas
}

// Tenta usar a habilidade. Devolve true / 'queued' / 'sustained' / false (veja behaviors.js)
export function tryUseSkill(caster, skillId, target) {
  const def = SKILLS[skillId];
  if (!def) return false;

  if (!def.implemented) { notify(`${def.name}: disponível numa próxima versão.`); return false; }
  if (def.behavior === 'passive') { notify(`${def.name} é uma habilidade passiva.`); return false; }

  const level = caster.skillLevels?.[skillId] ?? 0;
  if (level <= 0) { notify(`Você ainda não aprendeu ${def.name}. Use pontos de habilidade (C).`); return false; }
  if (def.requiresShield && !caster.inventory?.equipment.offhand?.isShield) { notify(`${def.name} requer um escudo equipado.`); return false; }
  if ((caster.cooldowns[skillId] ?? 0) > 0) return false;
  if (caster.actionLock > 0 || caster.sustained) return false;

  const cost = skillCost(def, level);
  if (caster.resource < cost) {
    notify(`${caster.classDef?.resource.name ?? 'Recurso'} insuficiente!`);
    return false;
  }

  const behavior = BEHAVIORS[def.behavior];
  if (!behavior) { console.warn(`Comportamento desconhecido: ${def.behavior}`); return false; }

  const result = behavior.execute(caster, def, level, target);
  if (result === true) {
    playSkillSound(def);
    caster.spendResource(cost);
    if (def.resourceGain) caster.gainResource(def.resourceGain);
    caster.cooldowns[skillId] = def.cooldown;
    caster.actionLock = def.castTime ?? 0.25;
    caster.inCombat?.();
  }
  // 'sustained': o próprio comportamento cobra o custo e inicia a recarga
  return result;
}

// Som ao usar uma habilidade que não dispara projétil (os projéteis tocam o
// próprio som em behaviors.js): golpes com a arma cortam o ar; magias "lançam".
const WEAPON_SKILLS = new Set(['meleeStrike', 'aoeSelf', 'dash']);
function playSkillSound(def) {
  if (def.projectile) return;
  if (def.damage?.source === 'weapon' && WEAPON_SKILLS.has(def.behavior)) game.sound.play('swing');
  else if (def.damage?.source === 'spell') game.sound.play('cast', { type: def.damage.type });
}

// Chamado todo quadro enquanto o jogador está canalizando / carregando
export function updateSustained(caster, dt) {
  const s = caster.sustained;
  if (!s) return;
  const keepGoing = BEHAVIORS[s.def.behavior].update(caster, s, dt);
  if (!keepGoing) caster.stopSustained();
}

export function updateCooldowns(caster, dt) {
  for (const id in caster.cooldowns) {
    if (caster.cooldowns[id] > 0) caster.cooldowns[id] = Math.max(0, caster.cooldowns[id] - dt);
  }
}

// ======================= TEXTO DO TOOLTIP =======================

// Nome e formato de cada atributo usado por passivas e buffs
const STAT_LABELS = {
  damagePct: ['Dano', '%'],
  armor: ['Armadura', ''],
  armorPct: ['Armadura', '%'],
  blockChance: ['Chance de bloqueio', '%'],
  attackSpeedPct: ['Velocidade de ataque', '%'],
  critChance: ['Chance de crítico', '%'],
  critDamagePct: ['Dano crítico', '%'],
  reflectPct: ['Dano devolvido ao atacante', '%'],
  manaShieldPct: ['Dano absorvido pela mana', '%'],
};

const round1 = (v) => Math.round(v * 10) / 10;

function statLine(stat, value) {
  if (stat === 'manaShieldCost') return `Mana gasta por ponto de dano: ${round1(value)}`;
  const [label, unit] = STAT_LABELS[stat] ?? [stat, ''];
  return `${label}: ${value >= 0 ? '+' : ''}${round1(value)}${unit}`;
}

// Linhas de texto para o tooltip da habilidade, no nível dado
export function describeSkill(def, level, player) {
  const lines = [];
  const shownLevel = Math.max(1, level);
  const p = def.params ?? {};
  const resName = player.classDef.resource.name;

  if (def.behavior === 'passive') {
    for (const [stat, value] of Object.entries(def.passive.perLevel)) lines.push(statLine(stat, value * shownLevel));
    return lines;
  }

  const cost = skillCost(def, shownLevel);
  if (cost > 0) lines.push(`Custo: ${cost} de ${resName}${p.costPerSecond ? ' por segundo' : ''}`);
  if (def.resourceGain) lines.push(`Gera ${def.resourceGain} de ${resName}`);
  if (def.cooldown > 0) lines.push(`Recarga: ${def.cooldown.toFixed(1)}s`);

  if (def.damage) {
    const d = def.damage;
    const each = def.behavior === 'groundAoe' ? ' por impacto' : p.costPerSecond ? ' por segundo' : '';
    if (d.source === 'weapon') {
      const pct = Math.round((d.mult ?? 1) * (1 + (d.perLevel ?? 0) * (shownLevel - 1)) * 100);
      lines.push(`Dano${each}: ${pct}% do dano da arma`);
    } else {
      const mult = (1 + (d.perLevel ?? 0) * (shownLevel - 1)) * (1 + (player.stats.spellPower ?? 0) / 100);
      lines.push(`Dano${each}: ${Math.round(d.min * mult)}–${Math.round(d.max * mult)}`);
    }
  }

  for (const spec of def.onHit ?? []) {
    const duration = round1(spec.duration + (spec.durationPerLevel ?? 0) * (shownLevel - 1));
    if (spec.effect === 'slow') lines.push(`Lentidão de ${Math.round(spec.amount * 100)}% por ${duration}s`);
    if (spec.effect === 'stun') lines.push(`Atordoa por ${duration}s`);
    if (spec.effect === 'freeze') lines.push(`Congela por ${duration}s`);
    if (spec.effect === 'dot') {
      const pct = Math.round((spec.pctOfHit + (spec.pctOfHitPerLevel ?? 0) * (shownLevel - 1)) * 100);
      lines.push(`${spec.name}: +${pct}% do dano do golpe ao longo de ${duration}s`);
    }
  }

  switch (def.behavior) {
    case 'multiProjectile':
      lines.push(`Flechas: ${Math.min(p.maxCount, p.count + Math.floor((shownLevel - 1) / p.extraEvery))}`);
      break;
    case 'aoeSelf':
    case 'projectileAoe':
      lines.push(`Raio: ${round1(param(def, 'radius', shownLevel))}`);
      break;
    case 'chain':
      lines.push(`Salta para até ${Math.floor(param(def, 'jumps', shownLevel))} inimigos (distância ${round1(param(def, 'jumpRange', shownLevel))})`);
      break;
    case 'groundAoe':
      lines.push(`Impactos: ${Math.floor(param(def, 'count', shownLevel))} em ${p.duration}s`);
      lines.push(`Área: raio ${round1(param(def, 'radius', shownLevel))} (alcance ${p.range})`);
      break;
    case 'channel':
      lines.push(`Recupera ${Math.round(p.leechPct * 100)}% do dano como vida`);
      lines.push('Segure o botão direito');
      break;
    case 'dash':
      lines.push(`Alcance: ${p.maxDistance}`);
      break;
    case 'selfBuff':
      lines.push(`Duração: ${round1(param(def, 'duration', shownLevel))}s`);
      for (const [stat, value] of Object.entries(buffMods(def, shownLevel))) lines.push(statLine(stat, value));
      break;
    case 'charged':
      lines.push(`Segure para carregar (${p.maxCharge}s): até ${p.maxMult}x de dano`);
      if (def.projectile?.pierce) lines.push('Atravessa todos os inimigos');
      break;
    case 'projectile':
      if (def.projectile?.pierce) lines.push('Atravessa os inimigos');
      break;
  }
  if (def.requiresShield) lines.push('Requer escudo');
  return lines;
}
