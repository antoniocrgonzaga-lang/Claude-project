const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

const ACTIONS = {
  KeyC: 'input:camera',
  KeyR: 'input:reset',
  KeyP: 'input:pause',
  Escape: 'input:pause',
};

// Mapeamento padrão de gamepad (layout "standard").
const PAD = { steerAxis: 0, throttle: 7, brake: 6, boost: 0, drift: 1, reset: 2, camera: 3, pause: 9 };

/** Teclado + gamepad unificados em um único estado analógico. */
export class InputManager {
  constructor(bus) {
    this.bus = bus;
    this.keys = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false };
    this.enabled = true;
    this._padPrev = {};
    this._attached = false;

    this._onDown = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (PREVENT.has(e.code) && this.captureKeys) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = ACTIONS[e.code];
      if (action) this.bus.emit(action);
    };
    this._onUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this.captureKeys = false;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  detach() {
    if (!this._attached) return;
    this._attached = false;
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }

  update() {
    const k = this.keys;
    const s = this.state;
    s.throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    s.brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    s.steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight');
    s.drift = k.has('Space');
    this._pollGamepad(s);
    return s;
  }

  _pollGamepad(s) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!pads) return;
    const pad = Array.prototype.find.call(pads, (p) => p && p.connected && p.mapping === 'standard');
    if (!pad) return;
    const btn = (i) => pad.buttons[i]?.value ?? 0;
    const axis = pad.axes[PAD.steerAxis] ?? 0;
    if (Math.abs(axis) > 0.12) s.steer = axis;
    s.throttle = Math.max(s.throttle, btn(PAD.throttle));
    s.brake = Math.max(s.brake, btn(PAD.brake));
    s.boost = s.boost || btn(PAD.boost) > 0.5;
    s.drift = s.drift || btn(PAD.drift) > 0.5;
    for (const [name, event] of [['pause', 'input:pause'], ['camera', 'input:camera'], ['reset', 'input:reset']]) {
      const down = btn(PAD[name]) > 0.5;
      if (down && !this._padPrev[name]) this.bus.emit(event);
      this._padPrev[name] = down;
    }
  }
}
