// =============================================================
// player.js — o personagem do jogador.
//
// Responsabilidades:
//   - ler o mouse/teclado (clique esquerdo anda/ataca, direito usa habilidade...)
//   - andar com A*, perseguir o alvo, atacar, pegar itens, usar portais
//   - recurso da classe (Mana / Fúria / Foco), poções, XP e níveis
//   - gerar os dados para salvar (toSaveData)
// =============================================================
import { Entity } from './entity.js';
import { computePlayerStats } from './stats.js';
import { Inventory } from '../systems/inventory.js';
import { createItem } from '../systems/loot.js';
import { dealDamage, rand } from '../systems/combat.js';
import { CONFIG, xpToNextLevel } from '../config.js';
import { CLASSES } from '../classes/index.js';
import { SKILLS } from '../skills/skillData.js';
import { tryUseSkill, updateCooldowns, updateSustained, canLearnSkill, inSkillRange } from '../skills/skillSystem.js';
import { isStunned, moveSpeedMultiplier, attackSpeedMultiplier, clearEffects } from '../skills/statusEffects.js';
import { findPath } from '../core/pathfinding.js';
import { BOW_RELEASE } from '../core/assets.js';
import { randomSeed } from '../core/rng.js';
import { events } from '../core/events.js';
import { game } from '../game.js';

