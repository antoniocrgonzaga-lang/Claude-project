// =============================================================
// creature.js — criaturas ARTICULADAS feitas de formas simples, sem Blender.
//
// Em data/models.js, um modelo com `creature` descreve:
//   joints → as "juntas" (quadril, tronco, cabeça, braços, pernas, rabo...),
//            cada uma com `parent` e `pos` (posição em relação à junta-mãe)
//   parts  → por junta, as formas que se movem junto com ela (mesmo formato
//            das peças de placeholder; pos/rot relativos à junta)
//   anim   → jeito de andar e de atacar (veja CreatureRig)
//
// Montagem: todas as peças viram UMA malha com esqueleto (SkinnedMesh): cada
// vértice segue 100% a sua junta. A placa de vídeo desenha a criatura inteira
// em 1 a 3 chamadas (pele, metal e partes que brilham), não importa quantas
// peças ela tenha. A geometria é montada uma vez por modelo e reaproveitada.
//
// Convenções (iguais às do resto do jogo): a criatura olha para +Z,
// esquerda = +X, pés em y = 0. Girar um membro em X negativo = para a frente.
// =============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const templates = new Map(); // id do modelo → { geometry, order, joints }
let materials = null;
function creatureMaterials() {
  materials ??= {
    base: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }), // sem reflexo de ambiente, metal demais fica preto
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }), // olhos, chamas: brilham no escuro
  };
  return materials;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

// Ordem das juntas: mães antes das filhas
function jointOrder(joints) {
  const order = [];
  const visit = (name) => {
    if (order.includes(name)) return;
    const parent = joints[name].parent;
    if (parent) visit(parent);
    order.push(name);
  };
  Object.keys(joints).forEach(visit);
  return order;
}

function buildTemplate(id, c, getGeometry) {
  const order = jointOrder(c.joints);
  // posição de cada junta no modelo (a soma das posições das mães)
  const world = {};
  for (const name of order) {
    const j = c.joints[name];
    world[name] = new THREE.Vector3().fromArray(j.pos ?? [0, 0, 0]);
    if (j.parent) world[name].add(world[j.parent]);
  }
  const kinds = { base: [], metal: [], glow: [] };
  order.forEach((name, index) => {
    for (const part of c.parts[name] ?? []) {
      const g0 = getGeometry(part);
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      g.deleteAttribute('uv');
      _m.compose(
        _p.fromArray(part.pos ?? [0, 0, 0]).add(world[name]),
        _q.setFromEuler(_e.set(...(part.rot ?? [0, 0, 0]))),
        _s.fromArray(part.scale ?? [1, 1, 1]));
      g.applyMatrix4(_m);
      const n = g.attributes.position.count;
      _c.setHex(part.color ?? 0xffffff); // converte para o espaço de cor linear
      const color = new Float32Array(n * 3), skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        color.set([_c.r, _c.g, _c.b], i * 3);
        skinIndex[i * 4] = index + 1; // osso 0 é a raiz
        skinWeight[i * 4] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(color, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
      const kind = part.glow || part.emissive !== undefined ? 'glow' : part.metal ? 'metal' : 'base';
      kinds[kind].push(g);
    }
  });
  // junta tudo, com um "grupo" por tipo de material
  const used = Object.entries(kinds).filter(([, list]) => list.length);
  const merged = used.map(([, list]) => mergeGeometries(list));
  const geometry = mergeGeometries(merged, true);
  for (const list of Object.values(kinds)) for (const g of list) g.dispose();
  merged.forEach((g) => g.dispose());
  return { geometry, order, kinds: used.map(([k]) => k), joints: c.joints };
}

// Cria uma instância: { mesh, bones: { nome: Bone } }
export function buildCreature(id, def, getGeometry) {
  let tpl = templates.get(id);
  if (!tpl) { tpl = buildTemplate(id, def.creature, getGeometry); templates.set(id, tpl); }
  const mats = creatureMaterials();
  const root = new THREE.Bone();
  const list = [root];
  const bones = {};
  for (const name of tpl.order) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.fromArray(tpl.joints[name].pos ?? [0, 0, 0]);
    (tpl.joints[name].parent ? bones[tpl.joints[name].parent] : root).add(b);
    bones[name] = b;
    list.push(b);
  }
  const mesh = new THREE.SkinnedMesh(tpl.geometry, tpl.kinds.map((k) => mats[k]));
  mesh.add(root);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Esfera de corte (para não desenhar criaturas fora da tela): a da pose parada, com folga
  // para braços erguidos e golpes. Sem isso, todos os inimigos do andar seriam desenhados sempre.
  tpl.geometry.boundingSphere ?? tpl.geometry.computeBoundingSphere();
  mesh.boundingSphere = tpl.geometry.boundingSphere.clone();
  mesh.boundingSphere.radius *= 1.5;
  mesh.frustumCulled = true;
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  return { mesh, bones };
}

