/**
 * Space environment: procedural skybox (galactic band, nebulae, faint
 * stars — see skybox.js), a starfield of soft twinkling stars in real
 * star colours, bright stars with diffraction spikes, distant galaxies,
 * the sun, lighting, space dust and the sky colour blending used when the
 * camera is inside a planet's atmosphere (day sky vs. starry night).
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, hashSeed, clamp, smoothstep, makeGlowTexture } from './utils.js';
import { bakeSkybox } from './skybox.js';

const SPACE_COLOR = new THREE.Color(0x02030a);
/** Direction from anywhere in the system toward the (very distant) sun. */
export const SUN_DIR = new THREE.Vector3(0.62, 0.22, -0.75).normalize();
/** Normal of the galactic plane: the skybox's band and the extra band stars line up with it. */
const BAND_NORMAL = new THREE.Vector3(0.3, 1, 0.2).normalize();

/** Star colours by temperature (blue giants → red dwarfs) with how common each is. */
const STAR_TYPES = [
  [0x9bb0ff, 0.1], [0xcad7ff, 0.17], [0xf8f7ff, 0.2], [0xfff4ea, 0.22],
  [0xffd2a1, 0.17], [0xffad51, 0.1], [0xff8a6a, 0.04],
];
function starColor(rng, out) {
  let r = rng.random();
  for (const [c, w] of STAR_TYPES) { if ((r -= w) <= 0) return out.set(c); }
  return out.set(0xffffff);
}

const STAR_VERT = /* glsl */`
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio;
    vTwinkle = 0.82 + 0.18 * sin(uTime * (1.3 + fract(aPhase * 7.13) * 3.0) + aPhase * 6.28);
    vColor = aColor;
  }`;
