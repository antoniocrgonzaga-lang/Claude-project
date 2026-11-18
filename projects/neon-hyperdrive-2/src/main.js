import { Game } from './Game.js';
import { loadSettings } from './Config.js';
import { setLanguage, t } from './I18n.js';

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
  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

boot();
