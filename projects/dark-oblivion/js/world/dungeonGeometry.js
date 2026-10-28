// =============================================================
// dungeonGeometry.js — monta o chão e as paredes do andar como UMA malha
// cada (todas as lajes juntas, todas as paredes juntas). Vantagens:
//
//   - a textura segue as coordenadas do MUNDO: a pedra continua de uma
//     célula para a outra, sem aquele "quadriculado" repetido;
//   - só desenhamos as faces que aparecem (paredes viradas para o chão);
//   - cada vértice tem uma cor que escurece a textura: o pé das paredes e
//     os cantos do chão ficam mais escuros, como sombra de ambiente
//     ("oclusão" falsa, de graça para a placa de vídeo).
//
// CAVERNAS (shape, de makeCaveShape): os cantos das paredes são empurrados
// um pouco para os lados, a parede ganha uma "barriga" no meio da altura e o
// topo sobe e desce. O deslocamento depende só da posição do canto, então
// paredes vizinhas e o chão encostado nelas usam os MESMOS pontos (sem frestas).
// =============================================================
import * as THREE from 'three';

const FLOOR_TILE = 2; // metros por repetição da textura do chão (512 px = 2 m)
const WALL_TILE = 2;
const DROP = 0.3;     // altura da borda do chão ao lado da lava e do poço da escada

