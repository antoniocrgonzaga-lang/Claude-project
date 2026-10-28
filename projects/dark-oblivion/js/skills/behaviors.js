// =============================================================
// behaviors.js — o CÓDIGO genérico das habilidades.
//
// Cada comportamento tem uma função execute(caster, def, level, target):
//   caster → quem usa (jogador; no futuro também inimigos)
//   def    → os dados da habilidade (skillData.js)
//   level  → nível da habilidade
//   target → { enemy, point } — o que estava debaixo do mouse
// Retorno:
//   true        → executou (o skillSystem gasta o recurso e inicia a recarga)
//   'queued'    → precisa chegar mais perto; o jogador anda até o alvo e tenta de novo
//   'sustained' → começou algo que dura enquanto o botão direito estiver apertado
//                 (Drenar Vida, Tiro Concentrado). Esses têm também uma função
//                 update(caster, state, dt) chamada todo quadro; ela devolve
//                 false quando deve terminar. Eles mesmos cobram o custo.
//   false       → não fez nada
//
// Para uma mecânica nova, basta criar a entrada aqui e usar o nome
// no campo `behavior` da habilidade em skillData.js.
//
// PARÂMETROS QUE CRESCEM COM O NÍVEL: qualquer campo de `params` pode ter
// um irmão "<nome>PerLevel". Ex.: { radius: 4, radiusPerLevel: 0.1 } → no
// nível 5 o raio é 4.4. Use param(def, 'radius', level) para ler.
// =============================================================
import { game } from '../game.js';
import { dealDamage, computeSkillDamage } from '../systems/combat.js';
import { applyEffect } from './statusEffects.js';

// ======================= FUNÇÕES DE APOIO =======================

export function skillCost(def, level) {
  return Math.round((def.cost.base ?? 0) + (def.cost.perLevel ?? 0) * Math.max(0, level - 1));
}

// Valor de um parâmetro no nível dado: params[name] + params[name + 'PerLevel'] * (nível - 1)
export function param(def, name, level) {
  const p = def.params ?? {};
  return (p[name] ?? 0) + (p[`${name}PerLevel`] ?? 0) * (level - 1);
}

// Alcance de uma habilidade (cada tipo guarda num campo diferente)
export function skillRange(def) {
  return def.range ?? def.params?.range ?? def.params?.maxDistance ?? 2;
}

// Inimigos de quem está usando a habilidade
function hostilesOf(caster) {
  return caster.team === 'player' ? game.world.enemies : [game.player];
}

function hasLineOfSight(a, b) {
  return game.world.grid.lineOfSight(a.position.x, a.position.z, b.position.x, b.position.z);
}

// O alvo está ao alcance? (habilidades à distância também precisam de linha de visão)
export function inSkillRange(caster, enemy, def) {
  if (caster.distanceTo(enemy) - enemy.radius > skillRange(def)) return false;
  return def.behavior === 'meleeStrike' || hasLineOfSight(caster, enemy);
}

// Direção (normalizada) do caster até o alvo; se não houver alvo, para onde ele olha
function aimDirection(caster, target) {
  const p = target?.enemy?.alive ? target.enemy.position : target?.point;
  const a = caster.root.rotation.y;
  if (!p) return { x: Math.sin(a), z: Math.cos(a) };
  const dx = p.x - caster.position.x, dz = p.z - caster.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return { x: Math.sin(a), z: Math.cos(a) };
  return { x: dx / len, z: dz / len };
}

