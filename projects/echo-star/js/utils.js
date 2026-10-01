/* ==========================================================================
   utils.js — Funções utilitárias do Echo Star
   --------------------------------------------------------------------------
   Tudo fica dentro do "namespace" global ES (window.ES) para que os arquivos
   possam ser carregados com <script> normal (assim o jogo abre com duplo
   clique, sem precisar de servidor).
   ========================================================================== */
(function () {
  'use strict';
  const ES = (window.ES = window.ES || {});

  /* ---------- Matemática básica ---------- */
  ES.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  ES.lerp = (a, b, t) => a + (b - a) * t;
  ES.smoothstep = (a, b, v) => {
    const t = ES.clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  /** Suavização independente de FPS: aproxima "a" de "b" (lambda maior = mais rápido). */
  ES.damp = (a, b, lambda, dt) => ES.lerp(a, b, 1 - Math.exp(-lambda * dt));

  /* ---------- Gerador aleatório com semente (mulberry32) ----------
     Mesma semente = mesmo universo. Útil para depurar e para compartilhar mundos. */
  ES.makeRng = function (seed) {
    let a = seed >>> 0;
    const next = function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = {
      next,
      range: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      },
      /** Vetor unitário uniformemente distribuído na esfera. */
      unit(out) {
        const z = next() * 2 - 1;
        const phi = next() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        return out.set(r * Math.cos(phi), z, r * Math.sin(phi));
      },
    };
    return rng;
  };

  /* ---------- Ruído 3D (Perlin melhorado) ----------
     Usado para o relevo dos planetas. Como recebe uma direção 3D, não há
     "emendas" na esfera. */
  ES.Noise3D = function (rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    rng.shuffle(p);
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const mix = (a, b, t) => a + t * (b - a);
    const grad = (h, x, y, z) => {
      h &= 15;
      const u = h < 8 ? x : y;
      const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };

    /** Ruído simples, retorna ~[-1, 1]. */
    this.get = function (x, y, z) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      const u = fade(x), v = fade(y), w = fade(z);
      const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
      const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
      return mix(
        mix(mix(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
            mix(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
        mix(mix(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
            mix(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
        w);
    };

    /** Ruído fractal: soma de várias "oitavas" (colinas grandes + detalhes pequenos). */
    this.fbm = function (x, y, z, octaves, lacunarity, gain) {
      let sum = 0, amp = 1, freq = 1, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += this.get(x * freq, y * freq, z * freq) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
      }
      return sum / norm;
    };
  };

  /* ---------- Nomes de planetas ---------- */
  const SYL_A = ['Ka', 'Ze', 'Lu', 'Mi', 'Tha', 'Vor', 'Ny', 'Ae', 'Ri', 'So', 'Qu', 'Xe', 'Ul', 'Or', 'Bel', 'Dra', 'Fen', 'Ly', 'Ar', 'Cae'];
  const SYL_B = ['ra', 'nis', 'thor', 'dun', 'lia', 'mos', 'vex', 'phi', 'tar', 'sia', 'lon', 'nea'];
  const SYL_C = ['', '', 'a', 'is', 'on', 'ae', 'ys', 'um'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
  ES.makePlanetName = function (rng, used) {
    for (let tries = 0; tries < 40; tries++) {
      const name = rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C) + ' ' + rng.pick(ROMAN);
      if (!used.has(name)) { used.add(name); return name; }
    }
    return 'Sem-nome ' + used.size;
  };

  /* ---------- Texturas geradas por código (sem arquivos de imagem) ---------- */
  /** Brilho radial suave (usado no sol, nebulosas, etc.). stops = [[0,'rgba(..)'],[1,'rgba(..)']] */
  ES.makeGlowTexture = function (stops, size) {
    size = size || 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach((s) => grad.addColorStop(s[0], s[1]));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  };

  /** Nuvem colorida: várias "manchas" radiais sobrepostas. */
  ES.makeNebulaTexture = function (rng, colorA, colorB) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const col = (hex, a) => {
      const r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255;
      return 'rgba(' + r + ',' + gg + ',' + b + ',' + a + ')';
    };
    for (let i = 0; i < 26; i++) {
      const x = size * (0.5 + (rng.next() - 0.5) * 0.6);
      const y = size * (0.5 + (rng.next() - 0.5) * 0.6);
      const r = size * rng.range(0.1, 0.3);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const hex = rng.chance(0.5) ? colorA : colorB;
      grad.addColorStop(0, col(hex, rng.range(0.12, 0.3)));
      grad.addColorStop(1, col(hex, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    // Esmaece as bordas para a nuvem não ter contorno quadrado.
    const fade = g.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size / 2);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  };
})();
