// Trilha sonora original de NEON HYPERDRIVE 2, descrita como dados para o sequenciador (MusicManager).
//
// Notação:
//  - Compasso 4/4 dividido em 16 passos (semicolcheias).
//  - Bateria e ritmos: strings de 16 caracteres ('.' = pausa, 'x' = nota, 'X' = nota acentuada/longa, 'o' = chimbal aberto).
//  - Baixo: 16 valores em semitons acima da tônica do acorde (null = pausa).
//  - Arpejo: 16 índices de notas do acorde (null = pausa; índices além do acorde sobem uma oitava).
//  - Melodia: "nota:duração" em passos, separados por espaço ('-' = pausa). Cada compasso soma 16.

const _ = null;

export const SONGS = {
  // ---------------------------------------------------------------- menu: jazz fusion noturno
  menu: {
    title: 'Neon Lounge',
    bpm: 94,
    swing: 0.14,
    volume: 0.9,
    prog: ['Dm9', 'G9', 'Cmaj9', 'A7'],
    drums: {
      main: { kick: 'x.....x...x.....', snare: '....x.......x..x', hat: 'x.xxx.xxx.xxx.ox' },
      soft: { kick: 'x.........x.....', snare: '............x...', hat: 'x...x...x...x.o.' },
    },
    hatLevel: 0.6,
    bass: { tone: 'round', len: 1.6, pattern: [0, _, _, 0, _, _, 7, _, _, 12, _, _, 7, _, 0, _] },
    keys: { voice: 'epiano', rhythm: 'X.....x...x..x..', len: 3, volume: 1 },
    lead: { voice: 'soft', volume: 0.9 },
    phrases: {
      A: [
        '-:2 a4:2 c5:2 e5:2 f5:4 e5:2 d5:2',
        'b4:3 a4:1 g4:4 -:2 f4:2 a4:2 b4:2',
        'e5:6 d5:2 b4:2 g4:2 e4:4',
        '-:2 c#5:2 e5:2 g5:2 bb5:3 a5:1 g5:2 e5:2',
      ],
      B: [
        'a5:4 g5:2 e5:2 c5:4 a4:4',
        'b4:2 d5:2 g5:4 f#5:2 e5:2 d5:4',
        'f5:3 e5:3 d5:2 c5:2 a4:2 f4:4',
        'g4:2 b4:2 d5:2 f5:2 a5:6 -:2',
      ],
    },
    sections: [
      { bars: 4, layers: ['keys', 'bass', 'drums'], drums: 'soft' },
      { bars: 8, layers: ['keys', 'bass', 'drums', 'lead'], lead: 'A' },
      { bars: 8, layers: ['keys', 'bass', 'drums', 'lead', 'pad'], lead: 'B', prog: ['Fmaj9', 'Em7', 'Dm9', 'G9'] },
      { bars: 8, layers: ['keys', 'bass', 'drums', 'lead'], lead: 'A' },
    ],
  },

  // ---------------------------------------------------------------- Aurora Skyway: synthwave
  aurora: {
    title: 'Skyline Drive',
    bpm: 128,
    volume: 1,
    prog: ['Am', 'F', 'C', 'G'],
    drums: {
      main: { kick: 'x...x...x...x...', snare: '....X.......X...', hat: 'x.o.x.o.x.o.x.ox' },
      soft: { kick: 'x.......x.......', snare: '................', hat: 'x.x.x.x.x.x.x.x.' },
    },
    bass: { tone: 'synth', len: 0.8, pattern: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12] },
    arp: { pattern: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3], volume: 0.8 },
    pad: { volume: 1 },
    lead: { voice: 'saw', volume: 1 },
    phrases: {
      A: [
        'e5:4 -:2 a5:2 g5:4 e5:4',
        'f5:6 e5:2 c5:4 a4:4',
        'g5:4 -:2 e5:2 g5:2 c6:2 b5:4',
        'b5:3 a5:3 g5:2 d5:8',
        'e5:2 a5:2 c6:4 b5:2 a5:2 e5:4',
        'f5:2 a5:2 c6:6 a5:2 f5:4',
        'e6:4 d6:2 c6:2 g5:4 e5:2 g5:2',
        'd6:6 b5:2 g5:4 b5:2 d6:2',
      ],
      B: [
        'a5:2 c6:2 a5:2 f5:2 a5:4 c6:4',
        'b5:2 d6:2 b5:2 g5:2 b5:4 d6:4',
        'e6:6 d6:2 b5:4 g5:4',
        'a5:8 -:4 e5:2 a5:2',
        'c6:3 a5:3 f5:2 c6:3 a5:3 f5:2',
        'd6:3 b5:3 g5:2 d6:3 b5:3 g5:2',
        'e6:4 c6:4 a5:4 e6:4',
        'a5:12 -:4',
      ],
    },
    sections: [
      { bars: 4, layers: ['bass', 'arp', 'drums'], drums: 'soft' },
      { bars: 8, layers: ['bass', 'arp', 'drums', 'pad', 'lead'], lead: 'A' },
      { bars: 8, layers: ['bass', 'arp', 'drums', 'pad', 'lead'], lead: 'B', prog: ['F', 'G', 'Em', 'Am', 'F', 'G', 'Am', 'Am'] },
      { bars: 8, layers: ['bass', 'arp', 'drums', 'pad', 'lead'], lead: 'A' },
      { bars: 4, layers: ['arp', 'pad', 'drums'], drums: 'soft' },
    ],
  },

  // ---------------------------------------------------------------- Crimson Abyss: speed metal com sintetizador
  abyss: {
    title: 'Redline Abyss',
    bpm: 168,
    volume: 0.95,
    prog: ['E5', 'E5', 'C5', 'D5'],
    drums: {
      main: { kick: 'x.xxx.xxx.xxx.xx', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      half: { kick: 'x.....x.x.......', snare: '........X.......', hat: 'x...x...x...x...' },
    },
    bass: { tone: 'grit', len: 0.7, pattern: [0, _, 0, 0, 0, _, 0, 0, 0, _, 0, 0, 0, _, 0, 0] },
    guitar: { rhythm: 'x.xxx.xxx.xxX.X.' },
    lead: { voice: 'saw', volume: 0.95, harmony: -12 },
    phrases: {
      A: [
        'e5:2 g5:2 b5:2 e6:2 d6:2 b5:2 g5:2 b5:2',
        'e6:4 f#6:2 g6:2 f#6:2 e6:2 d6:2 b5:2',
        'c6:2 e6:2 g6:4 e6:2 c6:2 g5:4',
        'd6:2 f#6:2 a6:4 f#6:2 d6:2 a5:2 d6:2',
        'e6:1 d6:1 b5:1 g5:1 e6:1 d6:1 b5:1 g5:1 e6:1 d6:1 b5:1 g5:1 f#6:2 g6:2',
        'b6:6 a6:2 g6:2 f#6:2 e6:4',
        'c6:1 e6:1 g6:1 c7:1 g6:1 e6:1 c6:1 e6:1 g6:4 e6:4',
        'f#6:2 a6:2 d7:8 -:4',
      ],
      B: [
        'g5:2 b5:2 d6:4 b5:2 d6:2 g6:4',
        'f#6:4 d6:2 a5:2 d6:4 f#6:4',
        'e6:2 g6:2 e6:2 c6:2 e6:2 g6:2 c7:4',
        'b6:4 a6:2 f#6:2 d#6:4 f#6:2 b6:2',
      ],
    },
    sections: [
      { bars: 4, layers: ['guitar', 'bass', 'drums'] },
      { bars: 8, layers: ['guitar', 'bass', 'drums', 'lead'], lead: 'A' },
      { bars: 8, layers: ['guitar', 'bass', 'drums', 'lead'], lead: 'B', prog: ['G5', 'D5', 'C5', 'B5'] },
      { bars: 8, layers: ['guitar', 'bass', 'drums', 'lead'], lead: 'A' },
      { bars: 4, layers: ['guitar', 'bass', 'drums', 'pad'], drums: 'half', guitar: 'X.......X.....X.', bass: [0, _, _, _, _, _, _, _, 0, _, _, _, _, _, 0, _] },
    ],
  },

  // ---------------------------------------------------------------- Neo Tokyo Express: city pop fusion com melodia pentatônica
  tokyo: {
    title: 'Shuto Midnight',
    bpm: 148,
    volume: 0.95,
    prog: ['Am', 'F', 'G', 'Em'],
    drums: {
      main: { kick: 'x...x...x.x.x...', snare: '....X.......X...', hat: 'x.xxx.xxx.xxx.ox' },
      soft: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    },
    hatLevel: 0.8,
    bass: { tone: 'synth', len: 0.9, pattern: [0, _, 0, 12, _, 0, _, 12, 0, _, 0, 12, _, 7, _, 12] },
    keys: { voice: 'epiano', rhythm: 'x..x..x...x..x..', len: 1.5, volume: 0.9 },
    arp: { pattern: [0, 2, 3, 2, 4, 2, 3, 2, 0, 2, 3, 2, 5, 3, 4, 2], volume: 0.5 },
    lead: { voice: 'square', volume: 0.85 },
    phrases: {
      A: [
        'e5:2 a5:2 c6:2 a5:2 e6:4 d6:2 c6:2',
        'a5:3 c6:3 a5:2 f5:4 a5:4',
        'd6:2 b5:2 g5:2 b5:2 d6:4 g6:4',
        'e6:6 d6:2 b5:4 g5:2 b5:2',
        'a5:1 c6:1 e6:2 a5:1 c6:1 e6:2 a6:4 g6:2 e6:2',
        'f6:4 e6:2 c6:2 a5:4 c6:2 f6:2',
        'g6:3 d6:3 b5:2 g6:3 d6:3 b5:2',
        'e6:2 g6:2 b6:8 -:4',
      ],
      B: [
        'c6:4 a5:2 c6:2 f6:6 -:2',
        'd6:4 b5:2 d6:2 g6:6 -:2',
        'e6:2 c6:2 a5:2 c6:2 e6:2 a6:2 e6:4',
        'a5:2 c6:2 e6:2 a6:6 -:4',
        'f6:2 e6:2 c6:2 a5:2 f6:2 e6:2 c6:4',
        'g6:2 f6:2 d6:2 b5:2 g6:2 f6:2 d6:4',
        'e6:2 g#6:2 b6:4 g#6:2 e6:2 b5:4',
        'e6:1 g#6:1 b6:1 e7:1 b6:1 g#6:1 e6:1 g#6:1 b6:8',
      ],
    },
    sections: [
      { bars: 4, layers: ['bass', 'keys', 'drums'], drums: 'soft' },
      { bars: 8, layers: ['bass', 'keys', 'drums', 'arp', 'lead'], lead: 'A' },
      { bars: 8, layers: ['bass', 'keys', 'drums', 'pad', 'lead'], lead: 'B', prog: ['F', 'G', 'Am', 'Am', 'F', 'G', 'E', 'E'] },
      { bars: 8, layers: ['bass', 'keys', 'drums', 'arp', 'lead'], lead: 'A' },
      { bars: 4, layers: ['bass', 'arp', 'pad', 'drums'], drums: 'soft' },
    ],
  },

  // ---------------------------------------------------------------- Boreal Drift: synth etéreo em meio-tempo
  ice: {
    title: 'Aurora Drift',
    bpm: 138,
    volume: 1,
    prog: ['Em', 'C', 'G', 'D'],
    drums: {
      main: { kick: 'x.....x...x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.ox' },
      soft: { kick: 'x.........x.....', snare: '................', hat: 'x...x...x...x...' },
    },
    hatLevel: 0.7,
    bass: { tone: 'synth', len: 1.6, pattern: [0, _, _, 0, _, _, 0, _, _, _, 12, _, 0, _, 7, _] },
    keys: { voice: 'epiano', rhythm: 'X.......x.....x.', len: 4, volume: 0.9 },
    arp: { pattern: [0, 2, 3, 5, 3, 2, 4, 2, 0, 2, 3, 5, 6, 5, 3, 2], volume: 0.6 },
    pad: { volume: 1.1 },
    lead: { voice: 'saw', volume: 0.85 },
    phrases: {
      A: [
        'b5:4 e6:4 d6:2 b5:2 g5:4',
        'c6:4 e6:4 g6:6 -:2',
        'd6:2 g6:2 b6:4 a6:2 g6:2 d6:4',
        'f#6:6 e6:2 d6:4 a5:4',
        'e6:2 g6:2 b6:2 e7:2 d7:4 b6:4',
        'c7:3 g6:3 e6:2 c7:3 g6:3 e6:2',
        'b6:4 a6:2 g6:2 d6:4 g6:4',
        'a6:8 f#6:4 -:4',
      ],
      B: [
        'e6:2 g6:2 c7:4 g6:2 e6:2 g6:4',
        'f#6:2 a6:2 d7:4 a6:2 f#6:2 a6:4',
        'b6:6 a6:2 f#6:4 d6:4',
        'e6:8 -:4 b5:2 e6:2',
        'g6:3 e6:3 c6:2 g6:3 e6:3 c6:2',
        'a6:3 f#6:3 d6:2 a6:3 f#6:3 d6:2',
        'b6:4 g6:4 e6:4 b6:4',
        'e6:12 -:4',
      ],
    },
    sections: [
      { bars: 4, layers: ['arp', 'pad', 'keys'] },
      { bars: 8, layers: ['bass', 'arp', 'pad', 'drums', 'lead'], lead: 'A' },
      { bars: 8, layers: ['bass', 'arp', 'pad', 'keys', 'drums', 'lead'], lead: 'B', prog: ['C', 'D', 'Bm', 'Em', 'C', 'D', 'Em', 'Em'] },
      { bars: 8, layers: ['bass', 'arp', 'pad', 'keys', 'drums', 'lead'], lead: 'A' },
      { bars: 4, layers: ['bass', 'arp', 'pad', 'drums'], drums: 'soft' },
    ],
  },

  // ---------------------------------------------------------------- Luna Carnival: new wave punk acelerado
  carnival: {
    title: 'Luna Rush',
    bpm: 176,
    volume: 0.95,
    prog: ['D', 'Bm', 'G', 'A'],
    drums: {
      main: { kick: 'x.....x.x...x...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.o.' },
      soft: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    },
    bass: { tone: 'synth', len: 1.4, pattern: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 7, _, 12, _] },
    keys: { voice: 'organ', rhythm: '..x...x...x...x.', len: 1.6, volume: 0.9 },
    arp: { pattern: [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 4, 2], volume: 0.55 },
    lead: { voice: 'square', volume: 0.9 },
    phrases: {
      A: [
        'f#5:2 a5:2 d6:4 a5:2 f#5:2 a5:4',
        'f#5:2 b5:2 d6:4 c#6:2 b5:2 f#5:4',
        'g5:2 b5:2 d6:2 g6:2 f#6:2 d6:2 b5:4',
        'e6:4 c#6:2 a5:2 c#6:2 e6:2 a6:4',
        'a6:3 f#6:3 d6:2 a6:3 f#6:3 d6:2',
        'b6:3 f#6:3 d6:2 b6:3 f#6:3 d6:2',
        'g6:2 f#6:2 e6:2 d6:2 b5:2 d6:2 g6:4',
        'a6:2 g6:2 e6:2 c#6:2 e6:6 -:2',
      ],
      B: [
        'b5:4 d6:4 g6:6 -:2',
        'c#6:4 e6:4 a6:6 -:2',
        'a6:2 f#6:2 c#6:2 f#6:2 a6:2 f#6:2 c#6:4',
        'b5:2 d6:2 f#6:2 b6:6 -:4',
        'g6:1 d6:1 b5:1 d6:1 g6:1 d6:1 b5:1 d6:1 g6:1 d6:1 b5:1 d6:1 g6:2 b6:2',
        'a6:1 e6:1 c#6:1 e6:1 a6:1 e6:1 c#6:1 e6:1 a6:1 e6:1 c#6:1 e6:1 a6:2 c#7:2',
        'd7:6 a6:2 f#6:4 d6:4',
        'd6:2 f#6:2 a6:2 d7:6 -:4',
      ],
    },
    sections: [
      { bars: 4, layers: ['bass', 'keys', 'drums'], drums: 'soft' },
      { bars: 8, layers: ['bass', 'keys', 'drums', 'lead'], lead: 'A' },
      { bars: 8, layers: ['bass', 'keys', 'drums', 'arp', 'lead'], lead: 'B', prog: ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D'] },
      { bars: 8, layers: ['bass', 'keys', 'drums', 'arp', 'lead'], lead: 'A' },
      { bars: 4, layers: ['bass', 'arp', 'drums', 'pad'], drums: 'soft' },
    ],
  },
};
