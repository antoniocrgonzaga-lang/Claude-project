#!/usr/bin/env node
/* ==========================================================================
   smoke-test.js — Teste de fumaça: joga uma partida curta num navegador de verdade
   --------------------------------------------------------------------------
   Abre dist/echo-star.html e percorre o ciclo inteiro do jogo:
     voar -> pousar -> sair da nave -> pulo -> pulso de eco -> coletar cristal
     -> voltar para a nave -> decolar
   Falha (código de saída 1) se algum passo não acontecer ou se aparecer
   qualquer erro no console do navegador.

   Requisitos: Node.js + Playwright   (npm install playwright)
   Uso (na pasta projects/echo-star):
       node tools/build.js && node tools/smoke-test.js
   Variáveis opcionais:
       CHROMIUM_PATH  caminho do Chromium a usar (senão usa o do Playwright)
       SHOTS_DIR      pasta onde salvar capturas de tela de cada etapa
   ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright não encontrado. Instale com:  npm install playwright');
  process.exit(2);
}

const arquivo = 'file://' + path.resolve(__dirname, '..', 'dist', 'echo-star.html') + '?seed=42';
const shotsDir = process.env.SHOTS_DIR;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // Renderização por software, para rodar mesmo sem placa de vídeo (CI, servidores).
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(e.message));

  let falhas = 0;
  const confere = (cond, msg) => { console.log((cond ? 'OK    ' : 'FALHOU') + ' ' + msg); if (!cond) falhas++; };
  const g = (fn) => page.evaluate(fn);
  // Espera "sec" segundos de tempo DE JOGO (o tempo real varia com o FPS do computador).
  const esperaJogo = (sec) => page.evaluate((s) => new Promise((res) => { const G = EchoStar.game; const t0 = G.time; const iv = setInterval(() => { if (G.time - t0 >= s) { clearInterval(iv); res(); } }, 30); }), sec);
  const ate = async (pred, rotulo) => { for (let i = 0; i < 600; i++) { if (await page.evaluate(pred)) return true; await page.waitForTimeout(100); } console.log('      (tempo esgotado esperando: ' + rotulo + ')'); return false; };
  const foto = async (nome) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, nome + '.png') }); };

  await page.goto(arquivo);
  await page.waitForTimeout(500);
  await page.click('#overlay-btn');
  await esperaJogo(0.3);
  confere(await g(() => EchoStar.game.started && !EchoStar.game.paused), 'jogo iniciou');

  // Aproxima a nave do planeta-casa e pousa com a tecla L.
  await page.evaluate(() => EchoStar.game.debugGoTo(0, 70));
  await esperaJogo(0.4);
  await foto('1-aproximacao');
  confere(await g(() => EchoStar.game.shipRef.alt < 85), 'nave está ao alcance de pouso');
  await page.keyboard.press('KeyL');
  confere(await ate(() => EchoStar.game.ship.state === 'LANDED', 'pouso'), 'pouso automático terminou');
  await foto('2-pousada');

  // Sai da nave.
  await page.keyboard.press('KeyF');
  await esperaJogo(0.2);
  confere(await g(() => EchoStar.game.mode === 'FOOT'), 'saiu da nave (modo a pé)');
  await ate(() => !EchoStar.game.camRig.transitioning, 'transição de câmera');
  await foto('3-a-pe');

  // Anda e pula.
  await page.keyboard.down('KeyW');
  await esperaJogo(1.0);
  confere(await g(() => EchoStar.game.player.speedNow > 5), 'personagem anda');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await esperaJogo(0.2);
  confere(await g(() => !EchoStar.game.player.grounded), 'personagem pula');
  await ate(() => EchoStar.game.player.grounded, 'aterrissagem do pulo');

  // Pulso de eco + coleta de um cristal (leva o personagem até ao lado de um).
  await page.evaluate(() => {
    const G = EchoStar.game, p = G.player.planet, r = p.resources.find((x) => !x.taken);
    const lado = new THREE.Vector3(1, 0, 0).cross(G.player.up).normalize().multiplyScalar(7);
    G.player.spawnAt(p, r.worldPos.clone().add(lado), lado.clone().negate());
  });
  await esperaJogo(0.3);
  await page.keyboard.press('KeyR');
  await esperaJogo(0.5);
  confere(await g(() => EchoStar.game.planets[0].resources.some((r) => r.beam.visible)), 'pulso de eco acendeu feixes nos recursos');
  await foto('4-eco');
  await page.keyboard.down('KeyW');
  const coletou = await ate(() => Object.values(EchoStar.game.inv).reduce((a, b) => a + b, 0) > 0, 'coleta');
  await page.keyboard.up('KeyW');
  confere(coletou, 'coletou um recurso ao encostar nele');

  // Volta para a nave e decola.
  await page.evaluate(() => { const G = EchoStar.game; G.player.spawnAt(G.ship.planet, G.ship.pos.clone().add(new THREE.Vector3(3, 0, 3)), new THREE.Vector3(1, 0, 0)); });
  await esperaJogo(0.3);
  await page.keyboard.press('KeyF');
  await esperaJogo(0.2);
  confere(await g(() => EchoStar.game.mode === 'SHIP'), 'voltou para a nave');
  await ate(() => !EchoStar.game.camRig.transitioning, 'transição de volta');
  await esperaJogo(1.1);
  await page.keyboard.press('Space');
  confere(await ate(() => EchoStar.game.ship.state === 'FLIGHT', 'decolagem'), 'decolou e voltou ao voo livre');
  await foto('5-decolou');

  confere(erros.length === 0, 'nenhum erro/aviso no console do navegador' + (erros.length ? ' -> ' + erros.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(falhas ? '\n' + falhas + ' verificação(ões) falharam.' : '\nTudo certo!');
  process.exit(falhas ? 1 : 0);
})();
