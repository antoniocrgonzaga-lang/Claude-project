import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { neon } from './Utils.js';

const OUTLINE_WIDTH = 0.034; // espessura dos contornos, em unidades do mundo
const OUTLINE_ANGLE = 32;    // ângulo mínimo (graus) entre faces para a aresta ganhar contorno
const WHITE = new THREE.Color(0xffffff);

// ------------------------------------------------------------------ contornos (linhas grossas)

const lineMaterials = new Set();
const lineResolution = new THREE.Vector2(1280, 720);

/** Mantém os materiais de contorno em sincronia com o tamanho do canvas (chamado no resize). */
export function setOutlineResolution(width, height) {
  lineResolution.set(width, height);
  for (const mat of lineMaterials) mat.resolution.copy(lineResolution);
}

function createLineMaterial() {
  const mat = new LineMaterial({ linewidth: OUTLINE_WIDTH, worldUnits: true, vertexColors: true });
  mat.resolution.copy(lineResolution);
  lineMaterials.add(mat);
  mat.addEventListener('dispose', () => lineMaterials.delete(mat));
  return mat;
}

/** Brilho de borda (Fresnel): realça a silhueta da nave contra o cenário escuro. */
function withRim(mat, color, strength, power = 2.5) {
  const uniforms = {
    uRimColor: { value: new THREE.Color(color) },
    uRim: { value: new THREE.Vector2(strength, power) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform vec2 uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimFactor = 1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
        totalEmissiveRadiance += uRimColor * (uRim.x * pow(rimFactor, uRim.y));`);
  };
  mat.customProgramCacheKey = () => 'ship-rim';
  return mat;
}

// ------------------------------------------------------------------ geometria

function quad(a, b, c, d) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

/** Faixa plana no plano XZ, de (x0, z0) a (x1, z1), na altura y. */
function strip(x0, z0, x1, z1, halfWidth, y) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * halfWidth, pz = (dx / len) * halfWidth;
  return quad([x0 + px, y, z0 + pz], [x1 + px, y, z1 + pz], [x1 - px, y, z1 - pz], [x0 - px, y, z0 - pz]);
}

/** Faixa que acompanha uma linha [z, y] sobre a espinha da nave (x = 0). */
function ridgeStrip(points, halfWidth) {
  const pos = [], idx = [];
  points.forEach(([z, y], i) => {
    pos.push(-halfWidth, y, z, halfWidth, y, z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Superfície fechada a partir de seções transversais: o mesmo perfil escalado em cada seção. */
function loft(profile, sections, [capStart, capEnd] = [true, true]) {
  const pos = [], idx = [];
  const n = profile.length;
  for (const s of sections) for (const [px, py] of profile) pos.push(px * s.w, s.y + py * s.h, s.z);
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n);
      idx.push(a, a + n, b, b, a + n, b + n);
    }
  }
  const cap = (i) => {
    const center = pos.length / 3;
    pos.push(0, sections[i].y, sections[i].z);
    for (let j = 0; j < n; j++) idx.push(center, i * n + j, i * n + ((j + 1) % n));
  };
  if (capStart) cap(0);
  if (capEnd) cap(sections.length - 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Placa com espessura a partir de um contorno [x, z] no plano horizontal. */
function plate(points, thickness) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, thickness / 2, 0);
  return geo;
}

/** Placa vertical com espessura a partir de um contorno [z, y]. */
function finPlate(points, thickness) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness / 2, 0, 0);
  return geo;
}

function flipWinding(geo) {
  for (const name of ['position', 'normal']) {
    const a = geo.attributes[name].array;
    for (let i = 0; i < a.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = a[i + 3 + k];
        a[i + 3 + k] = a[i + 6 + k];
        a[i + 6 + k] = t;
      }
    }
  }
}

/**
 * Consolida o modelo: mescla as peças por material (poucas chamadas de desenho por nave)
 * e gera um único conjunto de contornos coloridos a partir das arestas marcadas.
 */
function bake(group) {
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });

  const buckets = new Map();
  const sources = new Set();
  const linePos = [], lineCol = [];
  for (const mesh of meshes) {
    const m = mesh.matrixWorld;
    sources.add(mesh.geometry);
    const color = mesh.userData.outline;
    if (color) {
      const edges = new THREE.EdgesGeometry(mesh.geometry, OUTLINE_ANGLE);
      edges.applyMatrix4(m);
      const arr = edges.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        linePos.push(arr[i], arr[i + 1], arr[i + 2]);
        lineCol.push(color.r, color.g, color.b);
      }
      edges.dispose();
    }
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.clearGroups();
    geo.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(geo);
    if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
    buckets.get(mesh.material).push(geo);
  }
  for (const mesh of meshes) mesh.removeFromParent();
  for (const geo of sources) geo.dispose();

  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos);
    for (const geo of geos) geo.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !mat.userData.noShadow;
    group.add(mesh);
  }

  if (linePos.length) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(linePos);
    geo.setColors(lineCol);
    const lines = new LineSegments2(geo, createLineMaterial());
    lines.renderOrder = 1;
    group.add(lines);
  }
}

// ------------------------------------------------------------------ modelo

// Perfil da fuselagem (unitário): quina lateral marcada (chine) e quilha achatada.
const PROFILE = [
  [0, 1], [0.5, 0.78], [0.92, 0.2], [1, 0], [0.72, -0.46],
  [0, -0.62], [-0.72, -0.46], [-1, 0], [-0.92, 0.2], [-0.5, 0.78],
];
// Seções ao longo do comprimento: [z (fração de L), largura, altura, deslocamento vertical].
const SECTIONS = [
  [-0.5, 0.03, 0.05, 0], [-0.35, 0.3, 0.38, 0], [-0.22, 0.52, 0.64, 0.02], [0, 0.8, 0.92, 0.04],
  [0.22, 0.97, 1, 0.04], [0.4, 1, 0.94, 0.03], [0.5, 0.9, 0.8, 0.02],
];

/**
 * Fighter antigravitacional procedural. Frente do modelo = -Z, direita = +X.
 * design.features: 'winglets', 'canards', 'spike', 'armor' (detalhes exclusivos de cada nave).
 * Retorna o grupo e os pontos locais dos motores (para partículas e trilhas).
 */
export function createShipModel(design, primary, accent) {
  const group = new THREE.Group();
  const { length: L, width: W, wingSpan: S, engines, engineRadius: ER } = design;
  const features = new Set(design.features || []);
  const bodyR = W * 0.34;
  const bodyH = bodyR * 0.42;

  // Materiais
  const surface = { side: THREE.DoubleSide, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  const hull = withRim(new THREE.MeshStandardMaterial({
    color: primary, metalness: 0.55, roughness: 0.32, emissive: primary, emissiveIntensity: 0.26, ...surface,
  }), new THREE.Color(primary).lerp(WHITE, 0.25), 0.45, 4);
  const trim = withRim(new THREE.MeshStandardMaterial({
    color: accent, metalness: 0.6, roughness: 0.3, emissive: accent, emissiveIntensity: 0.2, ...surface,
  }), accent, 0.35, 4);
  const dark = withRim(new THREE.MeshStandardMaterial({
    color: 0x0b0b16, metalness: 0.85, roughness: 0.25, ...surface,
  }), primary, 0.5, 3);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x05060c, metalness: 0.9, roughness: 0.08, emissive: accent, emissiveIntensity: 0.18, ...surface,
  });
  const glow = new THREE.MeshBasicMaterial({ color: neon(accent, 2.4), side: THREE.DoubleSide });
  const hot = new THREE.MeshBasicMaterial({ color: neon(primary, 2.2), side: THREE.DoubleSide });
  const nozzleMat = new THREE.MeshBasicMaterial({ color: neon(accent, 3.2), side: THREE.DoubleSide });
  for (const mat of [glow, hot, nozzleMat]) mat.userData.noShadow = true;

  // Cores dos contornos: tons claros e HDR para o bloom realçar as arestas.
  const outlineOf = new Map([
    [hull, new THREE.Color(primary).lerp(WHITE, 0.45).multiplyScalar(1.5)],
    [trim, new THREE.Color(accent).lerp(WHITE, 0.2).multiplyScalar(1.6)],
    [dark, new THREE.Color(primary).multiplyScalar(1.25)],
    [glass, new THREE.Color(accent).multiplyScalar(1.8)],
  ]);

  const add = (geo, mat, x = 0, y = 0, z = 0, { parent = group, outline = true } = {}) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (outline && outlineOf.has(mat)) mesh.userData.outline = outlineOf.get(mat);
    parent.add(mesh);
    return mesh;
  };

  // Fuselagem: bico na cor de destaque e corpo na cor principal.
  const sections = SECTIONS.map(([z, w, h, y]) => ({ z: z * L, w: w * bodyR, h: h * bodyH, y }));
  const along = (z, pick) => {
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i], b = sections[i + 1];
      if (z <= b.z || i === sections.length - 2) {
        const t = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)));
        return pick(a) + (pick(b) - pick(a)) * t;
      }
    }
    return 0;
  };
  const hullTop = (z) => along(z, (s) => s.y + s.h);
  const hullHalf = (z) => along(z, (s) => s.w);
  add(loft(PROFILE, sections.slice(0, 2), [true, false]), trim);
  add(loft(PROFILE, sections.slice(1), [false, true]), hull);

  // Cockpit facetado.
  const cz = -0.1 * L, cl = 0.17 * L;
  const canopy = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(W * 0.12, 0.34, cl);
  const canopyY = hullTop(cz) - 0.14;
  add(canopy, glass, 0, canopyY, cz);
  // Armação do cockpit: nervura central e dois arcos transversais.
  const frame = [];
  for (let i = 0; i <= 8; i++) {
    const u = -1 + (2 * i) / 8;
    frame.push([cz + u * cl, canopyY + 0.34 * Math.sqrt(Math.max(0, 1 - u * u)) + 0.008]);
  }
  add(ridgeStrip(frame, 0.035), trim, 0, 0, 0, { outline: false });
  for (const u of [-0.35, 0.3]) {
    const arch = new THREE.TorusGeometry(1, 0.035 / (W * 0.12), 4, 12, Math.PI);
    const k = Math.sqrt(1 - u * u);
    arch.scale(W * 0.12 * k, 0.34 * k, 0.4);
    add(arch, trim, 0, canopyY, cz + u * cl, { outline: false });
  }

  // Faixa de energia na espinha, do bico até o cockpit.
  const spine = [];
  for (let i = 0; i <= 6; i++) {
    const z = -0.47 * L + ((cz - cl + 0.02 * L + 0.47 * L) * i) / 6;
    spine.push([z, hullTop(z) + 0.016]);
  }
  add(ridgeStrip(spine, 0.045), glow);

  // Deque traseiro com saídas de calor.
  const dz0 = 0.08 * L, dz1 = 0.3 * L, dl = dz1 - dz0;
  const deckTop = Math.max(hullTop(dz0), hullTop(dz1)) + 0.06;
  add(new THREE.BoxGeometry(W * 0.28, 0.26, dl), dark, 0, deckTop - 0.13, (dz0 + dz1) / 2);
  for (let i = 0; i < 3; i++) {
    add(new THREE.BoxGeometry(W * 0.2, 0.02, 0.06), hot, 0, deckTop + 0.006, dz0 + dl * (0.28 + i * 0.22), { outline: false });
  }

  // Entradas de ar laterais com boca luminosa.
  if (!features.has('armor')) {
    const iz = 0.03 * L, il = 0.16 * L;
    for (const side of [1, -1]) {
      const ix = side * (hullHalf(iz) * 0.86 + 0.04);
      add(new THREE.BoxGeometry(0.22, 0.2, il), dark, ix, 0.06, iz);
      add(new THREE.BoxGeometry(0.16, 0.13, 0.03), glow, ix, 0.06, iz - il / 2 - 0.01, { outline: false });
    }
  }

  // Blindagem lateral (ION WARDEN).
  if (features.has('armor')) {
    const az = 0.1 * L, al = 0.46 * L;
    for (const side of [1, -1]) {
      const ax = side * (hullHalf(az) + 0.06);
      add(new THREE.BoxGeometry(0.3, 0.34, al), dark, ax, 0.02, az);
      add(new THREE.BoxGeometry(0.03, 0.06, al * 0.82), glow, ax + side * 0.16, 0.06, az, { outline: false });
      for (const k of [-1, 0, 1]) add(new THREE.BoxGeometry(0.34, 0.06, 0.14), trim, ax, 0.2, az + k * al * 0.28);
    }
  }

  // Canards dianteiros (CRIMSON SPEAR).
  if (features.has('canards')) {
    const kz = -0.27 * L;
    const canardGeo = plate([[0, -0.1 * L], [0, 0.02 * L], [0.6, 0.06 * L], [0.6, -0.02 * L]], 0.05);
    for (const side of [1, -1]) {
      const canard = add(canardGeo, trim, side * hullHalf(kz) * 0.8, 0.03, kz);
      canard.scale.x = side;
      canard.rotation.z = side * 0.12;
    }
  }

  // Lança de sensores no bico (CRIMSON SPEAR).
  if (features.has('spike')) {
    const spike = new THREE.ConeGeometry(0.06, L * 0.14, 6);
    spike.rotateX(-Math.PI / 2);
    add(spike, dark, 0, 0, -0.55 * L, { outline: false });
    add(new THREE.SphereGeometry(0.07, 8, 6), glow, 0, 0, -0.62 * L, { outline: false });
  }

  // Asas com espessura, painel escuro, faixa luminosa, luz de ponta e propulsor de flutuação.
  const t = 0.07;
  const lead = (x) => -0.16 * L + (x / S) * 0.36 * L;
  const trail = (x) => 0.38 * L + (x / S) * 0.08 * L;
  const wingGeo = plate([[0, lead(0)], [0, trail(0)], [S, trail(S)], [S, lead(S)]], t);
  const flapGeo = quad(
    [0.1, t / 2 + 0.006, trail(0.1) - 0.03], [S - 0.08, t / 2 + 0.006, trail(S - 0.08) - 0.03],
    [S - 0.08, t / 2 + 0.006, trail(S - 0.08) - 0.32], [0.1, t / 2 + 0.006, trail(0.1) - 0.42],
  );
  const stripeGeo = strip(0.22, lead(0.22) + 0.26, S - 0.14, lead(S - 0.14) + 0.2, 0.05, t / 2 + 0.012);
  const tipGeo = new THREE.BoxGeometry(0.09, 0.09, L * 0.3);
  const podX = S * 0.5, podZ = (lead(podX) + trail(podX)) / 2;
  const podGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.1, 10);
  const podGlowGeo = new THREE.CircleGeometry(0.2, 12);
  podGlowGeo.rotateX(Math.PI / 2);
  const wingletGeo = finPlate([[0.24 * L, 0], [0.46 * L, 0], [0.5 * L, 0.55], [0.38 * L, 0.55]], 0.05);

  // Aletas traseiras com luz no topo.
  const finGeo = finPlate([[0.22 * L, 0], [0.48 * L, 0], [0.54 * L, 0.85], [0.42 * L, 0.85]], 0.06);
  const finLightGeo = new THREE.BoxGeometry(0.08, 0.06, 0.12 * L);

  for (const side of [1, -1]) {
    const wing = add(wingGeo, hull, side * W * 0.12, 0.02, 0);
    wing.scale.x = side;
    wing.rotation.z = -side * 0.2;
    add(flapGeo, dark, 0, 0, 0, { parent: wing });
    add(stripeGeo, glow, 0, 0, 0, { parent: wing, outline: false });
    add(tipGeo, glow, S, 0.03, L * 0.33, { parent: wing, outline: false });
    add(podGeo, dark, podX, -t / 2 - 0.05, podZ, { parent: wing, outline: false });
    add(podGlowGeo, glow, podX, -t / 2 - 0.105, podZ, { parent: wing, outline: false });
    if (features.has('winglets')) {
      const winglet = add(wingletGeo, trim, S, 0.02, 0, { parent: wing });
      winglet.rotation.z = -0.25;
    }

    const fin = add(finGeo, hull, side * W * 0.2, 0.18, 0);
    fin.rotation.z = -side * 0.32;
    add(finLightGeo, hot, 0, 0.86, 0.48 * L, { parent: fin, outline: false });
  }

  // Motores: carenagem aberta, colar dianteiro, anel luminoso, bocal recuado e cone central.
  const enginePoints = [];
  const housing = new THREE.CylinderGeometry(ER, ER * 1.18, L * 0.24, 12, 1, true);
  housing.rotateX(Math.PI / 2);
  const collar = new THREE.TorusGeometry(ER * 1.16, ER * 0.14, 6, 16);
  const rim = new THREE.TorusGeometry(ER, ER * 0.1, 6, 16);
  const nozzle = new THREE.CircleGeometry(ER * 0.86, 14);
  const cone = new THREE.ConeGeometry(ER * 0.38, ER * 0.9, 8);
  cone.rotateX(Math.PI / 2);
  const back = L * 0.54;
  for (const ex of engines) {
    add(housing, dark, ex, 0.06, L * 0.42);
    add(collar, dark, ex, 0.06, L * 0.3 + 0.02, { outline: false });
    add(rim, nozzleMat, ex, 0.06, back);
    add(nozzle, nozzleMat, ex, 0.06, back - 0.06);
    add(cone, dark, ex, 0.06, back - 0.06 + ER * 0.45, { outline: false });
    enginePoints.push(new THREE.Vector3(ex, 0.06, L * 0.56));
  }

  bake(group);
  return { group, enginePoints, nozzleMat };
}
