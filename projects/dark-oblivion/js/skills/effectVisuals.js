// =============================================================
// effectVisuals.js — desenhos que duram enquanto um efeito estiver ativo.
//
// Cada efeito pode ter `visual: { type, color, grow }`:
//   aura → anel pulsando no chão, em volta dos pés (Escudo de Espinhos, Berserker)
//   orb  → esfera brilhante girando em volta do personagem (Orbe Sombrio)
//   ice  → bloco de gelo translúcido envolvendo o alvo (congelamento)
//   grow → (opcional) aumenta o tamanho do personagem enquanto durar (1.15 = +15%)
//
// Os objetos são filhos de entity.root, então acompanham a entidade sozinhos.
// Chamado todo quadro por Entity.updateBase.
// =============================================================
import * as THREE from 'three';

const AURA_GEOMETRY = new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2);
const ORB_GEOMETRY = new THREE.SphereGeometry(0.17, 16, 12);
const ORB_HALO_GEOMETRY = new THREE.SphereGeometry(0.3, 16, 12);
const ICE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function glowMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Cria o objeto 3D de um visual. Devolve { object, materials, update(t) }
function build(visual, entity) {
  const color = visual.color ?? 0xffffff;
  switch (visual.type) {
    case 'aura': {
      const material = glowMaterial(color, 0.6);
      const ring = new THREE.Mesh(AURA_GEOMETRY, material);
      ring.position.y = 0.05;
      const size = entity.radius * 2.4 + 0.4;
      return {
        object: ring, materials: [material],
        update(t) {
          const pulse = 1 + Math.sin(t * 5) * 0.06;
          ring.scale.set(size * pulse, 1, size * pulse);
          ring.rotation.y = t * 0.8;
          material.opacity = 0.45 + Math.sin(t * 5) * 0.15;
        },
      };
    }
    case 'orb': {
      const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const haloMaterial = glowMaterial(color, 0.7);
      const group = new THREE.Group();
      const core = new THREE.Mesh(ORB_GEOMETRY, coreMaterial);
      core.scale.setScalar(0.6);
      group.add(core, new THREE.Mesh(ORB_HALO_GEOMETRY, haloMaterial));
      const light = new THREE.PointLight(color, 4, 4, 1.5);
      group.add(light);
      const r = entity.radius + 0.55;
      return {
        object: group, materials: [coreMaterial, haloMaterial],
        update(t) {
          // gira em volta do personagem, subindo e descendo devagar
          group.position.set(Math.cos(t * 2.2) * r, entity.height * 0.75 + Math.sin(t * 3) * 0.15, Math.sin(t * 2.2) * r);
          haloMaterial.opacity = 0.55 + Math.sin(t * 7) * 0.2;
        },
      };
    }
    case 'ice': {
      const material = new THREE.MeshStandardMaterial({
        color: 0xbfe8ff, emissive: 0x3a8ad0, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1, depthWrite: false,
      });
      const block = new THREE.Mesh(ICE_GEOMETRY, material);
      block.scale.set(entity.radius * 2.3, entity.height * 1.05, entity.radius * 2.3);
      block.rotation.y = Math.random() * Math.PI;
      return { object: block, materials: [material], update() {} };
    }
    default:
      return null;
  }
}

function removeVisual(entity, id) {
  const v = entity._effectVisuals.get(id);
  v.object.removeFromParent();
  for (const m of v.materials) m.dispose();
  if (v.grow) entity.model.body.scale.setScalar(1);
  entity._effectVisuals.delete(id);
}

export function updateEffectVisuals(entity, t) {
  const visuals = (entity._effectVisuals ??= new Map());

  // Cria os que faltam e anima os existentes
  let grow = 1;
  for (const e of entity.effects) {
    if (!e.visual) continue;
    let v = visuals.get(e.id);
    if (!v) {
      v = build(e.visual, entity);
      if (!v) continue;
      v.grow = e.visual.grow ?? null;
      entity.root.add(v.object);
      visuals.set(e.id, v);
    }
    v.update(t);
    if (v.grow) grow = Math.max(grow, v.grow);
  }
  if (grow !== 1 || entity.model.body.scale.x !== 1) entity.model.body.scale.setScalar(grow);

  // Remove os de efeitos que acabaram
  if (visuals.size) {
    for (const id of [...visuals.keys()]) {
      if (!entity.effects.some((e) => e.id === id && e.visual)) removeVisual(entity, id);
    }
  }
}

export function clearEffectVisuals(entity) {
  if (!entity._effectVisuals) return;
  for (const id of [...entity._effectVisuals.keys()]) removeVisual(entity, id);
}
