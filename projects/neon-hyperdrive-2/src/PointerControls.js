// Controles pelo MOUSE e pelo TOQUE (celular e tablet).
//
// Modo MOUSE — para quando o teclado não chega ao jogo, caso típico: o jogo
// aberto numa TV (mídia no prim) do Second Life, onde o visualizador repassa os
// cliques para a página, mas não as teclas.
//   - acelera com W/↑ (ou sozinha, se POINTER.autoThrottle = true em Config.js);
//   - SEGURE o botão do mouse em qualquer ponto da tela e ARRASTE para os lados
//     para virar (quanto mais longe do centro, mais vira; soltou, segue reto);
//   - botões na lateral direita: BOOST (rajada curta), CÂMERA, REPOSICIONAR e PAUSA.
//
// Modo TOQUE — celular e tablet:
//   - a nave acelera sozinha (POINTER.touchAutoThrottle);
//   - ENCOSTE o dedo em qualquer ponto livre da tela e ARRASTE para os lados para
//     virar: conta a distância a partir de onde o dedo encostou (um "joystick"
//     que nasce sob o dedo); soltou, segue reto;
//   - botões grandes no canto inferior direito: BOOST (rajada) e DRIFT (segurar);
//   - botões pequenos no alto, ao centro: CÂMERA, REPOSICIONAR e PAUSA;
//   - dá para virar com um dedo e apertar os botões com outro ao mesmo tempo.
//
// Ativação (veja controlsMode):
//   - ?touch=1 força o toque, ?touch=0 desliga;
//   - ?mouse=1 força o mouse, ?mouse=0 desliga;
//   - sem nada no endereço: toque em celular/tablet (tela de toque como entrada
//     principal, mesmo com teclado conectado), mouse no navegador do Second Life,
//     e nada no PC comum (só teclado/controle).
// Botões de ajuste: POINTER em src/Config.js.
import { POINTER } from './Config.js';
import { translateDom } from './I18n.js';

/** Lê ?nome=1 / ?nome=0 do endereço (true, false ou null se ausente). */
function urlFlag(name) {
  const m = new RegExp(`[?&#]${name}=([01])\\b`).exec(location.search + location.hash);
  return m ? m[1] === '1' : null;
}

/** Aparelho com tela de toque como entrada principal (celular, tablet, iPad). */
export function isTouchDevice() {
  const ua = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints || 0;
  const hasTouch = touchPoints > 0 || 'ontouchstart' in window;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  // O iPadOS se apresenta como Mac: a diferença é a tela de toque.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const mobile = /Android|iPhone|iPod|Mobile|Silk|Kindle|Tablet/i.test(ua);
  return hasTouch && (coarse || iPad || mobile);
}

/** 'touch', 'mouse' ou null (sem controles na tela). */
export function controlsMode() {
  const touch = urlFlag('touch');
  if (touch === true) return 'touch';
  const mouse = urlFlag('mouse');
  if (mouse === true) return 'mouse';
  if (touch === null && mouse === null && isTouchDevice()) return 'touch';
  if (mouse === null && /SecondLife/i.test(navigator.userAgent)) return 'mouse';
  return null;
}

/** Mantido por compatibilidade: true se algum controle na tela deve aparecer. */
export function pointerControlsWanted() { return controlsMode() !== null; }

