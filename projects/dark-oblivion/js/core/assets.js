// =============================================================
// assets.js — fábrica de modelos 3D.
//
// Todo personagem, inimigo ou objeto é criado com createModel('id').
// O 'id' é procurado em data/models.js:
//   - se a entrada tiver `glb: 'assets/models/arquivo.glb'`, usamos o seu modelo;
//   - se `glb` for null (ou o arquivo falhar), montamos o placeholder com formas simples.
//
// CRIATURAS: um modelo com `creature` (juntas + peças) vira um bicho articulado,
// animado por código (core/creature.js). É o caso dos inimigos comuns.
// Um .glb sem esqueleto com `autoRig` (juntas medidas no modelo) ganha ossos na hora
// e é animado do mesmo jeito (o lobisomem feito no Blender).
//
// ANIMAÇÕES: se o seu .glb tiver animações (Actions do Blender) com nomes
// contendo "idle", "walk"/"run", "attack", "death"/"die", "roll" ou "spin",
// elas são tocadas automaticamente. Se não tiver, usamos pequenas animações
// "procedurais" (balançar, inclinar, cair) feitas por código.
//
// ACESSÓRIOS (attachments): um modelo pode carregar outros modelos presos
// a ele — ex.: o cajado na mão da bruxa e o chapéu na cabeça. Em models.js:
//   attachments: [{ model: 'witchStaff', bones: ['J_Bip_R_Hand', ...], pos, rot,
//                   bonePos, boneRot, boneScale, light }]
//   - com .glb: procura no esqueleto o primeiro osso cujo nome esteja em `bones`
//     e prende o acessório nele (bonePos/boneRot ajustam o encaixe na mão);
//   - sem .glb (ou sem esse osso): prende no corpo, em `pos`/`rot`.
//   - upright: true mantém o acessório em pé mesmo quando o braço balança.
//
// MODELOS DO VROID (.vrm): são glTF, então carregam como um .glb. Duas adaptações:
//   - os materiais deles são "sem luz" (estilo anime); trocamos por materiais
//     que reagem à luz, senão a personagem brilharia no escuro do Oblivion;
//   - eles não têm animações: com `rig: 'vrm'` em models.js, baixamos os braços
//     (pose em "T") e animamos braços e pernas pelos ossos (veja HumanoidRig).
//
// TOM DE PELE: model.setSkinTone(n) escurece os materiais de pele do .glb
// (nome contendo `skinMaterial`) ou as peças `skin: true` do placeholder.
// =============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODELS, SKIN_TONES } from '../data/models.js';
import { getStandardMaterial, getTexturedMaterial } from './materials.js';
import { buildCreature, CreatureRig, autoSkin } from './creature.js';

const loadedGltf = new Map();    // id -> resultado do GLTFLoader
const geometryCache = new Map(); // geometrias dos placeholders (reaproveitadas)

// Carrega todos os .glb definidos em data/models.js ANTES do jogo começar.
// Assim createModel() pode ser instantâneo depois.
export async function preloadModels(onProgress) {
  const loader = new GLTFLoader();
  const toLoad = Object.entries(MODELS).filter(([, def]) => def.glb);
  let done = 0;
  onProgress?.(0, toLoad.length);
  await Promise.all(toLoad.map(async ([id, def]) => {
    try {
      const gltf = await loader.loadAsync(def.glb);
      makeLit(gltf.scene);
      if (def.recolor) recolorModel(gltf.scene, def.recolor);
      if (def.materialOverrides) overrideMaterials(gltf.scene, def.materialOverrides);
      loadedGltf.set(id, gltf);
    } catch (err) {
      console.warn(`[assets] Não consegui carregar "${def.glb}" (modelo "${id}"). Usando o placeholder.`, err);
    }
    done++;
    onProgress?.(done, toLoad.length);
  }));
}

// TINGIR ROUPAS (recolor em models.js): pinta o tecido neutro (cinza/preto) com outra cor,
// mantendo as sombras e dobras da textura. Detalhes coloridos (dourado, vermelho) e partes
// claras (camisa, brilhos) ficam como estão.
//   recolor: { materials: ['CLOTH'], color: 0x4a2c1a, ref: 0.3 }
//   - materials: pedaços do nome dos materiais a tingir
//   - color: a cor desejada; ref: quanto maior, mais escuro fica o resultado
function recolorModel(root, rc) {
  const done = new Map(); // textura original -> textura tingida (cada textura é processada uma vez)
  const keys = rc.materials.map((k) => k.toLowerCase());
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!m?.map || !keys.some((k) => (m.name ?? '').toLowerCase().includes(k))) return;
    if (!done.has(m.map)) done.set(m.map, recolorTexture(m.map, rc));
    m.map = done.get(m.map);
  });
}

function recolorTexture(texture, rc) {
  const img = texture.image;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const tr = ((rc.color >> 16) & 255) / 255, tg = ((rc.color >> 8) & 255) / 255, tb = (rc.color & 255) / 255;
  const ref = rc.ref ?? 0.3;
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // peso do tingimento: só tecido neutro (pouca saturação) e escuro
    const w = (1 - smooth(0.18, 0.3, sat)) * (1 - smooth(0.4, 0.6, lum));
    if (w <= 0) continue;
    const k = lum / ref;
    px[i] = 255 * (Math.min(1, tr * k) * w + r * (1 - w));
    px[i + 1] = 255 * (Math.min(1, tg * k) * w + g * (1 - w));
    px[i + 2] = 255 * (Math.min(1, tb * k) * w + b * (1 - w));
  }
  ctx.putImageData(data, 0, 0);
  const out = texture.clone(); // mantém flipY, espaço de cor, repetição...
  out.image = canvas;
  out.needsUpdate = true;
  return out;
}

