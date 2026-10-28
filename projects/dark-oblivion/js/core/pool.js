// =============================================================
// pool.js — "piscina" de objetos reutilizáveis.
//
// Criar e destruir objetos 3D toda hora (ex.: um efeito por golpe)
// deixa o jogo lento e faz o coletor de lixo do navegador travar.
// Com um pool, pegamos um objeto livre (acquire), usamos, e depois
// devolvemos (release) para ser reaproveitado na próxima vez.
// =============================================================

export class Pool {
  // createFn: função que cria um objeto novo quando não há nenhum livre
  // resetFn:  (opcional) função chamada ao devolver o objeto, para "limpá-lo"
  constructor(createFn, resetFn = null) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.free = [];          // objetos disponíveis
    this.active = new Set(); // objetos em uso
  }

  acquire() {
    const obj = this.free.length ? this.free.pop() : this.createFn();
    this.active.add(obj);
    return obj;
  }

  release(obj) {
    if (!this.active.delete(obj)) return; // já estava livre
    this.resetFn?.(obj);
    this.free.push(obj);
  }

  releaseAll() {
    for (const obj of [...this.active]) this.release(obj);
  }
}
