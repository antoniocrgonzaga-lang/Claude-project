# NEON HYPERDRIVE 2

Corrida antigravitacional em Three.js, rodando direto no navegador, com visual synthwave/neon.
São 8 naves e 3 voltas por corrida: você larga em último e enfrenta 7 pilotos controlados pelo computador.
O jogo tem 3 naves, 5 pistas temáticas, efeitos sonoros e trilha sonora sintetizados por código
(nenhum arquivo de áudio) e textos em **português, inglês e alemão**.

## Jogar agora

- **No navegador (sem baixar nada):** <https://antoniocrgonzaga-lang.github.io/Claude-project/projects/neon-hyperdrive-2/>
- **Arquivo único, com duplo clique:** baixe [`dist/neon-hyperdrive-2.html`](dist/neon-hyperdrive-2.html) (~1 MB) e abra no Chrome, Edge ou Firefox. Funciona offline.

> Feito para PC com **teclado** (ou gamepad). Em celular/tablet ainda não há controles de toque.
> As opções (idioma, dificuldade, gráficos, volumes) ficam salvas no navegador **por endereço**: o link acima, o `localhost` e o arquivo único guardam opções separadas.

## Como rodar (para mexer no código)

**Jeito fácil:** dê dois cliques em **`start.bat`**. Ele sobe um servidor local (PowerShell, sem instalar nada) e abre o jogo no navegador.
Para parar, feche a janela preta do servidor.

> Por que precisa de servidor? Navegadores bloqueiam módulos JavaScript abertos direto do arquivo (`file://`).
> O servidor também desliga o cache: editou um arquivo, aperte **F5** e a mudança aparece.

## Controles

| Ação | Teclado | Gamepad |
|---|---|---|
| Acelerar / frear | W / S ou ↑ / ↓ | RT / LT |
| Virar | A / D ou ← / → | Analógico esquerdo |
| Boost (gasta carga e energia) | Shift | A |
| Drift / freio lateral | Espaço | B |
| Reposicionar a nave na pista | R | X |
| Alternar câmera (próxima, distante, cockpit) | C | Y |
| Pausar | P ou Esc | Start |

## Jogar numa TV do Second Life (mídia no prim)

O jogo funciona como mídia numa face de objeto, mas o teclado só chega à página se a TV estiver **com o foco**:

1. **Feche a janela de edição (Build/Edit) e a janela *Media Settings*.** Com elas abertas, o clique vai para o editor e não para a página.
2. Clique na tela da TV (de preferência num ponto vazio, fora dos botões). Ela fica focada enquanto você não clicar fora, mexer a câmera com Alt+clique ou apertar **Esc**.
3. No Second Life o **Esc tira o foco da TV**: para pausar, use **P**.
4. Desligue o AO e não esteja sentado em objetos com script, que podem "pegar" as teclas de movimento.
5. Em *Preferências → Som e Mídia*, deixe "Media first-click interacts" em **Any object** se a TV não estiver num terreno seu.

**Teste de teclado:** coloque `?keys=1` no fim do endereço da mídia
(ex.: `.../neon-hyperdrive-2/?keys=1`). Aparece um painel mostrando se a página tem o foco e cada tecla recebida:
se nada aparece ao apertar as teclas, o problema é de foco ou do visualizador; se aparece, o jogo já está recebendo.

O jogo reconhece as teclas mesmo quando o navegador embutido do visualizador manda os dados incompletos
(`event.code` vazio): ele tenta `code`, depois `key`, depois `keyCode` (ver `keyCodeOf` em `src/InputManager.js`).

## Regras da pista

- **Faixas laranja:** boost grátis e recarga do capacitor.
- **Faixas verdes:** recuperam a energia da nave.
- **Plataformas brancas:** lançam a nave em pequenos saltos.
- **Bordas vermelhas:** trecho sem barreira; cair custa energia e tempo.
- **Energia é vida e combustível:** batidas e boost gastam energia; se zerar, a nave explode e volta à pista.

