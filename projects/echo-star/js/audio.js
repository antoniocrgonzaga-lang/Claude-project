/* ==========================================================================
   audio.js — Sons gerados por código (WebAudio), sem arquivos de áudio
   --------------------------------------------------------------------------
   - Ambiente: um "pad" grave e lento, misterioso
   - Motor da nave: oscilador que sobe de tom com o acelerador
   - Efeitos: coleta de cristal, pulso de eco, pouso
   O navegador só libera áudio depois de um clique, por isso unlock().
   Tecla M silencia.
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  ES.Audio = class GameAudio {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.master = null;
    }

    /** Cria o contexto de áudio (chamar a partir de um clique). */
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(ctx.destination);

      // --- Pad ambiente: 3 senoides graves com tremolo lento ---
      this.padGain = ctx.createGain();
      this.padGain.gain.value = 0.05;
      this.padGain.connect(this.master);
      [55, 82.41, 110.5].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.5 / (i + 1);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07 + i * 0.05;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.25;
        lfo.connect(lfoGain).connect(g.gain);
        o.connect(g).connect(this.padGain);
        o.start(); lfo.start();
      });

      // --- Motor ---
      this.engOsc = ctx.createOscillator();
      this.engOsc.type = 'sawtooth';
      this.engOsc.frequency.value = 50;
      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass';
      this.engFilter.frequency.value = 220;
      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.engOsc.connect(this.engFilter).connect(this.engGain).connect(this.master);
      this.engOsc.start();
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
      return this.muted;
    }

    /** level 0..1 (acelerador), boost true/false, active false = sem som de motor (a pé). */
    setEngine(level, boost, active) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const target = active ? 0.02 + level * (boost ? 0.16 : 0.1) : 0;
      this.engGain.gain.setTargetAtTime(target, t, 0.08);
      this.engOsc.frequency.setTargetAtTime(48 + level * (boost ? 70 : 38), t, 0.1);
      this.engFilter.frequency.setTargetAtTime(180 + level * (boost ? 700 : 350), t, 0.1);
    }

    /** Nota simples com envelope. */
    _tone(freq, start, dur, type, vol, slideTo) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime + start;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    }

    /** Coleta: arpejo curto; cada tipo de recurso tem um tom diferente. */
    collect(kind) {
      const base = { crystal: 880, core: 659, essence: 988 }[kind] || 880;
      this._tone(base, 0, 0.35, 'sine', 0.22);
      this._tone(base * 1.5, 0.07, 0.4, 'sine', 0.18);
      this._tone(base * 2, 0.14, 0.5, 'triangle', 0.12);
    }

    /** Pulso de eco: varredura grave -> aguda. */
    ping() {
      this._tone(180, 0, 1.2, 'sine', 0.3, 900);
      this._tone(360, 0.05, 1.0, 'triangle', 0.1, 1400);
    }

    /** Pouso/aterrissagem do personagem. */
    thud() { this._tone(90, 0, 0.25, 'sine', 0.3, 40); }

    /** Confirmações de UI. */
    blip(up) { this._tone(up ? 520 : 380, 0, 0.15, 'square', 0.06, up ? 780 : 260); }
  };
})();
