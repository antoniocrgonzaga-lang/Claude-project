// =============================================================
// models.js — tabela de TODOS os modelos 3D do jogo.
//
// >>> PARA TROCAR UM PLACEHOLDER PELO SEU .GLB <<<
//   1. Coloque o arquivo em assets/models/  (ex.: assets/models/cavaleiro.glb)
//   2. Mude `glb: null` para `glb: 'assets/models/cavaleiro.glb'`
//   3. Se ficar grande/pequeno demais, ajuste `scale`.
//      Se ficar de costas, use `rotationY: Math.PI`.
//
// Convenções:
//   - os pés do modelo ficam em y = 0 (no Blender: origem no chão)
//   - o modelo olha para +Z no Three.js (no Blender: olhando para -Y, a vista "Front")
//   - 1 unidade = 1 metro; um personagem tem uns 1.8 de altura
//   - radius/height definem a área de colisão e de clique
//
// Placeholders: lista de "parts" (formas simples). Formas aceitas:
//   capsule (radius, length) | box (size: [x,y,z]) | cylinder (radius ou radiusTop/radiusBottom, height)
//   cone (radius, height, segments) | sphere (radius) | torus (radius, tube, arc) | octahedron (radius)
//   Opções: pos [x,y,z], rot [x,y,z] (radianos), scale [x,y,z], color, emissive, emissiveIntensity,
//           mat { metalness, roughness, transparent, opacity }, castShadow
//
// Acessórios (attachments): modelos presos a outro modelo (cajado na mão, chapéu na cabeça).
//   { model, bones, pos, rot, bonePos, boneRot, boneScale, light, enabled }
//   - bones: nomes do osso no esqueleto do .glb, em ordem de preferência (VRoid, Mixamo...)
//   - bonePos/boneRot/boneScale: encaixe quando preso no osso (cada esqueleto tem eixos diferentes)
//   - pos/rot: posição quando NÃO há .glb (no placeholder)
//   - enabled: false desliga (ex.: se o seu modelo já vier com chapéu)
// =============================================================

const SKIN = 0xd9b99b;
const PI = Math.PI;

// Tons de pele escolhidos na criação do personagem. `tint` multiplica a cor da pele:
// branco = cor original do modelo; quanto mais escuro o tint, mais escura a pele.
export const SKIN_TONES = [
  { name: 'Muito clara', tint: 0xffffff },
  { name: 'Clara', tint: 0xe8c2a0 },
  { name: 'Morena', tint: 0xb98058 },
  { name: 'Escura', tint: 0x7a4a30 },
  { name: 'Muito escura', tint: 0x4a2a1c },
  { name: 'Drow (cinza-arroxeada)', tint: 0x403c52 }, // elfo negro de D&D: cinza-ardósia quase preto, leve roxo
];

// Nomes de ossos procurados nos esqueletos (VRoid/VRM, Mixamo, Blender/genéricos)
const BONES_HAND_R = ['J_Bip_R_Hand', 'mixamorigRightHand', 'RightHand', 'Hand_R', 'hand_r', 'hand.R', 'R_Hand'];
const BONES_HAND_L = ['J_Bip_L_Hand', 'mixamorigLeftHand', 'LeftHand', 'Hand_L', 'hand_l', 'hand.L', 'L_Hand'];
const BONES_HEAD = ['J_Bip_C_Head', 'mixamorigHead', 'Head', 'head'];
const BONES_CHEST = ['J_Bip_C_UpperChest', 'mixamorigSpine2', 'UpperChest', 'Chest', 'chest'];

// ======================= ARMADURA DO CAVALEIRO =======================
// Placas feitas com formas simples, cada grupo preso a um osso do VRoid. As peças usam
// coordenadas do MODELO na pose em "T" (modelSpace): pés em y = 0, olhando para +Z,
// lado esquerdo do personagem = +X, braços esticados ao longo do X na altura y ≈ 1,56.
// Medidas tiradas do corpo do knight.vrm (1,95 m). Só o lado esquerdo é escrito:
// o direito é o espelho (mirrorArmor).
// No futuro: um conjunto destes por tipo de armadura (couro, malha, placas...).
const STEEL = { color: 0x9aa3b0, mat: { metalness: 0.6, roughness: 0.38 } };       // aço
const STEEL_DARK = { color: 0x3c4048, mat: { metalness: 0.6, roughness: 0.45 } };  // aço enegrecido (detalhes)
const GOLD = { color: 0xb08a3e, mat: { metalness: 0.7, roughness: 0.35 } };        // filetes dourados
const LEATHER = { color: 0x3a2418, mat: { roughness: 0.8 } };                       // couro
const CLOTH_RED = { color: 0x5a1418, mat: { roughness: 0.9, side: 2 } };            // tecido vermelho escuro (side 2 = os dois lados)
const plate = (m) => ({ color: m.color, mat: { ...m.mat, side: 2 } });               // placa curva aberta: aparece dos dois lados

// Espelha uma peça do lado esquerdo (+X) para o direito (−X)
function mirrorPart(p) {
  const out = { ...p };
  if (p.pos) out.pos = [-p.pos[0], p.pos[1], p.pos[2]];
  if (p.rot) out.rot = [p.rot[0], -p.rot[1], -p.rot[2]];
  if (p.arcStart !== undefined) out.arcStart = -(p.arcStart + p.arc); // pedaço de cilindro
  return out;
}
const mirrorBone = (name) => name.replace('_L_', '_R_');
function mirrorArmor(att) {
  return { ...att, bones: att.bones.map(mirrorBone), parts: att.parts.map(mirrorPart) };
}

// Corrente pendurada: argola presa na parede, elos alternando de direção e um grilhão no fim
function chainParts(x, links) {
  const IRON = { color: 0x2a2626, mat: { metalness: 0.6, roughness: 0.5 } };
  const parts = [{ shape: 'torus', radius: 0.035, tube: 0.009, segments: 10, ...IRON, pos: [x, 0, 0.03] }];
  for (let i = 0; i < links; i++) {
    parts.push({ shape: 'torus', radius: 0.026, tube: 0.008, segments: 8, ...IRON, pos: [x, -0.05 - i * 0.05, 0.045],
      rot: [0, i % 2 ? PI / 2 : 0, 0], scale: [1, 1.5, 1] });
  }
  parts.push({ shape: 'torus', radius: 0.055, tube: 0.014, segments: 12, ...IRON, pos: [x, -0.1 - links * 0.05, 0.065], rot: [PI / 2 - 0.3, 0, 0] });
  return parts;
}

// ======================= CRIATURAS (inimigos articulados) =======================
// Escreva só as juntas e peças do lado ESQUERDO (nomes terminando em L: armL, legL...);
// o lado direito (R) é criado espelhado. `extraParts` acrescenta peças a uma junta
// depois do espelho (ex.: a arma só na mão direita). Veja core/creature.js.
function mirrorCreature(c) {
  const toR = (name) => (name?.endsWith('L') ? name.slice(0, -1) + 'R' : name);
  const joints = { ...c.joints }, parts = { ...c.parts };
  for (const [name, j] of Object.entries(c.joints)) {
    if (!name.endsWith('L')) continue;
    joints[toR(name)] = { ...j, parent: toR(j.parent), pos: [-j.pos[0], j.pos[1], j.pos[2]] };
    parts[toR(name)] = (c.parts[name] ?? []).map(mirrorPart);
  }
  for (const [name, list] of Object.entries(c.extraParts ?? {})) parts[name] = [...(parts[name] ?? []), ...list];
  return { joints, parts, anim: c.anim };
}

// Cores dos orcs demoníacos
const HORN = 0x18110c, BONE = 0xd8c8a8, LEATHER_D = 0x3a2416, IRON_D = 0x75757e;
const glowEye = (color, r, pos) => ({ shape: 'sphere', radius: r, segments: 8, color, glow: true, pos, castShadow: false });

// autoRig (esqueleto montado no jogo para um .glb sem ossos): escreva as juntas do lado
// ESQUERDO (nomes terminando em L); o lado direito é o espelho em X.
function mirrorAutoRig(rig) {
  const toR = (name) => (name?.endsWith('L') ? name.slice(0, -1) + 'R' : name);
  const flip = (p) => p && [-p[0], p[1], p[2]];
  const joints = { ...rig.joints };
  for (const [name, j] of Object.entries(rig.joints)) {
    if (name.endsWith('L')) joints[toR(name)] = { ...j, parent: toR(j.parent), at: flip(j.at), tip: flip(j.tip) };
  }
  return { ...rig, joints };
}

// Alças de couro por trás do escudo (enarmes): duas argolas em volta do antebraço,
// presas à placa por tiras curtas. O antebraço passa pelo eixo X, na origem.
const SHIELD_GAP = 0.12; // distância do eixo do antebraço até as costas da placa (a manopla vai até ~0,1)
function shieldStraps() {
  const strap = { color: 0x3a2416, mat: { roughness: 0.85 } };
  const parts = [];
  for (const x of [-0.07, 0.07]) {
    parts.push({ shape: 'torus', radius: 0.078, tube: 0.012, segments: 14, ...strap, pos: [x, 0, 0], rot: [0, PI / 2, 0] }); // argola no braço
    parts.push({ shape: 'box', size: [0.035, 0.05, SHIELD_GAP - 0.07], ...strap, pos: [x, 0, (SHIELD_GAP + 0.07) / 2] });  // tira até a placa
    parts.push({ shape: 'cylinder', radius: 0.012, height: 0.01, segments: 6, color: 0x8a7a50, mat: { metalness: 0.6, roughness: 0.4 }, pos: [x, 0, SHIELD_GAP - 0.003], rot: [PI / 2, 0, 0] }); // rebite
  }
  return parts;
}

const KNIGHT_ARMOR_CENTER = [
  { bones: ['J_Bip_C_UpperChest'], modelSpace: true, onlyGlb: true, parts: [ // couraça (peito e costas)
    { shape: 'cylinder', radiusTop: 0.225, radiusBottom: 0.178, height: 0.34, segments: 24, ...STEEL, pos: [0, 1.38, 0.015], scale: [1, 1, 0.74] },
    { shape: 'sphere', radius: 0.2, segments: 20, ...STEEL, pos: [0, 1.43, 0.08], scale: [1, 0.75, 0.5] },                                   // peito abaulado
    { shape: 'sphere', radius: 0.225, segments: 24, ...STEEL, pos: [0, 1.55, 0.015], scale: [1, 0.35, 0.74] },                               // ombros arredondados
    { shape: 'torus', radius: 0.178, tube: 0.012, segments: 28, ...GOLD, pos: [0, 1.21, 0.015], rot: [PI / 2, 0, 0], scale: [1, 0.74, 1] },  // filete de baixo
    { shape: 'cylinder', radiusTop: 0.095, radiusBottom: 0.14, height: 0.12, segments: 16, ...STEEL_DARK, pos: [0, 1.6, -0.015], scale: [1, 1, 0.9] }, // gorjal (pescoço)
  ] },
  { bones: ['J_Bip_C_Spine'], modelSpace: true, onlyGlb: true, parts: [ // placa da barriga
    { shape: 'cylinder', radiusTop: 0.182, radiusBottom: 0.186, height: 0.1, segments: 20, ...STEEL_DARK, pos: [0, 1.16, 0.012], scale: [1, 1, 0.74] },
  ] },
  { bones: ['J_Bip_C_Hips'], modelSpace: true, onlyGlb: true, parts: [ // cinto e aba de tecido
    { shape: 'torus', radius: 0.19, tube: 0.022, segments: 28, ...LEATHER, pos: [0, 1.1, 0.008], rot: [PI / 2, 0, 0], scale: [1, 0.74, 1] },
    { shape: 'box', size: [0.07, 0.055, 0.02], ...GOLD, pos: [0, 1.1, 0.168] },                                                                // fivela
    { shape: 'box', size: [0.15, 0.28, 0.01], ...CLOTH_RED, pos: [0, 0.95, 0.165], rot: [-0.08, 0, 0] },                                       // aba da frente
    { shape: 'cylinder', radiusTop: 0.19, radiusBottom: 0.21, height: 0.16, segments: 20, open: true, arcStart: 2.1, arc: 2.08, ...plate(STEEL_DARK), pos: [0, 1.01, 0.0], scale: [1, 1, 0.78] }, // placas de trás (cobrem o quadril)
  ] },
];

const KNIGHT_ARMOR_LEFT = [
  { bones: ['J_Bip_L_Shoulder'], modelSpace: true, onlyGlb: true, parts: [ // ombreira (fica no ombro; o braço gira por baixo)
    { shape: 'sphere', radius: 0.125, segments: 16, ...STEEL, pos: [0.25, 1.6, -0.03], scale: [1, 0.7, 1.05] },
    { shape: 'torus', radius: 0.125, tube: 0.01, segments: 24, ...GOLD, pos: [0.25, 1.575, -0.03], rot: [PI / 2, 0, 0], scale: [1, 1.05, 1] },
    { shape: 'sphere', radius: 0.13, segments: 16, ...STEEL_DARK, pos: [0.285, 1.545, -0.03], scale: [0.8, 0.45, 1] },                         // lâminas de baixo
    { shape: 'sphere', radius: 0.12, segments: 16, ...STEEL, pos: [0.31, 1.5, -0.03], scale: [0.7, 0.4, 0.95] },
  ] },
  { bones: ['J_Bip_L_UpperArm'], modelSpace: true, onlyGlb: true, parts: [ // braçal de cima
    { shape: 'cylinder', radius: 0.068, height: 0.17, segments: 12, ...STEEL, pos: [0.39, 1.561, -0.032], rot: [0, 0, PI / 2] },
  ] },
  { bones: ['J_Bip_L_LowerArm'], modelSpace: true, onlyGlb: true, parts: [ // cotoveleira e braçal de baixo
    { shape: 'sphere', radius: 0.068, segments: 12, ...STEEL_DARK, pos: [0.495, 1.565, -0.04] },
    { shape: 'cylinder', radius: 0.058, height: 0.014, segments: 12, ...GOLD, pos: [0.495, 1.565, -0.1], rot: [PI / 2, 0, 0] },              // leque do cotovelo
    { shape: 'cylinder', radiusTop: 0.066, radiusBottom: 0.056, height: 0.25, segments: 12, ...STEEL, pos: [0.655, 1.561, -0.032], rot: [0, 0, PI / 2] },
  ] },
  { bones: ['J_Bip_L_Hand'], modelSpace: true, onlyGlb: true, parts: [ // manopla (cobre a mão toda)
    { shape: 'cylinder', radiusTop: 0.072, radiusBottom: 0.06, height: 0.07, segments: 12, ...STEEL, pos: [0.8, 1.561, -0.032], rot: [0, 0, PI / 2] },
    { shape: 'box', size: [0.18, 0.06, 0.11], ...STEEL_DARK, pos: [0.905, 1.556, -0.02] },
  ] },
  { bones: ['J_Bip_L_UpperLeg'], modelSpace: true, onlyGlb: true, parts: [ // escarcela (aba da cintura) e coxote
    { shape: 'cylinder', radiusTop: 0.125, radiusBottom: 0.13, height: 0.12, segments: 16, open: true, arcStart: -0.2, arc: 1.7, ...plate(STEEL_DARK), pos: [0.093, 1.02, -0.005] },
    { shape: 'cylinder', radiusTop: 0.13, radiusBottom: 0.135, height: 0.1, segments: 16, open: true, arcStart: -0.2, arc: 1.7, ...plate(STEEL), pos: [0.093, 0.93, -0.005] },
    { shape: 'cylinder', radius: 0.1, height: 0.22, segments: 16, open: true, arcStart: -1.2, arc: 3.0, ...plate(STEEL), pos: [0.093, 0.8, -0.005] },
  ] },
  { bones: ['J_Bip_L_LowerLeg'], modelSpace: true, onlyGlb: true, parts: [ // joelheira e grevas
    { shape: 'sphere', radius: 0.062, segments: 12, ...STEEL_DARK, pos: [0.093, 0.66, 0.06], scale: [1.1, 1, 0.7] },
    { shape: 'cylinder', radius: 0.052, height: 0.012, segments: 12, ...GOLD, pos: [0.155, 0.66, 0.03], rot: [0, 0, PI / 2] },                // leque do joelho
    { shape: 'cylinder', radiusTop: 0.088, radiusBottom: 0.075, height: 0.42, segments: 14, ...STEEL, pos: [0.093, 0.4, -0.05], scale: [1, 1, 1.12] },
  ] },
  { bones: ['J_Bip_L_Foot'], modelSpace: true, onlyGlb: true, parts: [ // escarpe (sapato de placas)
    { shape: 'cylinder', radius: 0.078, height: 0.08, segments: 12, ...STEEL_DARK, pos: [0.093, 0.13, -0.05] },
    { shape: 'box', size: [0.15, 0.075, 0.17], ...STEEL, pos: [0.093, 0.09, 0.055], rot: [0.3, 0, 0] },
    { shape: 'box', size: [0.14, 0.06, 0.09], ...STEEL_DARK, pos: [0.093, 0.045, 0.16], rot: [0.15, 0, 0] },
  ] },
];