// ======================= ESQUELETO AUTOMÁTICO (modelos .glb sem ossos) =======================
// Para um .glb "estátua" (sem esqueleto), como o lobisomem feito no Blender:
//   autoRig.joints → juntas com posição ABSOLUTA no modelo (`at`, pés em y = 0, olhando +Z)
//                    e `tip` opcional (onde o osso termina, para juntas sem filha: mão, cabeça, pé)
// Cada vértice passa a seguir os 2 ossos mais próximos (peso maior para o mais perto).
// Vértices de um lado do corpo (x > 0 ou x < 0) nunca seguem ossos do outro lado,
// para uma perna não "puxar" a outra. Depois a CreatureRig anima como as outras criaturas.
const skinCache = new Map(); // id → geometrias com pesos já calculados (uma vez por modelo)
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sv = new THREE.Vector3(), _sp = new THREE.Vector3();

function segmentDistance(p, a, b) {
  _sb.subVectors(b, a);
  const len2 = _sb.lengthSq();
  const t = len2 > 0 ? Math.max(0, Math.min(1, _sp.subVectors(p, a).dot(_sb) / len2)) : 0;
  return _sv.copy(a).addScaledVector(_sb, t).distanceTo(p);
}

export function autoSkin(id, obj, rig) {
  const order = jointOrder(rig.joints);
  const at = Object.fromEntries(order.map((n) => [n, new THREE.Vector3().fromArray(rig.joints[n].at)]));
  // segmento de cada osso: da junta até a primeira filha (ou até `tip`)
  const segs = order.map((name) => {
    const child = order.find((n) => rig.joints[n].parent === name && !rig.joints[n].noSegment);
    const end = rig.joints[name].tip ? new THREE.Vector3().fromArray(rig.joints[name].tip) : child ? at[child] : at[name];
    const side = Math.sign(at[name].x) * (Math.abs(at[name].x) > 0.05 ? 1 : 0); // -1, 0 (centro) ou 1
    return { a: at[name], b: end, side, skip: rig.joints[name].noSegment };
  });

  obj.updateMatrixWorld(true);
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh) meshes.push(o); });
  let cached = skinCache.get(id);
  if (!cached) {
    const toModel = obj.matrixWorld.clone().invert();
    cached = meshes.map((m) => {
      const g = m.geometry.clone().applyMatrix4(toModel.clone().multiply(m.matrixWorld)); // tudo no espaço do modelo
      const pos = g.attributes.position, n = pos.count;
      const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        _sa.fromBufferAttribute(pos, i);
        const vSide = Math.abs(_sa.x) > 0.03 ? Math.sign(_sa.x) : 0;
        let b1 = 0, d1 = Infinity, b2 = 0, d2 = Infinity;
        segs.forEach((s, j) => {
          if (s.skip || (s.side && vSide && s.side !== vSide)) return;
          const d = segmentDistance(_sa, s.a, s.b);
          if (d < d1) { b2 = b1; d2 = d1; b1 = j; d1 = d; } else if (d < d2) { b2 = j; d2 = d; }
        });
        // peso pelo inverso da distância (potência alta = transição curta entre ossos)
        const w1 = 1 / Math.pow(d1 + 0.02, 5), w2 = d2 < Infinity ? 1 / Math.pow(d2 + 0.02, 5) : 0;
        idx[i * 4] = b1 + 1; idx[i * 4 + 1] = b2 + 1; // osso 0 é a raiz
        wts[i * 4] = w1 / (w1 + w2); wts[i * 4 + 1] = w2 / (w1 + w2);
      }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
      g.computeBoundingSphere();
      return g;
    });
    skinCache.set(id, cached);
  }

  // ossos (posição relativa à junta-mãe) e as malhas trocadas por versões com esqueleto
  const root = new THREE.Bone();
  const list = [root], bones = {};
  for (const name of order) {
    const b = new THREE.Bone();
    b.name = name;
    const parent = rig.joints[name].parent;
    b.position.copy(at[name]).sub(parent ? at[parent] : _sa.set(0, 0, 0));
    (parent ? bones[parent] : root).add(b);
    bones[name] = b;
    list.push(b);
  }
  obj.add(root);
  obj.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  meshes.forEach((m, i) => {
    const sm = new THREE.SkinnedMesh(cached[i], m.material);
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.boundingSphere = cached[i].boundingSphere.clone();
    sm.boundingSphere.radius *= 1.4; // folga para braços erguidos
    obj.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton); // pose de agora = pose de descanso
    m.removeFromParent();
  });
  return { bones };
}

