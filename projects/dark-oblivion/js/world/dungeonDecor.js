// =============================================================
// dungeonDecor.js — enfeites do andar: tochas e correntes nas paredes,
// estandartes, ossos, entulho, velas e manchas no chão.
//
// Tudo é sorteado com o gerador da masmorra (mesma seed = mesmos enfeites)
// e só decora: nada aqui bloqueia a passagem.
//
// TOCHAS: cada uma tem chama e brilho próprios, mas luz de verdade
// (PointLight) é cara para a placa de vídeo. Então existe um "estoque" fixo
// de LIGHT_POOL luzes que vão para as tochas mais perto do jogador.
// =============================================================
import * as THREE from 'three';
import { CELL } from '../core/grid.js';
import { createModel } from '../core/assets.js';
import { getTexture } from '../core/textures.js';
import { applyCutaway } from './cutaway.js';
import { game } from '../game.js';

const LIGHT_POOL = 6;          // luzes de tocha acesas ao mesmo tempo
const LIGHT_REASSIGN = 0.25;   // a cada quantos segundos as luzes trocam de tocha
const TORCH_Y = 1.0;           // altura da chapa da tocha na parede
const CHAINS_Y = 1.4;
const BANNER_Y = 1.42;
const FLAME_POS = new THREE.Vector3(0, 0.36, 0.29); // ponta da tocha (no espaço da tocha)

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Enfeites de chão encostados nas paredes: chave em theme.decor (chance) → modelo
const FLOOR_PROPS = [
  ['bones', (rng) => (rng.chance(0.3) ? 'skull' : 'bonePile')],
  ['rubble', () => 'rubble'],
  ['candles', () => 'candles'],
  ['stalagmites', () => 'stalagmites'],
  ['mushrooms', () => 'mushrooms'],
];

