// =============================================================
// textures.js — texturas geradas por código (sem arquivos de imagem).
//
// Cada textura é pintada uma única vez num <canvas> e reaproveitada.
// Todas "emendam" sem costura (tileable): podem se repetir no chão
// ou numa parede inteira sem aparecer a divisa.
//
//   Coloridas (usadas com material branco):
//     grass → grama: base verde-oliva com variação + folhinhas
//     dirt  → terra: solo marrom com variação + pedrinhas e pedras
//   Em tons de cinza (multiplicam a cor da peça, mantendo a paleta):
//     stone   → blocos de pedra com argamassa
//     plaster → reboco manchado
//     wood    → tábuas com veios
//     thatch  → palha em camadas (telhados, feno)
//     dungeonWall  → paredes de masmorra: blocos grandes e irregulares, chanfrados
//     dungeonFloor → lajes de pedra gastas, com rejunte, rachaduras e sujeira
//     caveRock     → rocha natural de caverna: placas irregulares, rachaduras e camadas
//     caveFloor    → chão de caverna: terra batida com pedras e cascalho
//   Coloridas e brilhantes:
//     lava → crosta escura com veios incandescentes (usada também como emissiveMap)
//     poolGray → o mesmo desenho em cinza, para poças de outras cores (tema define a cor)
//   Máscara:
//     softCircle → círculo branco com borda esfumaçada (alphaMap das manchas)
//     stain      → mancha irregular (sangue, fuligem) para "adesivos" no chão
//
// Uso: getTexture('grass')
//      getNormalMap('dungeonWall') → mapa de relevo tirado da própria textura
//      (claro = alto, escuro = fundo): a luz das tochas "pega" nas bordas dos blocos
// =============================================================
import * as THREE from 'three';
import { createRng } from './rng.js';
import { game } from '../game.js';

const cache = new Map();

export function getTexture(name) {
  let texture = cache.get(name);
  if (texture) return texture;
  const painter = PAINTERS[name];
  if (!painter) throw new Error(`Textura desconhecida: ${name}`);
  const canvas = painter();
  texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = name === 'softCircle' || name === 'stain' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  // Anisotropia: deixa o chão nítido mesmo visto de lado (câmera inclinada)
  texture.anisotropy = Math.min(8, game.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  cache.set(name, texture);
  return texture;
}

// Mapa de normais (relevo) calculado a partir do brilho de uma textura:
// cada pixel vira uma "altura" e a inclinação entre vizinhos vira a normal.
// strength: quanto maior, mais fundo parece o relevo.
export function getNormalMap(name, strength = 2.5) {
  const key = name + '|normal';
  let texture = cache.get(key);
  if (texture) return texture;
  const src = getTexture(name).image;
  const size = src.width;
  const data = src.getContext('2d').getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)]; // dá a volta: emenda sem costura
  const { canvas, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255; // a textura é desenhada de cima para baixo (y invertido)
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = Math.min(8, game.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  cache.set(key, texture);
  return texture;
}

// ======================= FERRAMENTAS =======================

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

// Ruído "suave" que se repete a cada `period` células (para a textura emendar)
function makeNoise(rng, period) {
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const at = (x, y) => grid[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

// Várias camadas de ruído (grande + médio + fino). u, v de 0 a 1. Resultado ~0..1
function makeFbm(rng, periods = [4, 8, 16, 32]) {
  const layers = periods.map((p) => ({ p, n: makeNoise(rng, p) }));
  return (u, v) => {
    let sum = 0, amp = 1, total = 0;
    for (const { p, n } of layers) {
      sum += n(u * p, v * p) * amp;
      total += amp;
      amp *= 0.55;
    }
    return sum / total;
  };
}

// Preenche cada pixel com fn(u, v) → [r, g, b] (0..255)
function paintPixels(ctx, size, fn) {
  const img = ctx.createImageData(size, size);
  const px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Desenha algo perto da borda também do outro lado, para a textura emendar
function wrapped(size, x, y, margin, draw) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px < -margin || px > size + margin || py < -margin || py > size + margin) continue;
      draw(px, py);
    }
  }
}

