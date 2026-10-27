// =============================================================
// worldManager.js — controla a área atual (vilarejo ou andar N).
//
//   goTo(kind, floor) → escurece a tela, destrói a área antiga, monta a
//                       nova, posiciona o jogador, cria os inimigos e
//                       clareia a tela.
//   update(dt)        → atualiza a área e todos os inimigos.
//   pick(mouse)       → descobre o que está debaixo do mouse:
//                       { enemy, interactable, point (no chão) }
// =============================================================
import * as THREE from 'three';
import { buildVillage } from './village.js';
import { buildDungeon } from './dungeon.js';
import { Enemy } from '../entities/enemy.js';
import { shop } from '../systems/shop.js';
import { hashSeed } from '../core/rng.js';
import { events } from '../core/events.js';
import { CONFIG } from '../config.js';
import { updateCutaway } from './cutaway.js';
import { game } from '../game.js';

export class WorldManager {
  constructor() {
    this.area = null;
    this.kind = null;
    this.floor = 0;
    this.enemies = [];
    this.boss = null;      // chefe do andar atual (se houver)
    this.changing = false; // true durante a transição (o jogo "pausa")

    // Chefe derrotado: abre a escadaria e comemora
    events.on('enemyKilled', ({ enemy }) => {
      if (enemy !== this.boss) return;
      this.area?.onBossDefeated?.();
      if (enemy.def.finalBoss) {
        events.emit('gameCompleted', { boss: enemy }); // vitória! (main.js mostra a tela e salva)
      } else {
        game.ui.message(`${enemy.name} foi derrotado! A escadaria se abriu.`, '#ffd27a');
      }
    });

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // plano y = 0
    this._hitList = [];
    this._point = new THREE.Vector3();
    this._pick = { enemy: null, interactable: null, point: null };
  }

  get grid() { return this.area?.grid ?? null; }

  async goTo(kind, floor = 0, options = {}) {
    if (this.changing) return;
    this.changing = true;
    const { ui } = game;

    await ui.fadeOut();
    try {
      this.load(kind, floor, options);
    } catch (err) {
      // Se algo der errado, avisa no console em vez de deixar a tela preta para sempre
      console.error(`[world] Erro ao carregar ${kind} ${floor}:`, err);
      ui.message('Erro ao carregar a área (veja o console, F12).', '#ff6060');
    } finally {
      await ui.fadeIn();
      this.changing = false;
    }
  }

  // Monta a nova área (chamado por goTo, com a tela já escura)
  load(kind, floor, options) {
    const { scene, player, ui } = game;
    ui.closeAll();
    this.unload();

    this.kind = kind;
    this.floor = kind === 'dungeon' ? floor : 0;
    this.area = kind === 'village'
      ? buildVillage()
      : buildDungeon(floor, hashSeed(player.seed, 'floor', floor)); // mesma seed = mesmo andar
    scene.add(this.area.group);

    const env = this.area.environment;
    scene.background = new THREE.Color(env.background);
    scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);

    if (options.revive) player.respawn();
    player.clearTargets();
    player.path = null;
    player.dash = null;
    player.invulnerable = false;
    player.position.set(this.area.spawn.x, 0, this.area.spawn.z);

    if (kind === 'village') {
      player.restoreAll();
      shop.refreshStock(player);
      this.area.setReturnPortal(player.townPortalFloor);
    } else {
      player.deepestFloor = Math.max(player.deepestFloor, floor);
      for (const s of this.area.enemySpawns) this.spawnEnemy(s.type, s.x, s.z);
      // Chegou num andar com waypoint pela primeira vez: ativa
      if (floor % CONFIG.world.waypointEvery === 0 && !player.waypoints.includes(floor)) {
        player.waypoints.push(floor);
        player.waypoints.sort((a, b) => a - b);
        ui.message(`Waypoint do Andar ${floor} ativado! Use-o para voltar ao vilarejo e retomar daqui.`, '#7fe0ff');
      }
      // Primeiro andar de uma faixa nova (1, 6, 11...): o visual mudou, diz onde o jogador está
      if ((floor - 1) % CONFIG.world.bossEvery === 0 && this.area.themeName) ui.message(`— ${this.area.themeName} —`, '#d8b090');
      if (this.boss) ui.message(`Você sente a presença de ${this.boss.name}...`, '#ff8060');
    }

