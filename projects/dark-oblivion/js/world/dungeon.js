// =============================================================
// dungeon.js — os andares do Oblivion, gerados proceduralmente.
//
// GERAÇÃO (generateDungeonLayout) — usa só o gerador com seed, então a
// mesma seed + o mesmo andar = exatamente o mesmo mapa:
//   1. enche o grid de parede
//   2. sorteia salas retangulares que não se encostam
//   3. liga as salas com corredores em "L" (cada sala nova se liga à
//      mais próxima já conectada = tudo fica alcançável), mais 2 extras
//   4. calcula a distância (BFS) a partir da sala inicial; a escada
//      fica na sala mais distante
//   5. coloca lava e pilares, desfazendo se isso bloquear algum caminho
//   6. sorteia os inimigos de cada sala
//
// CONSTRUÇÃO (buildDungeon) — transforma o grid em 3D:
//   - chão e paredes viram uma malha cada, com texturas de pedra que seguem
//     o mundo e sombra no pé das paredes (world/dungeonGeometry.js);
//   - o visual (cores, névoa, luzes, enfeites) vem do TEMA da faixa de
//     andares (data/dungeonThemes.js): muda a cada 5 andares;
//   - tochas, correntes, ossos... ficam em world/dungeonDecor.js.
// =============================================================
import * as THREE from 'three';
import { NavGrid, CELL } from '../core/grid.js';
import { createRng } from '../core/rng.js';
import { createModel } from '../core/assets.js';
import { getTexture, getNormalMap } from '../core/textures.js';
import { themeForFloor } from '../data/dungeonThemes.js';
import { buildFloorGeometry, buildWallGeometry, makeCaveShape } from './dungeonGeometry.js';
import { decorateDungeon, createFlame } from './dungeonDecor.js';
import { spawnWeightsForFloor, bossForFloor } from '../data/enemies.js';
import { CONFIG } from '../config.js';
import { createPortal, createTorch, createWaypoint, makeInteractable, removeInteractable, renameInteractable } from './props.js';
import { makeSun } from './village.js';
import { getCutawayMaterial, applyCutaway } from './cutaway.js';
import { game } from '../game.js';

const WALL_HEIGHT = 1.5;
const MAX_BRAZIERS = 4;
const MAX_LAVA_LIGHTS = 2;

// Materiais de cada tema (criados uma vez e reaproveitados em todos os andares do tema)
const themeMaterials = new Map();
function materialsFor(theme) {
  let m = themeMaterials.get(theme.id);
  if (m) return m;
  const stone = (texture, color, roughness) => new THREE.MeshStandardMaterial({
    map: getTexture(texture), normalMap: getNormalMap(texture), color, roughness, metalness: 0,
    vertexColors: true, // sombra no pé das paredes e nos cantos (cor por vértice)
  });
  const tex = { floor: 'dungeonFloor', wall: 'dungeonWall', ...theme.textures };
  m = {
    floor: stone(tex.floor, theme.floorTint, 0.92),
    wallSide: getCutawayMaterial(stone(tex.wall, theme.wallTint, 0.9)), // paredes na frente do jogador ficam "transparentes"
    wallTop: getCutawayMaterial(stone(tex.wall, theme.wallTopTint, 1)),
    // Poças (lava): a mesma textura colore e brilha; ela "escorre" (offset) e pulsa (emissiveIntensity).
    // pool.texture: 'lava' (colorida) ou 'poolGray' (cinza, pintada por pool.tint/glow: fogo azul, veneno...).
    // Cada tema tem a sua cópia da textura, porque o "escorrer" muda o offset dela.
    lava: (() => {
      const tex = getTexture(theme.pool.texture ?? 'lava').clone();
      return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, color: theme.pool.tint, emissive: theme.pool.glow, emissiveIntensity: 1.4, roughness: 0.6 });
    })(),
  };
  themeMaterials.set(theme.id, m);
  return m;
}

// ======================= GERAÇÃO =======================

// Busca em largura: distância (em passos) de cada célula até (sx, sz)
function bfs(grid, sx, sz) {
  const W = grid.width;
  const dist = new Int32Array(W * grid.height).fill(-1);
  const queue = [sz * W + sx];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % W, z = (i / W) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!grid.isWalkable(nx, nz)) continue;
      const ni = nz * W + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[i] + 1;
      queue.push(ni);
    }
  }
  return { dist, reachable: queue.length };
}