// Divide `total` em pedaços entre min e max que somam exatamente total (para emendar)
function splitExact(rng, total, min, max) {
  const parts = [];
  let left = total;
  while (left > max) {
    const s = Math.min(rng.range(min, max), left - min);
    parts.push(s);
    left -= s;
  }
  parts.push(left);
  return parts;
}

// Multiplica cada pixel já pintado por fn(u, v) (sujeira, granulado...)
function shadePixels(ctx, size, fn) {
  const img = ctx.getImageData(0, 0, size, size);
  const px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      px[i] *= k; px[i + 1] *= k; px[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Bloco de pedra chanfrado: face num tom, borda de cima/esquerda clara, de baixo/direita escura
function bevelBlock(ctx, x, y, w, h, tone, bevel) {
  ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x, y, w, bevel);
  ctx.fillRect(x, y, bevel, h);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y + h - bevel, w, bevel);
  ctx.fillRect(x + w - bevel, y, bevel, h);
}

// Rachadura: linha em zigue-zague
function crack(ctx, rng, size, x, y, steps, len, alpha) {
  ctx.strokeStyle = `rgba(20,18,16,${alpha})`;
  ctx.lineWidth = rng.range(0.8, 1.8);
  const pts = [[x, y]];
  let ang = rng.range(0, Math.PI * 2);
  for (let s = 0; s < steps; s++) {
    ang += rng.range(-0.8, 0.8);
    x += Math.cos(ang) * len; y += Math.sin(ang) * len;
    pts.push([x, y]);
  }
  wrapped(size, pts[0][0], pts[0][1], steps * len + 4, (px, py) => {
    const ox = px - pts[0][0], oy = py - pts[0][1];
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a + ox, b + oy) : ctx.moveTo(a + ox, b + oy)));
    ctx.stroke();
  });
}

// Ruído "celular" (Worley) que emenda: pontos sorteados numa grade n x n (um por casa).
// Devolve (u, v) → [d1, d2]: distância até o ponto mais perto e até o segundo mais perto
// (em casas). Onde d2 - d1 é pequeno fica a "borda" entre duas placas de pedra.
function makeWorley(rng, n) {
  const pts = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) { pts[i * 2] = rng.next(); pts[i * 2 + 1] = rng.next(); }
  return (u, v) => {
    const x = u * n, y = v * n, cx = Math.floor(x), cy = Math.floor(y);
    let d1 = 9, d2 = 9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy;
        const i = (((gy % n) + n) % n) * n + (((gx % n) + n) % n);
        const d = Math.hypot(gx + pts[i * 2] - x, gy + pts[i * 2 + 1] - y);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
    }
    return [d1, d2];
  };
}

const mix = (a, b, t) => a + (b - a) * t;
const mixColor = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const gray = (v) => [v, v, v];

// ======================= AS TEXTURAS =======================

