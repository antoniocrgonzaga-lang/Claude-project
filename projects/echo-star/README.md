# 🚀 Echo Star

Jogo 3D de exploração espacial que roda no navegador, feito com **HTML, CSS, JavaScript e Three.js**.
Você pilota uma nave entre mini-planetas gerados proceduralmente, pousa neles, desce da nave e explora a pé,
coletando cristais de luz. Visual *low-poly / blocado* — meio Roblox, meio Minecraft — com um clima misterioso de ficção científica.

## Como jogar

Há três jeitos, do mais simples ao mais "dev":

1. **Um arquivo só (recomendado):** baixe [`dist/echo-star.html`](dist/echo-star.html) e dê duplo clique. É o jogo inteiro — funciona offline.
2. **Pasta completa:** baixe o repositório (Code → Download ZIP) e abra `projects/echo-star/index.html`.
3. **Link na internet:** ligue o GitHub Pages do repositório (veja o README da raiz).

Funciona em navegadores de computador com WebGL (Chrome, Edge, Firefox). Não tem controles de toque para celular.

Dicas de URL (adicione ao final do endereço):

| Parâmetro | Efeito |
| --- | --- |
| `?seed=123` | Gera sempre o mesmo universo (troque o número para outro universo) |
| `?debug=1` | Mostra o FPS no topo da tela |

## Controles

**Na nave**

| Tecla | Ação |
| --- | --- |
| `W` / `S` | Acelerar / frear e dar ré |
| `Shift` (com `W`) | Turbo (gasta combustível rápido) |
| `X` | Parar a nave |
| Mouse ou `↑` `↓` | Inclinar (nariz para cima/baixo) |
| Mouse ou `A` `D` (`←` `→`) | Virar para os lados |
| `Q` / `E` | Girar (rolar) |
| `L` | Pousar — aparece o aviso quando você está perto de um planeta |
| `Espaço` | Decolar (nave pousada) |
| `F` | Sair da nave (nave pousada) |

**A pé**

| Tecla | Ação |
| --- | --- |
| `W` `A` `S` `D` | Andar |
| `Shift` | Correr |
| `Espaço` | Pular |
| Mouse (ou setas) | Olhar em volta |
| `R` | **Pulso de eco**: revela com feixes de luz os recursos num raio de ~95 m (recarrega em 5 s) |
| `V` | Alternar câmera 3ª pessoa / 1ª pessoa |
| Roda do mouse | Zoom da câmera (3ª pessoa) |
| `F` | Entrar na nave (quando estiver perto dela) |

**Geral:** `H` ajuda · `M` som · `Esc` pausa.

## Objetivo

Não há "fim de jogo" — é um jogo de exploração relaxante:

- Visite os **6 planetas** do universo (cada um tem nome, cor de céu e paisagem próprios).
- Colete os recursos de cada planeta: 💎 **Cristal Eco**, 🟠 **Núcleo Solar** e 🟣 **Essência Lunar**.
- Cristais também **reabastecem a nave**. Se o combustível acabar, a nave continua andando devagar (propulsão de emergência) — não há como "perder".
- Com a nave pousada o combustível recarrega sozinho.

### Tipos de planeta

| Tipo | Visual |
| --- | --- |
| 🌿 Mundo Verdejante | Colinas verdes, mar azul, árvores blocadas |
| 🏜️ Dunas Ardentes | Areia alaranjada, cactos |
| ❄️ Gelo Eterno | Cristas brancas e espinhos de gelo |
| 🌋 Brasa Vulcânica | Rocha escura, vales em brasa, obsidiana |
| 🍄 Floresta Violeta | Solo roxo, mar ciano brilhante, cogumelos e cristais |

Alguns planetas têm anel. O planeta onde você começa é sempre verdejante.
O ciclo dia/noite depende de onde você está no planeta: ande até o lado escuro para ver as estrelas e a lanterna do capacete acender.

## Estrutura de arquivos

