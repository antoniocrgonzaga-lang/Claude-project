/* ==========================================================================
   space.js — O ambiente do espaço: estrelas, nebulosas, sol e poeira cósmica
   --------------------------------------------------------------------------
   Estrelas, nebulosas e sol ficam num grupo que SEGUE a câmera. Assim eles
   parecem estar infinitamente longe (sem paralaxe), como no espaço de verdade.
   ========================================================================== */
(function () {
  'use strict';
  const ES = window.ES;

  ES.Space = class Space {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} sunDir  direção (unitária) de onde vem a luz do sol
     * @param {Function} rng          gerador aleatório com semente
     */
    constructor(scene, sunDir, rng) {
      this.sunDir = sunDir.clone().normalize();
      this.group = new THREE.Group();
      scene.add(this.group);

      this._buildSky();
      this._buildStars(rng);
      this._buildNebulas(rng);
      this._buildSun();
      this._buildDust(rng, scene);
    }

    /* ---- Domo do céu: só aparece dentro da atmosfera de um planeta ----
       Gradiente do horizonte (claro) ao zênite (escuro), brilho ao redor do
       sol e tons quentes no amanhecer/entardecer. Fora da atmosfera fica invisível. */
    _buildSky() {
      this.skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: {
          uUp: { value: new THREE.Vector3(0, 1, 0) },
          uSunDir: { value: this.sunDir.clone() },
          uZenith: { value: new THREE.Color(0x000000) },
          uHorizon: { value: new THREE.Color(0x000000) },
          uWarm: { value: new THREE.Color(1.0, 0.45, 0.2) },
          uDusk: { value: 0 },
          uSunAmount: { value: 0 },
          uAmount: { value: 0 },
        },
        vertexShader: [
          'varying vec3 vDir;',
          'void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uUp, uSunDir, uZenith, uHorizon, uWarm;',
          'uniform float uDusk, uSunAmount, uAmount;',
          'varying vec3 vDir;',
          'void main(){',
          '  vec3 d = normalize(vDir);',
          '  float h = dot(d, uUp);',
          '  float t = clamp(h, 0.0, 1.0);',
          '  vec3 col = mix(uHorizon, uZenith, pow(t, 0.5));',
          '  col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.35, h));',
          '  float s = max(dot(d, uSunDir), 0.0);',
          '  col = mix(col, uWarm, uDusk * pow(s, 3.0) * (1.0 - t * 0.75));',          // brilho do amanhecer/entardecer
          '  col += vec3(1.0, 0.85, 0.6) * (pow(s, 28.0) * 0.5 + pow(s, 500.0) * 1.2) * uSunAmount;',   // halo do sol
          '  gl_FragColor = vec4(col * uAmount, 1.0);',
          '}',
        ].join('\n'),
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), this.skyMat);
      this.sky.renderOrder = -1000;       // desenhado primeiro, atrás de tudo
      this.sky.frustumCulled = false;
      this.sky.visible = false;
      this.group.add(this.sky);
    }

    /**
     * @param {object} s  { up, zenith, horizon, dusk, sunAmount, amount } — amount 0 esconde o domo
     */
    setSky(s) {
      this.sky.visible = s.amount > 0.002;
      if (!this.sky.visible) return;
      const u = this.skyMat.uniforms;
      u.uUp.value.copy(s.up);
      u.uZenith.value.copy(s.zenith);
      u.uHorizon.value.copy(s.horizon);
      u.uDusk.value = s.dusk;
      u.uSunAmount.value = s.sunAmount;
      u.uAmount.value = s.amount;
    }

    /* ---- Estrelas: milhares de pontos numa esfera enorme ---- */
    _buildStars(rng) {
      const count = 3800;
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const v = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        rng.unit(v).multiplyScalar(16000);
        pos.set([v.x, v.y, v.z], i * 3);
        // Estrelas variam de azuladas a amareladas; algumas são mais brilhantes.
        const t = rng.next();
        c.setHSL(t < 0.5 ? 0.6 : 0.1, rng.range(0.1, 0.6), rng.range(0.65, 1.0));
        c.multiplyScalar(rng.chance(0.08) ? 1.0 : rng.range(0.35, 0.8));
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.starMat = new THREE.PointsMaterial({
        size: 2.1, sizeAttenuation: false, vertexColors: true,
        transparent: true, depthWrite: false, fog: false,
      });
      this.stars = new THREE.Points(geo, this.starMat);
      this.stars.frustumCulled = false;
      this.group.add(this.stars);
    }

    /* ---- Nebulosas: sprites grandes e translúcidos, dão o clima "misterioso" ---- */
    _buildNebulas(rng) {
      this.nebulaMats = [];
      const palettes = [
        [0x6a3cff, 0x2bd6ff], [0xff4fa3, 0x7a3cff], [0x19e0c0, 0x2a5bff],
        [0xffa04a, 0xff4f7a], [0x4a7cff, 0xb46bff], [0x2bd6ff, 0x19e0a0],
      ];
      const v = new THREE.Vector3();
      for (let i = 0; i < palettes.length; i++) {
        const tex = ES.makeNebulaTexture(rng, palettes[i][0], palettes[i][1]);
        const mat = new THREE.SpriteMaterial({
          map: tex, transparent: true, opacity: rng.range(0.35, 0.7),
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        });
        mat.userData.baseOpacity = mat.opacity;
        const s = new THREE.Sprite(mat);
        rng.unit(v).multiplyScalar(14500);
        s.position.copy(v);
        s.scale.setScalar(rng.range(7000, 11000));
        this.group.add(s);
        this.nebulaMats.push(mat);
      }
    }

    /* ---- Sol distante: esfera brilhante + halos ---- */
    _buildSun() {
      const sunPos = this.sunDir.clone().multiplyScalar(12000);
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(650, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0xfff1cc, fog: false })
      );
      body.position.copy(sunPos);
      this.group.add(body);

      const halo1 = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ES.makeGlowTexture([[0, 'rgba(255,240,200,1)'], [0.25, 'rgba(255,200,120,0.55)'], [1, 'rgba(255,150,60,0)']]),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      halo1.position.copy(sunPos);
      halo1.scale.setScalar(5200);
      this.group.add(halo1);

      const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ES.makeGlowTexture([[0, 'rgba(255,190,110,0.28)'], [1, 'rgba(255,120,80,0)']]),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      halo2.position.copy(sunPos);
      halo2.scale.setScalar(13000);
      this.group.add(halo2);

      this.sunParts = [body, halo1, halo2];
    }

    /* ---- Poeira cósmica: partículas que dão sensação de velocidade ----
       O "wrap" (repetição) é feito no shader: as partículas ficam sempre
       dentro de um cubo ao redor da nave, sem custo de CPU. */
    _buildDust(rng, scene) {
      const count = 600;
      this.dustSize = 220;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i++) pos[i] = rng.next() * this.dustSize;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.dustMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uCenter: { value: new THREE.Vector3() },
          uSize: { value: this.dustSize },
          uAlpha: { value: 1 },
        },
        vertexShader: [
          'uniform vec3 uCenter; uniform float uSize; varying float vA;',
          'void main(){',
          '  vec3 p = uCenter + (mod(position - uCenter + 0.5*uSize, uSize) - 0.5*uSize);',
          '  vec4 mv = viewMatrix * vec4(p, 1.0);',
          '  float d = length(p - uCenter) / (0.5*uSize);',
          '  vA = clamp(1.0 - d, 0.0, 1.0);',
          '  gl_PointSize = clamp(260.0 / max(-mv.z, 1.0), 1.0, 5.0);',
          '  gl_Position = projectionMatrix * mv;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform float uAlpha; varying float vA;',
          'void main(){',
          '  float r = length(gl_PointCoord - 0.5) * 2.0;',
          '  float a = smoothstep(1.0, 0.2, r) * vA * uAlpha * 0.8;',
          '  gl_FragColor = vec4(0.75, 0.9, 1.0, a);',
          '}',
        ].join('\n'),
      });
      this.dust = new THREE.Points(geo, this.dustMat);
      this.dust.frustumCulled = false;
      scene.add(this.dust);
    }

    /**
     * @param {THREE.Vector3} camPos  posição da câmera
     * @param {THREE.Vector3} focus   ponto ao redor do qual a poeira aparece (nave/personagem)
     * @param {number} skyBlock       0..1 — quanto a atmosfera de um planeta esconde o céu
     * @param {number} dustAmount     0..1 — visibilidade da poeira
     */
    update(camPos, focus, skyBlock, dustAmount) {
      this.group.position.copy(camPos);
      this.dustMat.uniforms.uCenter.value.copy(focus);
      this.dustMat.uniforms.uAlpha.value = dustAmount;
      // Dentro da atmosfera de dia, as estrelas e nebulosas somem (como na Terra).
      const vis = 1 - skyBlock;
      this.starMat.opacity = vis;
      for (const m of this.nebulaMats) m.opacity = m.userData.baseOpacity * vis;
    }
  };
})();
