# Dark Oblivion

RPG de ação isométrico (estilo Darkstone / Diablo) em Three.js, rodando direto no navegador, sem etapa de build.
Três classes (Cavaleiro, Bruxa Sombria, Elfo Arqueiro), vilarejo com loja, 25 andares gerados por sorteio,
chefes a cada 5 andares, itens com raridade, habilidades que evoluem, sons e música sintetizados por código.

## Jogar agora

- **No navegador (sem baixar nada):** <https://antoniocrgonzaga-lang.github.io/Claude-project/projects/dark-oblivion/>
- **Arquivo único, com duplo clique:** baixe [`dist/dark-oblivion.html`](dist/dark-oblivion.html) (~30 MB, já com os modelos 3D) e abra no Chrome, Edge ou Firefox. Funciona offline.

> Feito para PC com **mouse e teclado** (clique direito e teclas 1–6 são essenciais). Em celular/tablet ainda não há controles de toque.
> Os saves ficam no navegador e **por endereço**: o que você salvar no link acima, no `localhost:8000` ou no arquivo único são três saves separados.

## Como rodar (para mexer no código)

**Jeito fácil:** dê dois cliques em **`start.bat`**. Ele sobe o servidor e abre o jogo no navegador.
Para parar, feche a janela preta do servidor.

**Pelo terminal** (dentro da pasta do projeto):

```bash
python server.py 8000 --open
```

O jogo fica em **http://localhost:8000** (Chrome, Edge ou Firefox). Para parar: `Ctrl+C`.

> Por que precisa de servidor? Navegadores bloqueiam módulos JavaScript abertos direto do arquivo (`file://`).
> O `server.py` também desliga o cache: editou um arquivo, aperte **F5** e a mudança aparece.
> (Os saves ficam no navegador, por endereço: use sempre a mesma porta.)

## Controles

| Ação | Tecla |
|---|---|
| Andar / atacar / falar / usar portal | Clique esquerdo (segure para seguir o mouse) |
| Usar a habilidade selecionada | Clique direito (segure para repetir) |
| Escolher habilidade | 1 a 6 |
| Pôr habilidade na barra | Na ficha (C), mouse sobre a habilidade + 1 a 6 |
| Poção de vida / de recurso | Q / W |
| Pergaminho de portal | T |
| Inventário / Personagem | I / C |
| Fechar painéis | Esc |
| Girar câmera / zoom | Z e X / roda do mouse ou Page Up e Page Down |
| Ligar / desligar a música | M |

## Dicas de jogo

- **Drenar Vida** (Bruxa) e **Tiro Concentrado** (Arqueiro): segure o botão direito. O Tiro Concentrado dispara quando você solta.
- **Investida** e **Grito de Guerra** (Cavaleiro) **geram** Fúria; Golpe Poderoso e Redemoinho gastam.
- **Habilidades avançadas** (a partir do nível 5): ao aprender uma habilidade ativa nova, ela vai sozinha para um espaço vazio da barra. O tooltip mostra o que melhora no próximo nível.
  - Cavaleiro: Dilacerar (5, sangramento), Escudo de Espinhos (8, devolve dano, requer escudo), Fúria Berserker (12, +dano / −armadura).
  - Bruxa: Nova Congelante (5, congela em área), Bola de Fogo (6), Corrente de Relâmpagos (8), Orbe Sombrio (10, dano vai para a mana), Chuva de Meteoros (12).
  - Arqueiro: Flecha Venenosa (5), Olho de Águia (5, passiva de crítico), Chuva de Flechas (8), Flecha Explosiva (10).
- O Oblivion tem **25 andares**. No último mora o chefe final, **Vorthrax, Senhor do Oblivion**: ele solta ondas de fogo, rajadas de orbes sombrios em todas as direções e convoca Demônios Brutos e Cultistas. Para mudar o número de andares, altere `maxFloor` em `js/config.js`.
- A cada 5 andares há um **waypoint** (plataforma azul) e um **chefe** guardando a escadaria para o próximo andar. Ela fica selada (brilho vermelho sobre os degraus) até o chefe morrer.
- Com um waypoint ativado, o Portal do Oblivion no vilarejo deixa você escolher o andar.

