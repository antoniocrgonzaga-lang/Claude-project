// Teste de teclado: abra o jogo com ?keys=1 no fim do endereço.
// Mostra, por cima do jogo, cada tecla e clique que a página recebe e como o jogo
// interpretou. Serve para descobrir, dentro de uma TV do Second Life (ou de qualquer
// navegador embutido), se as teclas NÃO CHEGAM (problema de foco/visualizador) ou se
// CHEGAM COM DADOS ESTRANHOS (problema do jogo).
import { keyCodeOf } from './InputManager.js';
import { t } from './I18n.js';

const MAX_LINES = 12; // quantos eventos ficam visíveis

export function keyProbeRequested() {
  return /[?&]keys=1\b/.test(location.search) || /\bkeys=1\b/.test(location.hash);
}

/** Liga o painel de teste. `input` é o InputManager do jogo (para mostrar as teclas seguradas). */
export function startKeyProbe(input) {
  const box = document.createElement('div');
  box.id = 'key-probe';
  box.innerHTML = `<b>${t('probe.title')}</b><div>${t('probe.hint')}</div>
    <div class="kp-status"></div><div class="kp-held"></div><pre class="kp-log"></pre>`;
  document.body.appendChild(box);
  const status = box.querySelector('.kp-status');
  const held = box.querySelector('.kp-held');
  const log = box.querySelector('.kp-log');
  const lines = [];

  const push = (text) => {
    lines.unshift(`${(performance.now() / 1000).toFixed(2).padStart(7)}s  ${text}`);
    lines.length = Math.min(lines.length, MAX_LINES);
    log.textContent = lines.join('\n');
  };
  const show = (v) => (v === '' ? '""' : v === undefined ? '—' : JSON.stringify(v));

  for (const type of ['keydown', 'keyup']) {
    // Fase de captura: registra a tecla mesmo que outra parte do jogo a bloqueie depois.
    window.addEventListener(type, (e) => {
      push(`${type.padEnd(7)} key=${show(e.key)} code=${show(e.code)} keyCode=${e.keyCode}`
        + `${e.repeat ? ' repeat' : ''} → ${keyCodeOf(e) || '(ignored)'}`);
    }, true);
  }
  window.addEventListener('pointerdown', (e) => push(`pointerdown ${e.pointerType} x=${Math.round(e.clientX)} y=${Math.round(e.clientY)}`), true);
  window.addEventListener('focus', () => push('window focus'), true);
  window.addEventListener('blur', () => push('window blur'), true);

  setInterval(() => {
    const focused = document.hasFocus();
    status.textContent = `${t('probe.focus')}: ${focused ? t('probe.yes') : t('probe.no')}`;
    status.className = `kp-status ${focused ? 'ok' : 'bad'}`;
    held.textContent = `${t('probe.held')}: ${[...input.keys].join(' ') || t('probe.none')}`;
  }, 200);
}
