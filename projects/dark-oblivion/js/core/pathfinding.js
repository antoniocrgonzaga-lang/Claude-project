// =============================================================
// pathfinding.js — algoritmo A* ("A estrela") sobre o NavGrid.
//
// Ideia geral: a partir da célula inicial, vamos "explorando" as
// vizinhas, sempre escolhendo primeiro a que parece mais promissora
// (custo já andado + estimativa do que falta). Quando chegamos ao
// destino, refazemos o caminho de trás para frente.
//
// Depois "alisamos" o caminho: em vez de andar de célula em célula
// (em zigue-zague), pulamos direto para o ponto mais distante que dá
// para alcançar em linha reta.
// =============================================================

// Fila de prioridade simples (min-heap): sempre devolve o item de menor prioridade.
class MinHeap {
  constructor() { this.items = []; this.priorities = []; }
  get size() { return this.items.length; }

  push(item, priority) {
    const items = this.items, pr = this.priorities;
    items.push(item); pr.push(priority);
    let i = items.length - 1;
    while (i > 0) { // "sobe" o item enquanto ele for menor que o pai
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      [pr[i], pr[parent]] = [pr[parent], pr[i]];
      i = parent;
    }
  }

  pop() {
    const items = this.items, pr = this.priorities;
    const top = items[0];
    const lastItem = items.pop(), lastPr = pr.pop();
    if (items.length > 0) {
      items[0] = lastItem; pr[0] = lastPr;
      let i = 0;
      for (;;) { // "desce" o item enquanto algum filho for menor
        const l = i * 2 + 1, r = l + 1;
        let smallest = i;
        if (l < items.length && pr[l] < pr[smallest]) smallest = l;
        if (r < items.length && pr[r] < pr[smallest]) smallest = r;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        [pr[i], pr[smallest]] = [pr[smallest], pr[i]];
        i = smallest;
      }
    }
    return top;
  }
}

// 8 direções: [dx, dz, custo]. Diagonal custa √2 (≈1.41)
const DIRECTIONS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Devolve uma lista de pontos [{x, z}, ...] do mundo, ou null se não houver caminho.
export function findPath(grid, startX, startZ, targetX, targetZ, maxIterations = 6000) {
  if (!grid) return null;

  let sx = grid.toCellX(startX), sz = grid.toCellZ(startZ);
  let gx = grid.toCellX(targetX), gz = grid.toCellZ(targetZ);
  let exactTarget = true;

  // Clicou numa parede? Vamos até a célula livre mais próxima do clique.
  if (!grid.isWalkable(gx, gz)) {
    const near = grid.nearestWalkable(gx, gz, 8);
    if (!near) return null;
    gx = near.cx; gz = near.cz;
    targetX = grid.centerX(gx); targetZ = grid.centerZ(gz);
    exactTarget = false;
  }
  // O personagem pode ter sido empurrado um pouquinho para dentro de uma parede
  if (!grid.isWalkable(sx, sz)) {
    const near = grid.nearestWalkable(sx, sz, 4);
    if (!near) return null;
    sx = near.cx; sz = near.cz;
  }

  // Atalho: se dá para ir em linha reta, nem precisa de A*
  if (grid.walkLine(startX, startZ, targetX, targetZ)) return [{ x: targetX, z: targetZ }];

  const W = grid.width;
  const size = W * grid.height;
  const gScore = new Float32Array(size).fill(Infinity); // custo do início até cada célula
  const cameFrom = new Int32Array(size).fill(-1);       // de onde viemos (para refazer o caminho)
  const closed = new Uint8Array(size);                  // células já finalizadas

  // Heurística "octile": estimativa da distância restante permitindo diagonais
  const heuristic = (cx, cz) => {
    const dx = Math.abs(cx - gx), dz = Math.abs(cz - gz);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };

  const startIndex = sz * W + sx, goalIndex = gz * W + gx;
  const open = new MinHeap();
  gScore[startIndex] = 0;
  open.push(startIndex, heuristic(sx, sz));

  let bestIndex = startIndex, bestH = heuristic(sx, sz); // mais perto que conseguimos chegar
  let found = false, iterations = 0;

  while (open.size > 0 && iterations++ < maxIterations) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goalIndex) { found = true; break; }

    const cx = current % W, cz = (current / W) | 0; // "| 0" arredonda para baixo
    const h = heuristic(cx, cz);
    if (h < bestH) { bestH = h; bestIndex = current; }

    for (const [dx, dz, cost] of DIRECTIONS) {
      const nx = cx + dx, nz = cz + dz;
      if (!grid.isWalkable(nx, nz)) continue;
      // Não deixa "cortar a quina" na diagonal
      if (dx !== 0 && dz !== 0 && (!grid.isWalkable(cx + dx, cz) || !grid.isWalkable(cx, cz + dz))) continue;
      const ni = nz * W + nx;
      if (closed[ni]) continue;
      const newG = gScore[current] + cost;
      if (newG < gScore[ni]) {
        gScore[ni] = newG;
        cameFrom[ni] = current;
        open.push(ni, newG + heuristic(nx, nz));
      }
    }
  }

  // Se não achou o destino, vai até o ponto mais próximo que encontrou
  const endIndex = found ? goalIndex : bestIndex;
  if (endIndex === startIndex) return found ? [{ x: targetX, z: targetZ }] : null;

  const cells = [];
  for (let i = endIndex; i !== -1 && i !== startIndex; i = cameFrom[i]) cells.push(i);
  cells.reverse();

  const points = cells.map((i) => ({ x: grid.centerX(i % W), z: grid.centerZ((i / W) | 0) }));
  if (found && exactTarget) points[points.length - 1] = { x: targetX, z: targetZ };

  return smoothPath(grid, startX, startZ, points);
}

// Remove pontos intermediários desnecessários (anda em linha reta sempre que possível)
function smoothPath(grid, startX, startZ, points) {
  const result = [];
  let anchorX = startX, anchorZ = startZ;
  let k = 0;
  while (k < points.length) {
    let best = k;
    for (let j = k + 1; j < points.length; j++) {
      if (grid.walkLine(anchorX, anchorZ, points[j].x, points[j].z)) best = j;
      else break;
    }
    result.push(points[best]);
    anchorX = points[best].x; anchorZ = points[best].z;
    k = best + 1;
  }
  return result;
}
