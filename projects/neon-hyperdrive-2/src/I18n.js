// Textos do jogo em português, inglês e alemão.
// Uso: t('chave', { parametros }). Uma chave sem tradução é devolvida como está
// (útil para nomes próprios e para os letreiros em japonês).
// No HTML: data-i18n="chave" troca o texto; data-i18n-html="chave" troca o HTML (apenas textos deste arquivo).

export const LANGUAGES = [
  { id: 'pt', label: 'PORTUGUÊS', html: 'pt-BR' },
  { id: 'en', label: 'ENGLISH', html: 'en' },
  { id: 'de', label: 'DEUTSCH', html: 'de' },
];

const ordinalEn = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}TH`;
  return `${n}${{ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH'}`;
};

const STRINGS = {
  pt: {
    'title.sub': 'LIGA ANTIGRAVITACIONAL · 2187',
    'title.footnote': 'W A S D / SETAS · SHIFT BOOST · ESPAÇO DRIFT',
    'menu.play': 'INICIAR CORRIDA',
    'menu.help': 'INSTRUÇÕES',
    'menu.options': 'OPÇÕES',
    'btn.back': 'VOLTAR',
    'btn.next': 'AVANÇAR',
    'btn.start': 'LARGAR',
    'ship.title': 'SELECIONE SUA NAVE',
    'track.title': 'SELECIONE A PISTA',

    'key.space': 'ESPAÇO',
    'help.title': 'INSTRUÇÕES',
    'help.accel': 'Acelerar',
    'help.brake': 'Frear',
    'help.steer': 'Virar',
    'help.boost': 'Boost (consome carga e energia)',
    'help.drift': 'Drift / freio lateral',
    'help.reset': 'Reposicionar a nave na pista',
    'help.camera': 'Alternar câmera',
    'help.pause': 'Pausar',
    'help.tip1': '<b class="c-orange">Faixas laranja</b> dão boost gratuito e recarregam o capacitor.',
    'help.tip2': '<b class="c-green">Faixas verdes</b> recuperam a energia da nave.',
    'help.tip3': '<b class="c-cyan">Plataformas brancas</b> lançam a nave em pequenos saltos.',
    'help.tip4': '<b class="c-red">Trechos com bordas vermelhas</b> não têm barreira: cair custa energia e tempo.',
    'help.tip5': 'Energia é vida e combustível: colisões e boost a consomem. Se zerar, a nave explode.',
    'help.tip6': 'Use o drift nas curvas fechadas para girar mais rápido, ao custo de velocidade.',

    'options.title': 'OPÇÕES',
    'opt.language': 'IDIOMA',
    'opt.difficulty': 'DIFICULDADE',
    'opt.difficultyNote': 'A nova dificuldade vale a partir da próxima largada.',
    'opt.quality': 'QUALIDADE GRÁFICA',
    'opt.crt': 'EFEITO CRT',
    'opt.shadows': 'SOMBRAS',
    'opt.master': 'VOLUME GERAL',
    'opt.music': 'VOLUME DA MÚSICA',
    'opt.engine': 'VOLUME DO MOTOR',
    'opt.sfx': 'VOLUME DOS EFEITOS',
    'quality.low': 'BAIXO',
    'quality.medium': 'MÉDIO',
    'quality.high': 'ALTO',
    'diff.casual': 'CASUAL',
    'diff.hard': 'DIFÍCIL',

    'pause.title': 'PAUSA',
    'pause.resume': 'CONTINUAR',
    'pause.restart': 'REINICIAR CORRIDA',
    'pause.quit': 'SAIR PARA O MENU',

    'results.title': 'RESULTADO FINAL',
    'results.win': 'VITÓRIA!',
    'results.again': 'CORRER NOVAMENTE',
    'results.menu': 'MENU PRINCIPAL',
    'results.sub': '{track} · DIFICULDADE {difficulty}',
    'results.pos': 'POS',
    'results.pilot': 'PILOTO',
    'results.ship': 'NAVE',
    'results.time': 'TEMPO',
    'results.best': 'MELHOR VOLTA',
    'place': ({ n }) => `${n}º LUGAR`,
    'posShort': ({ n }) => `${n}º`,

    'hud.lap': 'VOLTA',
    'hud.time': 'TEMPO',
    'hud.lapTime': 'VOLTA',
    'hud.best': 'MELHOR',
    'hud.energy': 'ENERGIA',
    'hud.boostOn': 'ATIVO',
    'hud.wrongWay': 'CONTRAMÃO',
    'hud.go': 'GO!',
    'player.name': 'VOCÊ',

    'msg.camera': 'CÂMERA {mode}',
    'cam.near': 'PRÓXIMA',
    'cam.far': 'DISTANTE',
    'cam.cockpit': 'COCKPIT',
    'msg.destroyed': 'NAVE DESTRUÍDA',
    'msg.fall': 'FORA DA PISTA',
    'msg.checkpoint': 'CHECKPOINT {index}/{total}',
    'msg.finish': 'CHEGADA!',
    'msg.bestLap': 'NOVA MELHOR VOLTA',
    'msg.lap': 'VOLTA {lap}',
    'msg.finalLap': 'VOLTA FINAL',

    'stat.speed': 'VELOCIDADE',
    'stat.accel': 'ACELERAÇÃO',
    'stat.handling': 'CONTROLE',
    'stat.energy': 'ENERGIA',
    'stat.boost': 'BOOST',
    'card.difficulty': 'DIFICULDADE',
    'card.length': 'EXTENSÃO',
    'trackDiff.medium': 'MÉDIA',
    'trackDiff.mediumHigh': 'MÉDIA-ALTA',
    'trackDiff.high': 'ALTA',

    'ship.falcon.blurb': 'Equilibrada. Responde bem em qualquer circuito.',
    'ship.spear.blurb': 'Velocidade máxima brutal, controle exigente.',
    'ship.warden.blurb': 'Casco reforçado e muita energia, arrancada lenta.',
    'track.aurora.blurb': 'Retas longas, um grampo traiçoeiro e um trecho elevado sem proteção.',
    'track.abyss.blurb': 'Ferradura apertada, sequência de curvas e longos trechos sobre o vazio.',
    'track.carnival.blurb': 'Parque de diversões à meia-noite: subidas de montanha-russa, descidas cegas e fogos no céu.',
    'track.tokyo.blurb': 'Via expressa elevada entre arranha-céus e letreiros de neon, sob um sol vermelho atrás do monte.',
    'track.ice.blurb': 'Vila de fiorde sob a aurora boreal: curvas longas sobre gelo, com menos aderência que nas outras pistas.',

    'banner.league': 'LIGA ANTIGRAV 2187',
    'banner.topSpeed': 'VELOCIDADE MÁXIMA',
    'banner.ion': 'ÍON · PLASMA · LUZ',
    'banner.spin': 'GIRE · GRITE · VOE',
    'banner.fright': 'TÚNEL DO ESPANTO',
    'banner.candy': 'ALGODÃO QUÂNTICO',
    'banner.village': 'VILA DO FIORDE',
    'banner.thinIce': 'GELO FINO',
    'banner.below': '40 GRAUS ABAIXO',

    'error.intro': 'NEON HYPERDRIVE 2 encontrou um problema.',
    'error.outro': 'Recarregue a página (F5). Se persistir, abra o jogo pelo start.bat ou pelo link do GitHub Pages, num navegador atualizado.',
    'error.file': 'O jogo precisa ser aberto por um servidor local (módulos ES não funcionam via file://).',
    'error.webgl': 'Seu navegador ou placa de vídeo não oferece suporte a WebGL 2.',
  },

  en: {
    'title.sub': 'ANTI-GRAVITY LEAGUE · 2187',
    'title.footnote': 'W A S D / ARROWS · SHIFT BOOST · SPACE DRIFT',
    'menu.play': 'START RACE',
    'menu.help': 'HOW TO PLAY',
    'menu.options': 'OPTIONS',
    'btn.back': 'BACK',
    'btn.next': 'NEXT',
    'btn.start': 'START',
    'ship.title': 'SELECT YOUR SHIP',
    'track.title': 'SELECT THE TRACK',

    'key.space': 'SPACE',
    'help.title': 'HOW TO PLAY',
    'help.accel': 'Accelerate',
    'help.brake': 'Brake',
    'help.steer': 'Steer',
    'help.boost': 'Boost (uses charge and energy)',
    'help.drift': 'Drift / side brake',
    'help.reset': 'Put the ship back on the track',
    'help.camera': 'Switch camera',
    'help.pause': 'Pause',
    'help.tip1': '<b class="c-orange">Orange strips</b> give a free boost and recharge the capacitor.',
    'help.tip2': '<b class="c-green">Green lanes</b> restore your ship\'s energy.',
    'help.tip3': '<b class="c-cyan">White platforms</b> launch the ship into short jumps.',
    'help.tip4': '<b class="c-red">Sections with red edges</b> have no barrier: falling off costs energy and time.',
    'help.tip5': 'Energy is both health and fuel: collisions and boost drain it. If it hits zero, the ship explodes.',
    'help.tip6': 'Drift through tight corners to turn faster, at the cost of speed.',

    'options.title': 'OPTIONS',
    'opt.language': 'LANGUAGE',
    'opt.difficulty': 'DIFFICULTY',
    'opt.difficultyNote': 'The new difficulty applies from the next race start.',
    'opt.quality': 'GRAPHICS QUALITY',
    'opt.crt': 'CRT EFFECT',
    'opt.shadows': 'SHADOWS',
    'opt.master': 'MASTER VOLUME',
    'opt.music': 'MUSIC VOLUME',
    'opt.engine': 'ENGINE VOLUME',
    'opt.sfx': 'EFFECTS VOLUME',
    'quality.low': 'LOW',
    'quality.medium': 'MEDIUM',
    'quality.high': 'HIGH',
    'diff.casual': 'CASUAL',
    'diff.hard': 'HARD',

    'pause.title': 'PAUSED',
    'pause.resume': 'RESUME',
    'pause.restart': 'RESTART RACE',
    'pause.quit': 'QUIT TO MENU',

    'results.title': 'FINAL RESULTS',
    'results.win': 'VICTORY!',
    'results.again': 'RACE AGAIN',
    'results.menu': 'MAIN MENU',
    'results.sub': '{track} · {difficulty} DIFFICULTY',
    'results.pos': 'POS',
    'results.pilot': 'PILOT',
    'results.ship': 'SHIP',
    'results.time': 'TIME',
    'results.best': 'BEST LAP',
    'place': ({ n }) => `${ordinalEn(n)} PLACE`,
    'posShort': ({ n }) => ordinalEn(n),

    'hud.lap': 'LAP',
    'hud.time': 'TIME',
    'hud.lapTime': 'LAP',
    'hud.best': 'BEST',
    'hud.energy': 'ENERGY',
    'hud.boostOn': 'ACTIVE',
    'hud.wrongWay': 'WRONG WAY',
    'hud.go': 'GO!',
    'player.name': 'YOU',

    'msg.camera': 'CAMERA {mode}',
    'cam.near': 'CLOSE',
    'cam.far': 'FAR',
    'cam.cockpit': 'COCKPIT',
    'msg.destroyed': 'SHIP DESTROYED',
    'msg.fall': 'OFF THE TRACK',
    'msg.checkpoint': 'CHECKPOINT {index}/{total}',
    'msg.finish': 'FINISH!',
    'msg.bestLap': 'NEW BEST LAP',
    'msg.lap': 'LAP {lap}',
    'msg.finalLap': 'FINAL LAP',

    'stat.speed': 'SPEED',
    'stat.accel': 'ACCELERATION',
    'stat.handling': 'HANDLING',
    'stat.energy': 'ENERGY',
    'stat.boost': 'BOOST',
    'card.difficulty': 'DIFFICULTY',
    'card.length': 'LENGTH',
    'trackDiff.medium': 'MEDIUM',
    'trackDiff.mediumHigh': 'MEDIUM-HIGH',
    'trackDiff.high': 'HIGH',

    'ship.falcon.blurb': 'Balanced. Handles well on any circuit.',
    'ship.spear.blurb': 'Brutal top speed, demanding handling.',
    'ship.warden.blurb': 'Reinforced hull and lots of energy, slow off the line.',
    'track.aurora.blurb': 'Long straights, a treacherous hairpin and an elevated section with no barriers.',
    'track.abyss.blurb': 'A tight horseshoe, a run of corners and long stretches over the void.',
    'track.carnival.blurb': 'A midnight amusement park: roller-coaster climbs, blind drops and fireworks in the sky.',
    'track.tokyo.blurb': 'An elevated expressway between skyscrapers and neon signs, under a red sun behind the mountain.',
    'track.ice.blurb': 'A fjord village under the northern lights: long corners on ice, with less grip than on the other tracks.',

    'banner.league': 'ANTIGRAV LEAGUE 2187',
    'banner.topSpeed': 'TOP SPEED',
    'banner.ion': 'ION · PLASMA · LIGHT',
    'banner.spin': 'SPIN · SCREAM · FLY',
    'banner.fright': 'TUNNEL OF FRIGHT',
    'banner.candy': 'QUANTUM CANDY FLOSS',
    'banner.village': 'FJORD VILLAGE',
    'banner.thinIce': 'THIN ICE',
    'banner.below': '40 BELOW ZERO',

    'error.intro': 'NEON HYPERDRIVE 2 ran into a problem.',
    'error.outro': 'Reload the page (F5). If it keeps happening, open the game with start.bat or through the GitHub Pages link, in an up-to-date browser.',
    'error.file': 'The game must be opened through a local server (ES modules do not work over file://).',
    'error.webgl': 'Your browser or graphics card does not support WebGL 2.',
  },

  de: {
    'title.sub': 'ANTIGRAVITATIONS-LIGA · 2187',
    'title.footnote': 'W A S D / PFEILTASTEN · SHIFT BOOST · LEERTASTE DRIFT',
    'menu.play': 'RENNEN STARTEN',
    'menu.help': 'ANLEITUNG',
    'menu.options': 'OPTIONEN',
    'btn.back': 'ZURÜCK',
    'btn.next': 'WEITER',
    'btn.start': 'STARTEN',
    'ship.title': 'WÄHLE DEIN SCHIFF',
    'track.title': 'WÄHLE DIE STRECKE',

    'key.space': 'LEERTASTE',
    'help.title': 'ANLEITUNG',
    'help.accel': 'Beschleunigen',
    'help.brake': 'Bremsen',
    'help.steer': 'Lenken',
    'help.boost': 'Boost (verbraucht Ladung und Energie)',
    'help.drift': 'Drift / Seitenbremse',
    'help.reset': 'Schiff zurück auf die Strecke setzen',
    'help.camera': 'Kamera wechseln',
    'help.pause': 'Pause',
    'help.tip1': '<b class="c-orange">Orange Streifen</b> geben einen Gratis-Boost und laden den Kondensator auf.',
    'help.tip2': '<b class="c-green">Grüne Spuren</b> stellen die Energie deines Schiffs wieder her.',
    'help.tip3': '<b class="c-cyan">Weiße Plattformen</b> katapultieren das Schiff in kurze Sprünge.',
    'help.tip4': '<b class="c-red">Abschnitte mit roten Rändern</b> haben keine Barriere: Ein Absturz kostet Energie und Zeit.',
    'help.tip5': 'Energie ist Leben und Treibstoff zugleich: Kollisionen und Boost verbrauchen sie. Fällt sie auf null, explodiert das Schiff.',
    'help.tip6': 'Nutze den Drift in engen Kurven, um schneller einzulenken – auf Kosten der Geschwindigkeit.',

    'options.title': 'OPTIONEN',
    'opt.language': 'SPRACHE',
    'opt.difficulty': 'SCHWIERIGKEIT',
    'opt.difficultyNote': 'Die neue Schwierigkeit gilt ab dem nächsten Start.',
    'opt.quality': 'GRAFIKQUALITÄT',
    'opt.crt': 'CRT-EFFEKT',
    'opt.shadows': 'SCHATTEN',
    'opt.master': 'GESAMTLAUTSTÄRKE',
    'opt.music': 'MUSIKLAUTSTÄRKE',
    'opt.engine': 'MOTORLAUTSTÄRKE',
    'opt.sfx': 'EFFEKTLAUTSTÄRKE',
    'quality.low': 'NIEDRIG',
    'quality.medium': 'MITTEL',
    'quality.high': 'HOCH',
    'diff.casual': 'LOCKER',
    'diff.hard': 'SCHWER',

    'pause.title': 'PAUSE',
    'pause.resume': 'WEITER',
    'pause.restart': 'RENNEN NEU STARTEN',
    'pause.quit': 'ZUM HAUPTMENÜ',

    'results.title': 'ENDERGEBNIS',
    'results.win': 'SIEG!',
    'results.again': 'NOCHMAL FAHREN',
    'results.menu': 'HAUPTMENÜ',
    'results.sub': '{track} · SCHWIERIGKEIT {difficulty}',
    'results.pos': 'POS',
    'results.pilot': 'PILOT',
    'results.ship': 'SCHIFF',
    'results.time': 'ZEIT',
    'results.best': 'BESTE RUNDE',
    'place': ({ n }) => `${n}. PLATZ`,
    'posShort': ({ n }) => `${n}.`,

    'hud.lap': 'RUNDE',
    'hud.time': 'ZEIT',
    'hud.lapTime': 'RUNDE',
    'hud.best': 'BESTE',
    'hud.energy': 'ENERGIE',
    'hud.boostOn': 'AKTIV',
    'hud.wrongWay': 'FALSCHE RICHTUNG',
    'hud.go': 'LOS!',
    'player.name': 'DU',

    'msg.camera': 'KAMERA {mode}',
    'cam.near': 'NAH',
    'cam.far': 'FERN',
    'cam.cockpit': 'COCKPIT',
    'msg.destroyed': 'SCHIFF ZERSTÖRT',
    'msg.fall': 'VON DER STRECKE',
    'msg.checkpoint': 'CHECKPOINT {index}/{total}',
    'msg.finish': 'ZIEL!',
    'msg.bestLap': 'NEUE BESTE RUNDE',
    'msg.lap': 'RUNDE {lap}',
    'msg.finalLap': 'LETZTE RUNDE',

    'stat.speed': 'TEMPO',
    'stat.accel': 'BESCHLEUNIGUNG',
    'stat.handling': 'KONTROLLE',
    'stat.energy': 'ENERGIE',
    'stat.boost': 'BOOST',
    'card.difficulty': 'SCHWIERIGKEIT',
    'card.length': 'LÄNGE',
    'trackDiff.medium': 'MITTEL',
    'trackDiff.mediumHigh': 'MITTEL-HOCH',
    'trackDiff.high': 'HOCH',

    'ship.falcon.blurb': 'Ausgewogen. Fährt sich auf jeder Strecke gut.',
    'ship.spear.blurb': 'Brutale Höchstgeschwindigkeit, anspruchsvolles Handling.',
    'ship.warden.blurb': 'Verstärkte Hülle und viel Energie, träger Antritt.',
    'track.aurora.blurb': 'Lange Geraden, eine tückische Haarnadel und ein erhöhter Abschnitt ohne Schutz.',
    'track.abyss.blurb': 'Enges Hufeisen, eine Kurvenfolge und lange Passagen über dem Abgrund.',
    'track.carnival.blurb': 'Ein Vergnügungspark um Mitternacht: Achterbahn-Anstiege, blinde Abfahrten und Feuerwerk am Himmel.',
    'track.tokyo.blurb': 'Eine Hochstraße zwischen Wolkenkratzern und Neonschildern, unter einer roten Sonne hinter dem Berg.',
    'track.ice.blurb': 'Ein Fjorddorf unter dem Nordlicht: lange Kurven auf Eis, mit weniger Grip als auf den anderen Strecken.',

    'banner.league': 'ANTIGRAV-LIGA 2187',
    'banner.topSpeed': 'HÖCHSTTEMPO',
    'banner.ion': 'ION · PLASMA · LICHT',
    'banner.spin': 'DREHEN · SCHREIEN · FLIEGEN',
    'banner.fright': 'GEISTERTUNNEL',
    'banner.candy': 'QUANTEN-ZUCKERWATTE',
    'banner.village': 'FJORDDORF',
    'banner.thinIce': 'DÜNNES EIS',
    'banner.below': '40 GRAD MINUS',

    'error.intro': 'NEON HYPERDRIVE 2 ist auf ein Problem gestoßen.',
    'error.outro': 'Lade die Seite neu (F5). Falls es weiterhin passiert, starte das Spiel über start.bat oder den GitHub-Pages-Link in einem aktuellen Browser.',
    'error.file': 'Das Spiel muss über einen lokalen Server geöffnet werden (ES-Module funktionieren nicht über file://).',
    'error.webgl': 'Dein Browser oder deine Grafikkarte unterstützt kein WebGL 2.',
  },
};

let current = 'pt';

/** Idioma inicial sugerido pelo navegador (inglês para idiomas sem tradução). */
export function detectLanguage() {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  for (const tag of list) {
    const id = String(tag).slice(0, 2).toLowerCase();
    if (STRINGS[id]) return id;
  }
  return 'en';
}

export function isLanguage(id) { return Object.hasOwn(STRINGS, id); }

export function getLanguage() { return current; }

export function setLanguage(id) {
  current = isLanguage(id) ? id : 'pt';
  document.documentElement.lang = LANGUAGES.find((l) => l.id === current).html;
  translateDom();
}

export function t(key, params = {}) {
  const value = STRINGS[current][key] ?? STRINGS.pt[key];
  if (value == null) return key;
  if (typeof value === 'function') return value(params);
  return value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m));
}

/** Atualiza todos os elementos marcados com data-i18n / data-i18n-html. */
export function translateDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
}