// ======================= ANIMAÇÃO =======================
// anim (em models.js):
//   gait:   'scurry' (miúdo e rápido) | 'stomp' (pesado, balança o corpo) | 'glide' (manto: passos curtos)
//   attack: 'claws' (garras) | 'smash' (porrada de cima para baixo) | 'cast' (ergue o cajado e lança)
//   stepFreq (velocidade do passo), stride (amplitude da perna), armSwing,
//   hunch (corcunda), pose: { junta: [x, y, z] } — pose parada de base (cotovelos dobrados etc.)
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

export class CreatureRig {
  constructor(bones, anim) {
    this.bones = bones;
    this.anim = { stepFreq: 9, stride: 0.5, armSwing: 0.4, hunch: 0, pose: {}, ...anim };
    this.hipsRestY = bones.hips?.position.y ?? 0;
    this.flinchTime = 99;
    this._v = new THREE.Vector3();
    this.restFootY = null;
  }

  flinch() { this.flinchTime = 0; }

  // Altura do pé mais baixo (juntas footL/footR) em relação à raiz do modelo
  lowestFoot(root) {
    const { footL, footR } = this.bones;
    if (!footL || !footR) return null;
    root.updateMatrixWorld(true);
    const a = root.worldToLocal(footL.getWorldPosition(this._v)).y;
    const b = root.worldToLocal(footR.getWorldPosition(this._v)).y;
    return Math.min(a, b);
  }

