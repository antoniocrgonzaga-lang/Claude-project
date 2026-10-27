// =============================================================
// music.js (dados) — as músicas do jogo, escritas como "partitura".
// Quem toca é o systems/music.js, com violão sintetizado (12 cordas),
// um bordão grave e um sino distante.
//
// Notas em MIDI: 60 = Dó central (C4), 62 = Ré, 64 = Mi, 65 = Fá...
// cada +12 sobe uma oitava. Tempo contado em COLCHEIAS (eighth):
// um compasso tem `barEighths` colcheias (6 = compasso 6/8, balançado).
//
//   chords   → os acordes, um por compasso (nomes de CHORDS)
//   patterns → ordem em que as cordas do acorde são dedilhadas
//              (índices na lista de notas do acorde)
//   melody   → por compasso: [colcheia de início, nota, duração em colcheias]
//
// Composição original para o jogo, no clima do vilarejo de Tristram (Diablo 1):
// Ré menor, lento, com o Mi bemol "frígio" que soa antigo e sombrio.
//
// Temas com kind: 'ambient' (o Oblivion) usam outro formato, descrito no próprio tema.
// =============================================================

// Acordes: notas do grave para o agudo (como no braço do violão)
export const CHORDS = {
  Dm: [50, 57, 62, 65],   // Ré  Lá  Ré  Fá
  Bb: [46, 53, 58, 62],   // Si♭ Fá  Si♭ Ré
  C:  [48, 55, 60, 64],   // Dó  Sol Dó  Mi
  Gm: [43, 50, 55, 58],   // Sol Ré  Sol Si♭
  Eb: [51, 58, 63, 67],   // Mi♭ Si♭ Mi♭ Sol  (o acorde "frígio", o mais sombrio)
  A:  [45, 52, 57, 61],   // Lá  Mi  Lá  Dó♯  (puxa de volta para o Ré menor)
  Am: [45, 52, 57, 60],   // Lá  Mi  Lá  Dó
};

