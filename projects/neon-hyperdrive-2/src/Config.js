import { detectLanguage, isLanguage } from './I18n.js';

// Configurações centralizadas de NEON HYPERDRIVE 2.
// Unidades: 1 unidade ~ 1 metro; a velocidade exibida no HUD é multiplicada por speedDisplayFactor.

export const CONFIG = {
  race: {
    laps: 3,
    racerCount: 8,
    checkpointsPerLap: 6,
    gridRowSpacing: 13,
    gridLaneOffset: 5.5,
    resultsDelay: 2.8,
    speedDisplayFactor: 6.2,
  },

  track: {
    halfWidth: 17,
    shoulderWidth: 5,
    wallHeight: 2.4,
    groundY: -70,
    sampleSpacing: 2,
    ribbonStep: 4,
    energyLaneHalf: 6.5,
  },

  physics: {
    hoverHeight: 1.1,
    gravity: 70,
    jumpImpulse: 23,
    coastDrag: 0.16,
    brakeForce: 100,
    driftGripFactor: 0.28,
    driftTurnBoost: 1.5,
    turnScrub: 0.42,
    alignAssist: 0.5,
    boostSpeedBonus: 0.26,
    boostAccelFactor: 1.9,
    boostDrain: 0.3,
    boostRegen: 0.07,
    boostEnergyCost: 2.5,
    padSpeedBonus: 0.24,
    padDuration: 1.7,
    padRefill: 0.35,
    shoulderSpeedFactor: 0.5,
    rechargeRate: 24,
    shipHalfWidth: 1.7,
    shipHalfLength: 2.7,
    wallDamage: 0.16,
    shipDamage: 0.1,
    invulnTime: 1.2,
    fallPenalty: 12,
    respawnEnergy: 0.4,
    lowEnergyRatio: 0.25,
  },

  ai: {
    lineGain: 180,
    rubberBandEnabled: true, // os valores do rubber banding ficam em DIFFICULTY
  },

  camera: {
    baseFov: 66,
    speedFov: 16,
    boostFov: 11,
    modes: [
      { id: 'near', dist: 10.5, height: 3.6, look: 14 },
      { id: 'far', dist: 17, height: 6.8, look: 18 },
      { id: 'cockpit', cockpit: true },
    ],
  },

  defaults: {
    language: 'pt', // substituído pelo idioma do navegador na primeira execução
    difficulty: 'casual',
    quality: 'medium',
    crt: true,
    shadows: false,
    master: 0.8,
    engine: 0.55,
    sfx: 0.8,
    music: 0.65,
  },
};

// Controles pelo mouse (pensados para as TVs do Second Life, onde o clique chega
// à página mas o teclado nem sempre chega). Ver src/PointerControls.js.
// Ligam sozinhos no navegador do Second Life; ?mouse=1 força, ?mouse=0 desliga.
export const POINTER = {
  autoThrottle: false,  // true = acelera sozinho durante a corrida (para jogar só com o mouse)
  steerSpan: 0.32,      // fração da largura da tela, a partir do centro, para virar 100%
  deadZone: 0.06,       // zona morta no centro (fração de steerSpan) para andar reto
  boostBurst: 1.6,      // segundos de boost a cada clique no botão BOOST
};

export const QUALITY = {
  low:    { pixelRatio: 1,    bloom: false, msaa: 0, particles: 0.3, buildings: 0.4, speedLines: 40 },
  medium: { pixelRatio: 1.25, bloom: true,  msaa: 0, particles: 0.7, buildings: 0.8, speedLines: 80 },
  high:   { pixelRatio: 2,    bloom: true,  msaa: 4, particles: 1.0, buildings: 1.0, speedLines: 120 },
};

/**
 * Perfis de dificuldade da IA. 'casual' é o comportamento original (pensado para jogadores casuais).
 *  speedBase/speedSkill: velocidade máxima da IA = base + skill * speedSkill (fração da nave de referência)
 *  corner: multiplicador da velocidade com que a IA contorna as curvas
 *  mistakeGap: multiplicador do intervalo entre erros de pilotagem (maior = erra menos)
 *  boostEager: quanto antes a IA aciona o boost (0..0.5)
 *  rubberBand: ajuda à IA que ficou para trás / alívio da IA que disparou à frente do jogador (distâncias em metros)
 */
export const DIFFICULTY = {
  casual: {
    speedBase: 0.9, speedSkill: 0.085, corner: 1, mistakeGap: 1, boostEager: 0,
    rubberBand: { farBehind: 260, maxHelp: 0.04, farAhead: 320, maxSlow: 0.06, range: 450 },
  },
  hard: {
    speedBase: 0.965, speedSkill: 0.04, corner: 1.04, mistakeGap: 2.5, boostEager: 0.2,
    rubberBand: { farBehind: 160, maxHelp: 0.07, farAhead: 600, maxSlow: 0.02, range: 450 },
  },
};

