#!/usr/bin/env node
/* ==========================================================================
   test-ground.js — Confere se a altura do chão (planet.groundAt) bate com a
   malha 3D que aparece na tela.
   --------------------------------------------------------------------------
   Para cada tipo de planeta, sorteia milhares de direções, faz um raycast
   "de verdade" do Three.js contra o terreno e compara com groundAt().
   Se alguém mudar a geração do terreno e esquecer de manter as duas coisas
   iguais, o personagem/nave passaria a flutuar ou afundar — este teste avisa.

   Uso (na pasta projects/echo-star):   node tools/test-ground.js
   Não precisa instalar nada.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

// Ambiente mínimo para rodar os scripts do navegador dentro do Node.
const ctx = { console, Math, Float32Array, Uint8Array };
ctx.window = ctx;
ctx.document = { createElement: () => ({ getContext: () => ({}) }) };
vm.createContext(ctx);
for (const f of ['vendor/three.min.js', 'js/utils.js', 'js/planet.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const { THREE, ES } = ctx;

const TOLERANCIA = 1e-3;     // diferença máxima aceita (em unidades do jogo)
let falhou = false;

for (const tipo of Object.keys(ES.PLANET_TYPES)) {
  const planeta = new ES.Planet({
    scene: new THREE.Scene(), seed: 1234, typeKey: tipo, name: 'Teste',
    center: new THREE.Vector3(0, 0, 0), radius: 60, sunDir: new THREE.Vector3(1, 0, 0), withRing: false,
  });
  planeta.group.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster();
  const rng = ES.makeRng(99);
  const dir = new THREE.Vector3();
  let piorErro = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    rng.unit(dir);
    const esperado = planeta.groundAt(dir).terrainR;
    raycaster.set(dir.clone().multiplyScalar(200), dir.clone().negate());
    const hit = raycaster.intersectObject(planeta.terrain)[0];
    piorErro = Math.max(piorErro, Math.abs(hit.point.length() - esperado));
  }
  const ok = piorErro < TOLERANCIA;
  falhou = falhou || !ok;
  console.log((ok ? 'OK    ' : 'FALHOU') + ' ' + tipo.padEnd(9) + ' pior erro: ' + piorErro.toExponential(2) + '  (' + N + ' amostras)');
}

process.exit(falhou ? 1 : 0);
