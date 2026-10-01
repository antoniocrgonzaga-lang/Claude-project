/* ==========================================================================
   input.js — Teclado, mouse (com "pointer lock") e roda do mouse
   --------------------------------------------------------------------------
   Usamos event.code (ex.: "KeyW"), que é a posição física da tecla — funciona
   em qualquer layout de teclado (ABNT2, US...).
     input.down('KeyW')     true enquanto a tecla está pressionada
     input.pressed('KeyF')  true só no frame em que foi apertada
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  ES.Input = class Input {
    constructor(canvas) {
      this.canvas = canvas;
      this.keys = new Set();
      this.edge = new Set();
      this.mx = 0;
      this.my = 0;
      this.wheel = 0;
      this.locked = false;
      this.onLockChange = null;

      const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
      window.addEventListener('keydown', (e) => {
        if (block.has(e.code)) e.preventDefault();      // evita rolar a página
        if (!e.repeat) this.edge.add(e.code);
        this.keys.add(e.code);
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.keys.clear());

      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === canvas;
        if (this.onLockChange) this.onLockChange(this.locked);
      });
      document.addEventListener('mousemove', (e) => {
        if (!this.locked) return;
        this.mx += e.movementX || 0;
        this.my += e.movementY || 0;
      });
      window.addEventListener('wheel', (e) => { this.wheel += e.deltaY; }, { passive: true });
    }

    down(code) { return this.keys.has(code); }
    pressed(code) { return this.edge.has(code); }
    shift() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

    /** Devolve o movimento do mouse acumulado desde a última leitura e zera. */
    takeMouse() {
      const m = { x: this.mx, y: this.my };
      this.mx = 0; this.my = 0;
      return m;
    }

    /** Chamar no fim de cada frame. */
    endFrame() {
      this.edge.clear();
      this.wheel = 0;
    }

    /** Captura o mouse (precisa ser chamado a partir de um clique do usuário). */
    lock() {
      try {
        const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (err) { /* sem pointer lock: o teclado continua funcionando */ }
    }
  };
})();