// Inimigo vivo ao alcance do caster, o mais perto do ponto clicado
function nearestHostile(caster, x, z, maxRangeFromCaster, needLineOfSight = false) {
  let best = null, bestDist = Infinity;
  for (const e of hostilesOf(caster)) {
    if (!e.alive) continue;
    if (caster.distanceTo(e) - e.radius > maxRangeFromCaster) continue;
    if (needLineOfSight && !hasLineOfSight(caster, e)) continue;
    const d = Math.hypot(e.position.x - x, e.position.z - z);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best;
}

// Escolhe o inimigo-alvo de uma habilidade:
//   - clicou num inimigo ao alcance → ele
//   - clicou num inimigo longe     → 'queued' (o jogador anda até ele)
//   - clicou no chão               → o inimigo ao alcance mais perto do clique
// Devolve o inimigo, 'queued' ou null.
function pickEnemyTarget(caster, def, target) {
  const enemy = target?.enemy?.alive ? target.enemy : null;
  if (enemy) {
    if (inSkillRange(caster, enemy, def)) return enemy;
    if (caster.queueSkill) { caster.queueSkill(def.id, enemy); return 'queued'; }
    return null;
  }
  if (!target?.point) return null;
  return nearestHostile(caster, target.point.x, target.point.z, skillRange(def), def.behavior !== 'meleeStrike');
}

// Aplica os efeitos "ao acertar" (lentidão, sangramento...) se o golpe não foi bloqueado.
// result = o que dealDamage devolveu (o dano dele alimenta os dots em "% do golpe").
export function applyOnHit(def, level, caster, target, result) {
  if (!result || result.blocked) return;
  for (const spec of def.onHit ?? []) applyEffect(target, spec, level, caster, { hitDamage: result.damage });
}

// Dispara um projétil da habilidade na direção (dirX, dirZ).
// Com arco (caster.afterDraw), a flecha sai depois de a corda ser puxada; immediate = true dispara já
// (Tiro Concentrado: a corda já está puxada quando o jogador solta o botão).
function launchProjectile(caster, def, level, dirX, dirZ, damageMult = 1, scaleMult = 1, immediate = false) {
  if (!immediate && caster.afterDraw && caster.fireDelay > 0) {
    caster.afterDraw(() => launchProjectile(caster, def, level, dirX, dirZ, damageMult, scaleMult, true));
    return;
  }
  const pr = def.projectile;
  const dmg = computeSkillDamage(caster, def, level);
  // Som do disparo: corda do arco para flechas, "lançamento" da magia para o resto
  if (pr.kind === 'arrow') game.sound.play('bow'); else game.sound.play('cast', { type: dmg.type });
  game.projectiles.spawn({
    owner: caster,
    team: caster.team,
    x: caster.position.x + dirX * 0.5,
    y: 1.1,
    z: caster.position.z + dirZ * 0.5,
    dirX, dirZ,
    speed: pr.speed,
    range: pr.range,
    radius: pr.radius,
    kind: pr.kind,
    color: pr.color,
    scale: (pr.scale ?? 1) * scaleMult,
    pierce: pr.pierce ?? false,
    damage: dmg.amount * damageMult,
    damageType: dmg.type,
    onHit: def.onHit,
    level,
    explosionRadius: def.behavior === 'projectileAoe' ? param(def, 'radius', level) : 0,
  });
}

// Altura "do peito" de uma entidade, para os raios saírem/chegarem num lugar bonito
function chest(entity, factor = 0.6) {
  return { x: entity.position.x, y: entity.position.y + entity.height * factor, z: entity.position.z };
}

// Ponto do chão escolhido pelo jogador, limitado ao alcance da habilidade
function groundTarget(caster, def, target) {
  const p = target?.enemy?.alive ? target.enemy.position : target?.point;
  const range = skillRange(def);
  const a = caster.root.rotation.y;
  if (!p) return { x: caster.position.x + Math.sin(a) * range * 0.5, z: caster.position.z + Math.cos(a) * range * 0.5 };
  const dx = p.x - caster.position.x, dz = p.z - caster.position.z;
  const len = Math.hypot(dx, dz);
  if (len <= range) return { x: p.x, z: p.z };
  return { x: caster.position.x + (dx / len) * range, z: caster.position.z + (dz / len) * range };
}

// ======================= COMPORTAMENTOS =======================

export const BEHAVIORS = {
  // Um projétil em linha reta (Seta de Fogo, Estilhaço de Gelo, Flecha Venenosa)
  projectile: {
    execute(caster, def, level, target) {
      const d = aimDirection(caster, target);
      caster.faceTowards(caster.position.x + d.x, caster.position.z + d.z);
      caster.model.play('attack', { once: true });
      launchProjectile(caster, def, level, d.x, d.z);
      return true;
    },
  },

  // Projétil que explode em área ao tocar em algo (Bola de Fogo, Flecha Explosiva)
  projectileAoe: {
    execute(caster, def, level, target) {
      return BEHAVIORS.projectile.execute(caster, def, level, target); // launchProjectile já liga a explosão
    },
  },

  // Vários projéteis em leque (Tiro Múltiplo)
  multiProjectile: {
    execute(caster, def, level, target) {
      const p = def.params;
      const extra = Math.floor((level - 1) / (p.extraEvery ?? 99));
      const count = Math.min(p.maxCount ?? p.count, p.count + extra);
      const d = aimDirection(caster, target);
      const baseAngle = Math.atan2(d.x, d.z);
      const spread = (p.spreadDeg ?? 30) * Math.PI / 180;
      caster.faceTowards(caster.position.x + d.x, caster.position.z + d.z);
      caster.model.play('attack', { once: true });
      for (let i = 0; i < count; i++) {
        const a = count === 1 ? baseAngle : baseAngle - spread / 2 + (spread * i) / (count - 1);
        launchProjectile(caster, def, level, Math.sin(a), Math.cos(a));
      }
      return true;
    },
  },

  // Golpe corpo a corpo forte em um alvo (Golpe Poderoso, Dilacerar)
  meleeStrike: {
    execute(caster, def, level, target) {
      const enemy = pickEnemyTarget(caster, def, target);
      if (!enemy || enemy === 'queued') return enemy === 'queued' ? 'queued' : false;
      caster.faceTowards(enemy.position.x, enemy.position.z);
      caster.model.play('attack', { once: true });
      const dmg = computeSkillDamage(caster, def, level);
      const result = dealDamage(caster, enemy, { amount: dmg.amount, type: dmg.type });
      applyOnHit(def, level, caster, enemy, result);
      game.vfx.burst(enemy.position, def.vfx?.color ?? 0xffffff, 0.9, enemy.height * 0.6);
      return true;
    },
  },

  // Acerta todos ao redor de quem usa (Redemoinho, Nova Congelante)
  aoeSelf: {
    execute(caster, def, level) {
      const radius = param(def, 'radius', level);
      const color = def.vfx?.color ?? 0xffffff;
      caster.model.play(def.animation ?? 'spin', { once: true });
      game.vfx.ring(caster.position, color, radius, 0.4);
      if (def.vfx?.burst) game.vfx.burst(caster.position, color, radius * 0.5, 0.4);
      for (const e of hostilesOf(caster)) {
        if (!e.alive || caster.distanceTo(e) > radius + e.radius) continue;
        const dmg = computeSkillDamage(caster, def, level);
        const result = dealDamage(caster, e, { amount: dmg.amount, type: dmg.type });
        applyOnHit(def, level, caster, e, result);
      }
      return true;
    },
  },

  // Raio que salta de inimigo em inimigo (Faísca, Corrente de Relâmpagos).
  // params: jumps (+jumpsPerLevel), jumpRange, range
  chain: {
    execute(caster, def, level, target) {
      const first = pickEnemyTarget(caster, def, target);
      if (!first || first === 'queued') return first === 'queued' ? 'queued' : false;
      const jumps = Math.floor(param(def, 'jumps', level));
      const jumpRange = param(def, 'jumpRange', level);
      const color = def.vfx?.color ?? 0xfff27a;
      caster.faceTowards(first.position.x, first.position.z);
      caster.model.play('attack', { once: true });

      const alreadyHit = new Set();
      let from = chest(caster, 0.75);
      let current = first;
      // Acerta o primeiro e depois salta até `jumps` vezes
      for (let i = 0; i <= jumps && current; i++) {
        const to = chest(current);
        game.vfx.beam(from, to, color, def.vfx?.beam);
        alreadyHit.add(current);
        const dmg = computeSkillDamage(caster, def, level);
        const result = dealDamage(caster, current, { amount: dmg.amount, type: dmg.type });
        applyOnHit(def, level, caster, current, result);
        from = to;

        // Próximo alvo: o inimigo vivo mais perto deste, que ainda não levou o raio
        let next = null, bestDist = jumpRange;
        for (const e of hostilesOf(caster)) {
          if (!e.alive || alreadyHit.has(e)) continue;
          const d = current.distanceTo(e);
          if (d <= bestDist && hasLineOfSight(current, e)) { bestDist = d; next = e; }
        }
        current = next;
      }
      return true;
    },
  },

  // Canaliza enquanto o botão direito estiver apertado (Drenar Vida)
  channel: {
    execute(caster, def, level, target) {
      const enemy = pickEnemyTarget(caster, def, target);
      if (!enemy || enemy === 'queued') return enemy === 'queued' ? 'queued' : false;
      caster.startSustained({ def, level, target: enemy, t: 0, tick: 0, healed: 0, healTimer: 0 });
      caster.model.play('channel');
      game.sound.play('cast', { type: def.damage.type });
      if (!this.pulse(caster, caster.sustained)) { caster.stopSustained(); return false; }
      return 'sustained';
    },

    update(caster, s, dt) {
      if (!game.input.rightDown) return false;            // soltou o botão
      const enemy = s.target;
      if (!enemy.alive || !inSkillRange(caster, enemy, s.def)) return false;
      caster.faceTowards(enemy.position.x, enemy.position.z);
      s.t += dt;
      s.tick += dt;
      const tickRate = s.def.params.tickRate;
      while (s.tick >= tickRate) {
        s.tick -= tickRate;
        if (!this.pulse(caster, s)) return false;
      }
      // Mostra a cura acumulada uma vez por segundo (em vez de 4 números por segundo)
      s.healTimer += dt;
      if (s.healTimer >= 1 && s.healed >= 1) {
        game.damageNumbers.spawn(chest(caster, 1), `+${Math.round(s.healed)}`, { color: '#6fe36f' });
        s.healed = 0;
        s.healTimer = 0;
      }
      return true;
    },

    // Um "pulso" do canal: cobra, causa dano, cura e desenha o raio
    pulse(caster, s) {
      const { def, level, target } = s;
      const tickRate = def.params.tickRate;
      const cost = skillCost(def, level) * tickRate; // o custo da habilidade é POR SEGUNDO
      if (caster.resource < cost) {
        game.ui.message(`${caster.classDef?.resource.name ?? 'Recurso'} insuficiente!`);
        return false;
      }
      caster.spendResource(cost);
      caster.inCombat?.();
      const dmg = computeSkillDamage(caster, def, level);
      // sound: false → 4 impactos por segundo seriam barulho demais; o raio já tocou ao começar
      const result = dealDamage(caster, target, { amount: dmg.amount * tickRate, type: dmg.type, canCrit: false, sound: false });
      if (result && result.damage > 0) {
        const heal = result.damage * def.params.leechPct;
        caster.heal(heal);
        s.healed += heal;
      }
      game.vfx.beam(chest(caster, 0.75), chest(target), def.vfx?.color ?? 0x9a30ff, { duration: tickRate + 0.05, jagged: 0.18, width: 0.1, segments: 5 });
      return true;
    },
  },

  // Avança até o inimigo e acerta ao chegar (Investida)
  dash: {
    execute(caster, def, level, target) {
      const p = def.params;
      let enemy = target?.enemy?.alive ? target.enemy : null;
      if (!enemy && target?.point) enemy = nearestHostile(caster, target.point.x, target.point.z, p.maxDistance, true);
      if (!enemy) return false;

      const dist = caster.distanceTo(enemy);
      if (dist - enemy.radius > p.maxDistance) {
        game.ui.message('Longe demais para a Investida.');
        return false;
      }
      // Para um pouco antes do inimigo (não entra dentro dele)
      const dirX = (enemy.position.x - caster.position.x) / (dist || 1);
      const dirZ = (enemy.position.z - caster.position.z) / (dist || 1);
      const travel = Math.max(0, dist - enemy.radius - caster.radius - 0.15);
      const toX = caster.position.x + dirX * travel, toZ = caster.position.z + dirZ * travel;
      if (!game.world.grid.walkLine(caster.position.x, caster.position.z, toX, toZ, 0.25)) {
        game.ui.message('O caminho está bloqueado.');
        return false;
      }

      caster.faceTowards(enemy.position.x, enemy.position.z);
      caster.model.play('charge');
      caster.startDash(toX, toZ, Math.max(0.08, travel / p.speed), false, () => {
        // Chegou: golpeia se o inimigo ainda estiver perto
        caster.model.play('attack', { once: true });
        if (!enemy.alive || caster.distanceTo(enemy) - enemy.radius > 1.8) return;
        const dmg = computeSkillDamage(caster, def, level);
        const result = dealDamage(caster, enemy, { amount: dmg.amount, type: dmg.type });
        applyOnHit(def, level, caster, enemy, result);
        game.vfx.ring(enemy.position, 0xffd27a, 1.8, 0.35);
        game.vfx.burst(enemy.position, 0xffffff, 1, enemy.height * 0.6);
      });
      return true;
    },
  },

  // Bônus temporário em quem usa (Grito de Guerra, Escudo de Espinhos, Berserker, Orbe Sombrio).
  // params: duration (+durationPerLevel), mods, modsPerLevel, visual { type, color, grow }
  selfBuff: {
    execute(caster, def, level) {
      const p = def.params;
      const color = def.vfx?.color ?? 0xff7a3a;
      applyEffect(caster, {
        effect: 'buff', id: def.id, name: def.name, icon: def.icon,
        duration: param(def, 'duration', level),
        mods: buffMods(def, level),
        visual: p.visual ?? null,
        requiresShield: !!def.requiresShield,
      });
      caster.model.play(def.animation ?? 'attack', { once: true });
      game.vfx.ring(caster.position, color, 4, 0.5);
      game.vfx.pillar(caster, color);
      return true;
    },
  },

  // Área escolhida no chão que recebe vários impactos ao longo do tempo
  // (Chuva de Meteoros, Chuva de Flechas).
  // params: range, radius, count (+countPerLevel), duration, impactRadius, drop ('meteor'|'streak')
  groundAoe: {
    execute(caster, def, level, target) {
      const p = def.params;
      const center = groundTarget(caster, def, target);
      const radius = param(def, 'radius', level);
      const count = Math.floor(param(def, 'count', level));
      const duration = p.duration ?? 2;
      const fall = p.fallTime ?? 0.45;
      const color = def.vfx?.color ?? 0xff6a1a;

      caster.faceTowards(center.x, center.z);
      caster.model.play('attack', { once: true });
      game.vfx.telegraph(center, color, radius, duration + fall); // círculo de aviso na área

      for (let i = 0; i < count; i++) {
        // Ponto aleatório dentro do círculo (sqrt deixa a distribuição uniforme)
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
        const spot = { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r };
        const startAt = (i / count) * duration;
        game.timers.after(startAt, () => {
          game.vfx.drop(spot, color, { shape: p.drop ?? 'meteor', size: p.dropSize ?? 0.45, duration: fall });
          game.timers.after(fall, () => this.impact(caster, def, level, spot));
        });
      }
      return true;
    },

    // Um impacto: dano em quem estiver perto do ponto
    impact(caster, def, level, spot) {
      const p = def.params;
      const impactRadius = p.impactRadius ?? 1.2;
      const color = def.vfx?.color ?? 0xff6a1a;
      game.vfx.ring({ x: spot.x, z: spot.z }, color, impactRadius, 0.3);
      if ((p.drop ?? 'meteor') === 'meteor') game.vfx.burst({ x: spot.x, y: 0, z: spot.z }, color, impactRadius * 0.7, 0.3);
      if (!caster.alive && caster.team === 'player') return;
      for (const e of hostilesOf(caster)) {
        if (!e.alive) continue;
        if (Math.hypot(e.position.x - spot.x, e.position.z - spot.z) > impactRadius + e.radius) continue;
        const dmg = computeSkillDamage(caster, def, level);
        const result = dealDamage(caster, e, { amount: dmg.amount, type: dmg.type });
        applyOnHit(def, level, caster, e, result);
      }
    },
  },

  // Segura para carregar, solta para disparar (Tiro Concentrado)
  charged: {
    execute(caster, def, level) {
      caster.startSustained({ def, level, t: 0, full: false });
      caster.model.play('channel');
      return 'sustained';
    },

    update(caster, s, dt) {
      const p = s.def.params;
      s.t += dt;
      // Mira acompanha o mouse enquanto carrega
      const pick = game.pick;
      const aim = pick.enemy?.alive ? pick.enemy.position : pick.point;
      if (aim) caster.faceTowards(aim.x, aim.z);
      const charge = Math.min(1, s.t / p.maxCharge);
      if (charge >= 1 && !s.full) { // aviso visual de "carga completa"
        s.full = true;
        game.vfx.ring(caster.position, 0xfff0a0, 1.2, 0.3);
      }
      if (game.input.rightDown) return true; // ainda segurando

      // Soltou: dispara
      const cost = skillCost(s.def, s.level);
      if (caster.resource < cost) {
        game.ui.message(`${caster.classDef?.resource.name ?? 'Recurso'} insuficiente!`);
        return false;
      }
      caster.spendResource(cost);
      caster.cooldowns[s.def.id] = s.def.cooldown;
      caster.actionLock = 0.25;
      caster.inCombat?.();
      const a = caster.root.rotation.y;
      // Com arco de verdade: a corda estala e os braços voltam ("release"); sem: o golpe normal
      caster.model.play(caster.fireDelay > 0 ? 'release' : 'attack', { once: true });
      launchProjectile(caster, s.def, s.level, Math.sin(a), Math.cos(a), 1 + (p.maxMult - 1) * charge, 1 + charge * 0.8, true);
      return false;
    },
  },

  // Esquiva rápida na direção do mouse (Rolamento)
  roll: {
    execute(caster, def, level, target) {
      const p = def.params;
      const d = aimDirection(caster, target);
      const distance = param(def, 'distance', level);
      const dest = game.world.grid.furthestWalkable(caster.position.x, caster.position.z, d.x, d.z, distance);
      if (Math.hypot(dest.x - caster.position.x, dest.z - caster.position.z) < 0.5) return false; // encostado na parede
      caster.faceTowards(caster.position.x + d.x, caster.position.z + d.z);
      caster.model.play('roll', { once: true });
      caster.startDash(dest.x, dest.z, p.duration, p.invulnerable);
      return true;
    },
  },

  // Passivas não são "usadas": o bônus é aplicado em entities/stats.js
  passive: {
    execute() { return false; },
  },
};

// Modificadores de um buff no nível dado: mods + modsPerLevel * (nível - 1)
export function buffMods(def, level) {
  const p = def.params;
  const mods = {};
  for (const [stat, value] of Object.entries(p.mods)) mods[stat] = value + (p.modsPerLevel?.[stat] ?? 0) * (level - 1);
  return mods;
}

// Comportamentos das próximas etapas: já existem para o jogo não quebrar,
// mas ainda não fazem nada.
const FUTURE_BEHAVIORS = ['curse'];
for (const name of FUTURE_BEHAVIORS) {
  BEHAVIORS[name] ??= { future: true, execute() { return false; } };
}
