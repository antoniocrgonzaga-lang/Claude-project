const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

// ------------------------------------------------------------ teclas "à prova de Second Life"
// O jogo trabalha com os nomes de event.code ('KeyW', 'ArrowUp'...). Navegadores
// comuns sempre preenchem esse campo, mas navegadores embutidos (a mídia das TVs
// do Second Life, que usa o CEF) recebem teclas "reconstruídas" pelo visualizador
// e às vezes mandam event.code vazio ou estranho. Por isso a tecla é descoberta
// em três tentativas: event.code → event.key → event.keyCode (o antigo, numérico).
const KNOWN_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyP',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'Enter',
]);
const KEY_TO_CODE = {
  w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', c: 'KeyC', r: 'KeyR', p: 'KeyP',
  arrowup: 'ArrowUp', up: 'ArrowUp', arrowdown: 'ArrowDown', down: 'ArrowDown',
  arrowleft: 'ArrowLeft', left: 'ArrowLeft', arrowright: 'ArrowRight', right: 'ArrowRight',
  ' ': 'Space', spacebar: 'Space', escape: 'Escape', esc: 'Escape', enter: 'Enter',
};
const KEYCODE_TO_CODE = {
  87: 'KeyW', 65: 'KeyA', 83: 'KeyS', 68: 'KeyD', 67: 'KeyC', 82: 'KeyR', 80: 'KeyP',
  38: 'ArrowUp', 40: 'ArrowDown', 37: 'ArrowLeft', 39: 'ArrowRight',
  32: 'Space', 27: 'Escape', 13: 'Enter', 16: 'Shift',
};

/** Nome padronizado da tecla (no formato de event.code) ou '' se o jogo não usa essa tecla. */
export function keyCodeOf(e) {
  if (KNOWN_CODES.has(e.code)) return e.code;
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  let code = KEY_TO_CODE[key] || (key === 'shift' ? 'Shift' : '') || KEYCODE_TO_CODE[e.keyCode || e.which] || '';
  // Shift sem lado definido: usa o lado informado por event.location (2 = direito).
  if (code === 'Shift') code = e.location === 2 ? 'ShiftRight' : 'ShiftLeft';
  return code;
}

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
    // Controles pelo mouse (PointerControls.js escreve aqui; update() lê).
    this.pointer = { enabled: false, held: false, steer: 0, boostUntil: 0, autoThrottle: false };
    this._attached = false;

    this._onDown = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const code = keyCodeOf(e);
      if (!code) return;
      if (PREVENT.has(code) && this.captureKeys) e.preventDefault();
      // Alguns visualizadores repetem o keydown sem marcar e.repeat: se a tecla
      // já está segurada, não dispara a ação de novo (senão o P pausa e despausa).
      if (e.repeat || this.keys.has(code)) return;
      this.keys.add(code);
      const action = ACTIONS[code];
      if (action) this.bus.emit(action);
    };
    this._onUp = (e) => {
      const code = keyCodeOf(e);
      // Shift solto sem lado confiável: libera os dois para não ficar "preso".
      if (code.startsWith('Shift')) { this.keys.delete('ShiftLeft'); this.keys.delete('ShiftRight'); }
      this.keys.delete(code);
    };
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
    this._applyPointer(s);
    this._pollGamepad(s);
    return s;
  }

  /** Mistura os controles do mouse: o teclado, quando chega, tem prioridade. */
  _applyPointer(s) {
    const p = this.pointer;
    if (!p.enabled) return;
    if (p.autoThrottle && !s.brake) s.throttle = 1;
    if (p.held && s.steer === 0) s.steer = p.steer;
    if (performance.now() < p.boostUntil) s.boost = true;
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