## Onde mexer

- **Trocar um placeholder por um .glb:** `js/data/models.js` (mude `glb: null` para o caminho do arquivo).
- **Modelos do VRoid (.vrm):** antes de colocar no jogo, otimize (texturas menores, sem expressões faciais):
  `python tools/optimize_vrm.py "C:/caminho/Modelo.vrm" assets/models/modelo.vrm`
  O arquivo cai de ~18 MB para ~6 MB. Arquivos grandes demoram e o antivírus (Avast) pode cortar o download.
  Em `models.js`, use `rig: 'vrm'` (anima braços e pernas por código) e `skinMaterial: 'SKIN'` (tom de pele).
  Estilo: `walk: 'feminine' | 'masculine'` e `hold: 'staff' | 'bow'` (o que a mão segura e as poses de ataque).
  Cor da roupa: `recolor: { materials: ['CLOTH'], color: 0x4a2c1a }` tinge o tecido cinza/preto e mantém os detalhes coloridos.
- **Armadura do Cavaleiro:** `KNIGHT_ARMOR` em `js/data/models.js` (peças simples presas nos ossos, desenhadas na pose em "T"; o lado direito é o espelho do esquerdo). Espada, machado, broquel e escudo pipa aparecem conforme o item equipado (campo `equip`).
- **Tons de pele:** `SKIN_TONES` em `js/data/models.js`.
- **Habilidades:** `js/skills/skillData.js` (dados) e `js/skills/behaviors.js` (código das mecânicas).
- **Classes:** `js/classes/`.
- **Inimigos e chefes:** `js/data/enemies.js`.
- **Chefe do andar 5 — Fenrak, o Lobisomem Acorrentado:** modelo feito no Blender (`assets/models/werewolf.glb`), sem ossos no arquivo. O esqueleto é montado no jogo: as juntas (quadril, joelhos, ombros...) ficam em `autoRig` no `werewolf` de `js/data/models.js`, e cada ponto do modelo segue o osso mais próximo (`autoSkin` em `js/core/creature.js`).
- **Do Blender para o jogo:** `tools/blender_exportar_glb.py` exporta um `.blend` como `.glb` sem abrir a janela do Blender (instruções no próprio arquivo).
- **Visual dos inimigos comuns (orcs demoníacos):** `imp`, `brute` e `cultist` em `js/data/models.js` são criaturas ARTICULADAS: juntas (quadril, tronco, cabeça, braços, pernas, rabo) com peças simples presas a cada uma. Escreve-se só o lado esquerdo; o direito é espelhado. O jeito de andar e de atacar (`anim`) é animado por código em `js/core/creature.js` — o golpe acerta junto com o `attackWindup` do inimigo.
- **Paredes transparentes (tamanho do recorte):** `cutaway` em `js/config.js`.
- **Visual do Oblivion por faixa de 5 andares:** `js/data/dungeonThemes.js` (cores, névoa, luzes e quantidade de enfeites de cada tema; andares 1–5 = Catacumbas Ardentes, 6–10 = Masmorras de Pedra Cinzenta, 11–15 = Labirinto das Cavernas). Um tema com `layout: 'caves'` gera câmaras irregulares e túneis sinuosos, e `cave` deixa as paredes de rocha tortas. As texturas de pedra e a lava são geradas em `js/core/textures.js`; os enfeites (tochas, correntes, estandartes, ossos, velas, colunas) ficam em `js/data/models.js` e são espalhados por `js/world/dungeonDecor.js`.
- **Itens, afixos e raridades:** `js/data/items.js`.
- **Loja:** `js/data/shop.js`.
- **Balanceamento geral:** `js/config.js`.
- **Sons e música** (tudo sintetizado por código, sem arquivos de áudio):
  - Volumes: `audio` em `js/config.js`.
  - Efeitos (golpes, bloqueio, flechas, magias, poções, nível): receitas em `js/systems/sound.js`.
  - Música: a partitura fica em `js/data/music.js` (acordes, dedilhado e melodia); quem toca é `js/systems/music.js`.
  - Oblivion (andares 1–10): tema `oblivion`, "ambient" — sem melodia fixa; a cada compasso sorteia violoncelo, tambor, violão com eco, violino, metal e arrasto conforme a seção (vazio, pulso, violão, tensão). Qual música toca em cada andar: `musicForFloor` em `js/data/music.js`.

