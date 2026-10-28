// =============================================================
// timers.js — "faça isso daqui a X segundos", no tempo do JOGO.
//
// Diferente do setTimeout do navegador, estes timers:
//   - param quando o jogo pausa (troca de área, aba em segundo plano);
//   - são todos cancelados ao trocar de área (clear), então um meteoro
//     agendado no andar 3 nunca cai no vilarejo.
//
// Uso: game.timers.after(0.5, () => { ...explode... })
// =============================================================

export class Timers {
  constructor() {
    this.list = [];
  }

  after(seconds, fn) {
    this.list.push({ t: seconds, fn });
  }

  update(dt) {
    // Percorre de trás para frente: um timer pode agendar outro sem bagunçar o laço
    for (let i = this.list.length - 1; i >= 0; i--) {
      const timer = this.list[i];
      timer.t -= dt;
      if (timer.t > 0) continue;
      this.list.splice(i, 1);
      timer.fn();
    }
  }

  clear() {
    this.list.length = 0;
  }
}
