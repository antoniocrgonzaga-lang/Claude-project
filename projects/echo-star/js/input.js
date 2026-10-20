/**
 * Keyboard + mouse input.
 *
 * - isDown(code)     → key currently held (KeyboardEvent.code, e.g. 'KeyW')
 * - wasPressed(code) → key went down this frame
 * - mouse.dx / dy    → mouse movement this frame. Counts when the pointer
 *                      is locked OR while the left/right button is dragged,
 *                      so the game also works where pointer lock is blocked.
 */
const BLOCK_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    // x / y: cursor position in CSS pixels · clicks: buttons pressed on the
    // canvas this frame (0 left, 2 right) · wheel: scroll this frame
    // releases: buttons released this frame, with how far the mouse moved while held
    // (lets build mode tell a click from a drag).
    this.mouse = { dx: 0, dy: 0, buttons: 0, x: 0, y: 0, clicks: [], wheel: 0, releases: [], downAt: {} };
    this.locked = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons = 0; });

    canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons = e.buttons;
      this.mouse.clicks.push(e.button);
      this.mouse.downAt[e.button] = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons = e.buttons;
      const start = this.mouse.downAt[e.button];
      if (start) {
        this.mouse.releases.push({ button: e.button, x: e.clientX, y: e.clientY, sx: start.x, sy: start.y, dist: Math.hypot(e.clientX - start.x, e.clientY - start.y) });
        delete this.mouse.downAt[e.button];
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (!this.enabled) return;
      if (this.locked || this.mouse.buttons) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    // Touch controls on (js/touch.js): never lock — a locked pointer freezes finger positions.
    if (this.lockDisabled) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // pointer lock may be unavailable; drag-to-look still works
    } catch { /* ignore */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clicked(button = 0) { return this.enabled && this.mouse.clicks.includes(button); }
  /** Release event of a button this frame ({ x, y, sx, sy, dist }) or null. */
  released(button = 0) { return (this.enabled && this.mouse.releases.find((r) => r.button === button)) || null; }
  isDown(code) { return this.enabled && this.keys.has(code); }
  wasPressed(code) { return this.enabled && this.pressed.has(code); }
  axis(neg, pos) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.clicks.length = 0;
    this.mouse.releases.length = 0;
  }
}
