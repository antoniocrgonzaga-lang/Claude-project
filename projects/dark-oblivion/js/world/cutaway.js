// =============================================================
// cutaway.js — paredes "transparentes" entre a câmera e o jogador.
//
// Como funciona: pegamos o material normal da parede e acrescentamos
// um trechinho no shader (o programa da placa de vídeo que pinta cada
// pixel). Para cada pixel da parede, ele mede:
//   - "along": se o pixel está MAIS PERTO da câmera que o jogador
//     (ou seja, na frente dele);
//   - "perp":  a distância do pixel até a linha câmera→jogador.
// Se o pixel está na frente e perto dessa linha, ele é descartado.
//
// Em vez de transparência de verdade (que dá problemas de ordem de
// desenho), usamos "pontilhado": descartamos parte dos pixels num
// padrão (matriz de Bayer 4x4). O resultado parece um vidro rachado
// e é barato para a placa de vídeo.
//
// Uso: mesh.material = getCutawayMaterial(mesh.material)
//      ou applyCutaway(objeto3D) para trocar em todos os filhos.
//      Todo quadro: updateCutaway(camera, posiçãoDoJogador)
// =============================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Valores compartilhados por TODOS os materiais com recorte
const uniforms = {
  uCutCenter: { value: new THREE.Vector3() },
  uCutDir: { value: new THREE.Vector3(0, -1, 0) },
  uCutRadius: { value: CONFIG.cutaway.radius },
  uCutStrength: { value: CONFIG.cutaway.strength },
};

const cache = new Map(); // material original → versão com recorte (criada uma vez só)

export function getCutawayMaterial(original) {
  let material = cache.get(original);
  if (material) return material;

  material = original.clone();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // Vertex shader: calcula a posição de cada ponto no MUNDO e passa para o fragment
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cutWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutWorld = instanceMatrix * cutWorld;
        #endif
        vCutWorld = (modelMatrix * cutWorld).xyz;`);

    // Fragment shader: decide se descarta o pixel
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCutWorld;
        uniform vec3 uCutCenter;
        uniform vec3 uCutDir;
        uniform float uCutRadius;
        uniform float uCutStrength;
        const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                                          3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec3 v = vCutWorld - uCutCenter;
          float along = -dot(v, uCutDir);        // > 0: pixel está entre o jogador e a câmera
          float perp = length(v + along * uCutDir); // distância até a linha de visão
          float fade = (1.0 - smoothstep(uCutRadius * 0.55, uCutRadius, perp))
                     * smoothstep(0.2, 1.0, along) * uCutStrength;
          int bi = int(mod(gl_FragCoord.x, 4.0)) + int(mod(gl_FragCoord.y, 4.0)) * 4;
          if (fade * 16.0 > BAYER[bi] + 0.5) discard;
        }`);
  };
  // Diz ao Three.js que esse shader é diferente do material normal
  material.customProgramCacheKey = () => 'cutaway';
  cache.set(original, material);
  return material;
}

// Troca o material de todas as malhas dentro de `object` pela versão com recorte
export function applyCutaway(object) {
  object.traverse((child) => {
    if (child.isMesh && child.material && !Array.isArray(child.material) && child.material.visible !== false) {
      child.material = getCutawayMaterial(child.material);
    }
  });
}

// Chamado todo quadro pelo WorldManager
export function updateCutaway(camera, playerPosition) {
  camera.getWorldDirection(uniforms.uCutDir.value);              // para onde a câmera olha
  uniforms.uCutCenter.value.set(playerPosition.x, 1.0, playerPosition.z); // peito do jogador
}
