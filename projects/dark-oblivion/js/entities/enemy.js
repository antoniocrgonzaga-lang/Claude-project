// =============================================================
// enemy.js — inimigo com IA simples (máquina de estados):
//
//   idle   → parado; se vir o jogador dentro do raio de detecção → chase
//   chase  → persegue usando A*; se chegar ao alcance → attack
//   attack → vira para o jogador, "prepara" o golpe (windup) e causa dano
//   (morto) → toca a animação de morte, afunda no chão e é removido
//
// Inimigos à distância (cultista) só atacam se tiverem linha de visão.
//
// CHEFES usam a mesma classe, com extras definidos em data/enemies.js:
//   abilities → 'nova' (onda em área com aviso no chão), 'volley' (anel de
//               projéteis) e 'summon' (convoca servos)
//   enrageAtHpPct → abaixo dessa % de vida fica mais rápido
// =============================================================
import { Entity } from './entity.js';
import { ENEMIES } from '../data/enemies.js';
import { computeEnemyStats } from './stats.js';
import { findPath } from '../core/pathfinding.js';
import { dealDamage, rand } from '../systems/combat.js';
import { isStunned, moveSpeedMultiplier, attackSpeedMultiplier } from '../skills/statusEffects.js';
import { events } from '../core/events.js';
import { game } from '../game.js';

export class Enemy extends Entity {
  constructor(typeId, floor) {
    const def = ENEMIES[typeId];
    if (!def) throw new Error(`Inimigo desconhecido: ${typeId}`);
    super(def.model, 'enemy');
    this.typeId = typeId;
    this.def = def;
    this.name = def.name;
    this.floor = floor;
    this.stats = computeEnemyStats(def, floor);
    this.level = this.stats.level;
    this.hp = this.stats.maxHp;

    this.state = 'idle';
    this.attackTimer = Math.random() * 0.6; // pequena variação para não atacarem todos juntos
    this.windup = 0;
    this.repathTimer = Math.random() * 0.4;
    this.deadTime = 0;
    this.removed = false; // quando true, o WorldManager tira ele do jogo

    // Extras de chefe
    this.isBoss = !!def.boss;
    this.abilities = (def.abilities ?? []).map((a) => ({ def: a, timer: a.initialDelay ?? a.cooldown ?? 0 }));
    this.casting = null;          // habilidade sendo preparada (com aviso no chão)
    this.phasesDone = new Set();  // convocações já feitas
    this.enraged = false;

    // A animação de ataque acerta junto com o dano (fim da preparação do golpe)
    this.model.attackWindup = def.attackWindup;
    this.model.attackLength = def.attackWindup + 0.4;

    this.createHealthBar();
    if (def.finalBoss) this.healthBar.group.scale.setScalar(2.8);
    else if (this.isBoss) this.healthBar.group.scale.setScalar(2);
    else if (this.radius > 0.5) this.healthBar.group.scale.setScalar(1.4); // barra maior para inimigos grandes
  }

