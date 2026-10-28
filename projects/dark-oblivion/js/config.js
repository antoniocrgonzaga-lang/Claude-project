// =============================================================
// config.js — números de balanceamento e constantes gerais.
// Quer mudar a dificuldade, o zoom da câmera ou o ouro perdido
// ao morrer? Quase sempre é aqui.
// =============================================================

export const CONFIG = {
  camera: {
    pitchDeg: 38,       // inclinação da câmera (35.26° é o isométrico "puro")
    distance: 40,       // distância da câmera até o jogador (não altera o zoom na ortográfica)
    viewSize: 17,       // quantas unidades do mundo cabem na ALTURA da tela (zoom inicial)
    minViewSize: 9,     // zoom máximo (mais perto)
    maxViewSize: 30,    // zoom mínimo (mais longe)
    followSpeed: 8,     // quanto maior, mais "grudada" a câmera fica no jogador
    rotateSpeed: 8,     // velocidade do giro de 90° (teclas Z e X)
  },

  player: {
    baseMoveSpeed: 5,     // unidades por segundo
    pickupRange: 1.3,     // distância para pegar um item clicado
    interactRange: 2.4,   // distância padrão para usar portais / falar com NPCs
    autoPickupRange: 0.9, // ouro e poções são pegos automaticamente ao passar por cima
    skillSlots: 6,        // espaços na barra de habilidades (teclas 1 a 6)
  },

  combat: {
    baseCrit: 5,          // % de crítico base
    critMultiplier: 1.5,  // dano do crítico
    maxResist: 75,        // resistência máxima (%)
    armorConstant: 50,    // usado na fórmula de redução por armadura
    potionCooldown: 1.0,  // segundos entre uma poção e outra
    blockCap: 60,         // % máxima de bloqueio
  },

  progression: {
    xpBase: 100,
    xpExponent: 1.5,
    attributePointsPerLevel: 5,
    skillPointsPerLevel: 1,
    maxLevel: 50,
  },

  // Quanto cada andar do Oblivion deixa os inimigos mais fortes (multiplicadores por andar)
  floor: {
    hpPerFloor: 0.35,     // +35% de vida por andar
    damagePerFloor: 0.25, // +25% de dano por andar
    armorPerFloor: 0.2,
    xpPerFloor: 0.3,
    goldPerFloor: 0.25,
  },

  economy: {
    startingGold: 60,
    sellRatio: 0.3,       // o mercador paga 30% do valor do item
    deathGoldLoss: 0.25,  // perde 25% do ouro ao morrer
  },

  inventory: { cols: 10, rows: 4 },

  potions: {
    hpRestorePct: 0.45,        // poção de vida cura 45% da vida máxima
    resourceRestorePct: 0.5,   // poção de mana/recurso devolve 50%
    maxStack: 20,
  },

  save: {
    key: 'darkOblivion.saves.v1',
    version: 1,
    autosaveSeconds: 30,
  },

  world: {
    waypointEvery: 5, // waypoint (portal de retorno fixo) a cada N andares
    bossEvery: 5,     // chefe guardando a escadaria a cada N andares
    maxFloor: 25,     // último andar: o chefe final mora aqui (para ir até 50, mude só este número)
  },

  // Volumes (0 a 1). A música liga/desliga com a tecla M.
  audio: {
    master: 0.8,
    sfx: 0.7,
    music: 0.6,         // a música fica atrás dos efeitos
    reverbLevel: 0.55,  // quanto do "eco de catedral" volta para a mistura
    reverbSeconds: 3.2, // tamanho do eco
  },

  // Paredes que ficam entre a câmera e o jogador viram "transparentes" (pontilhadas)
  cutaway: {
    radius: 2.6,      // tamanho do "buraco" ao redor do jogador
    strength: 0.92,   // 1 = some totalmente; 0 = desligado
  },
};

// XP necessária para sair do nível `level` e ir para o próximo.
// Nível 1 → 100, nível 2 → 283, nível 3 → 520...
export function xpToNextLevel(level) {
  return Math.round(CONFIG.progression.xpBase * Math.pow(level, CONFIG.progression.xpExponent));
}
