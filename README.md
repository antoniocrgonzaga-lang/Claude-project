# Claude-project

Meu laboratório de projetos e protótipos feitos por diversão. 🧪

Cada projeto mora na própria pasta dentro de [`projects/`](projects/), com um `README.md` que explica o que é e como abrir.

## Projetos

| Projeto | O que é | Como abrir |
| --- | --- | --- |
| 🚀 [**Echo Star**](projects/echo-star/) | Jogo 3D no navegador (em inglês, para os clientes do Second Life): explore planetas procedurais, colete recursos, construa colônias, treine unidades, evolua a IA da base até a Lua Tecnológica e enfrente a Brood. Feito com Three.js. | [Jogar no navegador](https://antoniocrgonzaga-lang.github.io/Claude-project/projects/echo-star/) · ou baixe [`dist/echo-star.html`](projects/echo-star/dist/echo-star.html) e abra com duplo clique |

## Como o repositório é organizado

```
Claude-project/
├── README.md        ← este índice (atualizado a cada projeto novo)
├── CLAUDE.md        ← combinados de organização (para o Claude seguir em toda sessão)
├── .gitignore
├── .nojekyll      ← GitHub Pages serve os arquivos como estão
└── projects/
    └── <nome-do-projeto>/
        ├── README.md   ← o que é, como abrir/jogar, como mexer
        └── …           ← código, assets e testes do projeto
```

## Como abrir um projeto que está aqui no GitHub

O GitHub **mostra** o código dos arquivos `.html`, mas não os executa. Para jogar/abrir:

1. Abra o arquivo no GitHub e clique em **Download raw file** (ícone de seta para baixo, no canto superior direito do arquivo).
2. Dê duplo clique no arquivo baixado — ele abre no navegador.

Ou baixe o repositório inteiro: botão verde **Code → Download ZIP**.

### Jogar direto pelo link (GitHub Pages)

O repositório é publicado pelo **GitHub Pages** a partir da branch `main` (Settings → Pages →
*Deploy from a branch* → `main` / `/ (root)`). Qualquer pessoa pode jogar sem baixar nada:

- 🚀 **Echo Star:** <https://antoniocrgonzaga-lang.github.io/Claude-project/projects/echo-star/>

O site se atualiza sozinho 1–2 minutos depois de cada mudança chegar à `main`.
O arquivo `.nojekyll` na raiz faz o GitHub servir os arquivos como estão (sem o processador Jekyll).
