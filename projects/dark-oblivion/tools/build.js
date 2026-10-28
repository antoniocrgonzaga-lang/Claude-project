#!/usr/bin/env node
/* =============================================================
   build.js — gera a versão de ARQUIVO ÚNICO do Dark Oblivion.

   O jogo é feito de módulos ES (import/export), e o navegador se recusa a
   carregar módulos abertos direto do arquivo (file://, duplo clique). Este
   script contorna isso: lê o index.html e embute nele

     - o CSS (e a fonte de vendor/fonts, como data: URI);
     - todos os módulos de js/ e o Three.js de vendor/three, com os imports
       trocados por nomes fixos ("dark/js/config.js" etc.);
     - os modelos de assets/models (.vrm/.glb), como data: URI, numa tabela
       DARK_OBLIVION_FILES que o js/core/assets.js consulta antes de buscar
       o arquivo na pasta;
     - um carregador minúsculo que transforma cada módulo num Blob URL e monta
       um import map apontando para eles, antes de o jogo começar.

   O resultado, dist/dark-oblivion.html, é o jogo inteiro num arquivo só:
   abre com duplo clique e funciona offline. É grande (~30 MB) porque leva
   os modelos junto.

   Uso (dentro de projects/dark-oblivion):
       node tools/build.js

   Rode de novo sempre que mexer em js/, css/, vendor/, assets/ ou index.html.
   Não precisa instalar nada — só o Node.js.
   ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Prefixo dos nomes dos módulos no import map do arquivo único. Não pode começar
// com "./" nem "/" nem parecer "esquema:" (o navegador acharia que é um endereço).
const ID_PREFIX = 'dark/';
const ENTRY = 'js/main.js';
const MODELS_DIR = 'assets/models';

let html = read('index.html');

// ---------------------------------------------------------------- import map
// "three" e "three/addons/…" são resolvidos com o MESMO import map do
// index.html: a versão do Three.js só precisa ser trocada num lugar.
const mapMatch = html.match(/<script\s+type="importmap"\s*>([\s\S]*?)<\/script>\s*/);
if (!mapMatch) throw new Error('O index.html não tem <script type="importmap">');
const importMap = JSON.parse(mapMatch[1]).imports;
html = html.replace(mapMatch[0], '');

/** Caminho (relativo à pasta do projeto) do módulo que "spec" indica, importado de dentro de "from". */
function resolve(spec, from) {
  let target = null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    target = path.posix.join(path.posix.dirname(from), spec);
  } else if (importMap[spec]) {
    target = path.posix.normalize(importMap[spec]);
  } else {
    // o prefixo mais longo terminado em "/" (ex.: "three/addons/")
    const key = Object.keys(importMap).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key) target = path.posix.normalize(importMap[key] + spec.slice(key.length));
  }
  if (!target || !exists(target)) throw new Error(`Não achei o módulo "${spec}" importado em ${from}`);
  return target;
}

// ------------------------------------------------------------------- módulos
// import … from '…' · export … from '…' · import '…'  (sem import() dinâmico)
const IMPORT_RE = /\b(import|export)(\s*[\w$*{}\s,]*?\s*from\s*|\s*)(['"])([^'"\r\n]+)\3/g;

const modules = new Map();   // caminho → código reescrito
(function collect(file) {
  if (modules.has(file)) return;
  modules.set(file, null);   // marca antes (protege contra imports circulares)
  const deps = [];
  const code = read(file).replace(IMPORT_RE, (all, kw, mid, q, spec, offset, src) => {
    // Exemplos de import escritos em COMENTÁRIOS (ex.: no game.js) ficam como estão
    const line = src.slice(src.lastIndexOf('\n', offset) + 1, offset);
    if (line.includes('//') || /^\s*(\*|\/\*)/.test(line)) return all;
    const dep = resolve(spec, file);
    deps.push(dep);
    return kw + mid + q + ID_PREFIX + dep + q;
  });
  modules.set(file, code);
  deps.forEach(collect);
})(ENTRY);

// JSON com "<" escapado: nenhum "</script>" ou "<!--" do código fecha a tag antes da hora.
const toScriptJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const modulesJson = toScriptJson(Object.fromEntries([...modules].map(([f, code]) => [ID_PREFIX + f, code])));

// ------------------------------------------------------------------- modelos
// Mesmo caminho usado em js/data/models.js (ex.: "assets/models/witch.vrm").
const MODEL_MIME = { '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
const files = {};
let modelBytes = 0;
for (const name of fs.readdirSync(path.join(root, MODELS_DIR)).sort()) {
  const mime = MODEL_MIME[path.extname(name).toLowerCase()];
  if (!mime) continue;
  const data = fs.readFileSync(path.join(root, MODELS_DIR, name));
  modelBytes += data.length;
  files[`${MODELS_DIR}/${name}`] = `data:${mime};base64,${data.toString('base64')}`;
}

const loader = `<script>
/* Carregador do arquivo único (gerado por tools/build.js — não edite aqui).
   Cada módulo vira um Blob URL; o import map liga os nomes "dark/…" a eles. */
(function () {
  var mods = ${modulesJson};
  var imports = {};
  for (var id in mods) imports[id] = URL.createObjectURL(new Blob([mods[id]], { type: 'text/javascript' }));
  var map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({ imports: imports });
  document.currentScript.after(map);
})();
</script>
<script>
/* Modelos 3D embutidos (lidos por js/core/assets.js). */
window.DARK_OBLIVION_FILES = ${toScriptJson(files)};
</script>
<script type="module">import '${ID_PREFIX}${ENTRY}';</script>`;

// A tag <script type="module"> de entrada é trocada pelo carregador. A entrada
// continua sendo um módulo do próprio HTML (não injetado), então o navegador a
// executa antes do DOMContentLoaded, como no index.html.
const entryTag = /<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/;
const entryMatch = html.match(entryTag);
if (!entryMatch || path.posix.normalize(entryMatch[1]) !== ENTRY) throw new Error(`O index.html deveria carregar <script type="module" src="${ENTRY}">`);
html = html.replace(entryTag, () => loader);

// ------------------------------------------------------------------------ CSS
// <link rel="stylesheet" href="x.css">  ->  <style>…</style>, com as fontes e
// imagens de url(...) viradas data: URI (caminhos relativos ao .css).
const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_, href) => {
  const css = read(href).replace(/url\((['"]?)([^'")]+)\1\)/g, (all, q, url) => {
    if (/^(data:|https?:|#)/.test(url)) return all;
    const file = path.posix.join(path.posix.dirname(href), url);
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`Tipo de arquivo desconhecido em ${href}: ${url}`);
    return `url(data:${mime};base64,${fs.readFileSync(path.join(root, file)).toString('base64')})`;
  });
  return '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>';
});

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'dark-oblivion.html');
fs.writeFileSync(out, html);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`Gerado: ${path.relative(process.cwd(), out)} (${mb(Buffer.byteLength(html))} MB: ${modules.size} módulos, ${Object.keys(files).length} modelos com ${mb(modelBytes)} MB)`);
