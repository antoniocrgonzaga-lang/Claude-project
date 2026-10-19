/**
 * Ground navigation (path-finding) on a spherical planet.
 *
 * The planet's height grid already is a graph: every terrain vertex is a
 * node, linked to its 8 neighbours on the same cube face. Vertices on the
 * cube's edges exist on two or three faces; they are merged into one node,
 * which stitches the faces together.
 *
 * A node is walkable when it is above water / lava (ice is fine) and not
 * under a building. A* over this graph gives ground units a route around
 * lakes, through narrow land bridges and around colonies.
 *
 * One NavGrid is created lazily per planet: getNav(planet).
 */
import { CONFIG } from './config.js';

const WATER_MARGIN = 0.3;   // vertices must sit this far above the liquid to count as dry

export class NavGrid {
  constructor(planet) {
    this.planet = planet;
    const raw = planet.vertexDirs;
    const N = planet.N, R = N + 1;

    // ---- merge duplicated seam vertices into single nodes
    const keyOf = (d) => `${Math.round(d.x * 1e5)},${Math.round(d.y * 1e5)},${Math.round(d.z * 1e5)}`;
    const ids = new Map();
    this.rawToNode = new Int32Array(raw.length);
    const reps = [];
    raw.forEach((d, k) => {
      const key = keyOf(d);
      let id = ids.get(key);
      if (id === undefined) { id = reps.length; ids.set(key, id); reps.push(k); }
      this.rawToNode[k] = id;
    });
    const n = reps.length;
    this.count = n;
    this.rep = Int32Array.from(reps);                 // a raw vertex for each node (for its height)
    this.dirs = new Float32Array(n * 3);
    reps.forEach((k, id) => { this.dirs[id * 3] = raw[k].x; this.dirs[id * 3 + 1] = raw[k].y; this.dirs[id * 3 + 2] = raw[k].z; });

    // ---- adjacency (8-neighbourhood inside each face, unioned across seams)
    const sets = Array.from({ length: n }, () => new Set());
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const a = this.rawToNode[f * R * R + j * R + i];
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii > N || jj > N) continue;
              const b = this.rawToNode[f * R * R + jj * R + ii];
              if (b !== a) sets[a].add(b);
            }
          }
        }
      }
    }
    this.adjStart = new Int32Array(n + 1);
    let total = 0;
    sets.forEach((s, i) => { this.adjStart[i] = total; total += s.size; });
    this.adjStart[n] = total;
    this.adj = new Int32Array(total);
    sets.forEach((s, i) => { let w = this.adjStart[i]; for (const b of s) this.adj[w++] = b; });

    // ---- search buffers (reused between searches)
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.search = 0;
    this.blocked = new Uint8Array(n);
    this.blockedVersion = -1;
  }

  // ------------------------------------------------------------- queries
  nodeAt(dir) { return this.rawToNode[this.planet.nearestVertex(dir)]; }

  dirOf(id, out) { return out.set(this.dirs[id * 3], this.dirs[id * 3 + 1], this.dirs[id * 3 + 2]); }

  walkable(id) {
    this._refreshBlocked();
    if (this.blocked[id]) return false;
    const p = this.planet;
    if (!p.hasLiquid || p.biome.liquid === 'ice') return true;
    return p.heights[this.rep[id]] >= p.seaHeight + WATER_MARGIN;
  }

  /** Buildings block the nodes under them (refreshed when colonies change). */
  _refreshBlocked() {
    const p = this.planet;
    if (this.blockedVersion === p.navVersion) return;
    this.blockedVersion = p.navVersion;
    this.blocked.fill(0);
    const R = p.radius;
    for (const base of p.bases) {
      for (const b of base.buildings) {
        const cosLimit = Math.cos((b.radius * 1.1) / R);
        const cx = b.dir.x, cy = b.dir.y, cz = b.dir.z;
        for (let id = 0; id < this.count; id++) {
          if (this.dirs[id * 3] * cx + this.dirs[id * 3 + 1] * cy + this.dirs[id * 3 + 2] * cz > cosLimit) this.blocked[id] = 1;
        }
      }
    }
  }

  /** Nearest walkable node to `id` (breadth-first), or -1. */
  nearestWalkable(id, limit = 600) {
    if (this.walkable(id)) return id;
    const seen = new Set([id]);
    const queue = [id];
    for (let q = 0; q < queue.length && q < limit; q++) {
      const a = queue[q];
      for (let e = this.adjStart[a]; e < this.adjStart[a + 1]; e++) {
        const b = this.adj[e];
        if (seen.has(b)) continue;
        if (this.walkable(b)) return b;
        seen.add(b);
        queue.push(b);
      }
    }
    return -1;
  }

  /**
   * Is the straight surface line between two directions dry and free of buildings?
   * (samples every ~1.2 m)
   */
  lineClear(fromDir, toDir) {
    const p = this.planet;
    const ang = Math.acos(Math.min(1, Math.max(-1, fromDir.dot(toDir))));
    const steps = Math.ceil((ang * p.radius) / 1.2);
    const s = this._tmp ??= fromDir.clone();
    this._refreshBlocked();
    for (let k = 1; k <= steps; k++) {
      s.copy(fromDir).lerp(toDir, k / steps).normalize();
      if (p.isSubmerged(s)) return false;
      if (this.blocked[this.nodeAt(s)]) return false;
    }
    return true;
  }

  /**
   * A* from one surface direction to another.
   * Returns an array of unit direction vectors (waypoints) or null if unreachable.
   */
  findPath(fromDir, toDir, Vec) {
    const start = this.nearestWalkable(this.nodeAt(fromDir));
    const goal = this.nearestWalkable(this.nodeAt(toDir));
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [toDir.clone()];
    const R = this.planet.radius, D = this.dirs;
    const gx = D[goal * 3], gy = D[goal * 3 + 1], gz = D[goal * 3 + 2];
    const angle = (a, bx, by, bz) => Math.acos(Math.min(1, Math.max(-1, D[a * 3] * bx + D[a * 3 + 1] * by + D[a * 3 + 2] * bz)));
    const h = (a) => angle(a, gx, gy, gz) * R;
    const stamp = ++this.search;
    const heapF = [], heapN = [];
    const push = (node, f) => {
      let i = heapF.length;
      heapF.push(f); heapN.push(node);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heapF[i] = heapF[p]; heapN[i] = heapN[p];
        i = p;
      }
      heapF[i] = f; heapN[i] = node;
    };
    const pop = () => {
      const top = heapN[0];
      const lastF = heapF.pop(), lastN = heapN.pop();
      if (heapF.length) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i, mf = lastF;
          if (l < heapF.length && heapF[l] < mf) { m = l; mf = heapF[l]; }
          if (r < heapF.length && heapF[r] < mf) { m = r; mf = heapF[r]; }
          if (m === i) break;
          heapF[i] = heapF[m]; heapN[i] = heapN[m];
          i = m;
        }
        heapF[i] = lastF; heapN[i] = lastN;
      }
      return top;
    };

    this.g[start] = 0; this.stamp[start] = stamp; this.came[start] = -1;
    push(start, h(start));
    let expanded = 0, found = false;
    while (heapN.length && expanded < CONFIG.navigation.maxExpand) {
      const a = pop();
      if (this.closed[a] === stamp) continue;
      this.closed[a] = stamp;
      if (a === goal) { found = true; break; }
      expanded++;
      const ax = D[a * 3], ay = D[a * 3 + 1], az = D[a * 3 + 2];
      for (let e = this.adjStart[a]; e < this.adjStart[a + 1]; e++) {
        const b = this.adj[e];
        if (this.closed[b] === stamp || !this.walkable(b)) continue;
        const cost = this.g[a] + angle(b, ax, ay, az) * R;
        if (this.stamp[b] === stamp && cost >= this.g[b]) continue;
        this.stamp[b] = stamp; this.g[b] = cost; this.came[b] = a;
        push(b, cost + h(b));
      }
    }
    if (!found) return null;
    const ids = [];
    for (let a = goal; a !== -1; a = this.came[a]) ids.push(a);
    ids.reverse();
    const path = ids.map((id) => this.dirOf(id, new Vec()));
    path.push(toDir.clone());
    return path;
  }
}

/** Lazily built navigation grid of a planet. */
export function getNav(planet) {
  if (!planet.nav) planet.nav = new NavGrid(planet);
  return planet.nav;
}
