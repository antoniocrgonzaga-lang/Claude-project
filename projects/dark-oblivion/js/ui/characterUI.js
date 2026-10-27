// =============================================================
// characterUI.js — ficha do personagem (tecla C):
// atributos (com botões + para distribuir pontos), status calculados
// e a lista de habilidades da classe (com + para aprender).
// =============================================================
import { game } from '../game.js';
import { events } from '../core/events.js';
import { SKILLS } from '../skills/skillData.js';
import { canLearnSkill } from '../skills/skillSystem.js';
import { tooltip, esc } from './tooltip.js';

const ATTRIBUTES = [
  ['str', 'Força', 'Aumenta o dano do Cavaleiro (+1% por ponto).'],
  ['dex', 'Destreza', 'Aumenta o dano do Arqueiro, armadura e chance de crítico.'],
  ['int', 'Inteligência', 'Aumenta o dano mágico e o recurso máximo da Bruxa.'],
  ['vit', 'Vitalidade', 'Aumenta a vida máxima (+3 por ponto).'],
];

export class CharacterUI {
  constructor(ui) {
    this.ui = ui;
    this.el = document.getElementById('panel-character');
    this.isOpen = false;
    this.hoveredSkill = null; // habilidade sob o mouse (para atribuir à barra com 1–6, veja ui.js)
    const rerender = () => { if (this.isOpen) this.render(); };
    for (const name of ['statsChanged', 'xpChanged', 'levelUp', 'skillsChanged', 'skillBarChanged']) events.on(name, rerender);
    // O painel em si nunca é recriado: sair dele sempre limpa a habilidade sob o mouse
    this.el.addEventListener('mouseleave', () => { this.hoveredSkill = null; });
  }

  open() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.hoveredSkill = null;
    this.el.classList.add('hidden');
    tooltip.hide();
  }

  render() {
    const p = game.player;
    const s = p.stats;
    const res = p.classDef.resource;
    tooltip.hide();

    const statRow = (label, value) => `<div class="stat-row"><span>${label}</span><b>${value}</b></div>`;

    this.el.innerHTML = `
      <div class="panel-header"><span>${esc(p.name)}</span><button class="close-btn">✕</button></div>
      <div class="char-sub">${p.classDef.name} — Nível ${p.level}</div>
      <div class="char-sub">XP: ${Math.floor(p.xp)} / ${p.xpToNext}</div>

      <div class="section-title">Atributos ${p.attrPoints > 0 ? `<span class="points">${p.attrPoints} pontos</span>` : ''}</div>
      ${ATTRIBUTES.map(([key, label]) => `
        <div class="attr-row" data-attr="${key}">
          <span>${label}</span><b>${s[key]}</b>
          ${p.attrPoints > 0 ? `<button class="plus-btn" data-attr="${key}">+</button>` : '<span class="plus-space"></span>'}
        </div>`).join('')}

      <div class="section-title">Status</div>
      <div class="stats-grid">
        ${statRow('Vida', s.maxHp)}
        ${statRow(res.name, s.maxResource)}
        ${statRow('Dano (arma)', `${Math.round(s.damageMin)}–${Math.round(s.damageMax)}`)}
        ${statRow('Poder mágico', `+${Math.round(s.spellPower)}%`)}
        ${statRow('Armadura', s.armor)}
        ${statRow('Ataques/s', s.attackSpeed.toFixed(2))}
        ${statRow('Crítico', `${s.critChance.toFixed(1)}%`)}
        ${statRow('Dano crítico', `${Math.round(s.critMultiplier * 100)}%`)}
        ${statRow('Bloqueio', `${Math.round(s.blockChance)}%`)}
        ${statRow('Res. Fogo', `${s.resist.fire}%`)}
        ${statRow('Res. Gelo', `${s.resist.cold}%`)}
        ${statRow('Res. Raios', `${s.resist.lightning}%`)}
        ${statRow('Velocidade', s.moveSpeed.toFixed(1))}
      </div>

      <div class="section-title">Habilidades ${p.skillPoints > 0 ? `<span class="points">${p.skillPoints} pontos</span>` : ''}</div>
      <div class="skill-list">
        ${p.classDef.skills.map((id) => {
          const def = SKILLS[id];
          const level = p.skillLevels[id] ?? 0;
          const tag = !def.implemented ? '<span class="tag soon">em breve</span>'
            : def.behavior === 'passive' ? '<span class="tag">passiva</span>'
            : level <= 0 && def.requiresLevel > p.level ? `<span class="tag soon">nível ${def.requiresLevel}</span>` : '';
          const slot = p.skillBar.indexOf(id);
          const slotTag = slot >= 0 ? `<span class="slot-tag">[${slot + 1}]</span>` : '';
          return `
            <div class="skill-row ${def.implemented ? '' : 'disabled'}" data-skill="${id}">
              <span class="skill-icon">${def.icon}</span>
              <span class="skill-name">${esc(def.name)} ${tag}${slotTag}</span>
              <b>${def.implemented ? `${level}/${def.maxLevel}` : ''}</b>
              ${canLearnSkill(p, id) ? `<button class="plus-btn" data-skill="${id}">+</button>` : '<span class="plus-space"></span>'}
            </div>`;
        }).join('')}
      </div>
      <div class="skill-hint">Passe o mouse numa habilidade aprendida e aperte 1–${p.skillBar.length} para colocá-la na barra.</div>
    `;

    this.el.querySelector('.close-btn').addEventListener('click', () => this.close());
    for (const btn of this.el.querySelectorAll('.plus-btn[data-attr]')) {
      btn.addEventListener('click', () => p.allocateAttribute(btn.dataset.attr));
    }
    for (const btn of this.el.querySelectorAll('.plus-btn[data-skill]')) {
      btn.addEventListener('click', (e) => { e.stopPropagation(); p.learnSkill(btn.dataset.skill); });
    }
    for (const row of this.el.querySelectorAll('.attr-row')) {
      const info = ATTRIBUTES.find(([key]) => key === row.dataset.attr);
      row.addEventListener('mouseenter', (e) => tooltip.showText(info[2], e.clientX, e.clientY));
      row.addEventListener('mouseleave', () => tooltip.hide());
    }
    for (const row of this.el.querySelectorAll('.skill-row')) {
      const def = SKILLS[row.dataset.skill];
      row.addEventListener('mouseenter', (e) => {
        this.hoveredSkill = def.id;
        tooltip.showSkill(def, p.skillLevels[def.id] ?? 0, p, e.clientX, e.clientY);
      });
      row.addEventListener('mouseleave', () => {
        this.hoveredSkill = null;
        tooltip.hide();
      });
    }
  }
}