// Corrige materiais que não vieram certos do Blender (ex.: texturas procedurais, que o
// exportador glTF não leva). materialOverrides: { 'NomeDoMaterial': { color, metalness, roughness, emissive } }
function overrideMaterials(root, overrides) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const ov = overrides[m.name];
      if (!ov) continue;
      if (ov.color !== undefined) m.color.setHex(ov.color);
      if (ov.emissive !== undefined) m.emissive.setHex(ov.emissive);
      for (const key of ['metalness', 'roughness', 'emissiveIntensity']) if (ov[key] !== undefined) m[key] = ov[key];
    }
  });
}

// Troca materiais "sem luz" (MeshBasicMaterial, usados pelo VRoid) por materiais que
// reagem à luz, mantendo textura, transparência e recorte.
function makeLit(root) {
  const converted = new Map();
  const convert = (m) => {
    if (!m.isMeshBasicMaterial) return m;
    if (!converted.has(m)) {
      converted.set(m, new THREE.MeshStandardMaterial({
        name: m.name, map: m.map, color: m.color, transparent: m.transparent, opacity: m.opacity,
        alphaTest: m.alphaTest, side: m.side, depthWrite: m.depthWrite, roughness: 0.85, metalness: 0,
      }));
    }
    return converted.get(m);
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) o.frustumCulled = false; // a caixa de corte de malhas com esqueleto costuma vir errada
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
  });
}

// ---------- placeholders (formas primitivas) ----------
const GEOMETRY_KEYS = ['shape', 'radius', 'length', 'height', 'size', 'radiusTop', 'radiusBottom', 'tube', 'arc', 'arcStart', 'open', 'segments', 'tex', 'texScale'];

// Tamanho (em metros) de uma repetição de cada textura numa peça. `texScale` na peça muda isso.
const TEX_TILE = { stone: 1.4, plaster: 2.0, wood: 1.2, thatch: 0.9, grass: 3, dirt: 3, dungeonWall: 2, dungeonFloor: 2, caveRock: 2, caveFloor: 2 };

