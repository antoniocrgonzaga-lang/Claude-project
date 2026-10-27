// =============================================================
// grid.js — grid de navegação (o "mapa de onde dá para andar").
//
// O chão é dividido em células de 1x1 unidade. Cada célula guarda:
//   0 = chão livre
//   1 = parede / obstáculo sólido (bloqueia andar E projéteis)
//   2 = obstáculo baixo, ex.: lava (bloqueia andar, mas projéteis passam por cima)
//
// Coordenadas: o mundo usa (x, z) em unidades; o grid usa (cx, cz) inteiros.
// originX/originZ dizem onde fica o canto da célula (0, 0) no mundo.
// =============================================================

export const CELL = { FLOOR: 0, WALL: 1, LOW: 2 };

export class NavGrid {
  constructor(width, height, originX = 0, originZ = 0) {
    this.width = width;
    this.height = height;
    this.originX = originX;
    this.originZ = originZ;
    // Uint8Array = lista compacta de números de 0 a 255 (bem leve na memória)
    this.cells = new Uint8Array(width * height);
  }

  inBounds(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.width && cz < this.height;
  }

  // Fora do grid conta como parede
  get(cx, cz) {
    return this.inBounds(cx, cz) ? this.cells[cz * this.width + cx] : CELL.WALL;
  }

  set(cx, cz, value) {
    if (this.inBounds(cx, cz)) this.cells[cz * this.width + cx] = value;
  }

  fill(value) { this.cells.fill(value); }

  fillRect(cx, cz, w, h, value) {
    for (let z = cz; z < cz + h; z++)
      for (let x = cx; x < cx + w; x++) this.set(x, z, value);
  }

  isWalkable(cx, cz) { return this.get(cx, cz) === CELL.FLOOR; }

  // ---------- conversão mundo <-> célula ----------
  toCellX(x) { return Math.floor(x - this.originX); }
  toCellZ(z) { return Math.floor(z - this.originZ); }
  centerX(cx) { return this.originX + cx + 0.5; }
  centerZ(cz) { return this.originZ + cz + 0.5; }

  isWalkableWorld(x, z) { return this.isWalkable(this.toCellX(x), this.toCellZ(z)); }
  blocksProjectile(x, z) { return this.get(this.toCellX(x), this.toCellZ(z)) === CELL.WALL; }

  // Marca como bloqueado um retângulo do MUNDO centrado em (x, z), com largura w (eixo X) e profundidade d (eixo Z)
  blockWorldRect(x, z, w, d, value = CELL.WALL) {
    const x0 = this.toCellX(x - w / 2 + 0.01), x1 = this.toCellX(x + w / 2 - 0.01);
    const z0 = this.toCellZ(z - d / 2 + 0.01), z1 = this.toCellZ(z + d / 2 - 0.01);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) this.set(cx, cz, value);
  }

  // Marca como bloqueadas as células ao longo de uma linha do mundo (cercas, portais)
  blockWorldLine(x0, z0, x1, z1, value = CELL.WALL) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.set(this.toCellX(x0 + (x1 - x0) * t), this.toCellZ(z0 + (z1 - z0) * t), value);
    }
  }

  // Procura a célula livre mais próxima, em "anéis" cada vez maiores
  nearestWalkable(cx, cz, maxRadius = 12) {
    if (this.isWalkable(cx, cz)) return { cx, cz };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // só a borda do anel
          if (this.isWalkable(cx + dx, cz + dz)) return { cx: cx + dx, cz: cz + dz };
        }
      }
    }
    return null;
  }

  // Existe linha de visão entre dois pontos? (paredes bloqueiam, lava não)
  lineOfSight(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(len / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksProjectile(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  // Dá para ANDAR em linha reta entre os dois pontos?
  // "clearance" é uma folga lateral, para o personagem não raspar nos cantos.
  walkLine(x0, z0, x1, z1, clearance = 0.3) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.0001) return this.isWalkableWorld(x0, z0);
    // vetor perpendicular à linha (para testar as laterais)
    const nx = -dz / len * clearance, nz = dx / len * clearance;
    const steps = Math.ceil(len / 0.25);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t, z = z0 + dz * t;
      if (!this.isWalkableWorld(x, z) ||
          !this.isWalkableWorld(x + nx, z + nz) ||
          !this.isWalkableWorld(x - nx, z - nz)) return false;
    }
    return true;
  }

  // Anda na direção (dirX, dirZ) até maxDist ou até bater em algo. Usado no Rolamento.
  furthestWalkable(x0, z0, dirX, dirZ, maxDist, clearance = 0.25) {
    let lastX = x0, lastZ = z0;
    const steps = Math.ceil(maxDist / 0.2);
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * maxDist;
      const x = x0 + dirX * d, z = z0 + dirZ * d;
      if (!this.walkLine(lastX, lastZ, x, z, clearance)) break;
      lastX = x; lastZ = z;
    }
    return { x: lastX, z: lastZ };
  }

  // Célula livre aleatória dentro de um retângulo do grid (null se não achar)
  randomWalkableInRect(rng, cx, cz, w, h, tries = 30) {
    for (let i = 0; i < tries; i++) {
      const x = rng.int(cx, cx + w - 1), z = rng.int(cz, cz + h - 1);
      if (this.isWalkable(x, z)) return { cx: x, cz: z };
    }
    return null;
  }
}
