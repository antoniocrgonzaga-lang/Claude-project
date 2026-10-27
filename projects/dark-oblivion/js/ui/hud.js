// =============================================================
// hud.js — interface sempre visível durante o jogo:
//   orbe de vida (esquerda), orbe do recurso (direita), barra de XP,
//   barra de habilidades (1-4), cinto de poções (Q, W, T), ouro,
//   nome/nível/área, e o quadro do alvo debaixo do mouse.
//
// Desempenho: só escrevemos no HTML quando o valor muda
// (funções setText / setStyle guardam o último valor).
// =============================================================
import { game } from '../game.js';
import { events } from '../core/events.js';
import { SKILLS } from '../skills/skillData.js';
import { skillCost } from '../skills/skillSystem.js';
import { CONSUMABLES } from '../data/items.js';
import { tooltip, esc } from './tooltip.js';

function setText(el, text) {
  if (el._text !== text) { el._text = text; el.textContent = text; }
}
function setStyle(el, prop, value) {
  const key = `_style_${prop}`;
  if (el[key] !== value) { el[key] = value; el.style[prop] = value; }
}
function toggleClass(el, cls, on) {
  const key = `_class_${cls}`;
  if (el[key] !== on) { el[key] = on; el.classList.toggle(cls, on); }
}

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(ui) {
    this.ui = ui;
    this.el = $('hud');
    this.player = null;
    this.el.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-name" id="hud-name"></div>
        <div class="hud-sub" id="hud-sub"></div>
        <div class="hud-area" id="hud-area"></div>
      </div>
      <div class="boss-bar hidden" id="boss-bar">
        <div class="boss-name" id="boss-name"></div>
        <div class="boss-track"><div class="boss-fill" id="boss-fill"></div></div>
      </div>
      <div class="hud-target hidden" id="hud-target">
        <div class="target-name" id="target-name"></div>
        <div class="target-bar" id="target-bar"><div class="target-fill" id="target-fill"></div></div>
      </div>
      <div class="hud-gold" id="hud-gold"></div>
      <div class="hud-help">Esq.: andar/atacar • Dir.: habilidade • 1–6 escolher • Q/W poções • T portal • I inventário • C personagem • Z/X girar • Scroll zoom</div>
      <div class="hud-bottom">
        <div class="orb orb-hp" id="orb-hp"><div class="orb-fill" id="hp-fill"></div><div class="orb-shade"></div><div class="orb-gloss"></div><div class="orb-text" id="hp-text"></div></div>
        <div class="hud-center">
          <div class="cast-bar hidden" id="cast-bar"><div class="cast-fill" id="cast-fill"></div><span class="cast-text" id="cast-text"></span></div>
          <div class="effects-row" id="effects-row"></div>
          <div class="xp-bar" id="xp-bar"><div class="xp-fill" id="xp-fill"></div><div class="xp-text" id="xp-text"></div></div>
          <div class="hud-row">
            <div class="belt" id="belt"></div>
            <div class="skill-slots" id="skill-slots"></div>
            <div class="hud-menu">
              <button class="menu-btn" id="btn-inv" title="Inventário (I)">🎒<span>I</span></button>
              <button class="menu-btn" id="btn-char" title="Personagem (C)">📜<span>C</span><b class="badge hidden" id="char-badge">+</b></button>
            </div>
          </div>
        </div>
        <div class="orb orb-res" id="orb-res"><div class="orb-fill" id="res-fill"></div><div class="orb-shade"></div><div class="orb-gloss"></div><div class="orb-text" id="res-text"></div></div>
      </div>
    `;
    this.refs = {
      name: $('hud-name'), sub: $('hud-sub'), area: $('hud-area'), gold: $('hud-gold'),
      hpFill: $('hp-fill'), hpText: $('hp-text'), resFill: $('res-fill'), resText: $('res-text'), resOrb: $('orb-res'),
      xpFill: $('xp-fill'), xpText: $('xp-text'), xpBar: $('xp-bar'),
      target: $('hud-target'), targetName: $('target-name'), targetFill: $('target-fill'), targetBar: $('target-bar'),
      belt: $('belt'), slots: $('skill-slots'), charBadge: $('char-badge'),
      bossBar: $('boss-bar'), bossName: $('boss-name'), bossFill: $('boss-fill'),
      castBar: $('cast-bar'), castFill: $('cast-fill'), castText: $('cast-text'),
      effects: $('effects-row'),
    };
    $('btn-inv').addEventListener('click', () => ui.togglePanel('inventory'));
    $('btn-char').addEventListener('click', () => ui.togglePanel('character'));
    events.on('areaChanged', (a) => setText(this.refs.area, a.name));
    events.on('skillBarChanged', () => { if (this.player) this.buildSkillSlots(); });

    // Tooltips dos orbes
    const hover = (el, fn) => {
      el.addEventListener('mouseenter', (e) => fn(e));
      el.addEventListener('mouseleave', () => tooltip.hide());
    };
    hover($('orb-hp'), (e) => tooltip.showText('Vida — quando chega a zero, você morre.', e.clientX, e.clientY));
    hover(this.refs.resOrb, (e) => tooltip.showText(`${this.player?.classDef.resource.name}: usado pelas habilidades.`, e.clientX, e.clientY));
    hover(this.refs.xpBar, (e) => tooltip.showText(`Experiência: ${Math.floor(this.player.xp)} / ${this.player.xpToNext}`, e.clientX, e.clientY));
  }

  show(player) {
    this.player = player;
    this.el.classList.remove('hidden');
    this.refs.resOrb.style.setProperty('--res-color', player.classDef.resource.color);
    this.buildBelt();
    this.buildSkillSlots();
  }

  hide() {
    this.el.classList.add('hidden');
  }

  buildBelt() {
    const p = this.player;
    this.refs.belt.innerHTML = ['hp', 'res', 'scroll'].map((k) => `
      <div class="slot belt-slot" data-kind="${k}">
        <span class="key">${CONSUMABLES[k].key}</span>
        <span class="icon">${CONSUMABLES[k].icon}</span>
        <span class="count"></span>
      </div>`).join('');
    this.beltEls = {};
    for (const el of this.refs.belt.querySelectorAll('.belt-slot')) {
      const kind = el.dataset.kind;
      this.beltEls[kind] = el.querySelector('.count');
      el.addEventListener('click', () => (kind === 'scroll' ? p.useTownPortalScroll() : p.drinkPotion(kind)));
      el.addEventListener('mouseenter', (e) => {
        const c = CONSUMABLES[kind];
        const name = kind === 'res' ? `Poção de ${p.classDef.resource.name}` : c.name;
        tooltip.showHtml(`<div class="tt-name">${c.icon} ${esc(name)}</div><div class="tt-desc">${esc(c.description)}</div><div class="tt-line tt-req">Tecla ${c.key}</div>`, e.clientX, e.clientY);
      });
      el.addEventListener('mouseleave', () => tooltip.hide());
    }
  }

  buildSkillSlots() {
    const p = this.player;
    this.refs.slots.innerHTML = p.skillBar.map((id, i) => `
      <div class="slot skill-slot" data-index="${i}">
        <span class="key">${i + 1}</span>
        <span class="icon">${SKILLS[id]?.icon ?? ''}</span>
        <span class="lvl"></span>
        <div class="cd"></div>
      </div>`).join('');
    this.slotEls = [...this.refs.slots.querySelectorAll('.skill-slot')].map((el, i) => {
      el.addEventListener('click', () => p.selectSlot(i));
      el.addEventListener('mouseenter', (e) => {
        const def = SKILLS[p.skillBar[i]];
        if (def) tooltip.showSkill(def, p.skillLevels[def.id] ?? 0, p, e.clientX, e.clientY);
        else tooltip.showText(`Espaço vazio. Na ficha (C), passe o mouse numa habilidade e aperte ${i + 1}.`, e.clientX, e.clientY);
      });
      el.addEventListener('mouseleave', () => tooltip.hide());
      return { el, cd: el.querySelector('.cd'), lvl: el.querySelector('.lvl') };
    });
  }

  update() {
    const p = this.player;
    if (!p) return;
    const r = this.refs;

    setText(r.name, p.name);
    setText(r.sub, `${p.classDef.name} • Nível ${p.level}`);
    setText(r.gold, `💰 ${p.gold}`);

    const hpPct = Math.max(0, Math.min(1, p.hp / p.stats.maxHp));
    setStyle(r.hpFill, 'height', `${(hpPct * 100).toFixed(1)}%`);
    setText(r.hpText, `${Math.ceil(p.hp)} / ${p.stats.maxHp}`);

    const resPct = p.stats.maxResource > 0 ? Math.max(0, Math.min(1, p.resource / p.stats.maxResource)) : 0;
    setStyle(r.resFill, 'height', `${(resPct * 100).toFixed(1)}%`);
    setText(r.resText, `${Math.floor(p.resource)} / ${p.stats.maxResource}`);

    setStyle(r.xpFill, 'width', `${((p.xp / p.xpToNext) * 100).toFixed(1)}%`);
    setText(r.xpText, `Nível ${p.level} — ${Math.floor(p.xp)} / ${p.xpToNext} XP`);

    for (const kind in this.beltEls) setText(this.beltEls[kind], String(p.potions[kind]));

    // Barra de habilidades: selecionada, bloqueada, sem recurso, recarga
    this.slotEls.forEach((slot, i) => {
      const def = SKILLS[p.skillBar[i]];
      toggleClass(slot.el, 'selected', i === p.selectedSlot);
      toggleClass(slot.el, 'empty', !def);
      if (!def) return;
      const level = p.skillLevels[def.id] ?? 0;
      const locked = !def.implemented || level <= 0;
      const passive = def.behavior === 'passive';
      toggleClass(slot.el, 'locked', locked);
      toggleClass(slot.el, 'passive', passive && !locked);
      toggleClass(slot.el, 'nores', !locked && !passive && p.resource < skillCost(def, level));
      setText(slot.lvl, locked ? '' : String(level));
      const cd = p.cooldowns[def.id] ?? 0;
      setStyle(slot.cd, 'height', cd > 0 && def.cooldown > 0 ? `${((cd / def.cooldown) * 100).toFixed(0)}%` : '0%');
    });

    toggleClass(r.charBadge, 'hidden', p.attrPoints <= 0 && p.skillPoints <= 0);

    this.updateCastBar(p);
    this.updateEffects(p);
    this.updateBossBar();

    // Quadro do alvo (inimigo ou objeto debaixo do mouse) + cursor
    const pick = game.pick;
    const enemy = pick.enemy;
    if (enemy) {
      toggleClass(r.target, 'hidden', false);
      toggleClass(r.targetBar, 'hidden', false);
      setText(r.targetName, `${enemy.name} (Nv ${enemy.level})`);
      setStyle(r.targetFill, 'width', `${((enemy.hp / enemy.stats.maxHp) * 100).toFixed(1)}%`);
    } else if (pick.interactable) {
      toggleClass(r.target, 'hidden', false);
      toggleClass(r.targetBar, 'hidden', true);
      setText(r.targetName, pick.interactable.name);
    } else {
      toggleClass(r.target, 'hidden', true);
    }
    const cursor = enemy ? 'attack' : pick.interactable ? 'interact' : '';
    if (document.body.dataset.cursor !== cursor) document.body.dataset.cursor = cursor;
  }

  // Barra de canalização (Drenar Vida) ou de carga (Tiro Concentrado)
  updateCastBar(p) {
    const r = this.refs;
    const s = p.sustained;
    toggleClass(r.castBar, 'hidden', !s);
    if (!s) return;
    let pct = 1, text = s.def.name;
    if (s.def.behavior === 'charged') {
      pct = Math.min(1, s.t / s.def.params.maxCharge);
      text = `${s.def.name} — ${Math.round(pct * 100)}%`;
    }
    toggleClass(r.castBar, 'full', s.def.behavior === 'charged' && pct >= 1);
    toggleClass(r.castBar, 'channel', s.def.behavior === 'channel');
    setStyle(r.castFill, 'width', `${(pct * 100).toFixed(0)}%`);
    setText(r.castText, text);
  }

  // Ícones dos efeitos ativos no jogador (buffs, lentidão, atordoamento)
  updateEffects(p) {
    const signature = p.effects.map((e) => `${e.id}:${Math.ceil(e.remaining)}`).join('|');
    if (signature === this._effectsSignature) return; // nada mudou: não mexe no HTML
    this._effectsSignature = signature;
    this.refs.effects.innerHTML = p.effects.map((e) =>
      `<span class="fx-chip fx-${e.type}" title="${esc(e.name || e.type)}">${e.icon} ${Math.ceil(e.remaining)}s</span>`).join('');
  }

  // Barra grande do chefe no topo da tela (aparece quando ele percebe o jogador)
  updateBossBar() {
    const r = this.refs;
    const boss = game.world.boss;
    const show = !!boss && boss.alive && boss.state !== 'idle';
    toggleClass(r.bossBar, 'hidden', !show);
    toggleClass(this.el, 'boss-active', show);
    if (!show) return;
    setText(r.bossName, `${boss.name}${boss.enraged ? ' — EM FÚRIA' : ''}`);
    setStyle(r.bossFill, 'width', `${((boss.hp / boss.stats.maxHp) * 100).toFixed(1)}%`);
    toggleClass(r.bossBar, 'enraged', boss.enraged);
  }
}
