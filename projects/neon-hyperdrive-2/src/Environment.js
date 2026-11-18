import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { neon, mulberry32, disposeObject, canvasTexture } from './Utils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Pano de fundo retrofuturista: céu em gradiente, estrelas, sol listrado, montanhas, cidade distante e grade no solo. */
export class Environment {
  constructor(palette, seed = 1, def = {}) {
    this.palette = palette;
    this.group = new THREE.Group();
    this.backdrop = new THREE.Group();
    this.group.add(this.backdrop);
    this.rng = mulberry32(seed * 7 + 3);

    this.spinners = [];
    this.fireworks = null;
    const park = def.theme === 'park';

    this._sky();
    this._stars();
    const ice = def.theme === 'ice';
    this.timed = [];

    if (park || ice) this._moon(); else this._sun();
    if (ice) this._aurora();
    this._mountains();
    if (park) this._park(def);
    else if (ice) { this._village(); this._snow(); }
    else this._skyline();
    if (def.theme === 'tokyo') this._tokyo();
    this._grid();
  }

  _sky() {
    const pal = this.palette;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(pal.skyTop) },
        uMid: { value: new THREE.Color(pal.skyMid) },
        uHorizon: { value: new THREE.Color(pal.horizon) },
        uFog: { value: new THREE.Color(pal.fog) },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uMid, uHorizon, uFog;
        varying vec3 vDir;
        void main() {
          float h = normalize(vDir).y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
          col = mix(col, uTop, smoothstep(0.18, 0.75, h));
          col = mix(uFog, col, smoothstep(-0.12, 0.02, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 24, 16), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);
  }