```
echo-star/
├── index.html          ← página do jogo (HUD e telas em HTML)
├── css/style.css       ← visual do HUD (cores nas variáveis do topo)
├── js/
│   ├── utils.js        ← aleatório com semente, ruído 3D, nomes de planetas, texturas
│   ├── input.js        ← teclado, mouse (pointer lock), roda
│   ├── audio.js        ← sons gerados por código (sem arquivos de áudio)
│   ├── fx.js           ← sombra, pulso de eco, faíscas
│   ├── space.js        ← estrelas, nebulosas, sol, poeira cósmica, domo do céu
│   ├── planet.js       ← planetas: terreno, mar, atmosfera, decoração, recursos
│   ├── ship.js         ← nave: modelo, voo, pouso, decolagem
│   ├── player.js       ← astronauta blocado e controle a pé
│   ├── camera.js       ← câmera suave e transições nave ↔ personagem
│   ├── hud.js          ← atualização do HUD e marcadores
│   └── main.js         ← monta o universo e roda o loop do jogo
├── vendor/             ← Three.js r128 (cópia local, licença MIT)
├── dist/echo-star.html ← jogo em arquivo único (gerado)
└── tools/
    ├── build.js        ← gera dist/echo-star.html
    ├── test-ground.js  ← teste: altura do chão == malha 3D
    └── smoke-test.js   ← teste: joga uma partida curta num navegador real
```

Os scripts são "clássicos" (sem módulos ES) de propósito: assim o `index.html` abre com duplo clique, sem servidor.
**Depois de mexer no código, rode `node tools/build.js`** para atualizar o arquivo único.

## Como mexer e expandir

Os "botões de ajuste" ficam em constantes com comentários no topo dos arquivos:

| Quero… | Onde mexer |
| --- | --- |
| Nave mais rápida/lenta, turbo, consumo de combustível | `CFG` em `js/ship.js` |
| Velocidade, pulo e gravidade do personagem | `CFG` em `js/player.js` |
| Alcance do pouso, do eco, número de planetas | constantes no topo de `js/main.js` |
| **Novo tipo de planeta** (cores, relevo, mar, decoração) | `ES.PLANET_TYPES` em `js/planet.js` |
| **Nova decoração** (árvore, rocha, planta alienígena…) | `DECOS` em `js/planet.js` (monte com caixas, cones, etc.) |
| Novo tipo de recurso | `ES.RESOURCE_TYPES` em `js/planet.js` + um item no HUD (`index.html`) |
| Cores e fontes do HUD | variáveis `:root` em `css/style.css` |

Ideias para uma próxima versão:

- 🔧 **Crafting/melhorias** da nave gastando os recursos (mais combustível, turbo maior, scanner).
- 💾 **Salvar o progresso** (`localStorage`): recursos, planetas visitados, semente.
- 🌀 Planetas **girando** e luas orbitando (hoje o dia/noite muda andando pelo planeta, não pelo tempo).
- 👾 Vida alienígena, ruínas e "monólitos de eco" com segredos.
- 🎮 Suporte a controle (gamepad) e a toque no celular.
- 🎵 Trilha sonora própria (hoje há um pad ambiente simples gerado por código).

## Como funciona (resumo técnico)

- **Planetas:** esfera feita de 6 grades (*cube sphere*); cada vértice recebe altura de ruído 3D, arredondada em degraus (visual blocado). Cada triângulo tem cor sólida pela altura.
- **Chão exato:** como a malha é uma grade regular, `planet.groundAt(direção)` acha o par de triângulos e faz uma interseção raio-triângulo em O(1) — sem raycast. O teste `tools/test-ground.js` garante que bate com a malha desenhada.
- **Andar em esfera:** a cada frame o "cima" é recalculado (centro → jogador) e a direção da câmera é mantida paralela ao chão.
- **Pouso:** curva de Hermite que preserva a velocidade inicial e termina com velocidade zero; a nave se alinha ao terreno e procura um ponto livre de árvores.
- **Decoração:** `InstancedMesh` (centenas de árvores em poucas chamadas de desenho).
- **Céu:** domo com gradiente que só aparece dentro da atmosfera; dia/noite pelo ângulo do sol; estrelas e nebulosas somem de dia.
- **Tudo em arquivos de código:** texturas, sons e modelos são gerados por JavaScript — não há imagens, áudios ou modelos 3D.

## Créditos

- [Three.js](https://threejs.org/) r128 — licença MIT (ver `vendor/THREE-LICENSE.txt`).
- Código e design do jogo: criados com o Claude.