function countWalkable(grid) {
  let n = 0;
  for (const v of grid.cells) if (v === CELL.FLOOR) n++;
  return n;
}

// Corredor de 2 de largura em formato de L entre os centros de duas salas
function carveCorridor(grid, a, b, rng) {
  const carveH = (x0, x1, z) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++) { grid.set(x, z, CELL.FLOOR); grid.set(x, z + 1, CELL.FLOOR); }
  };
  const carveV = (z0, z1, x) => {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1) + 1; z++) { grid.set(x, z, CELL.FLOOR); grid.set(x + 1, z, CELL.FLOOR); }
  };
  if (rng.chance(0.5)) { carveH(a.cx, b.cx, a.cz); carveV(a.cz, b.cz, b.cx); }
  else { carveV(a.cz, b.cz, a.cx); carveH(a.cx, b.cx, b.cz); }
}

// ---------- estilo CAVERNA (tema com layout: 'caves') ----------
// Câmara de caverna: elipse com a borda irregular dentro do retângulo da sala.
// O miolo (5 x 5) fica sempre aberto: é onde ficam a escada, o waypoint e a chegada.
function carveBlob(grid, r, rng) {
  const rx = r.w / 2, rz = r.h / 2, cx = r.x + rx, cz = r.z + rz;
  for (let z = r.z; z < r.z + r.h; z++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dz * dz < 1 + rng.range(-0.35, 0.25)) grid.set(x, z, CELL.FLOOR);
    }
  }
  grid.fillRect(r.cx - 2, r.cz - 2, 5, 5, CELL.FLOOR);
}

// Túnel serpenteando de uma câmara a outra: a maior parte dos passos vai em direção ao
// destino, o resto vai para os lados. Largura de 2 (às vezes 3) células.
function carveTunnel(grid, a, b, rng) {
  const max = grid.width - 4;
  let x = a.cx, z = a.cz;
  for (let guard = 0; guard < 3000 && (Math.abs(x - b.cx) > 1 || Math.abs(z - b.cz) > 1); guard++) {
    const brush = rng.chance(0.25) ? 3 : 2;
    grid.fillRect(x, z, brush, brush, CELL.FLOOR);
    const dx = Math.sign(b.cx - x), dz = Math.sign(b.cz - z);
    if (rng.chance(0.68)) {
      if (dx && (!dz || rng.chance(0.5))) x += dx; else z += dz;
    } else {
      const [sx, sz] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      x += sx; z += sz;
    }
    x = Math.max(2, Math.min(max, x)); z = Math.max(2, Math.min(max, z));
  }
  grid.fillRect(b.cx - 1, b.cz - 1, 3, 3, CELL.FLOOR);
}

// Beco sem saída: um túnel curto que sai de uma câmara e vai para lugar nenhum (labirinto)
function carveDeadEnd(grid, from, rng) {
  const max = grid.width - 4;
  let x = from.cx, z = from.cz;
  let [sx, sz] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
  for (let i = rng.int(10, 22); i > 0; i--) {
    grid.fillRect(x, z, 2, 2, CELL.FLOOR);
    if (rng.chance(0.25)) [sx, sz] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    x = Math.max(2, Math.min(max, x + sx)); z = Math.max(2, Math.min(max, z + sz));
  }
}

// Arredonda a caverna: parede com 5+ vizinhos abertos vira chão (nunca o contrário,
// assim nada que estava ligado fica isolado)
function smoothCaves(grid) {
  const open = [];
  for (let z = 1; z < grid.height - 1; z++) {
    for (let x = 1; x < grid.width - 1; x++) {
      if (grid.get(x, z) !== CELL.WALL) continue;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && grid.get(x + dx, z + dz) === CELL.FLOOR) n++;
      if (n >= 5) open.push([x, z]);
    }
  }
  for (const [x, z] of open) grid.set(x, z, CELL.FLOOR);
}

