/**
 * Procedural deep-space skybox, baked once into a cube texture.
 *
 * A fragment shader paints, for every direction: a faint blue haze, the
 * galactic band (with a warm core and dark dust lanes), several coloured
 * nebulae (soft clouds + bright filaments + dark globules) and a dense
 * field of tiny background stars. It runs once at start-up through a
 * CubeCamera, so in game the sky is just one texture lookup per pixel.
 */
import * as THREE from 'three';

const NOISE = /* glsl */`
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  // 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT)
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 6; i++) { s += a * snoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
  // sharp bright ridges → nebula filaments
  float ridged(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { float n = 1.0 - abs(snoise(p)); s += a * n * n; p = p * 2.1 + vec3(4.1, 1.3, 7.7); a *= 0.5; }
    return s;
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
`;

const NEBULAE = 5;

const FRAG = /* glsl */`
  uniform vec3 uBand;                    // normal of the galactic plane
  uniform vec3 uCore;                    // direction of the galactic core (in the plane)
  uniform float uSeed;
  uniform vec3 uNebDir[${NEBULAE}];
  uniform vec3 uNebCol[${NEBULAE}];
  uniform vec3 uNebCol2[${NEBULAE}];
  uniform float uNebSize[${NEBULAE}];
  uniform float uNebGain[${NEBULAE}];
  varying vec3 vDir;
  ${NOISE}

  // tiny background stars: one random star per 3D cell, density higher in the band
  vec3 microStars(vec3 d, float scale, float threshold) {
    vec3 q = d * scale;
    vec3 cell = floor(q);
    float h = hash13(cell);
    if (h < threshold) return vec3(0.0);
    vec3 sp = vec3(hash13(cell + 11.1), hash13(cell + 23.7), hash13(cell + 37.3));
    float dist = length(fract(q) - sp);
    float b = (1.0 - smoothstep(0.0, 0.42, dist)) * (0.35 + 0.65 * hash13(cell + 5.9));
    vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.65), hash13(cell + 2.2));
    return tint * b;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.0);

    // faint deep-space haze
    float haze = fbm(d * 1.6 + uSeed);
    col += vec3(0.004, 0.005, 0.012) * (0.6 + 0.4 * haze);

    // galactic band: soft glow, warm bulge toward the core, mottled by star clouds
    float b = dot(d, uBand);
    float band = exp(-b * b * 28.0);
    float core = pow(max(dot(d, uCore), 0.0), 5.0);
    float clouds = 0.35 + 0.65 * smoothstep(-0.3, 0.6, fbm(d * 6.0 + uSeed * 1.7));
    vec3 bandCol = mix(vec3(0.3, 0.36, 0.6), vec3(1.0, 0.78, 0.52), core);
    col += bandCol * band * (0.035 + 0.3 * core) * clouds;
    col += vec3(1.0, 0.85, 0.65) * exp(-b * b * 70.0) * core * 0.25;
    // dark dust lanes along the middle of the band
    float lanes = smoothstep(0.02, 0.45, fbm(d * 8.0 + 11.0 + uSeed)) * exp(-b * b * 85.0);
    col *= 1.0 - 0.8 * lanes;

    // nebulae: soft coloured clouds, glowing filaments, dark globules
    for (int i = 0; i < ${NEBULAE}; i++) {
      float ang = acos(clamp(dot(d, uNebDir[i]), -1.0, 1.0));
      float mask = 1.0 - smoothstep(0.0, uNebSize[i], ang);
      if (mask <= 0.0) continue;
      mask *= mask;
      vec3 q = d * (3.2 / uNebSize[i]) + float(i) * 7.31 + uSeed;
      float n = fbm(q) * 0.5 + 0.5;
      float dens = pow(n, 2.2) * mask;
      float fil = ridged(q * 1.4 + 2.0);
      vec3 c = mix(uNebCol2[i], uNebCol[i], smoothstep(0.25, 0.75, n));
      col += c * dens * 0.55 * uNebGain[i];
      col += uNebCol[i] * pow(fil, 3.0) * mask * 0.35 * uNebGain[i];
      col *= 1.0 - smoothstep(0.58, 0.85, fbm(q * 2.3 + 5.0) * 0.5 + 0.5) * mask * 0.7;
    }

    // dense field of faint stars, richer inside the band
    col += microStars(d, 230.0, 0.972 - band * 0.03) * 0.55;
    col += microStars(d, 520.0, 0.985 - band * 0.05) * 0.28;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Nebula colour pairs (core, outer). */
const PALETTES = [
  [0xff4fa8, 0x6a3cff], [0x3fe0d0, 0x1b4fd8], [0xff8a3a, 0xc8204a],
  [0xb06aff, 0x2a8cff], [0x6aff9a, 0x1f8a9a], [0xff5a5a, 0x7a2aa0],
];

/**
 * Render the sky into a cube texture.
 * @param band  unit normal of the galactic plane (shared with the star points)
 * @returns { texture, dispose() }
 */
export function bakeSkybox(renderer, rng, band, size = 1024) {
  const core = rng.unitVector().projectOnPlane(band).normalize();   // galactic core, in the band
  const dirs = [], cols = [], cols2 = [], sizes = [], gains = [];
  const palettes = rng.shuffle([...PALETTES]);
  for (let i = 0; i < NEBULAE; i++) {
    // nebulae sit near the galactic band, like real emission nebulae
    const d = rng.unitVector();
    d.addScaledVector(band, -d.dot(band) * rng.range(0.55, 0.9)).normalize();
    dirs.push(d);
    cols.push(new THREE.Color(palettes[i % palettes.length][0]));
    cols2.push(new THREE.Color(palettes[i % palettes.length][1]));
    sizes.push(rng.range(0.35, 0.75));
    gains.push(rng.range(0.7, 1.15));
  }

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBand: { value: band }, uCore: { value: core }, uSeed: { value: rng.range(0, 50) },
      uNebDir: { value: dirs }, uNebCol: { value: cols }, uNebCol2: { value: cols2 }, uNebSize: { value: sizes }, uNebGain: { value: gains },
    },
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false,
  });
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 64, 32);
  scene.add(new THREE.Mesh(geo, mat));
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(1, 100, target);
  cam.update(renderer, scene);
  geo.dispose();
  mat.dispose();
  return { texture: target.texture, core, dispose: () => target.dispose() };
}
