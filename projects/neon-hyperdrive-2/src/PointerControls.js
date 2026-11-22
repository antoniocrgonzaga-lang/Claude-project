// Controles pelo MOUSE (ou um dedo), para quando o teclado não chega ao jogo —
// caso típico: o jogo aberto numa TV (mídia no prim) do Second Life, onde o
// visualizador repassa os cliques para a página, mas não as teclas.
//
// Como se joga:
//   - acelera com W/↑ (ou sozinha, se POINTER.autoThrottle = true em Config.js);
//   - SEGURE o botão do mouse em qualquer ponto da tela e ARRASTE para os lados
//     para virar (quanto mais longe do centro, mais vira; soltou, segue reto);
//   - botões na lateral direita: BOOST (rajada curta), CÂMERA, REPOSICIONAR e PAUSA.
//
// Ativação: sozinho no navegador do Second Life (o "user agent" dele contém
// "SecondLife"); ?mouse=1 no endereço força, ?mouse=0 desliga.
// Botões de ajuste: POINTER em src/Config.js.
import { POINTER } from './Config.js';
import { t } from './I18n.js';

export function pointerControlsWanted() {
  const m = /[?&#]mouse=([01])\b/.exec(location.search + location.hash);
  if (m) return m[1] === '1';
  return /SecondLife/i.test(navigator.userAgent);
}

export class PointerControls {
  /** @param {import('./InputManager.js').InputManager} input  @param {object} bus */
  constructor(input, bus, hudRoot) {
    this.input = input;
    this.p = input.pointer;
    this.p.enabled = true;
    this.p.autoThrottle = POINTER.autoThrottle;
    this.pointerId = null;

    // ---- elementos na tela (ficam dentro do #hud: aparecem e somem com ele)
    const root = document.createElement('div');
    root.id = 'pointer-controls';
    root.innerHTML = `
      <div class="pc-buttons">
        <button type="button" data-act="boost" class="pc-boost">${t('pc.boost')}</button>
        <button type="button" data-act="camera">${t('pc.camera')}</button>
        <button type="button" data-act="reset">${t('pc.reset')}</button>
        <button type="button" data-act="pause">${t('pc.pause')}</button>
      </div>
      <div class="pc-steer"><div class="pc-rail"><i></i></div><small>${t('pc.hint')}</small></div>`;
    hudRoot.appendChild(root);
    this.marker = root.querySelector('.pc-rail i');

    root.querySelector('.pc-buttons').addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation(); // clicar num botão não vira a nave
      const act = btn.dataset.act;
      if (act === 'boost') this.p.boostUntil = performance.now() + POINTER.boostBurst * 1000;
      else bus.emit(`input:${act}`);
    });

    // ---- direção: segurar e arrastar em qualquer ponto fora dos botões
    this._down = (e) => {
      if (!this._active() || e.target.closest?.('#pointer-controls .pc-buttons, #screens .screen:not(.hidden)')) return;
      if (e.button !== undefined && e.button !== 0) return;
      this.pointerId = e.pointerId;
      this.p.held = true;
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
    window.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    window.addEventListener('blur', this._release);
    document.documentElement.addEventListener('pointerleave', this._release);
    document.body.classList.add('pointer-mode');
  }

  /** Só dirige durante a corrida e fora da pausa. */
  _active() { return this.input.captureKeys && !document.querySelector('#screens .screen:not(.hidden)'); }

  _aim(e) {
    const half = window.innerWidth * POINTER.steerSpan;
    let x = (e.clientX - window.innerWidth / 2) / half;
    x = Math.max(-1, Math.min(1, x));
    // zona morta no centro, depois reescala para continuar chegando a ±1
    const dz = POINTER.deadZone;
    x = Math.abs(x) < dz ? 0 : Math.sign(x) * (Math.abs(x) - dz) / (1 - dz);
    this.p.steer = x;
    this._show();
  }

  _release() {
    this.p.held = false;
    this.p.steer = 0;
    this.pointerId = null;
    this._show();
  }

  _show() {
    this.marker.style.left = `${50 + this.p.steer * 50}%`;
    this.marker.classList.toggle('on', this.p.held);
  }
}
