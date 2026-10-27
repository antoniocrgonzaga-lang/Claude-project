// =============================================================
// vfx.js — efeitos visuais simples e reaproveitados (pool):
//   ring    → anel que se expande no chão (Redemoinho, marca de clique)
//   burst   → esfera brilhante que cresce e some (impacto)
//   pillar  → coluna de luz (subir de nível, Grito de Guerra)
//   segment → pedaço de "raio" entre dois pontos (Faísca, Drenar Vida)
//   disc    → círculo no chão que cresce: AVISO de ataque em área (chefe, Chuva de Meteoros)
//   meteor  → bola que cai do céu até o chão (Chuva de Meteoros)
//   streak  → risco fino que cai do céu (Chuva de Flechas)
//
// Cada mesh do pool tem seu PRÓPRIO material (criado uma única vez),
// porque precisamos mudar cor e transparência de cada efeito.
// Nenhum material é criado durante o jogo, só quando o pool cresce.
// =============================================================
import * as THREE from 'three';
import { Pool } from '../core/pool.js';

const RING_GEOMETRY = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
const BURST_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);
const PILLAR_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const SEGMENT_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const DISC_GEOMETRY = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);

function makeGlowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // soma a cor com o fundo = efeito de brilho
    side: THREE.DoubleSide,
  });
}

export class VfxSystem {
  constructor(scene) {
    this.active = [];
    const factory = (geometry) => () => {
      const mesh = new THREE.Mesh(geometry, makeGlowMaterial());
      mesh.visible = false;
      mesh.renderOrder = 10;
      scene.add(mesh);
      return mesh;
    };
    this.pools = {
      ring: new Pool(factory(RING_GEOMETRY)),
      burst: new Pool(factory(BURST_GEOMETRY)),
      pillar: new Pool(factory(PILLAR_GEOMETRY)),
      segment: new Pool(factory(SEGMENT_GEOMETRY)),
      disc: new Pool(factory(DISC_GEOMETRY)),
      meteor: new Pool(factory(BURST_GEOMETRY)),
      streak: new Pool(factory(SEGMENT_GEOMETRY)),
    };
  }

  spawn(type, { x, y = 0, z, color = 0xffffff, size = 1, duration = 0.4, follow = null }) {
    const mesh = this.pools[type].acquire();
    mesh.material.color.setHex(color);
    mesh.material.opacity = 1;
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(0.01);
    mesh.visible = true;
    const fx = { type, mesh, t: 0, duration, size, follow };
    this.active.push(fx);
    return fx;
  }

  // ---------- atalhos ----------
  ring(pos, color, radius, duration = 0.4) {
    this.spawn('ring', { x: pos.x, y: 0.06, z: pos.z, color, size: radius, duration });
  }

  burst(pos, color, size = 0.5, height = 1) {
    this.spawn('burst', { x: pos.x, y: (pos.y ?? 0) + height, z: pos.z, color, size, duration: 0.25 });
  }

  pillar(entity, color = 0xffd27a) {
    this.spawn('pillar', { x: entity.position.x, y: 0, z: entity.position.z, color, duration: 1.2, follow: entity });
  }

  // Círculo de aviso no chão que cresce durante `duration` segundos
  telegraph(pos, color, radius, duration) {
    this.spawn('disc', { x: pos.x, y: 0.05, z: pos.z, color, size: radius, duration });
  }

  // Algo caindo do alto até o ponto (x, z) do chão em `duration` segundos.
  // shape: 'meteor' (bola) ou 'streak' (risco fino, como uma flecha)
  drop(pos, color, { shape = 'meteor', size = 0.4, duration = 0.45, height = 9 } = {}) {
    const fx = this.spawn(shape, { x: pos.x, y: height, z: pos.z, color, size, duration });
    fx.fromY = height;
    if (shape === 'streak') {
      fx.mesh.rotation.x = Math.PI / 2; // deita a caixa: o lado comprido aponta para baixo
      fx.mesh.scale.set(0.06, 0.06, size);
    } else {
      fx.mesh.scale.setScalar(size);
    }
  }

  // Raio em zigue-zague de `from` até `to` (pontos {x, y, z})
  beam(from, to, color, { duration = 0.18, width = 0.08, jagged = 0.35, segments = 6 } = {}) {
    let prev = from;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const point = i === segments ? to : {
        x: from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jagged,
        y: from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jagged * 0.6,
        z: from.z + (to.z - from.z) * t + (Math.random() - 0.5) * jagged,
      };
      this.segment(prev, point, color, width, duration);
      prev = point;
    }
  }

  // Uma "barra" brilhante esticada entre a e b
  segment(a, b, color, width, duration) {
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (length < 0.01) return;
    const fx = this.spawn('segment', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, color, duration });
    fx.mesh.lookAt(b.x, b.y, b.z); // aponta o eixo Z da barra para o ponto b
    fx.mesh.scale.set(width, width, length);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i];
      fx.t += dt;
      const p = Math.min(fx.t / fx.duration, 1); // progresso de 0 a 1
      const m = fx.mesh;
      if (fx.follow) m.position.set(fx.follow.position.x, 0, fx.follow.position.z);

      switch (fx.type) {
        case 'ring': {
          const s = fx.size * (0.25 + 0.75 * (1 - (1 - p) * (1 - p))); // cresce rápido e desacelera
          m.scale.set(s, 1, s);
          m.material.opacity = 1 - p;
          break;
        }
        case 'burst':
          m.scale.setScalar(fx.size * (0.4 + 0.6 * p));
          m.material.opacity = (1 - p) * 0.9;
          break;
        case 'pillar':
          m.scale.set(0.8, 4 * Math.min(1, p * 3), 0.8);
          m.material.opacity = (1 - p) * 0.6;
          break;
        case 'segment':
          m.material.opacity = 1 - p;
          break;
        case 'disc': {
          const s = fx.size * Math.min(1, 0.15 + p);
          m.scale.set(s, 1, s);
          m.material.opacity = 0.15 + 0.35 * p + Math.sin(fx.t * 25) * 0.05; // pisca cada vez mais forte
          break;
        }
        case 'meteor':
        case 'streak':
          m.position.y = fx.fromY * (1 - p * p) + 0.2; // acelera ao cair
          break;
      }

      if (p >= 1) {
        m.visible = false;
        this.pools[fx.type].release(m);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }
  }

  clear() {
    for (const fx of this.active) {
      fx.mesh.visible = false;
      this.pools[fx.type].release(fx.mesh);
    }
    this.active.length = 0;
  }
}
