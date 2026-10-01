/* ==========================================================================
   hud.js — Interface (HUD) em HTML sobre o canvas 3D
   --------------------------------------------------------------------------
   Os elementos ficam em index.html; aqui só atualizamos textos e barras.
   Só escrevemos no DOM quando o valor muda (evita trabalho desnecessário).
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;
  const $ = (id) => document.getElementById(id);

  ES.HUD = class HUD {
    constructor() {
      this.el = {
        planetName: $('planet-name'), planetSub: $('planet-sub'), mode: $('mode-label'),
        speed: $('speed-val'), throttleBar: $('throttle-bar'), fuelBar: $('fuel-bar'), fuelVal: $('fuel-val'),
        prompt: $('prompt'), toasts: $('toasts'), markers: $('markers'), crosshair: $('crosshair'),
        overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayBtn: $('overlay-btn'), overlaySeed: $('overlay-seed'),
        help: $('help'), localRes: $('local-res'), explored: $('explored'),
        echoBar: $('echo-bar'), echoBox: $('echo-box'), flightBox: $('flight-box'), fps: $('fps'),
        cnt: { crystal: $('cnt-crystal'), core: $('cnt-core'), essence: $('cnt-essence') },
      };
      this._cache = {};
      this._markers = new Map();
    }

    /** Escreve texto só se mudou. */
    _text(key, node, value) {
      if (this._cache[key] !== value) { this._cache[key] = value; node.textContent = value; }
    }
    _width(key, node, frac) {
      const v = Math.round(ES.clamp(frac, 0, 1) * 1000) / 10;
      if (this._cache[key] !== v) { this._cache[key] = v; node.style.width = v + '%'; }
    }
    _show(key, node, visible) {
      if (this._cache[key] !== visible) { this._cache[key] = visible; node.style.display = visible ? '' : 'none'; }
    }

    setPlace(name, sub) {
      this._text('pn', this.el.planetName, name);
      this._text('ps', this.el.planetSub, sub);
    }
    setMode(label) { this._text('mode', this.el.mode, label); }
    setFlight(speed, throttle, fuelFrac, fuelVal) {
      this._text('spd', this.el.speed, String(Math.round(speed)));
      this._width('thr', this.el.throttleBar, throttle);
      this._width('fuel', this.el.fuelBar, fuelFrac);
      this._text('fv', this.el.fuelVal, String(Math.round(fuelVal)));
      this.el.fuelBar.classList.toggle('low', fuelFrac < 0.2);
    }
    showFlightBox(v) { this._show('fb', this.el.flightBox, v); }
    showEchoBox(v) { this._show('eb', this.el.echoBox, v); }
    setEcho(frac) { this._width('echo', this.el.echoBar, frac); this.el.echoBar.classList.toggle('ready', frac >= 1); }
    setPrompt(html) {
      if (this._cache.prompt === html) return;
      this._cache.prompt = html;
      this.el.prompt.innerHTML = html || '';
      this.el.prompt.style.opacity = html ? 1 : 0;
    }
    setCrosshair(v) { this._show('ch', this.el.crosshair, v); }
    setCounts(c) {
      for (const k in this.el.cnt) this._text('c' + k, this.el.cnt[k], String(c[k] || 0));
    }
    setLocal(text) { this._text('local', this.el.localRes, text); this._show('localv', this.el.localRes, !!text); }
    setExplored(text) { this._text('expl', this.el.explored, text); }
    setFps(text) { if (text !== null) { this.el.fps.style.display = 'block'; this._text('fps', this.el.fps, text); } }

    /** Mensagem temporária no canto (ex.: "+1 Cristal Eco"). */
    toast(html, color) {
      const d = document.createElement('div');
      d.className = 'toast';
      d.innerHTML = html;
      if (color) d.style.setProperty('--c', color);
      this.el.toasts.appendChild(d);
      while (this.el.toasts.children.length > 5) this.el.toasts.removeChild(this.el.toasts.firstChild);
      setTimeout(() => d.classList.add('out'), 2600);
      setTimeout(() => d.remove(), 3200);
    }

    toggleHelp() { this.el.help.classList.toggle('open'); }

    showOverlay(title, btn, seedText) {
      this.el.overlayTitle.textContent = title;
      this.el.overlayBtn.textContent = btn;
      if (seedText) this.el.overlaySeed.textContent = seedText;
      this.el.overlay.classList.remove('hidden');
    }
    hideOverlay() { this.el.overlay.classList.add('hidden'); }

    /**
     * Marcadores flutuantes (planetas, nave) projetados na tela.
     * items = [{id, label, dist, pos: THREE.Vector3, color, kind}]
     */
    updateMarkers(items, camera) {
      const w = window.innerWidth, h = window.innerHeight, pad = 54;
      const seen = new Set();
      const placed = [];
      for (const it of items) {
        seen.add(it.id);
        let m = this._markers.get(it.id);
        if (!m) {
          const node = document.createElement('div');
          node.className = 'marker ' + (it.kind || '');
          node.innerHTML = '<div class="mk-icon"></div><div class="mk-name"></div><div class="mk-dist"></div>';
          this.el.markers.appendChild(node);
          m = { node, name: node.querySelector('.mk-name'), dist: node.querySelector('.mk-dist'), icon: node.querySelector('.mk-icon'), last: '' };
          m.name.textContent = it.label;
          this._markers.set(it.id, m);
        }
        m.icon.style.setProperty('--c', it.color);
        _p.copy(it.pos).project(camera);
        let x = _p.x, y = _p.y;
        const behind = _p.z > 1;
        if (behind) { x = -x; y = -y; }
        let sx = (x * 0.5 + 0.5) * w, sy = (-y * 0.5 + 0.5) * h;
        const onScreen = !behind && sx > pad && sx < w - pad && sy > pad && sy < h - pad;
        if (!onScreen) {
          // Fixa na borda da tela apontando a direção.
          const cx = w / 2, cy = h / 2;
          let dx = sx - cx, dy = sy - cy;
          if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = h;   // exatamente atrás: joga para baixo
          const k = Math.min((w / 2 - pad) / Math.abs(dx || 1e-6), (h / 2 - pad) / Math.abs(dy || 1e-6));
          sx = cx + dx * k; sy = cy + dy * k;
        }
        // Evita rótulos sobrepostos: empurra para dentro da tela se outro marcador estiver no mesmo lugar.
        for (const o of placed) {
          if (Math.abs(sx - o.sx) < 120 && Math.abs(sy - o.sy) < 34) sy += (sy > h / 2 ? -34 : 34);
        }
        placed.push({ sx, sy });
        m.node.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
        m.node.classList.toggle('edge', !onScreen);
        const dtxt = it.dist >= 1000 ? (it.dist / 1000).toFixed(1) + ' km' : Math.round(it.dist) + ' m';
        if (m.last !== dtxt) { m.last = dtxt; m.dist.textContent = dtxt; }
        m.node.style.display = '';
      }
      for (const [id, m] of this._markers) if (!seen.has(id)) m.node.style.display = 'none';
    }
  };

  const _p = new THREE.Vector3();
})();