  _stars() {
    const rng = this.rng;
    const count = 1400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const y = 0.08 + rng() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 4300;
      pos[i * 3 + 1] = y * 4300;
      pos[i * 3 + 2] = Math.sin(a) * r * 4300;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xcfd8ff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false,
    }));
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    this.sky.add(stars);
  }

  _sun() {
    const pal = this.palette;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: neon(pal.sunTop, 1.05) },
        uBottom: { value: neon(pal.sunBottom, 1.05) },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uBottom;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.6;
          float r = length(p);
          float disc = smoothstep(1.0, 0.985, r);
          vec3 col = mix(uBottom, uTop, smoothstep(-0.7, 0.8, p.y));
          // Faixas horizontais que engrossam em direção ao horizonte.
          float below = max(0.0, 0.3 - p.y);
          float band = fract(below * 6.5);
          float cut = step(0.12 + below * 0.6, band);
          float stripes = mix(1.0, cut, step(p.y, 0.3));
          float halo = exp(-max(r - 1.0, 0.0) * 5.0) * 0.28 * (1.0 - disc);
          float alpha = disc * stripes + halo;
          gl_FragColor = vec4(col * (disc * stripes + halo * 1.2), alpha);
        }`,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(2100, 2100), mat);
    sun.position.set(0, 330, -3600);
    sun.renderOrder = -8;
    sun.frustumCulled = false;
    this.backdrop.add(sun);
  }

  _mountains() {
    const pal = this.palette;
    const rng = this.rng;
    const groundY = CONFIG.track.groundY;
    const geo = new THREE.ConeGeometry(1, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);

    const layers = [
      { radius: 3300, count: 46, minH: 380, maxH: 900, line: pal.mountainLine2, k: 1.1 },
      { radius: 2700, count: 40, minH: 200, maxH: 560, line: pal.mountainLine, k: 1.5 },
    ];
    for (const layer of layers) {
      const solid = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color: pal.mountain, fog: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
      }), layer.count);
      const wire = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color: neon(layer.line, layer.k), wireframe: true, fog: false, transparent: true, opacity: 0.8,
      }), layer.count);
      for (let i = 0; i < layer.count; i++) {
        const a = ((i + rng() * 0.6) / layer.count) * Math.PI * 2;
        // O sol fica na direção -Z: montanhas mais baixas ali para deixá-lo visível.
        const toSun = Math.max(0, Math.cos(a + Math.PI / 2));
        const dim = 1 - 0.72 * Math.pow(toSun, 6);
        const h = (layer.minH + rng() * (layer.maxH - layer.minH)) * dim;
        const w = h * (0.75 + rng() * 0.7) + 120;
        const r = layer.radius + (rng() - 0.5) * 300;
        _p.set(Math.cos(a) * r, groundY - 4, Math.sin(a) * r);
        _q.setFromEuler(_e.set(0, rng() * Math.PI, 0));
        _m.compose(_p, _q, _s.set(w, h, w));
        solid.setMatrixAt(i, _m);
        wire.setMatrixAt(i, _m);
      }
      solid.frustumCulled = wire.frustumCulled = false;
      solid.renderOrder = -6;
      wire.renderOrder = -5;
      this.backdrop.add(solid, wire);
    }
  }

  _skyline() {
    const pal = this.palette;
    const rng = this.rng;
    const groundY = CONFIG.track.groundY;
    const count = 110;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const towers = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), count);
    const lights = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), count);
    const dark = new THREE.Color(pal.mountain).lerp(new THREE.Color(pal.horizon), 0.18);
    const clusters = [0.6, 1.9, 3.4, 4.3, 5.5];
    for (let i = 0; i < count; i++) {
      const c = clusters[i % clusters.length];
      const a = c + (rng() - 0.5) * 0.55;
      const r = 2050 + rng() * 350;
      const h = 120 + rng() * rng() * 520;
      const w = 40 + rng() * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      _m.makeScale(w, h, w).setPosition(x, groundY + h / 2, z);
      towers.setMatrixAt(i, _m);
      towers.setColorAt(i, dark);
      const strip = i % 3 === 0;
      if (strip) _m.makeScale(w * 1.04, 5, w * 1.04).setPosition(x, groundY + h * (0.5 + rng() * 0.45), z);
      else _m.makeScale(6, 6, 6).setPosition(x, groundY + h + 3, z);
      lights.setMatrixAt(i, _m);
      lights.setColorAt(i, neon(pal.buildings[i % pal.buildings.length], 1.8));
    }
    towers.frustumCulled = lights.frustumCulled = false;
    towers.renderOrder = -4;
    lights.renderOrder = -3;
    this.backdrop.add(towers, lights);
  }

  _grid() {
    const pal = this.palette;
    const mat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uBase: { value: new THREE.Color(pal.gridBase) },
        uLine: { value: neon(pal.grid, 1.5) },
        uFog: { value: new THREE.Color(pal.fog) },
        uCell: { value: 70 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uBase, uLine, uFog;
        uniform float uCell;
        varying vec3 vWorld;
        void main() {
          vec2 c = vWorld.xz / uCell;
          vec2 g = abs(fract(c - 0.5) - 0.5) / (fwidth(c) * 1.5);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float dist = distance(vWorld.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(500.0, 2600.0, dist);
          vec3 col = mix(uBase, uLine, line * fade * 0.85);
          col = mix(uFog, col, mix(0.25, 1.0, fade));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = CONFIG.track.groundY;
    grid.frustumCulled = false;
    grid.renderOrder = -7;
    this.backdrop.add(grid);
  }

  // ---------------------------------------------------------------- tema gelo e aurora boreal

  /** Cortinas de aurora: faixas curvas no céu com raios verticais animados no shader. */
  _aurora() {
    const pal = this.palette;
    const bands = [
      { a0: -2.5, span: 1.9, radius: 3700, base: 620, height: 1250, phase: 0, strength: 1 },
      { a0: -1.1, span: 1.7, radius: 3500, base: 900, height: 1100, phase: 2.1, strength: 0.8 },
      { a0: 0.9, span: 2.2, radius: 3600, base: 760, height: 1200, phase: 4.4, strength: 0.85 },
      { a0: 3.1, span: 1.5, radius: 3400, base: 1000, height: 1000, phase: 1.3, strength: 0.7 },
    ];
    for (const band of bands) {
      const segs = 80;
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const a = band.a0 + u * band.span;
        const r = band.radius + Math.sin(u * 9 + band.phase) * 260;
        const y = band.base + Math.sin(u * 5 + band.phase * 2) * 140;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, y, z, x * 0.93, y + band.height, z * 0.93);
        uv.push(u, 0, u, 1);
        if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: band.phase },
          uStrength: { value: band.strength },
          uLow: { value: neon(pal.edgeL, 1.15) },
          uHigh: { value: neon(pal.accent, 0.9) },
        },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform float uTime, uPhase, uStrength;
          uniform vec3 uLow, uHigh;
          varying vec2 vUv;
          void main() {
            float x = vUv.x;
            float rays = 0.55 + 0.45 * sin(x * 95.0 + sin(x * 13.0 + uTime * 0.35 + uPhase) * 4.0 + uTime * 0.6);
            rays *= 0.55 + 0.45 * sin(x * 21.0 - uTime * 0.22 + uPhase);
            float curtain = smoothstep(0.0, 0.05, vUv.y) * pow(1.0 - vUv.y, 1.7);
            float ends = smoothstep(0.0, 0.14, x) * smoothstep(1.0, 0.86, x);
            float a = curtain * rays * ends * uStrength;
            vec3 col = mix(uLow, uHigh, smoothstep(0.05, 0.75, vUv.y));
            gl_FragColor = vec4(col * a, a);
          }`,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -8;
      this.sky.add(mesh);
      this.timed.push(mat);
    }
  }

  /** Vila distante: casas com telhado nevado, igrejas com torre e floresta de pinheiros. */
  _village() {
    const pal = this.palette;
    const rng = this.rng;
    const groundY = CONFIG.track.groundY;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const pyramid = new THREE.ConeGeometry(1, 1, 4, 1, true);
    pyramid.rotateY(Math.PI / 4);
    pyramid.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1, 1, 6, 1, true);
    cone.translate(0, 0.5, 0);
    const flat = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, fog: false, ...extra });

    const houseCount = 70, pineCount = 120;
    const walls = new THREE.InstancedMesh(box, flat(0x0d1b33), houseCount);
    const roofs = new THREE.InstancedMesh(pyramid, flat(0x7f97bb, { side: THREE.DoubleSide }), houseCount);
    const windows = new THREE.InstancedMesh(box, flat(neon(0xffc97a, 1.9)), houseCount);
    const pines = new THREE.InstancedMesh(cone, flat(0x0a2a2a, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), pineCount);
    const pineEdges = new THREE.InstancedMesh(cone, flat(neon(pal.edgeL, 0.7), { wireframe: true, transparent: true, opacity: 0.5 }), pineCount);
    const clusters = [0.4, 1.5, 2.5, 3.5, 4.6, 5.6];

    for (let i = 0; i < houseCount; i++) {
      const a = clusters[i % clusters.length] + (rng() - 0.5) * 0.5;
      const dist = 1850 + rng() * 400;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      const church = i % 12 === 0;
      const w = church ? 70 : 60 + rng() * 60;
      const h = church ? 190 : 45 + rng() * 45;
      _m.makeScale(w, h, w).setPosition(x, groundY + h / 2, z);
      walls.setMatrixAt(i, _m);
      _m.makeScale(w * 0.8, church ? 170 : 34 + w * 0.3, w * 0.8).setPosition(x, groundY + h, z);
      roofs.setMatrixAt(i, _m);
      _m.makeScale(w * 1.02, church ? 12 : 8, w * 0.5).setPosition(x, groundY + h * (church ? 0.8 : 0.5), z);
      windows.setMatrixAt(i, _m);
    }
    for (let i = 0; i < pineCount; i++) {
      const a = rng() * Math.PI * 2;
      const dist = 2250 + rng() * 350;
      const h = 150 + rng() * 190;
      _m.makeScale(h * 0.3, h, h * 0.3).setPosition(Math.cos(a) * dist, groundY, Math.sin(a) * dist);
      pines.setMatrixAt(i, _m);
      pineEdges.setMatrixAt(i, _m);
    }
    for (const mesh of [pines, pineEdges, walls, roofs, windows]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = -4;
      this.backdrop.add(mesh);
    }
  }

  /** Neve caindo: os flocos ocupam um volume que se repete ao redor da câmera (custo de CPU zero). */
  _snow() {
    const count = 1800;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    this.snow = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: 150 } },
      vertexShader: /* glsl */`
        uniform float uTime, uBox;
        uniform vec3 uCam;
        varying float vAlpha;
        void main() {
          vec3 drift = vec3(uTime * 5.0 + sin(uTime * 0.7 + position.y * 20.0) * 2.0, -uTime * 14.0, uTime * 3.0);
          vec3 p = mod(position * uBox + drift - uCam, uBox) - uBox * 0.5 + uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vAlpha = smoothstep(uBox * 0.5, uBox * 0.3, dist) * smoothstep(0.5, 4.0, dist);
          gl_PointSize = clamp(170.0 / max(dist, 1.0), 1.0, 7.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vAlpha * 0.75;
          gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, a);
        }`,
    });
    const points = new THREE.Points(geo, this.snow);
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.group.add(points);
    this.timed.push(this.snow);
  }

  // ---------------------------------------------------------------- tema Tóquio futurista

  _tokyo() {
    const pal = this.palette;
    const groundY = CONFIG.track.groundY;
    const solidMat = () => new THREE.MeshBasicMaterial({
      color: pal.mountain, fog: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
    });
    const wireMat = (color, k, opacity = 0.85) => new THREE.MeshBasicMaterial({
      color: neon(color, k), wireframe: true, fog: false, transparent: true, opacity,
    });
    const place = (mesh, order) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.backdrop.add(mesh);
      return mesh;
    };

    // Monte nevado diante do sol vermelho.
    const H = 800, rTop = 80, rBase = 1050;
    const cone = new THREE.CylinderGeometry(rTop, rBase, H, 10, 2, true);
    cone.translate(0, H / 2, 0);
    const capH = H * 0.24;
    const cap = new THREE.CylinderGeometry(rTop + 1, rTop + (rBase - rTop) * 0.24 + 1, capH, 10, 1, true);
    cap.translate(0, H - capH / 2, 0);
    const peak = new THREE.Group();
    peak.position.set(-560, groundY - 4, -3200);
    peak.add(
      place(new THREE.Mesh(cone, solidMat()), -6),
      place(new THREE.Mesh(cone, wireMat(pal.mountainLine2, 1.2)), -5),
      place(new THREE.Mesh(cap, new THREE.MeshBasicMaterial({ color: neon(0xffe6f2, 0.95), fog: false })), -5),
    );
    this.backdrop.add(peak);

    // Torre treliçada de comunicações.
    const tower = new THREE.Group();
    tower.position.set(1300, groundY, -2250);
    const TH = 980;
    const lattice = new THREE.CylinderGeometry(10, 170, TH, 4, 10, true);
    lattice.translate(0, TH / 2, 0);
    const deck = new THREE.BoxGeometry(1, 1, 1);
    const deckMat = new THREE.MeshBasicMaterial({ color: neon(0xffffff, 1.6), fog: false });
    tower.add(place(new THREE.Mesh(lattice, wireMat(0xff4a2a, 1.7, 1)), -3));
    for (const [y, w, h] of [[TH * 0.3, 150, 22], [TH * 0.62, 84, 16], [TH + 60, 6, 120]]) {
      const m = place(new THREE.Mesh(deck, deckMat), -3);
      m.position.y = y;
      m.scale.set(w, h, w);
      tower.add(m);
    }
    tower.rotation.y = 0.5;
    this.backdrop.add(tower);

    // Pagode de cinco andares.
    const tiers = 5;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1, true);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.5, 0);
    const bodies = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0x150a24, fog: false }), tiers);
    const lamps = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: neon(pal.accent, 1.5), fog: false }), tiers);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshBasicMaterial({ color: 0x2a0714, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), tiers);
    const roofLines = new THREE.InstancedMesh(roofGeo, wireMat(0xff2a3a, 1.8, 1), tiers);
    const px = -1750, pz = -1750;
    let y = groundY;
    for (let i = 0; i < tiers; i++) {
      const w = 250 - i * 34;
      const bodyH = 78 - i * 5;
      _m.makeScale(w, bodyH, w).setPosition(px, y + bodyH / 2, pz);
      bodies.setMatrixAt(i, _m);
      _m.makeScale(w * 0.86, 7, w * 1.02).setPosition(px, y + bodyH * 0.55, pz);
      lamps.setMatrixAt(i, _m);
      y += bodyH;
      const roofH = i === tiers - 1 ? 150 : 46;
      _m.makeScale(w * 1.05, roofH, w * 1.05).setPosition(px, y - 8, pz);
      roofs.setMatrixAt(i, _m);
      roofLines.setMatrixAt(i, _m);
      y += 14;
    }
    for (const mesh of [bodies, lamps, roofs, roofLines]) place(mesh, -3);
  }

  // ---------------------------------------------------------------- tema parque de diversões

  _moon() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uColor: { value: neon(this.palette.moon ?? 0xfff0c8, 1.25) } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 3.2;
          float r = length(p);
          float disc = smoothstep(1.0, 0.975, r);
          // Lua crescente: um disco de sombra deslocado recorta o disco iluminado.
          float lit = smoothstep(0.9, 0.95, length(p - vec2(0.46, 0.2)));
          float crescent = disc * lit;
          float earthshine = disc * (1.0 - lit) * 0.05;
          float halo = exp(-max(r - 0.85, 0.0) * 3.2) * 0.16 * (1.0 - disc);
          float a = crescent + earthshine + halo;
          gl_FragColor = vec4(uColor * a, clamp(a, 0.0, 1.0));
        }`,
    });
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(1150, 1150), mat);
    moon.position.set(-520, 1180, -3550);
    moon.lookAt(0, 200, 0);
    moon.renderOrder = -8;
    moon.frustumCulled = false;
    this.backdrop.add(moon);
  }

  /** Roda-gigante neon; o grupo "spin" gira continuamente em update(). */
  _wheel(R, { fog = true, speed = 0.1 } = {}) {
    const pal = this.palette;
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);
    const basic = (color) => new THREE.MeshBasicMaterial({ color, fog });
    const order = fog ? 0 : -2;

    for (const [radius, color, k] of [[R, pal.edgeR, 1.7], [R * 0.82, pal.edgeL, 1.5], [R * 0.28, pal.accent, 1.5]]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, R * 0.011, 5, 56), basic(neon(color, k)));
      rim.renderOrder = order;
      spin.add(rim);
    }

    const count = 16;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const spokes = new THREE.InstancedMesh(box, basic(0xffffff), count);
    const cabins = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(R * 0.05, 0), basic(0xffffff), count + 1);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      _m.makeRotationZ(a);
      _m.scale(_s.set(R, R * 0.008, R * 0.008));
      _m.setPosition(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0);
      spokes.setMatrixAt(i, _m);
      spokes.setColorAt(i, neon(i % 2 ? pal.edgeL : pal.accent, 1.15));
      _m.makeTranslation(Math.cos(a) * R, Math.sin(a) * R, 0);
      cabins.setMatrixAt(i, _m);
      cabins.setColorAt(i, neon(pal.buildings[i % pal.buildings.length], 2.3));
    }
    _m.makeScale(1.6, 1.6, 1.6);
    cabins.setMatrixAt(count, _m);
    cabins.setColorAt(count, neon(0xffffff, 2));
    spokes.frustumCulled = cabins.frustumCulled = false;
    spokes.renderOrder = cabins.renderOrder = order;
    spin.add(spokes, cabins);

    // Pernas de sustentação em "A".
    const legs = new THREE.InstancedMesh(box, basic(neon(0x5a4bff, 0.7)), 2);
    const drop = R + R * 0.18;
    const tilt = 0.3;
    const len = drop / Math.cos(tilt);
    [-1, 1].forEach((side, i) => {
      _m.makeRotationZ(side * tilt);
      _m.scale(_s.set(R * 0.03, len, R * 0.03));
      _m.setPosition(side * Math.sin(tilt) * len * 0.5, -drop * 0.5, 0);
      legs.setMatrixAt(i, _m);
    });
    legs.frustumCulled = false;
    legs.renderOrder = order;
    root.add(legs);

    root.userData.drop = drop;
    this.spinners.push({ obj: spin, speed });
    return root;
  }

  _park(def) {
    const pal = this.palette;
    const rng = this.rng;
    const groundY = CONFIG.track.groundY;

    // Roda-gigante monumental no horizonte, ao lado da lua.
    const big = this._wheel(520, { fog: false, speed: 0.06 });
    big.position.set(980, groundY + big.userData.drop - 6, -2500);
    big.rotation.y = -0.36;
    this.backdrop.add(big);

    // Rodas-gigantes dentro do circuito (com paralaxe e névoa).
    for (const [x, z, r, rotY] of def.park?.wheels || []) {
      const wheel = this._wheel(r, { speed: 0.14 });
      wheel.position.set(x, groundY + wheel.userData.drop - 4, z);
      wheel.rotation.y = rotY;
      this.group.add(wheel);
    }

    // Lonas de circo distantes.
    const stripes = canvasTexture(64, 8, (c, w, h) => {
      c.fillStyle = '#262626';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w / 2, h);
    }, { repeatX: 7, anisotropy: 2 });
    const tentCount = 46;
    const baseGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    baseGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(1.18, 1, 10, 1, true);
    roofGeo.translate(0, 0.5, 0);
    const tentMat = new THREE.MeshBasicMaterial({ map: stripes, fog: false, side: THREE.DoubleSide });
    const bases = new THREE.InstancedMesh(baseGeo, tentMat, tentCount);
    const roofs = new THREE.InstancedMesh(roofGeo, tentMat, tentCount);
    const tops = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), tentCount);
    const tint = new THREE.Color();
    const clusters = [0.5, 1.7, 2.6, 3.6, 5.3, 5.9];
    for (let i = 0; i < tentCount; i++) {
      const a = clusters[i % clusters.length] + (rng() - 0.5) * 0.6;
      const dist = 1850 + rng() * 420;
      const r = 70 + rng() * 110;
      const bh = 50 + rng() * 70;
      const rh = 90 + rng() * 150;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      const color = pal.buildings[i % pal.buildings.length];
      tint.set(color).multiplyScalar(0.42);
      _m.makeScale(r, bh, r).setPosition(x, groundY, z);
      bases.setMatrixAt(i, _m);
      bases.setColorAt(i, tint);
      _m.makeScale(r, rh, r).setPosition(x, groundY + bh, z);
      roofs.setMatrixAt(i, _m);
      roofs.setColorAt(i, tint);
      _m.makeScale(7, 22, 7).setPosition(x, groundY + bh + rh + 10, z);
      tops.setMatrixAt(i, _m);
      tops.setColorAt(i, neon(color, 2));
    }
    for (const mesh of [bases, roofs, tops]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = -4;
      this.backdrop.add(mesh);
    }

    // Montanha-russa: trilho neon ondulante com pilares.
    const pts = [];
    const steps = 15;
    for (let i = 0; i <= steps; i++) {
      const a = -3.25 + (i / steps) * 1.25;
      const dist = 2380 + Math.sin(i * 2.1) * 90;
      const y = groundY + 110 + 360 * Math.abs(Math.sin(i * 1.37 + 0.6)) * (0.45 + 0.55 * rng());
      pts.push(new THREE.Vector3(Math.cos(a) * dist, y, Math.sin(a) * dist));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    for (const [radius, color, lift] of [[5.5, pal.edgeR, 0], [3.5, pal.edgeL, -16]]) {
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 150, radius, 5), new THREE.MeshBasicMaterial({ color: neon(color, 1.5), fog: false }));
      rail.position.y = lift;
      rail.renderOrder = -3;
      rail.frustumCulled = false;
      this.backdrop.add(rail);
    }
    const postCount = 44;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: neon(0x3a2f8a, 0.8), fog: false }), postCount);
    for (let i = 0; i < postCount; i++) {
      curve.getPointAt(i / (postCount - 1), _p);
      const h = _p.y - groundY;
      _m.makeScale(5, h, 5).setPosition(_p.x, groundY + h / 2, _p.z);
      posts.setMatrixAt(i, _m);
    }
    posts.frustumCulled = false;
    posts.renderOrder = -4;
    this.backdrop.add(posts);

    this._fireworks();
  }

  /** Fogos de artifício animados inteiramente no vertex shader (custo de CPU zero). */
  _fireworks() {
    const pal = this.palette;
    const rng = this.rng;
    const bursts = 7, per = 70;
    const total = bursts * per;
    const pos = new Float32Array(total * 3), dir = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const timing = new Float32Array(total * 2);
    for (let b = 0; b < bursts; b++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.6;
      const dist = 2500 + rng() * 500;
      const ox = Math.cos(a) * dist, oy = 520 + rng() * 520, oz = Math.sin(a) * dist;
      const color = neon(pal.buildings[b % pal.buildings.length], 2.4);
      const phase = rng() * 9, period = 4.5 + rng() * 4.5;
      for (let i = 0; i < per; i++) {
        const j = (b * per + i) * 3;
        _p.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(0.55 + rng() * 0.45);
        pos[j] = ox; pos[j + 1] = oy; pos[j + 2] = oz;
        dir[j] = _p.x; dir[j + 1] = _p.y; dir[j + 2] = _p.z;
        col[j] = color.r; col[j + 1] = color.g; col[j + 2] = color.b;
        timing[(b * per + i) * 2] = phase;
        timing[(b * per + i) * 2 + 1] = period;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aTiming', new THREE.BufferAttribute(timing, 2));
    this.fireworks = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 aDir; attribute vec3 aColor; attribute vec2 aTiming;
        uniform float uTime;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float t = mod(uTime + aTiming.x, aTiming.y);
          float life = 2.2;
          float k = clamp(t / life, 0.0, 1.0);
          vec3 p = position + aDir * (1.0 - exp(-t * 2.6)) * 330.0 - vec3(0.0, t * t * 22.0, 0.0);
          vAlpha = t < life ? (1.0 - k) * (1.0 - k) : 0.0;
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = vAlpha > 0.0 ? 2.0 + 3.5 * (1.0 - k) : 0.0;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    const points = new THREE.Points(geo, this.fireworks);
    points.frustumCulled = false;
    points.renderOrder = -7;
    this.backdrop.add(points);
  }

  /** Mantém o fundo centralizado na câmera para parecer infinitamente distante. */
  update(camera, time = 0) {
    this.sky.position.copy(camera.position);
    this.backdrop.position.set(camera.position.x, 0, camera.position.z);
    for (const s of this.spinners) s.obj.rotation.z = time * s.speed;
    for (const mat of this.timed) mat.uniforms.uTime.value = time;
    if (this.snow) this.snow.uniforms.uCam.value.copy(camera.position);
    if (this.fireworks) this.fireworks.uniforms.uTime.value = time;
  }

  dispose() {
    this.group.removeFromParent();
    disposeObject(this.group);
  }
}
