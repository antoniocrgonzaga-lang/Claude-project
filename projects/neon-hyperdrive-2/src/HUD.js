import { CONFIG } from './Config.js';
import { formatTime, hexCss } from './Utils.js';

const $ = (id) => document.getElementById(id);

/** Interface da corrida (DOM). Só toca no DOM quando um valor realmente muda. */
export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      pos: $('hud-pos'), total: $('hud-total'), lap: $('hud-lap'), laps: $('hud-laps'),
      time: $('hud-time'), lapTime: $('hud-laptime'), best: $('hud-best'),
      speed: $('hud-speed'), energy: $('hud-energy'), boost: $('hud-boost'), boostInd: $('hud-boost-ind'),
      board: $('hud-board'), msg: $('hud-msg'), count: $('hud-count'), warn: $('hud-warn'), low: $('hud-low'),
      map: $('hud-map'),
    };
    this.energyBar = this.el.energy.closest('.bar');
    this.cache = {};
    this.mapCtx = this.el.map.getContext('2d');
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.el.map.width;
    this.mapBase.height = this.el.map.height;
    this.boardTimer = 0;
    this.boardRows = [];
    this.frame = 0;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  reset(shipCount, laps) {
    this.cache = {};
    this.el.msg.innerHTML = '';
    this.el.count.textContent = '';
    this.el.total.textContent = shipCount;
    this.el.laps.textContent = laps;
    this.el.board.innerHTML = '';
    this.boardRows = [];
    for (let i = 0; i < shipCount; i++) {
      const li = document.createElement('li');
      const rank = document.createElement('b');
      rank.textContent = i + 1;
      const name = document.createElement('span');
      li.append(rank, name);
      this.el.board.append(li);
      this.boardRows.push({ li, name, key: '' });
    }
    this.setWrongWay(false);
    this.setLowEnergy(false);
  }

  _text(key, el, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  update(dt, player, ranking, raceTime, laps) {
    const el = this.el;
    this.frame++;
    this._text('pos', el.pos, player.racePosition);
    this._text('lap', el.lap, Math.min(laps, Math.max(1, player.lapsDone + 1)));
    this._text('speed', el.speed, Math.round(player.v * CONFIG.race.speedDisplayFactor));
    this._text('best', el.best, formatTime(player.bestLap));
    if (this.frame % 2 === 0) {
      const total = player.finished ? player.finishTime : raceTime;
      this._text('time', el.time, formatTime(total));
      this._text('lapTime', el.lapTime, formatTime(player.finished ? player.lastLap : raceTime - player.lapStart));
    }

    const energy = Math.max(0, player.energyRatio).toFixed(3);
    if (this.cache.energy !== energy) {
      this.cache.energy = energy;
      el.energy.style.transform = `scaleX(${energy})`;
    }
    const boost = player.boostCap.toFixed(3);
    if (this.cache.boost !== boost) {
      this.cache.boost = boost;
      el.boost.style.transform = `scaleX(${boost})`;
    }
    const boosting = player.boostActive;
    if (this.cache.boosting !== boosting) {
      this.cache.boosting = boosting;
      el.boostInd.classList.toggle('on', boosting);
    }

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.25;
      ranking.forEach((ship, i) => {
        const row = this.boardRows[i];
        if (!row || row.key === ship.id) return;
        row.key = ship.id;
        row.name.textContent = ship.name;
        row.li.style.setProperty('--c', hexCss(ship.color));
        row.li.classList.toggle('me', ship.isPlayer);
      });
    }

    if (this.frame % 2 === 1) this._drawMap(ranking);
  }

  // ---------------------------------------------------------------- mensagens

  message(text, { kind = '', sub = '', duration = 1.8 } = {}) {
    const div = document.createElement('div');
    div.className = `msg ${kind}`;
    div.textContent = text;
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      div.append(small);
    }
    const box = this.el.msg;
    while (box.children.length >= 2) box.firstChild.remove();
    box.append(div);
    setTimeout(() => div.remove(), duration * 1000);
  }

  clearMessages() { this.el.msg.innerHTML = ''; }

  /** Força a reescrita dos nomes do placar (ex.: troca de idioma). */
  refreshBoard() {
    for (const row of this.boardRows) row.key = '';
    this.boardTimer = 0;
  }

  setCountdown(text) {
    const el = this.el.count;
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    if (text) el.classList.add('pop');
  }

  setWrongWay(on) {
    if (this.cache.wrong === on) return;
    this.cache.wrong = on;
    this.el.warn.classList.toggle('hidden', !on);
  }

  setLowEnergy(on) {
    if (this.cache.low === on) return;
    this.cache.low = on;
    this.el.low.classList.toggle('on', on);
    this.energyBar.classList.toggle('low', on);
  }

  // ---------------------------------------------------------------- minimapa

  buildMinimap(track) {
    const size = this.mapBase.width;
    const pad = 16;
    const { minX, maxX, minZ, maxZ } = track.bounds;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
    const oz = (size - (maxZ - minZ) * scale) / 2 - minZ * scale;
    this.mapXf = { scale, ox, oz };

    const c = this.mapBase.getContext('2d');
    c.clearRect(0, 0, size, size);
    const path = () => {
      c.beginPath();
      const o = track.outline;
      for (let i = 0; i < o.length; i += 2) {
        const x = o[i] * scale + ox, y = o[i + 1] * scale + oz;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath();
    };
    c.lineJoin = 'round';
    path();
    c.strokeStyle = hexCss(track.palette.edgeR);
    c.globalAlpha = 0.35;
    c.lineWidth = 7;
    c.stroke();
    path();
    c.globalAlpha = 1;
    c.strokeStyle = '#e8f6ff';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = '#ffe14d';
    c.fillRect(track.outline[0] * scale + ox - 3, track.outline[1] * scale + oz - 3, 6, 6);
  }

  _drawMap(ships) {
    const xf = this.mapXf;
    if (!xf) return;
    const c = this.mapCtx;
    const size = this.el.map.width;
    c.clearRect(0, 0, size, size);
    c.drawImage(this.mapBase, 0, 0);
    for (let i = ships.length - 1; i >= 0; i--) {
      const ship = ships[i];
      if (ship.destroyed) continue;
      const x = ship.position.x * xf.scale + xf.ox;
      const y = ship.position.z * xf.scale + xf.oz;
      c.beginPath();
      c.arc(x, y, ship.isPlayer ? 5 : 3.2, 0, Math.PI * 2);
      c.fillStyle = hexCss(ship.color);
      c.fill();
      if (ship.isPlayer) {
        c.lineWidth = 2;
        c.strokeStyle = '#fff';
        c.stroke();
      }
    }
  }
}
