import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { neon, mulberry32, clamp, canvasTexture, disposeObject } from './Utils.js';
import { t } from './I18n.js';

export const FLAG_OPEN = 1;
export const FLAG_TUNNEL = 2;
export const FLAG_ENERGY = 4;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function makeFrame() {
  return { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3(), k: 0 };
}

/**
 * Circuito fechado gerado a partir de uma CatmullRomCurve3.
 * A jogabilidade usa coordenadas locais (s = distância ao longo da spline, d = deslocamento lateral).
 */
export class Track {
  constructor(def, qualityDef) {
    this.def = def;
    this.palette = def.palette;
    this.group = new THREE.Group();
    this.group.name = `track-${def.id}`;
    this.animated = [];
    this.pads = [];
    this._f = makeFrame();
    this.rng = mulberry32(def.seed);

    this._sample();
    this._sections();
    this._buildRoad();
    this._buildTunnels();
    this._buildPads();
    this._buildGates();
    this._buildRoadside();
    this._buildStructures(qualityDef);
    this._buildOutline();
  }

  // ---------------------------------------------------------------- amostragem

  _sample() {
    const pts = this.def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    this.curve = curve;
    this.length = curve.getLength();

    const N = (this.count = Math.round(this.length / CONFIG.track.sampleSpacing));
    const ds = (this.ds = this.length / N);
    const sp = curve.getSpacedPoints(N);

    const tan = [], right = [];
    for (let i = 0; i < N; i++) {
      const t = sp[(i + 1) % N].clone().sub(sp[(i - 1 + N) % N]).normalize();
      tan.push(t);
      right.push(new THREE.Vector3().crossVectors(t, WORLD_UP).normalize());
    }

    // Curvatura lateral com sinal (positiva = curva para a direita), suavizada.
    let K = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const dT = tan[(i + 1) % N].clone().sub(tan[(i - 1 + N) % N]);
      K[i] = dT.dot(right[i]) / (2 * ds);
    }
    for (let pass = 0; pass < 3; pass++) {
      const out = new Float32Array(N);
      const r = 5;
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let j = -r; j <= r; j++) sum += K[(i + j + N) % N];
        out[i] = sum / (2 * r + 1);
      }
      K = out;
    }

    this.P = new Float32Array(N * 3);
    this.T = new Float32Array(N * 3);
    this.R = new Float32Array(N * 3);
    this.U = new Float32Array(N * 3);
    this.K = K;

    const up = new THREE.Vector3(), r2 = new THREE.Vector3(), u2 = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      up.crossVectors(right[i], tan[i]).normalize();
      // Inclinação lateral (banking) proporcional à curvatura: o lado interno da curva fica mais baixo.
      const bank = clamp(K[i] * 20, -0.3, 0.3);
      r2.copy(right[i]).multiplyScalar(Math.cos(bank)).addScaledVector(up, -Math.sin(bank)).normalize();
      u2.crossVectors(r2, tan[i]).normalize();
      sp[i].toArray(this.P, i * 3);
      tan[i].toArray(this.T, i * 3);
      r2.toArray(this.R, i * 3);
      u2.toArray(this.U, i * 3);
    }
  }

  wrap(s) {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  /** Distância com sinal de a até b pelo caminho mais curto. */
  delta(a, b) {
    let d = this.wrap(b - a);
    if (d > this.length / 2) d -= this.length;
    return d;
  }

  _index(s) {
    const i = Math.floor((this.wrap(s) / this.length) * this.count);
    return i >= this.count ? 0 : i;
  }

  frame(s, out) {
    const N = this.count;
    const f = (this.wrap(s) / this.length) * N;
    let i0 = Math.floor(f);
    const t = f - i0;
    if (i0 >= N) i0 = 0;
    const a = i0 * 3;
    const b = (i0 + 1 === N ? 0 : i0 + 1) * 3;
    const { P, T, R, U, K } = this;
    out.pos.set(P[a] + (P[b] - P[a]) * t, P[a + 1] + (P[b + 1] - P[a + 1]) * t, P[a + 2] + (P[b + 2] - P[a + 2]) * t);
    out.T.set(T[a] + (T[b] - T[a]) * t, T[a + 1] + (T[b + 1] - T[a + 1]) * t, T[a + 2] + (T[b + 2] - T[a + 2]) * t).normalize();
    out.R.set(R[a] + (R[b] - R[a]) * t, R[a + 1] + (R[b + 1] - R[a + 1]) * t, R[a + 2] + (R[b + 2] - R[a + 2]) * t).normalize();
    out.U.set(U[a] + (U[b] - U[a]) * t, U[a + 1] + (U[b + 1] - U[a + 1]) * t, U[a + 2] + (U[b + 2] - U[a + 2]) * t).normalize();
    out.k = K[i0] + (K[b / 3] - K[i0]) * t;
    return out;
  }

  curvatureAt(s) { return this.K[this._index(s)]; }
  flagsAt(s) { return this.flags[this._index(s)]; }

  gridSlot(i) {
    const R = CONFIG.race;
    const row = Math.floor(i / 2);
    const lane = i % 2;
    return {
      s: this.length - 12 - row * R.gridRowSpacing - lane * 5,
      d: lane ? R.gridLaneOffset : -R.gridLaneOffset,
    };
  }

  // ---------------------------------------------------------------- seções

  _sections() {
    const L = this.length;
    const toRanges = (list) => (list || []).map(([a, b]) => [a * L, b * L]).sort((p, q) => p[0] - q[0]);
    this.openRanges = toRanges(this.def.open);
    this.tunnelRanges = toRanges(this.def.tunnels);
    this.energyRanges = toRanges(this.def.energy);

    this.wallRanges = [];
    let cursor = 0;
    for (const [a, b] of this.openRanges) {
      if (a > cursor) this.wallRanges.push([cursor, a]);
      cursor = b;
    }
    if (cursor < L) this.wallRanges.push([cursor, L]);

    const inAny = (ranges, s) => ranges.some(([a, b]) => s >= a && s <= b);
    this.flags = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const s = i * this.ds;
      let f = 0;
      if (inAny(this.openRanges, s)) f |= FLAG_OPEN;
      if (inAny(this.tunnelRanges, s)) f |= FLAG_TUNNEL;
      if (inAny(this.energyRanges, s)) f |= FLAG_ENERGY;
      this.flags[i] = f;
    }

    for (const pad of this.def.boostPads || []) this.pads.push({ type: 'boost', s: pad.t * L, d: pad.d || 0, half: 6 });
    for (const t of this.def.jumps || []) this.pads.push({ type: 'jump', s: t * L, d: 0, half: CONFIG.track.halfWidth });
  }

  // ---------------------------------------------------------------- geometria em fita

  /**
   * Extruda perfis transversais ao longo da spline.
   * profiles: lista de perfis; cada perfil é uma lista de pontos { d, h, u }.
   */
  _ribbon(ranges, profiles, { vTile = 20, vLocal = false, step = CONFIG.track.ribbonStep } = {}) {
    const pos = [], uv = [], idx = [];
    const f = this._f;
    let base = 0;
    for (const [a, b] of ranges) {
      const n = Math.max(1, Math.ceil((b - a) / step));
      for (const prof of profiles) {
        const m = prof.length;
        for (let i = 0; i <= n; i++) {
          const s = a + ((b - a) * i) / n;
          this.frame(s, f);
          const v = (vLocal ? s - a : s) / vTile;
          for (const p of prof) {
            pos.push(
              f.pos.x + f.R.x * p.d + f.U.x * p.h,
              f.pos.y + f.R.y * p.d + f.U.y * p.h,
              f.pos.z + f.R.z * p.d + f.U.z * p.h,
            );
            uv.push(p.u, v);
          }
        }
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < m - 1; j++) {
            const a0 = base + i * m + j;
            const b0 = a0 + m;
            idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
          }
        }
        base += (n + 1) * m;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  _add(geo, mat, { shadow = false, order = 0 } = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = shadow;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  _glowMaterial(color, tex, opts = {}) {
    return new THREE.MeshBasicMaterial({
      color, map: tex || null, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, ...opts,
    });
  }

  // ---------------------------------------------------------------- pista

  _buildRoad() {
    const { halfWidth: W, shoulderWidth: SW, wallHeight: WH } = CONFIG.track;
    const pal = this.palette;
    const L = this.length;
    const full = [[0, L]];
    const cssL = '#' + new THREE.Color(pal.edgeL).getHexString();
    const cssR = '#' + new THREE.Color(pal.edgeR).getHexString();

    // Piso escuro com linhas de energia emissivas.
    const roadTex = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(120, 60, 220, 0.55)';
      c.fillRect(0, 0, w, 3);
      c.fillStyle = 'rgba(70, 90, 200, 0.4)';
      for (const x of [64, 192]) c.fillRect(x - 1, 0, 2, h);
      c.fillStyle = 'rgba(60, 50, 140, 0.25)';
      c.fillRect(0, h / 2, w, 2);
      const grad = c.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, cssL);
      grad.addColorStop(1, cssR);
      c.fillStyle = grad;
      c.globalAlpha = 0.9;
      c.fillRect(w / 2 - 2, 0, 4, h * 0.45);
    });
    const roadMat = new THREE.MeshStandardMaterial({
      color: this.def.road?.color ?? 0x0c0d1c, roughness: this.def.road?.roughness ?? 0.32, metalness: 0.15,
      emissive: 0xffffff, emissiveMap: roadTex, emissiveIntensity: 1.1, side: THREE.DoubleSide,
    });
    this._add(this._ribbon(full, [[{ d: -W, h: 0, u: 0 }, { d: W, h: 0, u: 1 }]], { vTile: 24 }), roadMat, { shadow: true });

    // Faixas luminosas nas bordas (e trilhos de brilho sob a pista, visíveis à distância).
    const edge = (side, d0, d1, h) => [{ d: side * d0, h, u: 0 }, { d: side * d1, h, u: 1 }];
    const matL = new THREE.MeshBasicMaterial({ color: neon(pal.edgeL, 2.2), side: THREE.DoubleSide });
    const matR = new THREE.MeshBasicMaterial({ color: neon(pal.edgeR, 2.2), side: THREE.DoubleSide });
    this._add(this._ribbon(this.wallRanges, [edge(-1, W - 1.1, W - 0.4, 0.06)]), matL);
    this._add(this._ribbon(this.wallRanges, [edge(1, W - 1.1, W - 0.4, 0.06)]), matR);
    this._add(this._ribbon(full, [edge(-1, W + 0.1, W + 0.7, -0.5)], { step: 8 }), matL);
    this._add(this._ribbon(full, [edge(1, W + 0.1, W + 0.7, -0.5)], { step: 8 }), matR);

    // Barreiras laterais de energia.
    const wallTex = canvasTexture(64, 64, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.08)');
      g.addColorStop(0.9, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillRect(0, 0, w, 3);
    });
    const wall = (side) => [{ d: side * W, h: 0, u: 0 }, { d: side * W, h: WH, u: 1 }];
    this._add(this._ribbon(this.wallRanges, [wall(-1)], { vTile: 8 }), this._glowMaterial(neon(pal.edgeL, 1.3), wallTex), { order: 2 });
    this._add(this._ribbon(this.wallRanges, [wall(1)], { vTile: 8 }), this._glowMaterial(neon(pal.edgeR, 1.3), wallTex), { order: 2 });

    // Trechos perigosos: acostamento listrado, sem barreira.
    if (this.openRanges.length) {
      const hazardTex = canvasTexture(64, 64, (c, w, h) => {
        c.fillStyle = '#120207';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#ff3320';
        c.lineWidth = 12;
        for (let i = -2; i < 4; i++) {
          c.beginPath();
          c.moveTo(i * 32, h);
          c.lineTo(i * 32 + 64, 0);
          c.stroke();
        }
      });
      const hazardMat = new THREE.MeshBasicMaterial({ map: hazardTex, color: 0x999999, side: THREE.DoubleSide });
      const redMat = new THREE.MeshBasicMaterial({ color: neon(0xff2218, 2.6), side: THREE.DoubleSide });
      for (const side of [-1, 1]) {
        this._add(this._ribbon(this.openRanges, [[{ d: side * W, h: 0, u: 0 }, { d: side * (W + SW), h: 0, u: 1 }]], { vTile: 10 }), hazardMat);
        this._add(this._ribbon(this.openRanges, [edge(side, W - 0.9, W - 0.3, 0.06), edge(side, W + SW - 0.5, W + SW, 0.06)]), redMat);
      }
    }

    // Linha de largada e chegada.
    const checker = canvasTexture(64, 32, (c, w, h) => {
      c.fillStyle = '#05050a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) c.fillRect(x * 16, y * 16, 16, 16);
    }, { repeatX: 8 });
    this._add(
      this._ribbon([[L - 3, L + 3]], [[{ d: -W + 1.4, h: 0.05, u: 0 }, { d: W - 1.4, h: 0.05, u: 1 }]], { vTile: 6, vLocal: true, step: 2 }),
      new THREE.MeshBasicMaterial({ map: checker, color: neon(0xffffff, 1.3) }),
    );
  }

  _buildTunnels() {
    if (!this.tunnelRanges.length) return;
    const W = CONFIG.track.halfWidth;
    const pal = this.palette;
    const radius = (this.tunnelRadius = W + 2.6);

    const shell = [];
    const segs = 12;
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI * (1 - i / segs);
      shell.push({ d: Math.cos(a) * radius, h: Math.sin(a) * radius, u: i / segs });
    }
    this._add(this._ribbon(this.tunnelRanges, [shell], { step: 6 }), new THREE.MeshBasicMaterial({ color: 0x06050f, side: THREE.DoubleSide }));

    const line = (a) => {
      const r = radius - 0.2;
      return [
        { d: Math.cos(a - 0.009) * r, h: Math.sin(a - 0.009) * r, u: 0 },
        { d: Math.cos(a + 0.009) * r, h: Math.sin(a + 0.009) * r, u: 1 },
      ];
    };
    this._add(this._ribbon(this.tunnelRanges, [line(0.42), line(Math.PI - 1.15)], { step: 6 }),
      new THREE.MeshBasicMaterial({ color: neon(pal.edgeR, 1.4), side: THREE.DoubleSide }));
    this._add(this._ribbon(this.tunnelRanges, [line(Math.PI - 0.42), line(1.15)], { step: 6 }),
      new THREE.MeshBasicMaterial({ color: neon(pal.edgeL, 1.4), side: THREE.DoubleSide }));

    // Arcos luminosos repetidos: reforçam a sensação de velocidade dentro do túnel.
    const ribs = [];
    const colors = [neon(pal.edgeL, 1.3), neon(pal.edgeR, 1.3), neon(pal.accent, 1.3)];
    for (const [a, b] of this.tunnelRanges) {
      let n = 0;
      for (let s = a; s <= b; s += 24) ribs.push({ s, color: colors[n++ % colors.length] });
    }
    const geo = new THREE.TorusGeometry(radius - 0.35, 0.2, 5, 18, Math.PI);
    this._instanced(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), ribs);
  }

  _buildPads() {
    const W = CONFIG.track.halfWidth;
    const arrows = (stroke) => (c, w, h) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = stroke;
      c.lineWidth = 9;
      c.lineJoin = 'miter';
      for (const y of [58, 30]) {
        c.beginPath();
        c.moveTo(8, y);
        c.lineTo(32, y - 22);
        c.lineTo(56, y);
        c.stroke();
      }
    };

    const boostTex = canvasTexture(64, 64, arrows('#ffb030'));
    const jumpTex = canvasTexture(64, 64, arrows('#d8fbff'), { repeatX: 4 });
    const boostMat = this._glowMaterial(neon(0xffa030, 2.2), boostTex);
    const jumpMat = this._glowMaterial(neon(0xbff6ff, 1.8), jumpTex);
    this.animated.push({ tex: boostTex, speed: 1.8 }, { tex: jumpTex, speed: 1.2 });

    for (const pad of this.pads) {
      const isBoost = pad.type === 'boost';
      const half = isBoost ? pad.half : W - 1.6;
      const range = isBoost ? [pad.s - 9, pad.s + 9] : [pad.s - 5, pad.s + 3];
      const prof = [{ d: pad.d - half, h: 0.07, u: 0 }, { d: pad.d + half, h: 0.07, u: 1 }];
      this._add(this._ribbon([range], [prof], { vTile: isBoost ? 6 : 4, vLocal: true, step: 3 }), isBoost ? boostMat : jumpMat, { order: 1 });
    }

    if (this.energyRanges.length) {
      const energyTex = canvasTexture(64, 64, (c, w, h) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(60,255,170,0.28)';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#7dffc8';
        c.fillRect(26, 12, 12, 40);
        c.fillRect(12, 26, 40, 12);
        c.fillRect(0, 0, 3, h);
        c.fillRect(w - 3, 0, 3, h);
      }, { repeatX: 1 });
      const E = CONFIG.track.energyLaneHalf;
      this.animated.push({ tex: energyTex, speed: 0.9 });
      this._add(
        this._ribbon(this.energyRanges, [[{ d: -E, h: 0.07, u: 0 }, { d: E, h: 0.07, u: 1 }]], { vTile: 13 }),
        this._glowMaterial(neon(0x3dffa0, 1.5), energyTex), { order: 1 },
      );
    }
  }

  // ---------------------------------------------------------------- instâncias

  /** items: { s, d, h, sx, sy, sz, color, flip } posicionados no referencial local da pista. */
  _instanced(geo, mat, items, { shadow = false } = {}) {
    if (!items.length) { geo.dispose(); mat.dispose(); return null; }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const f = this._f;
    items.forEach((it, i) => {
      this.frame(it.s, f);
      _x.copy(f.R).multiplyScalar(it.flip ? -1 : 1);
      _z.crossVectors(f.R, f.U);
      _m.makeBasis(_x, f.U, _z);
      _m.scale(_s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1));
      _p.copy(f.pos).addScaledVector(f.R, it.d || 0).addScaledVector(f.U, it.h || 0);
      _m.setPosition(_p);
      mesh.setMatrixAt(i, _m);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  _buildGates() {
    const W = CONFIG.track.halfWidth;
    const pal = this.palette;
    const L = this.length;
    const K = CONFIG.race.checkpointsPerLap;
    const gates = [];
    const tunnel = (s) => (this.flagsAt(s) & FLAG_TUNNEL) !== 0;

    this.checkpoints = [];
    for (let k = 0; k < K; k++) {
      const s = (k * L) / K;
      this.checkpoints.push(s);
      if (k === 0) gates.push({ s, color: neon(0xffffff, 1.3), sx: 1.08, sy: 1.08, sz: 1.6 });
      else if (!tunnel(s)) gates.push({ s, color: neon(0xffe14d, 2), sz: 1.4 });
    }

    const torii = [];
    const decor = 20;
    for (let i = 0; i < decor; i++) {
      const s = ((i + 0.5) * L) / decor;
      if (tunnel(s)) continue;
      if (this.checkpoints.some((c) => Math.abs(this.delta(c, s)) < 40)) continue;
      if (this.def.theme === 'tokyo') torii.push(s);
      else gates.push({ s, color: neon(i % 2 ? pal.edgeL : pal.edgeR, 1.9) });
    }
    if (torii.length) {
      // Portais torii: dois pilares, viga superior (kasagi) e travessa (nuki).
      const red = neon(0xff2a3a, 1.8);
      const parts = [];
      for (const s of torii) {
        for (const side of [-1, 1]) parts.push({ s, d: side * (W + 3.5), h: 9, sx: 1.3, sy: 18, sz: 1.3, color: red });
        parts.push({ s, h: 18.8, sx: W * 2 + 17, sy: 1.4, sz: 1.9, color: red });
        parts.push({ s, h: 14.6, sx: W * 2 + 9, sy: 0.9, sz: 1.2, color: red });
      }
      this._instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), parts);
    }
    this._instanced(new THREE.TorusGeometry(W + 4.5, 0.55, 5, 20, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }), gates);

    // Painéis holográficos suspensos sobre a pista.
    const texts = (this.def.banners || ['NEON HYPERDRIVE 2', 'banner.league', 'banner.topSpeed', 'banner.ion']).map((key) => t(key));
    const colors = [pal.edgeL, pal.edgeR, pal.accent, 0xffffff];
    const mats = texts.map((text, i) => {
      const tex = canvasTexture(512, 128, (c, w, h) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(255,255,255,0.1)';
        for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
        c.strokeStyle = '#fff';
        c.lineWidth = 4;
        c.strokeRect(6, 6, w - 12, h - 12);
        c.font = 'italic 900 54px "Segoe UI", Arial, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.shadowColor = '#fff';
        c.shadowBlur = 14;
        c.fillStyle = '#fff';
        c.fillText(text, w / 2, h / 2 + 3, w - 44); // textos longos (alemão) são comprimidos para caber
      });
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      return this._glowMaterial(neon(colors[i], 1.25), tex, { opacity: 0.85 });
    });
    const panelGeo = new THREE.PlaneGeometry(30, 7.5);
    const f = this._f;
    const panels = 9;
    for (let i = 0; i < panels; i++) {
      const s = ((i + 0.27) * L) / panels;
      if (tunnel(s)) continue;
      this.frame(s, f);
      const mesh = new THREE.Mesh(panelGeo, mats[i % mats.length]);
      _z.copy(f.T).negate();
      _m.makeBasis(f.R, f.U, _z);
      mesh.quaternion.setFromRotationMatrix(_m);
      mesh.position.copy(f.pos).addScaledVector(f.U, 17);
      mesh.renderOrder = 3;
      this.group.add(mesh);
    }
  }

  _buildRoadside() {
    const { halfWidth: W, wallHeight: WH } = CONFIG.track;
    const pal = this.palette;
    const L = this.length;

    // Balizas luminosas alongadas que passam rapidamente pelas laterais.
    const streaks = [];
    const cL = neon(pal.edgeL, 2.4), cR = neon(pal.edgeR, 2.4), cA = neon(pal.accent, 2.4);
    let n = 0;
    for (let s = 0; s < L; s += 14, n++) {
      if (this.flagsAt(s) & FLAG_OPEN) continue;
      const accent = n % 5 === 0;
      streaks.push({ s, d: -(W + 0.35), h: WH + 0.25, sz: 4.5, color: accent ? cA : cL });
      streaks.push({ s, d: W + 0.35, h: WH + 0.25, sz: 4.5, color: accent ? cA : cR });
    }
    this._instanced(new THREE.BoxGeometry(0.24, 0.24, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), streaks);

    // Setas indicando curvas, no lado externo.
    const chevTex = canvasTexture(128, 64, (c, w, h) => {
      c.fillStyle = '#0a0300';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffb030';
      c.lineWidth = 11;
      for (const x of [14, 50, 86]) {
        c.beginPath();
        c.moveTo(x, 8);
        c.lineTo(x + 26, h / 2);
        c.lineTo(x, h - 8);
        c.stroke();
      }
    });
    chevTex.wrapS = chevTex.wrapT = THREE.ClampToEdgeWrapping;
    const chevrons = [];
    for (let s = 0; s < L; s += 26) {
      const k = this.curvatureAt(s + 30);
      if (Math.abs(k) < 0.0032) continue;
      const right = k > 0;
      chevrons.push({ s, d: right ? -(W + 0.9) : W + 0.9, h: WH + 2.6, flip: !right });
    }
    this._instanced(new THREE.PlaneGeometry(6.5, 3.2), new THREE.MeshBasicMaterial({ map: chevTex, color: neon(0xffffff, 1.7), side: THREE.DoubleSide }), chevrons);

    // Pilares de sustentação até o solo.
    const groundY = CONFIG.track.groundY;
    const f = this._f;
    const spacing = 110;
    const count = Math.floor(L / spacing);
    const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x0d0a22 }), count);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: neon(pal.edgeR, 1.6) }), count);
    for (let i = 0; i < count; i++) {
      this.frame(i * spacing, f);
      const top = f.pos.y - 1.2;
      const h = Math.max(1, top - groundY);
      _m.makeScale(6, h, 6).setPosition(f.pos.x, groundY + h / 2, f.pos.z);
      pillars.setMatrixAt(i, _m);
      _m.makeScale(6.6, 0.5, 6.6).setPosition(f.pos.x, top - 3, f.pos.z);
      caps.setMatrixAt(i, _m);
    }
    pillars.frustumCulled = caps.frustumCulled = false;
    this.group.add(pillars, caps);
  }

  _buildStructures(qualityDef) {
    const pal = this.palette;
    const rng = this.rng;
    const groundY = CONFIG.track.groundY;
    const N = this.count;
    const P = this.P;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const probes = [];
    for (let i = 0; i < N; i += 10) {
      const x = P[i * 3], z = P[i * 3 + 2];
      probes.push(x, z);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    this.bounds = { minX, maxX, minZ, maxZ };

    const windowTex = canvasTexture(64, 256, (c, w, h) => {
      c.fillStyle = '#05040c';
      c.fillRect(0, 0, w, h);
      for (let y = 4; y < h - 4; y += 8) {
        for (let x = 4; x < w - 4; x += 8) {
          const r = Math.random();
          if (r < 0.55) continue;
          c.fillStyle = r > 0.93 ? '#ffffff' : r > 0.75 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)';
          c.fillRect(x, y, 5, 4);
        }
      }
    }, { anisotropy: 2 });

    const tokyo = this.def.theme === 'tokyo';
    const total = Math.round((tokyo ? 360 : 280) * (qualityDef?.buildings ?? 1));
    const margin = 520;
    const items = [];
    let guard = 0;
    while (items.length < total && guard++ < total * 30) {
      const x = minX - margin + rng() * (maxX - minX + margin * 2);
      const z = minZ - margin + rng() * (maxZ - minZ + margin * 2);
      const w = 22 + rng() * 40, d = 22 + rng() * 40;
      const clear = 34 + Math.max(w, d) * 0.75;
      let ok = true;
      for (let i = 0; i < probes.length; i += 2) {
        const dx = probes[i] - x, dz = probes[i + 1] - z;
        if (dx * dx + dz * dz < clear * clear) { ok = false; break; }
      }
      if (!ok) continue;
      const h = tokyo ? 120 + rng() * rng() * 300 : 50 + rng() * rng() * 260;
      items.push({ x, z, w, d, h, tone: Math.floor(rng() * pal.buildings.length) });
    }

    if (this.def.theme === 'park') {
      windowTex.dispose();
      this._buildPark(items);
      return;
    }
    if (this.def.theme === 'ice') {
      this._buildIce(items, windowTex);
      return;
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const buildings = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial({ map: windowTex }), items.length);
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), items.length);
    const tint = new THREE.Color();
    items.forEach((b, i) => {
      _m.makeScale(b.w, b.h, b.d).setPosition(b.x, groundY + b.h / 2, b.z);
      buildings.setMatrixAt(i, _m);
      tint.set(pal.buildings[b.tone]).multiplyScalar(0.9);
      buildings.setColorAt(i, tint);
      const antenna = i % 4 === 0;
      if (antenna) _m.makeScale(1.6, 26, 1.6).setPosition(b.x, groundY + b.h + 13, b.z);
      else _m.makeScale(b.w * 1.03, 1.4, b.d * 1.03).setPosition(b.x, groundY + b.h + 0.7, b.z);
      roofs.setMatrixAt(i, _m);
      roofs.setColorAt(i, neon(pal.buildings[b.tone], antenna ? 2.2 : 1.5));
    });
    buildings.frustumCulled = roofs.frustumCulled = false;
    this.group.add(buildings, roofs);
    if (tokyo) this._buildSigns(items);
  }

  /** Tema Tóquio: letreiros verticais de neon em japonês, presos às quinas dos prédios. */
  _buildSigns(items) {
    const pal = this.palette;
    const rng = this.rng;
    const groundY = CONFIG.track.groundY;
    const words = ['ネオン', 'ラーメン', '東京', 'ホテル', 'カラオケ', '寿司', '電脳', '夜市', 'ゲーム', '居酒屋', '未来', 'サイバー'];

    // Plano de duas faces com UV correto em ambos os lados (o texto nunca aparece espelhado).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0,
      0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0,
    ], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0], 2));
    geo.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);

    const perWord = Math.ceil(items.length / words.length) + 1;
    const meshes = words.map((word) => {
      const chars = [...word];
      const tex = canvasTexture(64, 256, (c, w, h) => {
        c.fillStyle = '#07030d';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 4;
        c.strokeRect(3, 3, w - 6, h - 6);
        const cell = (h - 20) / chars.length;
        const size = Math.min(50, cell * 0.92);
        c.font = `900 ${size}px "Yu Gothic", "Meiryo", "MS Gothic", "Noto Sans JP", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#ffffff';
        c.shadowColor = '#ffffff';
        c.shadowBlur = 6;
        chars.forEach((ch, i) => c.fillText(ch, w / 2, 10 + cell * (i + 0.5) + 2));
      }, { anisotropy: 4 });
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex }), perWord);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });

    const rotY = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    items.forEach((b, i) => {
      const mesh = meshes[i % meshes.length];
      if (mesh.count >= perWord) return;
      const sw = 13 + rng() * 9;
      const sh = sw * 4;
      // Altura próxima ao nível da pista para que os letreiros fiquem no campo de visão.
      const y = groundY + Math.min(b.h - sh * 0.5 - 4, 75 + rng() * 110);
      const sx = rng() < 0.5 ? -1 : 1, sz = rng() < 0.5 ? -1 : 1;
      if (i % 2 === 0) {
        _m.makeScale(sw, sh, 1).setPosition(b.x + sx * (b.w * 0.5 + sw * 0.5 + 1), y, b.z + sz * b.d * 0.5);
      } else {
        _m.makeScale(sw, sh, 1).premultiply(rotY).setPosition(b.x + sx * b.w * 0.5, y, b.z + sz * (b.d * 0.5 + sw * 0.5 + 1));
      }
      mesh.setMatrixAt(mesh.count, _m);
      mesh.setColorAt(mesh.count++, neon(pal.buildings[Math.floor(rng() * pal.buildings.length)], 1.5));
    });
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Tema gelo: cristais gigantes, pinheiros nevados e casas de vila com janelas acesas. */
  _buildIce(items, windowTex) {
    const pal = this.palette;
    const groundY = CONFIG.track.groundY;
    const n = items.length;
    const cone5 = new THREE.ConeGeometry(1, 1, 5, 2, true);
    cone5.translate(0, 0.5, 0);
    const cone7 = new THREE.ConeGeometry(1, 1, 7, 1, true);
    cone7.translate(0, 0.5, 0);
    const pyramid = new THREE.ConeGeometry(1, 1, 4, 1, true);
    pyramid.rotateY(Math.PI / 4);
    pyramid.translate(0, 0.5, 0);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const offset = { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 };
    const wire = (color, k, opacity) => new THREE.MeshBasicMaterial({ color: neon(color, k), wireframe: true, transparent: true, opacity });

    const crystals = new THREE.InstancedMesh(cone5, new THREE.MeshBasicMaterial({ color: 0x0f3152, side: THREE.DoubleSide, ...offset }), n);
    const crystalEdges = new THREE.InstancedMesh(cone5, wire(0x9fefff, 1.5, 0.9), n);
    const pines = new THREE.InstancedMesh(cone7, new THREE.MeshBasicMaterial({ color: 0x0b2f2c, side: THREE.DoubleSide, ...offset }), n * 2);
    const pineEdges = new THREE.InstancedMesh(cone7, wire(pal.edgeL, 0.8, 0.55), n * 2);
    const houses = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ map: windowTex }), n);
    const roofs = new THREE.InstancedMesh(pyramid, new THREE.MeshBasicMaterial({ color: 0x8ea6c8, side: THREE.DoubleSide }), n);
    const lights = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 2);
    const warm = new THREE.Color(0xffc97a);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    let nc = 0, np = 0, nh = 0, nl = 0;

    items.forEach((b, i) => {
      const kind = i % 4;
      if (kind === 0) {
        // Cristal de gelo levemente inclinado, alto o bastante para passar da pista.
        const h = 130 + b.h * 0.9;
        const r = 12 + b.w * 0.35;
        q.setFromEuler(e.set((this.rng() - 0.5) * 0.3, this.rng() * 3, (this.rng() - 0.5) * 0.3));
        _m.compose(p.set(b.x, groundY - 6, b.z), q, s.set(r, h, r));
        crystals.setMatrixAt(nc, _m);
        crystalEdges.setMatrixAt(nc++, _m);
        _m.compose(p.set(b.x + r * 1.1, groundY - 6, b.z + r * 0.6), q, s.set(r * 0.5, h * 0.45, r * 0.5));
        crystals.setMatrixAt(nc, _m);
        crystalEdges.setMatrixAt(nc++, _m);
      } else if (kind === 1) {
        // Pinheiro gigante em duas camadas, com uma luz no topo.
        const h = 80 + b.h * 0.55;
        const r = 16 + b.w * 0.3;
        _m.makeScale(r, h * 0.7, r).setPosition(b.x, groundY, b.z);
        pines.setMatrixAt(np, _m);
        pineEdges.setMatrixAt(np++, _m);
        _m.makeScale(r * 0.68, h * 0.6, r * 0.68).setPosition(b.x, groundY + h * 0.4, b.z);
        pines.setMatrixAt(np, _m);
        pineEdges.setMatrixAt(np++, _m);
        _m.makeScale(3, 3, 3).setPosition(b.x, groundY + h + 2, b.z);
        lights.setMatrixAt(nl, _m);
        lights.setColorAt(nl++, neon(pal.buildings[b.tone], 2.2));
      } else {
        // Casa de vila: paredes com janelas quentes, telhado nevado e um poste de luz.
        const w = b.w * 0.9, d = b.d * 0.9;
        const h = 26 + b.h * 0.14;
        _m.makeScale(w, h, d).setPosition(b.x, groundY + h / 2, b.z);
        houses.setMatrixAt(nh, _m);
        houses.setColorAt(nh, warm);
        _m.makeScale(w * 0.78, 14 + w * 0.3, d * 0.78).setPosition(b.x, groundY + h, b.z);
        roofs.setMatrixAt(nh++, _m);
        _m.makeScale(2.4, 2.4, 2.4).setPosition(b.x + w * 0.7, groundY + 16, b.z + d * 0.7);
        lights.setMatrixAt(nl, _m);
        lights.setColorAt(nl++, neon(0xffc97a, 2.2));
      }
    });

    crystals.count = crystalEdges.count = nc;
    pines.count = pineEdges.count = np;
    houses.count = roofs.count = nh;
    lights.count = nl;
    for (const mesh of [crystals, crystalEdges, pines, pineEdges, houses, roofs, lights]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  /** Tema parque de diversões: tendas listradas e torres de luz no lugar dos prédios. */
  _buildPark(items) {
    const pal = this.palette;
    const groundY = CONFIG.track.groundY;
    const wheels = this.def.park?.wheels || [];
    const stripes = canvasTexture(64, 8, (c, w, h) => {
      c.fillStyle = '#2a2a2a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w / 2, h);
    }, { repeatX: 7, anisotropy: 2 });

    const baseGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    baseGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(1.18, 1, 10, 1, true);
    roofGeo.translate(0, 0.5, 0);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const n = items.length;
    const tentMat = new THREE.MeshBasicMaterial({ map: stripes, side: THREE.DoubleSide });
    const bases = new THREE.InstancedMesh(baseGeo, tentMat, n);
    const roofs = new THREE.InstancedMesh(roofGeo, tentMat, n);
    const towers = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x15123a }), n);
    const lights = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 3);
    const tint = new THREE.Color();
    let tents = 0, poles = 0, lamps = 0;

    items.forEach((b, i) => {
      if (wheels.some(([wx, wz, wr]) => Math.hypot(b.x - wx, b.z - wz) < wr + 40)) return;
      const color = pal.buildings[b.tone];
      if (i % 3 === 0) {
        // Torre de queda livre: haste escura com anéis de luz.
        const h = 90 + b.h * 0.8;
        _m.makeScale(7, h, 7).setPosition(b.x, groundY + h / 2, b.z);
        towers.setMatrixAt(poles++, _m);
        for (const f of [0.45, 0.75, 1]) {
          _m.makeScale(f === 1 ? 18 : 11, f === 1 ? 7 : 3, f === 1 ? 18 : 11).setPosition(b.x, groundY + h * f, b.z);
          lights.setMatrixAt(lamps, _m);
          lights.setColorAt(lamps++, neon(color, f === 1 ? 2 : 1.4));
        }
        return;
      }
      const r = Math.max(b.w, b.d) * 0.75;
      const bh = 22 + b.h * 0.22;
      const rh = 34 + b.h * 0.32;
      tint.set(color).multiplyScalar(0.62);
      _m.makeScale(r, bh, r).setPosition(b.x, groundY, b.z);
      bases.setMatrixAt(tents, _m);
      bases.setColorAt(tents, tint);
      _m.makeScale(r, rh, r).setPosition(b.x, groundY + bh, b.z);
      roofs.setMatrixAt(tents, _m);
      roofs.setColorAt(tents++, tint);
      _m.makeScale(3, 9, 3).setPosition(b.x, groundY + bh + rh + 4, b.z);
      lights.setMatrixAt(lamps, _m);
      lights.setColorAt(lamps++, neon(color, 2.2));
    });

    bases.count = roofs.count = tents;
    towers.count = poles;
    lights.count = lamps;
    for (const mesh of [bases, roofs, towers, lights]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  _buildOutline() {
    this.outline = [];
    for (let i = 0; i < this.count; i += 6) this.outline.push(this.P[i * 3], this.P[i * 3 + 2]);
  }

  /** Estatísticas úteis para ajuste de pista. */
  stats() {
    let kMax = 0;
    for (let i = 0; i < this.count; i++) kMax = Math.max(kMax, Math.abs(this.K[i]));
    return { length: Math.round(this.length), minRadius: Math.round(1 / kMax) };
  }

  update(dt) {
    for (const a of this.animated) a.tex.offset.y -= a.speed * dt;
  }

  dispose() {
    this.group.removeFromParent();
    disposeObject(this.group);
  }
}