    game.cam.snapTo(player.position);
    events.emit('areaChanged', { kind, floor: this.floor, name: this.area.name });
  }

  unload() {
    if (!this.area) return;
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    this.boss = null;
    game.projectiles.clear();
    game.timers.clear();
    game.groundItems.clear();
    game.vfx.clear();
    game.damageNumbers.clear();
    game.scene.remove(this.area.group);
    this.area.dispose();
    this.area = null;
  }

  spawnEnemy(typeId, x, z) {
    const enemy = new Enemy(typeId, this.floor);
    enemy.position.set(x, 0, z);
    enemy.root.rotation.y = Math.random() * Math.PI * 2;
    enemy.addToScene(game.scene);
    this.enemies.push(enemy);
    if (enemy.isBoss) this.boss = enemy;
    return enemy;
  }

  // ---------- portais ----------
  openTownPortal(x, z) {
    this.area.openTownPortal?.(x, z);
  }

  // Entrou no portal do pergaminho (dentro do Oblivion)
  takeTownPortal() {
    game.player.townPortalFloor = this.floor;
    this.goTo('village');
  }

  // Entrou no portal azul do vilarejo: volta para o andar onde o pergaminho foi usado
  useReturnPortal() {
    const floor = game.player.townPortalFloor;
    if (!floor) return;
    game.player.townPortalFloor = 0;
    this.goTo('dungeon', floor);
  }

  // ---------- loop ----------
  update(dt) {
    const area = this.area;
    if (!area) return;
    const player = game.player;

    area.update(dt, game.time);
    for (const e of this.enemies) e.update(dt, player);
    this.separateEntities();

    // Remove os inimigos mortos que já afundaram no chão
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removed) {
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }

    // Paredes/casas entre a câmera e o jogador ficam "transparentes"
    updateCutaway(game.cam.camera, player.position);

    // O "sol" segue o jogador para as sombras ficarem nítidas perto dele
    if (area.sun) {
      area.sun.position.copy(player.position).add(area.environment.sunOffset);
      area.sun.target.position.copy(player.position);
    }
  }

  // Empurra entidades sobrepostas (para os inimigos não ficarem um dentro do outro)
  separateEntities() {
    const list = this.enemies;
    const grid = this.grid;
    const player = game.player;
    const push = (a, b, weightA, weightB) => {
      const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const dist = Math.hypot(dx, dz);
      const minDist = a.radius + b.radius;
      if (dist >= minDist || dist < 0.0001) return;
      const overlap = minDist - dist;
      const nx = dx / dist, nz = dz / dist;
      if (weightA > 0) {
        const x = a.position.x - nx * overlap * weightA, z = a.position.z - nz * overlap * weightA;
        if (grid.isWalkableWorld(x, z)) { a.position.x = x; a.position.z = z; }
      }
      if (weightB > 0) {
        const x = b.position.x + nx * overlap * weightB, z = b.position.z + nz * overlap * weightB;
        if (grid.isWalkableWorld(x, z)) { b.position.x = x; b.position.z = z; }
      }
    };
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].alive) push(a, list[j], 0.5, 0.5);
      }
      if (player.alive && !player.dash) push(player, a, 0, 1); // o jogador não é empurrado
    }
  }

  // ---------- o que está debaixo do mouse ----------
  pick(mouseNdc) {
    const result = this._pick;
    result.enemy = null;
    result.interactable = null;
    result.point = null;
    if (!this.area) return result;

    this.raycaster.setFromCamera(mouseNdc, game.cam.camera);
    const list = this._hitList;
    list.length = 0;
    for (const e of this.enemies) if (e.alive) list.push(e.hitbox);
    for (const it of this.area.interactables) list.push(it.hitbox);

    const hits = this.raycaster.intersectObjects(list, false);
    if (hits.length) {
      const data = hits[0].object.userData;
      if (data.entity) result.enemy = data.entity;
      else if (data.interactable) result.interactable = data.interactable;
    }
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this._point)) result.point = this._point;
    return result;
  }
}
