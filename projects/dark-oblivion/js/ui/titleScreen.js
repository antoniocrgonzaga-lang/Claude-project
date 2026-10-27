// =============================================================
// titleScreen.js — tela inicial:
//   - "Continuar": lista os personagens salvos (Jogar / Apagar)
//   - "Novo Personagem": escolher classe, tom de pele e nome
// =============================================================
import * as THREE from 'three';
import { CLASSES, CLASS_ORDER } from '../classes/index.js';
import { SKILLS } from '../skills/skillData.js';
import { SKIN_TONES } from '../data/models.js';
import { listSaves, deleteSave } from '../save.js';
import { esc } from './tooltip.js';

const CLASS_ICONS = { knight: '⚔️', witch: '🔮', archer: '🏹' };

// Cor de cada bolinha de tom: uma pele clara de referência multiplicada pelo tint
// (a mesma conta que o jogo faz na pele do modelo)
const SWATCH_BASE = 0xf2d8c6;
const swatchColor = (tint) => new THREE.Color(SWATCH_BASE).multiply(new THREE.Color(tint)).getStyle();

export class TitleScreen {
  constructor() {
    this.el = document.getElementById('title-screen');
    this.selectedClass = CLASS_ORDER[0];
    this.selectedTone = 0;
    this.callbacks = null;
  }

  // callbacks = { onNew({ classId, name, skinTone }), onLoad(saveData) }
  show(callbacks) {
    this.callbacks = callbacks;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.el.classList.add('hidden');
  }

  render() {
    const saves = listSaves();
    this.el.innerHTML = `
      <div class="title-wrap">
        <h1 class="logo">Dark Oblivion</h1>
        <div class="subtitle">Os portões do esquecimento foram abertos.</div>

        ${saves.length ? `
          <section class="title-section">
            <h2>Continuar</h2>
            <div class="save-list">
              ${saves.map((s) => `
                <div class="save-row" data-id="${esc(s.id)}">
                  <span class="save-icon">${CLASS_ICONS[s.classId] ?? '❔'}</span>
                  <div class="save-info">
                    <b>${esc(s.name)}</b>${s.victories ? ' 👑' : ''} — ${CLASSES[s.classId]?.name ?? s.classId}, nível ${s.level}
                    <div class="save-meta">Andar mais fundo: ${s.deepestFloor || '—'} • 💰 ${s.gold}</div>
                  </div>
                  <button class="btn primary play-btn">Jogar</button>
                  <button class="btn danger del-btn" title="Apagar personagem">✕</button>
                </div>`).join('')}
            </div>
          </section>` : ''}

        <section class="title-section">
          <h2>Novo Personagem</h2>
          <div class="class-cards">
            ${CLASS_ORDER.map((id) => {
              const c = CLASSES[id];
              return `
                <div class="class-card ${id === this.selectedClass ? 'selected' : ''}" data-class="${id}">
                  <div class="class-icon">${CLASS_ICONS[id]}</div>
                  <div class="class-name">${c.name}</div>
                  <div class="class-res" style="color:${c.resource.color}">Recurso: ${c.resource.name}</div>
                  <div class="class-desc">${esc(c.description)}</div>
                  <div class="class-attrs">For ${c.attributes.str} • Des ${c.attributes.dex} • Int ${c.attributes.int} • Vit ${c.attributes.vit}</div>
                  <div class="class-skills">
                    ${c.skillBar.map((sid) => {
                      const s = SKILLS[sid];
                      const soon = !s.implemented ? ' <span class="tag soon">em breve</span>' : '';
                      const passive = s.implemented && s.behavior === 'passive' ? ' <span class="tag">passiva</span>' : '';
                      return `<div>${s.icon} ${esc(s.name)}${soon}${passive}</div>`;
                    }).join('')}
                  </div>
                </div>`;
            }).join('')}
          </div>
          <div class="tone-row">
            <span class="tone-label">Tom de pele</span>
            ${SKIN_TONES.map((tone, i) => `
              <button class="tone-swatch ${i === this.selectedTone ? 'selected' : ''}" data-tone="${i}"
                title="${esc(tone.name)}" style="background:${swatchColor(tone.tint)}"></button>`).join('')}
            <span class="tone-name" id="tone-name">${esc(SKIN_TONES[this.selectedTone].name)}</span>
          </div>
          <div class="name-row">
            <input id="char-name" maxlength="16" placeholder="Nome do personagem" autocomplete="off" />
            <button class="btn primary" id="btn-start">Iniciar Jornada</button>
          </div>
        </section>
      </div>
    `;

    for (const card of this.el.querySelectorAll('.class-card')) {
      card.addEventListener('click', () => {
        this.selectedClass = card.dataset.class;
        for (const c of this.el.querySelectorAll('.class-card')) c.classList.toggle('selected', c === card);
      });
    }

    for (const swatch of this.el.querySelectorAll('.tone-swatch')) {
      swatch.addEventListener('click', () => {
        this.selectedTone = Number(swatch.dataset.tone);
        for (const s of this.el.querySelectorAll('.tone-swatch')) s.classList.toggle('selected', s === swatch);
        this.el.querySelector('#tone-name').textContent = SKIN_TONES[this.selectedTone].name;
      });
    }

    const nameInput = this.el.querySelector('#char-name');
    const start = () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        nameInput.classList.add('shake');
        setTimeout(() => nameInput.classList.remove('shake'), 400);
        return;
      }
      this.callbacks.onNew({ classId: this.selectedClass, name, skinTone: this.selectedTone });
    };
    this.el.querySelector('#btn-start').addEventListener('click', start);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

    for (const row of this.el.querySelectorAll('.save-row')) {
      const id = row.dataset.id;
      const data = saves.find((s) => s.id === id);
      row.querySelector('.play-btn').addEventListener('click', () => this.callbacks.onLoad(data));
      row.querySelector('.del-btn').addEventListener('click', () => {
        if (confirm(`Apagar ${data.name} para sempre?`)) {
          deleteSave(id);
          this.render();
        }
      });
    }
  }
}