export const THEMES = {
  village: {
    name: 'Corvália ao anoitecer',
    eighth: 0.31,          // segundos por colcheia (~65 colcheias pontuadas por minuto)
    barEighths: 6,
    drone: [38, 45],       // bordão grave: Ré e Lá (bem baixinho, sempre soando)
    bell: { midi: 50, every: 16 }, // sino distante da catedral: a cada 16 compassos
    sections: [
      { // A — o tema
        chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Gm', 'Eb', 'A'],
        pattern: [0, 1, 2, 3, 2, 1],
        melody: [
          [[3, 69, 3]],
          [[0, 74, 2], [2, 72, 1], [3, 69, 3]],
          [[0, 65, 3], [3, 67, 3]],
          [[0, 64, 2], [2, 67, 1], [3, 72, 3]],
          [[0, 69, 4], [4, 65, 2]],
          [[0, 67, 2], [2, 70, 2], [4, 74, 2]],
          [[0, 75, 3], [3, 74, 3]],
          [[0, 73, 4], [4, 64, 2]],
        ],
      },
      { // B — só o violão, mais grave, depois uma resposta da melodia
        chords: ['Gm', 'Dm', 'Eb', 'Bb', 'Gm', 'Dm', 'A', 'A'],
        pattern: [0, 2, 1, 3, 1, 2],
        melody: [
          [], [], [], [],
          [[0, 70, 3], [3, 69, 3]],
          [[0, 65, 6]],
          [[0, 64, 2], [2, 73, 2], [4, 69, 2]],
          [[0, 69, 6]],
        ],
      },
      { // A' — o tema de novo, com a melodia uma oitava acima no final
        chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Gm', 'Eb', 'Dm'],
        pattern: [0, 1, 2, 3, 2, 1],
        melody: [
          [[3, 69, 3]],
          [[0, 74, 2], [2, 72, 1], [3, 69, 3]],
          [[0, 65, 3], [3, 67, 3]],
          [[0, 64, 2], [2, 67, 1], [3, 72, 3]],
          [[0, 81, 4], [4, 77, 2]],
          [[0, 79, 2], [2, 77, 2], [4, 74, 2]],
          [[0, 75, 3], [3, 74, 3]],
          [[0, 74, 6]],
        ],
      },
      { // C — respiro: acordes lentos, cada um tocado de uma vez (rasgueado suave)
        chords: ['Dm', 'Bb', 'Gm', 'A'],
        pattern: 'strum',
        melody: [[], [], [], []],
      },
    ],
  },

  // ---------------------------------------------------------------
  // OBLIVION (andares 1–10) — dark ambient com toques de dark folk e industrial.
  // Composição original. Sem melodia fixa: a cada compasso sorteamos o que toca,
  // conforme a SEÇÃO da forma. Muito silêncio, batidas lentas e espaçadas,
  // violoncelos graves, violão de 12 cordas dissonante com eco, glissandos de violino.
  // Tom: Ré frígio (Ré, Mi♭, Fá, Sol, Lá, Si♭, Dó) — o Mi♭ e o Lá♭ (trítono) dão o perigo.
  // ---------------------------------------------------------------
  oblivion: {
    name: 'Os Corredores do Oblivion',
    kind: 'ambient',
    eighth: 0.42,          // bem lento: compasso de 8 colcheias ≈ 3,4 s
    barEighths: 8,
    drone: [26],           // Ré bem grave (quase só se sente), sempre por baixo
    ambient: {
      // forma: [seção, compassos]. Repete do começo quando acaba (~90 s).
      form: [['void', 4], ['pulse', 4], ['guitar', 4], ['tension', 4], ['void', 2], ['pulse', 4], ['guitar', 4]],
      // chance (0..1) de cada instrumento tocar num compasso, em cada seção
      sections: {
        void:    { cello: 0.6, drums: 0,    guitar: 0.15, gliss: 0.05, clank: 0.25, scrape: 0.2 },  // quase silêncio
        pulse:   { cello: 0.9, drums: 0.9,  guitar: 0.2,  gliss: 0,    clank: 0.15, scrape: 0.1 },  // batidas lentas
        guitar:  { cello: 0.8, drums: 0.3,  guitar: 0.85, gliss: 0.12, clank: 0.1,  scrape: 0.05 }, // violão com eco
        tension: { cello: 1,   drums: 0.85, guitar: 0.5,  gliss: 0.45, clank: 0.25, scrape: 0.25, celloSecond: 0.7 }, // tudo junto, dissonante
      },
      cello: {
        notes: [38, 38, 39, 41, 36, 34, 44, 38], // Ré (mais vezes), Mi♭, Fá, Dó, Si♭, Lá♭
        second: [1, 6, 7],                        // 2ª voz: segunda menor, trítono ou quinta acima
        vel: 0.11,
      },
      drums: {
        // [colcheia, força]: batidas espaçadas, às vezes dobradas
        patterns: [[[0, 1]], [[0, 1], [5, 0.55]], [[0, 1], [1, 0.5]], [[0, 0.85], [4, 0.85]], [[6, 0.6], [7, 1]]],
        vel: 0.5,
      },
      guitar: {
        // motivos curtos [colcheia, nota]; o eco repete cada um algumas vezes
        motifs: [
          [[0, 62], [2, 63], [4, 62], [7, 57]],             // Ré-Mi♭-Ré... Lá: o "suspiro" frígio
          [[0, 50], [0.08, 56], [3, 57]],                   // Ré + Lá♭ (trítono) que resolve no Lá
          [[0, 69], [1.5, 68], [3, 65], [6, 63]],           // descida Lá-Lá♭-Fá-Mi♭
          [[0, 50], [0.06, 57], [0.12, 63]],                // acorde dissonante Ré-Lá-Mi♭ (rasgueado lento)
          [[0, 74], [4, 75]],                               // Ré agudo → Mi♭, como um sino
          [[0, 57], [1, 58], [2, 57], [5, 50]],             // Lá-Si♭-Lá... Ré grave
        ],
        vel: 0.36,
      },
      delay: { time: 0.42 * 1.5, feedback: 0.42, tone: 2200, wet: 0.5 }, // eco em colcheia pontuada
      violin: {
        glides: [[86, 81, 1.5], [81, 82, 1], [74, 68, 1.6], [79, 75, 1.2], [93, 86, 1.4]], // [de, para, compassos]
        vel: 0.045,
      },
      ambience: { windVel: 0.05, rumbleVel: 0.09, clankVel: 0.05, scrapeVel: 0.05 },
    },
  },
};

// Qual música toca em cada andar do Oblivion (null = silêncio)
export function musicForFloor(floor) {
  return floor <= 10 ? 'oblivion' : null;
}
