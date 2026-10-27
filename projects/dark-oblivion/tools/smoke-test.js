#!/usr/bin/env node
/* =============================================================
   smoke-test.js — joga uma partida curta num navegador de verdade.

   Faz o caminho principal com o mouse e o teclado, como um jogador:
     tela inicial -> cria um Cavaleiro -> anda pelo vilarejo (clique)
     -> entra no Portal do Oblivion (clique) -> ataca um inimigo até ele
     morrer (clique) -> abre e fecha o inventário (I / Esc) -> pergaminho
     de portal (T) e volta ao vilarejo pelo portal (clique) -> salva
   Depois troca de área várias vezes e confere se a memória de vídeo
   (texturas) não cresce sem parar.

   Falha (código de saída 1) se algum passo não acontecer, se aparecer
   algum erro no console do navegador, se um modelo 3D não carregar ou se
   o jogo tentar acessar a internet.

   Requisitos: Node.js + Playwright   (npm install playwright)
   Uso (dentro de projects/dark-oblivion):
       node tools/build.js && node tools/smoke-test.js   ← testa o dist/dark-oblivion.html (file://)
       node tools/smoke-test.js --dev                     ← testa o index.html por um servidor local
   Variáveis de ambiente opcionais:
       CHROMIUM_PATH  Chromium a usar (padrão: o do Playwright)
       SHOTS_DIR      pasta onde salvar uma captura de tela de cada passo
   ============================================================= */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright não encontrado. Instale com:  npm install playwright');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');
const shotsDir = process.env.SHOTS_DIR;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

/** Servidor estático mínimo (só no --dev; módulos ES não carregam de file://). */
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