const STAR_FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (exp(-r * r * 10.0) + 0.3 * exp(-r * r * 2.5)) * vTwinkle * uOpacity;   // sharp core + soft halo
    gl_FragColor = vec4(vColor * a, a);
  }`;

/** Glow with four diffraction spikes (bright stars). */
function makeSpikeTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2;
  g.globalCompositeOperation = 'lighter';
  const glow = g.createRadialGradient(h, h, 0, h, h, h * 0.5);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.15, 'rgba(255,255,255,0.6)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  for (const [w, len, alpha] of [[2, h, 0.9], [1, h, 0.6]]) {
    for (const vertical of [true, false]) {
      const grad = vertical ? g.createLinearGradient(h, 0, h, size) : g.createLinearGradient(0, h, size, h);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      if (vertical) g.fillRect(h - w / 2, h - len, w, len * 2); else g.fillRect(h - len, h - w / 2, len * 2, w);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sun corona: smooth falloff with faint radial streaks. */
function makeCoronaTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const rng = new RNG(77);
  for (let i = 0; i < 48; i++) {
    const a = rng.range(0, Math.PI * 2), len = h * rng.range(0.45, 0.95), w = rng.range(0.008, 0.03);
    const ray = g.createLinearGradient(h, h, h + Math.cos(a) * len, h + Math.sin(a) * len);
    ray.addColorStop(0, `rgba(255,255,255,${rng.range(0.08, 0.2)})`);
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(h, h);
    g.arc(h, h, len, a - w, a + w);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A small spiral galaxy: bright bulge + two arms of fuzzy dots. */
function makeGalaxyTexture(rng, tint, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2;
  g.globalCompositeOperation = 'lighter';
  const col = new THREE.Color(tint);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const arms = rng.int(2, 3), twist = rng.range(3, 5);
  for (let i = 0; i < 2600; i++) {
    const t = Math.pow(rng.random(), 0.7);
    const arm = i % arms;
    const ang = (arm / arms) * Math.PI * 2 + t * twist + rng.range(-0.35, 0.35) * (1.2 - t);
    const r = t * h * 0.92;
    const x = h + Math.cos(ang) * r, y = h + Math.sin(ang) * r;
    g.fillStyle = `rgba(${t < 0.25 ? '255,236,210' : rgb},${0.38 * (1 - t) + 0.07})`;
    g.beginPath();
    g.arc(x, y, rng.range(0.6, 1.8), 0, Math.PI * 2);
    g.fill();
  }
  const bulge = g.createRadialGradient(h, h, 0, h, h, h * 0.28);
  bulge.addColorStop(0, 'rgba(255,240,220,0.95)');
  bulge.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = bulge;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SpaceEnvironment {
  constructor(scene, seed, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    const U = CONFIG.universe, L = CONFIG.lighting;
    const rng = new RNG(hashSeed(seed, 9));
    this.sunDir = SUN_DIR.clone();
    this.time = 0;

    // Everything "infinitely far" lives in skyGroup, which follows the camera.
    this.skyGroup = new THREE.Group();
    scene.add(this.skyGroup);
    this._buildSkybox(new RNG(hashSeed(seed, 19)));
    this._buildStars(rng);
    this._buildBrightStars(new RNG(hashSeed(seed, 29)));
    this._buildGalaxies(new RNG(hashSeed(seed, 39)));
    this._buildSun();

    // Lights -----------------------------------------------------------
    this.sunLight = new THREE.DirectionalLight(0xfff1dc, L.sunIntensity);
    this.sunLight.castShadow = CONFIG.render.shadows;
    const s = this.sunLight.shadow;
    s.mapSize.set(CONFIG.render.shadowMapSize, CONFIG.render.shadowMapSize);
    const r = CONFIG.render.shadowRange;
    Object.assign(s.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 500 });
    s.bias = -0.0004;
    s.normalBias = 0.08;
    scene.add(this.sunLight, this.sunLight.target);

    this.ambient = new THREE.AmbientLight(L.ambientColor, L.ambientIntensity);
    scene.add(this.ambient);

    // Lamp that follows the player / ship and switches on at night.
    this.headlamp = new THREE.PointLight(0xffe7c4, 0, L.headlampRange, 1.0);
    scene.add(this.headlamp);

    this._buildDust(rng);

    scene.background = SPACE_COLOR.clone();
    scene.fog = new THREE.FogExp2(SPACE_COLOR.clone(), 0);
    this.skyAmount = 0;
  }

  /** Baked procedural sky (galactic band, nebulae, faint stars), added on top of the background colour. */
  _buildSkybox(rng) {
    const sky = bakeSkybox(this.renderer, rng, BAND_NORMAL, CONFIG.universe.skyboxResolution);
    this.skyUniforms = { tSky: { value: sky.texture }, uFade: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform samplerCube tSky;
        uniform float uFade;
        varying vec3 vDir;
        void main() { gl_FragColor = vec4(textureCube(tSky, normalize(vDir)).rgb * uFade, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.skybox = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.universe.skyRadius * 0.95, 48, 24), mat);
    this.skybox.renderOrder = -10;
    this.skybox.frustumCulled = false;
    this.skyGroup.add(this.skybox);
  }

  /**
   * Point stars: soft round discs in real star colours with a gentle
   * twinkle. Sizes follow a "few bright, many faint" curve; extra stars
   * crowd the galactic band.
   */
  _buildStars(rng) {
    const U = CONFIG.universe;
    const total = U.starCount + U.bandStarCount;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const size = new Float32Array(total), phase = new Float32Array(total);
    const v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < total; i++) {
      rng.unitVector(v);
      const inBand = i >= U.starCount;
      if (inBand) v.addScaledVector(BAND_NORMAL, -v.dot(BAND_NORMAL) * rng.range(0.8, 1)).normalize();
      v.multiplyScalar(U.skyRadius);
      pos.set([v.x, v.y, v.z], i * 3);
      const mag = Math.pow(rng.random(), inBand ? 3.2 : 2.4);      // most stars are faint
      size[i] = 1.4 + mag * 4.2;
      starColor(rng, c).multiplyScalar(0.35 + mag * 1.5);           // bright ones go HDR and bloom a little
      col.set([c.r, c.g, c.b], i * 3);
      phase[i] = rng.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starUniforms = { uTime: { value: 0 }, uOpacity: { value: 1 }, uPixelRatio: { value: this.renderer.getPixelRatio() } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.skyGroup.add(this.stars);
  }

  /** A few dozen bright stars with diffraction spikes. */
  _buildBrightStars(rng) {
    const tex = makeSpikeTexture();
    const c = new THREE.Color();
    this.brightStars = [];
    for (let i = 0; i < CONFIG.universe.brightStars; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      mat.color.copy(starColor(rng, c)).multiplyScalar(rng.range(1.0, 1.8));
      mat.rotation = rng.range(-0.15, 0.15);
      const sp = new THREE.Sprite(mat);
      sp.position.copy(rng.unitVector()).multiplyScalar(CONFIG.universe.skyRadius * 0.98);
      sp.scale.setScalar(rng.range(450, 1200));
      sp.userData.base = 1;
      this.skyGroup.add(sp);
      this.brightStars.push(sp);
    }
  }

  /** Distant spiral galaxies seen at different tilts. */
  _buildGalaxies(rng) {
    const tints = [0x9fb8ff, 0xffc8a0, 0xd0a8ff, 0xa8e8ff];
    this.galaxies = [];
    for (let i = 0; i < CONFIG.universe.galaxies; i++) {
      const mat = new THREE.SpriteMaterial({
        map: makeGalaxyTexture(rng, rng.pick(tints)), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      mat.color.setScalar(1.4);
      mat.rotation = rng.range(0, Math.PI);
      const sp = new THREE.Sprite(mat);
      // keep them out of the bright galactic band
      const d = rng.unitVector();
      d.addScaledVector(BAND_NORMAL, (Math.sign(d.dot(BAND_NORMAL)) || 1) * 0.3).normalize();
      sp.position.copy(d).multiplyScalar(CONFIG.universe.skyRadius * 0.97);
      const s = rng.range(1300, 2300);
      sp.scale.set(s, s * rng.range(0.3, 0.9), 1);
      sp.userData.base = mat.opacity;
      this.skyGroup.add(sp);
      this.galaxies.push(sp);
    }
  }

  /**
   * The sun: a bright disc, a corona with soft rays and a wide faint halo.
   * Only the disc goes much above the bloom threshold — a huge over-bright
   * area makes the bloom's low-resolution passes look square.
   */
  _buildSun() {
    const U = CONFIG.universe;
    const sunMat = new THREE.MeshBasicMaterial({ fog: false });
    sunMat.color.setRGB(2.4, 2.15, 1.75);
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(U.sunSize, 32, 16), sunMat);
    this.sun.position.copy(this.sunDir).multiplyScalar(U.sunDistance);
    this.skyGroup.add(this.sun);

    const sprite = (map, color, scale) => {
      const mat = new THREE.SpriteMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      mat.color.setRGB(...color);
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(scale);
      s.position.copy(this.sun.position);
      this.skyGroup.add(s);
      return s;
    };
    this.sunGlow = sprite(makeCoronaTexture(), [1.15, 0.92, 0.66], U.sunSize * 6);
    this.sunHalo = sprite(makeGlowTexture(256), [0.32, 0.24, 0.16], U.sunSize * 16);
  }

  _buildDust(rng) {
    const n = CONFIG.universe.dustCount;
    this.dustSize = 120;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = rng.range(-this.dustSize / 2, this.dustSize / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xa8b8ff, size: 0.3, map: makeGlowTexture(64), transparent: true, opacity: 0.4, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,   // soft round motes instead of square points
    }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  /**
   * @param camera    active camera
   * @param focus     world position of the player or ship (for shadows / lamp)
   * @param planet    planet nearest to the camera (or null)
   * @param shipSpeed current ship speed (dust visibility)
   */
  update(dt, camera, focus, planet, shipSpeed = 0) {
    this.skyGroup.position.copy(camera.position);

    // --- shadow box & sun direction follow the focus point
    this.sunLight.position.copy(focus).addScaledVector(this.sunDir, 200);
    this.sunLight.target.position.copy(focus);

    // --- sky blend when inside an atmosphere
    let air = 0, day = 1;
    if (planet) {
      const local = camera.position.clone().sub(planet.position);
      const alt = local.length() - planet.radius;
      air = 1 - smoothstep(planet.radius * 0.05, planet.radius * CONFIG.planet.skyFadeAltitude, alt);
      day = smoothstep(-0.25, 0.35, local.normalize().dot(this.sunDir));
      this._tmpSky = this._tmpSky || new THREE.Color();
      const sky = this._tmpSky.copy(planet.skyColor);
      const night = sky.clone().multiplyScalar(0.07);
      sky.lerp(night, 1 - day);
      this.scene.background.copy(SPACE_COLOR).lerp(sky, air);
      this.scene.fog.color.copy(this.scene.background);
      this.scene.fog.density = CONFIG.render.fogDensity * air;
    } else {
      this.scene.background.copy(SPACE_COLOR);
      this.scene.fog.density = 0;
    }
    this.skyAmount = air * day;
    this.air = air;     // read by the audio (wind, planet ambience)
    this.day = day;
    // Stars, nebulae and galaxies fade out under a daylit sky (and twinkle a little).
    const starAlpha = 1 - this.skyAmount * 0.97;
    this.time += dt;
    this.starUniforms.uTime.value = this.time;
    this.starUniforms.uOpacity.value = starAlpha;
    this.starUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.skyUniforms.uFade.value = 1 - this.skyAmount * 0.99;
    for (const s of this.brightStars) s.material.opacity = starAlpha;
    for (const s of this.galaxies) s.material.opacity = s.userData.base * starAlpha;

    // --- night lamp
    const focusNight = planet ? 1 - smoothstep(-0.2, 0.25, focus.clone().sub(planet.position).normalize().dot(this.sunDir)) : 0;
    this.headlamp.intensity = CONFIG.lighting.headlampIntensity * focusNight * air;
    if (planet) {
      // Mounted just above the camera so it lights what the player sees evenly.
      const up = camera.position.clone().sub(planet.position).normalize();
      this.headlamp.position.copy(camera.position).addScaledVector(up, 3);
    }

    // --- space dust wraps around the camera
    const arr = this.dust.geometry.attributes.position.array;
    const h = this.dustSize / 2, cp = camera.position;
    for (let i = 0; i < arr.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? cp.x : a === 1 ? cp.y : cp.z;
        let d = arr[i + a] - c;
        if (d > h) arr[i + a] -= this.dustSize * Math.ceil((d - h) / this.dustSize);
        else if (d < -h) arr[i + a] += this.dustSize * Math.ceil((-h - d) / this.dustSize);
      }
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.material.opacity = clamp(shipSpeed / 80, 0.08, 0.7) * (1 - air);
    this.dust.visible = air < 0.95;
  }
}