// Ajusta as coordenadas de textura (UV) ao tamanho real da peça, para a textura
// ter o mesmo tamanho em qualquer peça (sem esticar numa parede comprida).
function scaleUVs(geo, part) {
  const tile = part.texScale ?? TEX_TILE[part.tex] ?? 1;
  const uv = geo.attributes.uv;
  if (part.shape === 'box') {
    const [w, h, d] = part.size ?? [1, 1, 1];
    // As 6 faces da caixa, 4 vértices cada: +x, −x, +y, −y, +z, −z
    const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) {
      const [fu, fv] = faceSize[Math.floor(i / 4)] ?? [1, 1];
      uv.setXY(i, uv.getX(i) * fu / tile, uv.getY(i) * fv / tile);
    }
  } else {
    // Cilindro/cone: U dá a volta (circunferência), V sobe (altura); outras formas: aproximação
    const r = Math.max(part.radiusTop ?? part.radius ?? 0.5, part.radiusBottom ?? part.radius ?? 0.5);
    const su = (2 * Math.PI * r) / tile;
    const sv = (part.height ?? part.length ?? r * 2) / tile;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

function getGeometry(part) {
  // A "chave" junta todos os parâmetros da forma: formas iguais reaproveitam a geometria
  const key = GEOMETRY_KEYS.map((k) => JSON.stringify(part[k] ?? null)).join('|');
  let geo = geometryCache.get(key);
  if (geo) return geo;

  const seg = part.segments;
  switch (part.shape) {
    case 'capsule': geo = new THREE.CapsuleGeometry(part.radius, part.length ?? 0.5, 4, seg ?? 10); break;
    case 'box': geo = new THREE.BoxGeometry(...(part.size ?? [1, 1, 1])); break;
    // Cilindro: `open: true` tira as tampas; `arc`/`arcStart` fazem só um pedaço da volta
    // (ângulo 0 = frente, +Z; cresce para +X) — bom para placas de armadura curvas
    case 'cylinder': geo = new THREE.CylinderGeometry(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius, part.height ?? 1, seg ?? 12,
      1, part.open ?? false, part.arcStart ?? 0, part.arc ?? Math.PI * 2); break;
    case 'cone': geo = new THREE.ConeGeometry(part.radius, part.height ?? 1, seg ?? 12); break;
    case 'sphere': geo = new THREE.SphereGeometry(part.radius, seg ?? 14, 10); break;
    case 'torus': geo = new THREE.TorusGeometry(part.radius, part.tube ?? 0.1, 8, seg ?? 28, part.arc ?? Math.PI * 2); break;
    case 'octahedron': geo = new THREE.OctahedronGeometry(part.radius); break;
    default:
      console.warn(`[assets] Forma desconhecida: ${part.shape}`);
      geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }
  if (part.tex) scaleUVs(geo, part);
  geometryCache.set(key, geo);
  return geo;
}

// Material de uma peça do placeholder (cache: peças iguais usam o MESMO material)
function partMaterial(part) {
  const matOptions = { ...(part.mat ?? {}) };
  if (part.emissive !== undefined) {
    matOptions.emissive = part.emissive;
    matOptions.emissiveIntensity = part.emissiveIntensity ?? 1;
  }
  // tex: 'stone' | 'plaster' | 'wood' | 'thatch' → textura gerada por código (core/textures.js)
  const material = part.tex
    ? getTexturedMaterial(part.tex, part.color ?? 0xffffff, matOptions)
    : getStandardMaterial(part.color ?? 0xffffff, matOptions);
  return { material, matOptions };
}

// Peças com o mesmo material viram UMA malha só (geometrias juntadas, em cache por modelo).
// Uma corrente de 12 elos custa 1 desenho para a placa de vídeo em vez de 12.
// Peças de pele (skin) ficam separadas, porque trocam de material com o tom de pele.
const mergedCache = new WeakMap(); // lista de peças → [{ geometry, material, castShadow }]
const _partMatrix = new THREE.Matrix4();
const _partEuler = new THREE.Euler();
const _partQuat = new THREE.Quaternion();
const _partPos = new THREE.Vector3();
const _partScale = new THREE.Vector3();

function mergedParts(parts) {
  let merged = mergedCache.get(parts);
  if (merged) return merged;
  const buckets = new Map(); // material + sombra → geometrias já posicionadas
  for (const part of parts) {
    if (part.skin) continue;
    const { material } = partMaterial(part);
    const castShadow = part.castShadow ?? true;
    const key = material.uuid + (castShadow ? '|s' : '');
    if (!buckets.has(key)) buckets.set(key, { material, castShadow, geometries: [] });
    _partMatrix.compose(
      _partPos.fromArray(part.pos ?? [0, 0, 0]),
      _partQuat.setFromEuler(_partEuler.set(...(part.rot ?? [0, 0, 0]))),
      _partScale.fromArray(part.scale ?? [1, 1, 1]));
    const g = getGeometry(part);
    buckets.get(key).geometries.push((g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(_partMatrix));
  }
  merged = [...buckets.values()].map((b) => ({ geometry: mergeGeometries(b.geometries), material: b.material, castShadow: b.castShadow }));
  for (const b of buckets.values()) for (const g of b.geometries) g.dispose();
  mergedCache.set(parts, merged);
  return merged;
}

function buildPlaceholder(def) {
  const group = new THREE.Group();
  const parts = def.placeholder?.parts ?? [];
  for (const { geometry, material, castShadow } of mergedParts(parts)) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const part of parts) {
    if (!part.skin) continue;
    const { material, matOptions } = partMaterial(part);
    const mesh = new THREE.Mesh(getGeometry(part), material);
    if (part.pos) mesh.position.fromArray(part.pos);
    if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
    if (part.scale) mesh.scale.fromArray(part.scale);
    mesh.castShadow = part.castShadow ?? true;
    mesh.receiveShadow = true;
    mesh.userData.skin = { color: part.color ?? 0xffffff, matOptions }; // muda com o tom de pele
    group.add(mesh);
  }
  return group;
}

// Visual "parado" de um modelo (sem animação própria): o .glb dele, se houver, ou o placeholder.
// Usado pelos acessórios.
function buildStaticVisual(id) {
  const def = MODELS[id];
  if (!def) throw new Error(`Acessório "${id}" não existe em data/models.js`);
  const group = new THREE.Group();
  group.scale.setScalar(def.scale ?? 1);
  group.rotation.y = def.rotationY ?? 0;
  const gltf = loadedGltf.get(id);
  if (gltf) {
    const obj = gltf.scene.clone(true);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(obj);
  } else {
    group.add(buildPlaceholder(def));
  }
  return group;
}

// Procura um osso pelo nome (ignorando maiúsculas e prefixos como "Armature|").
// `names` vem em ordem de preferência: o primeiro nome encontrado ganha.
function findBone(root, names) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  for (const name of names) {
    const wanted = name.toLowerCase();
    const bone = bones.find((b) => b.name.toLowerCase() === wanted || b.name.toLowerCase().endsWith(`|${wanted}`) || b.name.toLowerCase().endsWith(`:${wanted}`));
    if (bone) return bone;
  }
  return null;
}

// Nomes que procuramos dentro das animações do .glb para cada estado
const ANIM_ALIASES = {
  idle: ['idle'],
  walk: ['walk', 'run'],
  attack: ['attack', 'slash', 'shoot', 'cast'],
  spin: ['spin', 'whirl'],
  roll: ['roll', 'dodge'],
  channel: ['channel', 'cast'],
  charge: ['charge', 'run'],
  death: ['death', 'die', 'dead'],
};

// Uma "instância" de modelo no mundo. Estrutura:
//   root   → posição e direção no mundo (os pés ficam em y = 0)
//   body   → usado pelas animações procedurais (balançar, cair...)
//   visual → escala/rotação de correção definidas em models.js
export class ModelInstance {
  constructor(id) {
    const def = MODELS[id];
    if (!def) throw new Error(`Modelo "${id}" não existe em data/models.js`);
    this.id = id;
    this.def = def;
    this.root = new THREE.Group();
    this.root.name = id;
    this.body = new THREE.Group();
    this.root.add(this.body);
    const visual = new THREE.Group();
    visual.scale.setScalar(def.scale ?? 1);
    visual.rotation.y = def.rotationY ?? 0;
    this.body.add(visual);

    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.usingClip = false;
    this.state = '';
    this.stateTime = 0;

    const gltf = loadedGltf.get(id);
    let skeletonRoot = null;
    if (gltf) {
      // SkeletonUtils.clone copia corretamente modelos com esqueleto (personagens animados)
      const obj = SkeletonUtils.clone(gltf.scene);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      visual.add(obj);
      skeletonRoot = obj;
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(obj);
        for (const clip of gltf.animations) this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
      }
    } else if (def.creature) {
      // Criatura articulada feita de formas simples (core/creature.js): juntas animadas por código
      const c = buildCreature(id, def, getGeometry);
      visual.add(c.mesh);
      this.creature = new CreatureRig(c.bones, def.creature.anim);
    } else {
      visual.add(buildPlaceholder(def));
    }
    // Duração do ataque e momento do golpe (o Enemy ajusta pelo attackWindup do inimigo)
    this.attackLength = 0.32;
    this.attackWindup = 0.15;