  update(dt, player) {
    // ----- morto: afunda no chão e some -----
    if (!this.alive) {
      this.deadTime += dt;
      if (this.deadTime > 1.5) this.position.y = -(this.deadTime - 1.5) * 0.8;
      if (this.deadTime > 3) this.removed = true;
      this.updateBase(dt);
      return;
    }

    this.attackTimer -= dt;

    if (isStunned(this)) {
      this.windup = 0;
      this.path = null;
      this.model.play('idle');
      this.updateBase(dt);
      return;
    }

    const def = this.def;
    const grid = game.world.grid;
    const dist = this.distanceTo(player);

    // Habilidades especiais (chefes): enquanto prepara uma, não faz mais nada
    if (this.state !== 'idle' && player.alive && this.updateAbilities(dt, player, dist)) {
      this.updateBase(dt);
      return;
    }

    const hasLineOfSight = () => grid.lineOfSight(this.position.x, this.position.z, player.position.x, player.position.z);
    const inAttackRange = (tolerance = 1) =>
      dist - player.radius <= def.attackRange * tolerance && (def.behavior !== 'ranged' || hasLineOfSight());
    const speedMult = this.enraged ? 1.3 : 1;

    switch (this.state) {
      case 'idle':
        if (player.alive && dist < def.aggroRange && hasLineOfSight()) this.state = 'chase';
        break;

      case 'chase':
        if (!player.alive || dist > def.aggroRange * 2.5) { // desistiu
          this.state = 'idle';
          this.path = null;
          break;
        }
        if (inAttackRange()) {
          this.state = 'attack';
          this.path = null;
          break;
        }
        // Recalcula o caminho de tempos em tempos (não todo quadro, para poupar CPU)
        this.repathTimer -= dt;
        if (this.repathTimer <= 0 || !this.path) {
          this.repathTimer = 0.35 + Math.random() * 0.3;
          this.setPath(findPath(grid, this.position.x, this.position.z, player.position.x, player.position.z));
        }
        break;

      case 'attack':
        if (!player.alive) { this.state = 'idle'; this.windup = 0; break; }
        this.faceTowards(player.position.x, player.position.z);
        if (this.windup > 0) {
          this.windup -= dt;
          if (this.windup <= 0) this.performAttack(player);
        } else if (!inAttackRange(1.15)) {
          this.state = 'chase';
          this.repathTimer = 0;
        } else if (this.attackTimer <= 0) {
          this.windup = def.attackWindup / speedMult;
          this.attackTimer = def.attackCooldown / attackSpeedMultiplier(this) / speedMult;
          this.model.play('attack', { once: true });
        }
        break;
    }

    let moving = false;
    if (this.state === 'chase') moving = this.followPath(dt, def.moveSpeed * moveSpeedMultiplier(this) * speedMult);
    this.animate(moving);
    this.updateBase(dt);
  }

  performAttack(player) {
    if (!player.alive) return;
    const def = this.def;
    const amount = rand(this.stats.damageMin, this.stats.damageMax);

    if (def.behavior === 'ranged') {
      const dx = player.position.x - this.position.x, dz = player.position.z - this.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const pr = def.projectile;
      game.projectiles.spawn({
        owner: this, team: 'enemy',
        x: this.position.x + (dx / len) * 0.5, y: 1.2, z: this.position.z + (dz / len) * 0.5,
        dirX: dx / len, dirZ: dz / len,
        speed: pr.speed, range: pr.range, radius: pr.radius,
        kind: pr.kind, color: pr.color, scale: pr.scale ?? 1,
        pierce: false, damage: amount, damageType: def.damageType, onHit: null, level: this.level,
      });
    } else if (this.distanceTo(player) - player.radius <= def.attackRange * 1.3) {
      // O jogador pode ter saído do alcance durante a preparação do golpe
      dealDamage(this, player, { amount, type: def.damageType });
      if (this.isBoss) game.vfx.ring(player.position, 0xff6030, 1.2, 0.25);
    }
  }

  // ======================= HABILIDADES DE CHEFE =======================
  // Devolve true se o inimigo está ocupado com uma habilidade neste quadro
  updateAbilities(dt, player, dist) {
    if (!this.abilities.length) return false;

    // As recargas correm sempre (inclusive durante golpes e outras magias);
    // se só corressem com o chefe parado, ele quase nunca usaria as habilidades.
    for (const ab of this.abilities) ab.timer -= dt;

    if (this.casting) {
      this.casting.t -= dt;
      this.faceTowards(player.position.x, player.position.z);
      if (this.casting.t <= 0) {
        this.resolveAbility(this.casting.ability, player);
        this.casting = null;
        this.model.play('idle');
      }
      return true;
    }
    if (this.windup > 0) return false; // está no meio de um golpe normal

    for (const ab of this.abilities) {
      const a = ab.def;
      if ((a.type === 'nova' || a.type === 'volley') && ab.timer <= 0 && dist <= a.triggerRange) {
        ab.timer = a.cooldown * (this.enraged ? 0.7 : 1);
        this.casting = { ability: a, t: a.windup };
        this.path = null;
        if (a.type === 'nova') game.vfx.telegraph(this.position, a.color, a.radius, a.windup); // aviso no chão: saia daí!
        else game.vfx.ring(this.position, a.color, this.radius + 1.5, a.windup);             // aviso: vem rajada
        this.model.play('channel');
        return true;
      }
    }
    return false;
  }

