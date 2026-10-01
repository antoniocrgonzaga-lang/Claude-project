/* ==========================================================================
   planet.js — Planetas procedurais, decoração e recursos coletáveis
   --------------------------------------------------------------------------
   Como um planeta é construído:
     1. "Esfera de cubo": 6 faces de uma grade NxN, projetadas numa esfera.
     2. Cada vértice recebe uma altura vinda de um ruído 3D (colinas e vales).
        A altura é "quantizada" em degraus, o que dá o visual blocado/low-poly.
     3. Cada triângulo ganha uma cor sólida de acordo com a altura (paleta do tipo).
     4. Mar translúcido, brilho de atmosfera e decoração (árvores, cactos...)
        são adicionados por cima.

   Altura do chão: como a malha é uma grade regular, sabemos EXATAMENTE em qual
   par de triângulos um ponto está — então dá para calcular a altura do chão
   com uma interseção raio-triângulo, sem raycast pesado (ver groundAt()).

   Para criar um tipo novo de planeta, adicione uma entrada em ES.PLANET_TYPES.
   Para criar uma decoração nova, adicione uma entrada em DECOS.
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;
  const QUARTER_PI = Math.PI / 4;

  /* As 6 faces do cubo: n = direção da face, a/b = eixos da grade sobre a face. */
  const FACES = [
    { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
    { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
    { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
    { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
    { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
  ];

  /* ------------------------------------------------------------------------
     TIPOS DE PLANETA
     bands: [alturaMínima(-1..1), cor] — a cor vale até a próxima faixa.
     seaLevel: nível do mar em fração da amplitude (null = sem mar).
     deco: [tipoDeDecoração, densidade por unidade² de superfície].
     ------------------------------------------------------------------------ */
  ES.PLANET_TYPES = {
    verdant: {
      label: 'Mundo Verdejante', sky: 0x6fb8ff, ampK: 0.12, freq: 1.5, ridged: false, terraces: 8,
      seaLevel: -0.2, seaColor: 0x2f80e8, seaGlow: 0, rock: 0x8d8f98,
      bands: [[-1, 0xdccb8e], [-0.1, 0x6cc24f], [0.32, 0x4c9a47], [0.65, 0x8c8e97], [0.88, 0xf3f7fb]],
      deco: [['tree', 0.0021], ['bush', 0.0013], ['rock', 0.0006]],
    },
    desert: {
      label: 'Dunas Ardentes', sky: 0xffb27a, ampK: 0.1, freq: 1.2, ridged: false, terraces: 10,
      seaLevel: null, rock: 0xb5683a,
      bands: [[-1, 0xd9a35c], [-0.3, 0xe3b66d], [0.25, 0xcf8f4a], [0.7, 0xa8602f]],
      deco: [['cactus', 0.0013], ['rock', 0.0012]],
    },
    ice: {
      label: 'Gelo Eterno', sky: 0xa5dcff, ampK: 0.13, freq: 1.7, ridged: true, terraces: 8,
      seaLevel: null, rock: 0xcfe6f5,
      bands: [[-1, 0x9fcdf0], [-0.2, 0xd7ecf9], [0.4, 0xf1f8fd], [0.8, 0xffffff]],
      deco: [['iceSpike', 0.0015], ['rock', 0.0006]],
    },
    volcanic: {
      label: 'Brasa Vulcânica', sky: 0xff6a4a, ampK: 0.15, freq: 1.8, ridged: true, terraces: 7,
      seaLevel: null, rock: 0x3b3338,
      bands: [[-1, 0xd8431d], [-0.38, 0x3a2f35], [0.1, 0x4a3f46], [0.6, 0x6a5d66]],
      deco: [['obsidian', 0.0011], ['ember', 0.0018], ['rock', 0.001]],
    },
    alien: {
      label: 'Floresta Violeta', sky: 0xc78bff, ampK: 0.12, freq: 1.5, ridged: false, terraces: 9,
      seaLevel: -0.3, seaColor: 0x27d9c8, seaGlow: 0.35, rock: 0x6a4a9a,
      bands: [[-1, 0x4a3478], [-0.2, 0x7a45c9], [0.3, 0x9a5fe0], [0.72, 0xd2aaff]],
      deco: [['mushroom', 0.002], ['crystalSpire', 0.0008], ['rock', 0.0006]],
    },
  };

  /* ------------------------------------------------------------------------
     DECORAÇÕES — cada uma é composta por "partes" (caixas, cones...).
     Todas as instâncias da mesma parte viram UM InstancedMesh (1 draw call).
       r: raio de colisão | scale: [min,max] | parts[].pos/rot/scale: transform local
       color: número hexadecimal ou 'rock' (usa a cor de pedra do planeta)
       emissive: true = material que brilha (não depende da luz)
     ------------------------------------------------------------------------ */
  const BOX = (x, y, z) => () => new THREE.BoxGeometry(x, y, z);
  const DECOS = {
    tree: {
      r: 1.1, scale: [0.85, 1.45],
      parts: [
        { geo: BOX(0.6, 2.4, 0.6), pos: [0, 1.2, 0], color: 0x7b5230, vary: 0.05 },
        { geo: BOX(2.5, 1.7, 2.5), pos: [0, 3.2, 0], color: 0x3f9d4b, vary: 0.1 },
        { geo: BOX(1.6, 1.3, 1.6), pos: [0, 4.5, 0], color: 0x5cbc5d, vary: 0.1 },
      ],
    },
    bush: {
      r: 0.8, scale: [0.7, 1.3],
      parts: [
        { geo: BOX(1.5, 0.9, 1.5), pos: [0, 0.45, 0], color: 0x4aa84f, vary: 0.12 },
        { geo: BOX(0.9, 0.6, 0.9), pos: [0.2, 1.0, 0.1], color: 0x6bd06a, vary: 0.12 },
      ],
    },
    rock: {
      r: 1.3, scale: [0.7, 1.8],
      parts: [
        { geo: () => new THREE.DodecahedronGeometry(1.1, 0), pos: [0, 0.55, 0], scale: [1, 0.75, 1], color: 'rock', vary: 0.1 },
      ],
    },
    cactus: {
      r: 0.9, scale: [0.8, 1.5],
      parts: [
        { geo: BOX(0.75, 3.6, 0.75), pos: [0, 1.8, 0], color: 0x4f9a52, vary: 0.08 },
        { geo: BOX(1.2, 0.5, 0.5), pos: [0.75, 2.0, 0], color: 0x4f9a52, vary: 0.08 },
        { geo: BOX(0.5, 1.2, 0.5), pos: [1.25, 2.55, 0], color: 0x58a85a, vary: 0.08 },
        { geo: BOX(0.9, 0.5, 0.5), pos: [-0.65, 1.4, 0], color: 0x4f9a52, vary: 0.08 },
        { geo: BOX(0.5, 0.9, 0.5), pos: [-1.0, 1.8, 0], color: 0x58a85a, vary: 0.08 },
      ],
    },
    iceSpike: {
      r: 1.0, scale: [0.8, 2.1],
      parts: [
        { geo: () => new THREE.ConeGeometry(0.95, 4.4, 5), pos: [0, 2.2, 0], color: 0xbfe6ff, vary: 0.05 },
        { geo: () => new THREE.ConeGeometry(0.55, 2.6, 5), pos: [0.9, 1.3, 0.3], color: 0xdff4ff, vary: 0.05 },
      ],
    },
    obsidian: {
      r: 1.1, scale: [0.8, 1.9],
      parts: [
        { geo: () => new THREE.ConeGeometry(1.05, 4.6, 5), pos: [0, 2.3, 0], color: 0x251d2d, vary: 0.04 },
        { geo: () => new THREE.ConeGeometry(0.6, 2.8, 5), pos: [-0.9, 1.4, 0.2], color: 0x32283c, vary: 0.04 },
      ],
    },
    ember: {
      r: 0.5, scale: [0.6, 1.4],
      parts: [
        { geo: BOX(0.55, 0.55, 0.55), pos: [0, 0.45, 0], rot: [0.6, 0.7, 0.2], color: 0xff7a2e, vary: 0.12, emissive: true },
      ],
    },
    mushroom: {
      r: 1.0, scale: [0.8, 1.7],
      parts: [
        { geo: () => new THREE.CylinderGeometry(0.32, 0.46, 2.3, 6), pos: [0, 1.15, 0], color: 0xe9dcff, vary: 0.05 },
        { geo: () => new THREE.SphereGeometry(1.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), pos: [0, 2.2, 0], color: 0xd45bff, vary: 0.1 },
        { geo: BOX(0.28, 0.28, 0.28), pos: [0.7, 3.0, 0.5], color: 0xfff08a, emissive: true },
        { geo: BOX(0.28, 0.28, 0.28), pos: [-0.6, 3.05, -0.4], color: 0xfff08a, emissive: true },
      ],
    },
    crystalSpire: {
      r: 1.0, scale: [0.8, 2.0],
      parts: [
        { geo: () => { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.85, 2.6, 0.85); return g; }, pos: [0, 2.4, 0], color: 0xb98cff, vary: 0.08, emissive: true },
      ],
    },
  };

  /* ------------------------------------------------------------------------
     RECURSOS — o que o jogador coleta andando pelos planetas.
     ------------------------------------------------------------------------ */
  ES.RESOURCE_TYPES = [
    { id: 'crystal', name: 'Cristal Eco', color: 0x49f2ff, fuel: 14, weight: 0.55,
      makeGeo: () => { const g = new THREE.OctahedronGeometry(0.65, 0); g.scale(0.8, 1.5, 0.8); return g; } },
    { id: 'core', name: 'Núcleo Solar', color: 0xffb43b, fuel: 6, weight: 0.3,
      makeGeo: () => new THREE.IcosahedronGeometry(0.62, 0) },
    { id: 'essence', name: 'Essência Lunar', color: 0xd27bff, fuel: 6, weight: 0.15,
      makeGeo: () => new THREE.TetrahedronGeometry(0.85, 0) },
  ];

  /* Interseção raio-triângulo (Möller–Trumbore) com origem no centro do planeta. */
  function rayTri(dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) return -1;
    const inv = 1 / det;
    const u = (-ax * px - ay * py - az * pz) * inv;
    if (u < -1e-4 || u > 1.0001) return -1;
    const qx = -ay * e1z + az * e1y, qy = -az * e1x + ax * e1z, qz = -ax * e1y + ay * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-4 || u + v > 1.0001) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _base = new THREE.Matrix4();
  const _part = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _c = new THREE.Color();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  ES.Planet = class Planet {
    /**
     * @param {object} o  { scene, seed, typeKey, name, center, radius, sunDir, withRing }
     */
    constructor(o) {
      const rng = ES.makeRng(o.seed);
      this.name = o.name;
      this.typeKey = o.typeKey;
      this.type = ES.PLANET_TYPES[o.typeKey];
      this.radius = o.radius;
      this.center = o.center.clone();
      this.sunDir = o.sunDir;
      this.amp = this.radius * this.type.ampK;                 // altura máxima do relevo
      this.N = Math.max(20, Math.round(this.radius / 2));       // células por lado de cada face
      this.outerRadius = this.radius + this.amp * 1.05;         // acima disso não há terreno
      this.seaR = this.type.seaLevel === null ? null : this.radius + this.type.seaLevel * this.amp;
      this.skyColor = new THREE.Color(this.type.sky);
      this._g = { r: 0, terrainR: 0, normal: new THREE.Vector3() };  // resultado reutilizado de groundAt()
      this.obstacles = [];                                      // {x,y,z,r} em coordenadas locais
      this.resources = [];
      this.resourcesTotal = 0;
      this.resourcesTaken = 0;
      this.visited = false;

      this.group = new THREE.Group();
      this.group.position.copy(this.center);
      o.scene.add(this.group);

      this._buildTerrain(rng);
      this._buildSea();
      this._buildAtmosphere();
      this._buildDecorations(rng);
      this._buildResources(rng);
      if (o.withRing) this._buildRing(rng);
    }

    /* ======================= TERRENO ======================= */
    _buildTerrain(rng) {
      const N = this.N, R = this.radius, amp = this.amp, T = this.type;
      const noise = new ES.Noise3D(rng);
      const off = [rng.range(0, 60), rng.range(0, 60), rng.range(0, 60)];
      const f = T.freq;

      // Altura normalizada (-1..1) numa direção, já em degraus.
      const sample = (x, y, z) => {
        let n = noise.fbm(x * f + off[0], y * f + off[1], z * f + off[2], 4, 2.05, 0.5) * 1.7;
        if (T.ridged) n = 1 - 2.6 * Math.abs(n);     // cristas e vales (montanhas "afiadas")
        n = ES.clamp(n, -1, 1);
        return Math.round(n * T.terraces) / T.terraces;
      };

      // 1) Grade de vértices por face.
      this.grid = [];
      const hgrid = [];
      const s = N + 1;
      for (let fi = 0; fi < 6; fi++) {
        const F = FACES[fi];
        const P = new Float32Array(s * s * 3);
        const H = new Float32Array(s * s);
        for (let j = 0; j <= N; j++) {
          const tv = Math.tan(QUARTER_PI * (-1 + (2 * j) / N));
          for (let i = 0; i <= N; i++) {
            const tu = Math.tan(QUARTER_PI * (-1 + (2 * i) / N));
            let x = F.n[0] + F.a[0] * tu + F.b[0] * tv;
            let y = F.n[1] + F.a[1] * tu + F.b[1] * tv;
            let z = F.n[2] + F.a[2] * tu + F.b[2] * tv;
            const len = Math.sqrt(x * x + y * y + z * z);
            x /= len; y /= len; z /= len;
            const h = sample(x, y, z);
            const r = R + h * amp;
            const k = j * s + i;
            H[k] = h;
            P[k * 3] = x * r; P[k * 3 + 1] = y * r; P[k * 3 + 2] = z * r;
          }
        }
        this.grid.push(P);
        hgrid.push(H);
      }

      // 2) Triângulos: cada célula vira 2 triângulos com cor sólida (visual facetado).
      const quads = 6 * N * N;
      const pos = new Float32Array(quads * 2 * 3 * 3);
      const col = new Float32Array(quads * 2 * 3 * 3);
      let o = 0;
      const color = new THREE.Color();
      const bands = T.bands;
      const seaN = T.seaLevel === null ? -2 : T.seaLevel;

      const pushTri = (P, a, b, c, hAvg) => {
        // Garante que a face aponta para fora (ordem anti-horária vista de fora).
        const ax = P[a], ay = P[a + 1], az = P[a + 2];
        let bb = b, cc = c;
        const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az;
        const e2x = P[c] - ax, e2y = P[c + 1] - ay, e2z = P[c + 2] - az;
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (nx * ax + ny * ay + nz * az < 0) { bb = c; cc = b; }
        // Cor pela faixa de altura.
        let hex = bands[0][1];
        for (let q = 0; q < bands.length; q++) if (hAvg >= bands[q][0]) hex = bands[q][1];
        color.setHex(hex);
        color.offsetHSL(0, 0, rng.range(-0.035, 0.035));
        if (hAvg < seaN - 0.001) color.multiplyScalar(0.72);   // leito do mar, mais escuro
        for (const idx of [a, bb, cc]) {
          pos[o] = P[idx]; pos[o + 1] = P[idx + 1]; pos[o + 2] = P[idx + 2];
          col[o] = color.r; col[o + 1] = color.g; col[o + 2] = color.b;
          o += 3;
        }
      };

      for (let fi = 0; fi < 6; fi++) {
        const P = this.grid[fi], H = hgrid[fi];
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const k00 = j * s + i, k10 = k00 + 1, k01 = k00 + s, k11 = k01 + 1;
            // Triângulo A: v00, v10, v11  |  Triângulo B: v00, v11, v01 (mesma divisão usada em groundAt)
            pushTri(P, k00 * 3, k10 * 3, k11 * 3, (H[k00] + H[k10] + H[k11]) / 3);
            pushTri(P, k00 * 3, k11 * 3, k01 * 3, (H[k00] + H[k11] + H[k01]) / 3);
          }
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();   // geometria "sem índice" => normais por face (visual facetado)
      geo.computeBoundingSphere();
      this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.group.add(this.terrain);
    }

    /**
     * Altura do chão numa direção (vetor unitário a partir do centro do planeta).
     * Retorna um objeto REUTILIZADO: { r: raio do chão, normal, terrainR: raio sem contar o mar }.
     * Copie os valores que precisar antes da próxima chamada.
     */
    groundAt(dir) {
      const N = this.N, out = this._g;
      const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
      let f;
      if (ax >= ay && ax >= az) f = dir.x > 0 ? 0 : 1;
      else if (ay >= az) f = dir.y > 0 ? 2 : 3;
      else f = dir.z > 0 ? 4 : 5;
      const F = FACES[f];
      const dn = dir.x * F.n[0] + dir.y * F.n[1] + dir.z * F.n[2];
      const u = (dir.x * F.a[0] + dir.y * F.a[1] + dir.z * F.a[2]) / dn;
      const v = (dir.x * F.b[0] + dir.y * F.b[1] + dir.z * F.b[2]) / dn;
      const fi = (Math.atan(u) / QUARTER_PI + 1) * 0.5 * N;
      const fj = (Math.atan(v) / QUARTER_PI + 1) * 0.5 * N;
      const i = Math.min(N - 1, Math.max(0, Math.floor(fi)));
      const j = Math.min(N - 1, Math.max(0, Math.floor(fj)));
      const P = this.grid[f], s = N + 1;
      const i00 = (j * s + i) * 3, i10 = i00 + 3, i01 = i00 + s * 3, i11 = i01 + 3;

      let t = rayTri(dir.x, dir.y, dir.z,
        P[i00], P[i00 + 1], P[i00 + 2], P[i10], P[i10 + 1], P[i10 + 2], P[i11], P[i11 + 1], P[i11 + 2]);
      let a = i10, b = i11;
      if (t < 0) {
        t = rayTri(dir.x, dir.y, dir.z,
          P[i00], P[i00 + 1], P[i00 + 2], P[i11], P[i11 + 1], P[i11 + 2], P[i01], P[i01 + 1], P[i01 + 2]);
        a = i11; b = i01;
      }

      if (t < 0) {
        // Raríssimo (erro numérico em arestas): usa a média dos 4 cantos.
        const rr = (r3) => Math.hypot(P[r3], P[r3 + 1], P[r3 + 2]);
        t = (rr(i00) + rr(i10) + rr(i01) + rr(i11)) / 4;
        out.normal.copy(dir);
      } else {
        const e1x = P[a] - P[i00], e1y = P[a + 1] - P[i00 + 1], e1z = P[a + 2] - P[i00 + 2];
        const e2x = P[b] - P[i00], e2y = P[b + 1] - P[i00 + 1], e2z = P[b + 2] - P[i00 + 2];
        out.normal.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
        if (out.normal.dot(dir) < 0) out.normal.negate();
      }

      out.terrainR = t;
      if (this.seaR !== null && t < this.seaR) {
        out.r = this.seaR;           // andamos "por cima" da água rasa
        out.normal.copy(dir);
      } else {
        out.r = t;
      }
      return out;
    }

    /* ======================= MAR ======================= */
    _buildSea() {
      if (this.seaR === null) return;
      const T = this.type;
      const mat = new THREE.MeshPhongMaterial({
        color: T.seaColor, transparent: true, opacity: 0.78, shininess: 90,
        specular: 0x99aabb, flatShading: true,
      });
      if (T.seaGlow) mat.emissive = new THREE.Color(T.seaColor).multiplyScalar(T.seaGlow);
      this.sea = new THREE.Mesh(new THREE.IcosahedronGeometry(this.seaR, 5), mat);
      this.group.add(this.sea);
    }

    /* ======================= ATMOSFERA (brilho na borda) ======================= */
    _buildAtmosphere() {
      this.shellR = this.radius * 1.22;
      const dMax = Math.sqrt(1 - Math.pow(this.radius / this.shellR, 2));
      this.atmoMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: this.skyColor.clone() },
          uSun: { value: this.sunDir.clone() },
          uFade: { value: 1 },
          uDMax: { value: dMax },
        },
        vertexShader: [
          'varying vec3 vN; varying vec3 vV; varying vec3 vNW;',
          'void main(){',
          '  vec4 wp = modelMatrix * vec4(position, 1.0);',
          '  vNW = normalize(mat3(modelMatrix) * normal);',
          '  vN = vNW; vV = normalize(cameraPosition - wp.xyz);',
          '  gl_Position = projectionMatrix * viewMatrix * wp;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor; uniform vec3 uSun; uniform float uFade; uniform float uDMax;',
          'varying vec3 vN; varying vec3 vV; varying vec3 vNW;',
          'void main(){',
          '  float d = clamp(-dot(normalize(vN), normalize(vV)), 0.0, 1.0);',
          '  float g = pow(clamp(d / uDMax, 0.0, 1.0), 2.4);',
          '  float lit = clamp(dot(normalize(vNW), uSun) * 0.6 + 0.55, 0.12, 1.0);',
          '  float a = g * lit * uFade;',
          '  gl_FragColor = vec4(uColor * 1.15, a);',
          '}',
        ].join('\n'),
      });
      this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(this.shellR, 48, 32), this.atmoMat);
      this.group.add(this.atmosphere);
    }

    /** Some o brilho quando a câmera entra na atmosfera (senão ele "pintaria" a tela toda). */
    updateAtmosphere(camPos) {
      const d = camPos.distanceTo(this.center);
      this.atmoMat.uniforms.uFade.value = ES.smoothstep(this.shellR * 0.92, this.shellR * 1.1, d);
    }

    /* ======================= DECORAÇÃO ======================= */
    _nearObstacle(local, r) {
      for (const ob of this.obstacles) {
        const dx = ob.x - local.x, dy = ob.y - local.y, dz = ob.z - local.z;
        const m = ob.r + r;
        if (dx * dx + dy * dy + dz * dz < m * m) return true;
      }
      return false;
    }

    _buildDecorations(rng) {
      const T = this.type;
      const area = 4 * Math.PI * this.radius * this.radius;
      const dir = new THREE.Vector3();
      const local = new THREE.Vector3();
      const nrm = new THREE.Vector3();

      for (const entry of T.deco) {
        const spec = DECOS[entry[0]];
        const target = Math.round(area * entry[1]);
        const placed = [];
        let tries = 0;
        while (placed.length < target && tries < target * 10) {
          tries++;
          rng.unit(dir);
          const g = this.groundAt(dir);
          if (this.seaR !== null && g.terrainR < this.seaR + 0.5) continue;   // nada debaixo d'água
          local.copy(dir).multiplyScalar(g.r);
          const s = rng.range(spec.scale[0], spec.scale[1]);
          if (this._nearObstacle(local, spec.r * s)) continue;
          // Inclina um pouco com o terreno (mistura direção radial e normal da face).
          nrm.copy(dir).lerp(g.normal, 0.4).normalize();
          placed.push({ pos: local.clone().addScaledVector(dir, -0.12 * s), n: nrm.clone(), s, yaw: rng.range(0, Math.PI * 2), hv: rng.range(0.9, 1.15) });
          this.obstacles.push({ x: local.x, y: local.y, z: local.z, r: spec.r * s });
        }
        if (!placed.length) continue;

        // Um InstancedMesh por parte (todas as instâncias numa única chamada de desenho).
        for (const part of spec.parts) {
          const geo = part.geo();
          const mat = part.emissive
            ? new THREE.MeshBasicMaterial({ color: 0xffffff })
            // Phong sem brilho = Lambert, mas com suporte a flatShading (visual facetado) nesta versão do Three.js.
            : new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, specular: 0x000000 });
          const mesh = new THREE.InstancedMesh(geo, mat, placed.length);
          const baseHex = part.color === 'rock' ? T.rock : part.color;
          _e.set((part.rot || [0, 0, 0])[0], (part.rot || [0, 0, 0])[1], (part.rot || [0, 0, 0])[2]);
          _q2.setFromEuler(_e);
          const ps = part.scale || [1, 1, 1];
          _part.compose(_v.set(part.pos[0], part.pos[1], part.pos[2]), _q2, _s.set(ps[0], ps[1], ps[2]));
          for (let i = 0; i < placed.length; i++) {
            const p = placed[i];
            _q.setFromUnitVectors(Y_AXIS, p.n);
            _q2.setFromAxisAngle(Y_AXIS, p.yaw);
            _q.multiply(_q2);
            _base.compose(p.pos, _q, _s.set(p.s, p.s * p.hv, p.s));
            _m.multiplyMatrices(_base, _part);
            mesh.setMatrixAt(i, _m);
            _c.setHex(baseHex);
            if (part.vary) _c.offsetHSL(0, 0, rng.range(-part.vary, part.vary));
            mesh.setColorAt(i, _c);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.frustumCulled = false;   // as instâncias cobrem o planeta todo
          this.group.add(mesh);
        }
      }
    }

    /** Empurra uma posição (coordenadas do mundo) para fora de árvores/pedras próximas. */
    pushOutObstacles(worldPos, bodyRadius) {
      _v.copy(worldPos).sub(this.center);          // posição local
      const up = _s.copy(_v).normalize();
      let moved = false;
      for (const ob of this.obstacles) {
        const dx = _v.x - ob.x, dy = _v.y - ob.y, dz = _v.z - ob.z;
        const m = ob.r + bodyRadius;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < m * m && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          // Remove a parte radial: só empurra ao longo da superfície.
          const dot = (dx * up.x + dy * up.y + dz * up.z) / d;
          let ax = dx / d - up.x * dot, ay = dy / d - up.y * dot, az = dz / d - up.z * dot;
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al; ay /= al; az /= al;
          const push = m - d;
          worldPos.x += ax * push; worldPos.y += ay * push; worldPos.z += az * push;
          _v.x += ax * push; _v.y += ay * push; _v.z += az * push;
          moved = true;
        }
      }
      return moved;
    }

    /**
     * Evita que árvores/pedras fiquem entre a câmera e o alvo: se algo bloqueia o
     * segmento alvo -> câmera, aproxima a câmera do alvo até antes do obstáculo.
     * (obstáculos tratados como esferas; coordenadas do mundo; "cam" é modificado)
     */
    pullCameraIn(target, cam, radius, minFraction) {
      const d = _s.copy(cam).sub(target);
      const a = d.lengthSq();
      if (a < 1e-6) return;
      let tMin = 1;
      for (const ob of this.obstacles) {
        // obstáculo em coordenadas do mundo
        const wx = ob.x + this.center.x - target.x, wy = ob.y + this.center.y - target.y, wz = ob.z + this.center.z - target.z;
        const R = ob.r * 0.75 + radius;                            // copa e tronco: um pouco menos que o raio de colisão
        const wd = wx * d.x + wy * d.y + wz * d.z;                // projeção de w em d
        const disc = wd * wd - a * (wx * wx + wy * wy + wz * wz - R * R);
        if (disc <= 0) continue;                                   // o segmento não atinge a esfera
        const t0 = (wd - Math.sqrt(disc)) / a;                     // primeiro ponto de entrada
        if (t0 > 0 && t0 < tMin) tMin = t0;
      }
      if (tMin < 1) {
        tMin = Math.max(tMin, minFraction || 0.3);
        cam.copy(target).addScaledVector(d, tMin);
      }
    }

    /**
     * Procura um ponto de pouso livre de árvores/pedras perto da direção pedida
     * (espiral crescente ao redor dela). Retorna um novo vetor unitário.
     */
    findClearSpot(dir, clearance) {
      const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
      t1.set(1, 0, 0);
      if (Math.abs(dir.x) > 0.9) t1.set(0, 1, 0);
      t1.cross(dir).normalize();
      t2.crossVectors(dir, t1);
      const cand = new THREE.Vector3(), local = new THREE.Vector3();
      for (let k = 0; k < 40; k++) {
        const ang = k * 2.4;
        const step = (k * 1.4) / this.radius;      // ~1.4 unidades por tentativa
        cand.copy(dir).addScaledVector(t1, Math.cos(ang) * step).addScaledVector(t2, Math.sin(ang) * step).normalize();
        const g = this.groundAt(cand);
        if (this.seaR !== null && k < 30 && g.terrainR < this.seaR) continue;   // prefere terra firme
        local.copy(cand).multiplyScalar(g.r);
        if (!this._nearObstacle(local, clearance)) return cand.clone();
      }
      return dir.clone();
    }

    /* ======================= RECURSOS ======================= */
    _buildResources(rng) {
      const total = rng.int(14, 22);
      const geos = ES.RESOURCE_TYPES.map((t) => t.makeGeo());
      const beamGeo = new THREE.CylinderGeometry(0.05, 0.22, 34, 8, 1, true);
      beamGeo.translate(0, 17, 0);
      const dir = new THREE.Vector3(), local = new THREE.Vector3();
      let tries = 0;

      while (this.resources.length < total && tries < total * 30) {
        tries++;
        rng.unit(dir);
        const g = this.groundAt(dir);
        if (this.seaR !== null && g.terrainR < this.seaR + 0.4) continue;
        local.copy(dir).multiplyScalar(g.r);
        if (this._nearObstacle(local, 1.4)) continue;

        // Sorteio ponderado do tipo de recurso.
        let roll = rng.next(), ti = 0;
        for (; ti < ES.RESOURCE_TYPES.length - 1; ti++) {
          roll -= ES.RESOURCE_TYPES[ti].weight;
          if (roll < 0) break;
        }
        const type = ES.RESOURCE_TYPES[ti];

        const group = new THREE.Group();
        group.quaternion.setFromUnitVectors(Y_AXIS, dir);
        const core = new THREE.Mesh(geos[ti], new THREE.MeshBasicMaterial({ color: type.color, fog: false }));
        const shell = new THREE.Mesh(geos[ti], new THREE.MeshBasicMaterial({
          color: type.color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
        shell.scale.setScalar(1.6);
        const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
          color: type.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, fog: false,
        }));
        beam.visible = false;
        group.add(core, shell, beam);
        this.group.add(group);

        this.resources.push({
          type, group, core, shell, beam,
          ground: local.clone(), dir: dir.clone(),
          worldPos: new THREE.Vector3(), phase: rng.range(0, Math.PI * 2),
          taken: false, pingStart: -99,
        });
      }
      this.resourcesTotal = this.resources.length;
    }

    /** Animação dos recursos (flutuar + girar) e dos feixes do pulso de eco. */
    update(dt, time) {
      for (const r of this.resources) {
        if (r.taken) continue;
        const bob = Math.sin(time * 2 + r.phase) * 0.28;
        r.group.position.copy(r.ground).addScaledVector(r.dir, 1.7 + bob);
        r.worldPos.copy(r.group.position).add(this.center);
        r.core.rotation.y += dt * 1.4;
        r.shell.rotation.y -= dt * 0.9;
        const age = time - r.pingStart;
        if (age < 7) {
          r.beam.visible = true;
          r.beam.material.opacity = 0.55 * (1 - age / 7) * (0.65 + 0.35 * Math.sin(time * 6 + r.phase));
        } else if (r.beam.visible) {
          r.beam.visible = false;
        }
      }
    }

    /** Coleta recursos num raio ao redor de uma posição. Retorna a lista de coletados. */
    collectNear(worldPos, radius) {
      const got = [];
      const r2 = radius * radius;
      for (const r of this.resources) {
        if (r.taken) continue;
        if (r.worldPos.distanceToSquared(worldPos) < r2) {
          r.taken = true;
          r.group.visible = false;
          this.resourcesTaken++;
          got.push({ type: r.type, pos: r.worldPos.clone() });
        }
      }
      return got;
    }

    /** Pulso de eco: acende feixes de luz nos recursos próximos. */
    revealResources(worldPos, radius, time) {
      let n = 0;
      for (const r of this.resources) {
        if (!r.taken && r.worldPos.distanceTo(worldPos) < radius) { r.pingStart = time; n++; }
      }
      return n;
    }

    /* ======================= ANEL (só decoração) ======================= */
    _buildRing(rng) {
      const inner = this.radius * 1.55, outer = this.radius * 2.4;
      const geo = new THREE.RingGeometry(inner, outer, 96, 1);
      const uv = geo.attributes.uv, p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getY(i));
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      // Textura 1D com faixas de densidades diferentes.
      const c = document.createElement('canvas');
      c.width = 256; c.height = 4;
      const g = c.getContext('2d');
      const base = this.skyColor.clone().lerp(new THREE.Color(0xffffff), 0.45);
      for (let x = 0; x < 256; x++) {
        const band = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.19 + rng.next() * 0.4)) * (0.6 + 0.4 * Math.sin(x * 0.05));
        const gap = (x > 120 && x < 132) ? 0.1 : 1;
        const edge = Math.min(1, x / 12, (255 - x) / 12);
        g.fillStyle = 'rgba(' + Math.round(base.r * 255) + ',' + Math.round(base.g * 255) + ',' + Math.round(base.b * 255) + ',' + (band * gap * edge * 0.85) + ')';
        g.fillRect(x, 0, 1, 4);
      }
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(ring);
      holder.rotation.set(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5));
      this.group.add(holder);
      this.ring = holder;
    }
  };
})();
