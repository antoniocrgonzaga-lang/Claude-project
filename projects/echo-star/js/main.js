/* ==========================================================================
   main.js — Echo Star: monta o universo e roda o loop do jogo
   --------------------------------------------------------------------------
   Visão geral
     mode 'SHIP'  você está na nave (ship.state: FLIGHT / LANDING / LANDED / TAKEOFF)
     mode 'FOOT'  você saiu da nave e anda pelo planeta

   Cada frame (veja Game._update):
     1. lê as teclas e atualiza a nave OU o personagem
     2. anima planetas e efeitos
     3. calcula para onde a câmera deve ir e deixa o CameraRig suavizar
     4. ajusta céu, névoa e luz conforme a altitude/hora do dia no planeta
     5. atualiza o HUD e os sons

   Dica: abra o jogo com ?seed=123 para sempre gerar o mesmo universo,
   ou com ?debug=1 para ver o FPS.
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  /* Ajustes de jogo */
  const NUM_PLANETS = 6;
  const LAND_RANGE = 85;        // altura máxima acima do chão para poder pousar (L)
  const ENTER_DIST = 9;         // distância máxima da nave para poder entrar (F)
  const COLLECT_RADIUS = 2.7;   // raio de coleta dos recursos
  const ECHO_COOLDOWN = 5;      // segundos entre pulsos de eco
  const ECHO_RADIUS = 95;       // alcance do pulso de eco

  const _X = new THREE.Vector3(1, 0, 0);
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _white = new THREE.Color(1, 1, 1);

  class Game {
    constructor() {
      const params = new URLSearchParams(location.search);
      this.seed = parseInt(params.get('seed'), 10) || Math.floor(Math.random() * 1e9) + 1;
      this.debug = params.has('debug');

      this.started = false;
      this.paused = true;
      this.time = 0;
      this.mode = 'SHIP';
      this.landedTime = 0;
      this.echoCd = 0;
      this.inv = { crystal: 0, core: 0, essence: 0 };
      this.nearest = null;
      this.nearestAlt = Infinity;
      this.shipRef = { planet: null, alt: Infinity, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) };
      this.footTime = 0;
      this.fps = 60;

      if (!this._initRenderer()) return;
      this._buildWorld();
      this._bindUI();

      this.hud.showOverlay('Pronto para decolar?', 'Clique para iniciar', 'Semente do universo: ' + this.seed);
      this.hud.setCounts(this.inv);
      this._updateExplored();
      this.last = performance.now();
      this._frame = this._frame.bind(this);
      requestAnimationFrame(this._frame);
    }

    /* ======================= INICIALIZAÇÃO ======================= */
    _initRenderer() {
      const canvas = document.getElementById('game');
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      } catch (err) {
        document.getElementById('overlay-title').textContent = 'Seu navegador não conseguiu iniciar o WebGL.';
        document.getElementById('overlay-btn').style.display = 'none';
        return false;
      }
      this.canvas = canvas;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x000000);
      this.scene.fog = new THREE.FogExp2(0x000000, 0);
      this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 40000);
      this.camRig = new ES.CameraRig(this.camera);

      window.addEventListener('resize', () => {
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
      });
      return true;
    }

    /** Gera o universo inteiro a partir da semente. */
    _buildWorld() {
      const rng = ES.makeRng(this.seed);
      this.sunDir = new THREE.Vector3(0.7, 0.4, 0.35).normalize();

      // Luzes: o sol (direcional) e uma luz ambiente fraca (para o lado escuro não ficar preto total).
      // A luz de hemisfério (céu azul em cima, chão escuro embaixo) é apontada para o "cima" do planeta
      // onde estamos (ver _updateEnvironment) — dá o sombreamento suave de um céu de verdade.
      this.sunLight = new THREE.DirectionalLight(0xfff0dd, 1.15);
      this.sunLight.position.copy(this.sunDir).multiplyScalar(100);
      this.ambient = new THREE.AmbientLight(0x5560a0, 0.85);
      this.hemi = new THREE.HemisphereLight(0x9fc8ff, 0x3a3028, 0);
      this.scene.add(this.sunLight, this.ambient, this.hemi);

      this.space = new ES.Space(this.scene, this.sunDir, rng);

      // --- Planetas ---
      // O primeiro (casa) é sempre verdejante e fica na frente da nave; os outros são sorteados.
      const keys = Object.keys(ES.PLANET_TYPES);
      const types = ['verdant'].concat(rng.shuffle(keys.filter((k) => k !== 'verdant')));
      types.push(rng.pick(keys));
      const centers = [new THREE.Vector3(30, -12, -310)];
      const radii = [62];
      for (let i = 1; i < NUM_PLANETS; i++) {
        const r = rng.range(42, 86);
        let c = null;
        for (let tries = 0; tries < 300 && !c; tries++) {
          const cand = rng.unit(new THREE.Vector3()).multiplyScalar(rng.range(520, 1900));
          let ok = cand.length() > 380;
          for (let j = 0; j < centers.length && ok; j++) ok = cand.distanceTo(centers[j]) > 420 + r + radii[j] * 0.5;
          if (ok) c = cand;
        }
        centers.push(c || rng.unit(new THREE.Vector3()).multiplyScalar(2400 + i * 500));
        radii.push(r);
      }
      const used = new Set();
      this.planets = [];
      for (let i = 0; i < NUM_PLANETS; i++) {
        this.planets.push(new ES.Planet({
          scene: this.scene, seed: this.seed * 31 + i * 7919 + 17, typeKey: types[i],
          name: ES.makePlanetName(rng, used), center: centers[i], radius: radii[i],
          sunDir: this.sunDir, withRing: i > 0 && rng.chance(0.4),
        }));
      }

      // --- Nave, personagem e efeitos ---
      this.ship = new ES.Ship(this.scene);
      this.ship.pos.set(0, 0, 0);
      this.ship.vel.set(0, 0, -12);
      this.player = new ES.Player(this.scene);
      this.shipShadow = new ES.BlobShadow(this.scene);
      this.playerShadow = new ES.BlobShadow(this.scene);
      this.echo = new ES.EchoPulse(this.scene);
      this.burst = new ES.Burst(this.scene);

      this._horizon = new THREE.Color();
      this._zenith = new THREE.Color();
      this._camPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62, kPos: 12, kQuat: 9 };
      this._updateShipRef();
      this._computeCameraPose(this._camPose);
      this.camRig.snapTo(this._camPose);
      this.camera.position.copy(this.camRig.pos);
      this.camera.quaternion.copy(this.camRig.quat);
    }

    _bindUI() {
      this.input = new ES.Input(this.canvas);
      this.audio = new ES.Audio();
      this.hud = new ES.HUD();

      const start = () => this.begin();
      document.getElementById('overlay').addEventListener('click', start);
      // Se o mouse ficou solto (ex.: Esc rápido demais), clicar no jogo captura de novo.
      this.canvas.addEventListener('click', () => { if (this.started && !this.paused && !this.input.locked) this.input.lock(); });
      this.input.onLockChange = (locked) => {
        if (!locked && this.started && !this.paused) this.pause();
      };
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.started && !this.paused) this.pause(); });
    }

    /* ======================= PAUSA / INÍCIO ======================= */
    begin() {
      this.started = true;
      this.paused = false;
      this.audio.unlock();
      this.input.lock();
      this.hud.hideOverlay();
      this.last = performance.now();
    }

    pause() {
      this.paused = true;
      this.audio.setEngine(0, false, false);
      this.hud.showOverlay('Jogo pausado', 'Continuar', 'Semente do universo: ' + this.seed);
    }

    /* ======================= LOOP ======================= */
    _frame(now) {
      requestAnimationFrame(this._frame);
      const raw = (now - this.last) / 1000;
      this.last = now;
      const dt = Math.min(0.05, Math.max(0.0001, raw));
      this.fps = ES.lerp(this.fps, 1 / Math.max(raw, 0.0001), 0.05);

      if (!this.paused) {
        this.time += dt;
        this._update(dt);
      } else {
        this.input.takeMouse();
      }
      this.renderer.render(this.scene, this.camera);
      this.input.endFrame();
    }

    _update(dt) {
      const inp = this.input;

      // Teclas globais
      if (inp.pressed('KeyH')) this.hud.toggleHelp();
      if (inp.pressed('KeyM')) this.hud.toast(this.audio.toggleMute() ? 'Som <b>desligado</b>' : 'Som <b>ligado</b>');
      if (inp.pressed('Escape') && !inp.locked) { this.pause(); return; }

      if (this.mode === 'SHIP') this._updateShip(dt);
      else this._updateFoot(dt);

      // Reabastece enquanto a nave está pousada.
      if (this.ship.state === 'LANDED') this.ship.fuel = Math.min(this.ship.maxFuel, this.ship.fuel + 6 * dt);

      this.ship.updateVisuals(dt, this.time);
      this._updateShipRef();
      for (const p of this.planets) p.update(dt, this.time);
      this.echo.update(dt);
      this.burst.update(dt);
      this._updateShadows();

      // Câmera
      this._computeCameraPose(this._camPose);
      this.camRig.update(dt, this._camPose);

      // Ambiente (depende da posição final da câmera)
      this._updateEnvironment(dt);
      this._updateHud(dt);

      const flying = this.mode === 'SHIP' && this.ship.state !== 'LANDED';
      this.audio.setEngine(this.ship.throttle, this.ship.boosting, flying);
    }

    /* ======================= NAVE ======================= */
    _updateShip(dt) {
      const s = this.ship, inp = this.input;
      switch (s.state) {
        case 'FLIGHT':
          s.updateFlight(dt, inp, this.planets);
          if (inp.pressed('KeyL')) this._tryLand();
          break;
        case 'LANDING':
          inp.takeMouse();
          if (s.updateLanding(dt)) this._onLanded();
          break;
        case 'LANDED':
          inp.takeMouse();
          this.landedTime += dt;
          if (inp.pressed('KeyF')) this._exitShip();
          else if (inp.pressed('Space') && this.landedTime > 1.0) {
            s.beginTakeoff();
            this.audio.blip(true);
          }
          break;
        case 'TAKEOFF':
          inp.takeMouse();
          if (s.updateTakeoff(dt)) { s.mouseAcc.x = s.mouseAcc.y = 0; s.rates.pitch = s.rates.yaw = s.rates.roll = 0; }
          break;
      }
    }

    _tryLand() {
      const ref = this.shipRef;
      if (ref.planet && ref.alt < LAND_RANGE) {
        this.ship.beginLanding(ref.planet);
        this.audio.blip(false);
      } else {
        this.hud.toast('Aproxime-se mais de um planeta para pousar', '#ffb43b');
      }
    }

    _onLanded() {
      const p = this.ship.planet;
      this.landedTime = 0;
      this.audio.thud();
      if (!p.visited) {
        p.visited = true;
        this.hud.toast('Primeiro pouso em <b>' + p.name + '</b>', '#' + p.skyColor.getHexString());
        this._updateExplored();
      }
    }

    _exitShip() {
      const s = this.ship, p = this.player;
      _v.set(1, 0, 0).applyQuaternion(s.quat).multiplyScalar(5.5).add(s.pos);      // ao lado da nave
      _v2.set(0, 0, -1).applyQuaternion(s.quat);                                    // olha para onde a nave aponta
      p.spawnAt(s.planet, _v, _v2);
      p.camPitch = 0.2;
      p.firstPerson = false;
      this.mode = 'FOOT';
      this.footTime = 0;
      this.camRig.startTransition(1.7);
      this.audio.blip(true);
    }

    _enterShip() {
      this.player.hide();
      this.playerShadow.hide();
      this.mode = 'SHIP';
      this.landedTime = 0;
      this.camRig.startTransition(1.3);
      this.audio.blip(false);
    }

    /** Altura da nave sobre o chão do planeta mais próximo (usada para pousar e para a sombra). */
    _updateShipRef() {
      const ref = this.shipRef, s = this.ship;
      ref.planet = null; ref.alt = Infinity;
      for (const p of this.planets) {
        _v.copy(s.pos).sub(p.center);
        const d = _v.length();
        if (d > p.outerRadius + 400) continue;
        _v.divideScalar(d);
        const g = p.groundAt(_v);
        const alt = d - g.r;
        if (alt < ref.alt) {
          ref.alt = alt; ref.planet = p;
          ref.point.copy(p.center).addScaledVector(_v, g.r);
          ref.normal.copy(g.normal);
        }
      }
    }

    /* ======================= A PÉ ======================= */
    _updateFoot(dt) {
      const inp = this.input, p = this.player;
      this.footTime += dt;

      if (inp.pressed('KeyV')) {
        p.firstPerson = !p.firstPerson;
        p.camPitch = p.firstPerson ? 0 : 0.18;
        this.camRig.startTransition(0.6);
        this.audio.blip(p.firstPerson);
      }

      p.update(dt, inp);
      if (p.justLanded) this.audio.thud();

      // Coleta de recursos
      _v.copy(p.pos).addScaledVector(p.up, 1.0);
      const got = p.planet.collectNear(_v, COLLECT_RADIUS);
      for (const g of got) {
        const t = g.type;
        this.inv[t.id]++;
        this.ship.fuel = Math.min(this.ship.maxFuel, this.ship.fuel + t.fuel);
        this.burst.emit(g.pos, p.up, t.color, 16);
        this.audio.collect(t.id);
        this.hud.toast('+1 <b>' + t.name + '</b> &nbsp;<small>+' + t.fuel + ' combustível</small>', '#' + new THREE.Color(t.color).getHexString());
      }
      if (got.length) {
        this.hud.setCounts(this.inv);
        if (p.planet.resourcesTaken === p.planet.resourcesTotal) {
          this.hud.toast('Planeta <b>' + p.planet.name + '</b> completo! Todos os recursos coletados.', '#b98cff');
          this.audio.collect('essence');
        }
      }

      // Pulso de eco
      this.echoCd = Math.max(0, this.echoCd - dt);
      if (inp.pressed('KeyR') && this.echoCd <= 0) {
        this.echoCd = ECHO_COOLDOWN;
        this.echo.emit(p.pos);
        const n = p.planet.revealResources(p.pos, ECHO_RADIUS, this.time);
        this.audio.ping();
        this.hud.toast(n ? '<b>Eco:</b> ' + n + (n === 1 ? ' recurso detectado' : ' recursos detectados') : '<b>Eco:</b> nada por perto', '#49f2ff');
      }

      // Voltar para a nave
      if (inp.pressed('KeyF') && p.pos.distanceTo(this.ship.pos) < ENTER_DIST) this._enterShip();
    }

    /* ======================= CÂMERA ======================= */
    /** Mantém um ponto da câmera acima do chão de qualquer planeta próximo. */
    _keepAboveGround(pos, margin) {
      for (const p of this.planets) {
        _v3.copy(pos).sub(p.center);
        const d = _v3.length();
        if (d > p.outerRadius + margin + 4) continue;
        _v3.divideScalar(d);
        const g = p.groundAt(_v3);
        const minR = g.r + margin;
        if (d < minR) pos.copy(p.center).addScaledVector(_v3, minR);
      }
    }

    /** Pose desejada da câmera conforme o modo atual (o CameraRig suaviza o caminho até ela). */
    _computeCameraPose(out) {
      if (this.mode === 'SHIP') {
        const s = this.ship;
        const grounded = s.state !== 'FLIGHT';
        out.pos.set(0, grounded ? 5.0 : 3.4, grounded ? 15 : 12.5).applyQuaternion(s.quat).add(s.pos);
        this._keepAboveGround(out.pos, 2.2);
        if (grounded && s.planet) {
          s.planet.pullCameraIn(s.pos, out.pos, 0.8, 0.45);   // se uma árvore bloqueia a vista, chega mais perto
          s.planet.pushOutObstacles(out.pos, 1.8);
        }
        out.quat.copy(s.quat).multiply(_q.setFromAxisAngle(_X, -0.12));
        out.fov = 62 + 22 * ES.clamp((s.speed - 60) / 150, 0, 1);    // abre o campo de visão no turbo
        out.kPos = 10 + 0.07 * s.speed; out.kQuat = 9;   // mais colada em alta velocidade
        return;
      }
      const p = this.player;
      p.lookDirection(_v2);
      if (p.firstPerson) {
        p.eyePosition(out.pos);
        _m.lookAt(out.pos, _v.copy(out.pos).add(_v2), p.up);
        out.quat.setFromRotationMatrix(_m);
        out.fov = 80; out.kPos = Infinity; out.kQuat = Infinity;
      } else {
        _v.copy(p.pos).addScaledVector(p.up, 1.7);                       // ponto para onde olhamos
        out.pos.copy(_v).addScaledVector(_v2, -p.camDist).addScaledVector(p.up, 0.5);
        _v3.crossVectors(p.heading, p.up);                               // direita
        out.pos.addScaledVector(_v3, 0.9);                               // câmera "por cima do ombro"
        p.planet.pullCameraIn(_v, out.pos, 0.45, 0.42);                    // se algo bloqueia a vista, chega mais perto
        p.planet.pushOutObstacles(out.pos, 1.4);                         // e nunca entra dentro de árvores/pedras
        this._keepAboveGround(out.pos, 1.2);
        _m.lookAt(out.pos, _v, p.up);
        out.quat.setFromRotationMatrix(_m);
        out.fov = 68; out.kPos = 20; out.kQuat = Infinity;
      }
    }

    /* ======================= AMBIENTE ======================= */
    /**
     * Céu, névoa e luz mudam conforme a altitude e a hora do dia (ângulo do sol)
     * no planeta mais próximo: no espaço é preto com estrelas; perto do chão,
     * de dia, vira o céu colorido do planeta; no amanhecer ganha tons quentes.
     */
    _updateEnvironment(dt) {
      const cam = this.camera.position;
      let best = null, bestAlt = Infinity;
      for (const p of this.planets) {
        const a = cam.distanceTo(p.center) - p.radius;
        if (a < bestAlt) { bestAlt = a; best = p; }
        p.updateAtmosphere(cam);
      }
      this.nearest = best; this.nearestAlt = bestAlt;

      let atmo = 0, day = 1, dusk = 0, sunUp = 0;
      const up = _v2.set(0, 1, 0);
      if (best) {
        atmo = 1 - ES.smoothstep(0, best.radius * 0.9, bestAlt);
        if (atmo > 0) {
          up.copy(cam).sub(best.center).normalize();
          sunUp = up.dot(this.sunDir);                                   // 1 = sol a pino, -1 = meia-noite
          day = ES.smoothstep(-0.12, 0.28, sunUp);
          dusk = Math.exp(-Math.pow((sunUp - 0.02) / 0.16, 2));          // pico perto do nascer/pôr do sol
        }
      }

      // Cores do céu: horizonte claro, zênite escuro; à noite quase preto.
      const horizon = this._horizon, zenith = this._zenith;
      if (best) {
        horizon.copy(best.skyColor).lerp(_white, 0.28).multiplyScalar(day * 1.08 + 0.03);
        zenith.copy(best.skyColor).multiplyScalar(0.82 * day + 0.01);
      }
      this.space.setSky({ up, zenith, horizon, dusk, sunAmount: ES.smoothstep(-0.25, 0.08, sunUp) * atmo, amount: atmo });

      // Névoa: tinge o horizonte do planeta (some no espaço).
      this.scene.background.setRGB(0, 0, 0);
      this.scene.fog.color.copy(horizon).multiplyScalar(0.9 * atmo);
      this.scene.fog.density = 0.0026 * atmo * (0.25 + 0.75 * day);

      const focus = this.mode === 'FOOT' ? this.player.pos : this.ship.pos;
      this.space.update(cam, focus, atmo * day, 1 - atmo);

      // Luzes: dentro da atmosfera o "céu" (hemisfério) substitui parte da luz ambiente.
      const skyLight = atmo * day;
      this.ambient.intensity = 0.85 - 0.3 * skyLight;
      this.hemi.intensity = 0.62 * skyLight;
      this.hemi.position.copy(up).multiplyScalar(100);                    // direção do "céu"
      if (best) this.hemi.color.copy(best.skyColor).lerp(_white, 0.35);

      // Lanterna do capacete: acende à noite.
      this.player.headlamp.intensity = this.mode === 'FOOT' ? 0.35 + 1.3 * (1 - day * (atmo > 0 ? 1 : 0)) : 0;
    }

    _updateShadows() {
      const s = this.ship;
      const ref = this.shipRef;
      if (ref.planet && ref.alt < 70) {
        this.shipShadow.place(ref.point, ref.normal, 2.6, 0.4 * (1 - ref.alt / 70));
      } else {
        this.shipShadow.hide();
      }
      if (this.mode === 'FOOT') {
        const p = this.player;
        const h = Math.max(0, p.pos.distanceTo(p.ground.point));
        this.playerShadow.place(p.ground.point, p.ground.normal, 0.95, 0.38 * (1 - Math.min(1, h / 7)));
      }
    }

    /* ======================= HUD ======================= */
    _updateExplored() {
      const n = this.planets.filter((p) => p.visited).length;
      this.hud.setExplored('Planetas visitados: ' + n + '/' + this.planets.length);
    }

    _updateHud() {
      const hud = this.hud, s = this.ship, p = this.player;
      const onFoot = this.mode === 'FOOT';

      hud.showFlightBox(!onFoot);
      hud.showEchoBox(onFoot);
      hud.setCrosshair(!onFoot ? s.state === 'FLIGHT' : p.firstPerson);
      if (!onFoot) hud.setFlight(s.speed, s.throttle, s.fuel / s.maxFuel, s.fuel);
      else hud.setEcho(1 - this.echoCd / ECHO_COOLDOWN);

      // --- Onde estou ---
      const n = this.nearest;
      const modeLabel = onFoot ? 'EXPLORAÇÃO' : { FLIGHT: 'NAVE · EM VOO', LANDING: 'NAVE · POUSANDO', LANDED: 'NAVE · POUSADA', TAKEOFF: 'NAVE · DECOLANDO' }[s.state];
      hud.setMode(modeLabel);
      if (n && this.nearestAlt < n.radius * 2.6) {
        hud.setPlace(n.name, n.type.label + ' · altitude ' + Math.max(0, Math.round(this.nearestAlt)) + ' m');
      } else {
        hud.setPlace('Espaço profundo', n ? 'Mais próximo: ' + n.name + ' · ' + Math.round(this.nearestAlt) + ' m' : '—');
      }

      // --- Recursos do planeta atual ---
      const where = onFoot ? p.planet : (s.state === 'LANDED' ? s.planet : null);
      if (where) hud.setLocal('Recursos neste planeta: ' + where.resourcesTaken + '/' + where.resourcesTotal);
      else hud.setLocal('');

      // --- Mensagem de contexto ---
      let msg = '';
      if (onFoot) {
        if (p.pos.distanceTo(s.pos) < ENTER_DIST) msg = '<b>F</b> entrar na nave';
        else if (p.planet.resourcesTaken === p.planet.resourcesTotal) msg = 'Planeta completo! Volte para a nave';
        else if (this.footTime < 14) msg = 'Colete os cristais brilhantes · <b>R</b> pulso de eco revela os próximos';
      } else {
        switch (s.state) {
          case 'FLIGHT':
            if (this.shipRef.planet && this.shipRef.alt < LAND_RANGE) msg = 'Pressione <b>L</b> para pousar em <b>' + this.shipRef.planet.name + '</b>';
            else if (s.fuel <= 0) msg = 'Sem combustível — propulsão de emergência. Colete cristais!';
            else if (this.time < 16) msg = 'Segure <b>W</b> para acelerar e siga o marcador do planeta';
            break;
          case 'LANDING': msg = 'Pousando…'; break;
          case 'LANDED': msg = '<b>F</b> sair da nave &nbsp;·&nbsp; <b>Espaço</b> decolar'; break;
        }
      }
      hud.setPrompt(msg);

      // --- Marcadores flutuantes ---
      const items = [];
      const cam = this.camera.position;
      if (!onFoot && s.state !== 'LANDED') {
        for (const pl of this.planets) {
          items.push({
            id: pl.name, label: pl.name, kind: 'planet', color: '#' + pl.skyColor.getHexString(),
            pos: pl.center, dist: Math.max(0, cam.distanceTo(pl.center) - pl.radius),
          });
        }
      } else if (onFoot) {
        const d = p.pos.distanceTo(s.pos);
        if (d > 14) items.push({ id: 'ship', label: 'NAVE', kind: 'ship', color: '#49f2ff', pos: _v.copy(s.pos).addScaledVector(p.up, 3), dist: d });
      }
      hud.updateMarkers(items, this.camera);

      if (this.debug) hud.setFps(Math.round(this.fps) + ' fps');
    }

    /* ======================= FERRAMENTAS DE TESTE ======================= */
    /** Coloca o personagem a pé num planeta, num ponto onde o sol está a "sunElev" (-1..1) do zênite. */
    debugStandAt(index, sunElev, yawDeg) {
      const pl = this.planets[index];
      const perp = new THREE.Vector3(0, 1, 0).cross(this.sunDir).normalize();
      const dir = this.sunDir.clone().multiplyScalar(sunElev).addScaledVector(perp, Math.sqrt(1 - sunElev * sunElev));
      const ship = this.ship;
      ship.planet = pl; ship.state = 'LANDED'; ship.legs = 1;
      const g = pl.groundAt(dir);
      ship.pos.copy(pl.center).addScaledVector(dir, g.r + 1.3);
      ship.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const side = new THREE.Vector3().crossVectors(dir, this.sunDir).normalize();
      const head = side.applyAxisAngle(dir, (yawDeg || 0) * Math.PI / 180);
      this.player.spawnAt(pl, ship.pos.clone().addScaledVector(head, -9), head);
      this.player.camPitch = 0.12;
      this.mode = 'FOOT';
      this.camRig.snapTo((this._computeCameraPose(this._camPose), this._camPose));
    }

    /** Coloca a nave perto de um planeta, olhando para ele (útil para testar o pouso). */
    debugGoTo(index, altitude) {
      const pl = this.planets[index];
      const dir = _v.copy(this.ship.pos).sub(pl.center).normalize();
      this.ship.pos.copy(pl.center).addScaledVector(dir, pl.radius + altitude);
      _m.lookAt(this.ship.pos, pl.center, new THREE.Vector3(0, 1, 0));
      this.ship.quat.setFromRotationMatrix(_m);
      this.ship.vel.set(0, 0, 0);
      this.camRig.snapTo((this._computeCameraPose(this._camPose), this._camPose));
    }
  }

  window.addEventListener('load', () => {
    ES.game = new Game();
    window.EchoStar = ES;          // facilita inspecionar no console: EchoStar.game
  });
})();
