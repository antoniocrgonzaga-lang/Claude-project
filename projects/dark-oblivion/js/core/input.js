// =============================================================
// input.js — lê mouse e teclado.
//
// Guardamos dois tipos de informação:
//   - "está apertado agora?"           (leftDown, keysDown)
//   - "foi apertado NESTE quadro?"     (leftPressed, wasPressed)
// O segundo tipo é limpo no fim de cada quadro (endFrame).
//
// Usamos e.code ('KeyQ', 'Digit1'...) em vez da letra digitada, assim
// funciona igual em qualquer layout de teclado (ABNT2, US etc.).
// =============================================================
import * as THREE from 'three';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mouse = new THREE.Vector2();      // posição em "NDC" (-1 a 1), usada pelo raycaster
    this.mouseScreen = { x: 0, y: 0 };     // posição em pixels
    this.leftDown = false;
    this.rightDown = false;
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
    this.keysDown = new Set();
    this.pressed = new Set();

    // O clique só conta se for NO CANVAS (clicar num painel da interface não move o personagem)
    canvas.addEventListener('mousedown', (e) => {
      this.updateMouse(e); // garante a posição certa mesmo sem mousemove antes do clique
      if (e.button === 0) { this.leftDown = true; this.leftPressed = true; }
      if (e.button === 2) { this.rightDown = true; this.rightPressed = true; }
    });
    // Soltar o botão vale em qualquer lugar
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    window.addEventListener('mousemove', (e) => this.updateMouse(e));
    // Impede o menu do botão direito sobre o jogo
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      // Não captura teclas enquanto o jogador digita (ex.: nome do personagem)
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keysDown.add(e.code);
      if (e.code === 'Tab' || e.code === 'PageUp' || e.code === 'PageDown') e.preventDefault(); // o navegador não rola a página
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));

    // Se a janela perder o foco, solta tudo (evita personagem "preso" andando)
    window.addEventListener('blur', () => {
      this.leftDown = this.rightDown = false;
      this.keysDown.clear();
    });
  }

  updateMouse(e) {
    this.mouseScreen.x = e.clientX;
    this.mouseScreen.y = e.clientY;
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  wasPressed(code) { return this.pressed.has(code); }
  // "Gasta" a tecla neste quadro: quem perguntar depois recebe false
  consume(code) { this.pressed.delete(code); }
  isDown(code) { return this.keysDown.has(code); }

  // Chamado no fim de cada quadro
  endFrame() {
    this.leftPressed = false;
    this.rightPressed = false;
    this.pressed.clear();
    this.wheel = 0;
  }
}
