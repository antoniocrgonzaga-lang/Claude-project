/**
 * Planet beauty effects (visual only — nothing here touches gameplay).
 *
 *  buildClouds()     – low-poly cloud puffs drifting around a planet, casting
 *                      shadows; they fade out when the camera gets close.
 *  buildRing()       – a ring of tumbling rocks + banded dust on some planets.
 *  WeatherParticles  – one particle cloud that follows the camera on a planet's
 *                      surface: pollen / fireflies, dust, snow, embers, spores.
 *
 * Every feature uses its own seeded RNG, so adding them never changes where
 * resources or trees are generated (saves stay valid). Numbers: CONFIG.fx.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, hashSeed, smoothstep, anyPerpendicular, quatFromUpForward } from './utils.js';
import { part, merge, makeInstanced } from './geometry.js';
import { SUN_DIR } from './space.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Shared by every cloud material: distance at which clouds have faded out (set each frame by the game). */
export const CLOUD_FADE = { value: CONFIG.fx.cloudFadeNear };
const CLOUD_MESHES = [];
let cloudShadows = true;

/**
 * Cloud shadows on / off (off in build mode, where the clouds above the
 * colony are faded out and their shadows would be dark blobs from nowhere).
 */
export function setCloudShadows(on) {
  if (on === cloudShadows) return;
  cloudShadows = on;
  for (const mesh of CLOUD_MESHES) mesh.castShadow = on;
}

// ================================================================ clouds
/** One cloud: a row of flattened icosahedron puffs, biggest in the middle. */
function cloudGeometry(rng) {
  const n = rng.int(4, 7);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    const r = rng.range(1.7, 2.6) * (1.25 - Math.abs(k) / n);
    parts.push(part(new THREE.IcosahedronGeometry(r, 0), 0xffffff, {
      x: k * 2.3 + rng.range(-0.4, 0.4), y: rng.range(0, 0.9) * (1 - Math.abs(k) / n), z: rng.range(-1, 1),
      sy: rng.range(0.45, 0.6), ry: rng.range(0, 3),
    }));
  }
  // a second, smaller row gives the cloud some depth
  for (let i = 0; i < Math.floor(n / 2); i++) {
    parts.push(part(new THREE.IcosahedronGeometry(rng.range(1.2, 1.9), 0), 0xffffff, {
      x: rng.range(-n, n), y: rng.range(0.2, 0.9), z: rng.range(1.2, 2.2) * (rng.chance(0.5) ? 1 : -1), sy: 0.5,
    }));
  }
  return merge(parts);
}

/**
 * Cloud material: fades out near the camera, and is darkened on the night
 * side of its planet (so the camera's night lamp can't light clouds up).
 */
function cloudMaterial(c, planet) {
  const mat = new THREE.MeshStandardMaterial({
    color: c.color, emissive: c.emissive ?? 0x000000, roughness: 1, flatShading: true,
    transparent: true, opacity: c.opacity ?? 0.94, depthWrite: false,
  });
  const center = { value: planet.position }, sunDir = { value: SUN_DIR };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uFadeNear: CLOUD_FADE, uCenter: center, uSunDir: sunDir });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCamDist;\nvarying vec3 vCloudWorld;')
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
        vCamDist = -mvPosition.z;
        vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
        vCloudWorld = (modelMatrix * cw).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFadeNear;\nuniform vec3 uCenter;\nuniform vec3 uSunDir;\nvarying float vCamDist;\nvarying vec3 vCloudWorld;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= smoothstep(uFadeNear * 0.45, uFadeNear, vCamDist);')
      .replace('#include <tonemapping_fragment>', /* glsl */`
        gl_FragColor.rgb *= mix(0.1, 1.0, smoothstep(-0.3, 0.25, dot(normalize(vCloudWorld - uCenter), uSunDir)));
        #include <tonemapping_fragment>`);
  };
  mat.customProgramCacheKey = () => 'echo-cloud';
  return mat;
}

/**
 * Clouds of a planet, grouped in a few weather systems. The whole layer
 * slowly turns around a random axis. Returns { group, update(dt) } or null.
 */
