#!/usr/bin/env node
/* ==========================================================================
   build.js — gera a versão em ARQUIVO ÚNICO do NEON HYPERDRIVE 2
   (adaptado do tools/build.js do Echo Star)
   --------------------------------------------------------------------------
   O jogo é feito de módulos ES (import/export), que os navegadores só
   carregam por um servidor, nunca por file:// (duplo clique). Este script
   lê o index.html e embute nele:

     - o CSS;
     - todos os módulos de src/ e o Three.js de vendor/three, com os imports
       reescritos para nomes fixos ("nh2/src/Config.js" etc.);
     - um pequeno carregador que transforma cada módulo numa Blob URL e monta
       um import map apontando para elas, antes de o jogo começar.

   Resultado: dist/neon-hyperdrive-2.html, o jogo inteiro num arquivo só,
   que abre com duplo clique e funciona offline.

   Uso (dentro de projects/neon-hyperdrive-2):
       node tools/build.js

   Rode de novo sempre que mudar src/, style.css, vendor/ ou index.html.
   Não precisa instalar nada — só o Node.js.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Prefix of the module names in the single file's import map. It must not
// start with "./" or "/" nor look like "scheme:" (the browser would treat it as a URL).
const ID_PREFIX = 'nh2/';
const ENTRY = 'src/main.js';

let html = read('index.html');

// ---------------------------------------------------------------- import map
// "three" and "three/addons/…" are resolved with the SAME import map as
// index.html, so there is only one place to change the Three.js version.
const mapMatch = html.match(/<script\s+type="importmap"\s*>([\s\S]*?)<\/script>\s*/);
if (!mapMatch) throw new Error('index.html has no <script type="importmap">');
const importMap = JSON.parse(mapMatch[1]).imports;
html = html.replace(mapMatch[0], '');

/** Path (relative to the project folder) of the module that "spec" points to from inside "from". */
function resolve(spec, from) {
  let target = null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    target = path.posix.join(path.posix.dirname(from), spec);
  } else if (importMap[spec]) {
    target = path.posix.normalize(importMap[spec]);
  } else {
    // longest prefix ending in "/" (e.g. "three/addons/")
    const key = Object.keys(importMap).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key) target = path.posix.normalize(importMap[key] + spec.slice(key.length));
  }
  if (!target || !exists(target)) throw new Error(`Cannot find module "${spec}" imported from ${from}`);
  return target;
}

// ------------------------------------------------------------------- modules
// import … from '…' · export … from '…' · import '…'  (no dynamic import())
const IMPORT_RE = /\b(import|export)(\s*[\w$*{}\s,]*?\s*from\s*|\s*)(['"])([^'"\r\n]+)\3/g;

const modules = new Map();   // path → rewritten source
(function collect(file) {
  if (modules.has(file)) return;
  modules.set(file, null);   // mark first (guards against circular imports)
  const deps = [];
  const code = read(file).replace(IMPORT_RE, (all, kw, mid, q, spec) => {
    const dep = resolve(spec, file);
    deps.push(dep);
    return kw + mid + q + ID_PREFIX + dep + q;
  });
  modules.set(file, code);
  deps.forEach(collect);
})(ENTRY);

// JSON with "<" escaped: no "</script>" or "<!--" in the code can close the tag early.
const modulesJson = JSON.stringify(Object.fromEntries([...modules].map(([f, code]) => [ID_PREFIX + f, code])))
  .replace(/</g, '\\u003c');

const loader = `<script>
/* Carregador do arquivo único (gerado por tools/build.js — não edite aqui).
   Cada módulo vira uma Blob URL; o import map liga os nomes "nh2/…" a elas. */
window.__singleFile = true; // avisa o main.js que file:// é permitido aqui
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
<script type="module">import '${ID_PREFIX}${ENTRY}';</script>`;

// The entry <script type="module"> is replaced by the loader. The entry is
// still a parser-inserted module (not injected), so the browser runs it
// before DOMContentLoaded — which is when the game boots.
const entryTag = /<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/;
const entryMatch = html.match(entryTag);
if (!entryMatch || path.posix.normalize(entryMatch[1]) !== ENTRY) throw new Error(`index.html should load <script type="module" src="${ENTRY}">`);
html = html.replace(entryTag, () => loader);

// ------------------------------------------------------------------------ CSS
// <link rel="stylesheet" href="x.css">  ->  <style>…</style>, with url(...)
// fonts/images turned into data: URIs (paths relative to the .css file).
const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_, href) => {
  const css = read(href).replace(/url\((['"]?)([^'")]+)\1\)/g, (all, q, url) => {
    if (/^(data:|https?:|#)/.test(url)) return all;
    const file = path.posix.join(path.posix.dirname(href), url);
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`Unknown file type in ${href}: ${url}`);
    return `url(data:${mime};base64,${fs.readFileSync(path.join(root, file)).toString('base64')})`;
  });
  return '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>';
});

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'neon-hyperdrive-2.html');
fs.writeFileSync(out, html);
console.log(`Built: ${path.relative(process.cwd(), out)} (${Math.round(Buffer.byteLength(html) / 1024)} KB, ${modules.size} modules)`);