const PAINTERS = {
  grass() {
    const size = 512;
    const rng = createRng(101);
    const { canvas, ctx } = makeCanvas(size);
    const fbm = makeFbm(rng, [4, 8, 16, 32]);
    const dry = makeFbm(rng, [2, 4, 8]);
    const DARK = [58, 70, 40], MID = [80, 90, 54], DRY = [98, 94, 60];
    paintPixels(ctx, size, (u, v) => {
      const n = fbm(u, v);
      let c = mixColor(DARK, MID, Math.min(1, Math.max(0, (n - 0.3) * 2.2)));
      const d = Math.max(0, (dry(u, v) - 0.55) * 2.5); // manchas mais secas
      c = mixColor(c, DRY, Math.min(0.7, d));
      return c;
    });
    // Folhinhas: traços curtos quase verticais em vários tons
    const blades = [[96, 110, 60], [70, 84, 44], [48, 60, 32], [112, 108, 66], [86, 100, 52]];
    for (let i = 0; i < 9000; i++) {
      const x = rng.next() * size, y = rng.next() * size;
      const len = rng.range(3, 9), ang = rng.range(-0.5, 0.5) - Math.PI / 2;
      const c = rng.pick(blades);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${rng.range(0.45, 0.85)})`;
      ctx.lineWidth = rng.range(0.8, 1.6);
      wrapped(size, x, y, 10, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      });
    }
    return canvas;
  },

  dirt() {
    const size = 512;
    const rng = createRng(202);
    const { canvas, ctx } = makeCanvas(size);
    const fbm = makeFbm(rng, [4, 8, 16, 32, 64]);
    const DARK = [70, 56, 40], LIGHT = [112, 94, 70];
    paintPixels(ctx, size, (u, v) => mixColor(DARK, LIGHT, Math.min(1, Math.max(0, (fbm(u, v) - 0.25) * 1.8))));
    // Pedrinhas e pedras: elipse com sombra embaixo e brilho em cima
    const stoneColors = [[94, 86, 76], [80, 74, 68], [104, 94, 80], [70, 64, 58]];
    const drawStone = (r) => {
      const x = rng.next() * size, y = rng.next() * size;
      const rx = r * rng.range(0.8, 1.3), ry = r * rng.range(0.6, 1);
      const rot = rng.range(0, Math.PI);
      const c = rng.pick(stoneColors);
      wrapped(size, x, y, r * 2, (px, py) => {
        ctx.fillStyle = 'rgba(30,22,14,0.45)'; // sombra
        ctx.beginPath(); ctx.ellipse(px + r * 0.25, py + r * 0.3, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.beginPath(); ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,245,225,0.1)'; // brilho
        ctx.beginPath(); ctx.ellipse(px - rx * 0.25, py - ry * 0.3, rx * 0.5, ry * 0.4, rot, 0, Math.PI * 2); ctx.fill();
      });
    };
    for (let i = 0; i < 300; i++) drawStone(rng.range(1.2, 2.8)); // pedrinhas
    for (let i = 0; i < 45; i++) drawStone(rng.range(5, 10));    // pedras
    return canvas;
  },

  stone() {
    const size = 512;
    const rng = createRng(303);
    const { canvas, ctx } = makeCanvas(size);
    const fbm = makeFbm(rng, [8, 16, 32, 64]);
    paintPixels(ctx, size, (u, v) => gray(232 + (fbm(u, v) - 0.5) * 50));
    // Blocos em fileiras desencontradas, cada um com um tom
    const rowH = 64;
    for (let row = 0; row < size / rowH; row++) {
      let x = row % 2 ? -rng.range(30, 70) : 0;
      while (x < size) {
        const w = rng.range(70, 140);
        const shade = rng.range(-28, 18);
        ctx.fillStyle = shade < 0 ? `rgba(0,0,0,${-shade / 255})` : `rgba(255,255,255,${shade / 255})`;
        wrapped(size, x, row * rowH, 150, (px, py) => ctx.fillRect(px + 2, py + 2, w - 4, rowH - 4));
        // argamassa (linha vertical entre blocos)
        ctx.fillStyle = 'rgba(40,36,34,0.85)';
        wrapped(size, x, row * rowH, 150, (px, py) => ctx.fillRect(px - 2, py, 4, rowH));
        x += w;
      }
      ctx.fillStyle = 'rgba(40,36,34,0.85)'; // argamassa horizontal
      ctx.fillRect(0, row * rowH - 2, size, 4);
    }
    ctx.fillRect(0, size - 2, size, 2); // metade de baixo da linha do topo (emenda)
    // Rachaduras
    ctx.strokeStyle = 'rgba(30,28,26,0.5)';
    for (let i = 0; i < 25; i++) {
      let x = rng.next() * size, y = rng.next() * size;
      ctx.lineWidth = rng.range(0.8, 1.6);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += rng.range(-14, 14); y += rng.range(-14, 14); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return canvas;
  },

  plaster() {
    const size = 256;
    const rng = createRng(404);
    const { canvas, ctx } = makeCanvas(size);
    const fbm = makeFbm(rng, [4, 8, 16, 32]);
    const stain = makeFbm(rng, [2, 4]);
    paintPixels(ctx, size, (u, v) => {
      let g = 240 + (fbm(u, v) - 0.5) * 36;
      g -= Math.max(0, stain(u, v) - 0.55) * 120; // manchas de sujeira/umidade
      return gray(g);
    });
    return canvas;
  },

  wood() {
    const size = 256;
    const rng = createRng(505);
    const { canvas, ctx } = makeCanvas(size);
    const grain = makeNoise(rng, 16);
    const wave = makeNoise(rng, 4);
    const plankW = 64;
    paintPixels(ctx, size, (u, v) => {
      const x = u * size, plank = Math.floor(x / plankW);
      const base = 228 + ((plank * 37) % 5 - 2) * 8;           // cada tábua com um tom
      const lines = Math.sin((x + wave(u * 4, v * 4) * 18) * 0.9) * 0.5 + 0.5; // veios ondulados
      let g = base - lines * 34 + (grain(u * 16 + 3, v * 16) - 0.5) * 20;
      if (x % plankW < 2.5 || x % plankW > plankW - 1.5) g -= 90; // fresta entre tábuas
      return gray(g);
    });
    // Nós da madeira
    ctx.fillStyle = 'rgba(40,30,22,0.45)';
    for (let i = 0; i < 8; i++) {
      const x = rng.next() * size, y = rng.next() * size;
      wrapped(size, x, y, 10, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, 3, 6, 0, 0, Math.PI * 2); ctx.fill(); });
    }
    return canvas;
  },

  thatch() {
    const size = 256;
    const rng = createRng(606);
    const { canvas, ctx } = makeCanvas(size);
    ctx.fillStyle = 'rgb(175,175,175)';
    ctx.fillRect(0, 0, size, size);
    // Camadas de palha: fios quase verticais; cada camada com sombra embaixo
    const rowH = 32;
    for (let row = 0; row < size / rowH; row++) {
      const y0 = row * rowH;
      for (let i = 0; i < 260; i++) {
        const x = rng.next() * size;
        const len = rng.range(rowH * 0.9, rowH * 1.5);
        const g = Math.round(rng.range(180, 255));
        ctx.strokeStyle = `rgba(${g},${g},${g},${rng.range(0.6, 1)})`;
        ctx.lineWidth = rng.range(0.8, 1.8);
        const tilt = rng.range(-3, 3);
        wrapped(size, x, y0, 10, (px, py) => {
          ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + tilt, py + len); ctx.stroke();
        });
      }
      ctx.fillStyle = 'rgba(30,30,30,0.45)'; // sombra da camada de cima
      ctx.fillRect(0, (y0 + rowH - 4 + size) % size, size, 4);
    }
    return canvas;
  },

  // 512 px = 2 m de parede. Fileiras de blocos de alturas diferentes, desencontrados.
  dungeonWall() {
    const size = 512;
    const rng = createRng(707);
    const { canvas, ctx } = makeCanvas(size);
    ctx.fillStyle = 'rgb(46,42,40)'; // argamassa (fundo)
    ctx.fillRect(0, 0, size, size);
    const mortar = 5;
    let y = 0;
    for (const rowH of splitExact(rng, size, 50, 78)) {
      let x = rng.range(0, size);
      for (const w of splitExact(rng, size, 70, 170)) {
        const tone = Math.round(rng.range(150, 205));
        const bx = x, by = y;
        wrapped(size, bx, by, 200, (px, py) => bevelBlock(ctx, px + mortar / 2, py + mortar / 2, w - mortar, rowH - mortar, tone, 4));
        // lascas nos cantos
        if (rng.chance(0.5)) {
          const cx = bx + (rng.chance(0.5) ? mortar : w - mortar - 10), cy = by + (rng.chance(0.5) ? mortar : rowH - mortar - 8);
          const cw = rng.range(6, 14), chh = rng.range(5, 10);
          wrapped(size, cx, cy, 30, (px, py) => { ctx.fillStyle = 'rgba(40,36,34,0.8)'; ctx.fillRect(px, py, cw, chh); });
        }
        x += w;
      }
      y += rowH;
    }
    // granulado da pedra + manchas grandes (umidade, fuligem)
    const grain = makeFbm(rng, [16, 32, 64, 128]);
    const stain = makeFbm(rng, [2, 4, 8]);
    shadePixels(ctx, size, (u, v) => (0.78 + grain(u, v) * 0.4) * (1 - Math.max(0, stain(u, v) - 0.5) * 0.9));
    for (let i = 0; i < 30; i++) crack(ctx, rng, size, rng.next() * size, rng.next() * size, rng.int(3, 6), rng.range(6, 14), 0.6);
    return canvas;
  },

  // 512 px = 2 m de chão. Lajes retangulares de tamanhos variados, gastas e rachadas.
  dungeonFloor() {
    const size = 512;
    const rng = createRng(808);
    const { canvas, ctx } = makeCanvas(size);
    ctx.fillStyle = 'rgb(38,34,32)'; // rejunte
    ctx.fillRect(0, 0, size, size);
    const grout = 6;
    let y = 0;
    for (const rowH of splitExact(rng, size, 90, 150)) {
      let x = rng.range(0, size);
      for (const w of splitExact(rng, size, 90, 190)) {
        const tone = Math.round(rng.range(140, 195));
        const bx = x, by = y;
        wrapped(size, bx, by, 220, (px, py) => bevelBlock(ctx, px + grout / 2, py + grout / 2, w - grout, rowH - grout, tone, 3));
        if (rng.chance(0.35)) crack(ctx, rng, size, bx + w * rng.range(0.2, 0.8), by + rowH * rng.range(0.2, 0.8), rng.int(3, 6), rng.range(8, 16), 0.7);
        x += w;
      }
      y += rowH;
    }
    // pedrinhas soltas no rejunte e sobre as lajes
    for (let i = 0; i < 160; i++) {
      const px0 = rng.next() * size, py0 = rng.next() * size, r = rng.range(1, 3);
      const g = Math.round(rng.range(90, 170));
      wrapped(size, px0, py0, 6, (px, py) => {
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      });
    }
    const grain = makeFbm(rng, [16, 32, 64, 128]);
    const grime = makeFbm(rng, [2, 4, 8, 16]);
    shadePixels(ctx, size, (u, v) => (0.8 + grain(u, v) * 0.35) * (1 - Math.max(0, grime(u, v) - 0.45) * 1.1));
    return canvas;
  },

  // 512 px = 2 m de rocha. Placas irregulares (Worley) com rachaduras escuras entre elas,
  // camadas horizontais de sedimento e granulado. Em cinza: o tema pinta de marrom.
  caveRock() {
    const size = 512;
    const rng = createRng(1212);
    const { canvas, ctx } = makeCanvas(size);
    const plates = makeWorley(rng, 7), small = makeWorley(rng, 18);
    const grain = makeFbm(rng, [16, 32, 64, 128]);
    const warp = makeFbm(rng, [2, 4, 8]);
    const bump = makeFbm(rng, [4, 8]);
    paintPixels(ctx, size, (u, v) => {
      const [a1, a2] = plates(u, v), [b1, b2] = small(u, v);
      const edge = Math.min(1, (a2 - a1) * 6);           // 0 na rachadura entre placas
      const edge2 = Math.min(1, (b2 - b1) * 5);
      const strata = Math.sin((v + warp(u, v) * 0.25) * Math.PI * 2 * 9) * 0.5 + 0.5; // camadas
      let g = 150 + (bump(u, v) - 0.5) * 90 - a1 * 35;    // cada placa mais clara no meio
      g *= 0.78 + grain(u, v) * 0.38;
      g *= 0.88 + strata * 0.12;
      g *= 0.35 + 0.65 * Math.pow(edge, 0.6);               // rachaduras fundas
      g *= 0.8 + 0.2 * edge2;                               // trincas menores
      return gray(Math.max(0, Math.min(255, g)));
    });
    return canvas;
  },

  // 512 px = 2 m de chão de caverna: terra batida, cascalho e pedras meio enterradas
  caveFloor() {
    const size = 512;
    const rng = createRng(1313);
    const { canvas, ctx } = makeCanvas(size);
    const fbm = makeFbm(rng, [4, 8, 16, 32, 64]);
    const patches = makeFbm(rng, [2, 4, 8]);
    paintPixels(ctx, size, (u, v) => {
      const n = fbm(u, v), p = patches(u, v);
      return gray(110 + (n - 0.5) * 110 - Math.max(0, p - 0.55) * 120); // manchas escuras de umidade
    });
    // pedras: elipse com sombra embaixo e brilho em cima (como no 'dirt', em cinza)
    const drawStone = (r) => {
      const x = rng.next() * size, y = rng.next() * size;
      const rx = r * rng.range(0.8, 1.4), ry = r * rng.range(0.6, 1);
      const rot = rng.range(0, Math.PI);
      const g = Math.round(rng.range(120, 190));
      wrapped(size, x, y, r * 2, (px, py) => {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.ellipse(px + r * 0.25, py + r * 0.3, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.beginPath(); ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.ellipse(px - rx * 0.25, py - ry * 0.3, rx * 0.5, ry * 0.4, rot, 0, Math.PI * 2); ctx.fill();
      });
    };
    for (let i = 0; i < 500; i++) drawStone(rng.range(1, 2.5));  // cascalho
    for (let i = 0; i < 60; i++) drawStone(rng.range(4, 9));     // pedras
    for (let i = 0; i < 12; i++) drawStone(rng.range(12, 20));   // pedras grandes
    for (let i = 0; i < 20; i++) crack(ctx, rng, size, rng.next() * size, rng.next() * size, rng.int(3, 6), rng.range(8, 16), 0.5);
    return canvas;
  },

  // Lava: crosta escura com veios brilhantes (colorida; também serve de emissiveMap)
  lava() {
    const size = 256;
    const rng = createRng(909);
    const { canvas, ctx } = makeCanvas(size);
    const a = makeFbm(rng, [4, 8, 16, 32]);
    const b = makeFbm(rng, [3, 6, 12]);
    const CRUST = [40, 8, 4], HOT = [255, 90, 10], WHITE = [255, 220, 120];
    paintPixels(ctx, size, (u, v) => {
      const vein = 1 - Math.min(1, Math.abs(a(u, v) - 0.5) * 7);   // perto de 0,5 = veio
      const glow = Math.max(vein, Math.max(0, b(u, v) - 0.55) * 2.2);
      let c = mixColor(CRUST, HOT, Math.min(1, glow * 1.2));
      if (vein > 0.75) c = mixColor(c, WHITE, (vein - 0.75) * 4);
      return c;
    });
    return canvas;
  },

  // Mesmo desenho da lava, em tons de cinza: o tema pinta com a cor que quiser
  // (fogo azul, veneno verde, sangue...). Escuro = crosta, claro = veios brilhantes.
  poolGray() {
    const size = 256;
    const rng = createRng(909); // mesma seed da lava = mesmo desenho
    const { canvas, ctx } = makeCanvas(size);
    const a = makeFbm(rng, [4, 8, 16, 32]);
    const b = makeFbm(rng, [3, 6, 12]);
    paintPixels(ctx, size, (u, v) => {
      const vein = 1 - Math.min(1, Math.abs(a(u, v) - 0.5) * 7);
      const glow = Math.max(vein, Math.max(0, b(u, v) - 0.55) * 2.2);
      return gray(25 + Math.min(1, glow * 1.2) * 200 + Math.max(0, vein - 0.75) * 120);
    });
    return canvas;
  },

  // Mancha irregular (branco = opaco): vários borrões juntos, com bordas suaves
  stain() {
    const size = 128;
    const rng = createRng(111);
    const { canvas, ctx } = makeCanvas(size);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 14; i++) {
      const x = size / 2 + rng.range(-28, 28), y = size / 2 + rng.range(-28, 28), r = rng.range(8, 26);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    return canvas;
  },

  softCircle() {
    const size = 128;
    const { canvas, ctx } = makeCanvas(size);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.55, '#fff');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  },
};