export const SHIPS = [
  {
    id: 'falcon',
    name: 'VORTEX FALCON',
    color: 0xff2bd6,
    accent: 0x00e5ff,
    rating: { speed: 4, accel: 4, handling: 4, energy: 3, boost: 4 },
    stats: { maxSpeed: 165, accel: 70, turn: 1.55, grip: 5.5, energy: 100, boost: 1.0 },
    design: { length: 4.6, width: 3.2, wingSpan: 1.9, engines: [-0.55, 0.55], engineRadius: 0.32, features: ['winglets'] },
  },
  {
    id: 'spear',
    name: 'CRIMSON SPEAR',
    color: 0xff1f5a,
    accent: 0x00e5ff,
    rating: { speed: 5, accel: 3, handling: 2, energy: 2, boost: 5 },
    stats: { maxSpeed: 178, accel: 64, turn: 1.3, grip: 4.4, energy: 85, boost: 1.12 },
    design: { length: 5.4, width: 2.5, wingSpan: 1.5, engines: [0], engineRadius: 0.46, features: ['canards', 'spike'] },
  },
  {
    id: 'warden',
    name: 'ION WARDEN',
    color: 0xc23bff,
    accent: 0x00e5ff,
    rating: { speed: 3, accel: 2, handling: 4, energy: 5, boost: 3 },
    stats: { maxSpeed: 160, accel: 55, turn: 1.5, grip: 6.0, energy: 140, boost: 0.95 },
    design: { length: 4.4, width: 3.8, wingSpan: 2.0, engines: [-0.8, 0, 0.8], engineRadius: 0.28, features: ['armor'] },
  },
];

// Atributos exibidos nos cartões de nave (rótulos em I18n.js: stat.<chave>).
export const STAT_KEYS = ['speed', 'accel', 'handling', 'energy', 'boost'];

// skill: 0..1 (trajetória, frenagem, velocidade); aggression: disposição para ultrapassar e usar boost.
export const AI_ROSTER = [
  { name: 'NOVA KESTREL', ship: 'spear',  color: 0x00e5ff, accent: 0xffffff, skill: 0.97, aggression: 0.9 },
  { name: 'ZED-9',        ship: 'falcon', color: 0xff8a1f, accent: 0xffe14d, skill: 0.93, aggression: 0.7 },
  { name: 'LYRA VOSS',    ship: 'falcon', color: 0x3dffa0, accent: 0xffffff, skill: 0.90, aggression: 0.8 },
  { name: 'IRON MANTIS',  ship: 'warden', color: 0xffe14d, accent: 0xff3b30, skill: 0.87, aggression: 0.5 },
  { name: 'HALO DRIFT',   ship: 'spear',  color: 0x4d7cff, accent: 0x00e5ff, skill: 0.84, aggression: 0.6 },
  { name: 'QUASAR JIN',   ship: 'falcon', color: 0xff3b30, accent: 0xff8a1f, skill: 0.80, aggression: 0.9 },
  { name: 'ECHO VANTA',   ship: 'warden', color: 0xb9c4ff, accent: 0x8a4bff, skill: 0.76, aggression: 0.4 },
];

