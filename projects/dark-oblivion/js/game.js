// =============================================================
// game.js — objeto compartilhado com as peças principais do jogo.
//
// Em vez de passar 10 parâmetros para cada função, qualquer módulo
// pode fazer `import { game } from '../game.js'` e usar game.player,
// game.world, game.scene etc.
//
// Ele começa vazio e é preenchido pelo main.js na inicialização.
// IMPORTANTE: só acesse os campos DENTRO de funções (em tempo de jogo),
// nunca no topo de um arquivo, porque no momento do import eles ainda
// podem estar vazios.
// =============================================================

export const game = {
  scene: null,         // THREE.Scene única (o mundo de cada área entra e sai dela)
  renderer: null,      // THREE.WebGLRenderer
  cam: null,           // IsoCamera (core/camera.js)
  input: null,         // Input (core/input.js)

  player: null,        // Player (entities/player.js)
  world: null,         // WorldManager (world/worldManager.js)

  projectiles: null,   // ProjectileSystem
  vfx: null,           // VfxSystem
  damageNumbers: null, // DamageNumbers
  labels: null,        // WorldLabels
  groundItems: null,   // GroundItems (itens caídos no chão)
  timers: null,        // Timers (ações agendadas no tempo do jogo: meteoros, flechas...)
  sound: null,         // SoundSystem (efeitos sonoros: game.sound.play('hit'))
  music: null,         // MusicSystem (game.music.play('village') / stop())
  ui: null,            // UI

  // Resultado do "o que está debaixo do mouse?" calculado uma vez por quadro
  pick: { enemy: null, interactable: null, point: null },

  time: 0,             // segundos de jogo desde o início
  running: false,      // true depois que o jogador escolhe/carrega um personagem
};
