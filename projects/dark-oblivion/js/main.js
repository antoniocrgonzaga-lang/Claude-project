// =============================================================
// main.js — ponto de entrada.
//
// 1. Cria o renderizador, a cena, a câmera, a leitura de input e os sistemas.
// 2. Pré-carrega os modelos .glb (se houver).
// 3. Mostra a tela inicial.
// 4. Ao começar, cria o jogador, vai para o vilarejo e roda o LOOP:
//
//    a cada quadro (~60 vezes por segundo):
//      teclas globais (zoom, girar câmera, painéis)
//      pick: o que está debaixo do mouse
//      jogador → mundo (inimigos) → projéteis → itens no chão
//      efeitos → câmera → números de dano → etiquetas → HUD
//    (sons tocam na hora em que as coisas acontecem: golpes, poções, nível...)
//      desenha a cena
// =============================================================
import * as THREE from 'three';
import { game } from './game.js';
import { CONFIG } from './config.js';
import { events } from './core/events.js';
import { IsoCamera } from './core/camera.js';
import { Input } from './core/input.js';
import { Timers } from './core/timers.js';
import { preloadModels } from './core/assets.js';
import { ProjectileSystem } from './systems/projectiles.js';
import { VfxSystem } from './systems/vfx.js';
import { DamageNumbers } from './systems/damageNumbers.js';
import { GroundItems } from './systems/loot.js';
import { WorldLabels } from './ui/worldLabels.js';
import { WorldManager } from './world/worldManager.js';
import { UI } from './ui/ui.js';
import { Player } from './entities/player.js';
import { saveGame } from './save.js';
import { audio } from './core/audio.js';
import { SoundSystem } from './systems/sound.js';
import { MusicSystem } from './systems/music.js';
import { musicForFloor } from './data/music.js';

const loadingText = document.getElementById('loading-text');
let lastTime = performance.now();
let autosaveTimer = 0;
let zoomKeyTimer = 0; // Page Up / Page Down segurados: um passo de zoom a cada 0,1 s

async function init() {
  // ---------- renderizador ----------
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050203);

  // Deixa o objeto acessível no console do navegador (F12) para depuração:
  // ex.: game.player.gold = 9999   ou   game.player.gainXp(500)
  window.game = game;

  game.renderer = renderer;
  game.scene = scene;
  game.cam = new IsoCamera();
  game.input = new Input(canvas);

  // ---------- sistemas ----------
  game.projectiles = new ProjectileSystem(scene);
  game.vfx = new VfxSystem(scene);
  game.damageNumbers = new DamageNumbers(document.getElementById('damage-layer'));
  game.labels = new WorldLabels(document.getElementById('world-labels'));
  game.groundItems = new GroundItems(scene);
  game.timers = new Timers();
  game.world = new WorldManager();
  game.ui = new UI();
  game.sound = new SoundSystem();
  game.music = new MusicSystem();

  // O navegador só libera o som depois de um clique ou tecla
  const unlockAudio = () => audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);

  wireEvents();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    game.cam.resize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('beforeunload', () => { if (game.running) saveGame(game.player); });

  // ---------- modelos .glb ----------
  await preloadModels((done, total) => {
    loadingText.textContent = total ? `Carregando modelos... ${done}/${total}` : 'Carregando...';
  });

  document.getElementById('loading').classList.add('hidden');
  showTitle();
  requestAnimationFrame(loop);
}

function showTitle() {
  game.music.play('village'); // começa assim que o jogador clicar em algo
  game.ui.title.show({
    onNew: ({ classId, name, skinTone }) => startGame(new Player({ classId, name, skinTone })),
    onLoad: (data) => startGame(new Player(data)),
  });
}

async function startGame(player) {
  game.ui.title.hide();
  game.player = player;
  player.addToScene(game.scene);
  game.ui.hud.show(player);
  game.running = true;
  await game.world.goTo('village');
  saveGame(player);
  game.ui.message(`Corvália te espera, ${player.name}. O portal do Oblivion aguarda.`);
}