// Pontos de controle: [x, y, z]. Seções em frações (0..1) do comprimento da pista.
export const TRACKS = [
  {
    id: 'aurora',
    name: 'AURORA SKYWAY',
    difficulty: 'medium',
    seed: 1337,
    palette: {
      edgeL: 0x00e5ff, edgeR: 0xff2bd6, accent: 0xff8a1f,
      fog: 0x140630, skyTop: 0x030110, skyMid: 0x1e0845, horizon: 0x7a1878,
      sunTop: 0xffd23f, sunBottom: 0xff2a7a,
      grid: 0xff2bd6, gridBase: 0x07020f,
      mountain: 0x0a0418, mountainLine: 0x00e5ff, mountainLine2: 0xb04bff,
      buildings: [0x00e5ff, 0xff2bd6, 0x7a5cff, 0xff8a1f],
    },
    points: [
      [-500, 0, 700], [0, 0, 700], [500, 0, 700], [900, 5, 640], [1150, 20, 400],
      [1200, 35, 100], [1050, 40, -150], [800, 30, -260], [600, 20, -200], [480, 12, -40],
      [310, 8, 60], [190, 8, 30], [140, 10, -70], [190, 15, -170], [230, 25, -340],
      [120, 45, -560], [-150, 60, -680], [-480, 60, -640], [-740, 45, -460], [-800, 30, -200],
      [-660, 18, 0], [-720, 10, 220], [-880, 4, 420], [-880, 0, 580], [-800, 0, 680],
    ],
    tunnels: [[0.27, 0.37], [0.74, 0.8]],
    open: [[0.085, 0.14], [0.64, 0.72]],
    energy: [[0.175, 0.205], [0.885, 0.905]],
    boostPads: [{ t: 0.03, d: 0 }, { t: 0.23, d: -7 }, { t: 0.59, d: 6 }, { t: 0.78, d: 0 }],
    jumps: [0.11, 0.845],
  },
  {
    id: 'abyss',
    name: 'CRIMSON ABYSS',
    difficulty: 'high',
    seed: 4242,
    palette: {
      edgeL: 0xff3b30, edgeR: 0xff9a1f, accent: 0x00e5ff,
      fog: 0x080a2c, skyTop: 0x01010c, skyMid: 0x0a1040, horizon: 0x4a2296,
      sunTop: 0xff6ad5, sunBottom: 0x6a2bff,
      grid: 0x2b7bff, gridBase: 0x02030f,
      mountain: 0x05061a, mountainLine: 0xff3b6a, mountainLine2: 0x4d7cff,
      buildings: [0xff3b30, 0xff9a1f, 0x4d7cff, 0xff2bd6],
    },
    points: [
      [-300, 0, 650], [200, 0, 650], [600, 10, 600], [850, 30, 400], [820, 50, 150],
      [620, 55, 20], [400, 40, 100], [300, 25, 280], [160, 15, 360], [20, 15, 280],
      [-20, 25, 100], [80, 40, -120], [300, 55, -280], [560, 65, -330], [760, 70, -480],
      [720, 60, -700], [480, 45, -800], [100, 35, -760], [-300, 30, -640], [-620, 40, -420],
      [-780, 30, -120], [-700, 15, 180], [-820, 5, 420], [-700, 0, 600],
    ],
    tunnels: [[0.215, 0.27], [0.78, 0.85]],
    open: [[0.05, 0.075], [0.4, 0.47], [0.66, 0.75]],
    energy: [[0.13, 0.16], [0.88, 0.905]],
    boostPads: [{ t: 0.02, d: 0 }, { t: 0.19, d: 6 }, { t: 0.5, d: -5 }, { t: 0.76, d: 0 }],
    jumps: [0.09, 0.63],
  },
  {
    id: 'carnival',
    name: 'LUNA CARNIVAL',
    difficulty: 'mediumHigh',
    seed: 7788,
    theme: 'park',
    banners: ['LUNA CARNIVAL', 'banner.spin', 'banner.fright', 'banner.candy'], // chaves de I18n.js ou texto literal
    palette: {
      edgeL: 0xffd23f, edgeR: 0xff4fa3, accent: 0x3dffe0,
      fog: 0x080a26, skyTop: 0x01020c, skyMid: 0x0a1244, horizon: 0x2c2f8f,
      sunTop: 0xfff2c0, sunBottom: 0xfff2c0, moon: 0xfff0c8,
      grid: 0x8a4bff, gridBase: 0x03030f,
      mountain: 0x06071a, mountainLine: 0x6a5bff, mountainLine2: 0xff4fa3,
      buildings: [0xffd23f, 0xff4fa3, 0x3dffe0, 0x8a4bff, 0xff8a1f],
    },
    // Rodas-gigantes no mundo: [x, z, raio, rotação Y]
    park: { wheels: [[330, 300, 170, 0.3], [-360, -420, 150, 1.2]] },
    points: [
      [-400, 0, 600], [100, 0, 600], [550, 0, 580], [880, 25, 420], [980, 70, 140],
      [860, 95, -140], [600, 60, -300], [360, 20, -200], [200, 15, 20], [20, 30, 120],
      [-140, 55, 0], [-120, 80, -220], [60, 100, -440], [320, 90, -640], [240, 60, -840],
      [-40, 40, -900], [-380, 20, -800], [-640, 45, -580], [-720, 75, -280], [-600, 40, -20],
      [-700, 15, 220], [-800, 0, 440], [-660, 0, 580],
    ],
    tunnels: [[0.34, 0.4], [0.7, 0.76]],
    open: [[0.085, 0.12], [0.25, 0.31], [0.535, 0.572]],
    energy: [[0.145, 0.175], [0.87, 0.895]],
    boostPads: [{ t: 0.03, d: 0 }, { t: 0.21, d: -6 }, { t: 0.48, d: 5 }, { t: 0.8, d: 0 }],
    jumps: [0.1, 0.655],
  },
  {
    id: 'tokyo',
    name: 'NEO TOKYO EXPRESS',
    difficulty: 'high',
    seed: 2187,
    theme: 'tokyo',
    banners: ['ネオ東京', '超高速', '電脳ハイウェイ', '未来都市'],
    palette: {
      edgeL: 0x00f0ff, edgeR: 0xff2a6d, accent: 0xfff23f,
      fog: 0x10062a, skyTop: 0x02010d, skyMid: 0x1a0740, horizon: 0x8a1a5a,
      sunTop: 0xff5a3c, sunBottom: 0xff1f5a,
      grid: 0xff2a6d, gridBase: 0x05020f,
      mountain: 0x08051a, mountainLine: 0x00f0ff, mountainLine2: 0xff2a6d,
      buildings: [0x00f0ff, 0xff2a6d, 0xfff23f, 0xb04bff, 0xffffff],
    },
    points: [
      [-450, 0, 650], [50, 0, 650], [500, 0, 650], [780, 10, 560], [900, 25, 320],
      [820, 40, 80], [600, 40, -40], [420, 30, 60], [240, 30, -60], [160, 45, -280],
      [320, 60, -480], [540, 60, -520], [610, 58, -680], [430, 50, -830], [80, 35, -820], [-160, 25, -640],
      [-200, 25, -380], [-420, 35, -240], [-700, 40, -320], [-900, 30, -140], [-860, 15, 120],
      [-760, 10, 290], [-800, 5, 440], [-760, 0, 590], [-620, 0, 650],
    ],
    tunnels: [[0.2, 0.29], [0.6, 0.68]],
    open: [[0.09, 0.125], [0.365, 0.4], [0.54, 0.59], [0.706, 0.736]],
    energy: [[0.155, 0.185], [0.86, 0.885]],
    boostPads: [{ t: 0.03, d: 0 }, { t: 0.43, d: -6 }, { t: 0.615, d: 5 }, { t: 0.845, d: 0 }],
    jumps: [0.105, 0.447],
  },
  {
    id: 'ice',
    name: 'BOREAL DRIFT',
    difficulty: 'mediumHigh',
    seed: 9051,
    theme: 'ice',
    grip: 0.82, // pista escorregadia: multiplicador de aderência
    road: { color: 0x14304a, roughness: 0.18 },
    banners: ['AURORA BOREALIS', 'banner.village', 'banner.thinIce', 'banner.below'],
    palette: {
      edgeL: 0x4dffc3, edgeR: 0x5aa8ff, accent: 0xd58bff,
      fog: 0x06142a, skyTop: 0x01030c, skyMid: 0x06163a, horizon: 0x124a6e,
      sunTop: 0xe8f6ff, sunBottom: 0xe8f6ff, moon: 0xe8f6ff,
      grid: 0x5ad8ff, gridBase: 0x040a16,
      mountain: 0x0b1830, mountainLine: 0xcfefff, mountainLine2: 0x4dffc3,
      buildings: [0x4dffc3, 0x5aa8ff, 0xd58bff, 0xffc97a, 0xbfefff],
    },
    points: [
      [-500, 0, 620], [0, 0, 620], [480, 5, 600], [820, 20, 440], [940, 40, 160],
      [860, 55, -120], [640, 50, -320], [360, 35, -360], [140, 25, -220], [-40, 20, -20],
      [-260, 30, 60], [-420, 45, -120], [-360, 60, -380], [-120, 70, -560], [140, 70, -680],
      [200, 62, -840], [40, 52, -960], [-240, 45, -960], [-540, 35, -820], [-760, 30, -560],
      [-900, 20, -260], [-880, 10, 60], [-960, 5, 340], [-820, 0, 560], [-660, 0, 620],
    ],
    tunnels: [[0.2, 0.28], [0.72, 0.8]],
    open: [[0.085, 0.12], [0.53, 0.59], [0.84, 0.875]],
    energy: [[0.14, 0.17], [0.885, 0.91]],
    boostPads: [{ t: 0.03, d: 0 }, { t: 0.33, d: -6 }, { t: 0.5, d: 5 }, { t: 0.7, d: 0 }],
    jumps: [0.1, 0.4],
  },
];

// Chave própria do 2: o primeiro NEON HYPERDRIVE pode estar no mesmo domínio do GitHub Pages.
const STORAGE_KEY = 'neon-hyperdrive-2-settings';

export function loadSettings() {
  const settings = { ...CONFIG.defaults, language: detectLanguage() };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const key of Object.keys(settings)) {
      if (typeof saved[key] === typeof settings[key]) settings[key] = saved[key];
    }
  } catch { /* armazenamento indisponível: usa os padrões */ }
  if (!QUALITY[settings.quality]) settings.quality = CONFIG.defaults.quality;
  if (!DIFFICULTY[settings.difficulty]) settings.difficulty = CONFIG.defaults.difficulty;
  if (!isLanguage(settings.language)) settings.language = detectLanguage();
  return settings;
}

export function saveSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignora */ }
}