    // Esqueleto humanoide sem animações (VRoid): pose e movimentos feitos por código
    // walk: 'feminine' | 'masculine'  —  hold: 'staff' (cajado na direita) | 'bow' (arco na esquerda)
    //                                     | 'sword' (espada na direita, escudo no braço esquerdo)
    //                                     | 'tool' (ferramenta na direita, braços relaxados: o ferreiro)
    this.rig = gltf && !this.mixer && def.rig === 'vrm'
      ? new HumanoidRig(skeletonRoot, { walk: def.walk ?? 'feminine', hold: def.hold ?? 'staff' })
      : null;

    // .glb "estátua" (sem ossos nem animações) com autoRig: o esqueleto é montado aqui e a
    // CreatureRig anima, como os inimigos articulados (veja autoSkin em core/creature.js)
    if (gltf && !this.mixer && def.autoRig) {
      const { bones } = autoSkin(id, skeletonRoot, def.autoRig);
      this.creature = new CreatureRig(bones, def.autoRig.anim);
    }

    // Acessórios (cajado, chapéu...): no osso certo do .glb, ou no corpo do placeholder
    this.attachments = [];
    this.root.updateMatrixWorld(true); // posições dos ossos na pose original (para modelSpace)
    for (const att of def.attachments ?? []) {
      if (att.enabled === false) continue;
      if (att.onlyPlaceholder && gltf) continue; // ex.: o chapéu, quando o .glb já tem o dele
      if (att.onlyGlb && !gltf) continue;        // ex.: o arco, quando o placeholder já tem o dele
      const part = new THREE.Group();
      // `parts` direto no acessório (peças de armadura) ou um modelo de models.js
      part.add(att.parts ? buildPlaceholder({ placeholder: { parts: att.parts } }) : buildStaticVisual(att.model));
      const bone = skeletonRoot ? findBone(skeletonRoot, att.bones ?? []) : null;
      if (bone && att.modelSpace) {
        // Peça desenhada nas coordenadas do MODELO (pose em "T", pés em y = 0), com
        // modelPos/modelRot. Convertemos para o espaço do osso: assim ela fica no lugar
        // certo sem precisar saber como cada osso está girado.
        bone.add(part);
        _boneToModel.copy(visual.matrixWorld).invert().multiply(bone.matrixWorld).invert();
        _pieceMatrix.compose(_piecePos.fromArray(att.modelPos ?? [0, 0, 0]),
          _pieceQuat.setFromEuler(_pieceEuler.fromArray([...(att.modelRot ?? [0, 0, 0]), 'XYZ'])), _pieceScale.set(1, 1, 1));
        _boneToModel.multiply(_pieceMatrix).decompose(part.position, part.quaternion, part.scale);
      } else if (bone) {
        bone.add(part);
        if (att.bonePos) part.position.fromArray(att.bonePos);
        if (att.boneRot) part.rotation.set(att.boneRot[0], att.boneRot[1], att.boneRot[2]);
        part.scale.setScalar(att.boneScale ?? 1);
      } else if (att.modelSpace) {
        visual.add(part);
        if (att.modelPos) part.position.fromArray(att.modelPos);
        if (att.modelRot) part.rotation.set(att.modelRot[0], att.modelRot[1], att.modelRot[2]);
      } else {
        visual.add(part);
        if (att.pos) part.position.fromArray(att.pos);
        if (att.rot) part.rotation.set(att.rot[0], att.rot[1], att.rot[2]);
      }
      if (att.light) { // ex.: brilho da esfera do cajado
        const light = new THREE.PointLight(att.light.color, att.light.intensity ?? 3, att.light.distance ?? 4, 1.5);
        light.position.fromArray(att.light.pos ?? [0, 0, 0]);
        part.add(light);
      }
      this.attachments.push({ model: att.model, object: part, bone: bone ?? null, upright: !!(att.upright && bone), equip: att.equip ?? null });
      // Arco: corda que a mão puxa e flecha encaixada (precisa do esqueleto para achar a mão)
      if (att.bowString && bone) {
        const hand = findBone(skeletonRoot, att.bowString.handBones ?? []);
        if (hand) this.bowString = new BowString(part, hand, att.bowString);
      }
    }