export class PointerControls {
  /**
   * @param {import('./InputManager.js').InputManager} input
   * @param {object} bus
   * @param {HTMLElement} hudRoot
   * @param {'mouse'|'touch'} mode
   */
  constructor(input, bus, hudRoot, mode = 'mouse') {
    this.input = input;
    this.mode = mode;
    this.touch = mode === 'touch';
    this.p = input.pointer;
    this.p.enabled = true;
    this.p.autoThrottle = this.touch ? POINTER.touchAutoThrottle : POINTER.autoThrottle;
    this.pointerId = null;
    this.originX = 0;
    this.steered = false;

    // ---- elementos na tela (ficam dentro do #hud: aparecem e somem com ele)
    // Os textos usam data-i18n para acompanhar a troca de idioma.
    const root = document.createElement('div');
    root.id = 'pointer-controls';
    root.className = this.touch ? 'pc-touch' : 'pc-mouse';
    root.innerHTML = this.touch ? `
      <div class="pc-buttons pc-top">
        <button type="button" data-act="camera" data-i18n="pc.camera"></button>
        <button type="button" data-act="reset" data-i18n="pc.reset"></button>
        <button type="button" data-act="pause" data-i18n="pc.pause" class="pc-pause"></button>
      </div>
      <div class="pc-buttons pc-actions">
        <button type="button" data-act="drift" data-i18n="pc.drift" class="pc-drift"></button>
        <button type="button" data-act="boost" data-i18n="pc.boost" class="pc-boost"></button>
      </div>
      <div class="pc-stick hidden"><i></i></div>
      <div class="pc-steer"><small data-i18n="pc.hintTouch"></small></div>` : `
      <div class="pc-buttons">
        <button type="button" data-act="boost" class="pc-boost" data-i18n="pc.boost"></button>
        <button type="button" data-act="camera" data-i18n="pc.camera"></button>
        <button type="button" data-act="reset" data-i18n="pc.reset"></button>
        <button type="button" data-act="pause" data-i18n="pc.pause"></button>
      </div>
      <div class="pc-steer"><div class="pc-rail"><i></i></div><small data-i18n="pc.hint"></small></div>`;
    hudRoot.appendChild(root);
    translateDom(root);
    this.root = root;
    this.marker = root.querySelector('.pc-rail i');
    this.stick = root.querySelector('.pc-stick');
    this.knob = this.stick?.querySelector('i');
    this.hint = root.querySelector('.pc-steer');

    // ---- botões (cada dedo é independente: dá para virar e apertar ao mesmo tempo)
    for (const box of root.querySelectorAll('.pc-buttons')) {
      box.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation(); // apertar um botão não vira a nave
        btn.classList.add('down');
        const act = btn.dataset.act;
        if (act === 'boost') this.p.boostUntil = performance.now() + POINTER.boostBurst * 1000;
        else if (act === 'drift') { this.p.drift = true; btn.setPointerCapture?.(e.pointerId); }
        else bus.emit(`input:${act}`);
      });
      const up = (e) => {
        const btn = e.target.closest?.('button');
        if (!btn) return;
        btn.classList.remove('down');
        if (btn.dataset.act === 'drift') this.p.drift = false;
      };
      box.addEventListener('pointerup', up);
      box.addEventListener('pointercancel', up);
      box.addEventListener('lostpointercapture', up);
      // Sem isso o pointerup do mouse é perdido se o cursor sair do botão.
      box.addEventListener('pointerleave', up, true);
    }

    // ---- direção: segurar e arrastar em qualquer ponto fora dos botões
    this._down = (e) => {
      if (!this._active() || e.target.closest?.('#pointer-controls .pc-buttons, #screens .screen:not(.hidden)')) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (this.pointerId !== null) return; // já tem um dedo virando
      this.pointerId = e.pointerId;
      this.p.held = true;
      this.originX = e.clientX;
      if (this.touch) {
        e.preventDefault();
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.stick.classList.remove('hidden');
      }
      this._aim(e);
    };
    this._move = (e) => {
      if (!this.p.held || e.pointerId !== this.pointerId) return;
      // Soltou o botão fora da TV e o "pointerup" se perdeu? buttons === 0 denuncia.
      if (e.pointerType === 'mouse' && e.buttons === 0) return this._release();
      this._aim(e);
    };
    this._up = (e) => { if (e.pointerId === this.pointerId) this._release(); };
    this._release = this._release.bind(this);
    window.addEventListener('pointerdown', this._down, { passive: false });
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    window.addEventListener('blur', this._release);
    if (!this.touch) document.documentElement.addEventListener('pointerleave', this._release);
    document.body.classList.add('pointer-mode');
    if (this.touch) {
      document.body.classList.add('touch-mode');
      // Sem menu de "segurar o dedo" nem zoom por gesto (Safari) durante o jogo.
      window.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('gesturestart', (e) => e.preventDefault());
      // O zoom por toque duplo/pinça fica bloqueado pelo CSS (touch-action) e pela meta viewport.
    }
  }

  /** Só dirige durante a corrida e fora da pausa. */
  _active() { return this.input.captureKeys && !document.querySelector('#screens .screen:not(.hidden)'); }

  _aim(e) {
    let x;
    if (this.touch) {
      // Toque: distância a partir de onde o dedo encostou.
      const span = Math.max(40, Math.min(window.innerWidth, window.innerHeight) * POINTER.touchSteerSpan);
      x = (e.clientX - this.originX) / span;
    } else {
      // Mouse: distância a partir do centro da tela.
      x = (e.clientX - window.innerWidth / 2) / (window.innerWidth * POINTER.steerSpan);
    }
    x = Math.max(-1, Math.min(1, x));
    // zona morta no centro, depois reescala para continuar chegando a ±1
    const dz = POINTER.deadZone;
    x = Math.abs(x) < dz ? 0 : Math.sign(x) * (Math.abs(x) - dz) / (1 - dz);
    this.p.steer = x;
    if (x !== 0 && !this.steered) { this.steered = true; this.hint?.classList.add('done'); }
    this._show();
  }

  _release() {
    this.p.held = false;
    this.p.steer = 0;
    this.pointerId = null;
    this.stick?.classList.add('hidden');
    this._show();
  }

  _show() {
    if (this.marker) {
      this.marker.style.left = `${50 + this.p.steer * 50}%`;
      this.marker.classList.toggle('on', this.p.held);
    }
    if (this.knob) this.knob.style.transform = `translateX(${this.p.steer * 34}px)`;
  }
}
