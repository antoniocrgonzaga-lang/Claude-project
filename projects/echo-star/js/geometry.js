/**
 * Geometry helpers for building blocky, vertex-coloured models.
 *
 * Models (trees, resource nodes, animals) are built from simple parts,
 * each part painted with a flat vertex colour, then merged into ONE
 * BufferGeometry. That single geometry is then drawn many times with an
 * InstancedMesh → one draw call for hundreds of objects.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

/** Convert to non-indexed, drop UVs, and paint every vertex with `color`. */
export function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * Transform + paint any geometry.
 * opts: { x, y, z, rx, ry, rz, sx, sy, sz }
 */
export function part(geo, color, opts = {}) {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = opts;
  if (sx !== 1 || sy !== 1 || sz !== 1) geo.scale(sx, sy, sz);
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return paint(geo, color);
}

/** Shortcut for a coloured box centred at (x, y, z). */
export function box(w, h, d, color, x = 0, y = 0, z = 0, rot = {}) {
  return part(new THREE.BoxGeometry(w, h, d), color, { x, y, z, ...rot });
}

/** Merge a list of painted parts into one geometry. */
export function merge(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

/**
 * Create an InstancedMesh with per-instance colour support.
 * frustumCulled is off because instances are spread around a whole planet.
 */
export function makeInstanced(geometry, material, count, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}
