// =============================================================
// classes/index.js — junta todas as classes num só lugar.
// Para criar uma classe nova: crie o arquivo (copie um existente)
// e adicione aqui.
// =============================================================
import { witch } from './witch.js';
import { knight } from './knight.js';
import { archer } from './archer.js';

export const CLASSES = { witch, knight, archer };

// Ordem em que aparecem na tela de escolha
export const CLASS_ORDER = ['knight', 'witch', 'archer'];