(async () => {
  let server = null, url;
  if (dev) {
    server = await serve();
    url = `http://127.0.0.1:${server.address().port}/index.html`;
  } else {
    const dist = path.join(root, 'dist', 'dark-oblivion.html');
    if (!fs.existsSync(dist)) { console.error('Falta o dist/dark-oblivion.html — rode antes:  node tools/build.js'); process.exit(2); }
    url = 'file://' + dist;
  }
  console.log('Testando ' + (dev ? 'index.html (servidor local)' : 'dist/dark-oblivion.html (file://)'));

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // Desenho por software, para rodar sem placa de vídeo (servidores, CI).
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning' && m.text().startsWith('[assets]')) errors.push(m.text()); // modelo que não carregou
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // Todo acesso à internet é bloqueado: o jogo precisa funcionar offline.
  const external = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { external.push(r.request().url()); r.abort(); });

  let failures = 0;
  const check = (cond, msg) => { console.log((cond ? 'OK    ' : 'FALHOU') + ' ' + msg); if (!cond) failures++; return cond; };
  const g = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, name + '.png') }); };
  // Espera uma condição do jogo (o desenho por software é lento: prazos generosos)
  const until = (fn, timeout = 90000) => page.waitForFunction(fn, null, { timeout, polling: 250 }).then(() => true, () => false);
  const settled = () => until(() => !window.game.world.changing && window.game.world.area);
  // Posição na tela (pixels) de um ponto do mundo
  const screenOf = (p) => g(({ x, y, z }) => {
    const v = window.game.cam.camera.position.clone().set(x, y, z).project(window.game.cam.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }, p);
  const clickWorld = async (p, button = 'left') => {
    const s = await screenOf(p);
    await page.mouse.move(s.x, s.y);
    await page.waitForTimeout(150); // o jogo atualiza o "o que está debaixo do mouse" a cada quadro
    await page.mouse.down({ button }); await page.waitForTimeout(120); await page.mouse.up({ button });
  };
  // Como um jogador: se o alvo está fora da tela, anda na direção dele (cliques no
  // chão) até ele aparecer; aí clica nele. Evita as bordas e a barra de baixo (HUD).
  const clickWhenVisible = async (p) => {
    for (let i = 0; i < 40; i++) {
      const s = await screenOf(p);
      const w = 960, h = 540;
      if (s.x > 60 && s.x < w - 60 && s.y > 60 && s.y < h - 140) return clickWorld(p);
      const cx = w / 2, cy = h / 2 - 40, k = Math.min(1, 160 / Math.hypot(s.x - cx, s.y - cy));
      await page.mouse.move(cx + (s.x - cx) * k, cy + (s.y - cy) * k);
      await page.waitForTimeout(150);
      await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
      await page.waitForTimeout(2000);
    }
    return clickWorld(p);
  };
  const textures = () => g(() => window.game.renderer.info.memory.textures);

  try {
    // Tela inicial: só aparece depois que os modelos 3D carregaram.
    await page.goto(url);
    check(await until(() => !!document.querySelector('#btn-start') && document.getElementById('loading').classList.contains('hidden'), 120000), 'tela inicial apareceu (modelos carregados)');
    await shot('1-titulo');

    // Novo personagem.
    await page.click('.class-card[data-class="knight"]');
    await page.fill('.name-row input', 'Teste');
    await page.click('#btn-start');
    check(await until(() => window.game.running && window.game.world.kind === 'village' && !window.game.world.changing), 'personagem criado e no vilarejo');
    await shot('2-vilarejo');
    const villageTextures = await textures();

    // Anda com um clique no chão.
    const start = await g(() => ({ x: game.player.position.x, z: game.player.position.z }));
    await clickWorld({ x: start.x + 4, y: 0, z: start.z + 2 });
    check(await page.waitForFunction((s) => Math.hypot(game.player.position.x - s.x, game.player.position.z - s.z) > 2, start, { timeout: 30000, polling: 250 }).then(() => true, () => false),
      'andou com um clique no chão');

    // Entra no Portal do Oblivion (clique nele; o personagem anda até lá).
    const portal = await g(() => { const p = game.world.area.interactables.find((i) => i.name === 'Portal do Oblivion').position; return { x: p.x, y: 1.5, z: p.z }; });
    await clickWhenVisible(portal);
    check(await until(() => game.world.kind === 'dungeon' && game.world.floor === 1 && !game.world.changing), 'entrou no Oblivion pelo portal (andar 1)');
    await shot('3-andar1');

    // Ataca o inimigo mais próximo até ele morrer (clicando nele de novo se precisar).
    const found = await g(() => {
      const p = game.player.position;
      const e = game.world.enemies.filter((x) => x.alive).sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
      if (!e) return false;
      window.__target = e;
      // Traz o inimigo para perto: o teste é do combate, não da caçada pelo andar
      e.position.set(p.x + 1.5, 0, p.z);
      if (!game.world.grid.isWalkableWorld(e.position.x, e.position.z)) e.position.set(p.x, 0, p.z + 1.5);
      return true;
    });
    let dead = false;
    if (found) {
      for (let i = 0; i < 20 && !dead; i++) {
        const t = await g(() => window.__target.alive && { x: window.__target.position.x, y: 0.8, z: window.__target.position.z });
        if (!t) { dead = true; break; }
        await clickWorld(t);
        dead = await until(() => !window.__target.alive, 6000);
      }
    }
    check(dead, 'derrotou um inimigo com cliques');
    check(await g(() => game.player.xp > 0 || game.player.level > 1), 'ganhou experiência');
    await shot('4-combate');

    // Inventário: abre com I, fecha com Esc.
    await page.keyboard.press('KeyI');
    check(await until(() => !document.getElementById('panel-inventory').classList.contains('hidden'), 10000), 'inventário abriu (I)');
    await shot('5-inventario');
    await page.keyboard.press('Escape');
    check(await until(() => document.getElementById('panel-inventory').classList.contains('hidden'), 10000), 'inventário fechou (Esc)');

    // Pergaminho de portal (T) e volta ao vilarejo por ele.
    await page.keyboard.press('KeyT');
    check(await until(() => !!game.world.area.interactables.find((i) => i.name === 'Portal para o Vilarejo'), 10000), 'pergaminho abriu um portal (T)');
    const back = await g(() => { const p = game.world.area.interactables.find((i) => i.name === 'Portal para o Vilarejo').position; return { x: p.x, y: 1.5, z: p.z }; });
    // Um clique às vezes não "pega" (o mouse chega antes do quadro que vê o portal): tenta de novo
    let home = false;
    for (let i = 0; i < 5 && !home; i++) {
      if (await g(() => game.world.kind === 'dungeon' && !game.world.changing)) await clickWhenVisible(back);
      home = await until(() => game.world.kind === 'village' && !game.world.changing, 20000);
    }
    check(home, 'voltou ao vilarejo pelo portal');
    check(await g(() => !!game.world.area.interactables.find((i) => i.name.startsWith('Portal de volta'))), 'portal de volta ao andar 1 está no vilarejo');

    // Salvo no navegador.
    check(await g(() => {
      const data = JSON.parse(localStorage.getItem('darkOblivion.saves.v1') || 'null');
      return Object.values(data?.characters ?? {}).some((c) => c.name === 'Teste' && c.deepestFloor >= 1);
    }), 'progresso salvo no localStorage');

    // Memória de vídeo: várias trocas de área não podem acumular texturas.
    for (const floor of [2, 5, 6, 11, 3]) { await g((f) => game.world.goTo('dungeon', f), floor); await settled(); }
    await g(() => game.world.goTo('village')); await settled();
    const after = await textures();
    check(after - villageTextures < 40, `texturas não acumulam ao trocar de área (vilarejo: ${villageTextures} → ${after})`);
  } catch (e) {
    check(false, 'teste interrompido: ' + e.message);
  }

  check(external.length === 0, 'sem acesso à internet' + (external.length ? ' -> ' + external.slice(0, 3).join(' | ') : ''));
  check(errors.length === 0, 'sem erros no console do navegador' + (errors.length ? ' -> ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  if (server) server.close();
  console.log(failures ? '\n' + failures + ' verificação(ões) falharam.' : '\nTudo certo!');
  process.exit(failures ? 1 : 0);
})();
