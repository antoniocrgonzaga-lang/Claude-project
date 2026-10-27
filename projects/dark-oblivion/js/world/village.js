// =============================================================
// village.js — o Vilarejo de Corvália (área segura), no clima de
// Tristram (Diablo 1): anoitecer frio, névoa, lama, árvores mortas,
// casas de pedra e palha, cemitério e as ruínas de uma catedral
// atrás do Portal do Oblivion.
//
// Monta: chão (com manchas de lama e grama seca), praça, caminhos,
// casas, barraca do ferreiro, poço, cemitério, ruínas, pedras,
// cercas, tochas, lanternas, fumaça das chaminés, névoa no chão,
// luz da lua e o Portal do Oblivion.
// Também marca no NavGrid tudo que bloqueia a passagem.
//
// Toda área (vilarejo ou andar) devolve o mesmo "formato" de objeto:
//   { kind, name, group, grid, spawn, interactables, enemySpawns,
//     environment, sun, update(dt, t), dispose() }
// =============================================================
import * as THREE from 'three';
import { NavGrid, CELL } from '../core/grid.js';
import { createModel } from '../core/assets.js';
import { getStandardMaterial, getTexturedMaterial } from '../core/materials.js';
import { getTexture } from '../core/textures.js';
import { createRng } from '../core/rng.js';
import { createPortal, createTorch, makeInteractable, removeInteractable, localToWorld } from './props.js';
import { applyCutaway } from './cutaway.js';
import { SHOP } from '../data/shop.js';
import { game } from '../game.js';

const SIZE = 56; // o grid vai de -28 a +28 nos eixos X e Z
const PORTAL_POS = { x: -14, z: -14 };
const RETURN_PORTAL_POS = { x: 2, z: -12.5 };
const MERCHANT_POS = { x: 7.4, z: -6 };
const MERCHANT_LOOK_RANGE = 6; // a partir dessa distância o ferreiro se vira para o jogador
const CEMETERY = { x0: 12.5, x1: 21.5, z0: -23.5, z1: -15.5 }; // linhas das cercas do cemitério

// Tamanho (em metros) de uma repetição das texturas de grama e terra
const GROUND_TILE = 3;

const facingCenter = (x, z) => Math.atan2(-x, -z);             // ângulo para olhar a origem
const snap90 = (angle) => Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);

// Textura de um "pontinho" redondo e esfumaçado, desenhada num canvas.
// Usada nas partículas de fumaça e de névoa (sem ela, cada partícula seria um quadrado).
let softDot = null;
function getSoftDotTexture() {
  if (softDot) return softDot;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  softDot = new THREE.CanvasTexture(canvas);
  return softDot;
}