export function generateDungeonLayout(seed, floor) {
  const rng = createRng(seed);
  const caves = themeForFloor(floor).layout === 'caves'; // câmaras irregulares e túneis em vez de salas e corredores
  const size = Math.min(80, 50 + floor * 3);
  const grid = new NavGrid(size, size, -size / 2, -size / 2);
  grid.fill(CELL.WALL);

  // 1-2) Salas
  const rooms = [];
  const targetRooms = Math.min(6 + floor, 14);
  for (let tries = 0; tries < 400 && rooms.length < targetRooms; tries++) {
    const w = rng.int(6, 11), h = rng.int(6, 11);
    const x = rng.int(2, size - w - 3), z = rng.int(2, size - h - 3);
    const overlaps = rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && z < r.z + r.h + 2 && z + h + 2 > r.z);
    if (overlaps) continue;
    rooms.push({ x, z, w, h, cx: x + Math.floor(w / 2), cz: z + Math.floor(h / 2) });
  }
  for (const r of rooms) {
    if (caves) carveBlob(grid, r, rng); else grid.fillRect(r.x, r.z, r.w, r.h, CELL.FLOOR);
  }

  // 3) Corredores: "árvore" ligando cada sala nova à sala conectada mais próxima
  const connected = [rooms[0]];
  const remaining = rooms.slice(1);
  while (remaining.length) {
    let best = null;
    for (const a of connected) {
      for (const b of remaining) {
        const d = Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (caves) carveTunnel(grid, best.a, best.b, rng); else carveCorridor(grid, best.a, best.b, rng);
    connected.push(best.b);
    remaining.splice(remaining.indexOf(best.b), 1);
  }
  for (let i = 0; i < (caves ? 4 : 2) && rooms.length > 3; i++) { // alguns caminhos extras (loops)
    const a = rng.pick(rooms), b = rng.pick(rooms);
    if (a !== b) { if (caves) carveTunnel(grid, a, b, rng); else carveCorridor(grid, a, b, rng); }
  }
  if (caves) {
    for (let i = 0; i < 3 + Math.floor(floor / 4); i++) carveDeadEnd(grid, rng.pick(rooms), rng);
    smoothCaves(grid);
  }

  // 4) Sala inicial e sala da escada (a mais distante)
  const start = rooms[0];
  const { dist } = bfs(grid, start.cx, start.cz);
  let stairsRoom = rooms[rooms.length - 1];
  let bestDist = -1;
  for (const r of rooms) {
    if (r === start) continue;
    const d = dist[r.cz * grid.width + r.cx];
    if (d > bestDist) { bestDist = d; stairsRoom = r; }
  }

  // 5) Lava e pilares, com verificação de que tudo continua conectado
  let walkable = countWalkable(grid);
  const tryModify = (cells, value) => {
    const backup = cells.map(([cx, cz]) => grid.get(cx, cz));
    const removed = backup.filter((v) => v === CELL.FLOOR).length;
    for (const [cx, cz] of cells) grid.set(cx, cz, value);
    if (bfs(grid, start.cx, start.cz).reachable === walkable - removed) {
      walkable -= removed;
      return true;
    }
    cells.forEach(([cx, cz], i) => grid.set(cx, cz, backup[i])); // desfaz
    return false;
  };

  // Vão da escadaria: buraco de 2 x 3 células no centro da sala mais distante.
  // Fica como CELL.LOW: não dá para andar por cima (é um buraco), mas projéteis passam.
  // Os degraus descem no sentido -Z (veja o modelo 'stairs' em data/models.js).
  const sc = stairsRoom.cx, sz = stairsRoom.cz;
  const stairwellCells = [];
  for (let z = sz - 1; z <= sz + 1; z++) for (let x = sc - 1; x <= sc; x++) stairwellCells.push([x, z]);
  if (!tryModify(stairwellCells, CELL.LOW)) stairwellCells.length = 0; // (não deveria acontecer: salas têm 6+ de lado)
  const stairwell = { cells: stairwellCells, x: grid.originX + sc, z: grid.centerZ(sz) }; // centro do vão no mundo

  const lavaPools = [];
  const braziers = [];
  for (const room of rooms) {
    if (room === start || room === stairsRoom) continue;
    if (room.w >= 8 && room.h >= 8 && rng.chance(0.45)) {
      const lw = rng.int(2, room.w - 5), lh = rng.int(2, room.h - 5);
      const lx = rng.int(room.x + 2, room.x + room.w - 2 - lw), lz = rng.int(room.z + 2, room.z + room.h - 2 - lh);
      const cells = [];
      // (só células de chão: na caverna a borda da câmara é irregular)
      for (let z = lz; z < lz + lh; z++) for (let x = lx; x < lx + lw; x++) if (grid.get(x, z) === CELL.FLOOR) cells.push([x, z]);
      if (cells.length && tryModify(cells, CELL.LOW)) lavaPools.push({ x: lx, z: lz, w: lw, h: lh });
    } else if (rng.chance(0.5)) {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        tryModify([[rng.int(room.x + 2, room.x + room.w - 3), rng.int(room.z + 2, room.z + room.h - 3)]], CELL.WALL);
      }
    }
  }
  // Braseiros no canto de algumas salas (bloqueiam a célula)
  for (const room of rng.shuffle([...rooms])) {
    if (braziers.length >= MAX_BRAZIERS) break;
    let corner = [room.x + 1, room.z + 1];
    if (caves) { // na caverna o canto do retângulo costuma ser rocha: pega o chão mais perto dele
      const c = grid.nearestWalkable(room.x + 2, room.z + 2, 3);
      if (!c || (Math.abs(c.cx - room.cx) <= 2 && Math.abs(c.cz - room.cz) <= 2)) continue; // longe do miolo da câmara
      corner = [c.cx, c.cz];
    }
    if (grid.isWalkable(corner[0], corner[1]) && tryModify([corner], CELL.WALL)) braziers.push(corner);
  }

  // 6) Inimigos
  const weights = spawnWeightsForFloor(floor);
  const spawns = [];
  for (const room of rooms) {
    if (room === start) continue;
    const n = Math.min(7, rng.int(2, 4) + Math.floor((floor - 1) / 2));
    for (let i = 0; i < n; i++) {
      const cell = grid.randomWalkableInRect(rng, room.x, room.z, room.w, room.h);
      if (!cell) continue;
      if (room === stairsRoom && Math.abs(cell.cx - room.cx) < 2 && Math.abs(cell.cz - room.cz) < 2) continue;
      spawns.push({ type: rng.weighted(weights).type, x: grid.centerX(cell.cx), z: grid.centerZ(cell.cz) });
    }
  }

  // 7) Andar de chefe: a sala da escadaria fica só para o chefe
  const isBossFloor = floor % CONFIG.world.bossEvery === 0 || floor >= CONFIG.world.maxFloor; // o último andar sempre tem chefe
  if (isBossFloor) {
    const inStairsRoom = (s) => {
      const cx = grid.toCellX(s.x), cz = grid.toCellZ(s.z);
      return cx >= stairsRoom.x && cx < stairsRoom.x + stairsRoom.w && cz >= stairsRoom.z && cz < stairsRoom.z + stairsRoom.h;
    };
    for (let i = spawns.length - 1; i >= 0; i--) if (inStairsRoom(spawns[i])) spawns.splice(i, 1);
    const cell = grid.nearestWalkable(stairsRoom.cx, stairsRoom.cz - 2, 4) ?? { cx: stairsRoom.cx, cz: stairsRoom.cz };
    spawns.push({ type: bossForFloor(floor), x: grid.centerX(cell.cx), z: grid.centerZ(cell.cz), boss: true });
  }

  return { seed, floor, grid, rooms, start, stairsRoom, stairwell, lavaPools, braziers, spawns, isBossFloor };
}

