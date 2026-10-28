// =============================================================
// events.js — um "mensageiro" simples entre os sistemas.
//
// Um módulo avisa que algo aconteceu:   events.emit('enemyKilled', { enemy })
// Outro módulo escuta e reage:          events.on('enemyKilled', (data) => { ... })
//
// Assim o inimigo não precisa conhecer o sistema de loot, o HUD não
// precisa conhecer o inimigo etc. Cada um só conversa pelo mensageiro.
// =============================================================

const listeners = new Map(); // nome do evento -> Set de funções

export const events = {
  // Registra uma função. Retorna outra função que, se chamada, cancela o registro.
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => this.off(name, fn);
  },

  off(name, fn) {
    listeners.get(name)?.delete(fn);
  },

  emit(name, data) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of set) fn(data);
  },
};

/*
  Eventos usados nesta versão (para referência):
  - 'enemyKilled'       { enemy, killer }
  - 'playerDied'
  - 'playerHurt'        quantidade de dano
  - 'levelUp'           player
  - 'xpChanged'
  - 'goldChanged'
  - 'potionsChanged'
  - 'statsChanged'      player
  - 'skillsChanged'
  - 'skillSlotChanged'  índice
  - 'skillBarChanged'   (habilidade colocada/trocada na barra)
  - 'inventoryChanged'
  - 'shopChanged'
  - 'areaChanged'       { kind, floor }
  - 'gameCompleted'     { boss } — o chefe final morreu
  - 'groundItemClicked' entrada do item no chão
*/