export function buildClouds(planet) {
  const F = CONFIG.fx, c = planet.biome.clouds;
  if (!F.clouds || !c || c.cover <= 0) return null;
  const rng = new RNG(hashSeed(planet.seed, 505));
  const count = Math.round(F.cloudsPerPlanet * c.cover * (planet.radius / 80) ** 2);
  const group = new THREE.Group();
  group.name = 'clouds';
  const mat = cloudMaterial(c, planet);
  const variants = [0, 1, 2].map(() => ({ geo: cloudGeometry(rng), list: [] }));
  // weather systems: clouds cluster around a few centres
  const centres = Array.from({ length: Math.max(3, Math.round(count / 5)) }, () => rng.unitVector());
  const top = planet.radius + planet.amplitude;
  for (let i = 0; i < count; i++) {
    const centre = rng.pick(centres);
    const dir = centre.clone().addScaledVector(rng.unitVector(), rng.range(0, 0.35)).normalize();
    const pos = dir.clone().multiplyScalar(top + rng.range(F.cloudAltitude[0], F.cloudAltitude[1]));
    const fwd = anyPerpendicular(dir, new THREE.Vector3()).applyAxisAngle(dir, rng.range(0, Math.PI * 2));
    const s = rng.range(0.8, 1.5);
    const m = new THREE.Matrix4().compose(pos, quatFromUpForward(dir, fwd), new THREE.Vector3(s * rng.range(1, 1.5), s, s));
    rng.pick(variants).list.push({ m, shade: rng.range(0.9, 1.02) });
  }
  const col = new THREE.Color();
  for (const v of variants) {
    if (!v.list.length) continue;
    const mesh = makeInstanced(v.geo, mat, v.list.length, { castShadow: true, receiveShadow: false });
    v.list.forEach((it, k) => { mesh.setMatrixAt(k, it.m); mesh.setColorAt(k, col.setScalar(it.shade)); });
    mesh.renderOrder = 2;
    mesh.castShadow = cloudShadows;
    CLOUD_MESHES.push(mesh);
    group.add(mesh);
  }
  planet.group.add(group);
  const axis = rng.unitVector();
  const speed = F.cloudDrift / (top + F.cloudAltitude[1]);
  return { group, update(dt) { group.rotateOnAxis(axis, speed * dt); } };
}

// ================================================================== rings
const RING_VERT = /* glsl */`
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const RING_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uInner, uOuter, uSeed, uGap;
  varying vec3 vPos;
  void main() {
    float t = (length(vPos.xy) - uInner) / (uOuter - uInner);
    float bands = 0.55 + 0.25 * sin(t * 41.0 + uSeed) + 0.2 * sin(t * 17.0 + uSeed * 2.3);
    float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float gap = smoothstep(0.015, 0.045, abs(t - uGap));
    gl_FragColor = vec4(uColor, bands * edge * gap * 0.32);
  }`;

/** Ring of rocks and dust around some planets (never the home world). Returns { group, update } or null. */
export function buildRing(planet) {
  if (planet.index === 0) return null;
  const rng = new RNG(hashSeed(planet.seed, 606));
  if (!rng.chance(CONFIG.fx.ringChance)) return null;
  const R = planet.radius;
  const inner = R * rng.range(2.0, 2.3), outer = inner + R * rng.range(0.6, 1.0);
  const gapT = rng.range(0.45, 0.7);
  const group = new THREE.Group();
  group.name = 'ring';
  group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(rng.range(-0.45, 0.45), 1, rng.range(-0.45, 0.45)).normalize());

  // tumbling rocks (instance colours from the planet's own stone + some ice)
  const rockGeo = merge([part(new THREE.IcosahedronGeometry(1, 0), 0xffffff, { sy: 0.7 })]);
  const count = Math.round(1300 * R / 80);
  const rocks = makeInstanced(rockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
    count, { castShadow: false, receiveShadow: false });
  const base = new THREE.Color(planet.biome.rock), ice = new THREE.Color(0xd8e6f0), col = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < count * 2 && n < count; i++) {
    const t = (rng.random() + rng.random()) / 2;          // denser towards the middle
    if (Math.abs(t - gapT) < 0.045) continue;            // keep the gap clear
    const a = rng.range(0, Math.PI * 2), r = inner + (outer - inner) * t;
    p.set(Math.cos(a) * r, rng.range(-1, 1) * 1.2, Math.sin(a) * r);
    const size = 0.3 + Math.pow(rng.random(), 3) * 2.0;
    q.setFromEuler(e.set(rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)));
    rocks.setMatrixAt(n, m.compose(p, q, s.set(size, size * rng.range(0.6, 1), size)));
    rocks.setColorAt(n, rng.chance(0.18) ? ice : col.copy(base).multiplyScalar(rng.range(0.7, 1.25)));
    n++;
  }
  rocks.count = n;
  group.add(rocks);

  // banded dust disc
  const dust = new THREE.Mesh(new THREE.RingGeometry(inner * 0.97, outer * 1.03, 160, 1), new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: base.clone().lerp(new THREE.Color(0xffffff), 0.35) },
      uInner: { value: inner }, uOuter: { value: outer }, uSeed: { value: rng.range(0, 10) }, uGap: { value: gapT },
    },
    vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  dust.rotation.x = -Math.PI / 2;   // RingGeometry lies in XY; the rocks lie in XZ
  group.add(dust);
  planet.group.add(group);
  return { group, update(dt) { rocks.rotation.y += dt * 0.006; } };
}

// ======================================================= weather particles
/**
 * Particle look per biome weather type. color is HDR (values > 1 bloom),
 * rise / drift / wobble are m/s, count is the share of particles in use.
 * Types with day + night switch with the light (pollen ↔ fireflies).
 */
