import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { neon } from './Utils.js';

const MAX_PARTICLES = 1400;
const TRAIL_POINTS = 18;
const TRAIL_INTERVAL = 1 / 60;

const _v = new THREE.Vector3();
const _c = new THREE.Color();

// ------------------------------------------------------------------ partículas (pool fixo)

class ParticlePool {
  constructor(scene) {
    this.max = MAX_PARTICLES;
    this.cursor = 0;
    this.active = 0;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.size = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.gravity = new Float32Array(this.max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aAlpha; attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.1, -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, color, life, size, gravity = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.col[j] = color.r; this.col[j + 1] = color.g; this.col[j + 2] = color.b;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.gravity[i] = gravity;
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const j = i * 3;
      this.vel[j + 1] -= this.gravity[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.alpha[i] = this.life[i] / this.maxLife[i];
      alive++;
    }
    if (alive || this.active) {
      const a = this.points.geometry.attributes;
      a.position.needsUpdate = a.color.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
    }
    this.active = alive;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.active = 1;
  }
}

// ------------------------------------------------------------------ trilha de energia

class Trail {
  constructor(scene, color) {
    const n = TRAIL_POINTS;
    this.centers = new Float32Array(n * 3);
    this.rights = new Float32Array(n * 3);
    this.positions = new Float32Array(n * 2 * 3);
    this.timer = 0;
    this.started = false;

    const fade = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      fade[i * 2] = fade[i * 2 + 1] = 1 - i / (n - 1);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    geo.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: neon(color, 1.0) }, uIntensity: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aFade; varying float vFade;
        void main() { vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uIntensity; varying float vFade;
        void main() { float a = vFade * vFade * uIntensity; gl_FragColor = vec4(uColor * a, a); }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(dt, ship, width) {
    const n = TRAIL_POINTS;
    const C = this.centers, R = this.rights;
    const head = ship.enginePos;
    const jumped = Math.abs(C[0] - head.x) + Math.abs(C[1] - head.y) + Math.abs(C[2] - head.z) > 40;

    if (!this.started || jumped) {
      for (let i = 0; i < n; i++) { head.toArray(C, i * 3); ship.right.toArray(R, i * 3); }
      this.started = true;
      this.timer = 0;
    } else {
      this.timer += dt;
      let shifts = 0;
      while (this.timer >= TRAIL_INTERVAL && shifts < 3) {
        this.timer -= TRAIL_INTERVAL;
        C.copyWithin(3, 0, (n - 1) * 3);
        R.copyWithin(3, 0, (n - 1) * 3);
        shifts++;
      }
      if (this.timer > TRAIL_INTERVAL) this.timer = 0;
    }
    head.toArray(C, 0);
    ship.right.toArray(R, 0);

    const P = this.positions;
    for (let i = 0; i < n; i++) {
      const w = width * (1 - (i / (n - 1)) * 0.75);
      const a = i * 3, b = i * 6;
      P[b] = C[a] - R[a] * w; P[b + 1] = C[a + 1] - R[a + 1] * w; P[b + 2] = C[a + 2] - R[a + 2] * w;
      P[b + 3] = C[a] + R[a] * w; P[b + 4] = C[a + 1] + R[a + 1] * w; P[b + 5] = C[a + 2] + R[a + 2] * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------------ efeitos de cena

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.particles = new ParticlePool(scene);
    this.trails = new Map();
    this.density = 1;
    this._buildSpeedLines(120);
    this.setQuality({ particles: 0.7, speedLines: 80 });
  }

  setQuality(q) {
    this.density = q.particles;
    this.speedLineCount = Math.min(this.maxLines, q.speedLines);
    this.speedLines.geometry.setDrawRange(0, this.speedLineCount * 2);
  }

  setViewport(height, pixelRatio) {
    this.particles.material.uniforms.uScale.value = height * pixelRatio * 0.9;
  }

  _buildSpeedLines(count) {
    this.maxLines = count;
    this.linePos = new Float32Array(count * 6);
    this.lineData = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3.5 + Math.random() * 9;
      this.lineData.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z: -Math.random() * 70, len: 3 + Math.random() * 7 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.speedLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: neon(0xbfefff, 1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.speedLines.frustumCulled = false;
    this.speedLines.renderOrder = 7;
    this.camera.add(this.speedLines);
  }

  _updateSpeedLines(dt, intensity, speed) {
    const lines = this.speedLines;
    lines.material.opacity = intensity * 0.55;
    lines.visible = intensity > 0.02;
    if (!lines.visible) return;
    const P = this.linePos;
    for (let i = 0; i < this.speedLineCount; i++) {
      const l = this.lineData[i];
      l.z += (speed * 0.9 + 60) * dt;
      if (l.z > 2) l.z = -70 - Math.random() * 10;
      const j = i * 6;
      P[j] = l.x; P[j + 1] = l.y; P[j + 2] = l.z;
      P[j + 3] = l.x; P[j + 4] = l.y; P[j + 5] = l.z - l.len * (1 + intensity);
    }
    lines.geometry.attributes.position.needsUpdate = true;
  }

  attachShip(ship) {
    this.trails.set(ship, { trail: new Trail(this.scene, ship.accent), acc: 0, hot: neon(0xffc070, 1.3), cool: neon(ship.accent, 1.1) });
  }

  clearShips() {
    for (const entry of this.trails.values()) entry.trail.dispose();
    this.trails.clear();
    this.particles.clear();
    this.speedLines.visible = false;
  }

  /** Faíscas em colisões. */
  sparks(pos, dir, intensity, color = 0xffc070) {
    const count = Math.round((4 + intensity * 22) * this.density);
    _c.copy(neon(color, 2.2));
    for (let i = 0; i < count; i++) {
      const sp = 8 + Math.random() * 30 * (0.4 + intensity);
      this.particles.spawn(
        pos.x, pos.y, pos.z,
        dir.x * sp + (Math.random() - 0.5) * 22, Math.random() * 16, dir.z * sp + (Math.random() - 0.5) * 22,
        _c, 0.25 + Math.random() * 0.4, 0.22 + Math.random() * 0.22, 40,
      );
    }
  }

  explosion(pos, color) {
    const count = Math.round(90 * Math.max(0.4, this.density));
    for (let i = 0; i < count; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(10 + Math.random() * 45);
      _c.copy(neon(i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xff8a1f : color, 2.4));
      this.particles.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, _c, 0.5 + Math.random() * 0.9, 0.5 + Math.random() * 0.9, 18);
    }
  }

  update(dt, ships, boostFx, playerSpeed) {
    const camPos = this.camera.position;
    for (const ship of ships) {
      const entry = this.trails.get(ship);
      if (!entry) continue;
      const visible = !ship.destroyed;
      const speedN = Math.min(1.2, ship.v / ship.stats.maxSpeed);
      const hot = ship.boostActive;
      entry.trail.mesh.visible = visible;
      if (visible) {
        entry.trail.update(dt, ship, hot ? 0.6 : 0.42);
        const target = Math.max(0, speedN - 0.12) * (0.3 + ship.throttle * 0.3) * (hot ? 1.5 : 1);
        const u = entry.trail.material.uniforms.uIntensity;
        u.value += (target - u.value) * Math.min(1, dt * 6);
      }

      // Partículas dos motores (apenas para naves próximas da câmera).
      if (!visible || ship.position.distanceToSquared(camPos) > 220 * 220) continue;
      entry.acc += (8 + ship.throttle * 30 + (hot ? 40 : 0)) * this.density * dt;
      while (entry.acc >= 1) {
        entry.acc -= 1;
        const pt = ship.enginePoints[(Math.random() * ship.enginePoints.length) | 0];
        const back = 8 + Math.random() * 14 + ship.v * 0.25;
        this.particles.spawn(
          ship.enginePos.x + ship.right.x * pt.x + (Math.random() - 0.5) * 0.2,
          ship.enginePos.y + (Math.random() - 0.5) * 0.2,
          ship.enginePos.z + ship.right.z * pt.x + (Math.random() - 0.5) * 0.2,
          ship.forward.x * (ship.v - back), ship.forward.y * (ship.v - back) + Math.random() * 1.5, ship.forward.z * (ship.v - back),
          hot ? entry.hot : entry.cool, 0.16 + Math.random() * 0.2, hot ? 0.36 : 0.26,
        );
      }
    }
    this.particles.update(dt);
    this._updateSpeedLines(dt, boostFx, playerSpeed);
  }
}

// ------------------------------------------------------------------ pós-processamento

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0 },
    uScanlines: { value: 0 },
    uVignette: { value: 0.5 },
    uWarp: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 0.75, 0.4) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAberration, uScanlines, uVignette, uWarp, uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // Distorção radial sutil em velocidades extremas.
      vec2 uv = 0.5 + c * (1.0 - uWarp * r2);
      vec2 off = c * uAberration * (0.4 + r2 * 3.0);
      vec3 col = vec3(
        texture2D(tDiffuse, uv + off).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - off).b
      );
      col *= 1.0 - uScanlines * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.094));
      col *= 1.0 - uVignette * smoothstep(0.12, 0.62, r2);
      col += uFlashColor * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.flash = 0;
    this._size = new THREE.Vector2();
  }

  /** Recria a cadeia de passes conforme a qualidade (bloom, MSAA). */
  configure({ bloom, msaa }) {
    this.composer?.dispose();
    const r = this.renderer;
    r.getSize(this._size);
    const pr = r.getPixelRatio();
    const w = Math.max(1, Math.floor(this._size.x * pr));
    const h = Math.max(1, Math.floor(this._size.y * pr));
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: msaa });
    const composer = new EffectComposer(r, target);
    composer.setPixelRatio(pr);
    composer.setSize(this._size.x, this._size.y);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (bloom) {
      // Limiar alto: só as cores HDR dos elementos neon entram no bloom.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.55, 0.5);
      composer.addPass(this.bloom);
    }
    this.final = new ShaderPass(FinalShader);
    composer.addPass(this.final);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setSize(width, height) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  triggerFlash(amount = 0.35) { this.flash = Math.max(this.flash, amount); }

  render(dt, { crt, boostFx = 0, speedN = 0 }) {
    const u = this.final.uniforms;
    this.flash *= Math.exp(-6 * dt);
    u.uFlash.value = this.flash;
    u.uAberration.value = (crt ? 0.0022 : 0) + boostFx * 0.004;
    u.uScanlines.value = crt ? 0.13 : 0;
    u.uVignette.value = crt ? 0.62 : 0.4;
    u.uWarp.value = Math.max(0, speedN - 0.75) * 0.22 + boostFx * 0.16;
    if (this.bloom) this.bloom.strength = 0.6 + boostFx * 0.2;
    this.composer.render(dt);
  }
}
