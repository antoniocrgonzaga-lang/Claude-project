// =============================================================
// tooltip.js — a caixinha de descrição que segue o mouse
// (itens, habilidades, botões).
// =============================================================
import { itemTooltipLines, rarityColor } from '../systems/loot.js';
import { describeSkill } from '../skills/skillSystem.js';

// Escapa texto para HTML (evita que um nome com "<" quebre a página)
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let visible = false;
const el = () => document.getElementById('tooltip');

function position(x, y) {
  const t = el();
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = x + 18, top = y + 18;
  if (left + w > window.innerWidth - 8) left = x - w - 18;
  if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${top}px`;
}

window.addEventListener('mousemove', (e) => { if (visible) position(e.clientX, e.clientY); });

export function itemHtml(item, player, extraLines = []) {
  const lines = itemTooltipLines(item, player);
  return `
    <div class="tt-name" style="color:${rarityColor(item.rarity)}">${esc(item.name)}</div>
    ${item.name !== item.baseName ? `<div class="tt-base">${esc(item.baseName)}</div>` : ''}
    ${lines.map((l) => `<div class="tt-line ${l.cls}">${esc(l.text)}</div>`).join('')}
    ${extraLines.map((l) => `<div class="tt-line ${l.cls ?? ''}">${esc(l.text)}</div>`).join('')}
  `;
}

export const tooltip = {
  showHtml(html, x, y) {
    const t = el();
    t.innerHTML = html;
    t.classList.remove('hidden');
    visible = true;
    position(x, y);
  },

  showText(text, x, y) {
    this.showHtml(`<div class="tt-line">${esc(text)}</div>`, x, y);
  },

  // compare = item equipado no mesmo slot (aparece embaixo, para comparar)
  showItem(item, x, y, { player = null, compare = null, extra = [] } = {}) {
    let html = itemHtml(item, player, extra);
    if (compare && compare !== item) {
      html += `<div class="tt-compare"><div class="tt-compare-title">Equipado agora</div>${itemHtml(compare, player)}</div>`;
    }
    this.showHtml(html, x, y);
  },

  showSkill(def, level, player, x, y) {
    const lines = def.implemented ? describeSkill(def, level, player) : [];
    let status = '';
    if (!def.implemented) status = '<div class="tt-line tt-bad">Em breve (próxima etapa)</div>';
    else if (def.behavior === 'passive') status = '<div class="tt-line tt-implicit">Habilidade passiva</div>';
    else if (level <= 0) status = '<div class="tt-line tt-bad">Ainda não aprendida</div>';

    // Mostra só o que muda no próximo nível (para o jogador ver se vale o ponto)
    let next = '';
    if (def.implemented && level > 0 && level < def.maxLevel) {
      const current = new Set(lines);
      const changed = describeSkill(def, level + 1, player).filter((l) => !current.has(l));
      if (changed.length) {
        next = `<div class="tt-next"><div class="tt-next-title">Próximo nível</div>${changed.map((l) => `<div class="tt-line">${esc(l)}</div>`).join('')}</div>`;
      }
    }

    const html = `
      <div class="tt-name">${def.icon} ${esc(def.name)}</div>
      ${def.implemented ? `<div class="tt-type">Nível ${level} / ${def.maxLevel}</div>` : ''}
      <div class="tt-desc">${esc(def.description)}</div>
      ${lines.map((l) => `<div class="tt-line">${esc(l)}</div>`).join('')}
      ${next}
      ${def.requiresLevel > 1 ? `<div class="tt-line ${player && player.level < def.requiresLevel ? 'tt-bad' : 'tt-req'}">Requer nível ${def.requiresLevel}</div>` : ''}
      ${status}
    `;
    this.showHtml(html, x, y);
  },

  hide() {
    el().classList.add('hidden');
    visible = false;
  },
};
