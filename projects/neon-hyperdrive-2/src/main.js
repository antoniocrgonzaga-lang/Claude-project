import { Game } from './Game.js';
import { loadSettings } from './Config.js';
import { setLanguage, t } from './I18n.js';
import { keyProbeRequested, startKeyProbe } from './KeyProbe.js';
import { PointerControls, controlsMode } from './PointerControls.js';

const errorBox = document.getElementById('error');

function showError(message) {
  errorBox.textContent = `${t('error.intro')}\n\n${message}\n\n${t('error.outro')}`;
  errorBox.classList.remove('hidden');
}

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

function boot() {
  setLanguage(loadSettings().language);
  // O index.html precisa de servidor; o arquivo único de dist/ abre com duplo clique.
  if (location.protocol === 'file:' && !window.__singleFile) {
    showError(t('error.file'));
    return;
  }
  if (!webglAvailable()) {
    showError(t('error.webgl'));
    return;
  }
  try {
    const game = new Game(document.getElementById('game'));
    game.bus.on('game:error', (err) => showError(err?.message || String(err)));
    game.start();
    window.__game = game; // útil para depuração no console
    // Navegadores embutidos (ex.: TV do Second Life) nem sempre dão o foco do
    // teclado à página sozinhos: todo clique pede o foco de novo, por garantia.
    window.addEventListener('pointerdown', () => window.focus());
    if (keyProbeRequested()) startKeyProbe(game.input);
    // Controles na tela: toque em celular/tablet (?touch=1/0) e mouse no
    // navegador do Second Life (?mouse=1/0). Ver src/PointerControls.js.
    const mode = controlsMode();
    if (mode) new PointerControls(game.input, game.bus, document.getElementById('hud'), mode);
    if (mode === 'touch') {
      // Celular em pé: o aviso "gire o aparelho" cobre a tela (CSS) e a corrida pausa.
      const portrait = window.matchMedia('(orientation: portrait) and (max-width: 600px)');
      portrait.addEventListener?.('change', (e) => {
        if (e.matches && game.inRace && !game.paused && !game.resultsShown) game.setPaused(true);
      });
    }
  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

boot();
