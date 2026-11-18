import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Cor HDR: valores acima de 1 alimentam o bloom apenas nos elementos neon. */
export function neon(hex, intensity = 1.6) {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

export class EventBus {
  constructor() { this.handlers = new Map(); }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) { this.handlers.get(type)?.delete(fn); }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (err) { console.error(`[evento ${type}]`, err); }
    }
  }
}

const TEXTURE_KEYS = ['map', 'emissiveMap', 'alphaMap'];

/** Libera geometrias, materiais e texturas de uma subárvore (exceto recursos marcados como compartilhados). */
export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat.userData.shared) continue;
        for (const key of TEXTURE_KEYS) {
          const tex = mat[key];
          if (tex && !tex.userData.shared) tex.dispose();
        }
        mat.dispose();
      }
    }
    if (obj.isInstancedMesh) obj.dispose();
  });
}

export function canvasTexture(width, height, draw, { repeatX = 1, repeatY = 1, anisotropy = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  return tex;
}