const WEATHER = {
  meadow: {
    day: { color: [1.3, 1.25, 0.8], size: 0.07, rise: 0.05, drift: 0.5, wobble: 0.5, twinkle: 0, count: 0.6, opacity: 0.7 },
    night: { color: [2.4, 3.2, 0.7], size: 0.2, rise: 0.0, drift: 0.15, wobble: 1.1, twinkle: 1, count: 0.6, opacity: 1 },
  },
  dust: { color: [1.1, 0.9, 0.65], size: 0.07, rise: 0.08, drift: 3.6, wobble: 0.4, twinkle: 0, count: 0.8, opacity: 0.5 },
  snow: { color: [1.25, 1.3, 1.45], size: 0.11, rise: -1.6, drift: 0.9, wobble: 0.7, twinkle: 0, count: 1, opacity: 0.85 },
  embers: { color: [4.2, 1.4, 0.3], size: 0.09, rise: 1.3, drift: 0.5, wobble: 0.8, twinkle: 1, count: 0.55, opacity: 1 },
  spores: { color: [0.9, 2.4, 2.6], size: 0.11, rise: 0.3, drift: 0.3, wobble: 0.9, twinkle: 1, count: 0.6, opacity: 0.9 },
};

const WEATHER_VERT = /* glsl */`
  attribute float aPhase;
  uniform float uTime, uSize, uScale, uTwinkle;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    gl_PointSize = max(1.0, uSize * uScale / max(d, 0.1));
    float tw = mix(1.0, 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 2.3 + aPhase * 7.0), 2.0), uTwinkle);
    vAlpha = tw * smoothstep(0.4, 1.6, d) * (1.0 - smoothstep(16.0, 24.0, d));
  }`;
const WEATHER_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.0, 0.5, r)) * vAlpha * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }`;

export class WeatherParticles {
  constructor(scene) {
    const n = CONFIG.fx.weatherParticles;
    this.n = n;
    this.box = 48;
    const pos = new Float32Array(n * 3), phase = new Float32Array(n);
    for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * this.box;
    for (let i = 0; i < n; i++) phase[i] = Math.random() * Math.PI * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.u = {
      uColor: { value: new THREE.Color() }, uSize: { value: 0.1 }, uScale: { value: 500 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uTwinkle: { value: 0 },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: WEATHER_VERT, fragmentShader: WEATHER_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.time = 0;
    this._up = new THREE.Vector3(); this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3();
    this._size = new THREE.Vector2();
  }

  /** @param planet planet nearest to the camera · space.air / space.day from SpaceEnvironment */
  update(dt, camera, planet, space, renderer) {
    this.time += dt;
    const air = space.air ?? 0, day = space.day ?? 1;
    const w = planet && air > 0.02 ? WEATHER[planet.biome.weather] : null;
    if (!w) { this.points.visible = false; return; }
    let p = w, fade = 1;
    if (w.day && w.night) {
      const night = 1 - smoothstep(0.15, 0.45, day);
      p = night > 0.5 ? w.night : w.day;
      fade = Math.abs(night * 2 - 1);
    }
    const u = this.u;
    u.uColor.value.setRGB(...p.color);
    u.uSize.value = p.size;
    u.uTwinkle.value = p.twinkle;
    u.uTime.value = this.time;
    u.uOpacity.value = air * fade * p.opacity;
    renderer.getDrawingBufferSize(this._size);
    u.uScale.value = this._size.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.points.visible = u.uOpacity.value > 0.01;
    if (!this.points.visible) return;
    this.points.geometry.setDrawRange(0, Math.floor(this.n * p.count));

    // move: rise along "up", drift with the wind, wobble per particle; wrap around the camera
    const up = this._up.copy(camera.position).sub(planet.position).normalize();
    const t1 = anyPerpendicular(up, this._t1), t2 = this._t2.crossVectors(up, t1);
    const geo = this.points.geometry, arr = geo.attributes.position.array, ph = geo.attributes.aPhase.array;
    const half = this.box / 2, cp = camera.position, T = this.time;
    for (let i = 0, k = 0; i < this.n; i++, k += 3) {
      const a = Math.sin(T * 0.7 + ph[i] * 3.1) * p.wobble, b = Math.cos(T * 0.9 + ph[i] * 1.7) * p.wobble;
      const vx = up.x * p.rise + t1.x * (p.drift + a) + t2.x * b;
      const vy = up.y * p.rise + t1.y * (p.drift + a) + t2.y * b;
      const vz = up.z * p.rise + t1.z * (p.drift + a) + t2.z * b;
      arr[k] += vx * dt; arr[k + 1] += vy * dt; arr[k + 2] += vz * dt;
      for (let c = 0; c < 3; c++) {
        const d = arr[k + c] - (c === 0 ? cp.x : c === 1 ? cp.y : cp.z);
        if (d > half) arr[k + c] -= this.box * Math.ceil((d - half) / this.box);
        else if (d < -half) arr[k + c] += this.box * Math.ceil((-half - d) / this.box);
      }
    }
    geo.attributes.position.needsUpdate = true;
  }
}