// Acumula quadriláteros (2 triângulos) em listas de posição/normal/uv/cor
class QuadBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = [];
  }

  // p: 4 cantos [x,y,z] em volta da face; uvs e shades (escurecimento 0..1) por canto
  quad(p, normal, uvs, shades) {
    // Garante a ordem certa dos cantos (a face precisa "olhar" para `normal`)
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const cross = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    const facing = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] >= 0;
    const order = facing ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    // normal de verdade da face (em paredes tortas de caverna ela não é exatamente `normal`)
    const len = Math.hypot(cross[0], cross[1], cross[2]) || 1;
    const k = (facing ? 1 : -1) / len;
    const n = [cross[0] * k, cross[1] * k, cross[2] * k];
    for (const i of order) {
      this.pos.push(...p[i]);
      this.nor.push(...n);
      this.uv.push(...uvs[i]);
      this.col.push(shades[i], shades[i], shades[i]);
    }
  }

  get vertexCount() { return this.pos.length / 3; }

  appendTo(target) {
    // concat em vez de push(...): listas grandes estouram o limite de argumentos de uma função
    target.pos = target.pos.concat(this.pos); target.nor = target.nor.concat(this.nor);
    target.uv = target.uv.concat(this.uv); target.col = target.col.concat(this.col);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Chão: uma laje por célula. isWall(cx, cz) / isDrop(cx, cz) dizem o que há em volta.
export function buildFloorGeometry(grid, cells, { isWall, isDrop, cornerShade, rng, shape = null }) {
  const q = new QuadBuilder();
  const dark = 1 - cornerShade;
  // Sombra num canto da célula: quantas das 4 células que tocam esse canto são parede
  const cornerAt = (gx, gz) => {
    let walls = 0;
    for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (isWall(gx + ox, gz + oz)) walls++;
    return 1 - dark * Math.min(1, walls / 2);
  };
  for (const [cx, cz] of cells) {
    const x0 = grid.originX + cx, z0 = grid.originZ + cz, x1 = x0 + 1, z1 = z0 + 1;
    const tint = 0.9 + rng.next() * 0.2; // cada laje um tiquinho diferente
    // na caverna, os cantos encostados na rocha seguem a parede torta
    const at = (gx, gz) => {
      const [ox, oz] = shape ? shape.offset(gx, gz, 0) : [0, 0];
      return [grid.originX + gx + ox, 0, grid.originZ + gz + oz];
    };
    const corners = [at(cx, cz), at(cx + 1, cz), at(cx + 1, cz + 1), at(cx, cz + 1)];
    const shades = [cornerAt(cx, cz), cornerAt(cx + 1, cz), cornerAt(cx + 1, cz + 1), cornerAt(cx, cz + 1)].map((s) => s * tint);
    q.quad(corners, [0, 1, 0], corners.map(([x, , z]) => [x / FLOOR_TILE, -z / FLOOR_TILE]), shades);
    // Borda vertical onde o chão acaba (lava, poço da escada)
    for (const [dx, dz] of DIRS) {
      if (!isDrop(cx + dx, cz + dz)) continue;
      const ex = dx > 0 ? x1 : x0, ez = dz > 0 ? z1 : z0;
      const p = dx !== 0
        ? [[ex, 0, z0], [ex, 0, z1], [ex, -DROP, z1], [ex, -DROP, z0]]
        : [[x0, 0, ez], [x1, 0, ez], [x1, -DROP, ez], [x0, -DROP, ez]];
      const along = (pt) => (dx !== 0 ? pt[2] : pt[0]);
      q.quad(p, [dx, 0, dz], p.map((pt) => [along(pt) / WALL_TILE, pt[1] / WALL_TILE]), [0.6, 0.6, 0.35, 0.35].map((s) => s * tint));
    }
  }
  return q.toGeometry();
}

// Paredes: faces laterais só onde a célula vizinha é aberta, mais a tampa de cima.
// A geometria sai com dois grupos: 0 = laterais, 1 = topos (cada um com seu material).
export function buildWallGeometry(grid, cells, { isOpen, height, baseShade, rng, shape = null }) {
  const sides = new QuadBuilder(), tops = new QuadBuilder();
  // Ponto de um canto da grade (gx, gz) numa altura: 0 = chão, 1 = meio, 2 = topo
  const P = (gx, gz, level) => {
    const top = shape ? shape.top(gx, gz) : height;
    const [ox, oz] = shape ? shape.offset(gx, gz, level) : [0, 0];
    return [grid.originX + gx + ox, level === 0 ? 0 : level === 1 ? top * 0.5 : top, grid.originZ + gz + oz];
  };
  for (const [cx, cz] of cells) {
    const x0 = grid.originX + cx, z0 = grid.originZ + cz, x1 = x0 + 1, z1 = z0 + 1;
    const tint = 0.88 + rng.next() * 0.24;
    for (const [dx, dz] of DIRS) {
      if (!isOpen(cx + dx, cz + dz)) continue;
      if (shape) {
        // parede de caverna: dois andares de quadriláteros (chão → meio → topo), cantos tortos
        const gA = dx !== 0 ? [cx + (dx > 0 ? 1 : 0), cz] : [cx, cz + (dz > 0 ? 1 : 0)];
        const gB = dx !== 0 ? [gA[0], cz + 1] : [cx + 1, gA[1]];
        const sign = dx + dz > 0 ? 1 : -1;
        const uA = (dx !== 0 ? -(grid.originZ + gA[1]) : grid.originX + gA[0]) * sign / WALL_TILE;
        const uB = (dx !== 0 ? -(grid.originZ + gB[1]) : grid.originX + gB[0]) * sign / WALL_TILE;
        for (const [l0, l1, s0, s1] of [[0, 1, baseShade, (baseShade + 1) / 2], [1, 2, (baseShade + 1) / 2, 1]]) {
          const p = [P(...gA, l0), P(...gB, l0), P(...gB, l1), P(...gA, l1)];
          sides.quad(p, [dx, 0, dz], [[uA, p[0][1] / WALL_TILE], [uB, p[1][1] / WALL_TILE], [uB, p[2][1] / WALL_TILE], [uA, p[3][1] / WALL_TILE]],
            [s0 * tint, s0 * tint, s1 * tint, s1 * tint]);
        }
        continue;
      }
      const ex = dx > 0 ? x1 : x0, ez = dz > 0 ? z1 : z0;
      const p = dx !== 0
        ? [[ex, 0, z0], [ex, 0, z1], [ex, height, z1], [ex, height, z0]]
        : [[x0, 0, ez], [x1, 0, ez], [x1, height, ez], [x0, height, ez]];
      // u corre ao longo da parede (o sinal evita a textura espelhada nos lados opostos)
      const sign = dx + dz > 0 ? 1 : -1;
      const along = (pt) => (dx !== 0 ? -pt[2] * sign : pt[0] * sign);
      sides.quad(p, [dx, 0, dz], p.map((pt) => [along(pt) / WALL_TILE, pt[1] / WALL_TILE]),
        p.map((pt) => (pt[1] > 0 ? 1 : baseShade) * tint));
    }
    const top = shape
      ? [P(cx, cz, 2), P(cx + 1, cz, 2), P(cx + 1, cz + 1, 2), P(cx, cz + 1, 2)]
      : [[x0, height, z0], [x1, height, z0], [x1, height, z1], [x0, height, z1]];
    tops.quad(top, [0, 1, 0], top.map(([x, , z]) => [x / WALL_TILE, -z / WALL_TILE]), [tint, tint, tint, tint]);
  }
  const all = new QuadBuilder();
  sides.appendTo(all);
  tops.appendTo(all);
  const g = all.toGeometry();
  g.addGroup(0, sides.vertexCount, 0);
  g.addGroup(sides.vertexCount, tops.vertexCount, 1);
  return g;
}

// Forma das paredes de caverna. params = { offset, bulge, height } (em metros):
//   offset → quanto os cantos se mexem para os lados; bulge → "barriga" extra no meio da altura;
//   height → quanto o topo sobe e desce em volta de baseHeight.
// isSolid(cx, cz) = célula é rocha. Só cantos encostados na rocha se mexem.
export function makeCaveShape(seed, params, isSolid, baseHeight) {
  // número pseudoaleatório fixo para cada canto (-1 a 1): mesma seed = mesma caverna
  const hash = (x, z, k) => {
    const n = Math.sin(x * 127.1 + z * 311.7 + k * 74.7 + (seed % 1000) * 0.137) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  // ruído suave (ondulações grandes no topo das paredes)
  const smooth = (x, z) => {
    const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash(x0, z0, 9), b = hash(x0 + 1, z0, 9), c = hash(x0, z0 + 1, 9), d = hash(x0 + 1, z0 + 1, 9);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  };
  const touchesRock = (gx, gz) => isSolid(gx - 1, gz - 1) || isSolid(gx, gz - 1) || isSolid(gx - 1, gz) || isSolid(gx, gz);
  return {
    offset(gx, gz, level) {
      if (!touchesRock(gx, gz)) return [0, 0];
      const amount = params.offset + (level === 1 ? params.bulge : 0);
      return [hash(gx, gz, level * 2 + 1) * amount, hash(gx, gz, level * 2 + 2) * amount];
    },
    top(gx, gz) {
      return baseHeight + smooth(gx / 3.5, gz / 3.5) * params.height + hash(gx, gz, 11) * params.height * 0.35;
    },
  };
}
