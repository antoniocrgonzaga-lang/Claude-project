/**
 * Save / load through localStorage.
 * The Game builds the save object (Game.serialize) and applies it
 * (Game.deserialize); this module only handles storage.
 */
import { CONFIG } from './config.js';

export function saveGame(data) {
  try {
    localStorage.setItem(CONFIG.save.key, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('Save failed:', err);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(CONFIG.save.key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== CONFIG.version || data.seed !== CONFIG.seed) return null;
    return data;
  } catch (err) {
    console.warn('Load failed:', err);
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(CONFIG.save.key); } catch { /* ignore */ }
}

export function hasSave() {
  return loadGame() !== null;
}