## Opções

- **Idioma:** Português, English ou Deutsch. Na primeira vez, o jogo usa o idioma do navegador (inglês para outros idiomas).
- **Dificuldade:**
  - **Casual** (padrão) é pensada para jogadores casuais do Second Life: a IA é um pouco mais lenta e alivia quando abre vantagem.
  - **Difícil:** a IA tem a mesma velocidade que você, contorna as curvas mais rápido, erra menos e não alivia.
  - A dificuldade é fixada na largada; se for mudada na pausa, vale na próxima corrida.
- **Gráficos:** qualidade (baixo/médio/alto), efeito CRT e sombras. **Volumes:** geral, música, motor e efeitos.

## Estrutura dos arquivos

```
neon-hyperdrive-2/
├── index.html        ← telas (menus, HUD) e import map do Three.js
├── style.css         ← visual dos menus e do HUD
├── start.bat         ← abre o jogo por um servidor local
├── serve.ps1         ← servidor HTTP mínimo em PowerShell (usado pelo start.bat)
├── dist/             ← versão em arquivo único (gerada por tools/build.js)
├── tools/build.js    ← gera o dist/
├── vendor/three/     ← Three.js 0.170 (só os módulos usados) e a licença MIT
└── src/
    ├── main.js            ← ponto de entrada (checa WebGL 2, define o idioma)
    ├── Game.js            ← estados da corrida, laço principal, eventos
    ├── Config.js          ← TODOS os botões de ajuste: física, naves, pistas, dificuldade
    ├── I18n.js            ← textos em português, inglês e alemão
    ├── Track.js           ← geração da pista a partir de pontos de controle
    ├── Environment.js     ← céu, sol, montanhas e cenário de cada tema
    ├── Ship.js            ← física arcade das naves (coordenadas da pista)
    ├── ShipModel.js       ← modelo 3D procedural das naves e contornos neon
    ├── PlayerShip.js / AIRacer.js ← jogador e pilotos da IA
    ├── CollisionSystem.js ← batidas em barreiras e entre naves
    ├── CameraController.js, Effects.js ← câmeras, partículas, bloom e efeito CRT
    ├── HUD.js / Menu.js   ← interface da corrida e telas
    ├── InputManager.js    ← teclado + gamepad (com reservas para navegadores embutidos)
    ├── KeyProbe.js        ← painel de teste de teclado (?keys=1)
    ├── AudioManager.js    ← efeitos sonoros sintetizados
    └── MusicManager.js / Songs.js ← sequenciador e as 6 músicas (escritas como dados)
```

## Onde mexer

- **Equilíbrio da IA:** `DIFFICULTY` em `src/Config.js` (perfis `casual` e `hard`). Para deixar o Difícil mais fácil, baixe `speedBase`.
- **Naves:** `SHIPS` em `src/Config.js` (atributos, cores, formato e detalhes exclusivos em `design.features`: `winglets`, `canards`, `spike`, `armor`).
- **Pistas:** `TRACKS` em `src/Config.js`. Cada pista é uma lista de pontos `[x, y, z]`; túneis, trechos sem barreira, faixas de energia, boosts e saltos são frações (0 a 1) do comprimento.
- **Textos e traduções:** `src/I18n.js`. Para um idioma novo, copie um bloco (ex.: `en`) e inclua o idioma em `LANGUAGES`.
- **Espessura dos contornos das naves:** `OUTLINE_WIDTH` no topo de `src/ShipModel.js`.
- **Músicas:** `src/Songs.js` (notas, acordes e bateria escritos como texto).

Depois de mexer em `src/`, `style.css`, `vendor/` ou `index.html`, rode `node tools/build.js` e commite o `dist/neon-hyperdrive-2.html` atualizado junto.

## Ideias para expandir

- Controles de toque para tablet e celular.
- Recordes de volta salvos por pista e um modo contra o relógio.
- Campeonato com as 5 pistas em sequência e pontuação.
- Fantasma da melhor volta.
