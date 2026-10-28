// =============================================================
// dungeonThemes.js — o visual do Oblivion muda a cada faixa de andares.
//
// Cada tema vale para CONFIG.world.bossEvery andares (5): andares 1–5 usam
// o primeiro tema, 6–10 o segundo, e assim por diante. Quando acabar a lista,
// os andares mais fundos repetem o último tema.
//
// Cores "tint" multiplicam as texturas em tons de cinza (core/textures.js):
// mudando só os números daqui, a masmorra inteira muda de clima.
//
//   decor → chance (0..1) ou quantidade de cada enfeite (world/dungeonDecor.js)
// =============================================================
import { CONFIG } from '../config.js';

export const DUNGEON_THEMES = [
  {
    id: 'burningCatacombs',
    name: 'Catacumbas Ardentes',            // andares 1–5
    floorTint: 0x9a807a,                     // lajes do chão
    wallTint: 0xa88a90,                      // blocos das paredes
    wallTopTint: 0x4a3a3e,                   // topo das paredes (visto de cima)
    wallBaseShade: 0.45,                     // pé da parede mais escuro (fuligem/sombra): 0 = preto, 1 = sem efeito
    floorCornerShade: 0.55,                  // chão escurece encostado nas paredes
    background: 0x0a0303,
    fog: { color: 0x1c0505, near: 44, far: 80 },
    hemisphere: { sky: 0xb05040, ground: 0x301010, intensity: 1.35 },
    sun: { color: 0xff7050, intensity: 0.9 },
    playerLight: { color: 0xffb070, intensity: 30, distance: 16 },
    emberColor: 0xff6a2a,
    lavaLight: 0xff4400,                     // luz sobre as poças
    pool: { texture: 'lava', tint: 0xffffff, glow: 0xffffff, intensity: 1.3 }, // poças: lava (branco = cor original da textura)
    torch: { color: 0xff7a2a, intensity: 9, distance: 8 },
    decor: {
      torchSpacing: 6,       // distância mínima entre tochas de parede (em células)
      torchesPerRoom: 2,     // tochas por sala (em média)
      chains: 0.1,           // chance, em cada trecho de parede livre, de correntes com grilhões
      banners: 0.07,         // ... de um estandarte rasgado
      bones: 0.05,           // chance, em cada célula de chão encostada na parede, de ossos/crânio
      rubble: 0.04,          // entulho
      candles: 0.025,        // velas derretidas
      stains: 0.03,          // manchas de sangue/fuligem no chão
      stainColor: 0x2a0806,
    },
  },

  {
    id: 'greyDungeons',
    name: 'Masmorras de Pedra Cinzenta',     // andares 6–10
    floorTint: 0x8e8e8e,                     // pedra cinza neutra (sem puxar para o vermelho)
    wallTint: 0x9c9c9c,
    wallTopTint: 0x3e3e3e,
    wallBaseShade: 0.45,
    floorCornerShade: 0.55,
    background: 0x050505,
    fog: { color: 0x101012, near: 44, far: 80 },
    hemisphere: { sky: 0x8a8a92, ground: 0x18181a, intensity: 1.2 },
    sun: { color: 0xd8d8e0, intensity: 0.7 },
    playerLight: { color: 0xfff0e0, intensity: 28, distance: 16 }, // luz quase branca: o cinza continua cinza
    emberColor: 0x8a7a66,                    // poeira e cinza no ar, em vez de brasas
    lavaLight: 0xff4400,
    pool: { texture: 'lava', tint: 0xffffff, glow: 0xffffff, intensity: 1.3 },
    torch: { color: 0xff8a3a, intensity: 10, distance: 8.5 }, // a luz quente das tochas contrasta com a pedra fria
    decor: {
      torchSpacing: 6,
      torchesPerRoom: 2,
      chains: 0.12,
      banners: 0.07,
      bones: 0.05,
      rubble: 0.05,
      candles: 0.025,
      stains: 0.03,
      stainColor: 0x161414,                  // sujeira escura
    },
  },

  {
    id: 'deepCaves',
    name: 'Labirinto das Cavernas',          // andares 11–15
    layout: 'caves',                         // câmaras irregulares e túneis sinuosos (world/dungeon.js)
    textures: { floor: 'caveFloor', wall: 'caveRock' },
    // paredes de rocha tortas: cantos deslocados, "barriga" no meio e topo de altura variável
    cave: { offset: 0.26, bulge: 0.16, height: 0.45, baseHeight: 1.7 },
    pillarModel: 'rockPillar',
    floorTint: 0x9a7a5a,                     // terra marrom
    wallTint: 0xac8460,                      // rocha marrom
    wallTopTint: 0x54402c,
    wallBaseShade: 0.4,
    floorCornerShade: 0.5,
    background: 0x070403,
    fog: { color: 0x150d07, near: 40, far: 76 },
    hemisphere: { sky: 0xa87c58, ground: 0x24180e, intensity: 1.55 },
    sun: { color: 0xffc890, intensity: 0.65 },
    playerLight: { color: 0xffd8b0, intensity: 28, distance: 16 },
    emberColor: 0x9a7a5a,                    // poeira de terra no ar
    lavaLight: 0xff5a10,
    pool: { texture: 'lava', tint: 0xffffff, glow: 0xffffff, intensity: 1.3 },
    torch: { color: 0xff8a3a, intensity: 10, distance: 8.5 },
    decor: {
      torchSpacing: 6,
      torchesPerRoom: 2,
      chains: 0.04,
      banners: 0,
      supports: 0.09,        // escoras de madeira contra as paredes (mina)
      bones: 0.05,
      rubble: 0.08,
      candles: 0.015,
      stalagmites: 0.07,     // estalagmites encostadas nas paredes
      mushrooms: 0.04,       // cogumelos que brilham de leve
      stains: 0.02,
      stainColor: 0x1a1008,
    },
  },
];

// Tema do andar (1–5 → 0, 6–10 → 1, ...)
export function themeForFloor(floor) {
  const tier = Math.floor((Math.max(1, floor) - 1) / CONFIG.world.bossEvery);
  return DUNGEON_THEMES[Math.min(tier, DUNGEON_THEMES.length - 1)];
}
