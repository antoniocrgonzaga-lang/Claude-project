# Combinados deste repositório

Este arquivo é lido pelo Claude no início de cada sessão. Mantenha-o curto e atualizado.

## Sobre o dono

- Projetos por diversão (protótipos, jogos, experimentos). Nada crítico.
- Fala **português do Brasil**.

## Idioma

- **Tudo em português do Brasil**: READMEs, comentários no código, mensagens de commit, textos que aparecem nos jogos/apps.
- Nomes de variáveis, funções e arquivos de código: em inglês (padrão do mercado), exceto se o projeto já seguir outra convenção.

## Organização

- Cada projeto vive em `projects/<nome-em-kebab-case>/` com um `README.md` próprio contendo: o que é, como abrir/jogar, controles/uso, estrutura de arquivos e ideias para expandir.
- Ao **criar, renomear ou remover** um projeto, atualize a tabela de projetos no `README.md` da raiz.
- Não deixe arquivos soltos na raiz além de `README.md`, `CLAUDE.md`, `.gitignore` e `.nojekyll` (GitHub Pages).
- Coisas temporárias (rascunhos de teste, capturas de tela) **não** vão para o repositório.

## Projetos web / jogos

- Prefira o que abre **com duplo clique** em `index.html`, sem servidor: scripts clássicos (`<script src>`), sem módulos ES, sem CDN.
- Bibliotecas de terceiros ficam copiadas em `vendor/` (com a licença), para funcionar offline e não quebrar se um CDN mudar.
- Deixe sempre uma versão de **arquivo único** em `dist/` quando for simples gerar (ver `tools/build.js` do Echo Star).
- Comente o código para quem for expandir depois; destaque os "botões de ajuste" (constantes `CFG`) no topo dos arquivos.

## Echo Star (`projects/echo-star/`)

- **Exceção de idioma: o Echo Star é todo em inglês** (é para os clientes do dono no Second Life):
  textos do jogo, comentários, README, ferramentas e mensagens de commit que mexem nele.
- Usa **módulos ES** (exceção à regra dos scripts clássicos): `index.html` só abre por servidor
  (`start.bat` / `python serve.py 8080`). O arquivo único `dist/echo-star.html` abre com duplo clique.
- Three.js r160 e as fontes ficam em `vendor/` (sem CDN). Todos os números de balanceamento estão em `js/config.js`.
- Depois de mexer em `js/`, `css/`, `vendor/` ou `index.html`, rode `node tools/build.js` e **commite o `dist/echo-star.html` atualizado** junto.
- Testes (rodar antes de commitar mudanças no jogo; precisam do Playwright):
  - `node tools/smoke-test.js` — joga uma partida curta no `dist/` (voar, pousar, andar, coletar, construir, decolar, salvar).
  - `node tools/smoke-test.js --dev` — o mesmo no `index.html`, por um servidor local.
  - `node tools/touch-test.js` — joga com os dedos num tablet e num celular emulados.
- Controles de toque (`js/touch.js`): no tablet aparecem **sempre**, mesmo com teclado conectado
  (o teclado do dono não tem trackpad). No PC sem tela de toque nunca aparecem. Não quebrar essa regra.
- Link público (GitHub Pages, branch `main`): https://antoniocrgonzaga-lang.github.io/Claude-project/projects/echo-star/
- O jogo fica exposto em `window.game` (útil para testes e depuração no console).

## Git

- Mensagens de commit curtas, em português, no imperativo (ex.: "Adiciona pulso de eco") — exceto no Echo Star (inglês, ex.: "Add echo pulse").
- Só abrir Pull Request quando o dono pedir.

## Segurança

- **Nunca** colocar tokens, senhas ou chaves no repositório nem pedir que o dono as cole no chat.
  O Claude já acessa este repositório pela integração do GitHub; não é preciso token.