// ======================= CONSTRUÇÃO 3D =======================

export function buildDungeon(floor, seed) {
  const layout = generateDungeonLayout(seed, floor);
  const { grid } = layout;
  const group = new THREE.Group();
  const disposables = [];
  const updaters = [];
  const interactables = [];
  const rng = createRng(seed ^ 0x5bd1e995); // variação visual (não afeta o mapa)
  const theme = themeForFloor(floor);
  const pillars = [];

  const brazierSet = new Set(layout.braziers.map(([x, z]) => z * grid.width + x));
  const stairwellSet = new Set(layout.stairwell.cells.map(([x, z]) => z * grid.width + x));
  const isOpen = (x, z) => { const v = grid.get(x, z); return v === CELL.FLOOR || v === CELL.LOW; };
  const hasOpenNeighbor = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && isOpen(x + dx, z + dz)) return true;
    return false;
  };

  // Separa as células por tipo (só desenhamos paredes que encostam em chão)
  const floorCells = [], wallCells = [], lavaCells = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const v = grid.get(x, z);
      if (v === CELL.FLOOR) floorCells.push([x, z]);
      else if (stairwellSet.has(z * grid.width + x)) continue; // vão da escadaria: sem chão (os degraus descem ali)
      else if (v === CELL.LOW) lavaCells.push([x, z]);
      else if (brazierSet.has(z * grid.width + x)) floorCells.push([x, z]); // braseiro fica em cima do chão
      else if (hasOpenNeighbor(x, z)) wallCells.push([x, z]);
    }
  }

  // Pilares soltos (parede cercada de chão nos 4 lados) viram colunas de pedra
  const isPillar = (x, z) => grid.get(x, z) === CELL.WALL && !brazierSet.has(z * grid.width + x) &&
    [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => isOpen(x + dx, z + dz));
  const pillarCells = wallCells.filter(([x, z]) => isPillar(x, z));
  const solidWallCells = wallCells.filter(([x, z]) => !isPillar(x, z));

  // Chão, paredes e lava
  const mats = materialsFor(theme);
  const isWallCell = (x, z) => grid.get(x, z) === CELL.WALL && !brazierSet.has(z * grid.width + x) && !isPillar(x, z);
  // Tema de caverna: paredes de rocha tortas (o chão encostado nelas acompanha)
  const shape = theme.cave ? makeCaveShape(seed, theme.cave, isWallCell, theme.cave.baseHeight) : null;
  const floorGeometry = buildFloorGeometry(grid, floorCells, {
    isWall: isWallCell, isDrop: (x, z) => grid.get(x, z) === CELL.LOW, cornerShade: theme.floorCornerShade, rng, shape,
  });
  const floorMesh = new THREE.Mesh(floorGeometry, mats.floor);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  const wallGeometry = buildWallGeometry(grid, solidWallCells, { isOpen, height: WALL_HEIGHT, baseShade: theme.wallBaseShade, rng, shape });
  const walls = new THREE.Mesh(wallGeometry, [mats.wallSide, mats.wallTop]);
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  for (const [x, z] of pillarCells) {
    const pillar = createModel(theme.pillarModel ?? 'dungeonPillar');
    pillar.root.position.set(grid.centerX(x), 0, grid.centerZ(z));
    pillar.root.rotation.y = rng.int(0, 3) * Math.PI / 2;
    applyCutaway(pillar.root);
    group.add(pillar.root);
    pillars.push(pillar);
  }

  const lavaGeometry = buildFloorGeometry(grid, lavaCells, { isWall: () => false, isDrop: () => false, cornerShade: 0, rng });
  lavaGeometry.translate(0, -0.12, 0);
  group.add(new THREE.Mesh(lavaGeometry, mats.lava));
  disposables.push(floorGeometry, wallGeometry, lavaGeometry);
  updaters.push((dt, t) => {
    mats.lava.emissiveIntensity = theme.pool.intensity * (1 + Math.sin(t * 2) * 0.25);
    mats.lava.map.offset.set(t * 0.012, t * 0.008); // map e emissiveMap são a mesma textura
  });

  // Luz sobre as primeiras poças de lava
  for (const pool of layout.lavaPools.slice(0, MAX_LAVA_LIGHTS)) {
    const light = new THREE.PointLight(theme.lavaLight, 14, 8, 1.5);
    light.position.set(grid.originX + pool.x + pool.w / 2, 0.9, grid.originZ + pool.z + pool.h / 2);
    group.add(light);
  }

  // Braseiros
  for (const [cx, cz] of layout.braziers) {
    const brazier = createTorch('brazier', { color: theme.torch.color, intensity: 14, distance: 10, lightY: 1.7 });
    brazier.group.position.set(grid.centerX(cx), 0, grid.centerZ(cz));
    const flame = createFlame(theme.torch.color);
    flame.group.position.y = 1.12; // em cima das brasas
    flame.group.scale.setScalar(3.2);
    brazier.group.add(flame.group);
    group.add(brazier.group);
    disposables.push(flame);
    updaters.push((dt, t) => { brazier.update(t); flame.update(t); });
  }

  // Escadaria que desce para o próximo andar (dentro do vão aberto no chão)
  const { x: sx, z: sz } = layout.stairwell;
  const stairs = createModel('stairs');
  stairs.root.position.set(sx, 0, sz);
  group.add(stairs.root);
  // Luz vermelha logo acima do vão: ilumina os degraus e a borda
  const stairsLight = new THREE.PointLight(0xff3300, 12, 8, 1.5);
  stairsLight.position.set(sx, 0.4, sz);
  group.add(stairsLight);
  // Brilho da porta no fundo do poço, iluminando os degraus de baixo
  const pitLight = new THREE.PointLight(0xff4a10, 6, 4, 1.5);
  pitLight.position.set(sx, -0.9, sz - 0.8);
  group.add(pitLight);
  let stairsGlow = layout.isBossFloor ? 3 : 11; // selada = brilho fraco
  updaters.push((dt, t) => { stairsLight.intensity = stairsGlow + Math.sin(t * 4) * 3; });

  // Andar de chefe: um selo de energia cobre o vão até o chefe morrer
  let seal = null;
  if (layout.isBossFloor) {
    const sealMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2a10, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    seal = new THREE.Mesh(new THREE.PlaneGeometry(2, 3).rotateX(-Math.PI / 2), sealMaterial);
    seal.position.set(sx, 0.05, sz);
    group.add(seal);
    disposables.push(seal.geometry, sealMaterial);
    updaters.push((dt, t) => { if (seal) sealMaterial.opacity = 0.35 + Math.sin(t * 3) * 0.15; });
  }

  // No último andar a escadaria não desce mais: depois do chefe final, ela leva de volta ao vilarejo
  const isLastFloor = floor >= CONFIG.world.maxFloor;
  const descendName = isLastFloor ? 'Sair do Oblivion — Vilarejo' : `Descer — Andar ${floor + 1}`;
  const stairsInteractable = makeInteractable({
    // Em andar de chefe, a escadaria começa selada
    name: layout.isBossFloor ? 'Escadaria selada' : descendName, x: sx, z: sz, group,
    radius: 2.2, hitRadius: 1.4, hitHeight: 0.8, labelHeight: 1.6,
    labelColor: layout.isBossFloor ? '#9a7a7a' : '#ff8a5a',
    onUse: () => {
      const boss = game.world.boss;
      if (boss?.alive) {
        game.ui.message(`Uma força sombria sela a escadaria. Derrote ${boss.name}.`, '#ff8060');
        return;
      }
      if (isLastFloor) game.world.goTo('village');
      else game.world.goTo('dungeon', floor + 1);
    },
  });
  interactables.push(stairsInteractable);

  // Waypoint fixo na sala inicial a cada CONFIG.world.waypointEvery andares
  let spawn = { x: grid.centerX(layout.start.cx), z: grid.centerZ(layout.start.cz) };
  if (floor % CONFIG.world.waypointEvery === 0) {
    const waypoint = createWaypoint();
    waypoint.group.position.set(spawn.x, 0, spawn.z);
    group.add(waypoint.group);
    updaters.push((dt, t) => waypoint.update(t));
    interactables.push(makeInteractable({
      name: `Waypoint — Andar ${floor}`, x: spawn.x, z: spawn.z, group,
      radius: 2.4, hitRadius: 1.5, hitHeight: 1.2, labelHeight: 2.2, labelColor: '#7fe0ff',
      onUse: () => game.ui.openWaypoints(),
    }));
    // O jogador aparece ao lado da plataforma
    const cell = grid.nearestWalkable(layout.start.cx + 3, layout.start.cz + 1, 4);
    if (cell) spawn = { x: grid.centerX(cell.cx), z: grid.centerZ(cell.cz) };
  }

  // Enfeites (tochas de parede, correntes, ossos...). Longe da escada, do waypoint e da chegada.
  const near = (x, z, cx, cz, r) => Math.abs(x - cx) <= r && Math.abs(z - cz) <= r;
  const decor = decorateDungeon({
    grid, layout, group, rng, theme, isPillar, shape,
    isReserved: (x, z) => near(x, z, layout.stairsRoom.cx, layout.stairsRoom.cz, 2) || near(x, z, layout.start.cx, layout.start.cz, 2) ||
      brazierSet.has(z * grid.width + x),
  });
  updaters.push((dt, t) => decor.update(dt, t));

  // Luz que acompanha o jogador (como uma tocha na mão)
  const playerLight = new THREE.PointLight(theme.playerLight.color, theme.playerLight.intensity, theme.playerLight.distance, 1.3);
  group.add(playerLight);

  // Brasas flutuando (partículas) ao redor do jogador
  const EMBERS = 160;
  const emberPositions = new Float32Array(EMBERS * 3);
  for (let i = 0; i < EMBERS; i++) {
    emberPositions[i * 3] = grid.centerX(layout.start.cx) + rng.range(-15, 15);
    emberPositions[i * 3 + 1] = rng.range(0, 5);
    emberPositions[i * 3 + 2] = grid.centerZ(layout.start.cz) + rng.range(-15, 15);
  }
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMaterial = new THREE.PointsMaterial({
    color: theme.emberColor, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const embers = new THREE.Points(emberGeometry, emberMaterial);
  embers.frustumCulled = false;
  group.add(embers);
  disposables.push(emberGeometry, emberMaterial);
  updaters.push((dt, t) => {
    const p = game.player.position;
    playerLight.position.set(p.x, 3, p.z);
    for (let i = 0; i < EMBERS; i++) {
      const ix = i * 3;
      emberPositions[ix + 1] += dt * (0.3 + (i % 5) * 0.12);
      emberPositions[ix] += Math.sin(t + i) * dt * 0.3;
      // Se a brasa ficou longe do jogador ou alta demais, reaparece perto dele
      if (emberPositions[ix + 1] > 5 || Math.abs(emberPositions[ix] - p.x) > 16 || Math.abs(emberPositions[ix + 2] - p.z) > 16) {
        emberPositions[ix] = p.x + (Math.random() - 0.5) * 30;
        emberPositions[ix + 1] = 0;
        emberPositions[ix + 2] = p.z + (Math.random() - 0.5) * 30;
      }
    }
    emberGeometry.attributes.position.needsUpdate = true;
  });

  // Luz ambiente do tema
  group.add(new THREE.HemisphereLight(theme.hemisphere.sky, theme.hemisphere.ground, theme.hemisphere.intensity));
  const sun = makeSun(theme.sun.color, theme.sun.intensity);
  group.add(sun, sun.target);

  // ---------- pergaminho de portal ----------
  let townPortal = null;
  function openTownPortal(x, z) {
    if (townPortal) {
      group.remove(townPortal.portal.group);
      townPortal.portal.dispose();
      removeInteractable(townPortal.interactable);
      interactables.splice(interactables.indexOf(townPortal.interactable), 1);
    }
    // Coloca o portal ao lado do jogador, num lugar livre
    let px = x, pz = z;
    for (const [ox, oz] of [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5], [0, 0]]) {
      if (grid.walkLine(x, z, x + ox, z + oz, 0.4)) { px = x + ox; pz = z + oz; break; }
    }
    const portal = createPortal({ colorA: 0x2a6bff, colorB: 0x9a40ff, lightColor: 0x4a7bff, scale: 0.75 });
    portal.group.position.set(px, 0, pz);
    portal.group.rotation.y = game.cam.yaw; // virado para a câmera
    group.add(portal.group);
    const interactable = makeInteractable({
      name: 'Portal para o Vilarejo', x: px, z: pz, group,
      radius: 2.2, hitRadius: 1.3, hitHeight: 3, labelHeight: 3.4, labelColor: '#8fb0ff',
      onUse: () => game.world.takeTownPortal(),
    });
    interactables.push(interactable);
    townPortal = { portal, interactable };
  }

  return {
    kind: 'dungeon',
    name: `Oblivion — Andar ${floor}`,
    floor,
    group,
    grid,
    layout,
    spawn,
    interactables,
    enemySpawns: layout.spawns,
    sun,
    themeName: theme.name,
    environment: {
      background: theme.background,
      fog: theme.fog,
      sunOffset: new THREE.Vector3(-10, 25, 6),
    },
    openTownPortal,
    // Chamado pelo WorldManager quando o chefe morre: o selo some e a escadaria se abre
    onBossDefeated() {
      renameInteractable(stairsInteractable, descendName, '#ff8a5a');
      stairsGlow = 16;
      seal?.removeFromParent();
      seal = null;
      game.vfx.burst({ x: sx, y: 0, z: sz }, 0xff5a2a, 1.6, 0.2);
      game.vfx.pillar({ position: { x: sx, z: sz } }, 0xff5a2a);
    },
    update(dt, t) {
      for (const fn of updaters) fn(dt, t);
      townPortal?.portal.update(t);
    },
    dispose() {
      if (townPortal) townPortal.portal.dispose();
      for (const it of interactables) removeInteractable(it);
      for (const d of disposables) d.dispose();
      for (const p of pillars) p.dispose();
      decor.dispose();
      stairs.dispose();
    },
  };
}