## Depuração

No console do navegador (F12), o objeto `game` fica disponível:

```js
game.player.addGold(1000)
game.player.gainXp(500)
game.world.goTo('dungeon', 5)
game.world.goTo('dungeon', 25)   // chefe final
```

## Estrutura de arquivos

```
dark-oblivion/
├── index.html            ← página do jogo (precisa de servidor: start.bat ou server.py)
├── start.bat / server.py ← servidor local sem cache (F5 mostra a mudança na hora)
├── css/style.css         ← HUD, painéis e telas
├── js/
│   ├── main.js           ← ponto de entrada e loop principal
│   ├── game.js           ← objeto compartilhado (game.player, game.world, game.scene...)
│   ├── config.js         ← balanceamento (dificuldade, câmera, economia, áudio, número de andares)
│   ├── save.js           ← saves no localStorage
│   ├── core/             ← peças gerais: câmera, input, grid + A*, modelos (assets), texturas, áudio
│   ├── data/             ← TABELAS do jogo: modelos, inimigos, itens, loja, temas, música
│   ├── entities/         ← jogador, inimigos e atributos
│   ├── classes/          ← as três classes
│   ├── skills/           ← habilidades (dados, mecânicas, efeitos de status)
│   ├── systems/          ← combate, loot, inventário, projéteis, efeitos, sons, música
│   ├── ui/               ← HUD, painéis, tela inicial, tooltips
│   └── world/            ← vilarejo, geração dos andares, decoração, paredes transparentes
├── assets/models/        ← personagens do VRoid (.vrm) e o lobisomem do Blender (.glb)
├── vendor/               ← Three.js 0.170.0 e a fonte Cinzel, copiados (sem CDN), com as licenças
├── dist/dark-oblivion.html ← versão de arquivo único (gerada, não edite)
└── tools/
    ├── build.js          ← gera o dist/
    ├── smoke-test.js     ← teste automático de uma partida curta
    ├── optimize_vrm.py   ← deixa um .vrm leve para o jogo
    └── blender_exportar_glb.py ← exporta um .blend como .glb
```

## Arquivo único e testes

Depois de mexer em `js/`, `css/`, `vendor/`, `assets/` ou `index.html`, gere de novo o arquivo único
(só precisa do Node.js):

```bash
node tools/build.js
```

Teste automático (precisa do Playwright: `npm install playwright`). Ele joga uma partida curta — cria um
Cavaleiro, anda, entra no portal, mata um inimigo, abre o inventário, usa o pergaminho de portal, volta e
confere o save — e falha se aparecer erro no console, se um modelo não carregar, se o jogo tentar acessar a
internet ou se a memória de vídeo crescer a cada troca de andar:

```bash
node tools/smoke-test.js         # testa o dist/dark-oblivion.html
node tools/smoke-test.js --dev   # testa o index.html por um servidor local
```

## Ideias para expandir

- **Controles de toque** para tablet/celular (andar tocando, botões para as habilidades e poções), como no Echo Star.
- Terminar a habilidade marcada como "em breve" (`implemented: false` em `js/skills/skillData.js`).
- Modelos .glb para os inimigos comuns e para os chefes Vorthrax e Belzorath (hoje são peças simples montadas por código).
- Opção de qualidade gráfica (sombras menores ou desligadas) para PCs mais fracos.
- Exportar/importar o save num arquivo, para levar o personagem de um navegador para outro.