    this.skinTone = 0;
    this.play('idle');
  }

  // Tom de pele: 0 = original (mais claro) ... SKIN_TONES.length - 1 = mais escuro.
  // Os materiais de pele são copiados para esta instância antes de mudar a cor,
  // para não escurecer outros personagens que usem o mesmo modelo.
  setSkinTone(index) {
    const tone = SKIN_TONES[index] ?? SKIN_TONES[0];
    this.skinTone = SKIN_TONES[index] ? index : 0;
    const tint = new THREE.Color(tone.tint);
    const match = (this.def.skinMaterial ?? 'SKIN').toLowerCase();
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.skin) { // peça do placeholder
        const base = new THREE.Color(o.userData.skin.color).multiply(tint);
        o.material = getStandardMaterial(base.getHex(), o.userData.skin.matOptions);
        return;
      }
      if (!(o.material?.name ?? '').toLowerCase().includes(match)) return;
      if (!o.userData.skinBase) { // primeira vez: copia o material e guarda a cor original
        o.material = o.material.clone();
        o.userData.skinBase = o.material.color.clone();
      }
      o.material.color.copy(o.userData.skinBase).multiply(tint);
    });
  }

  // Acessórios que dependem do equipamento (attachment.equip = { slot, bases }):
  // só aparecem se houver um item naquele slot cuja base esteja na lista
  // (sem `bases`: qualquer item). Ex.: o broquel só aparece com o broquel equipado.
  setEquipment(equipment) {
    for (const a of this.attachments) {
      if (!a.equip) continue;
      const item = equipment?.[a.equip.slot];
      a.object.visible = !!item && (!a.equip.bases || a.equip.bases.includes(item.baseId));
    }
  }

  findAction(state) {
    if (!this.mixer) return null;
    for (const alias of ANIM_ALIASES[state] ?? [state]) {
      for (const [name, action] of Object.entries(this.actions)) {
        if (name.includes(alias)) return action;
      }
    }
    return null;
  }

  // Troca o estado de animação. once = true toca uma vez só (ataque, morte)
  play(state, { once = false } = {}) {
    if (this.state === state && !once) return;
    this.state = state;
    this.stateTime = 0;
    const action = this.findAction(state);
    this.usingClip = !!action;
    if (action) {
      action.reset();
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = once;
      action.fadeIn(0.12).play();
      if (this.currentAction && this.currentAction !== action) this.currentAction.fadeOut(0.12);
      this.currentAction = action;
    } else if (this.currentAction) {
      this.currentAction.fadeOut(0.12);
      this.currentAction = null;
    }
  }

  // true enquanto uma animação "de ação" ainda não terminou (não deve ser interrompida)
  // Criatura articulada levou um golpe: tremidinha para trás
  flinch() { this.creature?.flinch(); }

  isBusy() {
    return (this.state === 'attack' && this.stateTime < this.attackLength) ||
           (this.state === 'spin' && this.stateTime < 0.45) ||
           (this.state === 'roll' && this.stateTime < 0.3) ||
           (this.state === 'release' && this.stateTime < 0.25);
  }

  update(dt) {
    this.stateTime += dt;
    if (this.mixer) this.mixer.update(dt);

    const b = this.body;
    b.position.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    if (this.usingClip) return; // o .glb tem a animação: não mexemos

    // Animações procedurais simples para os placeholders
    const t = this.stateTime;
    switch (this.state) {
      case 'idle':
        b.position.y = Math.sin(t * 2.2) * 0.025; // "respiração"
        break;
      case 'walk': {
        // passinhos. Com esqueleto, a altura do corpo vem do "pé no chão" do HumanoidRig.
        // Com esqueleto, o quadril já balança sozinho (HumanoidRig), então o corpo não inclina de lado.
        // Criaturas articuladas também: as pernas e o quadril é que fazem o movimento
        const jointed = this.rig || this.creature;
        b.position.y = jointed ? 0 : Math.abs(Math.sin(t * 9)) * 0.09;
        b.rotation.x = this.creature ? 0 : this.rig ? 0.03 : 0.08;
        b.rotation.z = jointed ? 0 : Math.sin(t * 9) * 0.04;
        break;
      }
      case 'attack': {
        if (this.creature) break; // os braços da criatura fazem o golpe
        const s = Math.sin(Math.min(t / 0.3, 1) * Math.PI); // vai e volta
        b.position.z = s * 0.25;
        b.rotation.x = s * 0.3;
        break;
      }
      case 'spin':
        b.rotation.y = Math.min(t / 0.45, 1) * Math.PI * 4; // duas voltas
        break;
      case 'roll': {
        const p = Math.min(t / 0.3, 1);
        b.rotation.x = p * Math.PI * 2;
        b.position.y = Math.sin(p * Math.PI) * 0.6;
        break;
      }
      case 'channel': // canalizando / carregando: inclinado e tremendo
        b.rotation.x = 0.14;
        b.position.y = Math.sin(t * 30) * 0.012;
        b.position.x = Math.sin(t * 23) * 0.012;
        break;
      case 'charge': // investida: corpo bem inclinado para frente
        b.rotation.x = 0.4;
        b.position.y = Math.abs(Math.sin(t * 20)) * 0.08;
        break;
      case 'death': {
        const p = Math.min(t / 0.45, 1);
        b.rotation.x = -p * Math.PI / 2; // cai de costas
        b.position.y = p * 0.15;
        // o corpo cai "para a frente" da metade da altura: assim ele fica deitado onde estava em pé
        // (sem isso, um chefe de 3 m cairia do outro lado da parede)
        b.position.z = p * (this.def.height ?? 1.8) * 0.45;
        break;
      }
    }

    this.creature?.update(this.state, t, dt, { attackLength: this.attackLength, windup: this.attackWindup, root: this.root });

    if (this.rig) {
      b.position.y += this.rig.update(this.state, t) * (this.def.scale ?? 1); // pés no chão
      b.position.x += this.rig.swayX * (this.def.scale ?? 1);                // peso de um lado para o outro
    }

    // Acessórios "em pé" (cajado): desfaz a rotação do osso, mantendo só a direção do personagem
    for (const a of this.attachments) {
      if (!a.upright) continue;
      a.bone.getWorldQuaternion(_boneQuat).invert();
      this.root.getWorldQuaternion(_rootQuat);
      a.object.quaternion.multiplyQuaternions(_boneQuat, _rootQuat);
    }

    if (this.bowString) {
      this.root.updateMatrixWorld(true); // posições finais do arco e da mão neste quadro
      this.bowString.update(this.rig?.drawAmount ?? 0, this.rig?.arrowVisible ?? false);
    }
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    // As geometrias/materiais são compartilhados (cache), então não os destruímos aqui.
  }
}

