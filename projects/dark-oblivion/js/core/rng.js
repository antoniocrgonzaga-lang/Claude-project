// =============================================================
// rng.js — números aleatórios.
//
// Math.random() gera números diferentes a cada vez. Para gerar a
// MESMA masmorra de novo precisamos de um gerador com "seed"
// (semente): a mesma seed sempre produz a mesma sequência de números.
// Usamos o algoritmo mulberry32 (pequeno, rápido e bom o bastante).
// =============================================================

// Monta o objeto com funções úteis em cima de uma função next() que devolve [0, 1)
function makeRng(next) {
  return {
    next,
    // número decimal entre min e max
    range(min, max) { return min + next() * (max - min); },
    // número inteiro entre min e max (inclusive os dois)
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
    // true com probabilidade p (0.25 = 25%)
    chance(p) { return next() < p; },
    // um elemento aleatório de uma lista
    pick(array) { return array[Math.floor(next() * array.length)]; },
    // sorteio com pesos: entries = [{ weight: 5, ... }, { weight: 1, ... }]
    weighted(entries) {
      let total = 0;
      for (const e of entries) total += Math.max(0, e.weight);
      if (total <= 0) return entries[entries.length - 1];
      let roll = next() * total;
      for (const e of entries) {
        roll -= Math.max(0, e.weight);
        if (roll <= 0) return e;
      }
      return entries[entries.length - 1];
    },
    // embaralha a lista (no lugar) e devolve ela mesma
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },
  };
}

// Cria um gerador determinístico a partir de uma seed (número inteiro)
export function createRng(seed) {
  let s = seed >>> 0; // ">>> 0" força o número a ser um inteiro positivo de 32 bits
  return makeRng(() => {
    // mulberry32 — não precisa entender os detalhes, só que é determinístico
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

// Gerador "comum" (não determinístico), com as mesmas funções úteis
export const random = makeRng(Math.random);

// Mistura vários valores numa seed única. Ex.: hashSeed(seedDoPersonagem, numeroDoAndar)
export function hashSeed(...values) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (const v of values) {
    const str = String(v);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e37;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