export class Player extends Entity {
  // data = { classId, name } para um personagem novo, ou os dados de um save
  constructor(data) {
    const classDef = CLASSES[data.classId];
    if (!classDef) throw new Error(`Classe desconhecida: ${data.classId}`);
    super(classDef.model, 'player');

    this.classDef = classDef;
    this.id = data.id ?? `char_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.name = data.name;
    this.createdAt = data.createdAt ?? Date.now();
    this.level = data.level ?? 1;
    this.xp = data.xp ?? 0;
    this.allocated = { str: 0, dex: 0, int: 0, vit: 0, ...data.allocated };
    this.attrPoints = data.attrPoints ?? 0;
    this.skillPoints = data.skillPoints ?? 0;
    this.skillLevels = { ...(data.skillLevels ?? classDef.startingSkills) };
    // Saves antigos: garante as habilidades iniciais da classe (nível 1)
    for (const [id, lvl] of Object.entries(classDef.startingSkills)) {
      if (!this.skillLevels[id]) this.skillLevels[id] = lvl;
    }
    this.skillBar = data.skillBar ? [...data.skillBar] : [...classDef.skillBar];
    // Completa com espaços vazios (saves antigos tinham só 4)
    this.skillBar.length = CONFIG.player.skillSlots;
    for (let i = 0; i < this.skillBar.length; i++) this.skillBar[i] ??= null;
    this.selectedSlot = 0;
    this.gold = data.gold ?? CONFIG.economy.startingGold;
    this.potions = { hp: 3, res: 2, scroll: 1, ...data.potions };
    this.deepestFloor = data.deepestFloor ?? 0;
    this.victories = data.victories ?? 0;          // quantas vezes derrotou o chefe final
    this.skinTone = data.skinTone ?? 0;            // tom de pele escolhido na criação (0 = original)
    this.model.setSkinTone(this.skinTone);
    this.seed = data.seed ?? randomSeed();        // seed das masmorras deste personagem
    this.townPortalFloor = data.townPortalFloor ?? 0; // andar do portal aberto (0 = nenhum)
    this.waypoints = [...(data.waypoints ?? [])];      // andares com waypoint já ativado (5, 10...)

    this.inventory = new Inventory(CONFIG.inventory.cols, CONFIG.inventory.rows);
    if (data.inventory) {
      this.inventory.load(data.inventory);
    } else {
      for (const baseId of classDef.startingGear) this.inventory.equipDirect(createItem(baseId, 'common', 1));
    }
    // Sempre que o inventário mudar: recalcula atributos, troca a arma/escudo
    // visível no modelo e avisa a interface
    this.model.setEquipment(this.inventory.equipment);
    this.inventory.onChange = () => {
      this.recalcStats();
      this.model.setEquipment(this.inventory.equipment);
      events.emit('inventoryChanged');
    };

    // Estado de ação
    this.cooldowns = {};
    this.actionLock = 0;     // segundos em que o jogador está "ocupado" (golpe, magia)
    this.attackTimer = 0;    // recarga do ataque básico
    this.potionTimer = 0;
    this.combatTimer = 99;   // segundos desde a última ação de combate (usado pela Fúria)
    this.repathTimer = 0;
    this.holdMoveTimer = 0;
    this.leftMode = null;    // 'move' quando o botão esquerdo está segurado no chão

    // Alvos atuais (só um deles fica ativo por vez)
    this.attackTarget = null;
    this.pickupTarget = null;
    this.interactTarget = null;
    this.pendingSkill = null; // habilidade esperando o jogador chegar perto
    this.dash = null;         // movimento rápido (Rolamento, Investida)
    this.sustained = null;    // habilidade em andamento enquanto o botão direito está apertado

    this.resource = 0;
    this.recalcStats();
    this.hp = this.stats.maxHp;
    this.resource = classDef.resource.startFull === false ? 0 : this.stats.maxResource;
  }

  recalcStats() {
    this.stats = computePlayerStats(this);
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp;
    if (this.resource > this.stats.maxResource) this.resource = this.stats.maxResource;
    events.emit('statsChanged', this);
  }

  get xpToNext() { return xpToNextLevel(this.level); }

  // ======================= ENTRADA DO JOGADOR =======================
  // Teclas (funcionam até enquanto canaliza)
  handleKeys() {
    const input = game.input;
    for (let i = 0; i < this.skillBar.length; i++) if (input.wasPressed(`Digit${i + 1}`)) this.selectSlot(i);
    if (input.wasPressed('KeyQ')) this.drinkPotion('hp');
    if (input.wasPressed('KeyW')) this.drinkPotion('res');
    if (input.wasPressed('KeyT')) this.useTownPortalScroll();
  }

  // Mouse: clique esquerdo anda/ataca/interage, direito usa a habilidade
  handleMouse(dt) {
    const input = game.input;
    const pick = game.pick;

    // Clique esquerdo: anda, ataca ou interage
    if (input.leftPressed) {
      this.onLeftClick(pick);
    } else if (input.leftDown && this.leftMode === 'move') {
      // Segurando o botão: o personagem segue o mouse (como no Diablo)
      this.holdMoveTimer -= dt;
      if (this.holdMoveTimer <= 0 && pick.point) {
        this.holdMoveTimer = 0.15;
        this.moveTo(pick.point.x, pick.point.z);
      }
    }
    if (!input.leftDown && this.leftMode === 'move') this.leftMode = null;

    // Botão direito (segurado = repete quando a recarga permitir)
    if (input.rightDown) this.useSelectedSkill(pick);
  }

  onLeftClick(pick) {
    this.clearTargets();
    if (pick.enemy) {
      this.attackTarget = pick.enemy;
    } else if (pick.interactable) {
      this.interactTarget = pick.interactable;
      this.moveTo(pick.interactable.position.x, pick.interactable.position.z);
    } else if (pick.point) {
      this.leftMode = 'move';
      this.holdMoveTimer = 0.15;
      this.moveTo(pick.point.x, pick.point.z);
      game.vfx.ring(pick.point, 0x9fe08a, 0.45, 0.3); // marquinha no chão
    }
  }

  clearTargets() {
    this.attackTarget = null;
    this.pickupTarget = null;
    this.interactTarget = null;
    this.pendingSkill = null;
    this.leftMode = null;
  }

  // Clicou no nome de um item no chão
  setPickupTarget(entry) {
    if (!this.alive || this.dash) return;
    this.clearTargets();
    this.pickupTarget = entry;
    this.moveTo(entry.x, entry.z);
  }

  selectSlot(index) {
    this.selectedSlot = index;
    events.emit('skillSlotChanged', index);
  }

  // Coloca a habilidade `id` no espaço `index` da barra.
  // Se ela já estava em outro espaço, os dois trocam de lugar.
  assignSkill(index, id) {
    const def = SKILLS[id];
    if (!def || index < 0 || index >= this.skillBar.length) return false;
    if (def.behavior === 'passive') { game.ui.message('Passivas funcionam sozinhas: não precisam ir para a barra.'); return false; }
    if ((this.skillLevels[id] ?? 0) <= 0) { game.ui.message(`Aprenda ${def.name} antes de colocá-la na barra.`); return false; }
    const previousIndex = this.skillBar.indexOf(id);
    if (previousIndex >= 0) this.skillBar[previousIndex] = this.skillBar[index];
    this.skillBar[index] = id;
    events.emit('skillBarChanged');
    return true;
  }

  useSelectedSkill(pick) {
    const id = this.skillBar[this.selectedSlot];
    if (!id || this.actionLock > 0 || this.dash) return;
    const result = tryUseSkill(this, id, pick);
    if (result === true) {
      this.path = null;
      this.attackTarget = null;
      this.leftMode = null;
    }
  }

  // Chamado pelo behavior meleeStrike quando o alvo está longe
  queueSkill(id, enemy) {
    this.clearTargets();
    this.pendingSkill = { id, enemy };
  }

  moveTo(x, z) {
    this.setPath(findPath(game.world.grid, this.position.x, this.position.z, x, z));
  }

  // ======================= LOOP =======================
  update(dt) {
    if (!this.alive) {
      this.updateBase(dt);
      return;
    }

    updateCooldowns(this, dt);
    this.actionLock = Math.max(0, this.actionLock - dt);
    this.attackTimer -= dt;
    this.potionTimer -= dt;
    this.combatTimer += dt;
    this.updateResource(dt);
    this.heal(this.stats.hpRegen * dt);

    if (this.dash) {
      this.updateDash(dt);
    } else if (isStunned(this)) {
      if (this.sustained) this.stopSustained();
    } else if (this.sustained) {
      // Canalizando / carregando: fica parado. Clique esquerdo cancela.
      this.handleKeys();
      if (game.input.leftPressed) {
        this.stopSustained();
        this.handleMouse(dt);
      } else {
        updateSustained(this, dt);
      }
    } else {
      this.handleKeys();
      this.handleMouse(dt);
      this.updateTargets(dt);
      let moving = false;
      if (this.actionLock <= 0) moving = this.followPath(dt, this.stats.moveSpeed * moveSpeedMultiplier(this));
      this.animate(moving);
    }

    this.updateBase(dt);
  }

  updateTargets(dt) {
    this.repathTimer -= dt;

    // 1) Habilidade na fila (ex.: Golpe Poderoso num inimigo distante)
    if (this.pendingSkill) {
      const { id, enemy } = this.pendingSkill;
      if (!enemy.alive) { this.pendingSkill = null; return; }
      if (inSkillRange(this, enemy, SKILLS[id])) {
        this.pendingSkill = null;
        this.path = null;
        tryUseSkill(this, id, { enemy, point: enemy.position });
      } else {
        this.chase(enemy);
      }
      return;
    }

    // 2) Ataque básico no inimigo clicado
    if (this.attackTarget) {
      const target = this.attackTarget;
      if (!target.alive) { this.attackTarget = null; return; }
      const basic = this.classDef.basicAttack;
      const inRange = this.distanceTo(target) - target.radius <= basic.range;
      const canSee = basic.type !== 'projectile' ||
        game.world.grid.lineOfSight(this.position.x, this.position.z, target.position.x, target.position.z);
      if (inRange && canSee) {
        this.path = null;
        if (this.attackTimer <= 0 && this.actionLock <= 0) this.basicAttack(target);
      } else {
        this.chase(target);
      }
      return;
    }

    // 3) Pegar item no chão
    if (this.pickupTarget) {
      const entry = this.pickupTarget;
      if (!entry.alive) { this.pickupTarget = null; return; }
      if (this.distanceToPoint(entry.x, entry.z) <= CONFIG.player.pickupRange) {
        this.path = null;
        this.pickupTarget = null;
        game.groundItems.pickup(entry, this);
      } else if (!this.path) {
        this.pickupTarget = null; // não conseguiu chegar
      }
      return;
    }

    // 4) Usar portal / falar com NPC
    if (this.interactTarget) {
      const it = this.interactTarget;
      if (this.distanceToPoint(it.position.x, it.position.z) <= (it.radius ?? CONFIG.player.interactRange)) {
        this.path = null;
        this.interactTarget = null;
        this.faceTowards(it.position.x, it.position.z);
        it.onUse(this);
      } else if (!this.path) {
        this.interactTarget = null;
      }
    }
  }

  chase(target) {
    if (this.repathTimer <= 0 || !this.path) {
      this.repathTimer = 0.25;
      this.moveTo(target.position.x, target.position.z);
    }
  }

  basicAttack(target) {
    const basic = this.classDef.basicAttack;
    const attackSpeed = this.stats.attackSpeed * attackSpeedMultiplier(this);
    this.faceTowards(target.position.x, target.position.z);
    this.attackTimer = 1 / attackSpeed;
    this.actionLock = Math.min(0.3, 0.6 / attackSpeed);
    this.model.play('attack', { once: true });
    this.inCombat();

    const amount = rand(this.stats.damageMin, this.stats.damageMax);
    if (basic.type === 'melee') {
      game.sound.play('swing');
      const result = dealDamage(this, target, { amount, type: 'physical' });
      if (result) game.vfx.burst(target.position, 0xffffff, 0.5, target.height * 0.6);
    } else {
      // A direção é calculada na hora do disparo: com arco, a flecha sai depois de puxar a corda
      this.afterDraw(() => {
        game.sound.play('bow');
        const dx = target.position.x - this.position.x, dz = target.position.z - this.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const pr = basic.projectile;
        game.projectiles.spawn({
          owner: this, team: 'player',
          x: this.position.x + (dx / len) * 0.5, y: 1.2, z: this.position.z + (dz / len) * 0.5,
          dirX: dx / len, dirZ: dz / len,
          speed: pr.speed, range: pr.range, radius: pr.radius, kind: pr.kind, color: pr.color, scale: 1,
          pierce: false, damage: amount, damageType: 'physical', onHit: null, level: 1,
        });
      });
    }
  }

  // Com um arco de verdade (modelo com esqueleto), o tiro sai só depois de a corda ser puxada
  get fireDelay() {
    return this.model.rig?.style.hold === 'bow' ? BOW_RELEASE : 0;
  }

  afterDraw(fire) {
    const delay = this.fireDelay;
    if (delay <= 0) { fire(); return; }
    game.timers.after(delay, () => { if (this.alive) fire(); });
  }

  // ======================= DASH (Rolamento, Investida) =======================
  // onComplete: função chamada ao chegar (a Investida golpeia ali)
  startDash(toX, toZ, duration, invulnerable, onComplete = null) {
    this.clearTargets();
    this.path = null;
    this.dash = { fromX: this.position.x, fromZ: this.position.z, toX, toZ, t: 0, duration, onComplete };
    this.invulnerable = !!invulnerable;
  }

  updateDash(dt) {
    const d = this.dash;
    d.t += dt;
    const p = Math.min(1, d.t / d.duration);
    this.position.x = d.fromX + (d.toX - d.fromX) * p;
    this.position.z = d.fromZ + (d.toZ - d.fromZ) * p;
    if (p >= 1) {
      this.dash = null;
      this.invulnerable = false;
      d.onComplete?.();
    }
  }

  // ======================= HABILIDADES SUSTENTADAS =======================
  // (Drenar Vida, Tiro Concentrado) — veja behaviors.js
  startSustained(state) {
    this.clearTargets();
    this.path = null;
    this.sustained = state;
  }

  stopSustained() {
    this.sustained = null;
    if (this.model.state === 'channel') this.model.play('idle');
  }

  // ======================= COMBATE / RECURSO =======================
  // Chamado pelo combat.js quando ESTE personagem causa dano
  onDealtDamage(target, amount) {
    this.inCombat();
    const r = this.classDef.resource;
    if (r.type === 'fury') this.gainResource(r.gainOnHit);
    if (this.stats.lifeOnHit) this.heal(this.stats.lifeOnHit);
  }

  onDamaged(amount) {
    this.inCombat();
    const r = this.classDef.resource;
    if (r.type === 'fury') this.gainResource(r.gainOnHurt);
    events.emit('playerHurt', amount);
  }

  inCombat() { this.combatTimer = 0; }

  // Orbe Sombrio: parte do dano é paga com o recurso (mana) em vez da vida.
  // Chamado pelo combat.js; devolve quanto do dano foi absorvido.
  absorbDamage(damage) {
    const pct = this.stats.manaShieldPct ?? 0;
    if (pct <= 0 || this.resource <= 0) return 0;
    const costPerPoint = this.stats.manaShieldCost;
    const absorbed = Math.min(damage * pct / 100, this.resource / costPerPoint);
    this.spendResource(absorbed * costPerPoint);
    return absorbed;
  }

  updateResource(dt) {
    const r = this.classDef.resource;
    if (r.type === 'fury') {
      // A Fúria só cai depois de alguns segundos fora de combate
      if (this.combatTimer > r.decayDelay) this.resource = Math.max(0, this.resource - r.decayPerSecond * dt);
    } else {
      this.resource = Math.min(this.stats.maxResource, this.resource + this.stats.resourceRegen * dt);
    }
  }

  spendResource(amount) { this.resource = Math.max(0, this.resource - amount); }
  gainResource(amount) { this.resource = Math.min(this.stats.maxResource, this.resource + amount); }

  addGold(amount) {
    this.gold = Math.max(0, this.gold + amount);
    events.emit('goldChanged', this.gold);
  }

  drinkPotion(kind) {
    if (this.potionTimer > 0) return;
    if (this.potions[kind] <= 0) {
      game.ui.message(kind === 'hp' ? 'Sem poções de vida!' : `Sem poções de ${this.classDef.resource.name}!`);
      return;
    }
    if (kind === 'hp') {
      if (this.hp >= this.stats.maxHp) { game.ui.message('Sua vida já está cheia.'); return; }
      this.heal(this.stats.maxHp * CONFIG.potions.hpRestorePct);
      game.vfx.burst(this.position, 0xff3333, 0.8, 1);
    } else {
      if (this.resource >= this.stats.maxResource) { game.ui.message(`Sua ${this.classDef.resource.name} já está cheia.`); return; }
      this.gainResource(this.stats.maxResource * CONFIG.potions.resourceRestorePct);
      game.vfx.burst(this.position, 0x3366ff, 0.8, 1);
    }
    game.sound.play('potion', { kind });
    this.potions[kind]--;
    this.potionTimer = CONFIG.combat.potionCooldown;
    events.emit('potionsChanged');
  }

  useTownPortalScroll() {
    if (game.world.kind !== 'dungeon') { game.ui.message('O pergaminho só funciona no Oblivion.'); return; }
    if (this.potions.scroll <= 0) { game.ui.message('Você não tem Pergaminhos de Portal.'); return; }
    this.potions.scroll--;
    events.emit('potionsChanged');
    game.world.openTownPortal(this.position.x, this.position.z);
    game.ui.message('Um portal para o vilarejo se abriu.');
  }

  // ======================= PROGRESSÃO =======================
  gainXp(amount) {
    if (this.level >= CONFIG.progression.maxLevel) return;
    this.xp += amount;
    while (this.xp >= this.xpToNext && this.level < CONFIG.progression.maxLevel) {
      this.xp -= this.xpToNext;
      this.level++;
      this.attrPoints += CONFIG.progression.attributePointsPerLevel;
      this.skillPoints += CONFIG.progression.skillPointsPerLevel;
      this.recalcStats();
      this.hp = this.stats.maxHp;
      if (this.classDef.resource.type !== 'fury') this.resource = this.stats.maxResource;
      events.emit('levelUp', this);
    }
    events.emit('xpChanged');
  }

  allocateAttribute(attr) {
    if (this.attrPoints <= 0 || !(attr in this.allocated)) return;
    this.allocated[attr]++;
    this.attrPoints--;
    this.recalcStats();
  }

  learnSkill(id) {
    if (!canLearnSkill(this, id)) return false;
    const firstTime = !this.skillLevels[id];
    this.skillLevels[id] = (this.skillLevels[id] ?? 0) + 1;
    this.skillPoints--;
    this.recalcStats(); // passivas mudam atributos
    events.emit('skillsChanged');

    // Habilidade ativa nova: vai para o primeiro espaço vazio da barra
    const def = SKILLS[id];
    if (firstTime && def.behavior !== 'passive' && !this.skillBar.includes(id)) {
      const free = this.skillBar.indexOf(null);
      if (free >= 0 && this.assignSkill(free, id)) {
        game.ui.message(`${def.name} aprendida! Está na barra (tecla ${free + 1}).`, '#ffd27a');
      } else {
        game.ui.message(`${def.name} aprendida! Na ficha (C), passe o mouse nela e aperte 1–${this.skillBar.length} para pô-la na barra.`, '#ffd27a');
      }
    }
    return true;
  }

  die(killer) {
    super.die(killer);
    this.clearTargets();
    this.dash = null;
    this.sustained = null;
    events.emit('playerDied');
  }

  respawn() {
    this.alive = true;
    this.invulnerable = false;
    this.dash = null;
    this.sustained = null;
    this.path = null;
    this.clearTargets();
    clearEffects(this);
    this.position.y = 0;
    this.hp = this.stats.maxHp;
    this.resource = this.classDef.resource.type === 'fury' ? 0 : this.stats.maxResource;
    this.model.play('idle');
  }

  // Cura total (ao entrar no vilarejo)
  restoreAll() {
    this.hp = this.stats.maxHp;
    if (this.classDef.resource.type !== 'fury') this.resource = this.stats.maxResource;
  }

  // ======================= SAVE =======================
  toSaveData() {
    return {
      id: this.id,
      name: this.name,
      classId: this.classDef.id,
      createdAt: this.createdAt,
      level: this.level,
      xp: this.xp,
      allocated: { ...this.allocated },
      attrPoints: this.attrPoints,
      skillPoints: this.skillPoints,
      skillLevels: { ...this.skillLevels },
      skillBar: [...this.skillBar],
      gold: this.gold,
      potions: { ...this.potions },
      deepestFloor: this.deepestFloor,
      victories: this.victories,
      skinTone: this.skinTone,
      seed: this.seed,
      townPortalFloor: this.townPortalFloor,
      waypoints: [...this.waypoints],
      inventory: this.inventory.toJSON(),
    };
  }
}