const _boneQuat = new THREE.Quaternion();
const _rootQuat = new THREE.Quaternion();
const _boneToModel = new THREE.Matrix4();
const _pieceMatrix = new THREE.Matrix4();
const _piecePos = new THREE.Vector3();
const _pieceQuat = new THREE.Quaternion();
const _pieceEuler = new THREE.Euler();
const _pieceScale = new THREE.Vector3();

// ======================= CORDA DO ARCO =======================
// A corda são dois pedaços: ponta de cima → encaixe e encaixe → ponta de baixo.
// Parada, o encaixe fica no meio (corda reta). Puxando (draw de 0 a 1), o encaixe
// vai até a mão direita, e a corda forma um "V". A flecha fica no encaixe,
// apontando para a empunhadura. Tudo no espaço do arco (origem = empunhadura).
const STRING_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 4); // esticado entre dois pontos
const _yAxis = new THREE.Vector3(0, 1, 0);

class BowString {
  constructor(bow, hand, cfg) {
    this.bow = bow;
    this.hand = hand;
    this.top = new THREE.Vector3().fromArray(cfg.top);
    this.bottom = new THREE.Vector3().fromArray(cfg.bottom);
    this.rest = this.top.clone().add(this.bottom).multiplyScalar(0.5);
    const material = getStandardMaterial(cfg.color ?? 0xe8e0c8, { roughness: 0.6 });
    this.upper = new THREE.Mesh(STRING_GEOMETRY, material);
    this.lower = new THREE.Mesh(STRING_GEOMETRY, material);
    bow.add(this.upper, this.lower);
    this.arrow = cfg.arrow ? buildStaticVisual(cfg.arrow) : null;
    if (this.arrow) { this.arrow.visible = false; bow.add(this.arrow); }
    this._nock = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._aim = new THREE.Vector3(0, 0.03, 0.06); // onde a flecha se apoia (logo acima da empunhadura)
  }

  // Estica um pedaço de corda entre a e b
  stretch(mesh, a, b) {
    this._dir.subVectors(b, a);
    const length = this._dir.length();
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(_yAxis, this._dir.divideScalar(length || 1));
    mesh.scale.set(0.004, length, 0.004);
  }

  update(draw, showArrow) {
    // Encaixe: entre o meio da corda (parada) e a mão direita (puxando), sempre no plano do arco
    this.hand.getWorldPosition(this._hand);
    this.bow.worldToLocal(this._hand);
    const pullZ = Math.min(this.rest.z, Math.max(-0.95, this._hand.z)); // atrás da corda, no máximo 95 cm
    const pullY = Math.max(-0.12, Math.min(0.12, this._hand.y));
    this._nock.set(0, this.rest.y + (pullY - this.rest.y) * draw, this.rest.z + (pullZ - this.rest.z) * draw);
    this.stretch(this.upper, this.top, this._nock);
    this.stretch(this.lower, this._nock, this.bottom);

    if (!this.arrow) return;
    this.arrow.visible = showArrow && draw > 0.05;
    if (this.arrow.visible) {
      this.arrow.position.copy(this._nock);
      this.arrow.lookAt(this._dir.copy(this._aim).applyMatrix4(this.bow.matrixWorld)); // aponta para o apoio
    }
  }
}

// ======================= ESQUELETO HUMANOIDE (VRoid) =======================
// Modelos do VRoid vêm em pose de "T" e sem animações. Aqui giramos alguns ossos
// a cada quadro: braços para baixo, pernas e braços balançando ao andar, braço do
// cajado erguido ao atacar etc.
//
// Os ossos de um VRM ficam alinhados com o mundo na pose de "T" (personagem
// olhando para +Z, esquerda = +X). Por isso os eixos abaixo são simples:
//   braço: girar em Z abaixa/levanta; girar em X leva para frente (−) ou para trás (+)
//   antebraço: girar em Y dobra o cotovelo para frente
//   perna: girar em X leva para frente (−); joelho: X (+) dobra para trás
const RIG_BONES = {
  hips: ['J_Bip_C_Hips'],
  spine: ['J_Bip_C_Spine'],
  upperArmL: ['J_Bip_L_UpperArm'], upperArmR: ['J_Bip_R_UpperArm'],
  lowerArmL: ['J_Bip_L_LowerArm'], lowerArmR: ['J_Bip_R_LowerArm'],
  upperLegL: ['J_Bip_L_UpperLeg'], upperLegR: ['J_Bip_R_UpperLeg'],
  lowerLegL: ['J_Bip_L_LowerLeg'], lowerLegR: ['J_Bip_R_LowerLeg'],
  footL: ['J_Bip_L_Foot'], footR: ['J_Bip_R_Foot'],
};

// Estados em que os pés devem ficar apoiados no chão (no rolamento e na morte o corpo todo gira)
const PLANT_FEET_STATES = new Set(['idle', 'walk', 'attack', 'channel', 'release', 'charge', 'spin']);

// Segundos entre começar o ataque com arco e a flecha sair (a corda é puxada nesse tempo)
export const BOW_RELEASE = 0.12;

const lerp = (a, b, k) => a + (b - a) * k;