export function buildVillage() {
  const group = new THREE.Group();
  const disposables = [];   // coisas criadas só para esta área (destruídas ao sair)
  const updaters = [];      // funções chamadas todo quadro (tochas, portal...)
  const interactables = [];
  const rng = createRng(777); // posições "aleatórias" fixas: a vila é sempre igual

  const grid = new NavGrid(SIZE, SIZE, -SIZE / 2, -SIZE / 2);
  for (let i = 0; i < SIZE; i++) { // borda do mapa
    grid.set(i, 0, CELL.WALL); grid.set(i, SIZE - 1, CELL.WALL);
    grid.set(0, i, CELL.WALL); grid.set(SIZE - 1, i, CELL.WALL);
  }

  // ---------- chão ----------
  // Texturas geradas por código (core/textures.js): grama no chão todo, terra nos caminhos e na praça.
  // UV = posição em metros / GROUND_TILE: a textura tem o mesmo tamanho em qualquer pedaço do chão.
  const worldUVs = (geometry) => {
    const pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / GROUND_TILE, pos.getZ(i) / GROUND_TILE);
    uv.needsUpdate = true;
    return geometry;
  };
  const flat = (geometry, material, y) => {
    disposables.push(geometry);
    const mesh = new THREE.Mesh(worldUVs(geometry), material);
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const grassMaterial = getTexturedMaterial('grass', 0xffffff, { roughness: 1 });
  const dirtMaterial = getTexturedMaterial('dirt', 0xffffff, { roughness: 1 });
  flat(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), grassMaterial, 0);
  flat(new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2), dirtMaterial, 0.012); // praça de terra batida

  // Caminho de terra entre dois pontos (guardado para receber manchas de terra nas bordas)
  const paths = [];
  const addPath = (x0, z0, x1, z1, width) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const mesh = flat(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), dirtMaterial, 0.008);
    mesh.position.x = (x0 + x1) / 2;
    mesh.position.z = (z0 + z1) / 2;
    mesh.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    paths.push({ x0, z0, x1, z1, width });
  };
  addPath(0, 0, PORTAL_POS.x + 1.5, PORTAL_POS.z + 1.5, 3);
  addPath(0, 0, MERCHANT_POS.x, MERCHANT_POS.z, 2.5);
  addPath(0, 0, -6, 12, 2);
  addPath(0, 0, 14, 4, 2);
  addPath(9, -12, 16, -15.8, 1.6); // até a entrada do cemitério

  // Manchas com borda esfumaçada (alphaMap 'softCircle'), em duas InstancedMesh:
  //   - grama: tons mais secos/escuros, para o gramado não ficar uniforme
  //   - terra: nas bordas dos caminhos e da praça, para a terra "se misturar" com a grama
  const grassPatches = [], dirtPatches = [];
  const grassTints = [0xffffff, 0xd8cfa0, 0xa8b090, 0xe8dcb0, 0xb8c0a0];
  for (let i = 0; i < 150; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 42;
    grassPatches.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, sx: rng.range(1.2, 4), sz: rng.range(1.2, 4), color: rng.pick(grassTints), y: 0.002 + (i % 5) * 0.0008 });
  }
  for (const p of paths) {
    const len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
    const nx = -(p.z1 - p.z0) / len, nz = (p.x1 - p.x0) / len; // perpendicular ao caminho
    for (let d = 0.8; d < len; d += 1.1) {
      const t = d / len, side = rng.chance(0.5) ? 1 : -1;
      const off = side * (p.width / 2) * rng.range(0.7, 1.15);
      dirtPatches.push({ x: p.x0 + (p.x1 - p.x0) * t + nx * off, z: p.z0 + (p.z1 - p.z0) * t + nz * off, sx: rng.range(0.7, 1.5), sz: rng.range(0.7, 1.5), color: 0xffffff, y: 0.0095 });
    }
  }
  for (let a = 0; a < Math.PI * 2; a += 0.14) { // borda da praça
    const r = 9 + rng.range(-0.4, 0.5);
    dirtPatches.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, sx: rng.range(0.8, 1.6), sz: rng.range(0.8, 1.6), color: 0xffffff, y: 0.0125 });
  }
  const patchGeometry = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const addPatches = (list, textureName) => {
    const material = new THREE.MeshStandardMaterial({
      map: getTexture(textureName), alphaMap: getTexture('softCircle'),
      transparent: true, depthWrite: false, roughness: 1,
    });
    const mesh = new THREE.InstancedMesh(patchGeometry, material, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, rng.range(0, Math.PI), 0);
      dummy.scale.set(p.sx, 1, p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(p.color));
    });
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(mesh, material);
  };
  addPatches(grassPatches, 'grass');
  addPatches(dirtPatches, 'dirt');
  disposables.push(patchGeometry);

  // ---------- helper para colocar modelos ----------
  // block = [largura, profundidade] do espaço que bloqueia o caminho
  const place = (id, x, z, rotY = 0, block = null, scale = 1) => {
    const model = createModel(id);
    model.root.position.set(x, 0, z);
    model.root.rotation.y = rotY;
    if (scale !== 1) model.root.scale.setScalar(scale);
    group.add(model.root);
    if (block) {
      const swap = Math.abs(Math.sin(rotY)) > 0.7; // girado 90°? troca largura e profundidade
      grid.blockWorldRect(x, z, swap ? block[1] : block[0], swap ? block[0] : block[1]);
    }
    return model;
  };

  // Tocha / lanterna com luz que tremula. Ocupa uma célula pequena.
  const addLight = (modelId, x, z, options) => {
    const torch = createTorch(modelId, options);
    torch.group.position.set(x, 0, z);
    group.add(torch.group);
    grid.blockWorldRect(x, z, 0.6, 0.6);
    updaters.push((dt, t) => torch.update(t));
    return torch;
  };

  // ---------- casas (portas viradas para a praça) ----------
  const houses = [[-15, 5], [-6, 15], [8, 15], [17, 4], [-18, -5], [4, -18]];
  const chimneys = [];
  for (const [x, z] of houses) {
    const rot = snap90(facingCenter(x, z));
    // applyCutaway: se o jogador passar atrás, a parte da frente fica "transparente"
    applyCutaway(place('house', x, z, rot, [5.2, 4.2]).root);
    const c = localToWorld(x, z, rot, 1.5, -0.8);
    chimneys.push({ x: c.x, y: 5.2, z: c.z });
  }

  // ---------- poço no centro ----------
  applyCutaway(place('well', 0, 0, 0, [2, 2]).root);

  // ---------- ferreiro ----------
  applyCutaway(place('stall', 10.2, -6, -Math.PI / 2, [4.4, 3.2]).root);
  place('anvil', 7.6, -8.4, 0.3, [1, 1]);
  place('barrel', 12.6, -2.8, 0, [0.8, 0.8]);
  place('barrel', 13.3, -3.6, 0, [0.8, 0.8]);
  place('crate', 12.4, -9.2, 0.4, [0.9, 0.9]);
  place('cart', 14.8, -6.5, 1.2, [2.2, 1.6]);
  const merchantRestRot = facingCenter(MERCHANT_POS.x, MERCHANT_POS.z);
  const merchant = place('merchant', MERCHANT_POS.x, MERCHANT_POS.z, merchantRestRot, [0.9, 0.9]);
  updaters.push((dt) => {
    // Jogador por perto: o ferreiro se vira devagar para ele; longe, volta a olhar para a praça
    const p = game.player?.position;
    const near = p && Math.hypot(p.x - MERCHANT_POS.x, p.z - MERCHANT_POS.z) < MERCHANT_LOOK_RANGE;
    const target = near ? Math.atan2(p.x - MERCHANT_POS.x, p.z - MERCHANT_POS.z) : merchantRestRot;
    const diff = Math.atan2(Math.sin(target - merchant.root.rotation.y), Math.cos(target - merchant.root.rotation.y));
    merchant.root.rotation.y += diff * Math.min(1, dt * 4);
    merchant.update(dt); // animação de "respiração"
  });
  interactables.push(makeInteractable({
    name: SHOP.merchantName, x: MERCHANT_POS.x, z: MERCHANT_POS.z, group,
    radius: 2.5, hitRadius: 0.7, hitHeight: 2, labelHeight: 2.4, labelColor: '#ffd27a',
    onUse: () => game.ui.openShop(MERCHANT_POS),
  }));

  // ---------- decoração ----------
  place('barrel', -11.8, 1.2, 0, [0.8, 0.8]);
  place('crate', 5.8, 11.4, 0.2, [0.9, 0.9]);
  place('crate', 6.6, 12.2, 0.9, [0.9, 0.9], 0.8);
  place('crate', -2.6, -17.4, 0.7, [0.9, 0.9]);
  place('hay', -12.4, 8.6, 0.3, [1, 1]);
  place('stump', -9.5, 9, 0, null);
  place('stump', 20.5, 11.5, 0, null);
  place('stump', -4, -21, 0, null);

  // Árvores mortas (as que ficam no caminho somem com o recorte da câmera)
  for (const [x, z] of [[-21, 14], [-11, 21], [14, 21], [21, -10], [-22, -14], [-8, -22], [22, 14], [-23, 3], [24, -2], [-2, 22], [10, -23]]) {
    applyCutaway(place('tree', x, z, rng.range(0, Math.PI * 2), [1, 1], rng.range(0.9, 1.35)).root);
  }

  // Pedras azuladas: as grandes bloqueiam a passagem, as pequenas são só enfeite
  for (const [x, z, s] of [
    [-11, -3, 1.0], [-20, 10, 1.3], [-24, -8, 1.1], [24, 2.5, 1.3], [10, 23, 1.1], [-14, 24, 1.0],
    [-25, 20, 1.4], [25, -24, 1.2], [3, 21, 0.9], [23, 20, 1.1], [-5, -25, 1.2],
  ]) place('rock', x, z, rng.range(0, Math.PI * 2), [1.2 * s, 1.0 * s], s);
  for (const [x, z, s] of [[-9, 6, 0.6], [6, 6.5, 0.5], [22, 8, 0.6], [-6, -14, 0.55], [8, -12.5, 0.6], [-3, 9.5, 0.4], [11.5, 3, 0.45], [-16, 0.5, 0.5]]) {
    place('rock', x, z, rng.range(0, Math.PI * 2), null, s);
  }

  // Cercado (com uma parte quebrada) e feno
  for (const x of [12.5, 14.5]) place('fence', x, 10, 0, [2, 0.4]);
  place('fenceBroken', 16.5, 10, 0, [2, 0.4]);
  for (const z of [11, 13]) place('fence', 17.5, z, Math.PI / 2, [2, 0.4]);
  place('hay', 14.6, 11.8, 0.2, [1, 1]);
  place('hay', 15.6, 12.6, 1.4, [1, 1]);

  // ---------- cemitério ----------
  // Tudo alinhado à grade de 1 x 1: cercas no meio das células (bloqueiam 1 célula de
  // espessura) e túmulos no centro das células, com corredores livres entre as fileiras.
  const C = CEMETERY;
  const fenceAlongX = (z, xs) => xs.forEach(([x, broken]) => place(broken ? 'fenceBroken' : 'fence', x, z, 0, [2, 0.4]));
  const fenceAlongZ = (x, zs) => zs.forEach(([z, broken]) => place(broken ? 'fenceBroken' : 'fence', x, z, Math.PI / 2, [2, 0.4]));
  fenceAlongX(C.z1, [[14, false], [18, true], [20, false]]);                   // frente (entrada em x 15–17)
  fenceAlongX(C.z0, [[14, false], [16, false], [18, true], [20, false]]);      // fundo
  fenceAlongZ(C.x0, [[-17, false], [-19, false], [-21, true]]);                // lado oeste
  fenceAlongZ(C.x1, [[-17, true], [-19, false], [-21, false]]);                // lado leste
  for (const [x, z, cross] of [
    [14.5, -18.5, false], [16.5, -18.5, true], [18.5, -18.5, false],
    [14.5, -20.5, true], [16.5, -20.5, false], [18.5, -20.5, false],
    [15.5, -22.5, true], [17.5, -22.5, false],
  ]) {
    // as lápides olham para a entrada (frente = +Z), com uma leve torção.
    // Só a lápide bloqueia: dá para andar sobre o monte de terra e entre os túmulos.
    place(cross ? 'graveCross' : 'grave', x, z, rng.range(-0.15, 0.15), [0.5, 0.3]);
  }
  applyCutaway(place('tree', 19.5, -22.5, 0.7, [1, 1], 1.2).root);
  addLight('lantern', 14.6, -14.8, { color: 0xffa050, intensity: 8, distance: 11, lightY: 2.3 });

  // ---------- tochas ao redor da praça e lanternas nos caminhos ----------
  for (const [x, z] of [[9.5, 0], [0, 9.5], [-9.5, 0], [0, -9.5]]) {
    addLight('torch', x, z, { intensity: 11, distance: 13 });
  }
  for (const [x, z] of [[-7, -10.2], [-3.4, 11.5], [10.5, 5.5], [4.6, -15]]) {
    addLight('lantern', x, z, { color: 0xffa050, intensity: 8, distance: 11, lightY: 2.3 });
  }

  // ---------- Portal do Oblivion, nas ruínas da catedral ----------
  const portalRot = facingCenter(PORTAL_POS.x, PORTAL_POS.z);
  const portal = createPortal();
  portal.group.position.set(PORTAL_POS.x, 0, PORTAL_POS.z);
  portal.group.rotation.y = portalRot;
  group.add(portal.group);
  disposables.push(portal);
  updaters.push((dt, t) => portal.update(t));
  blockPortalBase(grid, PORTAL_POS.x, PORTAL_POS.z, portalRot, CELL.WALL);
  for (const side of [-1, 1]) { // tochas ao lado do portal (sem luz própria)
    const p = localToWorld(PORTAL_POS.x, PORTAL_POS.z, portalRot, side * 3, 0.9);
    const torch = createTorch('torch', { light: false });
    torch.group.position.set(p.x, 0, p.z);
    group.add(torch.group);
    grid.blockWorldRect(p.x, p.z, 0.6, 0.6);
  }
  interactables.push(makeInteractable({
    name: 'Portal do Oblivion', x: PORTAL_POS.x, z: PORTAL_POS.z, group,
    radius: 2.8, hitRadius: 1.8, hitHeight: 3.8, labelHeight: 4.4, labelColor: '#ff7070',
    // Sem waypoints ativados: vai direto ao andar 1. Com waypoints: abre o menu de destinos.
    onUse: () => (game.player.waypoints.length ? game.ui.openWaypoints() : game.world.goTo('dungeon', 1)),
  }));

  // Ruínas atrás do portal (lx = para o lado, lz negativo = para trás do portal)
  const ruin = (id, lx, lz, extraRot, halfWidth) => {
    const p = localToWorld(PORTAL_POS.x, PORTAL_POS.z, portalRot, lx, lz);
    const rot = portalRot + extraRot;
    applyCutaway(place(id, p.x, p.z, rot).root);
    // Parede girada: bloqueia ao longo do comprimento dela (blockWorldRect só funciona alinhado aos eixos)
    const a = localToWorld(p.x, p.z, rot, -halfWidth, 0), b = localToWorld(p.x, p.z, rot, halfWidth, 0);
    grid.blockWorldLine(a.x, a.z, b.x, b.z);
  };
  ruin('ruinWall', 0, -3.4, 0, 1.5);
  ruin('ruinWall', -3.8, -2.4, 0.55, 1.5);
  ruin('ruinWall', 3.8, -2.4, -0.55, 1.5);
  ruin('ruinPillar', -5.6, -0.6, 0, 0.4);
  ruin('ruinPillar', 5.6, -0.6, 0.6, 0.4);
  for (const [lx, lz, s] of [[-1.8, -4.6, 0.5], [2.4, -4.3, 0.6], [-5.8, -2.6, 0.45], [6.2, -2.4, 0.5]]) {
    const p = localToWorld(PORTAL_POS.x, PORTAL_POS.z, portalRot, lx, lz);
    place('rock', p.x, p.z, rng.range(0, Math.PI * 2), null, s);
  }

  // ---------- floresta em volta (fora do grid, só visual) ----------
  // InstancedMesh: 1 chamada de desenho para todos os troncos, 1 para as copas e 1 para as árvores mortas
  const forestCount = 110;
  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 6).translate(0, 0.8, 0);
  const crownGeometry = new THREE.ConeGeometry(1.5, 3.4, 7).translate(0, 3.1, 0);
  const deadGeometry = new THREE.CylinderGeometry(0.05, 0.22, 3.6, 5).translate(0, 1.8, 0);
  disposables.push(trunkGeometry, crownGeometry, deadGeometry);
  const trunks = new THREE.InstancedMesh(trunkGeometry, getStandardMaterial(0x241a12), forestCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, getStandardMaterial(0x18221a), forestCount);
  const deadCount = 60;
  const dead = new THREE.InstancedMesh(deadGeometry, getStandardMaterial(0x2b2420), deadCount);
  const forestSpot = (minDist, maxDist) => {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(minDist, maxDist);
    dummy.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    dummy.scale.setScalar(rng.range(0.8, 1.5));
  };
  for (let i = 0; i < forestCount; i++) {
    forestSpot(30, 48);
    dummy.rotation.set(0, rng.range(0, Math.PI), 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < deadCount; i++) {
    forestSpot(29, 40);
    dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI), rng.range(-0.12, 0.12)); // levemente tortas
    dummy.updateMatrix();
    dead.setMatrixAt(i, dummy.matrix);
  }
  trunks.castShadow = crowns.castShadow = dead.castShadow = true;
  group.add(trunks, crowns, dead);
  disposables.push(trunks, crowns, dead);

  // ---------- fumaça das chaminés ----------
  const SMOKE_PER_CHIMNEY = 14;
  const smokeCount = chimneys.length * SMOKE_PER_CHIMNEY;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeAge = new Float32Array(smokeCount);
  const SMOKE_LIFE = 5;
  const resetSmoke = (i) => {
    const c = chimneys[Math.floor(i / SMOKE_PER_CHIMNEY)];
    smokePositions[i * 3] = c.x + (Math.random() - 0.5) * 0.3;
    smokePositions[i * 3 + 1] = c.y;
    smokePositions[i * 3 + 2] = c.z + (Math.random() - 0.5) * 0.3;
  };
  for (let i = 0; i < smokeCount; i++) {
    resetSmoke(i);
    smokeAge[i] = (i % SMOKE_PER_CHIMNEY) / SMOKE_PER_CHIMNEY * SMOKE_LIFE; // espalha no tempo
    smokePositions[i * 3 + 1] += smokeAge[i] * 0.55;
  }
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokeMaterial = new THREE.PointsMaterial({
    color: 0x5e5a62, size: 30, sizeAttenuation: false, map: getSoftDotTexture(),
    transparent: true, opacity: 0.32, depthWrite: false,
  });
  const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
  smoke.frustumCulled = false;
  group.add(smoke);
  disposables.push(smokeGeometry, smokeMaterial);
  updaters.push((dt) => {
    for (let i = 0; i < smokeCount; i++) {
      smokeAge[i] += dt;
      if (smokeAge[i] > SMOKE_LIFE) { smokeAge[i] = 0; resetSmoke(i); continue; }
      smokePositions[i * 3] += dt * 0.25;        // vento leve
      smokePositions[i * 3 + 1] += dt * 0.55;    // sobe
      smokePositions[i * 3 + 2] -= dt * 0.1;
    }
    smokeGeometry.attributes.position.needsUpdate = true;
  });

  // ---------- névoa rasteira (manchas grandes e bem transparentes) ----------
  const MIST = 70;
  const mistPositions = new Float32Array(MIST * 3);
  for (let i = 0; i < MIST; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 30;
    mistPositions[i * 3] = Math.cos(a) * r;
    mistPositions[i * 3 + 1] = rng.range(0.2, 0.9);
    mistPositions[i * 3 + 2] = Math.sin(a) * r;
  }
  const mistGeometry = new THREE.BufferGeometry();
  mistGeometry.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
  const mistMaterial = new THREE.PointsMaterial({
    color: 0x8a92aa, size: 150, sizeAttenuation: false, map: getSoftDotTexture(),
    transparent: true, opacity: 0.06, depthWrite: false,
  });
  const mist = new THREE.Points(mistGeometry, mistMaterial);
  mist.frustumCulled = false;
  group.add(mist);
  disposables.push(mistGeometry, mistMaterial);
  updaters.push((dt) => {
    for (let i = 0; i < MIST; i++) {
      mistPositions[i * 3] += dt * (0.15 + (i % 4) * 0.05);
      if (mistPositions[i * 3] > 32) mistPositions[i * 3] -= 64; // saiu por um lado, volta pelo outro
    }
    mistGeometry.attributes.position.needsUpdate = true;
  });

  // ---------- luz do anoitecer: lua fria + céu azulado ----------
  const hemi = new THREE.HemisphereLight(0xb8c0d8, 0x3a3238, 2.8);
  group.add(hemi);
  const sun = makeSun(0xd0d8f0, 3.0); // "sol" aqui é a lua: luz fria, vinda do noroeste
  group.add(sun, sun.target);

  // ---------- portal de volta (pergaminho) ----------
  let returnPortal = null;
  const returnRot = facingCenter(RETURN_PORTAL_POS.x, RETURN_PORTAL_POS.z);
  function setReturnPortal(floor) {
    if (returnPortal) {
      group.remove(returnPortal.portal.group);
      returnPortal.portal.dispose();
      removeInteractable(returnPortal.interactable);
      interactables.splice(interactables.indexOf(returnPortal.interactable), 1);
      blockPortalBase(grid, RETURN_PORTAL_POS.x, RETURN_PORTAL_POS.z, returnRot, CELL.FLOOR, 0.75);
      returnPortal = null;
    }
    if (!floor) return;
    const portal = createPortal({ colorA: 0x2a6bff, colorB: 0x9a40ff, lightColor: 0x4a7bff, scale: 0.75 });
    portal.group.position.set(RETURN_PORTAL_POS.x, 0, RETURN_PORTAL_POS.z);
    portal.group.rotation.y = returnRot;
    group.add(portal.group);
    blockPortalBase(grid, RETURN_PORTAL_POS.x, RETURN_PORTAL_POS.z, returnRot, CELL.WALL, 0.75);
    const interactable = makeInteractable({
      name: `Portal de volta — Andar ${floor}`, x: RETURN_PORTAL_POS.x, z: RETURN_PORTAL_POS.z, group,
      radius: 2.4, hitRadius: 1.4, hitHeight: 3, labelHeight: 3.6, labelColor: '#8fb0ff',
      onUse: () => game.world.useReturnPortal(),
    });
    interactables.push(interactable);
    returnPortal = { portal, interactable };
  }

  return {
    kind: 'village',
    name: 'Vilarejo de Corvália',
    group,
    grid,
    spawn: { x: 3, z: 4 },
    interactables,
    enemySpawns: [],
    sun,
    environment: {
      background: 0x22242e,
      fog: { color: 0x22242e, near: 46, far: 90 },
      sunOffset: new THREE.Vector3(-18, 28, -14), // de onde vem a luz da lua (noroeste, alta)
    },
    setReturnPortal,
    update(dt, t) {
      for (const fn of updaters) fn(dt, t);
      returnPortal?.portal.update(t);
    },
    dispose() {
      setReturnPortal(0);
      for (const it of interactables) removeInteractable(it);
      for (const d of disposables) d.dispose();
    },
  };
}

// Marca no grid a base do portal (uma linha ao longo do anel), para não atravessarmos ele
function blockPortalBase(grid, x, z, rotY, value, scale = 1) {
  const a = localToWorld(x, z, rotY, -2.2 * scale, 0);
  const b = localToWorld(x, z, rotY, 2.2 * scale, 0);
  grid.blockWorldLine(a.x, a.z, b.x, b.z, value);
}

// Luz direcional (sol) com sombras. A posição é atualizada pelo WorldManager
// para seguir o jogador, assim as sombras ficam sempre nítidas perto dele.
export function makeSun(color, intensity) {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -28; s.right = 28; s.top = 28; s.bottom = -28;
  s.near = 1; s.far = 90;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  return sun;
}
