// =============================================================
// entity.js — base comum de tudo que "vive": jogador e inimigos.
//
// Cada entidade tem:
//   model    → o modelo 3D (placeholder ou .glb), criado por core/assets.js
//   position → atalho para model.root.position (é o MESMO objeto)
//   hp, stats, effects (lento, atordoado...), path (caminho do A*)
//   hitbox   → cilindro invisível usado para clicar na entidade
//   healthBar→ barrinha de vida 3D sobre a cabeça (só inimigos)
// =============================================================
import * as THREE from 'three';
import { createModel } from '../core/assets.js';
import { MODELS } from '../data/models.js';
import { INVISIBLE_MATERIAL, getBasicMaterial } from '../core/materials.js';
import { updateEffects, isSlowed } from '../skills/statusEffects.js';
import { updateEffectVisuals, clearEffectVisuals } from '../skills/effectVisuals.js';
import { game } from '../game.js';

// Geometrias compartilhadas por todas as entidades
const HITBOX_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
const BAR_WIDTH = 1.0, BAR_HEIGHT = 0.11;
const BAR_BG_GEOMETRY = new THREE.PlaneGeometry(BAR_WIDTH + 0.06, BAR_HEIGHT + 0.06);
// .translate move a geometria para que ela "cresça" a partir da esquerda ao mudar scale.x
const BAR_FILL_GEOMETRY = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT).translate(BAR_WIDTH / 2, 0, 0);

let barMats = null;
function barMaterials() {
  // depthTest: false → a barra é desenhada por cima de tudo (não some atrás de paredes)
  barMats ??= {
    bg: getBasicMaterial(0x000000, { depthTest: false, transparent: true, opacity: 0.75 }),
    hp: getBasicMaterial(0xc81e1e, { depthTest: false }),
    slowed: getBasicMaterial(0x3aa0ff, { depthTest: false }),
  };
  return barMats;
}

// Gira um ângulo "current" em direção a "target" sem passar de maxStep
function turnTowards(current, target, maxStep) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current)); // diferença entre -π e π
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export class Entity {
  constructor(modelId, team) {
    this.model = createModel(modelId);
    this.root = this.model.root;
    this.position = this.root.position;
    const def = MODELS[modelId];
    this.radius = def.radius ?? 0.4;
    this.height = def.height ?? 1.8;

    this.team = team;            // 'player' ou 'enemy'
    this.alive = true;
    this.invulnerable = false;
    this.level = 1;
    this.hp = 1;
    this.stats = { maxHp: 1, armor: 0, resist: {} };
    this.effects = [];
    this.path = null;
    this.pathIndex = 0;

    this.hitbox = new THREE.Mesh(HITBOX_GEOMETRY, INVISIBLE_MATERIAL);
    this.hitbox.scale.set(this.radius * 1.5, this.height, this.radius * 1.5);
    this.hitbox.userData.entity = this; // assim, ao clicar na hitbox, sabemos de quem ela é
    this.root.add(this.hitbox);

    this.healthBar = null;
    this.alwaysShowBar = false;
  }

  addToScene(scene) {
    scene.add(this.root);
    if (this.healthBar) scene.add(this.healthBar.group);
  }

  createHealthBar() {
    const m = barMaterials();
    const group = new THREE.Group();
    const bg = new THREE.Mesh(BAR_BG_GEOMETRY, m.bg);
    const fill = new THREE.Mesh(BAR_FILL_GEOMETRY, m.hp);
    fill.position.set(-BAR_WIDTH / 2, 0, 0.001);
    bg.renderOrder = 998;
    fill.renderOrder = 999;
    group.add(bg, fill);
    group.visible = false;
    this.healthBar = { group, fill };
  }

  updateHealthBar() {
    const bar = this.healthBar;
    if (!bar) return;
    const show = this.alive && (this.hp < this.stats.maxHp || this.alwaysShowBar);
    bar.group.visible = show;
    if (!show) return;
    bar.group.position.set(this.position.x, this.position.y + this.height + 0.35, this.position.z);
    bar.group.quaternion.copy(game.cam.camera.quaternion); // sempre de frente para a câmera
    bar.fill.scale.x = Math.max(0.001, this.hp / this.stats.maxHp);
    bar.fill.material = isSlowed(this) ? barMaterials().slowed : barMaterials().hp;
  }

  // ---------- utilidades de posição ----------
  distanceTo(other) {
    return Math.hypot(other.position.x - this.position.x, other.position.z - this.position.z);
  }

  distanceToPoint(x, z) {
    return Math.hypot(x - this.position.x, z - this.position.z);
  }

  // Vira instantaneamente para o ponto (x, z). O modelo olha para +Z, por isso atan2(dx, dz).
  faceTowards(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    if (dx * dx + dz * dz < 0.0001) return;
    this.root.rotation.y = Math.atan2(dx, dz);
  }

  // ---------- movimento ----------
  setPath(points) {
    this.path = points && points.length ? points : null;
    this.pathIndex = 0;
  }

  // Anda ao longo do caminho. Devolve true se andou neste quadro.
  followPath(dt, speed) {
    if (!this.path) return false;
    let remaining = speed * dt;
    while (remaining > 0 && this.path) {
      const target = this.path[this.pathIndex];
      const dx = target.x - this.position.x, dz = target.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.001) this.root.rotation.y = turnTowards(this.root.rotation.y, Math.atan2(dx, dz), dt * 14);
      if (dist <= remaining) {
        this.position.x = target.x;
        this.position.z = target.z;
        remaining -= dist;
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) this.path = null;
      } else {
        this.position.x += (dx / dist) * remaining;
        this.position.z += (dz / dist) * remaining;
        remaining = 0;
      }
    }
    return true;
  }

  // Escolhe a animação de andar/parado (sem cortar um ataque no meio)
  animate(moving) {
    if (!this.alive || this.model.isBusy()) return;
    this.model.play(moving ? 'walk' : 'idle');
  }

  // ---------- vida ----------
  takeDamage(amount, type, source) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.onDamaged?.(amount, type, source);
    if (this.hp <= 0) this.die(source);
  }

  heal(amount) {
    if (!this.alive) return;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
  }

  die(killer) {
    this.alive = false;
    this.path = null;
    this.model.play('death', { once: true });
    this.onDeath?.(killer);
  }

  // Chamado no fim do update de cada entidade
  updateBase(dt) {
    updateEffects(this, dt);
    updateEffectVisuals(this, game.time); // aura, orbe, bloco de gelo...
    this.model.update(dt);
    this.updateHealthBar();
  }

  dispose() {
    clearEffectVisuals(this);
    this.model.dispose();
    this.healthBar?.group.removeFromParent();
  }
}