  // state, t = tempo no estado; attackLength/windup em segundos; root = objeto da raiz (para os pés)
  update(state, t, dt, { attackLength = 0.3, windup = 0.15, root }) {
    const A = this.anim;
    const r = {}; // rotações [x, y, z] de cada junta neste quadro
    const add = (name, x = 0, y = 0, z = 0) => {
      const v = (r[name] ??= [0, 0, 0]);
      v[0] += x; v[1] += y; v[2] += z;
    };
    for (const [name, rot] of Object.entries(A.pose)) add(name, ...rot);
    add('spine', A.hunch);
    add('head', -A.hunch * 0.7); // a cabeça compensa a corcunda para olhar para a frente

    switch (state) {
      case 'idle': {
        const b = Math.sin(t * 2.4);
        add('spine', b * 0.03);
        add('armL', 0, 0, b * 0.03); add('armR', 0, 0, -b * 0.03);
        add('head', 0, Math.sin(t * 0.7) * 0.25 + (A.gait === 'scurry' ? Math.sin(t * 5.3) * 0.08 : 0), 0); // olha em volta
        if (A.tail) add('tail', 0, Math.sin(t * 2) * 0.3, 0);
        break;
      }
      case 'walk': case 'charge': {
        const s = Math.sin(t * A.stepFreq), c = Math.cos(t * A.stepFreq);
        add('legL', -A.stride * s); add('legR', A.stride * s);
        add('shinL', Math.max(0, s) * A.stride * 1.2 + Math.max(0, c) * 0.3);
        add('shinR', Math.max(0, -s) * A.stride * 1.2 + Math.max(0, -c) * 0.3);
        add('armL', A.armSwing * s); add('armR', -A.armSwing * s);
        add('spine', 0, 0.08 * s, 0);
        if (A.gait === 'stomp') { add('hips', 0, 0, 0.07 * s); add('spine', 0.05, 0, -0.1 * s); add('head', 0, 0, 0.05 * s); }
        if (A.gait === 'scurry') { add('spine', 0.1); add('head', -0.1, 0, 0.06 * c); }
        if (A.tail) add('tail', 0, 0.4 * s, 0);
        break;
      }
      case 'attack': {
        // fases: prepara (até `windup`, quando o golpe acerta) → golpe rápido → volta
        const strike = 0.12;
        const up = t < windup ? smooth(t / windup) : Math.max(0, 1 - (t - windup) / strike);
        const hit = t < windup ? 0 : t < windup + strike ? smooth((t - windup) / strike) : Math.max(0, 1 - (t - windup - strike) / Math.max(0.05, attackLength - windup - strike));
        if (A.attack === 'smash') {
          // ergue a clava com as duas mãos por cima da cabeça e desce com tudo
          add('armR', -2.7 * up - 0.9 * hit, 0, 0.3 * up); add('foreR', -0.9 * up + 0.4 * hit);
          add('armL', -2.4 * up - 0.8 * hit, 0, -0.3 * up); add('foreL', -1.0 * up + 0.3 * hit);
          add('spine', -0.25 * up + 0.45 * hit); add('head', 0.15 * up - 0.2 * hit);
          add('legL', -0.25 * hit); add('shinL', 0.45 * hit); add('legR', 0.2 * hit);
        } else if (A.attack === 'claws') {
          // agacha puxando a garra para trás e dá o bote
          add('armR', 0.9 * up - 2.0 * hit, 0, -0.4 * hit); add('foreR', -0.3 * up);
          add('armL', -0.6 * up - 0.8 * hit, 0, 0.3 * hit);
          add('spine', 0.25 * up + 0.3 * hit, -0.3 * up + 0.4 * hit);
          add('legL', -0.4 * up); add('shinL', 0.7 * up); add('legR', 0.3 * up); add('shinR', 0.5 * up);
          if (A.tail) add('tail', 0.5 * up, 0, 0);
        } else { // cast: ergue o cajado e empurra para a frente na hora de lançar
          add('armR', -1.2 * up - 0.7 * hit); add('foreR', 0.5 * up + 0.3 * hit);
          add('armL', -1.0 * up - 0.9 * hit, 0.4 * hit); add('foreL', -0.4 * up);
          add('spine', -0.2 * up + 0.25 * hit); add('head', 0.15 * up);
        }
        break;
      }
      case 'channel': { // chefes preparando magia: braços erguidos tremendo
        const shake = Math.sin(t * 30) * 0.04;
        add('armL', -2.3 + shake, 0, -0.3); add('armR', -2.3 - shake, 0, 0.3); add('spine', -0.2);
        break;
      }
      case 'death': {
        const p = Math.min(t / 0.45, 1);
        add('armL', -1.2 * p, 0, -0.9 * p); add('armR', -1.2 * p, 0, 0.9 * p);
        add('head', -0.5 * p); add('spine', -0.2 * p);
        add('legL', -0.5 * p); add('shinL', 0.8 * p);
        break;
      }
    }

    // levou um golpe: o tronco "dobra" para trás por um instante
    this.flinchTime += dt;
    if (this.flinchTime < 0.25 && state !== 'death') {
      const f = Math.sin((this.flinchTime / 0.25) * Math.PI);
      add('spine', -0.3 * f); add('head', -0.25 * f);
    }

    for (const [name, bone] of Object.entries(this.bones)) {
      const v = r[name];
      if (v) bone.rotation.set(v[0], v[1], v[2]); else bone.rotation.set(0, 0, 0);
    }

    // pés no chão: desce/sobe o quadril para o pé mais baixo encostar no chão
    if (this.bones.hips && state !== 'death') {
      this.bones.hips.position.y = this.hipsRestY;
      if (this.restFootY === null) {
        const saved = Object.values(this.bones).map((b) => b.rotation.clone());
        Object.values(this.bones).forEach((b) => b.rotation.set(0, 0, 0));
        this.restFootY = this.lowestFoot(root);
        Object.values(this.bones).forEach((b, i) => b.rotation.copy(saved[i]));
      }
      const low = this.lowestFoot(root);
      if (low !== null && this.restFootY !== null) this.bones.hips.position.y += this.restFootY - low;
    }
  }
}