class HumanoidRig {
  // style = { walk: 'feminine' | 'masculine', hold: 'staff' | 'bow' | 'sword' | 'tool' }
  // ('tool' = ferramenta na mão direita, como o martelo do ferreiro: usa a pose do cajado)
  constructor(root, style = {}) {
    this.root = root;
    this.style = { walk: 'feminine', hold: 'staff', ...style };
    this.bones = {};
    this.rest = {};
    for (const [key, names] of Object.entries(RIG_BONES)) {
      const bone = findBone(root, names);
      if (!bone) continue;
      this.bones[key] = bone;
      this.rest[key] = bone.quaternion.clone(); // rotação original (pose em "T")
    }
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    // Altura dos tornozelos com as pernas retas: é onde os pés "encostam no chão"
    this.restFootY = this.lowestFootY();
  }

  // Altura (no espaço do modelo) do pé mais baixo, com a pose atual
  lowestFootY() {
    const { footL, footR } = this.bones;
    if (!footL || !footR) return null;
    this.root.updateMatrixWorld(true);
    const yL = this.root.worldToLocal(footL.getWorldPosition(this._v)).y;
    const yR = this.root.worldToLocal(footR.getWorldPosition(this._v)).y;
    return Math.min(yL, yR);
  }

  // Quanto o corpo precisa descer (ou subir) para o pé mais baixo encostar no chão.
  // Joelho dobrado "encurta" a perna (ficaria flutuando); o quadril inclinado
  // "alonga" um lado (o pé afundaria no chão).
  plantFeet() {
    if (this.restFootY === null) return 0;
    return this.restFootY - this.lowestFootY();
  }

  // rest * rotação extra. A ordem 'XYZ' aplica Z primeiro (abaixar o braço) e X depois (balançar).
  set(key, x = 0, y = 0, z = 0) {
    const bone = this.bones[key];
    if (!bone) return;
    this._q.setFromEuler(this._e.set(x, y, z, 'XYZ'));
    bone.quaternion.copy(this.rest[key]).multiply(this._q);
  }

