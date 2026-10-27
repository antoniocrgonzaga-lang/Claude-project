// =============================================================
// materials.js — cache de materiais.
//
// Cada material novo custa memória e pode obrigar a placa de vídeo a
// compilar um shader. Aqui guardamos os materiais já criados: pedir
// duas vezes "pedra cinza" devolve o MESMO material.
//
// ATENÇÃO: como o material é compartilhado, não mude a cor dele em um
// objeto específico (mudaria em todos). Para isso, peça outro material.
// =============================================================
import * as THREE from 'three';
import { getTexture } from './textures.js';

const cache = new Map();

// Material com textura gerada por código (textures.js). A cor multiplica a textura:
// texturas em tons de cinza (pedra, madeira...) ficam com a cor da peça.
export function getTexturedMaterial(textureName, color = 0xffffff, options = {}) {
  const key = 'tex|' + textureName + '|' + color + '|' + JSON.stringify(options);
  let material = cache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, map: getTexture(textureName), roughness: 0.9, metalness: 0.02, ...options });
    cache.set(key, material);
  }
  return material;
}

// Material com iluminação (reage às luzes da cena)
export function getStandardMaterial(color, options = {}) {
  const key = 'std|' + color + '|' + JSON.stringify(options);
  let material = cache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...options });
    cache.set(key, material);
  }
  return material;
}

// Material sem iluminação (cor "chapada", bom para efeitos e barras de vida)
export function getBasicMaterial(color, options = {}) {
  const key = 'basic|' + color + '|' + JSON.stringify(options);
  let material = cache.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, ...options });
    cache.set(key, material);
  }
  return material;
}

// Material invisível, usado nas "caixas de clique" (hitboxes).
// O raycaster continua acertando a malha mesmo ela não sendo desenhada.
export const INVISIBLE_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
