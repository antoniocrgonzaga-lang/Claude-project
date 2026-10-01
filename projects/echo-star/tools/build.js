#!/usr/bin/env node
/* ==========================================================================
   build.js — Gera a versão em UM ÚNICO arquivo HTML do Echo Star
   --------------------------------------------------------------------------
   Lê index.html e embute dentro dele o CSS e todos os scripts (inclusive o
   Three.js), criando  dist/echo-star.html .  Esse arquivo sozinho já é o jogo
   inteiro: pode ser copiado, enviado ou aberto com duplo clique.

   Uso (dentro da pasta projects/echo-star):
       node tools/build.js

   Rode de novo sempre que mexer em js/, css/ ou index.html.
   Não precisa instalar nada — só o Node.js.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let html = read('index.html');

// <link rel="stylesheet" href="x.css">  ->  <style>…</style>
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_, href) => {
  return '<style>\n' + read(href) + '\n</style>';
});

// <script src="x.js"></script>  ->  <script>…</script>
html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (_, src) => {
  // "</script" dentro de um texto de script fecharia a tag antes da hora.
  const code = read(src).replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + code + '\n</script>';
});

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'echo-star.html');
fs.writeFileSync(out, html);
console.log('Gerado: ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' KB)');
