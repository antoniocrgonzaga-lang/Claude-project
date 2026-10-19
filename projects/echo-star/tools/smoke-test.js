#!/usr/bin/env node
/* ==========================================================================
   smoke-test.js — plays a short session in a real browser
   --------------------------------------------------------------------------
   Walks through the core game loop with the keyboard, like a player:
     menu -> flight -> land (L) -> step outside (F) -> walk (W)
     -> harvest a resource (hold E) -> build mode (B) -> back (B)
     -> board (F) -> take off (L) -> save
   Fails (exit code 1) if any step doesn't happen, if any error shows up in
   the browser console, or if the game tries to reach the internet.

   Requirements: Node.js + Playwright   (npm install playwright)
   Usage (inside projects/echo-star):
       node tools/build.js && node tools/smoke-test.js     ← tests dist/echo-star.html (file://)
       node tools/smoke-test.js --dev                       ← tests index.html through a local server
   Optional environment variables:
       CHROMIUM_PATH  Chromium binary to use (defaults to Playwright's)
       SHOTS_DIR      folder where a screenshot of each step is saved
   ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright not found. Install it with:  npm install playwright');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');
const shotsDir = process.env.SHOTS_DIR;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

/** Minimal static server (only for --dev; ES modules don't load from file://). */
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
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
    const dist = path.join(root, 'dist', 'echo-star.html');
    if (!fs.existsSync(dist)) { console.error('dist/echo-star.html is missing — run first:  node tools/build.js'); process.exit(2); }
    url = 'file://' + dist;
  }
  console.log('Testing ' + (dev ? 'index.html (local server)' : 'dist/echo-star.html (file://)'));

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // Software rendering, so it runs without a GPU (CI, servers).
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // Every internet request is blocked: the game must work offline.
  const external = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { external.push(r.request().url()); r.abort(); });

  let failures = 0;
  const check = (cond, msg) => { console.log((cond ? 'OK    ' : 'FAIL  ') + ' ' + msg); if (!cond) failures++; return cond; };
  const g = (fn, arg) => page.evaluate(fn, arg);
  // Waits "sec" seconds of GAME time (real time depends on the machine's FPS).
  const waitGame = (sec) => page.evaluate((s) => new Promise((res) => {
    const G = window.game, t0 = G.time;
    const iv = setInterval(() => { if (G.time - t0 >= s) { clearInterval(iv); res(); } }, 30);
  }), sec);
  const until = async (pred, label, tries = 900) => {
    for (let i = 0; i < tries; i++) { if (await page.evaluate(pred)) return true; await page.waitForTimeout(100); }
    console.log('       (timed out waiting for: ' + label + ')');
    return false;
  };
  const shot = async (name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, name + '.png') }); };
  // Keys are read once per frame: hold briefly so the game "sees" the press.
  const press = async (code) => { await page.keyboard.down(code); await waitGame(0.1); await page.keyboard.up(code); };
  const inventoryTotal = () => g(() => Object.values(game.inventory.items).reduce((a, b) => a + b, 0));

  try {
    await page.goto(url);
    const loaded = await until(() => !!window.game && document.getElementById('loading').classList.contains('hidden'), 'loading', 1800);
    if (!check(loaded, 'game loaded (star system generated)')) throw new Error('did not load');
    await page.click('#btn-play');
    await waitGame(0.3);
    check(await g(() => !game.paused && game.mode === 'flight'), 'game started in flight mode');
    await shot('1-flight');

    // Bring the ship close to the home planet's surface and land with L.
    await g(() => {
      const p = game.planets[0];
      const dir = game.ship.position.clone().sub(p.position).normalize();
      game.ship.placeInSpace(p.position.clone().addScaledVector(dir, p.radius + 40), p.position);
    });
    await waitGame(0.3);
    check(await g(() => game.flightAltitude < 80), 'ship within landing range');
    await press('KeyL');
    check(await until(() => game.mode === 'landed', 'landing'), 'autopilot landing finished');
    await shot('2-landed');

    // Step outside and walk.
    await press('KeyF');
    check(await g(() => game.mode === 'walking'), 'stepped outside (on foot)');
    const p0 = await g(() => game.player.position.toArray());
    await page.keyboard.down('KeyW');
    await waitGame(1.0);
    await page.keyboard.up('KeyW');
    const walked = await g((a) => game.player.position.distanceTo(new game.player.position.constructor(...a)), p0);
    check(walked > 2, `astronaut walks (${walked.toFixed(1)} m)`);
    await shot('3-on-foot');

    // Harvest: put the astronaut next to the nearest resource node and hold E.
    await g(() => {
      const pl = game.player, planet = pl.planet;
      const local = pl.position.clone().sub(planet.position);
      const node = planet.resources.nodes.filter((n) => n.amount > 0).sort((a, b) => a.pos.distanceTo(local) - b.pos.distanceTo(local))[0];
      const up = node.pos.clone().normalize();
      const side = new node.pos.constructor(0, 1, 0).cross(up).normalize().multiplyScalar(1.6);
      pl.spawn(planet, node.pos.clone().add(side).add(planet.position), side.clone().negate());
    });
    await waitGame(0.2);
    const before = await inventoryTotal();
    await page.keyboard.down('KeyE');
    const harvested = await until(() => game.harvest.target && Object.values(game.inventory.items).reduce((a, b) => a + b, 0) > 0, 'harvest');
    await page.keyboard.up('KeyE');
    const after = await inventoryTotal();
    check(harvested && after > before, `harvested a resource by holding E (inventory ${before} → ${after})`);
    await shot('4-harvest');

    // Build mode and back.
    await press('KeyB');
    check(await g(() => game.mode === 'build'), 'entered build mode (B)');
    await waitGame(0.5);
    await shot('5-build');
    await press('KeyB');
    check(await g(() => game.mode === 'walking'), 'left build mode (B)');

    // Walk back to the ship, board and take off.
    await g(() => {
      const s = game.ship;
      game.player.spawn(s.landedPlanet, s.position.clone().addScaledVector(s.right(s.position.clone()), 4), s.forward(s.position.clone()));
    });
    await waitGame(0.2);
    await press('KeyF');
    check(await g(() => game.mode === 'landed'), 'boarded the ship (F)');
    await press('KeyL');
    check(await until(() => game.mode === 'flight', 'take-off'), 'took off back to free flight (L)');
    await shot('6-takeoff');

    // Save.
    await g(() => game.save(true));
    check(await g(() => !!JSON.parse(localStorage.getItem('echo-star-save-v1') || 'null')?.ship), 'progress saved to localStorage');
  } catch (e) {
    check(false, 'test aborted: ' + e.message);
  }

  check(external.length === 0, 'no internet access' + (external.length ? ' -> ' + external.slice(0, 3).join(' | ') : ''));
  check(errors.length === 0, 'no errors in the browser console' + (errors.length ? ' -> ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  if (server) server.close();
  console.log(failures ? '\n' + failures + ' check(s) failed.' : '\nAll good!');
  process.exit(failures ? 1 : 0);
})();