// ---------- reações a eventos do jogo ----------
function wireEvents() {
  events.on('enemyKilled', ({ enemy }) => {
    game.player.gainXp(enemy.stats.xp);
    game.groundItems.dropFromEnemy(enemy, game.world.floor);
  });

  events.on('groundItemClicked', (entry) => game.player.setPickupTarget(entry));

  events.on('levelUp', (player) => {
    game.vfx.pillar(player, 0xffd27a);
    game.sound.play('levelUp');
    game.ui.message(`Nível ${player.level}! +${CONFIG.progression.attributePointsPerLevel} pontos de atributo e +${CONFIG.progression.skillPointsPerLevel} de habilidade (tecla C).`, '#ffd27a');
  });

  events.on('gameCompleted', ({ boss }) => {
    const player = game.player;
    player.victories++;
    game.vfx.pillar(player, 0xffd27a);
    game.ui.showVictory(boss.name, player.victories);
    saveGame(player);
  });

  events.on('areaChanged', ({ kind, floor }) => {
    if (game.running) saveGame(game.player);
    // Música: vilarejo → tema do vilarejo; Oblivion → tema da faixa de andares (sem tema = silêncio)
    const track = kind === 'village' ? 'village' : musicForFloor(floor);
    if (track) game.music.play(track); else game.music.stop();
  });

  events.on('playerDied', () => {
    const player = game.player;
    const lost = Math.floor(player.gold * CONFIG.economy.deathGoldLoss);
    player.addGold(-lost);
    player.townPortalFloor = 0;
    game.ui.closeAll();
    game.ui.showDeath(lost);
    setTimeout(async () => {
      // Se morreu bem no meio de uma troca de área, espera ela terminar
      while (game.world.changing) await new Promise((r) => setTimeout(r, 100));
      await game.world.goTo('village', 0, { revive: true });
      game.ui.hideDeath();
      saveGame(player);
    }, 2800);
  });
}

// ---------- loop principal ----------
function loop(now) {
  requestAnimationFrame(loop);
  // dt = segundos desde o último quadro (limitado, para o jogo não "pular" se travar)
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const { input, cam, world, player } = game;

  if (game.running && world.area) {
    game.time += dt;

    if (input.wheel) cam.zoom(input.wheel);
    // Page Up aproxima, Page Down afasta (segurando, continua dando zoom)
    const zoomKey = input.isDown('PageUp') ? -1 : input.isDown('PageDown') ? 1 : 0;
    if (input.wasPressed('PageUp') || input.wasPressed('PageDown')) zoomKeyTimer = 0;
    if (zoomKey) {
      zoomKeyTimer -= dt;
      if (zoomKeyTimer <= 0) { cam.zoom(zoomKey); zoomKeyTimer = 0.1; }
    }
    if (input.wasPressed('KeyZ')) cam.rotate(-1);
    if (input.wasPressed('KeyX')) cam.rotate(1);
    if (input.wasPressed('KeyM')) game.ui.message(audio.toggleMusic() ? 'Música desligada (M).' : 'Música ligada (M).');
    game.ui.handleInput(input);

    if (!world.changing) {
      game.pick = world.pick(input.mouse);
      player.update(dt);
      world.update(dt);
      game.timers.update(dt);
      game.projectiles.update(dt);
      game.groundItems.update(dt);
    }

    game.vfx.update(dt);
    cam.update(dt, player.position);
    game.damageNumbers.update(dt);
    game.labels.update();
    game.ui.update(dt);

    autosaveTimer += dt;
    if (autosaveTimer >= CONFIG.save.autosaveSeconds) {
      autosaveTimer = 0;
      saveGame(player);
    }
  }

  game.renderer.render(game.scene, cam.camera);
  input.endFrame();
}

init().catch((err) => {
  console.error(err);
  loadingText.textContent = `Erro ao iniciar: ${err.message}. Veja o console (F12).`;
});
