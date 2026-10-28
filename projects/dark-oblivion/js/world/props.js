// =============================================================
// props.js — peças reutilizáveis do cenário:
//   - createPortal: anel de pedra + energia girando (shader) + partículas + luz
//   - createTorch:  tocha/braseiro com luz que tremula
//   - makeInteractable: transforma um ponto do mundo em algo clicável
//     (portal, escada, NPC), com etiqueta de nome.
// =============================================================
import * as THREE from 'three';
import { createModel } from '../core/assets.js';
import { INVISIBLE_MATERIAL } from '../core/materials.js';
import { game } from '../game.js';

// ---------------------------------------------------------------
// PORTAL
// O "miolo" do portal usa um ShaderMaterial: um pequeno programa que
// roda na placa de vídeo e calcula a cor de cada pixel do disco.
// Aqui ele desenha um redemoinho que gira com o tempo (uTime).
// ---------------------------------------------------------------
const PORTAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PORTAL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;          // 0 no centro, 1 na borda
    float a = atan(p.y, p.x);           // ângulo
    float swirl = sin(a * 4.0 + r * 9.0 - uTime * 3.0) * 0.5 + 0.5;
    float pulse = sin(uTime * 2.0 - r * 6.0) * 0.5 + 0.5;
    vec3 col = mix(uColorA, uColorB, swirl);
    col += vec3(1.0, 0.85, 0.9) * pow(max(0.0, 1.0 - r), 3.0) * 0.8; // centro mais claro
    float alpha = smoothstep(1.0, 0.8, r) * (0.65 + 0.35 * pulse);
    gl_FragColor = vec4(col * (0.8 + 0.6 * swirl), alpha);
  }
`;

const PORTAL_DISC_GEOMETRY = new THREE.CircleGeometry(1.42, 48);
const PORTAL_GLOW_GEOMETRY = new THREE.CircleGeometry(2.6, 32).rotateX(-Math.PI / 2);

export function createPortal({ colorA = 0xff2040, colorB = 0x7a20ff, lightColor = 0xff3060, scale = 1 } = {}) {
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const ring = createModel('portalRing');
  group.add(ring.root);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: PORTAL_VERTEX,
    fragmentShader: PORTAL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const disc = new THREE.Mesh(PORTAL_DISC_GEOMETRY, material);
  disc.position.y = 2.0;
  group.add(disc);

  // Partículas girando dentro do anel
  const count = 70;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.3 + Math.random() * 1.25;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Com câmera ortográfica o "size" é em pixels
  const particleMaterial = new THREE.PointsMaterial({
    color: lightColor, size: 4, sizeAttenuation: false,
    transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.position.y = 2.0;
  group.add(particles);

  // Brilho no chão
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: lightColor, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(PORTAL_GLOW_GEOMETRY, glowMaterial);
  glow.position.y = 0.03;
  group.add(glow);

  const light = new THREE.PointLight(lightColor, 22, 12, 1.5);
  light.position.set(0, 2, 1);
  group.add(light);

  return {
    group,
    update(t) {
      material.uniforms.uTime.value = t;
      particles.rotation.z = t * 0.8;
      light.intensity = 20 + Math.sin(t * 3) * 5;
    },
    dispose() {
      material.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      glowMaterial.dispose();
      ring.dispose();
    },
  };
}

// ---------------------------------------------------------------
// TOCHA / BRASEIRO com luz tremulando
// ---------------------------------------------------------------
export function createTorch(modelId = 'torch', { light = true, color = 0xff8833, intensity = 12, distance = 10, lightY = 2.4 } = {}) {
  const model = createModel(modelId);
  const group = model.root;
  let pointLight = null;
  if (light) {
    pointLight = new THREE.PointLight(color, intensity, distance, 1.5);
    pointLight.position.y = lightY;
    group.add(pointLight);
  }
  const phase = Math.random() * 100;
  return {
    group,
    update(t) {
      if (!pointLight) return;
      // soma de senos com frequências diferentes = tremulação "natural"
      pointLight.intensity = intensity * (0.85 + Math.sin(t * 9 + phase) * 0.08 + Math.sin(t * 23 + phase) * 0.06);
    },
  };
}

// ---------------------------------------------------------------
// WAYPOINT (portal de retorno fixo a cada 5 andares)
// ---------------------------------------------------------------
export function createWaypoint() {
  const model = createModel('waypoint');
  const group = model.root;
  const light = new THREE.PointLight(0x40c0ff, 10, 8, 1.5);
  light.position.y = 1.4;
  group.add(light);
  return {
    group,
    update(t) {
      light.intensity = 9 + Math.sin(t * 2.5) * 3;
    },
  };
}

// ---------------------------------------------------------------
// INTERAGÍVEIS (portais, escadas, NPCs)
// ---------------------------------------------------------------
const HITBOX_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);

// radius     → distância em que o jogador consegue usar
// hitRadius / hitHeight → tamanho da área de clique
export function makeInteractable({ name, x, z, group, onUse, radius = 2.4, hitRadius = 1, hitHeight = 2, labelHeight = 3, labelColor = '#f0d090' }) {
  const hitbox = new THREE.Mesh(HITBOX_GEOMETRY, INVISIBLE_MATERIAL);
  hitbox.scale.set(hitRadius, hitHeight, hitRadius);
  hitbox.position.set(x, 0, z);
  group.add(hitbox);

  const interactable = {
    name,
    position: new THREE.Vector3(x, 0, z),
    radius,
    hitbox,
    onUse,
    label: game.labels.add({ text: name, color: labelColor, position: { x, y: labelHeight, z }, className: 'label-interact' }),
  };
  hitbox.userData.interactable = interactable;
  return interactable;
}

export function removeInteractable(interactable) {
  interactable.hitbox.removeFromParent();
  game.labels.remove(interactable.label);
}

// Muda o nome (e a etiqueta) de um interagível
export function renameInteractable(interactable, name, color) {
  interactable.name = name;
  interactable.label.el.textContent = name;
  if (color) interactable.label.el.style.color = color;
}

// Converte um ponto local (lx, lz) de um objeto girado em rotY para o mundo
export function localToWorld(x, z, rotY, lx, lz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}
