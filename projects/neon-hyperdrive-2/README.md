# NEON HYPERDRIVE 2

Corrida antigravitacional em Three.js, rodando direto no navegador, com visual synthwave/neon.
São 8 naves e 3 voltas por corrida: você larga em último e enfrenta 7 pilotos controlados pelo computador.
O jogo tem 3 naves, 5 pistas temáticas, efeitos sonoros e trilha sonora sintetizados por código
(nenhum arquivo de áudio) e textos em **português, inglês e alemão**.

## Jogar agora

- **No navegador (sem baixar nada):** <https://antoniocrgonzaga-lang.github.io/Claude-project/projects/neon-hyperdrive-2/>
- **Arquivo único, com duplo clique:** baixe [`dist/neon-hyperdrive-2.html`](dist/neon-hyperdrive-2.html) (~1 MB) e abra no Chrome, Edge ou Firefox. Funciona offline.

> Joga no PC com **teclado** (ou gamepad), no **celular e tablet** com **toque** (ver abaixo) e numa TV do Second Life só com o **mouse**.
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

### No celular e no tablet (toque)

Os controles de toque aparecem sozinhos em aparelhos com tela de toque (celular, tablet, iPad) — também no tablet com
teclado conectado. No PC comum não aparecem. Para forçar, use `?touch=1` no fim do endereço; `?touch=0` desliga.

- **Aceleração automática liga/desliga:** o botão **ACEL. AUTO** (canto inferior direito, acima dos botões redondos)
  mostra o estado — verde aceso = **LIGADA** (a nave acelera sozinha), cinza = **DESLIGADA**. A escolha fica salva no aparelho.
- **Com a automática desligada** aparece o botão verde **ACELERAR**: **segure** para acelerar e **solte** para a nave
  planar (sem frear) — é o jeito de entrar nas curvas fechadas sem bater nem cair.
- **Virar:** encoste o dedo em qualquer ponto livre da tela e **arraste para os lados**. Conta a distância a partir de
  onde o dedo encostou (aparece um "joystick" grande sob o dedo); soltou, a nave segue reta. A direção é tolerante:
  tem zona morta no centro e resposta suave para pequenos desvios do dedo.
- **BOOST** (rajada curta), **DRIFT** (segure) e **ACELERAR** (segure) ficam no canto inferior direito.
- **CÂMERA**, **REPOSICIONAR** e **PAUSA** ficam no alto, ao centro.
- Dá para virar com um dedo e segurar ACELERAR / apertar BOOST ou DRIFT com outro ao mesmo tempo.
- Os menus funcionam com toques; se uma tela não couber (celular deitado), ela rola com o dedo.
- No celular **em pé** aparece um aviso para girar o aparelho, e a corrida pausa. Jogue com ele **deitado**.
- A página não rola nem dá zoom durante o jogo; os botões respeitam o entalhe e os cantos arredondados da tela.

Ajustes em `POINTER` (`src/Config.js`): `touchAutoThrottle` (aceleração automática ligada ou não na primeira vez),
`touchSteerSpan` (quanto arrastar o dedo para virar tudo), `touchDeadZone` (zona morta) e `touchSteerCurve` (suavidade).
O tamanho do "joystick" na tela fica em `.pc-stick` no `style.css`.

## Jogar numa TV do Second Life (mídia no prim)

O jogo funciona como mídia numa face de objeto, mas o teclado só chega à página se a TV estiver **com o foco**:

1. **Feche a janela de edição (Build/Edit) e a janela *Media Settings*.** Com elas abertas, o clique vai para o editor e não para a página.
2. Clique na tela da TV (de preferência num ponto vazio, fora dos botões). Ela fica focada enquanto você não clicar fora, mexer a câmera com Alt+clique ou apertar **Esc**.
3. No Second Life o **Esc tira o foco da TV**: para pausar, use **P**.
4. Desligue o AO e não esteja sentado em objetos com script, que podem "pegar" as teclas de movimento.
5. Em *Preferências → Som e Mídia*, deixe "Media first-click interacts" em **Any object** se a TV não estiver num terreno seu.

**Controles pelo mouse:** no navegador do Second Life o jogo liga sozinho um modo para jogar só com o mouse
(no navegador comum, use `?mouse=1` no endereço; `?mouse=0` desliga). Acelere com **W/↑**; para virar, dá para
**segurar o botão do mouse e arrastar para os lados** (quanto mais longe do centro, mais vira). Na lateral direita
ficam os botões **BOOST** (rajada curta), **CÂMERA**, **REPOSICIONAR** e **PAUSA**. O teclado continua valendo junto.
Ajustes em `POINTER` (`src/Config.js`). No PC (teclado ou mouse) **nunca** há aceleração automática.

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
    ├── PointerControls.js ← controles na tela: toque (celular/tablet, ?touch=1) e mouse (Second Life, ?mouse=1)
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

- Recordes de volta salvos por pista e um modo contra o relógio.
- Campeonato com as 5 pistas em sequência e pontuação.
- Fantasma da melhor volta.
