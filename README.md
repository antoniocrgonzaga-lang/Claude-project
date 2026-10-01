# Claude-project

Meu laboratório de projetos e protótipos feitos por diversão. 🧪

Cada projeto mora na própria pasta dentro de [`projects/`](projects/), com um `README.md` que explica o que é e como abrir.

## Projetos

| Projeto | O que é | Como abrir |
| --- | --- | --- |
| 🚀 [**Echo Star**](projects/echo-star/) | Jogo 3D no navegador: voe numa nave, pouse em mini-planetas procedurais e explore a pé coletando cristais. Feito com Three.js. | Baixe [`dist/echo-star.html`](projects/echo-star/dist/echo-star.html) e abra com duplo clique |

## Como o repositório é organizado

```
Claude-project/
├── README.md        ← este índice (atualizado a cada projeto novo)
├── CLAUDE.md        ← combinados de organização (para o Claude seguir em toda sessão)
├── .gitignore
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

> Quer jogar direto por um link, sem baixar nada? Dá para ligar o **GitHub Pages**
> (Settings → Pages → Branch `main` / pasta `/ (root)`). O endereço fica
> `https://antoniocrgonzaga-lang.github.io/Claude-project/projects/echo-star/`.
> Isso só funciona depois que o código estiver na branch `main`.