const KNIGHT_ARMOR = [...KNIGHT_ARMOR_CENTER, ...KNIGHT_ARMOR_LEFT, ...KNIGHT_ARMOR_LEFT.map(mirrorArmor)];

export const MODELS = {
  // ======================= PERSONAGENS JOGÁVEIS =======================
  witch: {
    // Modelo feito no VRoid Studio (VRM 1.0, já olha para +Z). Traje inicial.
    glb: 'assets/models/witch.vrm',
    scale: 1, rotationY: 0, radius: 0.35, height: 1.75,
    rig: 'vrm',            // sem animações no arquivo: braços e pernas animados por código
    skinMaterial: 'SKIN',  // materiais cujo nome contém isto mudam com o tom de pele
    placeholder: { parts: [ // usado só se o arquivo não carregar
      { shape: 'cone', radius: 0.42, height: 1.15, color: 0x3b1f4f, pos: [0, 0.575, 0] },            // vestido
      { shape: 'capsule', radius: 0.2, length: 0.35, color: 0x4a2a6a, pos: [0, 1.25, 0] },           // tronco
      { shape: 'sphere', radius: 0.17, color: SKIN, pos: [0, 1.6, 0], skin: true },                   // cabeça
    ] },
    attachments: [
      // Cajado na mão direita, sempre em pé (upright). bonePos = ajuste até a palma da mão.
      // Luz BRANCA suave na esfera: ilumina sem mudar a cor do chapéu e da roupa pretos
      // (uma luz roxa ali deixava tudo arroxeado).
      { model: 'witchStaff', bones: BONES_HAND_R, pos: [0.38, 0.85, 0.12], bonePos: [-0.07, -0.015, 0.01], upright: true,
        light: { color: 0xfff6ee, intensity: 0.9, distance: 3, pos: [0, 1.1, 0] } },
      // Chapéu de bruxa: só no placeholder (o modelo do VRoid já tem chapéu)
      { model: 'witchHat', bones: BONES_HEAD, pos: [0, 1.72, 0], onlyPlaceholder: true },
    ],
  },

  // ======================= ACESSÓRIOS =======================
  witchStaff: { // cajado da bruxa. Origem = onde a mão segura; o cajado fica em pé (+Y)
    glb: null, scale: 1, rotationY: 0, radius: 0.1, height: 2,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.028, radiusBottom: 0.022, height: 1.75, segments: 8, color: 0x3a2418, pos: [0, 0.05, 0] }, // haste de madeira escura
      { shape: 'cylinder', radius: 0.032, height: 0.22, segments: 8, color: 0x2a1a24, pos: [0, 0, 0] },                          // empunhadura de couro
      { shape: 'torus', radius: 0.031, tube: 0.008, segments: 12, color: 0x8a8890, mat: { metalness: 0.8, roughness: 0.35 }, pos: [0, 0.12, 0], rot: [PI / 2, 0, 0] },
      { shape: 'torus', radius: 0.031, tube: 0.008, segments: 12, color: 0x8a8890, mat: { metalness: 0.8, roughness: 0.35 }, pos: [0, -0.12, 0], rot: [PI / 2, 0, 0] },
      { shape: 'cone', radius: 0.026, height: 0.07, segments: 8, color: 0x8a8890, mat: { metalness: 0.8, roughness: 0.35 }, pos: [0, -0.855, 0], rot: [PI, 0, 0] }, // ponteira
      { shape: 'torus', radius: 0.036, tube: 0.012, segments: 12, color: 0x8a8890, mat: { metalness: 0.8, roughness: 0.35 }, pos: [0, 0.9, 0], rot: [PI / 2, 0, 0] }, // colar do topo
      // garras segurando a esfera
      { shape: 'cylinder', radiusTop: 0.006, radiusBottom: 0.012, height: 0.2, segments: 5, color: 0x3a2418, pos: [0.04, 1.0, 0], rot: [0, 0, -0.4] },
      { shape: 'cylinder', radiusTop: 0.006, radiusBottom: 0.012, height: 0.2, segments: 5, color: 0x3a2418, pos: [-0.04, 1.0, 0], rot: [0, 0, 0.4] },
      { shape: 'cylinder', radiusTop: 0.006, radiusBottom: 0.012, height: 0.2, segments: 5, color: 0x3a2418, pos: [0, 1.0, -0.04], rot: [-0.4, 0, 0] },
      // esfera mágica com halo
      { shape: 'sphere', radius: 0.07, color: 0xd8b8ff, emissive: 0xa050ff, emissiveIntensity: 3.2, pos: [0, 1.1, 0], castShadow: false },
      { shape: 'sphere', radius: 0.1, color: 0xb070ff, emissive: 0xa050ff, emissiveIntensity: 1.5, mat: { transparent: true, opacity: 0.3, depthWrite: false }, pos: [0, 1.1, 0], castShadow: false },
      // lua crescente em volta da esfera: arco fino + parte mais grossa embaixo, aberta para cima
      { shape: 'torus', radius: 0.17, tube: 0.016, arc: PI * 1.35, segments: 32, color: 0xf0e6c8, emissive: 0xe8d090, emissiveIntensity: 1.4, mat: { metalness: 0.6, roughness: 0.3 }, pos: [0, 1.1, 0], rot: [0, 0, 2.59], castShadow: false },
      { shape: 'torus', radius: 0.165, tube: 0.026, arc: PI * 0.8, segments: 24, color: 0xf0e6c8, emissive: 0xe8d090, emissiveIntensity: 1.4, mat: { metalness: 0.6, roughness: 0.3 }, pos: [0, 1.1, 0], rot: [0, 0, 3.46], castShadow: false },
      // estrelinhas nas pontas da lua
      { shape: 'octahedron', radius: 0.022, color: 0xfff4d0, emissive: 0xffe8a0, emissiveIntensity: 3, pos: [0.145, 1.189, 0], castShadow: false },
      { shape: 'octahedron', radius: 0.022, color: 0xfff4d0, emissive: 0xffe8a0, emissiveIntensity: 3, pos: [-0.145, 1.189, 0], castShadow: false },
    ] },
  },

  archerBow: { // arco élfico. Origem = empunhadura; em pé (+Y); a corda fica atrás (−Z, lado do arqueiro)
    glb: null, scale: 1, rotationY: 0, radius: 0.1, height: 1.3,
    placeholder: { parts: [
      // braços do arco: um arco de círculo (raio 0.9) com o centro atrás da empunhadura
      { shape: 'torus', radius: 0.9, tube: 0.02, arc: 1.5, segments: 24, color: 0x5a3a22, pos: [0, 0, -0.9], rot: [0, -PI / 2, -0.75] },
      { shape: 'torus', radius: 0.878, tube: 0.007, arc: 1.3, segments: 24, color: 0xc8a860, emissive: 0x6a5020, emissiveIntensity: 0.4, mat: { metalness: 0.7, roughness: 0.35 }, pos: [0, 0, -0.9], rot: [0, -PI / 2, -0.65] }, // filete dourado élfico
      { shape: 'cylinder', radius: 0.028, height: 0.16, segments: 8, color: 0x2a1a12, pos: [0, 0, 0] },  // empunhadura de couro
      { shape: 'box', size: [0.02, 0.03, 0.05], color: 0xc8a860, mat: { metalness: 0.7, roughness: 0.35 }, pos: [0, 0.09, 0.0] }, // apoio da flecha
      // (a corda é desenhada por código: ela se curva quando o arqueiro puxa — veja bowString)
      { shape: 'octahedron', radius: 0.025, color: 0xc8a860, mat: { metalness: 0.7, roughness: 0.35 }, pos: [0, 0.61, -0.241] },   // pontas
      { shape: 'octahedron', radius: 0.025, color: 0xc8a860, mat: { metalness: 0.7, roughness: 0.35 }, pos: [0, -0.61, -0.241] },
    ] },
  },

  nockedArrow: { // flecha encaixada no arco. Origem = ponta de trás (encaixe na corda); aponta para +Z
    glb: null, scale: 1, rotationY: 0, radius: 0.05, height: 0.1,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.009, height: 0.78, segments: 6, color: 0xc8a878, pos: [0, 0, 0.39], rot: [PI / 2, 0, 0] }, // haste
      { shape: 'cone', radius: 0.022, height: 0.08, segments: 6, color: 0xc8ccd4, mat: { metalness: 0.8, roughness: 0.3 }, pos: [0, 0, 0.815], rot: [PI / 2, 0, 0] }, // ponta
      { shape: 'box', size: [0.004, 0.035, 0.09], color: 0xe8e0d0, pos: [0, 0.018, 0.08] }, // penas
      { shape: 'box', size: [0.004, 0.035, 0.09], color: 0x7a2020, pos: [0.015, -0.01, 0.08], rot: [0, 0, 2.1] },
      { shape: 'box', size: [0.004, 0.035, 0.09], color: 0x7a2020, pos: [-0.015, -0.01, 0.08], rot: [0, 0, -2.1] },
    ] },
  },

  quiver: { // aljava de couro com flechas. Origem = centro; comprimento ao longo do Y
    glb: null, scale: 1, rotationY: 0, radius: 0.1, height: 0.9,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.075, radiusBottom: 0.06, height: 0.62, segments: 12, color: 0x4a3020, pos: [0, 0, 0] },
      { shape: 'torus', radius: 0.075, tube: 0.012, segments: 16, color: 0x2e1e14, pos: [0, 0.31, 0], rot: [PI / 2, 0, 0] },        // boca
      { shape: 'cylinder', radius: 0.062, height: 0.03, segments: 12, color: 0x2e1e14, pos: [0, -0.31, 0] },                        // fundo
      { shape: 'torus', radius: 0.071, tube: 0.008, segments: 16, color: 0xc8a860, mat: { metalness: 0.7, roughness: 0.35 }, pos: [0, 0.1, 0], rot: [PI / 2, 0, 0] }, // faixa dourada
      // flechas: hastes + penas (brancas e vermelhas)
      { shape: 'cylinder', radius: 0.006, height: 0.36, segments: 4, color: 0x8a6a48, pos: [0.03, 0.47, 0] },
      { shape: 'cylinder', radius: 0.006, height: 0.36, segments: 4, color: 0x8a6a48, pos: [-0.025, 0.47, 0.02] },
      { shape: 'cylinder', radius: 0.006, height: 0.36, segments: 4, color: 0x8a6a48, pos: [0, 0.47, -0.03] },
      { shape: 'cylinder', radius: 0.006, height: 0.36, segments: 4, color: 0x8a6a48, pos: [-0.02, 0.47, -0.025] },
      { shape: 'box', size: [0.004, 0.09, 0.04], color: 0xe8e0d0, pos: [0.03, 0.6, 0] },
      { shape: 'box', size: [0.004, 0.09, 0.04], color: 0x7a2020, pos: [-0.025, 0.6, 0.02], rot: [0, 1, 0] },
      { shape: 'box', size: [0.004, 0.09, 0.04], color: 0xe8e0d0, pos: [0, 0.6, -0.03], rot: [0, 0.5, 0] },
      { shape: 'box', size: [0.004, 0.09, 0.04], color: 0x7a2020, pos: [-0.02, 0.6, -0.025], rot: [0, 2, 0] },
    ] },
  },

  knightSword: { // espada longa. Origem = meio da empunhadura; a lâmina sobe (+Y), o fio fica nos lados (±X)
    glb: null, scale: 1, rotationY: 0, radius: 0.1, height: 1.2,
    placeholder: { parts: [
      { shape: 'box', size: [0.05, 0.8, 0.012], ...STEEL, color: 0xb8c0ca, pos: [0, 0.55, 0] },                        // lâmina
      { shape: 'box', size: [0.012, 0.62, 0.015], ...STEEL_DARK, pos: [0, 0.47, 0] },                                  // sulco no meio da lâmina
      { shape: 'cone', radius: 0.025, height: 0.1, segments: 4, ...STEEL, color: 0xb8c0ca, pos: [0, 1.0, 0], rot: [0, PI / 4, 0], scale: [1, 1, 0.3] }, // ponta
      { shape: 'box', size: [0.24, 0.035, 0.04], ...GOLD, pos: [0, 0.135, 0] },                                        // guarda
      { shape: 'cylinder', radius: 0.018, height: 0.22, segments: 8, ...LEATHER, pos: [0, 0.01, 0] },                  // empunhadura
      { shape: 'sphere', radius: 0.032, segments: 10, ...GOLD, pos: [0, -0.12, 0] },                                   // pomo
    ] },
  },

  knightAxe: { // machado de guerra. Origem = empunhadura; o cabo sobe (+Y), a lâmina fica para +Z
    glb: null, scale: 1, rotationY: 0, radius: 0.1, height: 1,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.02, height: 0.85, segments: 8, ...LEATHER, color: 0x4a3020, pos: [0, 0.3, 0] },    // cabo
      { shape: 'box', size: [0.02, 0.26, 0.2], ...STEEL, color: 0xa8b0ba, pos: [0, 0.62, 0.11] },                      // lâmina
      { shape: 'cylinder', radius: 0.13, height: 0.02, segments: 16, arcStart: -0.9, arc: 1.8, ...STEEL, color: 0xa8b0ba, pos: [0, 0.62, 0.08], rot: [0, 0, PI / 2] }, // fio curvo
      { shape: 'box', size: [0.05, 0.1, 0.07], ...STEEL_DARK, pos: [0, 0.62, -0.01] },                                 // olho do machado
      { shape: 'cone', radius: 0.025, height: 0.1, segments: 6, ...STEEL_DARK, pos: [0, 0.62, -0.09], rot: [-PI / 2, 0, 0] }, // esporão de trás
    ] },
  },

  // Escudos: a origem fica NO MEIO DO ANTEBRAÇO (onde o braço passa pelas alças); a placa fica
  // SHIELD_GAP à frente (+Z), longe o bastante para o braço e a manopla não atravessarem.
  // O antebraço corre ao longo do eixo X do escudo (a mão para −X).
  knightBuckler: { // broquel redondo
    glb: null, scale: 1, rotationY: 0, radius: 0.25, height: 0.5,
    placeholder: { parts: [
      ...shieldStraps(),
      { shape: 'cylinder', radius: 0.2, height: 0.03, segments: 24, color: 0x4a2c1a, mat: { roughness: 0.8 }, pos: [0, 0, SHIELD_GAP + 0.015], rot: [PI / 2, 0, 0] }, // madeira
      { shape: 'torus', radius: 0.2, tube: 0.016, segments: 28, ...STEEL_DARK, pos: [0, 0, SHIELD_GAP + 0.02] },                   // aro
      { shape: 'sphere', radius: 0.06, segments: 12, ...STEEL, pos: [0, 0, SHIELD_GAP + 0.03], scale: [1, 1, 0.6] },               // umbo (centro)
    ] },
  },

  knightKiteShield: { // escudo de cavaleiro (formato de "ferro de passar"), ponta para baixo
    glb: null, scale: 1, rotationY: 0, radius: 0.3, height: 0.8,
    placeholder: { parts: [
      ...shieldStraps(),
      { shape: 'box', size: [0.44, 0.38, 0.03], color: 0x5a1418, mat: { roughness: 0.8 }, pos: [0, 0.08, SHIELD_GAP + 0.015] },     // parte de cima (vermelha)
      { shape: 'cylinder', radius: 0.31, height: 0.03, segments: 4, color: 0x5a1418, mat: { roughness: 0.8 }, pos: [0, -0.11, SHIELD_GAP + 0.015], rot: [PI / 2, 0, 0], scale: [0.71, 1, 0.92] }, // ponta (losango)
      { shape: 'box', size: [0.04, 0.6, 0.012], ...GOLD, pos: [0, -0.02, SHIELD_GAP + 0.035] },                                     // cruz dourada
      { shape: 'box', size: [0.3, 0.04, 0.012], ...GOLD, pos: [0, 0.1, SHIELD_GAP + 0.035] },
      { shape: 'box', size: [0.46, 0.03, 0.04], ...STEEL_DARK, pos: [0, 0.27, SHIELD_GAP + 0.015] },                                // borda de cima
    ] },
  },

  witchHat: { // chapéu de bruxa. Origem = centro da aba; a ponta dobra para trás (-Z)
    glb: null, scale: 1, rotationY: 0, radius: 0.4, height: 0.7,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.4, height: 0.025, segments: 24, color: 0x1a0f26, pos: [0, 0, 0] },                        // aba
      { shape: 'cylinder', radiusTop: 0.13, radiusBottom: 0.2, height: 0.3, segments: 16, color: 0x1a0f26, pos: [0, 0.16, 0] }, // copa
      { shape: 'cylinder', radiusTop: 0.185, radiusBottom: 0.2, height: 0.07, segments: 16, color: 0x4a2058, pos: [0, 0.05, 0] }, // faixa
      { shape: 'box', size: [0.08, 0.06, 0.02], color: 0xc8b070, mat: { metalness: 0.8, roughness: 0.3 }, pos: [0, 0.05, 0.2] },  // fivela
      { shape: 'cylinder', radiusTop: 0.06, radiusBottom: 0.13, height: 0.26, segments: 12, color: 0x1a0f26, pos: [0, 0.41, -0.04], rot: [-0.3, 0, 0] },
      { shape: 'cone', radius: 0.06, height: 0.24, segments: 10, color: 0x1a0f26, pos: [0, 0.61, -0.17], rot: [-0.85, 0, 0] }, // ponta dobrada
    ] },
  },

  knight: {
    // Homem feito no VRoid Studio (VRM 1.0, 1,95 m), roupa escura justa. A armadura é feita
    // por código: peças presas nos ossos (veja os acessórios knight* mais abaixo).
    glb: 'assets/models/knight.vrm',
    scale: 1, rotationY: 0, radius: 0.42, height: 1.95,
    rig: 'vrm', walk: 'masculine', hold: 'sword', // espada na direita, escudo no braço esquerdo
    skinMaterial: 'SKIN',
    attachments: [
      ...KNIGHT_ARMOR,
      // Arma na mão direita e escudo no antebraço esquerdo: aparecem conforme o equipamento.
      // modelPos/modelRot = onde fica a empunhadura (ou a alça do escudo) na pose em "T". Os ângulos foram
      // calculados para que, na pose parada, a lâmina aponte para a frente (um pouco para cima) e o escudo
      // fique de frente, PARALELO ao antebraço (assim a mão não atravessa a placa).
      { model: 'knightSword', bones: BONES_HAND_R, modelSpace: true, modelPos: [-0.88, 1.55, -0.03], modelRot: [-1.94, -0.18, 2.458], onlyGlb: true,
        equip: { slot: 'weapon', bases: ['rusty_sword', 'short_sword', 'broadsword'] } },
      { model: 'knightAxe', bones: BONES_HAND_R, modelSpace: true, modelPos: [-0.88, 1.55, -0.03], modelRot: [2.65, -0.883, 1.362], onlyGlb: true,
        equip: { slot: 'weapon', bases: ['war_axe'] } },
      { model: 'knightBuckler', bones: ['J_Bip_L_LowerArm'], modelSpace: true, modelPos: [0.631, 1.561, -0.032], modelRot: [-2.351, 0, PI], onlyGlb: true,
        equip: { slot: 'offhand', bases: ['buckler'] } },
      { model: 'knightKiteShield', bones: ['J_Bip_L_LowerArm'], modelSpace: true, modelPos: [0.631, 1.561, -0.032], modelRot: [-2.351, 0, PI], onlyGlb: true,
        equip: { slot: 'offhand', bases: ['kite_shield'] } },
    ],
    placeholder: { parts: [
      { shape: 'box', size: [0.42, 0.8, 0.26], color: 0x3a3f4a, pos: [0, 0.4, 0] },                 // pernas
      { shape: 'box', size: [0.62, 0.7, 0.36], color: 0x8a96a8, pos: [0, 1.15, 0], mat: { metalness: 0.6, roughness: 0.45 } }, // peitoral
      { shape: 'sphere', radius: 0.2, color: 0x9aa5b5, pos: [0, 1.68, 0], mat: { metalness: 0.6, roughness: 0.4 } }, // elmo
      { shape: 'box', size: [0.26, 0.05, 0.06], color: 0x111111, pos: [0, 1.69, 0.18] },             // viseira (mostra para onde ele olha)
      { shape: 'box', size: [0.07, 0.95, 0.13], color: 0xd2d8e2, pos: [0.42, 1.05, 0.28], mat: { metalness: 0.8, roughness: 0.3 } }, // lâmina
      { shape: 'box', size: [0.26, 0.06, 0.1], color: 0x6b4a2b, pos: [0.42, 0.58, 0.28] },            // guarda
      { shape: 'box', size: [0.08, 0.62, 0.5], color: 0x7a2020, pos: [-0.38, 1.05, 0.06] },           // escudo
    ] },
  },

  archer: {
    // Elfo feito no VRoid Studio (VRM 1.0, com orelhas de elfo). Traje inicial.
    glb: 'assets/models/archer.vrm',
    scale: 1, rotationY: 0, radius: 0.35, height: 1.87,
    rig: 'vrm', walk: 'masculine', hold: 'bow', // andar masculino; arco na mão esquerda
    skinMaterial: 'SKIN',                      // inclui as orelhas (fazem parte da pele do rosto)
    // Roupa original cinza-escura → marrom escuro. Dourados, vermelhos e a camisa clara ficam.
    recolor: { materials: ['CLOTH'], color: 0x4a2c1a, ref: 0.3 },
    attachments: [
      // Arco na mão esquerda, sempre em pé; a corda fica do lado do arqueiro
      { model: 'archerBow', bones: BONES_HAND_L, bonePos: [0.07, -0.015, 0.01], upright: true, onlyGlb: true,
        // Corda que a mão direita puxa + flecha encaixada durante o tiro (pontas da corda no espaço do arco)
        bowString: { top: [0, 0.61, -0.241], bottom: [0, -0.61, -0.241], handBones: BONES_HAND_R, color: 0xe8e0c8, arrow: 'nockedArrow' } },
      // Aljava nas costas, na diagonal (flechas sobre o ombro direito)
      { model: 'quiver', bones: BONES_CHEST, bonePos: [0.04, -0.06, -0.15], boneRot: [0.15, 0, 0.45], onlyGlb: true },
    ],
    placeholder: { parts: [ // usado só se o arquivo não carregar
      { shape: 'box', size: [0.32, 0.8, 0.22], color: 0x3e5a2e, pos: [0, 0.4, 0] },
      { shape: 'capsule', radius: 0.2, length: 0.45, color: 0x4f7a3a, pos: [0, 1.2, 0] },
      { shape: 'sphere', radius: 0.17, color: 0xe8cfb0, pos: [0, 1.62, 0], skin: true },
      { shape: 'cone', radius: 0.04, height: 0.2, color: 0xe8cfb0, pos: [0.18, 1.68, 0], rot: [0, 0, -1.2], skin: true }, // orelha
      { shape: 'cone', radius: 0.04, height: 0.2, color: 0xe8cfb0, pos: [-0.18, 1.68, 0], rot: [0, 0, 1.2], skin: true },  // orelha
      { shape: 'sphere', radius: 0.18, color: 0xd8c27a, pos: [0, 1.68, -0.05], scale: [1, 0.8, 1] },         // cabelo
      { shape: 'torus', radius: 0.45, tube: 0.025, arc: PI, color: 0x6b4a2b, pos: [-0.3, 1.15, 0.2], rot: [0, -PI / 2, -PI / 2] }, // arco
      { shape: 'cylinder', radius: 0.08, height: 0.5, color: 0x5a3a22, pos: [0.1, 1.3, -0.22], rot: [0.35, 0, 0] }, // aljava
    ] },
  },

  // ======================= INIMIGOS =======================
  // Inimigos comuns: orcs demoníacos ARTICULADOS (core/creature.js). Cada junta tem as suas
  // peças; o lado direito é o espelho do esquerdo. pos das peças = relativa à junta.
  imp: (() => { // Diabrete: diabinho-orc pequeno, corcunda e rápido, ataca com garras
    const SKIN = 0xa8382a, DARK = 0x5a1810;
    return {
      glb: null, scale: 1, rotationY: 0, radius: 0.35, height: 1.25,
      creature: mirrorCreature({
        joints: {
          hips: { pos: [0, 0.5, 0] },
          spine: { parent: 'hips', pos: [0, 0.07, 0] },
          head: { parent: 'spine', pos: [0, 0.36, 0.06] },
          armL: { parent: 'spine', pos: [0.17, 0.28, 0.02] },
          foreL: { parent: 'armL', pos: [0, -0.2, 0] },
          legL: { parent: 'hips', pos: [0.09, -0.03, 0] },
          shinL: { parent: 'legL', pos: [0, -0.22, 0] },
          footL: { parent: 'shinL', pos: [0, -0.24, 0.02] },
          tail: { parent: 'hips', pos: [0, 0.02, -0.11] },
        },
        parts: {
          hips: [
            { shape: 'sphere', radius: 0.13, segments: 12, color: SKIN, scale: [1.15, 0.8, 0.95] },
            { shape: 'torus', radius: 0.13, tube: 0.018, segments: 16, color: LEATHER_D, pos: [0, 0.04, 0], rot: [PI / 2, 0, 0], scale: [1.1, 0.95, 1] }, // cinto
            { shape: 'box', size: [0.16, 0.17, 0.02], color: LEATHER_D, pos: [0, -0.1, 0.11], rot: [-0.1, 0, 0] },   // tanga
            { shape: 'box', size: [0.14, 0.13, 0.02], color: LEATHER_D, pos: [0, -0.08, -0.11], rot: [0.1, 0, 0] },
          ],
          spine: [
            { shape: 'sphere', radius: 0.17, segments: 14, color: SKIN, pos: [0, 0.17, 0], scale: [1.05, 1.05, 0.85] }, // peito
            { shape: 'sphere', radius: 0.13, segments: 12, color: SKIN, pos: [0, 0.05, 0.04], scale: [1, 0.9, 0.9] },    // barriga
            { shape: 'cone', radius: 0.03, height: 0.09, segments: 6, color: HORN, pos: [0, 0.27, -0.13], rot: [-0.9, 0, 0] }, // espinhos nas costas
            { shape: 'cone', radius: 0.03, height: 0.09, segments: 6, color: HORN, pos: [0, 0.16, -0.15], rot: [-1.1, 0, 0] },
            { shape: 'cone', radius: 0.025, height: 0.08, segments: 6, color: HORN, pos: [0, 0.05, -0.13], rot: [-1.2, 0, 0] },
          ],
          head: [
            { shape: 'sphere', radius: 0.14, segments: 14, color: SKIN, pos: [0, 0.05, 0.01], scale: [1.1, 0.95, 1] },
            { shape: 'box', size: [0.2, 0.04, 0.06], color: DARK, pos: [0, 0.09, 0.11], rot: [0.2, 0, 0] },        // sobrancelha
            { shape: 'box', size: [0.17, 0.07, 0.12], color: DARK, pos: [0, -0.04, 0.07] },                        // queixo
            { shape: 'sphere', radius: 0.045, segments: 8, color: SKIN, pos: [0, 0.03, 0.14], scale: [1.2, 0.8, 1] }, // focinho
            { shape: 'cone', radius: 0.04, height: 0.17, segments: 6, color: SKIN, pos: [0.15, 0.06, -0.01], rot: [0, 0, -1.25] }, // orelhas pontudas
            { shape: 'cone', radius: 0.04, height: 0.17, segments: 6, color: SKIN, pos: [-0.15, 0.06, -0.01], rot: [0, 0, 1.25] },
            { shape: 'cone', radius: 0.03, height: 0.15, segments: 6, color: HORN, pos: [0.07, 0.17, 0], rot: [-0.35, 0, -0.35] }, // chifres
            { shape: 'cone', radius: 0.03, height: 0.15, segments: 6, color: HORN, pos: [-0.07, 0.17, 0], rot: [-0.35, 0, 0.35] },
            { shape: 'cone', radius: 0.012, height: 0.05, segments: 5, color: BONE, pos: [0.045, -0.025, 0.14] },  // presas
            { shape: 'cone', radius: 0.012, height: 0.05, segments: 5, color: BONE, pos: [-0.045, -0.025, 0.14] },
            glowEye(0xffd040, 0.024, [0.05, 0.065, 0.125]), glowEye(0xffd040, 0.024, [-0.05, 0.065, 0.125]),
          ],
          armL: [
            { shape: 'capsule', radius: 0.045, length: 0.11, segments: 8, color: SKIN, pos: [0, -0.09, 0] },
            { shape: 'cone', radius: 0.025, height: 0.07, segments: 6, color: HORN, pos: [0.05, 0.02, 0], rot: [0, 0, -1.0] },
          ],
          foreL: [
            { shape: 'capsule', radius: 0.04, length: 0.1, segments: 8, color: SKIN, pos: [0, -0.08, 0] },
            { shape: 'sphere', radius: 0.05, segments: 8, color: SKIN, pos: [0, -0.18, 0.01], scale: [1, 0.9, 1.1] }, // mão
            { shape: 'cone', radius: 0.012, height: 0.07, segments: 5, color: BONE, pos: [0.025, -0.22, 0.04], rot: [2.6, 0, 0] }, // garras
            { shape: 'cone', radius: 0.012, height: 0.08, segments: 5, color: BONE, pos: [0, -0.225, 0.045], rot: [2.6, 0, 0] },
            { shape: 'cone', radius: 0.012, height: 0.07, segments: 5, color: BONE, pos: [-0.025, -0.22, 0.04], rot: [2.6, 0, 0] },
          ],
          legL: [{ shape: 'capsule', radius: 0.055, length: 0.1, segments: 8, color: SKIN, pos: [0, -0.1, 0] }],
          shinL: [{ shape: 'capsule', radius: 0.045, length: 0.12, segments: 8, color: SKIN, pos: [0, -0.11, -0.01] }],
          footL: [
            { shape: 'box', size: [0.08, 0.05, 0.15], color: DARK, pos: [0, 0.025, 0.04] },
            { shape: 'cone', radius: 0.01, height: 0.04, segments: 5, color: BONE, pos: [0.02, 0.015, 0.125], rot: [PI / 2, 0, 0] },
            { shape: 'cone', radius: 0.01, height: 0.04, segments: 5, color: BONE, pos: [-0.02, 0.015, 0.125], rot: [PI / 2, 0, 0] },
          ],
          tail: [
            { shape: 'cone', radius: 0.035, height: 0.32, segments: 8, color: DARK, pos: [0, -0.067, -0.145], rot: [-2.0, 0, 0] },
            { shape: 'octahedron', radius: 0.045, color: DARK, pos: [0, -0.13, -0.29], scale: [1, 1, 0.4] }, // ponta em flecha
          ],
        },
        anim: {
          gait: 'scurry', attack: 'claws', stepFreq: 15, stride: 0.6, armSwing: 0.5, hunch: 0.35, tail: true,
          pose: { armL: [-0.3, 0, 0.25], armR: [-0.3, 0, -0.25], foreL: [-0.5, 0, 0], foreR: [-0.5, 0, 0],
            legL: [-0.15, 0, 0], legR: [-0.15, 0, 0], shinL: [0.3, 0, 0], shinR: [0.3, 0, 0] },
        },
      }),
    };
  })(),

  brute: (() => { // Demônio Bruto: orc demoníaco enorme, ombreira de ferro e clava cravejada
    const SKIN = 0x6e2a1e, DARK = 0x3a1410, WOOD = 0x4a3020;
    const iron = (p) => ({ ...p, color: IRON_D, metal: true });
    return {
      glb: null, scale: 1, rotationY: 0, radius: 0.6, height: 2.4,
      creature: mirrorCreature({
        joints: {
          hips: { pos: [0, 1.02, 0] },
          spine: { parent: 'hips', pos: [0, 0.12, 0] },
          head: { parent: 'spine', pos: [0, 0.86, 0.2] },
          armL: { parent: 'spine', pos: [0.55, 0.66, 0] },
          foreL: { parent: 'armL', pos: [0, -0.46, 0] },
          legL: { parent: 'hips', pos: [0.21, -0.06, 0] },
          shinL: { parent: 'legL', pos: [0, -0.48, 0] },
          footL: { parent: 'shinL', pos: [0, -0.47, 0.03] },
        },
        parts: {
          hips: [
            { shape: 'box', size: [0.56, 0.32, 0.38], color: DARK, pos: [0, 0.02, 0] },
            { shape: 'box', size: [0.66, 0.12, 0.44], color: LEATHER_D, pos: [0, 0.14, 0] },                         // cinto
            { shape: 'sphere', radius: 0.07, segments: 10, color: BONE, pos: [0, 0.14, 0.23], scale: [1, 1.1, 0.8] }, // fivela de crânio
            { shape: 'sphere', radius: 0.016, segments: 6, color: HORN, pos: [0.025, 0.16, 0.28] },
            { shape: 'sphere', radius: 0.016, segments: 6, color: HORN, pos: [-0.025, 0.16, 0.28] },
            { shape: 'box', size: [0.32, 0.48, 0.03], color: LEATHER_D, pos: [0, -0.24, 0.2], rot: [-0.05, 0, 0] }, // tanga
            { shape: 'box', size: [0.36, 0.4, 0.03], color: LEATHER_D, pos: [0, -0.2, -0.2], rot: [0.05, 0, 0] },
          ],
          spine: [
            { shape: 'sphere', radius: 0.48, segments: 18, color: SKIN, pos: [0, 0.52, 0], scale: [1.15, 0.95, 0.78] }, // peitoral
            { shape: 'sphere', radius: 0.36, segments: 16, color: SKIN, pos: [0, 0.17, 0.06], scale: [1, 0.9, 0.85] },  // barriga
            { shape: 'cylinder', radius: 0.17, height: 0.3, segments: 10, color: SKIN, pos: [0, 0.82, 0.1], rot: [0.5, 0, 0] }, // pescoço
            { shape: 'box', size: [0.1, 1.05, 0.04], color: LEATHER_D, pos: [0, 0.5, 0.37], rot: [0.15, 0, 0.75] },     // correia no peito
            { shape: 'cone', radius: 0.06, height: 0.2, segments: 6, color: HORN, pos: [0, 0.76, -0.32], rot: [-1.0, 0, 0] }, // espinhos nas costas
            { shape: 'cone', radius: 0.06, height: 0.2, segments: 6, color: HORN, pos: [0, 0.5, -0.36], rot: [-1.2, 0, 0] },
            { shape: 'cone', radius: 0.05, height: 0.17, segments: 6, color: HORN, pos: [0.2, 0.62, -0.3], rot: [-1.0, 0, -0.3] },
            { shape: 'cone', radius: 0.05, height: 0.17, segments: 6, color: HORN, pos: [-0.2, 0.62, -0.3], rot: [-1.0, 0, 0.3] },
          ],
          head: [
            { shape: 'sphere', radius: 0.22, segments: 16, color: SKIN, pos: [0, 0.04, 0], scale: [1.1, 0.9, 1] },
            { shape: 'box', size: [0.36, 0.07, 0.1], color: DARK, pos: [0, 0.1, 0.17], rot: [0.2, 0, 0] },            // testa
            { shape: 'box', size: [0.33, 0.13, 0.2], color: SKIN, pos: [0, -0.11, 0.09] },                           // queixão
            { shape: 'sphere', radius: 0.05, segments: 8, color: DARK, pos: [0, 0.02, 0.2], scale: [1.2, 0.8, 1] },   // nariz
            { shape: 'cone', radius: 0.028, height: 0.12, segments: 6, color: BONE, pos: [0.1, -0.02, 0.19], rot: [-0.15, 0, -0.15] }, // presas
            { shape: 'cone', radius: 0.028, height: 0.12, segments: 6, color: BONE, pos: [-0.1, -0.02, 0.19], rot: [-0.15, 0, 0.15] },
            { shape: 'cone', radius: 0.07, height: 0.34, segments: 8, color: HORN, pos: [0.22, 0.16, -0.02], rot: [-0.25, 0, -1.0] }, // chifres
            { shape: 'cone', radius: 0.07, height: 0.34, segments: 8, color: HORN, pos: [-0.22, 0.16, -0.02], rot: [-0.25, 0, 1.0] },
            { shape: 'cone', radius: 0.045, height: 0.2, segments: 6, color: HORN, pos: [0.37, 0.33, -0.07], rot: [-0.4, 0, -0.2] },
            { shape: 'cone', radius: 0.045, height: 0.2, segments: 6, color: HORN, pos: [-0.37, 0.33, -0.07], rot: [-0.4, 0, 0.2] },
            glowEye(0xff7a20, 0.032, [0.08, 0.05, 0.185]), glowEye(0xff7a20, 0.032, [-0.08, 0.05, 0.185]),
          ],
          armL: [
            iron({ shape: 'sphere', radius: 0.22, segments: 14, pos: [0.05, 0.05, 0], scale: [1, 0.7, 1.05] }),     // ombreira
            iron({ shape: 'cone', radius: 0.04, height: 0.14, segments: 6, pos: [0.1, 0.19, 0], rot: [0, 0, -0.4] }),
            iron({ shape: 'cone', radius: 0.04, height: 0.14, segments: 6, pos: [0.22, 0.08, 0.08], rot: [0.3, 0, -1.0] }),
            iron({ shape: 'cone', radius: 0.04, height: 0.14, segments: 6, pos: [0.22, 0.08, -0.08], rot: [-0.3, 0, -1.0] }),
            { shape: 'capsule', radius: 0.14, length: 0.24, segments: 10, color: SKIN, pos: [0, -0.22, 0] },
          ],
          foreL: [
            { shape: 'capsule', radius: 0.13, length: 0.24, segments: 10, color: SKIN, pos: [0, -0.2, 0.02] },
            iron({ shape: 'cylinder', radiusTop: 0.14, radiusBottom: 0.15, height: 0.17, segments: 10, pos: [0, -0.27, 0.02] }), // bracelete
            { shape: 'sphere', radius: 0.13, segments: 12, color: SKIN, pos: [0, -0.46, 0.03] },                       // punho
          ],
          legL: [{ shape: 'capsule', radius: 0.16, length: 0.26, segments: 10, color: SKIN, pos: [0, -0.23, 0] }],
          shinL: [
            { shape: 'capsule', radius: 0.14, length: 0.24, segments: 10, color: SKIN, pos: [0, -0.22, 0] },
            iron({ shape: 'sphere', radius: 0.1, segments: 10, pos: [0, 0, 0.1], scale: [1, 1, 0.6] }),             // joelheira
          ],
          footL: [
            { shape: 'box', size: [0.2, 0.12, 0.32], color: DARK, pos: [0, 0.06, 0.07] },
            { shape: 'cone', radius: 0.025, height: 0.06, segments: 5, color: BONE, pos: [0.06, 0.04, 0.25], rot: [PI / 2, 0, 0] },
            { shape: 'cone', radius: 0.025, height: 0.06, segments: 5, color: BONE, pos: [-0.06, 0.04, 0.25], rot: [PI / 2, 0, 0] },
          ],
        },
        // Clava na mão direita: atravessa o punho e aponta para a frente (+Z)
        extraParts: {
          foreR: [
            { shape: 'cylinder', radius: 0.045, height: 0.55, segments: 8, color: WOOD, pos: [0, -0.47, 0.12], rot: [PI / 2, 0, 0] },
            { shape: 'cylinder', radiusTop: 0.15, radiusBottom: 0.1, height: 0.5, segments: 10, color: 0x3a2414, pos: [0, -0.47, 0.6], rot: [PI / 2, 0, 0] },
            iron({ shape: 'torus', radius: 0.12, tube: 0.02, segments: 14, pos: [0, -0.47, 0.45] }),
            iron({ shape: 'torus', radius: 0.15, tube: 0.022, segments: 14, pos: [0, -0.47, 0.78] }),
            iron({ shape: 'cone', radius: 0.03, height: 0.1, segments: 5, pos: [0.15, -0.47, 0.62], rot: [0, 0, -PI / 2] }), // cravos
            iron({ shape: 'cone', radius: 0.03, height: 0.1, segments: 5, pos: [-0.15, -0.47, 0.62], rot: [0, 0, PI / 2] }),
            iron({ shape: 'cone', radius: 0.03, height: 0.1, segments: 5, pos: [0, -0.33, 0.62] }),
            iron({ shape: 'cone', radius: 0.03, height: 0.1, segments: 5, pos: [0, -0.61, 0.62], rot: [PI, 0, 0] }),
            iron({ shape: 'cone', radius: 0.03, height: 0.1, segments: 5, pos: [0.11, -0.36, 0.72], rot: [0, 0, -PI / 4] }),
            iron({ shape: 'cone', radius: 0.03, height: 0.1, segments: 5, pos: [-0.11, -0.58, 0.72], rot: [0, 0, PI * 0.75] }),
          ],
        },
        anim: {
          gait: 'stomp', attack: 'smash', stepFreq: 6, stride: 0.45, armSwing: 0.3, hunch: 0.2,
          pose: { armL: [-0.15, 0, 0.15], armR: [-0.35, 0, -0.15], foreL: [-0.3, 0, 0], foreR: [-0.6, 0, 0] },
        },
      }),
    };
  })(),

  cultist: (() => { // Cultista: xamã orc de manto e capuz, cajado com crânio e brasa
    const ROBE = 0x2a0a0c, TRIM = 0x6a1414, HOOD = 0x1c0607, SKIN = 0x6a2a20, ROPE = 0x5a4020, WOOD = 0x2a1a10;
    return {
      glb: null, scale: 1, rotationY: 0, radius: 0.35, height: 1.9,
      creature: mirrorCreature({
        joints: {
          hips: { pos: [0, 0.95, 0] },
          spine: { parent: 'hips', pos: [0, 0.08, 0] },
          head: { parent: 'spine', pos: [0, 0.62, 0.05] },
          armL: { parent: 'spine', pos: [0.24, 0.5, 0] },
          foreL: { parent: 'armL', pos: [0, -0.3, 0] },
          legL: { parent: 'hips', pos: [0.1, -0.02, 0] },
          shinL: { parent: 'legL', pos: [0, -0.45, 0] },
          footL: { parent: 'shinL', pos: [0, -0.47, 0.02] },
        },
        parts: {
          hips: [
            { shape: 'cylinder', radiusTop: 0.24, radiusBottom: 0.34, height: 0.92, segments: 16, color: ROBE, pos: [0, -0.45, 0], scale: [1, 1, 0.85] }, // saia do manto
            { shape: 'torus', radius: 0.34, tube: 0.022, segments: 20, color: TRIM, pos: [0, -0.9, 0], rot: [PI / 2, 0, 0], scale: [1, 0.85, 1] },
            { shape: 'box', size: [0.12, 0.88, 0.02], color: TRIM, pos: [0, -0.45, 0.25], rot: [-0.09, 0, 0] },           // faixa da frente
            { shape: 'box', size: [0.5, 0.75, 0.02], color: ROBE, pos: [0, -0.32, -0.26], rot: [0.12, 0, 0] },           // capa nas costas
            { shape: 'torus', radius: 0.23, tube: 0.025, segments: 16, color: ROPE, pos: [0, 0.02, 0], rot: [PI / 2, 0, 0] }, // cordão
            { shape: 'cylinder', radius: 0.015, height: 0.3, segments: 5, color: ROPE, pos: [0.12, -0.14, 0.2], rot: [-0.1, 0, 0.1] },
          ],
          spine: [
            { shape: 'cylinder', radiusTop: 0.25, radiusBottom: 0.22, height: 0.58, segments: 14, color: ROBE, pos: [0, 0.28, 0], scale: [1, 1, 0.8] },
            { shape: 'sphere', radius: 0.27, segments: 14, color: ROBE, pos: [0, 0.52, 0], scale: [1.05, 0.5, 0.75] },  // ombros
            { shape: 'torus', radius: 0.26, tube: 0.02, segments: 18, color: TRIM, pos: [0, 0.5, 0], rot: [PI / 2, 0, 0], scale: [1.05, 0.75, 1] },
            // colar de crânios
            { shape: 'sphere', radius: 0.035, segments: 8, color: BONE, pos: [0, 0.46, 0.2] },
            { shape: 'sphere', radius: 0.03, segments: 8, color: BONE, pos: [0.08, 0.48, 0.19] },
            { shape: 'sphere', radius: 0.03, segments: 8, color: BONE, pos: [-0.08, 0.48, 0.19] },
            { shape: 'sphere', radius: 0.026, segments: 8, color: BONE, pos: [0.15, 0.5, 0.15] },
            { shape: 'sphere', radius: 0.026, segments: 8, color: BONE, pos: [-0.15, 0.5, 0.15] },
          ],
          head: [
            { shape: 'sphere', radius: 0.19, segments: 14, color: HOOD, pos: [0, 0.05, -0.02], scale: [1, 1.15, 1.1] },          // capuz
            { shape: 'cone', radius: 0.1, height: 0.26, segments: 8, color: HOOD, pos: [0, 0.16, -0.16], rot: [-1.0, 0, 0] },      // ponta caída para trás
            { shape: 'torus', radius: 0.15, tube: 0.035, segments: 14, color: HOOD, pos: [0, 0.01, 0.12], scale: [0.9, 1.1, 1] }, // borda do capuz
            { shape: 'sphere', radius: 0.12, segments: 12, color: SKIN, pos: [0, 0, 0.07], scale: [1, 1.05, 0.9] },              // rosto
            { shape: 'box', size: [0.13, 0.05, 0.08], color: SKIN, pos: [0, -0.08, 0.11] },
            { shape: 'cone', radius: 0.01, height: 0.045, segments: 5, color: BONE, pos: [0.04, -0.06, 0.15] },
            { shape: 'cone', radius: 0.01, height: 0.045, segments: 5, color: BONE, pos: [-0.04, -0.06, 0.15] },
            glowEye(0xff3a20, 0.02, [0.04, 0.03, 0.16]), glowEye(0xff3a20, 0.02, [-0.04, 0.03, 0.16]),
          ],
          armL: [{ shape: 'cylinder', radiusTop: 0.07, radiusBottom: 0.09, height: 0.3, segments: 8, color: ROBE, pos: [0, -0.15, 0] }],
          foreL: [
            { shape: 'cylinder', radiusTop: 0.09, radiusBottom: 0.13, height: 0.26, segments: 8, color: ROBE, pos: [0, -0.13, 0] }, // manga larga
            { shape: 'torus', radius: 0.13, tube: 0.015, segments: 12, color: TRIM, pos: [0, -0.26, 0], rot: [PI / 2, 0, 0] },
            { shape: 'sphere', radius: 0.05, segments: 8, color: SKIN, pos: [0, -0.31, 0.02] },
          ],
          footL: [{ shape: 'box', size: [0.1, 0.07, 0.2], color: HOOD, pos: [0, 0.035, 0.05] }],
        },
        // Cajado na mão direita: atravessa o punho apontando para +Z; com o cotovelo dobrado ele fica em pé
        extraParts: {
          foreR: [
            { shape: 'cylinder', radius: 0.022, height: 1.6, segments: 6, color: WOOD, pos: [0, -0.31, 0.2], rot: [PI / 2, 0, 0] },
            { shape: 'sphere', radius: 0.07, segments: 10, color: BONE, pos: [0, -0.31, 1.04], scale: [0.9, 1, 1.1] }, // crânio
            { shape: 'sphere', radius: 0.016, segments: 6, color: HORN, pos: [0.03, -0.25, 1.07] },
            { shape: 'sphere', radius: 0.016, segments: 6, color: HORN, pos: [-0.03, -0.25, 1.07] },
            { shape: 'cone', radius: 0.02, height: 0.1, segments: 5, color: HORN, pos: [0.06, -0.31, 1.1], rot: [PI / 2 - 0.4, 0, -0.5] },
            { shape: 'cone', radius: 0.02, height: 0.1, segments: 5, color: HORN, pos: [-0.06, -0.31, 1.1], rot: [PI / 2 - 0.4, 0, 0.5] },
            { shape: 'sphere', radius: 0.055, segments: 10, color: 0xff8a30, glow: true, pos: [0, -0.31, 1.17], castShadow: false }, // brasa
          ],
        },
        anim: {
          gait: 'glide', attack: 'cast', stepFreq: 7, stride: 0.3, armSwing: 0.15, hunch: 0.12,
          pose: { armL: [-0.2, 0, 0.1], foreL: [-0.7, 0, 0], armR: [-0.1, 0, -0.1], foreR: [-1.4, 0, 0] },
        },
      }),
    };
  })(),

  // ======================= NPCs =======================
  merchant: { // Brom, o Ferreiro — feito no VRoid Studio (VRM 1.0), com cartola
    glb: 'assets/models/merchant.vrm',
    scale: 1, rotationY: 0, radius: 0.45, height: 1.8,
    rig: 'vrm', walk: 'masculine', hold: 'tool', // parado, segurando o martelo na mão direita
    skinMaterial: 'SKIN',
    attachments: [
      // Martelo de ferreiro pendurado na mão direita (cabeça para baixo); ângulo calculado para a pose parada
      { model: 'smithHammer', bones: BONES_HAND_R, modelSpace: true, modelPos: [-0.67, 1.37, -0.02], modelRot: [-1.801, -0.356, 1.099], onlyGlb: true },
    ],
    placeholder: { parts: [ // usado só se o arquivo não carregar
      { shape: 'box', size: [0.44, 0.8, 0.3], color: 0x3a2a1a, pos: [0, 0.4, 0] },
      { shape: 'box', size: [0.66, 0.72, 0.4], color: 0x7a4a2a, pos: [0, 1.16, 0] },
      { shape: 'box', size: [0.5, 0.9, 0.04], color: 0x2a1e14, pos: [0, 0.95, 0.21] },                 // avental
      { shape: 'sphere', radius: 0.19, color: SKIN, pos: [0, 1.7, 0] },
      { shape: 'cone', radius: 0.15, height: 0.32, color: 0x8a4a1a, pos: [0, 1.52, 0.12], rot: [PI, 0, 0] }, // barba
      { shape: 'cylinder', radius: 0.03, height: 0.6, color: 0x5a3a22, pos: [0.42, 0.95, 0.15] },        // cabo do martelo
      { shape: 'box', size: [0.2, 0.12, 0.12], color: 0x4a4a50, pos: [0.42, 1.25, 0.15], mat: { metalness: 0.7, roughness: 0.4 } },
    ] },
  },

  smithHammer: { // martelo de ferreiro. Origem = onde a mão segura; o cabo vai para +Y até a cabeça
    glb: null, scale: 1, rotationY: 0, radius: 0.1, height: 0.5,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.022, radiusBottom: 0.026, height: 0.46, segments: 8, tex: 'wood', color: 0x6a4a2c, pos: [0, 0.13, 0] }, // cabo
      { shape: 'cylinder', radius: 0.03, height: 0.1, segments: 8, color: 0x3a2416, pos: [0, -0.02, 0] },                                   // empunhadura de couro
      { shape: 'box', size: [0.2, 0.085, 0.085], ...STEEL_DARK, pos: [0.02, 0.38, 0] },                                                     // cabeça
      { shape: 'cylinder', radius: 0.05, height: 0.03, segments: 10, ...STEEL, pos: [-0.095, 0.38, 0], rot: [0, 0, PI / 2] },               // face de bater
      { shape: 'box', size: [0.05, 0.06, 0.07], ...STEEL_DARK, pos: [0.13, 0.38, 0] },                                                      // pena (ponta de trás)
    ] },
  },

  // ======================= VILAREJO =======================
  house: { // casa 5 x 4 (porta virada para +Z), estilo Tristram: pedra, enxaimel e palha
    glb: null,
    scale: 1, rotationY: 0, radius: 2.5, height: 4.5,
    placeholder: { parts: [
      { shape: 'box', size: [5, 0.8, 4], tex: 'stone', color: 0x4a4644, pos: [0, 0.4, 0] },                          // base de pedra
      { shape: 'box', size: [4.8, 1.9, 3.8], tex: 'plaster', color: 0x5e5040, pos: [0, 1.75, 0] },                     // paredes (reboco sujo)
      // enxaimel: vigas escuras na frente e nos lados
      { shape: 'box', size: [0.16, 1.9, 0.1], color: 0x231810, pos: [2.32, 1.75, 1.92] },
      { shape: 'box', size: [0.16, 1.9, 0.1], color: 0x231810, pos: [-2.32, 1.75, 1.92] },
      { shape: 'box', size: [0.16, 1.9, 0.1], color: 0x231810, pos: [0.75, 1.75, 1.92] },
      { shape: 'box', size: [0.16, 1.9, 0.1], color: 0x231810, pos: [-0.75, 1.75, 1.92] },
      { shape: 'box', size: [4.9, 0.18, 0.12], color: 0x231810, pos: [0, 2.68, 1.93] },
      { shape: 'box', size: [4.9, 0.14, 0.12], color: 0x231810, pos: [0, 0.86, 1.93] },
      { shape: 'box', size: [0.1, 1.9, 0.16], color: 0x231810, pos: [2.42, 1.75, 0] },
      { shape: 'box', size: [0.1, 1.9, 0.16], color: 0x231810, pos: [-2.42, 1.75, 0] },
      { shape: 'box', size: [0.12, 0.18, 3.9], color: 0x231810, pos: [2.42, 2.68, 0] },
      { shape: 'box', size: [0.12, 0.18, 3.9], color: 0x231810, pos: [-2.42, 2.68, 0] },
      // telhado de palha: beiral largo e baixo + corpo alto
      { shape: 'cone', radius: 4.25, height: 0.7, segments: 4, tex: 'thatch', color: 0x3a3022, pos: [0, 2.95, 0], rot: [0, PI / 4, 0], scale: [1, 1, 0.84] },
      { shape: 'cone', radius: 3.8, height: 2.6, segments: 4, tex: 'thatch', color: 0x4a3e2c, pos: [0, 4.05, 0], rot: [0, PI / 4, 0], scale: [1, 1, 0.82] },
      { shape: 'box', size: [1.05, 1.7, 0.1], tex: 'wood', color: 0x1e140c, pos: [0, 0.85, 2.0] },                   // porta
      { shape: 'box', size: [0.65, 0.55, 0.06], color: 0xffaa55, emissive: 0xff7a1a, emissiveIntensity: 1.8, pos: [1.55, 1.75, 1.97], castShadow: false }, // janelas acesas
      { shape: 'box', size: [0.65, 0.55, 0.06], color: 0xffaa55, emissive: 0xff7a1a, emissiveIntensity: 1.8, pos: [-1.55, 1.75, 1.97], castShadow: false },
      { shape: 'box', size: [0.8, 0.08, 0.1], color: 0x231810, pos: [1.55, 2.06, 1.99] },                // vergas das janelas
      { shape: 'box', size: [0.8, 0.08, 0.1], color: 0x231810, pos: [-1.55, 2.06, 1.99] },
      // chaminé de pedra OCA (4 paredes): a fumaça sai pelo buraco do meio
      { shape: 'box', size: [0.6, 1.8, 0.12], tex: 'stone', color: 0x3e3a38, pos: [1.5, 4.3, -0.56] },
      { shape: 'box', size: [0.6, 1.8, 0.12], tex: 'stone', color: 0x3e3a38, pos: [1.5, 4.3, -1.04] },
      { shape: 'box', size: [0.12, 1.8, 0.36], tex: 'stone', color: 0x3e3a38, pos: [1.26, 4.3, -0.8] },
      { shape: 'box', size: [0.12, 1.8, 0.36], tex: 'stone', color: 0x3e3a38, pos: [1.74, 4.3, -0.8] },
      { shape: 'box', size: [0.36, 0.04, 0.36], color: 0x0a0807, pos: [1.5, 4.95, -0.8] },                         // fuligem lá dentro (fundo escuro do buraco)
    ] },
  },

  stall: { // barraca do ferreiro, 4 x 3 (frente para +Z)
    glb: null,
    scale: 1, rotationY: 0, radius: 2, height: 2.7,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.1, height: 2.4, color: 0x4a3020, pos: [1.8, 1.2, 1.3] },
      { shape: 'cylinder', radius: 0.1, height: 2.4, color: 0x4a3020, pos: [-1.8, 1.2, 1.3] },
      { shape: 'cylinder', radius: 0.1, height: 2.4, color: 0x4a3020, pos: [1.8, 1.2, -1.3] },
      { shape: 'cylinder', radius: 0.1, height: 2.4, color: 0x4a3020, pos: [-1.8, 1.2, -1.3] },
      { shape: 'box', size: [4.4, 0.18, 3.2], color: 0x7a2a1a, pos: [0, 2.5, 0], rot: [0.12, 0, 0] },      // toldo
      { shape: 'box', size: [3.6, 0.9, 0.8], tex: 'wood', color: 0x5a3a22, pos: [0.4, 0.45, -0.9] },                  // bancada
      { shape: 'box', size: [1.2, 1.1, 1.0], tex: 'stone', color: 0x3a3030, pos: [-1.3, 0.55, -0.6] },                 // forja
      { shape: 'box', size: [0.9, 0.1, 0.7], color: 0xff6622, emissive: 0xff3300, emissiveIntensity: 2.5, pos: [-1.3, 1.12, -0.6], castShadow: false }, // brasas
      { shape: 'box', size: [0.08, 0.06, 0.9], color: 0xc8ccd4, pos: [0.6, 0.93, -0.9], mat: { metalness: 0.8, roughness: 0.3 } },
      { shape: 'box', size: [0.08, 0.06, 0.9], color: 0xc8ccd4, pos: [1.1, 0.93, -0.9], mat: { metalness: 0.8, roughness: 0.3 } },
    ] },
  },

  anvil: {
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 0.8,
    placeholder: { parts: [
      { shape: 'box', size: [0.4, 0.5, 0.35], color: 0x2a2a2e, pos: [0, 0.25, 0] },
      { shape: 'box', size: [0.85, 0.22, 0.36], color: 0x3a3a40, pos: [0, 0.61, 0], mat: { metalness: 0.7, roughness: 0.4 } },
    ] },
  },

  well: {
    glb: null, scale: 1, rotationY: 0, radius: 1, height: 2.6,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.95, height: 0.8, segments: 10, tex: 'stone', color: 0x55504c, pos: [0, 0.4, 0] },
      { shape: 'cylinder', radius: 0.78, height: 0.05, color: 0x0a1018, pos: [0, 0.81, 0] },
      { shape: 'box', size: [0.12, 1.6, 0.12], color: 0x2e2218, pos: [0.85, 1.2, 0] },
      { shape: 'box', size: [0.12, 1.6, 0.12], color: 0x2e2218, pos: [-0.85, 1.2, 0] },
      { shape: 'cylinder', radius: 0.05, height: 1.8, color: 0x2e2218, pos: [0, 1.75, 0], rot: [0, 0, PI / 2] }, // eixo do balde
      { shape: 'cone', radius: 1.25, height: 0.8, segments: 4, tex: 'thatch', color: 0x3e3426, pos: [0, 2.35, 0], rot: [0, PI / 4, 0] },
    ] },
  },

  tree: { // árvore morta, sem folhas
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 3.2,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.08, radiusBottom: 0.22, height: 2.4, segments: 7, color: 0x2b2420, pos: [0, 1.2, 0] },
      { shape: 'cylinder', radiusTop: 0.025, radiusBottom: 0.07, height: 1.3, segments: 5, color: 0x2b2420, pos: [-0.51, 2.0, 0], rot: [0, 0, 0.9] },
      { shape: 'cylinder', radiusTop: 0.02, radiusBottom: 0.06, height: 1.1, segments: 5, color: 0x231d1a, pos: [0.39, 2.38, 0], rot: [0, 0, -0.8] },
      { shape: 'cylinder', radiusTop: 0.02, radiusBottom: 0.06, height: 1.0, segments: 5, color: 0x231d1a, pos: [0, 1.61, -0.39], rot: [-0.9, 0, 0] },
      { shape: 'cylinder', radiusTop: 0.01, radiusBottom: 0.03, height: 0.6, segments: 4, color: 0x231d1a, pos: [-1.11, 2.7, 0], rot: [0, 0, 0.3] },
      { shape: 'cylinder', radiusTop: 0.01, radiusBottom: 0.04, height: 0.7, segments: 4, color: 0x2b2420, pos: [-0.12, 2.73, 0], rot: [0, 0, 0.35] },
    ] },
  },

  fence: { // segmento de 2 unidades ao longo do eixo X
    glb: null, scale: 1, rotationY: 0, radius: 1, height: 1,
    placeholder: { parts: [
      { shape: 'box', size: [0.12, 1.0, 0.12], color: 0x3a2a1c, pos: [-0.95, 0.5, 0] },
      { shape: 'box', size: [0.12, 1.0, 0.12], color: 0x3a2a1c, pos: [0.95, 0.5, 0] },
      { shape: 'box', size: [2.0, 0.08, 0.06], color: 0x46352a, pos: [0, 0.75, 0] },
      { shape: 'box', size: [2.0, 0.08, 0.06], color: 0x46352a, pos: [0, 0.4, 0] },
    ] },
  },

  fenceBroken: { // cerca quebrada: um poste caído e uma tábua no chão
    glb: null, scale: 1, rotationY: 0, radius: 1, height: 1,
    placeholder: { parts: [
      { shape: 'box', size: [0.12, 1.0, 0.12], color: 0x3a2a1c, pos: [-0.95, 0.5, 0] },
      { shape: 'box', size: [0.12, 0.9, 0.12], color: 0x3a2a1c, pos: [0.85, 0.4, 0], rot: [0, 0, -0.5] },
      { shape: 'box', size: [1.9, 0.08, 0.06], color: 0x46352a, pos: [-0.05, 0.55, 0], rot: [0, 0, -0.22] },
      { shape: 'box', size: [1.2, 0.08, 0.06], color: 0x46352a, pos: [0.3, 0.04, 0.25], rot: [0, 0.4, 0] },
    ] },
  },

  rock: { // pedra azulada (como as de Tristram)
    glb: null, scale: 1, rotationY: 0, radius: 0.7, height: 0.6,
    placeholder: { parts: [
      { shape: 'octahedron', radius: 0.6, tex: 'stone', color: 0x464c5c, pos: [0, 0.22, 0], rot: [0.3, 0.5, 0.2], scale: [1.1, 0.6, 0.9] },
      { shape: 'octahedron', radius: 0.35, tex: 'stone', color: 0x535868, pos: [0.5, 0.14, 0.3], rot: [0.6, 1.2, 0], scale: [1, 0.7, 0.8] },
    ] },
  },

  grave: { // lápide com monte de terra (frente para +Z)
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 0.9,
    placeholder: { parts: [
      { shape: 'box', size: [0.7, 0.14, 1.2], color: 0x2a241c, pos: [0, 0.07, 0.62] },
      { shape: 'box', size: [0.55, 0.75, 0.14], tex: 'stone', color: 0x585860, pos: [0, 0.375, 0], rot: [0, 0, 0.06] },
      { shape: 'cylinder', radius: 0.275, height: 0.14, segments: 12, color: 0x585860, pos: [0.02, 0.75, 0], rot: [PI / 2, 0, 0] },
    ] },
  },

  graveCross: { // cruz de madeira com monte de terra
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 1,
    placeholder: { parts: [
      { shape: 'box', size: [0.7, 0.14, 1.2], color: 0x2a241c, pos: [0, 0.07, 0.62] },
      { shape: 'box', size: [0.1, 1.0, 0.1], color: 0x3a2c20, pos: [0, 0.5, 0], rot: [0, 0, 0.07] },
      { shape: 'box', size: [0.55, 0.1, 0.1], color: 0x3a2c20, pos: [0.02, 0.72, 0], rot: [0, 0, 0.07] },
    ] },
  },

  ruinWall: { // pedaço de parede da catedral em ruínas (3 de largura, ao longo do X)
    glb: null, scale: 1, rotationY: 0, radius: 1.5, height: 3.2,
    placeholder: { parts: [
      { shape: 'box', size: [3.0, 1.6, 0.6], tex: 'stone', color: 0x4a4650, pos: [0, 0.8, 0] },
      { shape: 'box', size: [1.0, 1.6, 0.6], tex: 'stone', color: 0x403c46, pos: [-1.0, 2.4, 0] },
      { shape: 'box', size: [0.7, 0.7, 0.6], tex: 'stone', color: 0x4a4650, pos: [-0.15, 1.95, 0] },
      { shape: 'box', size: [0.5, 0.4, 0.6], tex: 'stone', color: 0x403c46, pos: [1.0, 1.8, 0] },
      { shape: 'box', size: [0.4, 0.9, 0.62], color: 0x0c0a0e, pos: [-1.0, 2.3, 0] },            // janela gótica (vão escuro)
      { shape: 'box', size: [0.5, 0.35, 0.45], color: 0x403c46, pos: [1.5, 0.17, 0.6], rot: [0, 0.4, 0] }, // entulho
      { shape: 'box', size: [0.35, 0.3, 0.4], color: 0x4a4650, pos: [-0.4, 0.15, 0.75], rot: [0, 1, 0] },
      { shape: 'box', size: [0.4, 0.25, 0.3], color: 0x403c46, pos: [0.6, 0.12, -0.7], rot: [0, 0.3, 0] },
    ] },
  },

  ruinPillar: { // coluna quebrada
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 3,
    placeholder: { parts: [
      { shape: 'box', size: [0.9, 0.3, 0.9], tex: 'stone', color: 0x403c46, pos: [0, 0.15, 0] },
      { shape: 'cylinder', radius: 0.32, height: 2.4, segments: 8, tex: 'stone', color: 0x4a4650, pos: [0, 1.5, 0] },
      { shape: 'box', size: [0.7, 0.25, 0.7], color: 0x403c46, pos: [0, 2.8, 0], rot: [0.15, 0.3, 0.1] },
    ] },
  },

  cart: { // carroça velha
    glb: null, scale: 1, rotationY: 0, radius: 1, height: 1.3,
    placeholder: { parts: [
      { shape: 'box', size: [1.8, 0.25, 1.1], tex: 'wood', color: 0x4a3424, pos: [0, 0.75, 0] },
      { shape: 'box', size: [1.8, 0.35, 0.08], color: 0x3e2c1e, pos: [0, 1.0, 0.53] },
      { shape: 'box', size: [1.8, 0.35, 0.08], color: 0x3e2c1e, pos: [0, 1.0, -0.53] },
      { shape: 'box', size: [0.08, 0.35, 1.1], color: 0x3e2c1e, pos: [-0.9, 1.0, 0] },
      { shape: 'cylinder', radius: 0.45, height: 0.1, segments: 10, color: 0x2e2218, pos: [0.2, 0.45, 0.62], rot: [PI / 2, 0, 0] },
      { shape: 'cylinder', radius: 0.45, height: 0.1, segments: 10, color: 0x2e2218, pos: [0.2, 0.45, -0.62], rot: [PI / 2, 0, 0] },
      { shape: 'box', size: [1.4, 0.07, 0.07], color: 0x3e2c1e, pos: [1.5, 0.45, 0.4], rot: [0, 0, 0.35] },
      { shape: 'box', size: [1.4, 0.07, 0.07], color: 0x3e2c1e, pos: [1.5, 0.45, -0.4], rot: [0, 0, 0.35] },
      { shape: 'cylinder', radius: 0.4, height: 0.8, tex: 'thatch', color: 0x6e6238, pos: [-0.3, 1.15, 0], rot: [0, 0, PI / 2] }, // feno na carroça
    ] },
  },

  hay: { // fardo de feno
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 0.9,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.45, height: 0.9, tex: 'thatch', color: 0x6e6238, pos: [0, 0.45, 0], rot: [0, 0, PI / 2] },
      { shape: 'cylinder', radius: 0.46, height: 0.06, color: 0x4a4026, pos: [0.22, 0.45, 0], rot: [0, 0, PI / 2] },
      { shape: 'cylinder', radius: 0.46, height: 0.06, color: 0x4a4026, pos: [-0.22, 0.45, 0], rot: [0, 0, PI / 2] },
    ] },
  },

  stump: { // toco de árvore
    glb: null, scale: 1, rotationY: 0, radius: 0.4, height: 0.4,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.28, radiusBottom: 0.36, height: 0.4, segments: 8, color: 0x3a2c20, pos: [0, 0.2, 0] },
      { shape: 'cylinder', radius: 0.27, height: 0.02, segments: 8, color: 0x6a5438, pos: [0, 0.41, 0] },
    ] },
  },

  lantern: { // poste com lanterna pendurada (a luz é adicionada por código)
    glb: null, scale: 1, rotationY: 0, radius: 0.2, height: 2.7,
    placeholder: { parts: [
      { shape: 'box', size: [0.14, 2.6, 0.14], color: 0x2a2018, pos: [0, 1.3, 0] },
      { shape: 'box', size: [0.7, 0.08, 0.08], color: 0x2a2018, pos: [0.3, 2.5, 0] },
      { shape: 'box', size: [0.22, 0.3, 0.22], color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 2.5, pos: [0.55, 2.25, 0], castShadow: false },
      { shape: 'box', size: [0.3, 0.06, 0.3], color: 0x1a1410, pos: [0.55, 2.43, 0] },
    ] },
  },

  torch: { // tocha em poste (a luz é adicionada por código em world/props.js)
    glb: null, scale: 1, rotationY: 0, radius: 0.2, height: 2.4,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.06, height: 2.0, color: 0x3a2414, pos: [0, 1.0, 0] },
      { shape: 'cylinder', radiusTop: 0.15, radiusBottom: 0.08, height: 0.2, color: 0x2a2a2a, pos: [0, 2.05, 0] },
      { shape: 'cone', radius: 0.13, height: 0.38, color: 0xffaa33, emissive: 0xff7700, emissiveIntensity: 3, pos: [0, 2.32, 0], castShadow: false },
    ] },
  },

  barrel: {
    glb: null, scale: 1, rotationY: 0, radius: 0.4, height: 0.9,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.33, radiusBottom: 0.33, height: 0.9, tex: 'wood', color: 0x6b4a2b, pos: [0, 0.45, 0] },
      { shape: 'cylinder', radius: 0.35, height: 0.06, color: 0x2a2a2a, pos: [0, 0.7, 0] },
      { shape: 'cylinder', radius: 0.35, height: 0.06, color: 0x2a2a2a, pos: [0, 0.2, 0] },
    ] },
  },

  crate: {
    glb: null, scale: 1, rotationY: 0, radius: 0.45, height: 0.8,
    placeholder: { parts: [
      { shape: 'box', size: [0.8, 0.8, 0.8], tex: 'wood', color: 0x7a5a3a, pos: [0, 0.4, 0] },
    ] },
  },

  portalRing: { // anel de pedra do portal (o efeito de energia é feito em world/props.js)
    glb: null, scale: 1, rotationY: 0, radius: 2, height: 4,
    placeholder: { parts: [
      { shape: 'box', size: [4.4, 0.35, 1.4], color: 0x3a3540, pos: [0, 0.175, 0] },
      { shape: 'torus', radius: 1.6, tube: 0.3, segments: 32, color: 0x4a4550, pos: [0, 2.0, 0] },
      { shape: 'box', size: [0.55, 2.4, 0.7], color: 0x3a3540, pos: [1.9, 1.2, 0] },
      { shape: 'box', size: [0.55, 2.4, 0.7], color: 0x3a3540, pos: [-1.9, 1.2, 0] },
      { shape: 'box', size: [0.22, 0.22, 0.1], color: 0xff4455, emissive: 0xff2233, emissiveIntensity: 2.5, pos: [0, 3.6, 0.3], castShadow: false },
      { shape: 'box', size: [0.22, 0.22, 0.1], color: 0xff4455, emissive: 0xff2233, emissiveIntensity: 2.5, pos: [1.39, 2.8, 0.3], castShadow: false },
      { shape: 'box', size: [0.22, 0.22, 0.1], color: 0xff4455, emissive: 0xff2233, emissiveIntensity: 2.5, pos: [-1.39, 2.8, 0.3], castShadow: false },
    ] },
  },

  // ======================= OBLIVION =======================
  // Escadaria que desce para o próximo andar. Ocupa um VÃO de 2 x 3 no chão
  // (x de -1 a 1, z de -1.5 a 1.5) aberto em world/dungeon.js: os degraus começam
  // no lado +Z, descem no sentido -Z e terminam numa porta em brasa no fundo.
  // Num .glb: mesmo tamanho, com a origem no centro do vão, na altura do chão.
  stairs: {
    glb: null, scale: 1, rotationY: 0, radius: 1.3, height: 0.5,
    placeholder: { parts: [
      // paredes do poço
      { shape: 'box', size: [0.2, 2.6, 3.0], tex: 'dungeonWall', color: 0x6a6a6a, pos: [0.9, -1.3, 0] },
      { shape: 'box', size: [0.2, 2.6, 3.0], tex: 'dungeonWall', color: 0x6a6a6a, pos: [-0.9, -1.3, 0] },
      { shape: 'box', size: [2.0, 2.6, 0.2], tex: 'dungeonWall', color: 0x6a6a6a, pos: [0, -1.3, -1.4] },
      // degraus (cada um 0.35 mais baixo que o anterior)
      { shape: 'box', size: [1.6, 2.25, 0.55], tex: 'dungeonFloor', color: 0x6a5a5c, pos: [0, -1.475, 1.225] },
      { shape: 'box', size: [1.6, 1.9, 0.55], tex: 'dungeonFloor', color: 0x949494, pos: [0, -1.65, 0.675] },
      { shape: 'box', size: [1.6, 1.55, 0.55], tex: 'dungeonFloor', color: 0x949494, pos: [0, -1.825, 0.125] },
      { shape: 'box', size: [1.6, 1.2, 0.55], tex: 'dungeonFloor', color: 0x949494, pos: [0, -2.0, -0.425] },
      { shape: 'box', size: [1.6, 0.85, 0.55], tex: 'dungeonFloor', color: 0x949494, pos: [0, -2.175, -0.975] },
      // brasas na quina de cada degrau (ajudam a ler a escada no escuro)
      { shape: 'box', size: [1.5, 0.05, 0.08], color: 0x401000, emissive: 0xff4400, emissiveIntensity: 2.5, pos: [0, -0.335, 1.48], castShadow: false },
      { shape: 'box', size: [1.5, 0.05, 0.08], color: 0x401000, emissive: 0xff4400, emissiveIntensity: 2.5, pos: [0, -0.685, 0.93], castShadow: false },
      { shape: 'box', size: [1.5, 0.05, 0.08], color: 0x401000, emissive: 0xff4400, emissiveIntensity: 2.5, pos: [0, -1.035, 0.38], castShadow: false },
      { shape: 'box', size: [1.5, 0.05, 0.08], color: 0x401000, emissive: 0xff4400, emissiveIntensity: 2.5, pos: [0, -1.385, -0.17], castShadow: false },
      { shape: 'box', size: [1.5, 0.05, 0.08], color: 0x401000, emissive: 0xff4400, emissiveIntensity: 2.5, pos: [0, -1.735, -0.72], castShadow: false },
      // porta em brasa no fundo (para onde a escada leva)
      { shape: 'box', size: [0.9, 1.15, 0.04], color: 0x2a0800, emissive: 0xff3300, emissiveIntensity: 2, pos: [0, -1.175, -1.28], castShadow: false },
      { shape: 'box', size: [0.16, 1.2, 0.12], color: 0x1a1214, pos: [0.55, -1.15, -1.27] },
      { shape: 'box', size: [0.16, 1.2, 0.12], color: 0x1a1214, pos: [-0.55, -1.15, -1.27] },
      { shape: 'box', size: [1.25, 0.16, 0.12], color: 0x1a1214, pos: [0, -0.52, -1.27] },
      // borda de pedra em volta do vão (a frente, +Z, fica aberta: é a entrada)
      { shape: 'box', size: [0.3, 0.16, 3.3], color: 0x4a3e42, pos: [1.1, 0.08, 0] },
      { shape: 'box', size: [0.3, 0.16, 3.3], color: 0x4a3e42, pos: [-1.1, 0.08, 0] },
      { shape: 'box', size: [2.5, 0.16, 0.3], color: 0x4a3e42, pos: [0, 0.08, -1.65] },
      // pedras soltas
      { shape: 'box', size: [0.55, 0.4, 0.45], color: 0x2a2224, pos: [1.65, 0.2, 1.0], rot: [0, 0.5, 0] },
      { shape: 'box', size: [0.45, 0.5, 0.4], color: 0x2a2224, pos: [-1.65, 0.25, -1.2], rot: [0, 1.1, 0] },
      { shape: 'box', size: [0.5, 0.3, 0.5], color: 0x2a2224, pos: [0.7, 0.15, -2.15], rot: [0, 0.3, 0] },
    ] },
  },

  // ---------- enfeites da masmorra (world/dungeonDecor.js) ----------
  // Os de parede têm a origem NA FACE da parede, e saem dela para +Z.
  wallTorch: { // tocha presa na parede (a chama, o brilho e a luz são feitos por código)
    glb: null, scale: 1, rotationY: 0, radius: 0.2, height: 0.5,
    placeholder: { parts: [
      { shape: 'box', size: [0.13, 0.24, 0.03], color: 0x1c1a1a, mat: { metalness: 0.6, roughness: 0.55 }, pos: [0, 0, 0.015] },   // chapa
      { shape: 'box', size: [0.03, 0.03, 0.2], color: 0x1c1a1a, mat: { metalness: 0.6, roughness: 0.55 }, pos: [0, -0.05, 0.11] },  // braço
      { shape: 'cylinder', radiusTop: 0.055, radiusBottom: 0.035, height: 0.08, segments: 8, color: 0x1c1a1a, mat: { metalness: 0.6, roughness: 0.55 }, pos: [0, 0.0, 0.21] }, // argola
      { shape: 'cylinder', radiusTop: 0.032, radiusBottom: 0.022, height: 0.36, segments: 6, color: 0x3a2414, pos: [0, 0.11, 0.23], rot: [0.22, 0, 0] }, // cabo
      { shape: 'cylinder', radius: 0.045, height: 0.09, segments: 8, color: 0x1a1210, pos: [0, 0.29, 0.27], rot: [0.22, 0, 0] },    // pano queimado
    ] },
  },

  wallChains: { // duas correntes com grilhões penduradas na parede (origem = argolas no alto)
    glb: null, scale: 1, rotationY: 0, radius: 0.3, height: 1,
    placeholder: { parts: [
      ...chainParts(-0.18, 11), ...chainParts(0.18, 9),
    ] },
  },

  banner: { // estandarte rasgado (origem = barra no alto)
    glb: null, scale: 1, rotationY: 0, radius: 0.4, height: 1.2,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.018, height: 0.72, segments: 6, color: 0x2a1c12, pos: [0, 0, 0.06], rot: [0, 0, PI / 2] },     // barra
      { shape: 'sphere', radius: 0.03, segments: 8, color: 0x8a6a2a, mat: { metalness: 0.6, roughness: 0.4 }, pos: [0.37, 0, 0.06] },
      { shape: 'sphere', radius: 0.03, segments: 8, color: 0x8a6a2a, mat: { metalness: 0.6, roughness: 0.4 }, pos: [-0.37, 0, 0.06] },
      { shape: 'box', size: [0.56, 0.85, 0.012], color: 0x5a1212, mat: { roughness: 0.95 }, pos: [0, -0.44, 0.05] },                // pano
      { shape: 'box', size: [0.2, 0.3, 0.012], color: 0x5a1212, mat: { roughness: 0.95 }, pos: [-0.16, -0.95, 0.05], rot: [0, 0, -0.18] }, // pontas rasgadas
      { shape: 'box', size: [0.18, 0.22, 0.012], color: 0x4a1010, mat: { roughness: 0.95 }, pos: [0.15, -0.92, 0.05], rot: [0, 0, 0.22] },
      { shape: 'octahedron', radius: 0.11, color: 0x9a7a3a, mat: { metalness: 0.5, roughness: 0.5 }, pos: [0, -0.4, 0.06], scale: [0.8, 1.2, 0.1] }, // símbolo
      { shape: 'box', size: [0.5, 0.025, 0.014], color: 0x9a7a3a, mat: { metalness: 0.5, roughness: 0.5 }, pos: [0, -0.06, 0.056] }, // faixa dourada
    ] },
  },

  skull: { // crânio no chão
    glb: null, scale: 1, rotationY: 0, radius: 0.12, height: 0.2,
    placeholder: { parts: [
      { shape: 'sphere', radius: 0.085, segments: 10, color: 0xc8bca0, pos: [0, 0.085, 0], scale: [0.9, 0.95, 1.1] },
      { shape: 'box', size: [0.1, 0.05, 0.07], color: 0xb8ac90, pos: [0, 0.03, 0.06] },                                               // maxilar
      { shape: 'sphere', radius: 0.022, segments: 6, color: 0x140e0a, pos: [0.032, 0.095, 0.075] },                                  // olhos
      { shape: 'sphere', radius: 0.022, segments: 6, color: 0x140e0a, pos: [-0.032, 0.095, 0.075] },
    ] },
  },

  bonePile: { // ossos espalhados com um crânio
    glb: null, scale: 1, rotationY: 0, radius: 0.4, height: 0.25,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.02, height: 0.42, segments: 6, color: 0xc0b498, pos: [0, 0.03, 0], rot: [PI / 2, 0.6, 0] },
      { shape: 'cylinder', radius: 0.018, height: 0.36, segments: 6, color: 0xb4a88c, pos: [0.1, 0.05, 0.05], rot: [PI / 2, -0.9, 0] },
      { shape: 'cylinder', radius: 0.016, height: 0.3, segments: 6, color: 0xc0b498, pos: [-0.12, 0.025, 0.1], rot: [PI / 2, 1.8, 0] },
      { shape: 'cylinder', radius: 0.015, height: 0.24, segments: 6, color: 0xa89c80, pos: [0.05, 0.02, -0.15], rot: [PI / 2, 2.4, 0] },
      { shape: 'torus', radius: 0.09, tube: 0.012, arc: PI, segments: 10, color: 0xb4a88c, pos: [-0.1, 0.02, -0.08], rot: [-PI / 2, 0, 0.5] }, // costela
      { shape: 'torus', radius: 0.08, tube: 0.012, arc: PI, segments: 10, color: 0xb4a88c, pos: [-0.06, 0.02, -0.12], rot: [-PI / 2, 0, 0.5] },
      { shape: 'sphere', radius: 0.085, segments: 10, color: 0xc8bca0, pos: [0.14, 0.08, -0.04], scale: [0.9, 0.95, 1.1], rot: [0, 0.8, 0.3] }, // crânio
      { shape: 'sphere', radius: 0.02, segments: 6, color: 0x140e0a, pos: [0.19, 0.09, 0.02] },
      { shape: 'sphere', radius: 0.02, segments: 6, color: 0x140e0a, pos: [0.21, 0.09, -0.04] },
    ] },
  },

  rubble: { // pedras caídas
    glb: null, scale: 1, rotationY: 0, radius: 0.4, height: 0.3,
    placeholder: { parts: [
      { shape: 'box', size: [0.32, 0.2, 0.26], tex: 'dungeonWall', color: 0x8c8c8c, pos: [0, 0.09, 0], rot: [0.1, 0.4, 0.15] },
      { shape: 'box', size: [0.2, 0.14, 0.18], tex: 'dungeonWall', color: 0x7a7a7a, pos: [0.24, 0.06, 0.12], rot: [0.3, 1.1, 0] },
      { shape: 'box', size: [0.16, 0.1, 0.14], tex: 'dungeonWall', color: 0x8c8c8c, pos: [-0.2, 0.04, 0.16], rot: [0, 0.3, 0.4] },
      { shape: 'box', size: [0.1, 0.07, 0.1], color: 0x666666, pos: [0.08, 0.03, -0.22], rot: [0.5, 0.2, 0] },
      { shape: 'box', size: [0.08, 0.06, 0.07], color: 0x666666, pos: [-0.28, 0.03, -0.08], rot: [0, 0.7, 0.3] },
    ] },
  },

  candles: { // velas derretidas (a chaminha brilha sozinha, sem luz)
    glb: null, scale: 1, rotationY: 0, radius: 0.2, height: 0.3,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.12, height: 0.012, segments: 12, color: 0xd8cca8, pos: [0, 0.006, 0], scale: [1, 1, 0.8] },     // cera derretida
      { shape: 'cylinder', radius: 0.03, height: 0.22, segments: 8, color: 0xe0d4b0, pos: [0, 0.11, 0] },
      { shape: 'cylinder', radius: 0.025, height: 0.14, segments: 8, color: 0xd8cca6, pos: [0.07, 0.07, 0.03] },
      { shape: 'cylinder', radius: 0.022, height: 0.09, segments: 8, color: 0xe0d4b0, pos: [-0.05, 0.045, 0.06] },
      { shape: 'cone', radius: 0.012, height: 0.04, segments: 6, color: 0xffd080, emissive: 0xff9a30, emissiveIntensity: 4, pos: [0, 0.24, 0], castShadow: false },
      { shape: 'cone', radius: 0.011, height: 0.035, segments: 6, color: 0xffd080, emissive: 0xff9a30, emissiveIntensity: 4, pos: [0.07, 0.158, 0.03], castShadow: false },
      { shape: 'cone', radius: 0.01, height: 0.03, segments: 6, color: 0xffd080, emissive: 0xff9a30, emissiveIntensity: 4, pos: [-0.05, 0.105, 0.06], castShadow: false },
    ] },
  },

  dungeonPillar: { // coluna de pedra (nos pilares soltos no meio das salas)
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 2,
    placeholder: { parts: [
      { shape: 'box', size: [0.92, 0.22, 0.92], tex: 'dungeonWall', color: 0x8c8c8c, pos: [0, 0.11, 0] },                           // base
      { shape: 'box', size: [0.78, 0.12, 0.78], tex: 'dungeonWall', color: 0x7a7a7a, pos: [0, 0.28, 0] },
      { shape: 'cylinder', radius: 0.3, height: 1.42, segments: 10, tex: 'dungeonWall', color: 0x9a9a9a, pos: [0, 1.05, 0] },         // fuste
      { shape: 'torus', radius: 0.3, tube: 0.035, segments: 16, color: 0x606060, pos: [0, 0.4, 0], rot: [PI / 2, 0, 0] },
      { shape: 'box', size: [0.8, 0.14, 0.8], tex: 'dungeonWall', color: 0x7a7a7a, pos: [0, 1.82, 0] },                              // capitel
      { shape: 'box', size: [0.94, 0.16, 0.94], tex: 'dungeonWall', color: 0x8c8c8c, pos: [0, 1.96, 0] },
    ] },
  },

  // ---------- enfeites das cavernas ----------
  rockPillar: { // coluna de rocha natural (pilares soltos nas câmaras da caverna)
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 2.2,
    placeholder: { parts: [
      { shape: 'sphere', radius: 0.55, segments: 9, tex: 'caveRock', color: 0x8a6a4c, pos: [0, 0.12, 0], scale: [1, 0.45, 0.95] },        // base
      { shape: 'cylinder', radiusTop: 0.28, radiusBottom: 0.42, height: 1.3, segments: 7, tex: 'caveRock', color: 0x94735a, pos: [0, 0.8, 0], rot: [0.04, 0, -0.05] },
      { shape: 'cylinder', radiusTop: 0.36, radiusBottom: 0.26, height: 0.6, segments: 7, tex: 'caveRock', color: 0x8a6a4c, pos: [0.03, 1.72, 0], rot: [0, 0.5, 0.06] },
      { shape: 'sphere', radius: 0.38, segments: 8, tex: 'caveRock', color: 0x7a5c42, pos: [0.03, 2.02, 0], scale: [1, 0.5, 1] },        // topo
      { shape: 'sphere', radius: 0.18, segments: 6, tex: 'caveRock', color: 0x7a5c42, pos: [0.45, 0.08, 0.2], scale: [1, 0.6, 1] },     // pedras caídas
    ] },
  },

  stalagmites: { // estalagmites no chão (encostadas nas paredes)
    glb: null, scale: 1, rotationY: 0, radius: 0.3, height: 0.7,
    placeholder: { parts: [
      { shape: 'cone', radius: 0.13, height: 0.7, segments: 7, tex: 'caveRock', color: 0x9a7a5c, pos: [0, 0.35, 0] },
      { shape: 'cone', radius: 0.09, height: 0.45, segments: 6, tex: 'caveRock', color: 0x8a6a4c, pos: [0.17, 0.22, 0.06] },
      { shape: 'cone', radius: 0.06, height: 0.28, segments: 6, tex: 'caveRock', color: 0x9a7a5c, pos: [-0.12, 0.14, 0.12] },
      { shape: 'sphere', radius: 0.18, segments: 7, tex: 'caveRock', color: 0x7a5c42, pos: [0, 0.03, 0], scale: [1.3, 0.3, 1.1] },
    ] },
  },

  mushrooms: { // cogumelos de caverna que brilham de leve (sem luz própria)
    glb: null, scale: 1, rotationY: 0, radius: 0.25, height: 0.3,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 0.018, radiusBottom: 0.025, height: 0.2, segments: 6, color: 0xd8d0b0, pos: [0, 0.1, 0] },
      { shape: 'sphere', radius: 0.08, segments: 10, color: 0x60d8c0, emissive: 0x30b8a0, emissiveIntensity: 1.6, pos: [0, 0.2, 0], scale: [1, 0.45, 1], castShadow: false },
      { shape: 'cylinder', radiusTop: 0.014, radiusBottom: 0.02, height: 0.13, segments: 6, color: 0xd8d0b0, pos: [0.1, 0.065, 0.05] },
      { shape: 'sphere', radius: 0.055, segments: 8, color: 0x60d8c0, emissive: 0x30b8a0, emissiveIntensity: 1.6, pos: [0.1, 0.13, 0.05], scale: [1, 0.45, 1], castShadow: false },
      { shape: 'cylinder', radiusTop: 0.01, radiusBottom: 0.015, height: 0.08, segments: 5, color: 0xd8d0b0, pos: [-0.07, 0.04, 0.07] },
      { shape: 'sphere', radius: 0.04, segments: 8, color: 0x60d8c0, emissive: 0x30b8a0, emissiveIntensity: 1.6, pos: [-0.07, 0.085, 0.07], scale: [1, 0.45, 1], castShadow: false },
    ] },
  },

  mineSupport: { // escora de madeira contra a parede (como numa mina). Origem = face da parede
    glb: null, scale: 1, rotationY: 0, radius: 0.5, height: 1.8,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.075, height: 1.75, segments: 7, tex: 'wood', color: 0x5a3c24, pos: [-0.38, 0.875, 0.12] }, // estacas
      { shape: 'cylinder', radius: 0.075, height: 1.75, segments: 7, tex: 'wood', color: 0x5a3c24, pos: [0.38, 0.875, 0.12] },
      { shape: 'box', size: [1.0, 0.14, 0.17], tex: 'wood', color: 0x4a3020, pos: [0, 1.78, 0.12] },                            // viga de cima
      { shape: 'box', size: [0.08, 0.6, 0.06], tex: 'wood', color: 0x4a3020, pos: [-0.22, 1.5, 0.12], rot: [0, 0, -0.9] },      // mãos-francesas
      { shape: 'box', size: [0.08, 0.6, 0.06], tex: 'wood', color: 0x4a3020, pos: [0.22, 1.5, 0.12], rot: [0, 0, 0.9] },
      { shape: 'cylinder', radius: 0.02, height: 0.04, segments: 5, color: 0x2a2626, mat: { metalness: 0.6, roughness: 0.5 }, pos: [0, 1.78, 0.215], rot: [PI / 2, 0, 0] }, // cravo
    ] },
  },

  brazier: { // braseiro (a luz é adicionada por código)
    glb: null, scale: 1, rotationY: 0, radius: 0.45, height: 1.6,
    placeholder: { parts: [
      { shape: 'cylinder', radius: 0.07, height: 0.8, color: 0x1e1a1a, pos: [0, 0.4, 0] },
      { shape: 'cylinder', radiusTop: 0.42, radiusBottom: 0.2, height: 0.35, color: 0x2a2020, pos: [0, 0.95, 0], mat: { metalness: 0.6, roughness: 0.5 } },
      { shape: 'cone', radius: 0.36, height: 0.12, segments: 10, color: 0x2a0a04, emissive: 0xff3a00, emissiveIntensity: 1.3, pos: [0, 1.15, 0], castShadow: false }, // brasas (a chama é feita por código)
    ] },
  },

  waypoint: { // plataforma do portal de retorno fixo (a luz é adicionada em world/props.js)
    glb: null, scale: 1, rotationY: 0, radius: 1.5, height: 1,
    placeholder: { parts: [
      { shape: 'cylinder', radiusTop: 1.5, radiusBottom: 1.7, height: 0.25, segments: 8, color: 0x4a4650, pos: [0, 0.125, 0] },
      { shape: 'torus', radius: 1.15, tube: 0.06, segments: 40, color: 0x103040, emissive: 0x33ccff, emissiveIntensity: 2.2, pos: [0, 0.27, 0], rot: [PI / 2, 0, 0], castShadow: false },
      { shape: 'cylinder', radius: 0.5, height: 0.03, color: 0x0a2030, emissive: 0x1a6a90, emissiveIntensity: 1.5, pos: [0, 0.27, 0], castShadow: false },
      { shape: 'box', size: [0.26, 1.3, 0.26], color: 0x3a3640, pos: [1.1, 0.65, 1.1], rot: [0, PI / 4, 0] },
      { shape: 'box', size: [0.26, 1.3, 0.26], color: 0x3a3640, pos: [-1.1, 0.65, 1.1], rot: [0, PI / 4, 0] },
      { shape: 'box', size: [0.26, 1.3, 0.26], color: 0x3a3640, pos: [1.1, 0.65, -1.1], rot: [0, PI / 4, 0] },
      { shape: 'box', size: [0.26, 1.3, 0.26], color: 0x3a3640, pos: [-1.1, 0.65, -1.1], rot: [0, PI / 4, 0] },
      { shape: 'octahedron', radius: 0.14, color: 0x66ddff, emissive: 0x33ccff, emissiveIntensity: 3, pos: [1.1, 1.45, 1.1], castShadow: false },
      { shape: 'octahedron', radius: 0.14, color: 0x66ddff, emissive: 0x33ccff, emissiveIntensity: 3, pos: [-1.1, 1.45, 1.1], castShadow: false },
      { shape: 'octahedron', radius: 0.14, color: 0x66ddff, emissive: 0x33ccff, emissiveIntensity: 3, pos: [1.1, 1.45, -1.1], castShadow: false },
      { shape: 'octahedron', radius: 0.14, color: 0x66ddff, emissive: 0x33ccff, emissiveIntensity: 3, pos: [-1.1, 1.45, -1.1], castShadow: false },
    ] },
  },

  // ======================= CHEFES =======================
  finalBoss: { // Vorthrax, Senhor do Oblivion (chefe final). Peças na escala 1; `scale` aumenta tudo.
    glb: null, // ex.: 'assets/models/vorthrax.glb'
    scale: 1.45, rotationY: 0, radius: 1.4, height: 5.2,
    placeholder: { parts: [
      { shape: 'box', size: [1.1, 1.2, 0.7], color: 0x14080e, pos: [0, 0.6, 0] },                          // pernas
      { shape: 'box', size: [1.7, 1.5, 1.0], color: 0x24101c, pos: [0, 1.95, 0], mat: { metalness: 0.5, roughness: 0.5 } }, // tronco (armadura)
      { shape: 'box', size: [0.55, 0.55, 0.06], color: 0xb050ff, emissive: 0x8a20ff, emissiveIntensity: 3, pos: [0, 2.0, 0.52], castShadow: false }, // runa no peito
      { shape: 'box', size: [1.2, 0.08, 0.06], color: 0xb050ff, emissive: 0x8a20ff, emissiveIntensity: 2, pos: [0, 1.45, 0.52], castShadow: false },  // faixa da cintura
      { shape: 'sphere', radius: 0.48, color: 0x1a0a14, pos: [1.0, 2.6, 0], mat: { metalness: 0.6, roughness: 0.4 } }, // ombreiras
      { shape: 'sphere', radius: 0.48, color: 0x1a0a14, pos: [-1.0, 2.6, 0], mat: { metalness: 0.6, roughness: 0.4 } },
      { shape: 'cone', radius: 0.12, height: 0.6, color: 0x0a0408, pos: [1.15, 3.1, 0] },                   // espinhos dos ombros
      { shape: 'cone', radius: 0.12, height: 0.6, color: 0x0a0408, pos: [-1.15, 3.1, 0] },
      { shape: 'sphere', radius: 0.42, color: 0x2a0e1a, pos: [0, 3.05, 0.05] },                             // cabeça
      { shape: 'sphere', radius: 0.07, color: 0xe0b0ff, emissive: 0xa040ff, emissiveIntensity: 3.5, pos: [0.15, 3.1, 0.42], castShadow: false }, // olhos
      { shape: 'sphere', radius: 0.07, color: 0xe0b0ff, emissive: 0xa040ff, emissiveIntensity: 3.5, pos: [-0.15, 3.1, 0.42], castShadow: false },
      // coroa de chifres em brasa
      { shape: 'cone', radius: 0.13, height: 0.9, color: 0x401000, emissive: 0xff4400, emissiveIntensity: 1.2, pos: [0.38, 3.65, -0.05], rot: [0, 0, -0.45] },
      { shape: 'cone', radius: 0.13, height: 0.9, color: 0x401000, emissive: 0xff4400, emissiveIntensity: 1.2, pos: [-0.38, 3.65, -0.05], rot: [0, 0, 0.45] },
      { shape: 'cone', radius: 0.09, height: 0.6, color: 0x401000, emissive: 0xff4400, emissiveIntensity: 1.2, pos: [0, 3.65, -0.1] },
      { shape: 'cone', radius: 0.08, height: 0.5, color: 0x401000, emissive: 0xff4400, emissiveIntensity: 1.2, pos: [0.2, 3.55, 0.25], rot: [0.3, 0, -0.2] },
      { shape: 'cone', radius: 0.08, height: 0.5, color: 0x401000, emissive: 0xff4400, emissiveIntensity: 1.2, pos: [-0.2, 3.55, 0.25], rot: [0.3, 0, 0.2] },
      // braços
      { shape: 'box', size: [0.42, 1.35, 0.42], color: 0x24101c, pos: [1.12, 1.8, 0.1] },
      { shape: 'box', size: [0.42, 1.35, 0.42], color: 0x24101c, pos: [-1.12, 1.8, 0.1] },
      // asas (placas finas abertas para trás)
      { shape: 'box', size: [1.9, 1.5, 0.06], color: 0x16060e, pos: [1.25, 2.9, -0.65], rot: [0.2, 0.5, -0.35] },
      { shape: 'box', size: [1.9, 1.5, 0.06], color: 0x16060e, pos: [-1.25, 2.9, -0.65], rot: [0.2, -0.5, 0.35] },
      // espada grande com lâmina sombria
      { shape: 'cylinder', radius: 0.07, height: 0.9, color: 0x2a1a10, pos: [1.25, 1.2, 0.55], rot: [0.3, 0, 0] },  // cabo
      { shape: 'box', size: [0.6, 0.1, 0.14], color: 0x3a2a30, pos: [1.25, 1.62, 0.68], rot: [0.3, 0, 0] },         // guarda
      { shape: 'box', size: [0.2, 2.4, 0.08], color: 0x2a1030, emissive: 0x7a20ff, emissiveIntensity: 1.3, pos: [1.25, 2.85, 1.05], rot: [0.3, 0, 0], mat: { metalness: 0.7, roughness: 0.3 } },
    ] },
  },

  // Fenrak, o Lobisomem Acorrentado (chefe do andar 5): modelo feito no Blender, sem ossos.
  // O esqueleto é montado no jogo (autoRig): juntas medidas no próprio modelo, em metros,
  // com os pés em y = 0 e o focinho para +Z. Pernas digitígradas: quadril → joelho (à frente)
  // → jarrete (para trás) → pata. Crânio e focinho são ossos à parte, presos à cabeça,
  // só para os chifres e o focinho seguirem a cabeça direitinho.
  werewolf: {
    glb: 'assets/models/werewolf.glb',
    scale: 1, rotationY: 0, radius: 0.8, height: 3.0,
    // a ferrugem da armadura era procedural no Blender (não exporta): aqui vira ferro enferrujado
    materialOverrides: { PREVIA_Armadura: { color: 0x6a4030, metalness: 0.45, roughness: 0.7 } },
    autoRig: mirrorAutoRig({
      joints: {
        hips: { at: [0, 1.1, -0.03] },
        spine: { parent: 'hips', at: [0, 1.35, 0] },
        chest: { parent: 'spine', at: [0, 1.85, -0.03] },
        head: { parent: 'chest', at: [0, 2.3, 0.1], tip: [0, 2.45, 0.5] },
        snout: { parent: 'head', at: [0, 2.4, 0.5], tip: [0, 2.35, 0.85] },
        skull: { parent: 'head', at: [0, 2.6, 0.05], tip: [0, 2.95, -0.15] },
        armL: { parent: 'chest', at: [0.5, 2.1, 0] },
        foreL: { parent: 'armL', at: [0.78, 1.55, 0.02] },
        handL: { parent: 'foreL', at: [0.94, 0.97, 0.17], tip: [0.95, 0.5, 0.03] },
        legL: { parent: 'hips', at: [0.24, 1.07, 0] },
        shinL: { parent: 'legL', at: [0.4, 0.76, 0.15] },
        hockL: { parent: 'shinL', at: [0.42, 0.33, -0.17] },
        footL: { parent: 'hockL', at: [0.43, 0.05, 0.2], tip: [0.43, 0.05, 0.39] },
      },
      anim: {
        gait: 'stomp', attack: 'claws', stepFreq: 6.5, stride: 0.38, armSwing: 0.3, hunch: 0.05,
        pose: { foreL: [-0.15, 0, 0], foreR: [-0.15, 0, 0] },
      },
    }),
    placeholder: { parts: [ // usado só se o arquivo não carregar
      { shape: 'capsule', radius: 0.45, length: 1.2, color: 0x3a3a40, pos: [0, 1.6, 0] },
      { shape: 'sphere', radius: 0.3, color: 0x3a3a40, pos: [0, 2.4, 0.3] },
      { shape: 'cone', radius: 0.06, height: 0.5, color: 0x16100c, pos: [0.2, 2.8, 0], rot: [-0.5, 0, -0.3] },
      { shape: 'cone', radius: 0.06, height: 0.5, color: 0x16100c, pos: [-0.2, 2.8, 0], rot: [-0.5, 0, 0.3] },
      { shape: 'box', size: [0.25, 1.0, 0.3], color: 0x3a3a40, pos: [0.25, 0.5, 0] },
      { shape: 'box', size: [0.25, 1.0, 0.3], color: 0x3a3a40, pos: [-0.25, 0.5, 0] },
    ] },
  },

  bossDemon: { // Belzorath, o Carcereiro
    glb: null, // ex.: 'assets/models/belzorath.glb'
    scale: 1, rotationY: 0, radius: 1.0, height: 3.6,
    placeholder: { parts: [
      { shape: 'box', size: [1.1, 1.2, 0.7], color: 0x2a0e0a, pos: [0, 0.6, 0] },                          // pernas
      { shape: 'box', size: [1.7, 1.5, 1.0], color: 0x4a1610, pos: [0, 1.95, 0] },                         // tronco
      { shape: 'box', size: [0.5, 0.5, 0.06], color: 0xff6622, emissive: 0xff4400, emissiveIntensity: 2.5, pos: [0, 2.0, 0.52], castShadow: false }, // runa no peito
      { shape: 'sphere', radius: 0.42, color: 0x3a0e0a, pos: [1.0, 2.6, 0] },                               // ombreiras
      { shape: 'sphere', radius: 0.42, color: 0x3a0e0a, pos: [-1.0, 2.6, 0] },
      { shape: 'cone', radius: 0.12, height: 0.5, color: 0x150806, pos: [1.1, 3.05, 0] },
      { shape: 'cone', radius: 0.12, height: 0.5, color: 0x150806, pos: [-1.1, 3.05, 0] },
      { shape: 'sphere', radius: 0.42, color: 0x5a1a12, pos: [0, 3.05, 0.05] },                             // cabeça
      { shape: 'cone', radius: 0.14, height: 0.8, color: 0x150806, pos: [0.35, 3.55, -0.05], rot: [0, 0, -0.5] }, // chifres
      { shape: 'cone', radius: 0.14, height: 0.8, color: 0x150806, pos: [-0.35, 3.55, -0.05], rot: [0, 0, 0.5] },
      { shape: 'sphere', radius: 0.07, color: 0xffee55, emissive: 0xffbb00, emissiveIntensity: 3, pos: [0.15, 3.1, 0.42], castShadow: false },
      { shape: 'sphere', radius: 0.07, color: 0xffee55, emissive: 0xffbb00, emissiveIntensity: 3, pos: [-0.15, 3.1, 0.42], castShadow: false },
      { shape: 'box', size: [0.4, 1.3, 0.4], color: 0x4a1610, pos: [1.1, 1.8, 0.1] },                       // braços
      { shape: 'box', size: [0.4, 1.3, 0.4], color: 0x4a1610, pos: [-1.1, 1.8, 0.1] },
      { shape: 'cylinder', radius: 0.06, height: 2.4, color: 0x2a1a10, pos: [1.25, 1.6, 0.5], rot: [0.3, 0, 0] }, // cabo do machado
      { shape: 'box', size: [0.08, 0.9, 0.7], color: 0x3a3030, emissive: 0x440800, emissiveIntensity: 1, pos: [1.25, 2.7, 0.85], rot: [0.3, 0, 0], mat: { metalness: 0.7, roughness: 0.4 } },
    ] },
  },
};
