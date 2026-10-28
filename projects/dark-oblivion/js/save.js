// =============================================================
// save.js — salvar e carregar personagens no localStorage.
//
// Tudo fica numa chave só (CONFIG.save.key), em JSON:
//   { version: 1, characters: { [id]: dadosDoPersonagem } }
//
// O campo `version` permite, no futuro, converter saves antigos
// (função migrate) quando o formato mudar.
//
// Obs.: o localStorage é do navegador + endereço. Se você abrir o jogo
// em outra porta (ex.: :8080 em vez de :8000), os saves não aparecem.
// =============================================================
import { CONFIG } from './config.js';

const KEY = CONFIG.save.key;

function emptyData() {
  return { version: CONFIG.save.version, characters: {} };
}

function migrate(data) {
  // Exemplo para o futuro:
  // if (data.version === 1) { ...converter...; data.version = 2; }
  if (!data || typeof data !== 'object' || !data.characters) return emptyData();
  return data;
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : emptyData();
  } catch (err) {
    console.warn('[save] Não consegui ler os saves.', err);
    return emptyData();
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[save] Não consegui salvar.', err);
    return false;
  }
}

export function saveGame(player) {
  if (!player) return false;
  const all = readAll();
  all.characters[player.id] = { ...player.toSaveData(), savedAt: Date.now() };
  return writeAll(all);
}

// Lista de personagens salvos, do mais recente para o mais antigo
export function listSaves() {
  return Object.values(readAll().characters).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function loadSave(id) {
  return readAll().characters[id] ?? null;
}

export function deleteSave(id) {
  const all = readAll();
  delete all.characters[id];
  writeAll(all);
}
