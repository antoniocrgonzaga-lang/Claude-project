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
- Não deixe arquivos soltos na raiz além de `README.md`, `CLAUDE.md` e `.gitignore`.
- Coisas temporárias (rascunhos de teste, capturas de tela) **não** vão para o repositório.

## Projetos web / jogos

- Prefira o que abre **com duplo clique** em `index.html`, sem servidor: scripts clássicos (`<script src>`), sem módulos ES, sem CDN.
- Bibliotecas de terceiros ficam copiadas em `vendor/` (com a licença), para funcionar offline e não quebrar se um CDN mudar.
- Deixe sempre uma versão de **arquivo único** em `dist/` quando for simples gerar (ver `tools/build.js` do Echo Star).
- Comente o código para quem for expandir depois; destaque os "botões de ajuste" (constantes `CFG`) no topo dos arquivos.

## Echo Star (`projects/echo-star/`)

- Depois de mexer em `js/`, `css/` ou `index.html`, rode `node tools/build.js` e **commite o `dist/echo-star.html` atualizado** junto.
- Testes (rodar antes de commitar mudanças no jogo):
  - `node tools/test-ground.js` — altura do chão bate com a malha 3D (só Node).
  - `node tools/smoke-test.js` — joga uma partida curta num navegador real (precisa do Playwright).
- Abra com `?seed=123` para um universo sempre igual e `?debug=1` para ver o FPS.

## Git

- Mensagens de commit curtas, em português, no imperativo (ex.: "Adiciona pulso de eco").
- Só abrir Pull Request quando o dono pedir.

## Segurança

- **Nunca** colocar tokens, senhas ou chaves no repositório nem pedir que o dono as cole no chat.
  O Claude já acessa este repositório pela integração do GitHub; não é preciso token.
