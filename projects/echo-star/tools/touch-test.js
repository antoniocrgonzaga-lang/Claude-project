#!/usr/bin/env node
/* ==========================================================================
   touch-test.js — plays a session with FINGERS on an emulated tablet and phone
   --------------------------------------------------------------------------
   Opens dist/echo-star.html as a touch device (real touch events through the
   Chrome DevTools protocol, including two-finger pinch) and checks:

   Tablet (iPad-like, 1180×820):
     - touch controls appear, lighter graphics are on
     - a REAL KEYBOARD works at the same time and does NOT hide the controls
     - Thrust button, joystick steering, drag-to-steer
     - Land → Step out → joystick walk → drag to look → Jump → hold Harvest
     - Build → pick Command Core in the menu → tap the ground → Place
     - pinch zoom, drag pan, tap to select, Exit
     - Board → Take off · Pause hides the controls · "Touch controls: Off / Auto"
   Phone (iPhone-like, 844×390): controls fit on screen, no overlaps.

   Requirements: Node.js + Playwright   (npm install playwright)
   Usage (inside projects/echo-star):
       node tools/build.js && node tools/touch-test.js
   Optional: CHROMIUM_PATH, SHOTS_DIR (same as smoke-test.js)
   ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright not found. Install it with:  npm install playwright');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist', 'echo-star.html');
if (!fs.existsSync(dist)) { console.error('dist/echo-star.html is missing — run first:  node tools/build.js'); process.exit(2); }
const url = 'file://' + dist;
const shotsDir = process.env.SHOTS_DIR;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const TABLET = {
  viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const PHONE = {
  viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'OK    ' : 'FAIL  ') + ' ' + msg); if (!cond) failures++; return cond; };

/** Everything needed to drive one emulated device. */
async function openDevice(browser, device, label) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\//, (r) => r.abort());
  const cdp = await context.newCDPSession(page);
  const g = (fn, arg) => page.evaluate(fn, arg);
  // Game time (real time depends on the FPS). While paused the game clock stops: then wait real time.
  const waitGame = (sec) => page.evaluate((s) => new Promise((res) => {
    const G = window.game, t0 = G.time, r0 = performance.now();
    const iv = setInterval(() => {
      if (G.time - t0 >= s || ((G.paused || G.choosing) && performance.now() - r0 > s * 1000)) { clearInterval(iv); res(); }
    }, 30);
  }), sec);
  const until = async (pred, what, tries = 900) => {
    for (let i = 0; i < tries; i++) { if (await page.evaluate(pred)) return true; await page.waitForTimeout(100); }
    console.log('       (timed out waiting for: ' + what + ')');
    return false;
  };
  const shot = async (name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${label}-${name}.png`) }); };

  // ---- fingers (each point: { id, x, y })
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ id: p.id, x: p.x, y: p.y })) });
  const center = async (selector) => {
    // Buttons change one frame after the game mode: wait until the target is actually shown.
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error('not on screen: ' + selector);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const tapAt = async (x, y) => { await send('touchStart', [{ id: 1, x, y }]); await page.waitForTimeout(60); await send('touchEnd', []); await waitGame(0.15); };
  const tap = async (selector) => { const c = await center(selector); await tapAt(c.x, c.y); };
  const holdAt = async (x, y, sec) => { await send('touchStart', [{ id: 1, x, y }]); await waitGame(sec); await send('touchEnd', []); await waitGame(0.1); };
  const hold = async (selector, sec) => { const c = await center(selector); await holdAt(c.x, c.y, sec); };
  /** One finger from (x0,y0) to (x1,y1) in `steps` moves, then held `holdSec` (game time) before lifting. */
  const drag = async (x0, y0, x1, y1, { steps = 8, holdSec = 0, id = 1 } = {}) => {
    await send('touchStart', [{ id, x: x0, y: y0 }]);
    for (let i = 1; i <= steps; i++) { await send('touchMove', [{ id, x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }]); await page.waitForTimeout(25); }
    if (holdSec) await waitGame(holdSec);
    await send('touchEnd', []);
    await waitGame(0.1);
  };
  /** Two fingers moving apart (or together) around (cx, cy). */
  const pinch = async (cx, cy, d0, d1, steps = 8) => {
    const pts = (d) => [{ id: 1, x: cx - d / 2, y: cy }, { id: 2, x: cx + d / 2, y: cy }];
    await send('touchStart', pts(d0));
    for (let i = 1; i <= steps; i++) { await send('touchMove', pts(d0 + ((d1 - d0) * i) / steps)); await page.waitForTimeout(25); }
    await send('touchEnd', []);
    await waitGame(0.1);
  };
  const visible = (selector) => page.locator(selector).first().isVisible();
  const btn = (mode, id) => `#touch-ui .t-btn[data-mode="${mode}"][data-id="${id}"]`;

  await page.goto(url);
  const loaded = await until(() => !!window.game && document.getElementById('loading').classList.contains('hidden'), 'loading', 1800);
  return { context, page, errors, g, waitGame, until, shot, tap, tapAt, hold, holdAt, drag, pinch, visible, btn, loaded };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  // =================================================================== tablet
  console.log('Tablet (1180×820, touch + keyboard)');
  const T = await openDevice(browser, TABLET, 'tablet');
  const { page, g, waitGame, until, shot, tap, tapAt, hold, holdAt, drag, pinch, visible, btn } = T;
  try {
    if (!check(T.loaded, 'game loaded')) throw new Error('did not load');
    check(await visible('.touch-setting'), 'pause menu shows "Touch controls: Auto / On / Off"');
    await tap('#btn-play');
    check(await g(() => !game.paused), 'Launch works with a tap');
    check(await g(() => document.body.classList.contains('touch-on')) && await visible('#touch-ui'), 'touch controls are shown');
    check(await g(() => !game.bloom), 'lighter graphics on a tablet (no bloom)');
    check(await g(() => game.input.lockDisabled && !game.input.locked), 'no pointer lock with touch (it would freeze finger positions)');
    await shot('1-flight');

    // A real keyboard at the same time: works, and the touch controls stay.
    await g(() => game.ship.placeInSpace(game.ship.position.clone(), game.planets[0].position));
    await page.keyboard.down('KeyW');
    await waitGame(0.6);
    await page.keyboard.up('KeyW');
    check(await g(() => game.ship.speed > 1), 'keyboard W still flies the ship on a tablet');
    check(await visible('#touch-ui') && await visible(btn('flight', 'thrust')), 'touch controls stay visible after using the keyboard');

    // Thrust button.
    await g(() => game.ship.placeInSpace(game.ship.position.clone(), game.planets[0].position));
    await hold(btn('flight', 'thrust'), 0.8);
    check(await g(() => game.ship.speed > 1), 'holding Thrust accelerates');

    // Joystick steering (left side) and drag-to-steer (right side).
    let q0 = await g(() => game.ship.quaternion.toArray());
    await drag(170, 650, 230, 650, { holdSec: 0.5 });
    const turned = await g((q) => game.ship.quaternion.angleTo(new game.ship.quaternion.constructor(...q)), q0);
    check(turned > 0.1, `joystick steers the ship (${turned.toFixed(2)} rad)`);
    q0 = await g(() => game.ship.quaternion.toArray());
    await drag(800, 400, 900, 380);
    const turned2 = await g((q) => game.ship.quaternion.angleTo(new game.ship.quaternion.constructor(...q)), q0);
    check(turned2 > 0.05, `dragging the right side steers too (${turned2.toFixed(2)} rad)`);

    // Land.
    await g(() => {
      const p = game.planets[0];
      const dir = game.ship.position.clone().sub(p.position).normalize();
      game.ship.placeInSpace(p.position.clone().addScaledVector(dir, p.radius + 40), p.position);
    });
    await waitGame(0.3);
    check(await visible(btn('flight', 'land')), 'Land button appears near the planet');
    await tap(btn('flight', 'land'));
    check(await until(() => game.mode === 'landed', 'landing'), 'tap Land → autopilot landing');
    await shot('2-landed');
    check(await visible(btn('landed', 'exit')) && !(await visible('.t-stick')), 'landed: Step out button, no joystick');

    // On foot.
    await tap(btn('landed', 'exit'));
    check(await g(() => game.mode === 'walking'), 'tap Step out → on foot');
    const p0 = await g(() => game.player.position.toArray());
    await drag(170, 650, 170, 590, { holdSec: 1.0 });
    const walked = await g((a) => game.player.position.distanceTo(new game.player.position.constructor(...a)), p0);
    check(walked > 2, `joystick walks the astronaut (${walked.toFixed(1)} m)`);
    const f0 = await g(() => game.player.camForward.toArray());
    await drag(750, 400, 900, 400);
    const looked = await g((a) => game.player.camForward.angleTo(new game.player.camForward.constructor(...a)), f0);
    check(looked > 0.1, `dragging the right side looks around (${looked.toFixed(2)} rad)`);
    await tap(btn('walking', 'jump'));
    check(await g(() => !game.player.grounded), 'tap Jump → jumps');
    await until(() => game.player.grounded, 'landing from the jump');

    // Harvest: stand next to the nearest node and hold the Harvest button.
    await g(() => {
      const pl = game.player, planet = pl.planet;
      const local = pl.position.clone().sub(planet.position);
      const node = planet.resources.nodes.filter((n) => n.amount > 0).sort((a, b) => a.pos.distanceTo(local) - b.pos.distanceTo(local))[0];
      const up = node.pos.clone().normalize();
      const side = new node.pos.constructor(0, 1, 0).cross(up).normalize().multiplyScalar(1.6);
      pl.spawn(planet, node.pos.clone().add(side).add(planet.position), side.clone().negate());
    });
    await waitGame(0.2);
    check(await g(() => document.querySelector('[data-id="harvest"]').classList.contains('on')), 'Harvest button lights up next to a resource');
    const inv0 = await g(() => Object.values(game.inventory.items).reduce((a, b) => a + b, 0));
    const hc = await page.locator(btn('walking', 'harvest')).boundingBox();
    await holdAt(hc.x + hc.width / 2, hc.y + hc.height / 2, 4);
    const inv1 = await g(() => Object.values(game.inventory.items).reduce((a, b) => a + b, 0));
    check(inv1 > inv0, `holding Harvest collects (inventory ${inv0} → ${inv1})`);
    await shot('3-on-foot');

    // Build a Command Core with taps.
    await g(() => { for (const k of ['rock', 'iron', 'crystals']) game.inventory.add(k, 200); });
    await tap(btn('walking', 'build'));
    check(await g(() => game.mode === 'build'), 'tap Build → build mode');
    await waitGame(0.6);
    await tap('#build-menu .build-item:first-child');
    check(await g(() => game.build.type === 'core'), 'tap Command Core in the menu');
    check(await visible(btn('build', 'place')) && await visible(btn('build', 'rotate')), 'Place and Rotate buttons appear');
    let placed = false;
    const spots = [];   // a grid over the middle of the screen (some spots hold trees / resources / water)
    for (const fy of [0.45, 0.35, 0.55, 0.3, 0.5, 0.4]) for (const fx of [0.5, 0.4, 0.6, 0.32, 0.68]) spots.push([fx, fy]);
    for (const [fx, fy] of spots) {
      await tapAt(1180 * fx, 820 * fy);
      await waitGame(0.15);
      if (await g(() => !!game.build.placement?.ok)) { placed = true; break; }
    }
    check(placed, 'tapping the ground moves the hologram to a valid spot');
    await shot('4-build-hologram');
    const bases0 = await g(() => game.build.planet.bases.length);
    await tap(btn('build', 'place'));
    check(await g((n) => game.build.planet.bases.length === n + 1, bases0), 'tap Place → Command Core under construction');

    const z0 = await g(() => game.build.targetZoom);
    await pinch(590, 420, 120, 380);
    const z1 = await g(() => game.build.targetZoom);
    check(z1 < z0 * 0.8, `pinch zooms in (${z0.toFixed(0)} → ${z1.toFixed(0)})`);
    const d0 = await g(() => game.build.focusDir.toArray());
    await drag(600, 500, 750, 380);
    const panned = await g((a) => game.build.focusDir.angleTo(new game.build.focusDir.constructor(...a)), d0);
    check(panned > 0.002, `dragging pans the camera (${panned.toFixed(3)} rad)`);
    await shot('5-build');

    await tap(btn('build', 'exitbuild'));
    check(await g(() => game.mode === 'walking'), 'tap Exit → back on foot');

    // Board and take off.
    await g(() => {
      const s = game.ship;
      game.player.spawn(s.landedPlanet, s.position.clone().addScaledVector(s.right(s.position.clone()), 4), s.forward(s.position.clone()));
    });
    await waitGame(0.2);
    check(await visible(btn('walking', 'board')), 'Board button appears next to the ship');
    await tap(btn('walking', 'board'));
    check(await g(() => game.mode === 'landed'), 'tap Board → in the ship');
    await tap(btn('landed', 'takeoff'));
    check(await until(() => game.mode === 'flight', 'take-off'), 'tap Take off → flying');

    // Esc on the tablet keyboard opens the menu (no pointer lock with touch, so the game gets the key).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(await g(() => game.paused), 'Esc on the tablet keyboard opens the pause menu');
    await tap('#btn-play');

    // Pause and the Auto / On / Off setting.
    await tap(btn('system', 'pause'));
    check(await g(() => game.paused) && !(await visible('#touch-ui')), 'tap Pause → menu, controls hidden');
    await tap('.touch-setting button[data-v="off"]');
    await tap('#btn-play');
    check(!(await visible('#touch-ui')) && await g(() => !document.body.classList.contains('touch-on')), '"Touch controls: Off" hides them');
    await g(() => game.pause());   // (with touch Off the game locks the mouse like on a PC)
    await tap('.touch-setting button[data-v="auto"]');
    await tap('#btn-play');
    check(await visible('#touch-ui'), '"Auto" shows them again on a tablet');
  } catch (e) {
    check(false, 'tablet test aborted: ' + e.message);
  }
  check(T.errors.length === 0, 'tablet: no errors in the browser console' + (T.errors.length ? ' -> ' + T.errors.slice(0, 3).join(' | ') : ''));
  await T.context.close().catch(() => {});

  // ==================================================================== phone
  console.log('\nPhone (844×390, landscape)');
  const P = await openDevice(browser, PHONE, 'phone');
  try {
    if (!check(P.loaded, 'game loaded')) throw new Error('did not load');
    await P.tap('#btn-play');
    check(await P.visible('#touch-ui'), 'touch controls are shown');
    check(await P.g(() => game.renderer.getPixelRatio() <= 1.25), 'phone with a 3× screen renders at ≤ 1.25× (lighter graphics)');
    // Every visible control and HUD panel must be fully on screen and not overlap another one.
    const layout = async (label) => {
      const sel = '#touch-ui .t-btn:not(.hidden), #flight-panel, #ai-panel, #resource-bar, #build-info, #build-menu';
      const boxes = await P.page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null && e.getClientRects().length).map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.dataset.id ? e.dataset.mode + ':' + e.dataset.id : '#' + e.id, x: r.x, y: r.y, w: r.width, h: r.height };
      }).filter((b) => b.w > 0 && b.h > 0));
      const W = 844, H = 390;
      const off = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H).map((b) => b.id);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) overlaps.push(a.id + '/' + b.id);
      }
      check(off.length === 0 && overlaps.length === 0, `${label}: ${boxes.length} buttons / panels on screen, none overlapping` + (off.length ? ' · off-screen: ' + off.join(',') : '') + (overlaps.length ? ' · overlap: ' + overlaps.join(',') : ''));
    };
    await layout('flight');
    await P.shot('1-flight');
    await P.g(() => {
      const p = game.planets[0];
      const dir = game.ship.position.clone().sub(p.position).normalize();
      game.ship.placeInSpace(p.position.clone().addScaledVector(dir, p.radius + 40), p.position);
    });
    await P.waitGame(0.3);
    check(await P.visible(P.btn('flight', 'land')), 'Land button appears near the planet');
    await layout('flight near a planet');
    await P.tap(P.btn('flight', 'land'));
    check(await P.until(() => game.mode === 'landed', 'landing'), 'tap Land → landed (mode: ' + await P.g(() => game.mode) + ')');
    await P.tap(P.btn('landed', 'exit'));
    check(await P.g(() => game.mode === 'walking'), 'landed and stepped out with taps');
    await layout('on foot');
    await P.shot('2-on-foot');
    await P.tap(P.btn('walking', 'build'));
    await P.waitGame(0.5);
    await layout('build mode');
    await P.shot('3-build');
    await P.tap('#build-menu .build-item:first-child');
    check(await P.g(() => game.build.type === 'core'), 'the Command Core card can be tapped on a phone');
    await layout('build mode, building picked');
    await P.shot('4-build-picked');
  } catch (e) {
    check(false, 'phone test aborted: ' + e.message);
    await P.shot('failure');
    console.log('       state:', await P.g(() => JSON.stringify({ mode: game.mode, paused: game.paused, ui: document.getElementById('touch-ui').className,
      shown: [...document.querySelectorAll('#touch-ui .t-btn:not(.hidden)')].map((b) => b.dataset.mode + ':' + b.dataset.id) })).catch((x) => x.message));
  }
  check(P.errors.length === 0, 'phone: no errors in the browser console' + (P.errors.length ? ' -> ' + P.errors.slice(0, 3).join(' | ') : ''));
  await P.context.close().catch(() => {});

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) failed.' : '\nAll good!');
  process.exit(failures ? 1 : 0);
})();