  resolveAbility(a, player) {
    if (a.type === 'nova') {
      game.vfx.ring(this.position, a.color, a.radius, 0.5);
      game.vfx.burst(this.position, a.color, a.radius * 0.45, 0.3);
      if (player.alive && this.distanceTo(player) <= a.radius + player.radius) {
        const amount = rand(this.stats.damageMin, this.stats.damageMax) * a.damageMult;
        dealDamage(this, player, { amount, type: a.damageType, canBlock: false });
      }
    } else if (a.type === 'volley') {
      // Anel de projéteis em todas as direções (mais projéteis em fúria)
      const count = this.enraged ? a.enragedCount ?? a.count : a.count;
      const offset = Math.random() * Math.PI * 2;
      const pr = a.projectile;
      game.vfx.burst(this.position, a.color, this.radius + 0.5, this.height * 0.5);
      for (let i = 0; i < count; i++) {
        const angle = offset + (i / count) * Math.PI * 2;
        const dirX = Math.sin(angle), dirZ = Math.cos(angle);
        game.projectiles.spawn({
          owner: this, team: 'enemy',
          x: this.position.x + dirX * (this.radius + 0.3), y: 1.4, z: this.position.z + dirZ * (this.radius + 0.3),
          dirX, dirZ,
          speed: pr.speed, range: pr.range, radius: pr.radius, kind: pr.kind, color: a.color, scale: pr.scale ?? 1,
          pierce: false, damage: rand(this.stats.damageMin, this.stats.damageMax) * a.damageMult,
          damageType: a.damageType, onHit: null, level: this.level,
        });
      }
    }
  }

  // Convocações e fúria acontecem ao chegar em certas % de vida
  checkBossPhases() {
    if (!this.alive || this.hp <= 0) return; // golpe mortal: morre sem convocar ninguém
    const pct = this.hp / this.stats.maxHp;
    for (const a of this.def.abilities ?? []) {
      if (a.type !== 'summon') continue;
      for (const threshold of a.atHpPct) {
        const key = `summon_${a.enemy}_${threshold}`; // inclui o servo: um chefe pode ter várias convocações
        if (pct <= threshold && !this.phasesDone.has(key)) {
          this.phasesDone.add(key);
          this.summon(a);
        }
      }
    }
    if (!this.enraged && this.def.enrageAtHpPct && pct <= this.def.enrageAtHpPct) {
      this.enraged = true;
      game.ui.message(`${this.name} entra em fúria!`, '#ff5040');
      game.vfx.ring(this.position, 0xff2000, 3.5, 0.6);
      game.vfx.pillar(this, 0xff2000);
    }
  }

  summon(a) {
    game.ui.message(`${this.name} convoca seus servos!`, '#ff8060');
    for (let i = 0; i < a.count; i++) {
      const angle = (i / a.count) * Math.PI * 2;
      let x = this.position.x + Math.cos(angle) * 2.2, z = this.position.z + Math.sin(angle) * 2.2;
      if (!game.world.grid.isWalkableWorld(x, z)) { x = this.position.x; z = this.position.z; }
      const minion = game.world.spawnEnemy(a.enemy, x, z);
      minion.state = 'chase';
      game.vfx.burst({ x, y: 0, z }, 0xff4400, 0.8, 0.5);
    }
  }

  // ======================= EVENTOS =======================
  onDamaged() {
    this.alwaysShowBar = true;
    this.model.flinch();
    if (this.isBoss) this.checkBossPhases();
    if (this.state !== 'idle') return;
    this.state = 'chase';
    // Alerta os companheiros próximos
    for (const other of game.world.enemies) {
      if (other !== this && other.alive && other.state === 'idle' && this.distanceTo(other) < 7) other.state = 'chase';
    }
  }

  onDeath(killer) {
    this.windup = 0;
    this.casting = null;
    if (this.healthBar) this.healthBar.group.visible = false;
    events.emit('enemyKilled', { enemy: this, killer });
  }
}
