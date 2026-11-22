import { SHIPS, TRACKS, STAT_KEYS, saveSettings } from './Config.js';
import { formatTime, hexCss } from './Utils.js';
import { t, translateDom } from './I18n.js';
import { keyCodeOf } from './InputManager.js';

const $ = (id) => document.getElementById(id);

/** Telas do jogo (título, seleção, instruções, opções, pausa, resultado). Comunica-se apenas por eventos. */
export class Menu {
  constructor(bus, settings) {
    this.bus = bus;
    this.settings = settings;
    this.root = $('screens');
    this.screens = {};
    for (const el of this.root.querySelectorAll('.screen')) this.screens[el.id.replace('screen-', '')] = el;
    this.current = null;
    this.returnTo = 'title';
    this.shipIndex = 0;
    this.trackIndex = 0;
    this.trackLengths = {};

    this._buildCards();
    this._bindOptions();

    this.root.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) return this._selectCard(card);
      const btn = e.target.closest('[data-action]');
      if (btn) this._action(btn.dataset.action);
    });

    window.addEventListener('keydown', (e) => {
      if (!this.current) return;
      if (e.target instanceof HTMLInputElement) return;
      const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[keyCodeOf(e)];
      if (!dir) return;
      const items = [...this.screens[this.current].querySelectorAll('button')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      items[(i + dir + items.length) % items.length].focus();
      e.preventDefault();
    });
  }

  get visible() { return this.current !== null; }

  show(name) {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('hidden', key !== name);
    this.current = name;
    if (name === 'options') {
      // Durante a corrida, avisa que a dificuldade só muda na próxima largada.
      $('opt-difficulty-note').classList.toggle('hidden', this.returnTo !== 'pause');
    }
    const focus = this.screens[name].querySelector('.card.selected, .btn.primary');
    focus?.focus({ preventScroll: true });
  }

  hide() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
    this.current = null;
    document.activeElement?.blur?.();
  }

  /** Reaplica os textos após a troca de idioma. */
  retranslate() {
    translateDom();
    this._buildCards();
  }

  _action(action) {
    const back = action.startsWith('back');
    this.bus.emit('menu:sound', back ? 'back' : 'menu');
    switch (action) {
      case 'play': this.show('ship'); this.bus.emit('menu:ship', this.shipIndex); break;
      case 'help': this.returnTo = this.current; this.show('help'); break;
      case 'options': this.returnTo = this.current; this.show('options'); break;
      case 'back': this.show(this.returnTo); break;
      case 'back-title': this.show('title'); break;
      case 'back-ship': this.show('ship'); break;
      case 'to-track': this.show('track'); break;
      case 'start': this.bus.emit('menu:start', { ship: this.shipIndex, track: this.trackIndex }); break;
      case 'resume': this.bus.emit('menu:resume'); break;
      case 'restart': this.bus.emit('menu:restart'); break;
      case 'quit': this.bus.emit('menu:quit'); break;
    }
  }

  // ---------------------------------------------------------------- cartões

  _buildCards() {
    const ships = $('ship-cards');
    ships.replaceChildren();
    SHIPS.forEach((ship, i) => {
      const card = document.createElement('button');
      card.className = 'card';
      card.dataset.kind = 'ship';
      card.dataset.index = i;
      card.style.setProperty('--card-color', hexCss(ship.color));
      const stats = STAT_KEYS.map((key) => {
        const pips = Array.from({ length: 5 }, (_, n) => `<i class="${n < ship.rating[key] ? 'on' : ''}"></i>`).join('');
        return `<div class="stat"><span>${t(`stat.${key}`)}</span><div class="pips">${pips}</div></div>`;
      }).join('');
      card.innerHTML = `<h3>${ship.name}</h3><p>${t(`ship.${ship.id}.blurb`)}</p>${stats}`;
      ships.append(card);
    });

    const tracks = $('track-cards');
    tracks.replaceChildren();
    TRACKS.forEach((track, i) => {
      const card = document.createElement('button');
      card.className = 'card';
      card.dataset.kind = 'track';
      card.dataset.index = i;
      card.style.setProperty('--card-color', hexCss(track.palette.edgeR));
      card.innerHTML = `<h3>${track.name}</h3><p>${t(`track.${track.id}.blurb`)}</p>
        <div class="meta"><span>${t('card.difficulty')}</span><b>${t(`trackDiff.${track.difficulty}`)}</b></div>
        <div class="meta"><span>${t('card.length')}</span><b data-length="${i}">—</b></div>`;
      tracks.append(card);
    });
    for (const [index, length] of Object.entries(this.trackLengths)) this.setTrackLength(index, length);
    this._markSelected();
  }

  setTrackLength(index, length) {
    this.trackLengths[index] = length;
    const el = this.root.querySelector(`[data-length="${index}"]`);
    if (el) el.textContent = `${(length / 1000).toFixed(1)} KM`;
  }

  _selectCard(card) {
    const index = Number(card.dataset.index);
    this.bus.emit('menu:sound', 'menu');
    if (card.dataset.kind === 'ship') {
      if (this.shipIndex === index) return this.show('track');
      this.shipIndex = index;
      this.bus.emit('menu:ship', index);
    } else {
      if (this.trackIndex === index) return this.bus.emit('menu:start', { ship: this.shipIndex, track: this.trackIndex });
      this.trackIndex = index;
      this.bus.emit('menu:track', index);
    }
    this._markSelected();
  }

  _markSelected() {
    for (const card of this.root.querySelectorAll('.card')) {
      const selected = Number(card.dataset.index) === (card.dataset.kind === 'ship' ? this.shipIndex : this.trackIndex);
      card.classList.toggle('selected', selected);
    }
  }

  // ---------------------------------------------------------------- opções

  _bindOptions() {
    const s = this.settings;
    const changed = () => {
      saveSettings(s);
      this.bus.emit('settings:changed');
    };

    /** Grupo de botões exclusivos ligado a uma chave das configurações (data-<attr> = valor). */
    const segmented = (id, key, attr, onPick) => {
      const box = $(id);
      const mark = () => {
        for (const btn of box.children) btn.classList.toggle('active', btn.dataset[attr] === s[key]);
      };
      box.addEventListener('click', (e) => {
        const value = e.target.closest('button')?.dataset[attr];
        if (!value || value === s[key]) return;
        this.bus.emit('menu:sound', 'menu');
        s[key] = value;
        onPick?.(value);
        mark();
        changed();
      });
      mark();
    };

    segmented('opt-language', 'language', 'language');
    segmented('opt-difficulty', 'difficulty', 'difficulty');
    segmented('opt-quality', 'quality', 'quality', (q) => {
      if (q === 'high') { s.shadows = true; $('opt-shadows').checked = true; }
      if (q === 'low') { s.shadows = false; $('opt-shadows').checked = false; }
    });

    for (const key of ['crt', 'shadows']) {
      const input = $(`opt-${key}`);
      input.checked = s[key];
      input.addEventListener('change', () => { s[key] = input.checked; changed(); });
    }
    for (const key of ['master', 'music', 'engine', 'sfx']) {
      const input = $(`opt-${key}`);
      input.value = s[key];
      input.addEventListener('input', () => { s[key] = Number(input.value); changed(); });
    }
  }

  // ---------------------------------------------------------------- resultado

  showResults(rows, playerPosition, { track, difficulty }) {
    $('results-title').textContent = playerPosition === 1 ? t('results.win') : t('place', { n: playerPosition });
    $('results-sub').textContent = t('results.sub', { track, difficulty: t(`diff.${difficulty}`) });
    const table = $('results-table');
    table.replaceChildren();
    const head = document.createElement('tr');
    for (const key of ['results.pos', 'results.pilot', 'results.ship', 'results.time', 'results.best']) {
      const th = document.createElement('th');
      th.textContent = t(key);
      head.append(th);
    }
    table.append(head);
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'me';
      const cells = [t('posShort', { n: row.position }), row.name, row.ship, (row.estimated ? '~' : '') + formatTime(row.time), formatTime(row.best)];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      table.append(tr);
    }
    this.show('results');
  }
}