// Geometrias/materiais compartilhados
const FLAME_OUTER = new THREE.ConeGeometry(0.055, 0.2, 7).translate(0, 0.1, 0);
const FLAME_INNER = new THREE.ConeGeometry(0.03, 0.12, 6).translate(0, 0.06, 0);
const STAIN_GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let shared = null;
function sharedMaterials() {
  shared ??= {
    flameOuter: new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    flameInner: new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  return shared;
}

// Chama animada (cone de fora laranja + miolo claro + brilho), usada nas tochas e nos braseiros.
// Devolve { group, update(t) }; o grupo pode ser escalado para chamas maiores.
export function createFlame(color, phase = Math.random() * 100) {
  const mats = sharedMaterials();
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.add(new THREE.Mesh(FLAME_OUTER, mats.flameOuter), new THREE.Mesh(FLAME_INNER, mats.flameInner));
  group.add(body);
  const glowMat = new THREE.SpriteMaterial({ map: getTexture('softCircle'), color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(0.9);
  glow.position.set(0, 0.1, 0);
  group.add(glow);
  return {
    group,
    update(t) {
      // chama "dançando": soma de senos com frequências diferentes
      const k = 1 + Math.sin(t * 11 + phase) * 0.1 + Math.sin(t * 27 + phase * 2) * 0.06;
      body.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
      glowMat.opacity = 0.35 + (k - 1) * 0.8;
    },
    dispose() { glowMat.dispose(); },
  };
}

export function decorateDungeon({ grid, layout, group, rng, theme, isReserved, isPillar, shape = null }) {
  const d = theme.decor;
  const disposables = [];
  const models = [];
  const torches = [];

  const inRoom = (cx, cz) => layout.rooms.some((r) => cx >= r.x && cx < r.x + r.w && cz >= r.z && cz < r.z + r.h);
  const isWallCell = (cx, cz) => grid.get(cx, cz) === CELL.WALL && !isPillar(cx, cz);

  // ---------- faces de parede viradas para o chão de uma sala ----------
  const faces = [];
  for (let cz = 0; cz < grid.height; cz++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (!isWallCell(cx, cz)) continue;
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (grid.get(nx, nz) !== CELL.FLOOR || isReserved(nx, nz) || !inRoom(nx, nz)) continue;
        let x = grid.centerX(cx) + dx * 0.5, z = grid.centerZ(cz) + dz * 0.5; // meio da face, no mundo
        if (shape) {
          // parede torta de caverna: média dos dois cantos da face na altura do meio
          const gA = dx !== 0 ? [cx + (dx > 0 ? 1 : 0), cz] : [cx, cz + (dz > 0 ? 1 : 0)];
          const gB = dx !== 0 ? [gA[0], cz + 1] : [cx + 1, gA[1]];
          const oA = shape.offset(gA[0], gA[1], 1), oB = shape.offset(gB[0], gB[1], 1);
          x += (oA[0] + oB[0]) / 2; z += (oA[1] + oB[1]) / 2;
        }
        faces.push({
          dx, dz, x, z,
          rotY: Math.atan2(dx, dz), // o enfeite "olha" para dentro da sala
        });
      }
    }
  }
  rng.shuffle(faces);

  const placed = []; // enfeites de parede já colocados: { x, z, kind }
  const farFrom = (f, kinds, minDist) => placed.every((p) => !kinds.includes(p.kind) || Math.hypot(p.x - f.x, p.z - f.z) >= minDist);

  const addWallModel = (id, f, y) => {
    const m = createModel(id);
    // um pouco para um lado ou outro ao longo da parede, para não ficar tudo centralizado
    const slide = rng.range(-0.2, 0.2);
    m.root.position.set(f.x + f.dz * slide, y, f.z - f.dx * slide);
    m.root.rotation.y = f.rotY;
    applyCutaway(m.root);
    group.add(m.root);
    models.push(m);
    return m;
  };

  // ---------- tochas ----------
  const torchTarget = Math.round(layout.rooms.length * d.torchesPerRoom);
  for (const f of faces) {
    if (torches.length >= torchTarget) break;
    if (!farFrom(f, ['torch'], d.torchSpacing)) continue;
    const m = addWallModel('wallTorch', f, TORCH_Y);
    m.root.updateMatrixWorld(true);
    const phase = rng.range(0, 100);
    const flame = createFlame(theme.torch.color, phase);
    flame.group.position.copy(FLAME_POS);
    flame.group.rotation.x = 0.22; // acompanha a inclinação do cabo
    m.root.add(flame.group);
    disposables.push(flame);
    // onde fica a luz: um pouco à frente da chama, para iluminar a parede e o chão
    const world = m.root.localToWorld(FLAME_POS.clone().add(new THREE.Vector3(0, 0, 0.25)));
    torches.push({ flame, light: world, phase });
    placed.push({ x: f.x, z: f.z, kind: 'torch' });
  }

  // ---------- correntes e estandartes ----------
  for (const f of faces) {
    if (!farFrom(f, ['torch'], 1.5) || !farFrom(f, ['chains', 'banner', 'support'], 3.5)) continue;
    const roll = rng.next();
    if (roll < d.chains) {
      addWallModel('wallChains', f, CHAINS_Y);
      placed.push({ x: f.x, z: f.z, kind: 'chains' });
    } else if (roll < d.chains + d.banners) {
      addWallModel('banner', f, BANNER_Y);
      placed.push({ x: f.x, z: f.z, kind: 'banner' });
    } else if (roll < d.chains + d.banners + (d.supports ?? 0)) {
      addWallModel('mineSupport', f, 0);
      placed.push({ x: f.x, z: f.z, kind: 'support' });
    }
  }

  // ---------- chão: ossos, entulho e velas encostados nas paredes; manchas em qualquer lugar ----------
  const stainMat = new THREE.MeshStandardMaterial({
    color: d.stainColor, alphaMap: getTexture('stain'), transparent: true, depthWrite: false, roughness: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  disposables.push(stainMat);
  for (let cz = 0; cz < grid.height; cz++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (grid.get(cx, cz) !== CELL.FLOOR || isReserved(cx, cz)) continue;
      const x = grid.centerX(cx), z = grid.centerZ(cz);
      if (rng.chance(d.stains)) {
        const stain = new THREE.Mesh(STAIN_GEOMETRY, stainMat);
        stain.position.set(x + rng.range(-0.3, 0.3), 0.01, z + rng.range(-0.3, 0.3));
        stain.rotation.y = rng.range(0, Math.PI * 2);
        stain.scale.setScalar(rng.range(0.8, 1.7));
        stain.receiveShadow = true;
        group.add(stain);
      }
      const wallDir = DIRS.find(([dx, dz]) => isWallCell(cx + dx, cz + dz));
      if (!wallDir) continue;
      const roll = rng.next();
      let id = null, acc = 0;
      for (const [key, pick] of FLOOR_PROPS) {
        acc += d[key] ?? 0;
        if (roll < acc) { id = pick(rng); break; }
      }
      if (!id) continue;
      const m = createModel(id);
      m.root.position.set(x + wallDir[0] * 0.22 + rng.range(-0.15, 0.15), 0, z + wallDir[1] * 0.22 + rng.range(-0.15, 0.15));
      m.root.rotation.y = rng.range(0, Math.PI * 2);
      group.add(m.root);
      models.push(m);
    }
  }

  // ---------- estoque de luzes das tochas ----------
  const lights = [];
  for (let i = 0; i < LIGHT_POOL; i++) {
    const light = new THREE.PointLight(theme.torch.color, 0, theme.torch.distance, 1.5);
    group.add(light);
    lights.push({ light, torch: null });
  }
  let reassignTimer = 0;
  const assignLights = () => {
    const p = game.player.position;
    const nearest = torches
      .map((t) => ({ t, dist: Math.hypot(t.light.x - p.x, t.light.z - p.z) }))
      .filter((e) => e.dist < 20)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, LIGHT_POOL);
    lights.forEach((slot, i) => {
      slot.torch = nearest[i]?.t ?? null;
      if (slot.torch) slot.light.position.copy(slot.torch.light);
      else slot.light.intensity = 0;
    });
  };

  // Enfeites pequenos não projetam sombra: são dezenas, e cada sombra é mais um desenho por quadro
  for (const m of models) m.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });

  return {
    torchCount: torches.length,
    update(dt, t) {
      reassignTimer -= dt;
      if (reassignTimer <= 0) { reassignTimer = LIGHT_REASSIGN; assignLights(); }
      for (const tc of torches) tc.flame.update(t);
      for (const slot of lights) {
        if (!slot.torch) continue;
        const ph = slot.torch.phase;
        slot.light.intensity = theme.torch.intensity * (0.85 + Math.sin(t * 9 + ph) * 0.08 + Math.sin(t * 23 + ph) * 0.06);
      }
    },
    dispose() {
      for (const m of models) m.dispose();
      for (const x of disposables) x.dispose();
    },
  };
}