  update(state, t) {
    const { walk, hold } = this.style;
    const bow = hold === 'bow';
    const sword = hold === 'sword';
    // Valores da pose parada; cada estado muda alguns deles
    const breath = Math.sin(t * 2.2) * 0.03;
    let armDownL = 1.2 + breath, armDownR = 1.2 + breath; // braços quase colados ao corpo
    let swingL = 0, swingR = 0;                      // braços para frente (−) / trás (+)
    let yawL = 0, yawR = 0;                          // braço girando para frente na horizontal (arco)
    // A mão que segura a arma fica mais dobrada: cajado na direita, arco na esquerda
    let elbowL = bow ? 0.45 : 0.25, elbowR = bow ? 0.25 : 0.55;
    if (sword) {
      // Espada e escudo: espada baixa à frente; antebraço do escudo dobrado na frente do corpo
      armDownR = 1.2 + breath; swingR = -0.3; elbowR = 0.8;
      // (antebraço do escudo atravessado na frente do peito, paralelo à placa: a mão fica atrás dela)
      armDownL = 1.4 + breath; swingL = -0.7; yawL = -1.4; elbowL = 1.2;
    }
    let legL = 0, legR = 0, kneeL = 0, kneeR = 0, spine = 0;
    let crossL = 0, crossR = 0;                      // pernas para dentro (pés perto da linha do centro)
    let hipYaw = 0, hipRoll = 0, spineYaw = 0, spineRoll = 0;
    this.swayX = 0;                                  // deslocamento lateral do corpo (peso)
    this.drawAmount = 0;                             // corda do arco: 0 solta ... 1 toda puxada
    this.arrowVisible = false;                       // flecha encaixada aparecendo no arco

    // Arqueiro puxando a corda (k = 0 parado ... 1 corda toda puxada):
    // braço esquerdo esticado à frente segurando o arco; mão direita puxa a corda até o rosto.
    const drawBow = (k) => {
      armDownL = lerp(armDownL, 0.08, k); yawL = -1.45 * k; elbowL = lerp(elbowL, 0.05, k);
      armDownR = lerp(armDownR, 0.05, k); yawR = 0.45 * k; elbowR = lerp(elbowR, 2.6, k); // mão perto do rosto
      spineYaw = -0.15 * k;
    };

    switch (state) {
      case 'walk': {
        // s = fase do passo; c = "velocidade" da perna. Perna para frente quando o valor é negativo.
        // Joelho de cada perna = um pouco sempre
        //   + dobra da perna da FRENTE ao pisar (s > 0 na esquerda, s < 0 na direita)
        //   + dobra leve da perna que PASSA por baixo do corpo (cos), só para o pé não arrastar.
        // O "pé no chão" (plantFeet) desce o corpo para nenhum pé flutuar.
        const s = Math.sin(t * 9), c = Math.cos(t * 9);
        if (walk === 'feminine') {
          // Caminhar feminino clássico: quadril balançando, pés perto do centro, braços curtos
          legL = -0.38 * s; legR = 0.38 * s;
          kneeL = 0.06 + Math.max(0, s) * 0.32 + Math.max(0, c) * 0.24;
          kneeR = 0.06 + Math.max(0, -s) * 0.32 + Math.max(0, -c) * 0.24;
          // Pés pisando perto do centro, quase cruzando (mais ainda quando a perna vai à frente)
          crossL = -(0.015 + Math.max(0, s) * 0.035);
          crossR = 0.015 + Math.max(0, -s) * 0.035;
          // Quadril: o lado da perna que avança gira para frente; o lado da perna de apoio sobe
          hipYaw = -0.12 * s; hipRoll = -0.07 * c;
          // Tronco faz o contrário, para os ombros e a cabeça ficarem estáveis
          spineYaw = 0.1 * s; spineRoll = 0.06 * c;
          this.swayX = -0.025 * c;                   // peso do corpo sobre a perna de apoio
          armDownL = armDownR = 1.28;
          swingL = 0.25 * s; swingR = -0.25 * s;
          spine = 0.03;
        } else {
          // Caminhar masculino: passo firme, pés afastados, quadril quase parado,
          // ombros girando mais e braços balançando mais
          legL = -0.4 * s; legR = 0.4 * s;
          kneeL = 0.06 + Math.max(0, s) * 0.28 + Math.max(0, c) * 0.26;
          kneeR = 0.06 + Math.max(0, -s) * 0.28 + Math.max(0, -c) * 0.26;
          crossL = 0.02; crossR = -0.02;             // pés um pouco para fora
          hipYaw = -0.06 * s; hipRoll = -0.025 * c;
          spineYaw = 0.09 * s; spineRoll = 0.02 * c;
          this.swayX = -0.012 * c;
          armDownL = armDownR = 1.18;
          swingL = 0.38 * s; swingR = -0.38 * s;
          spine = 0.05;
        }
        // O braço que segura a arma balança bem menos
        if (sword) {
          // Espada balança pouco; o escudo fica firme na frente do corpo
          swingR = -0.3 + swingR * 0.35; elbowR = 0.8;
          swingL = -0.7 + swingL * 0.1; yawL = -1.4; elbowL = 1.2; armDownL = 1.4;
        } else if (bow) swingL *= 0.45; else swingR *= 0.4;
        if (bow) elbowR = 0.3 + Math.max(0, s) * 0.2; else if (!sword) elbowL = 0.35 + Math.max(0, -s) * 0.15;
        break;
      }
      case 'attack': {
        const k = Math.sin(Math.min(t / 0.3, 1) * Math.PI); // vai e volta
        if (sword) {
          // Golpe de cima para baixo: ergue a espada (até 35% do tempo), desce cortando
          // (até 75%) e volta à guarda. O tronco acompanha o corte.
          const p = Math.min(t / 0.3, 1);
          const up = p < 0.35 ? Math.sin((p / 0.35) * Math.PI / 2) : p < 0.75 ? 1 - (p - 0.35) / 0.4 : 0;
          const cut = p < 0.35 ? 0 : p < 0.75 ? Math.sin(((p - 0.35) / 0.4) * Math.PI / 2) : 1 - (p - 0.75) / 0.25;
          swingR = lerp(lerp(-0.3, -2.3, up), -0.7, cut);
          armDownR = lerp(1.2, 0.85, up);
          elbowR = lerp(lerp(0.8, 1.7, up), 0.15, cut);
          spine = 0.08 * cut; spineYaw = 0.2 * up - 0.25 * cut;
        } else if (bow) {
          // Puxa a corda até BOW_RELEASE (é quando a flecha sai — veja Player.fireDelay)
          // e solta: a corda volta rápido, a mão continua perto do rosto
          drawBow(k);
          this.drawAmount = t < BOW_RELEASE ? Math.sin((t / BOW_RELEASE) * Math.PI / 2) : Math.max(0, 1 - (t - BOW_RELEASE) / 0.04);
          this.arrowVisible = t < BOW_RELEASE;
        } else { // ergue o cajado para frente e volta
          swingR = -1.3 * k; elbowR = 0.55 - 0.4 * k;
          swingL = 0.2 * k; spine = 0.12 * k;
        }
        break;
      }
      case 'channel':
        if (bow) { // Tiro Concentrado: corda puxada com a flecha, tremendo de leve com o esforço
          drawBow(Math.min(1, t / 0.25));
          armDownR += Math.sin(t * 30) * 0.015;
          this.drawAmount = Math.min(1, t / 0.25);
          this.arrowVisible = true;
        } else { // canalizando: os dois braços estendidos à frente
          swingL = -1.1; swingR = -1.0; elbowL = 0.15; elbowR = 0.3;
          armDownL = armDownR = 1.1 + Math.sin(t * 30) * 0.02; spine = 0.1;
        }
        break;
      case 'release': // acabou de soltar a corda (Tiro Concentrado): braços voltam devagar
        if (bow) drawBow(Math.max(0, 1 - t / 0.3));
        break;
      case 'charge':
        if (sword) { swingR = -1.2; elbowR = 0.3; } else { swingL = 0.6; swingR = 0.5; } // espada apontada para a frente
        spine = 0.25;
        legL = -0.5 * Math.sin(t * 20); legR = -legL;
        break;
      case 'spin':
        armDownL = armDownR = 0.4;
        break;
      case 'roll':
        legL = legR = -1.2; kneeL = kneeR = 1.6; armDownL = armDownR = 0.9; swingL = swingR = -0.8;
        break;
      case 'death':
        armDownL = armDownR = 0.7;
        break;
    }

    this.set('hips', 0, hipYaw, hipRoll);
    this.set('spine', spine, spineYaw, spineRoll);
    this.set('upperArmL', swingL, yawL, -armDownL);
    this.set('upperArmR', swingR, yawR, armDownR);
    this.set('lowerArmL', 0, -elbowL, 0);
    this.set('lowerArmR', 0, elbowR, 0);
    this.set('upperLegL', legL, 0, crossL);
    this.set('upperLegR', legR, 0, crossR);
    this.set('lowerLegL', kneeL);
    this.set('lowerLegR', kneeR);

    // Devolve quanto o corpo deve descer (valor negativo) para os pés ficarem no chão
    return PLANT_FEET_STATES.has(state) ? this.plantFeet() : 0;
  }
}

export function createModel(id) {
  return new ModelInstance(id);
}
