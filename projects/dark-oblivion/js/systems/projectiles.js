// =============================================================
// projectiles.js — todos os projéteis do jogo (magias, flechas,
// bolas de fogo dos cultistas).
//
// DESEMPENHO: em vez de um Mesh por projétil, usamos um InstancedMesh
// por "tipo de forma" (orb, shard, arrow). Um InstancedMesh desenha
// centenas de cópias da mesma geometria numa ÚNICA chamada à placa de
// vídeo; cada cópia tem sua própria posição/rotação/cor.
//
// Os dados de cada projétil são objetos simples, reaproveitados
// (lista `free`) para não gerar lixo de memória.
// =============================================================
import * as THREE from 'three';
import { dealDamage } from './combat.js';
import { applyEffect } from '../skills/statusEffects.js';
import { game } from '../game.js';

const MAX_PER_KIND = 256;

// Formas disponíveis. Para criar uma nova (ex.: 'skull'), adicione aqui.
const KINDS = {
  orb: () => new THREE.SphereGeometry(0.22, 12, 8),
  shard: () => new THREE.OctahedronGeometry(0.2).scale(0.6, 0.6, 1.8),
  arrow: () => new THREE.BoxGeometry(0.05, 0.05, 0.8),
};

export class ProjectileSystem {
  constructor(scene) {
    this.list = [];  // projéteis ativos
    this.free = [];  // objetos de dados livres para reaproveitar
    this.meshes = {};
    this._dummy = new THREE.Object3D(); // objeto auxiliar só para montar matrizes
    this._color = new THREE.Color();
    this._counts = {};

    for (const [kind, makeGeometry] of Object.entries(KINDS)) {
      // MeshBasicMaterial ignora luzes: o projétil "brilha" com a própria cor.
      // A cor real vem de cada instância (setColorAt), por isso o material é branco.
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.InstancedMesh(makeGeometry(), material, MAX_PER_KIND);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // vai mudar todo quadro
      mesh.setColorAt(0, this._color.set(0xffffff));        // cria o buffer de cores
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes[kind] = mesh;
      this._counts[kind] = 0;
    }
  }

  // Cria um projétil. Veja behaviors.js e enemy.js para exemplos de uso.
  spawn(o) {
    if (this.list.length >= MAX_PER_KIND * 2) return null;
    const p = this.free.pop() ?? { hitSet: new Set() };
    p.owner = o.owner;
    p.team = o.team;
    p.x = o.x; p.y = o.y ?? 1.1; p.z = o.z;
    p.dirX = o.dirX; p.dirZ = o.dirZ;
    p.speed = o.speed ?? 15;
    p.range = o.range ?? 12;
    p.radius = o.radius ?? 0.3;
    p.kind = KINDS[o.kind] ? o.kind : 'orb';
    p.color = o.color ?? 0xffffff;
    p.scale = o.scale ?? 1;
    p.pierce = !!o.pierce;
    p.damage = o.damage ?? 0;
    p.damageType = o.damageType ?? 'physical';
    p.onHit = o.onHit ?? null;
    p.level = o.level ?? 1;
    // Explosivo (Bola de Fogo, Flecha Explosiva): ao tocar em algo, explode em área
    p.explosionRadius = o.explosionRadius ?? 0;
    p.traveled = 0;
    p.hitSet.clear();
    this.list.push(p);
    return p;
  }

  update(dt) {
    const grid = game.world.grid;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const step = p.speed * dt;
      p.x += p.dirX * step;
      p.z += p.dirZ * step;
      p.traveled += step;

      let dead = p.traveled >= p.range;

      // Bateu numa parede?
      if (!dead && grid && grid.blocksProjectile(p.x, p.z)) {
        dead = true;
        if (!p.explosionRadius) game.vfx.burst({ x: p.x, y: 0, z: p.z }, p.color, 0.35, p.y);
      }

      // Acertou alguém do time oposto?
      if (!dead) {
        for (const t of this.targetsOf(p)) {
          if (!t.alive || p.hitSet.has(t)) continue;
          const dx = t.position.x - p.x, dz = t.position.z - p.z;
          const r = t.radius + p.radius;
          if (dx * dx + dz * dz <= r * r) {
            if (p.explosionRadius) { dead = true; break; } // a explosão acerta todos, inclusive ele
            this.hit(p, t);
            p.hitSet.add(t);
            if (!p.pierce) { dead = true; break; }
          }
        }
      }

      if (dead && p.explosionRadius) this.explode(p);

      if (dead) {
        // Remoção rápida: troca com o último e tira o último (não precisa "empurrar" a lista)
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        p.owner = null;
        this.free.push(p);
      }
    }
    this.render();
  }

  targetsOf(p) {
    return p.team === 'player' ? game.world.enemies : [game.player];
  }

  hit(p, target, showBurst = true) {
    const result = dealDamage(p.owner, target, { amount: p.damage, type: p.damageType });
    if (result && !result.blocked && p.onHit) {
      for (const spec of p.onHit) applyEffect(target, spec, p.level, p.owner, { hitDamage: result.damage });
    }
    if (showBurst) game.vfx.burst(target.position, p.color, 0.6, p.y);
  }

  // Dano em todos os alvos dentro do raio da explosão
  explode(p) {
    const pos = { x: p.x, y: 0, z: p.z };
    game.vfx.ring(pos, p.color, p.explosionRadius, 0.45);
    game.vfx.burst(pos, p.color, p.explosionRadius * 0.55, 0.6);
    for (const t of this.targetsOf(p)) {
      if (!t.alive) continue;
      const r = p.explosionRadius + t.radius;
      if ((t.position.x - p.x) ** 2 + (t.position.z - p.z) ** 2 <= r * r) this.hit(p, t, false);
    }
  }

  // Copia posição/rotação/cor de cada projétil para o InstancedMesh do seu tipo
  render() {
    const counts = this._counts;
    for (const kind in counts) counts[kind] = 0;
    const dummy = this._dummy;
    for (const p of this.list) {
      const mesh = this.meshes[p.kind];
      const i = counts[p.kind]++;
      if (i >= MAX_PER_KIND) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, Math.atan2(p.dirX, p.dirZ), 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, this._color.setHex(p.color));
    }
    for (const kind in this.meshes) {
      const mesh = this.meshes[kind];
      mesh.count = Math.min(counts[kind], MAX_PER_KIND);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    for (const p of this.list) { p.owner = null; this.free.push(p); }
    this.list.length = 0;
    this.render();
  }
}
