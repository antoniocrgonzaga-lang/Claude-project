// =============================================================
// ui.js — junta todas as partes da interface e controla:
//   painéis (abrir/fechar com I, C, Esc), mensagens na tela,
//   transição com tela preta (fade), tela de morte e flash de dano.
// =============================================================
import { events } from '../core/events.js';
import { game } from '../game.js';
import { HUD } from './hud.js';
import { InventoryUI } from './inventoryUI.js';
import { CharacterUI } from './characterUI.js';
import { ShopUI } from './shopUI.js';
import { TitleScreen } from './titleScreen.js';
import { WaypointUI } from './waypointUI.js';
import { tooltip } from './tooltip.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hud = new HUD(this);
    this.inventory = new InventoryUI(this);
    this.character = new CharacterUI(this);
    this.shop = new ShopUI(this);
    this.waypoints = new WaypointUI(this);
    this.title = new TitleScreen();

    this.messagesEl = $('messages');
    this.fadeEl = $('fade');
    this.deathEl = $('death-screen');
    this.hurtEl = $('hurt-flash');
    this.recentMessages = new Map(); // evita repetir a mesma mensagem várias vezes seguidas

    events.on('playerHurt', () => this.flashHurt());
  }

  // ---------- painéis ----------
  togglePanel(name) {
    const panel = this[name];
    if (panel.isOpen) { panel.close(); return; }
    if (name === 'character') this.shop.close(); // ficha e loja ocupam o mesmo lado da tela
    panel.open();
  }

  openShop(merchantPos) {
    this.character.close();
    this.shop.open(merchantPos);
    this.inventory.open();
  }

  openWaypoints() {
    this.closeAll();
    this.waypoints.open();
  }

  closeAll() {
    this.inventory.close();
    this.character.close();
    this.shop.close();
    this.waypoints.close();
    tooltip.hide();
  }

  handleInput(input) {
    // Ficha aberta + mouse sobre uma habilidade: 1–6 coloca ela na barra
    // (consume impede que a mesma tecla também troque a habilidade selecionada)
    const hovered = this.character.isOpen ? this.character.hoveredSkill : null;
    if (hovered) {
      const player = game.player;
      for (let i = 0; i < player.skillBar.length; i++) {
        if (!input.wasPressed(`Digit${i + 1}`)) continue;
        input.consume(`Digit${i + 1}`);
        if (player.assignSkill(i, hovered)) this.message(`Habilidade colocada na tecla ${i + 1}.`);
      }
    }

    if (input.wasPressed('KeyI')) this.togglePanel('inventory');
    if (input.wasPressed('KeyC')) this.togglePanel('character');
    if (input.wasPressed('Escape')) this.closeAll();
  }

  update(dt) {
    this.hud.update(dt);
    this.shop.update();
    this.waypoints.update();
  }

  // ---------- mensagens ----------
  message(text, color) {
    if (!text) return;
    const now = performance.now();
    if (now - (this.recentMessages.get(text) ?? -Infinity) < 1200) return;
    this.recentMessages.set(text, now);

    const el = document.createElement('div');
    el.className = 'msg';
    el.textContent = text;
    if (color) el.style.color = color;
    this.messagesEl.appendChild(el);
    while (this.messagesEl.children.length > 4) this.messagesEl.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 2200);
    setTimeout(() => el.remove(), 2800);
  }

  // ---------- transições ----------
  fadeOut(ms = 300) {
    return new Promise((resolve) => {
      this.fadeEl.style.transitionDuration = `${ms}ms`;
      this.fadeEl.classList.add('on');
      setTimeout(resolve, ms);
    });
  }

  fadeIn(ms = 400) {
    return new Promise((resolve) => {
      // espera um quadro para a nova área ser desenhada antes de clarear
      requestAnimationFrame(() => {
        this.fadeEl.style.transitionDuration = `${ms}ms`;
        this.fadeEl.classList.remove('on');
        setTimeout(resolve, ms);
      });
    });
  }

  flashHurt() {
    this.hurtEl.classList.remove('on');
    void this.hurtEl.offsetWidth; // truque para reiniciar a animação CSS
    this.hurtEl.classList.add('on');
  }

  showDeath(goldLost) {
    $('death-sub').textContent = goldLost > 0
      ? `Você perdeu ${goldLost} de ouro. Voltando ao vilarejo...`
      : 'Voltando ao vilarejo...';
    this.deathEl.classList.remove('hidden');
  }

  hideDeath() {
    this.deathEl.classList.add('hidden');
  }

  // Chefe final derrotado. Fecha com um clique (o jogo continua por trás).
  showVictory(bossName, victories) {
    const el = $('victory-screen');
    $('victory-sub').textContent =
      `${bossName} caiu, e os portões do Oblivion se fecham${victories > 1 ? ` — pela ${victories}ª vez` : ''}. ` +
      'Pegue os tesouros dele e use a escadaria para voltar a Corvália.';
    el.classList.remove('hidden');
    el.onclick = () => el.classList.add('hidden');
  }
}
