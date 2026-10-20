/**
 * ECHO STAR — central tuning file.
 *
 * Every gameplay / balance number lives here so it can be tweaked without
 * hunting through the code. Visual-only data (biome palettes, model shapes)
 * lives next to the code that draws it.
 *
 * Units: distances are world units (~1 unit = 1 metre), times are seconds,
 * speeds are units per second.
 */
export const CONFIG = {
  version: 1,

  // Master seed: same seed → same star system, planets and resource layout.
  seed: 20261007,

  // ---------------------------------------------------------------- render
  render: {
    fov: 65,
    near: 0.5,
    far: 40000,
    maxPixelRatio: 1.75,
    exposure: 1.05,
    bloom: true,
    bloomStrength: 0.85,
    bloomRadius: 0.5,
    bloomThreshold: 1.0,      // only HDR-bright things (crystals, sun, engines) glow
    shadows: true,
    shadowMapSize: 2048,
    shadowRange: 45,          // half-size of the shadow box that follows the player/ship
    fogDensity: 0.0065,       // surface haze when inside an atmosphere
  },

  lighting: {
    sunIntensity: 3.0,
    ambientIntensity: 1.1,
    ambientColor: 0x9ca6cc,
    headlampIntensity: 5,     // camera-mounted lamp that switches on at night
    headlampRange: 50,
  },

  // -------------------------------------------------------------- universe
  universe: {
    planetCount: 7,
    minOrbit: 650,            // distance of planets from the system origin
    maxOrbit: 3000,
    minSeparation: 550,       // minimum gap between planet surfaces
    verticalSpread: 260,
    sunDistance: 12000,
    sunSize: 900,
    skyRadius: 18000,
    starCount: 6000,
    bandStarCount: 3500,      // extra stars packed along a "galactic band"
    brightStars: 36,          // bright stars with diffraction spikes
    galaxies: 4,              // distant spiral galaxies
    skyboxResolution: 1024,   // size of each face of the baked nebula / Milky Way skybox
    dustCount: 500,           // space dust particles that give a sense of speed
  },

  // ---------------------------------------------------------------- planet
  planet: {
    minRadius: 60,
    maxRadius: 110,
    cellSize: 2.4,            // approx. terrain triangle size (smaller = more detail)
    terrainAmplitude: 0.13,   // max terrain height as a fraction of radius
    terraceSteps: 10,         // height quantisation → blocky terraced look
    noiseFrequency: 1.45,
    noiseOctaves: 4,
    seabedDepth: 1.2,         // seabed is clamped to this depth below sea level
    atmosphereScale: 1.25,    // halo sphere radius relative to planet radius
    skyFadeAltitude: 0.6,     // altitude (× radius) where the sky colour fully fades to space
    floraPerPlanet: 260,      // trees for a radius-80 planet with density 1 (scaled by area)
    decorRocksPerPlanet: 90,
    monoliths: [1, 2],        // mysterious ancient relics per planet
  },

  // ---------------------------------------------------------- planet beauty
  /** Visual-only planet effects (planetfx.js, decor.js, planet.js). None of them affect gameplay. */
  fx: {
    clouds: true,
    cloudsPerPlanet: 34,      // on a radius-80 planet with cloud cover 1 (each biome scales it)
    cloudAltitude: [5, 13],   // metres above the highest possible terrain
    cloudDrift: 1.4,          // cloud speed (m/s)
    cloudFadeNear: 26,        // clouds closer to the camera than this fade out (farther in build mode)
    scatterPerPlanet: 4000,   // grass / flowers / pebbles / crystals on a radius-80 planet
    scatterViewRange: 2.6,    // scatter is only drawn when the camera is within this × radius of the planet
    scatterSway: 1,           // wind sway of grass and stalks
    waveHeight: 0.22,         // water wave amplitude (m)
    weatherParticles: 700,    // pollen / fireflies / snow / embers / spores around the camera
    ringChance: 0.35,         // chance a planet (never the home world) has a ring of rocks
  },

  // ------------------------------------------------------------- resources
  resources: {
    // Harvestable nodes on a radius-80 planet (scaled by surface area).
    nodesPerPlanet: 75,
    mixVariance: 0.5,         // ± random variation of the biome mix per planet
    types: {
      crystal: { item: 'crystals', label: 'Crystal Cluster', amount: [4, 8],  yield: 1, harvestTime: 1.4, regrowTime: 300 },
      iron:    { item: 'iron',     label: 'Iron Ore',        amount: [5, 10], yield: 2, harvestTime: 1.2, regrowTime: 300 },
      rock:    { item: 'rock',     label: 'Stone Outcrop',   amount: [6, 12], yield: 3, harvestTime: 0.9, regrowTime: 240 },
      plant:   { item: 'food',     label: 'Wild Flora',      amount: [3, 6],  yield: 2, harvestTime: 0.8, regrowTime: 90 },
    },
    // Relative spawn weights per biome → every planet has its own mix.
    biomeMix: {
      verdant:  { crystal: 0.6, iron: 1.0, rock: 1.0, plant: 1.7 },
      arid:     { crystal: 0.8, iron: 1.7, rock: 1.4, plant: 0.4 },
      glacial:  { crystal: 1.6, iron: 0.8, rock: 1.2, plant: 0.5 },
      volcanic: { crystal: 1.2, iron: 1.9, rock: 1.0, plant: 0.25 },
      aether:   { crystal: 2.1, iron: 0.5, rock: 0.7, plant: 1.2 },
    },
  },

  animals: {
    perPlanet: 14,            // on a radius-80 planet with fauna density 1
    speciesPerPlanet: [2, 3], // picked from the planet's biome (species in animals.js)
    walkSpeed: 2.2,
    fleeSpeed: 5.5,
    fleeDistance: 7,
    skittishChance: 0.5,      // chance a species runs away from the player
    captureTime: 1.8,
    foodYield: 6,             // × the species' own food factor (a Tuskmoth gives 3×)
    respawnTime: 120,
  },

  // ------------------------------------------------------------------ ship
  ship: {
    acceleration: 35,
    boostAcceleration: 90,
    brakeDeceleration: 55,
    maxSpeed: 110,
    boostMultiplier: 2.4,
    maxReverse: 15,
    handling: 3.5,            // how fast velocity follows the nose (higher = less drift)
    strafeSpeed: 14,
    yawRate: 1.3,             // keyboard turn rates (rad/s)
    pitchRate: 1.2,
    rollRate: 2.0,
    mouseSensitivity: 0.0022,
    autoLevel: 1.6,           // gently rolls the ship level when close to a planet
    nearPlanetSlowdown: 180,  // altitude below which max speed is reduced
    minNearSpeedFactor: 0.25,
    fuelMax: 100,
    fuelBurn: 0.9,            // fuel per second while thrusting
    boostFuelMultiplier: 3,
    emptyFuelSpeedFactor: 0.3,
    refuelRate: 10,           // fuel per second while landed
    landingRange: 80,         // altitude at which landing becomes available
    landingDuration: 3.2,
    landingHoverHeight: 14,
    gearHeight: 1.6,          // ship centre height above ground when landed
    takeoffAltitude: 22,
    takeoffDuration: 2.2,
    collisionClearance: 2.0,
    cameraOffset: [0, 3.2, 12],
    landedCameraOffset: [0, 5, 15],
    cameraLookAhead: 25,
    cameraDamping: 7,
    speedFovBoost: 12,
  },

  // ---------------------------------------------------------------- player
  player: {
    walkSpeed: 6,
    runSpeed: 11,
    acceleration: 12,
    jumpVelocity: 8.5,
    gravity: 24,
    radius: 0.45,
    mouseSensitivity: 0.0026,
    cameraDistance: 7.5,
    cameraMinPitch: -0.35,
    cameraMaxPitch: 1.25,
    cameraTargetHeight: 1.7,
    interactRange: 3.4,
    boardRange: 6,
    shipCollisionRadius: 2.8,
    // Phase 3: the astronaut can be hurt and carries an automatic blaster.
    hp: 100,
    regenDelay: 5,            // seconds without damage before the suit self-repairs
    regenRate: 6,             // hp per second
    blaster: { damage: 10, range: 16, cooldown: 0.4 },
  },

  camera: {
    transitionTime: 1.1,      // seconds for ship ↔ player camera blends
  },

  // ------------------------------------------------------------- inventory
  inventory: {
    start: { crystals: 0, iron: 0, rock: 0, food: 0, energy: 0, compute: 0 },
  },

  // Highest development phase implemented. Buildings / units from later
  // phases are shown in menus but locked.
  phase: 5,

  // --------------------------------------------------- energy storage
  // Energy no longer piles up forever: generators idle when storage is full.
  energy: {
    baseCapacity: 50,         // storage without any colony
    perCore: 100,             // each finished Command Core adds this much storage
    perGenerator: 150,        // each finished Power Generator adds this much storage
  },

  // ------------------------------------------------------------ base grid
  base: {
    cellSize: 2,              // grid cell width in metres
    buildRadius: 30,          // max distance of a building's centre from its Command Core
    maxCoresPerPlanet: 5,     // each Command Core founds its own colony (outpost) on the planet
    minCoreSpacing: 45,       // minimum distance between two Command Cores on the same planet
    autoLevel: true,          // terraform the ground flat under new buildings (only liquid blocks building)
    levelBlend: 4,            // width (m) of the smooth ramp between a levelled pad and the natural terrain
    maxUnevenness: 3.2,       // only used when autoLevel is false
    shipClearance: 5,         // keep buildings this far from the landed ship
    extractorReach: 4.5,      // resource node must be this close to an Extractor's edge
    demolishRefund: 0.5,      // share of the cost returned when demolishing / dismantling
    dismantleTime: 1.5,       // seconds holding X next to a building to take it apart on foot
    dismantleRange: 2.5,      // how close (m) the astronaut must be to a building's edge
    cameraPitch: 1.0,         // build camera tilt (radians from horizontal)
    cameraZoom: [16, 110],
    cameraStartZoom: 48,
    cameraPanSpeed: 0.9,      // × zoom distance per second
  },

  /**
   * Building catalogue.
   *  size      footprint in grid cells [w, h]
   *  cost      resources paid when placed
   *  buildTime seconds to construct
   *  hp        max health
   *  upkeep    energy consumed per second while operating
   *  cycle     production cycle length (seconds)
   *  input     resources consumed per cycle (cycle waits if unaffordable)
   *  output    resources produced per cycle
   *  phase     development phase in which the building unlocks
   */
  buildings: {
    core: {
      name: 'Command Core', key: '1', size: [4, 4], phase: 2,
      cost: { rock: 30, iron: 20, crystals: 5 }, buildTime: 20, hp: 2000,
      upkeep: 0, cycle: 1, input: {}, output: { energy: 0.6 },
      desc: 'Heart of the colony. Houses the base AI, stores energy and receives gathered resources. If it is destroyed the colony falls.',
    },
    extractor: {
      name: 'Extractor', key: '2', size: [2, 2], phase: 2,
      cost: { rock: 15, iron: 10 }, buildTime: 10, hp: 300,
      upkeep: 0.5, cycle: 8, input: {}, output: {}, nodeOutput: 2,
      desc: 'Drills a nearby Crystal, Iron or Stone node. Place it right next to one.',
    },
    farm: {
      name: 'Farm', key: '3', size: [4, 4], phase: 2,
      cost: { rock: 20, iron: 5 }, buildTime: 8, hp: 250,
      upkeep: 0.25, cycle: 10, input: {}, output: { food: 4 },
      desc: 'Grows local plants into food.',
    },
    ranch: {
      name: 'Ranch', key: '4', size: [4, 4], phase: 2,
      cost: { rock: 25, iron: 10, food: 10 }, buildTime: 10, hp: 300,
      upkeep: 0.35, cycle: 15, input: {}, output: { food: 7 },
      desc: 'Raises local creatures for food.',
    },
    power: {
      name: 'Power Generator', key: '5', size: [3, 3], phase: 2,
      cost: { rock: 10, iron: 15, crystals: 5 }, buildTime: 12, hp: 400,
      upkeep: 0, cycle: 6, input: { crystals: 1 }, output: { energy: 15 },
      desc: 'Burns crystals to produce energy — only while energy storage has room. Adds storage.',
    },
    barracks: {
      name: 'Barracks', key: '6', size: [3, 3], phase: 3,
      cost: { rock: 40, iron: 25 }, buildTime: 18, hp: 600,
      upkeep: 0.3, cycle: 0, input: {}, output: {}, trains: ['worker', 'soldier'],
      desc: 'Recruits human Workers and Soldiers. Humans eat food.',
    },
    robotics: {
      name: 'Robotics Factory', key: '7', size: [3, 3], phase: 3,
      cost: { rock: 30, iron: 40, crystals: 15 }, buildTime: 22, hp: 600,
      upkeep: 0.5, cycle: 0, input: {}, output: {}, trains: ['miningBot', 'combatBot'],
      desc: 'Builds AI robots. Robots use energy instead of food.',
    },
    hangar: {
      name: 'Hangar', key: '8', size: [4, 4], phase: 3,
      cost: { rock: 40, iron: 50, crystals: 20 }, buildTime: 26, hp: 700,
      upkeep: 0.6, cycle: 0, input: {}, output: {}, trains: ['scoutDrone', 'fighter'],
      desc: 'Builds drones and small combat ships.',
    },
    datacenter: {
      name: 'Data Center', key: '9', size: [3, 3], phase: 4,
      cost: { rock: 30, iron: 30, crystals: 30 }, buildTime: 25, hp: 500,
      upkeep: 1.0, cycle: 4, input: {}, output: { compute: 8 },
      desc: 'Produces Compute, used to evolve the base AI (press U or use the AI panel when ready).',
    },
    turret: {
      name: 'Defense Turret', key: '0', size: [2, 2], phase: 4, requires: 'defense',
      cost: { rock: 20, iron: 30, crystals: 10 }, buildTime: 10, hp: 500,
      upkeep: 0.3, cycle: 0, input: {}, output: {},
      weapon: { damage: 12, range: 24, cooldown: 0.6 },
      desc: 'Automatically shoots enemies in range. Unlocked by the Predictive Defense singularity.',
    },
  },

  // ================================================================ units
  /**
   * Player units (Phase 3).
   *  from      building that trains it    tier  AI tier needed (enforced from Phase 4)
   *  kind      human (eats food) · robot / drone (uses energy)
   *  gather    { capacity, time } — can harvest nodes and carry loads to a Command Core
   *  build     can construct / repair (extra build speed, repair hp/s)
   *  weapon    { damage, range, cooldown }   aggro  auto-attack radius when idle
   */
  units: {
    worker: {
      name: 'Worker', from: 'barracks', tier: 0, kind: 'human', cost: { food: 15 }, time: 8,
      hp: 60, speed: 5, radius: 0.5, foodPerMin: 1,
      gather: { capacity: 5, time: 1.0 }, build: { speed: 1.0, repair: 4 },
      desc: 'Gathers resources and speeds up construction / repairs.',
    },
    soldier: {
      name: 'Soldier', from: 'barracks', tier: 0, kind: 'human', cost: { food: 20, iron: 10 }, time: 12,
      hp: 120, speed: 5.5, radius: 0.5, foodPerMin: 1.5,
      weapon: { damage: 8, range: 14, cooldown: 0.8 }, aggro: 24,
      desc: 'Basic infantry. Defends the colony.',
    },
    miningBot: {
      name: 'Mining Bot', from: 'robotics', tier: 0, kind: 'robot', cost: { iron: 20, crystals: 5 }, time: 12,
      hp: 80, speed: 6.5, radius: 0.7, energyPerSec: 0.06,
      gather: { capacity: 8, time: 0.55 },
      desc: 'Gathers faster than workers and never eats.',
    },
    combatBot: {
      name: 'Combat Robot', from: 'robotics', tier: 1, kind: 'robot', cost: { iron: 35, crystals: 10 }, time: 18,
      hp: 240, speed: 4.5, radius: 0.8, energyPerSec: 0.1,
      weapon: { damage: 14, range: 12, cooldown: 1.0 }, aggro: 16,
      desc: 'Heavy, tough combat robot.',
    },
    scoutDrone: {
      name: 'Scout Drone', from: 'hangar', tier: 0, kind: 'drone', cost: { iron: 15, crystals: 10 }, time: 10,
      hp: 50, speed: 16, radius: 0.6, flying: true, altitude: 7, energyPerSec: 0.04,
      weapon: { damage: 3, range: 12, cooldown: 0.6 }, aggro: 20,
      desc: 'Very fast flyer for exploring. Light gun.',
    },
    fighter: {
      name: 'Fighter', from: 'hangar', tier: 1, kind: 'drone', cost: { iron: 40, crystals: 25 }, time: 20,
      hp: 160, speed: 12, radius: 0.9, flying: true, altitude: 9, energyPerSec: 0.12,
      weapon: { damage: 12, range: 18, cooldown: 0.6 }, aggro: 22,
      desc: 'Small combat ship with strong guns.',
    },
  },

  // Units controlled by the ASI itself (not trained, not counted in the unit limit).
  asiUnits: {
    architect: {
      name: 'ASI Architect', from: 'techMoon', tier: 3, kind: 'robot', asi: true, cost: {}, time: 0,
      hp: 400, speed: 10, radius: 0.9, flying: true, altitude: 2.5,
      build: { speed: 3, repair: 25 }, weapon: { damage: 6, range: 14, cooldown: 0.6 }, aggro: 14,
      desc: 'Autonomous builder of the Tech Moon: founds colonies and raises buildings. Replaced if destroyed.',
    },
  },

  unitRules: {
    // Unit limit (shared by every unit type, all planets):
    //   baseUnits × (1 + perCoreBonus × finished Command Cores), never above hardCap.
    //   e.g. 1 core → 53 · 2 → 67 · 5 → 107
    baseUnits: 40,
    perCoreBonus: 0.333,      // +33.3% of baseUnits for every finished Command Core
    hardCap: 160,             // safety ceiling so huge empires stay smooth
    queueMax: 5,              // per production building
    hungrySpeed: 0.5,         // humans move/work at this speed when food runs out
    offlineSpeed: 0.3,        // robots / drones when energy runs out
    gatherReach: 2.4,         // distance to a node / core edge to work on it
    autoTaskRadius: 30,       // idle workers look this far for construction / repairs
    defendRadius: 70,         // idle combat units this close rally to a building under attack
    nodeSearchRadius: 100,    // gatherers look this far for a new node when theirs runs dry
  },

  // Ground path-finding (A* over the terrain grid) and the anti-stuck safety net.
  navigation: {
    maxExpand: 30000,         // A* gives up after expanding this many nodes (target unreachable)
    repathInterval: 0.8,      // min seconds between route recalculations for one unit
    waypointReach: 1.6,       // metres from a waypoint to move on to the next one
    stuckCheck: 1.5,          // seconds between "am I making progress?" checks
    stuckDistance: 0.5,       // moved less than this in one check → counts as stuck
    stuckNudgeAfter: 3,       // stuck checks in a row before the unit is nudged forward
  },

  // ============================================================== enemies
  enemies: {
    crawler: {
      name: 'Crawler', hp: 70, speed: 4.2, radius: 0.8,
      weapon: { damage: 8, range: 2.4, cooldown: 1.0 }, aggro: 14, leash: 35,
    },
    rogueDrone: {
      name: 'Rogue Drone', hp: 60, speed: 9, radius: 0.7, flying: true, altitude: 6,
      weapon: { damage: 6, range: 12, cooldown: 1.0 }, aggro: 40,
    },
    rogueWalker: {
      name: 'Rogue Walker', hp: 220, speed: 3.6, radius: 1.0, scale: 1.2,
      weapon: { damage: 15, range: 10, cooldown: 1.3 }, aggro: 40,
    },
  },

  // Hostile wildlife on some planets.
  aliens: {
    hostileChance: 0.6,       // chance a planet (other than the home world) has hostile nests
    nestsPerPlanet: [1, 3],
    perNest: [2, 4],
    respawnTime: 150,         // a nest regrows one crawler this often
    minDistanceFromColony: 40,
  },

  // Periodic raids by the rogue AI faction against your colonies.
  raids: {
    firstDelay: 360,          // seconds after your first Command Core comes online
    interval: [240, 360],
    warning: 25,              // seconds of warning before the raiders arrive
    baseSize: 2,              // drones in the first raid
    growth: 1,                // extra raiders per raid
    walkersFrom: 4,           // walkers join from this raid number on
    maxSize: 8,
    spawnDistance: 70,        // metres from the target colony
  },

  // ============================================================ AI tiers
  /**
   * Base AI evolution (Phase 4). Evolving spends `compute` plus `cost`.
   * `bonus` multiplies game modifiers; `color` tints the AI cube on every Command Core.
   */
  aiTiers: [
    { id: 0, name: 'Narrow AI', compute: 0, cost: {}, color: 0x4df3ff,
      desc: 'Basic automation.' },
    { id: 1, name: 'AGI', compute: 500, cost: { crystals: 60, iron: 80 }, color: 0xffd84d,
      bonus: { gatherYield: 1.25, production: 1.25 },
      desc: 'Resource Optimization: +25% gathering and production. Unlocks Combat Robots and Fighters.' },
    { id: 2, name: 'Singularity', compute: 2000, cost: { crystals: 150, iron: 150, rock: 100 }, color: 0xff4df0,
      desc: 'Choose one of three evolution paths.' },
    { id: 3, name: 'ASI', compute: 5000, cost: { crystals: 300, iron: 400, rock: 300 }, color: 0xe6d6ff, phase: 5,
      bonus: { production: 1.2, gatherYield: 1.2, damage: 1.5 },
      desc: 'Artificial Superintelligence: +20% production and gathering, +50% weapon damage. Unlocks the Tech Moon — press M.' },
  ],

  // ============================================================ Tech Moon
  /**
   * The ASI's mobile artificial moon (Phase 5). Built in orbit stage by
   * stage; each stage is paid when it starts, then takes `time` seconds.
   */
  techMoon: {
    radius: 18,
    orbitAltitude: 95,        // above the planet surface
    orbitSpeed: 0.035,        // radians per second
    travelSpeed: 140,         // units per second between planets
    stages: [
      { name: 'Orbital Frame',   cost: { iron: 300, rock: 300 },               time: 60,
        desc: 'A geodesic frame is assembled in orbit.' },
      { name: 'Hull Lattice',    cost: { iron: 400, rock: 400, crystals: 100 }, time: 90,
        desc: 'Thousands of hull plates are fitted to the frame.' },
      { name: 'Quantum Reactor', cost: { crystals: 300, compute: 1000 },        time: 90,
        desc: 'A crystal reactor ignites at the heart of the moon.' },
      { name: 'Weapon Arrays',   cost: { iron: 500, crystals: 200 },            time: 90,
        desc: 'An orbital ring of beam cannons and polar spires.' },
      { name: 'Mind Upload',     cost: { compute: 2500, energy: 300 },          time: 120,
        desc: 'The ASI transfers its mind into the moon.' },
    ],
    // Main cannons: several beams per volley, enemies near your colonies first,
    // and only targets the moon can actually see (not behind the planet).
    weapon: { damage: 45, range: 300, cooldown: 1.2, targets: 4 },
    // Large guardian drones orbiting the moon, each with its own beam.
    guardians: { count: 4, orbitRadius: 40, damage: 14, range: 320, cooldown: 0.8 },
    // ASI Architect: autonomous builder robot launched in a drop capsule.
    architect: {
      respawnTime: 30,        // seconds before a destroyed Architect is replaced
      dropTime: 4,            // capsule descent time
      planInterval: 2,        // seconds between planning steps
      // Starter colony the Architect lays out (as blueprints the moon pays for).
      buildPlan: ['power', 'extractor', 'extractor', 'extractor', 'farm', 'datacenter', 'barracks', 'turret'],
    },
    income: { crystals: 30, iron: 30, rock: 30, food: 20 },   // per minute, passive
    buildSpeedBonus: 2,       // construction speed multiplier on the planet it orbits
    autoInterval: 1,          // seconds between automation passes
  },

  // ============================================================= the Brood
  /**
   * Bio-alien faction (brood.js). A sealed Chrysalis rests on the planet farthest from
   * the home world from the start; it hatches into a living Hive once the Tech Moon is
   * online, then grows a colony with its own resource (biomass), scouts other worlds with
   * Seekers and sends Brood Carriers full of organisms to the colonies it has discovered.
   */
  brood: {
    awakenOn: 'complete',     // 'complete' = when the Tech Moon comes online · 'start' = when its construction starts
    awakenDelay: 60,          // seconds of warning between the trigger and the hatching
    startBiomass: 200,
    maxBiomass: 2000,
    hiveIncome: 1.2,          // biomass per second from the Hive itself (Feeders add their own)
    thinkInterval: 2,         // seconds between the colony's decisions
    colonyRadius: 34,         // structures grow within this distance of the Hive
    regen: { delay: 8, rate: 0.012, biomassPerHp: 0.15 },   // idle structures heal (share of max hp/s), paid with biomass
    dormantGuards: { skitter: 4, spitter: 2 },             // watch the sealed chrysalis from the start
    garrison: { base: 6, perStructure: 1.5, max: 22 },     // organisms the colony keeps at home
    // Structures grown in this order (destroyed ones are regrown).
    buildPlan: ['feederPod', 'veilSpire', 'sporeSpitter', 'broodPit', 'feederPod', 'sporeSpitter', 'broodSpire', 'feederPod', 'veilSpire', 'sporeSpitter', 'feederPod', 'sporeSpitter'],
    weights: { skitter: 3, spitter: 2, wasp: 1.5, ravager: 0.8 },   // how often each organism is hatched
    voyageSpeed: 55,          // Carriers and Seekers flying between planets (u/s)
    // Seekers look for your colonies; one that finds a colony must hover over it for relayTime to report it.
    seekers: { firstDelay: 60, interval: 120, scanRange: 55, relayTime: 20, waypoints: 9 },
    invasions: {
      firstDelay: 240,        // seconds after hatching before the first wave can leave
      interval: [210, 300],
      budget: 180,            // biomass spent on the first wave's organisms...
      budgetGrowth: 80,       // ...plus this for every wave already sent
      maxBudget: 800,
      maxCargo: 16,
      minReserve: 60,         // biomass the colony always keeps for itself
      dropDistance: 55,       // metres from the target colony where the Carrier unloads
      carrierAltitude: [90, 14],   // arrival altitude → unloading altitude
      descentSpeed: 5,        // m/s — a slow descent leaves time to shoot it down
      climbSpeed: 9,
    },
    destroyReward: { crystals: 200, iron: 200, rock: 150 },   // salvaged when the Hive dies
    // Resonance Veil: the Tech Moon's targeting can't lock on to anything inside a field.
    veil: { radius: 26, hiveRadius: 13 },   // Veil Spire field · the Hive's own small field
    // Organisms (cost in biomass; `needs` = structure that must exist; minWave = from that invasion on).
    units: {
      skitter: { name: 'Skitter', hp: 50, speed: 7.5, radius: 0.55, cost: 15, weapon: { damage: 6, range: 1.8, cooldown: 0.55 }, aggro: 20, leash: 40 },
      spitter: { name: 'Spitter', hp: 95, speed: 4.6, radius: 0.7, cost: 35, needs: 'broodPit', weapon: { damage: 11, range: 13, cooldown: 1.3 }, aggro: 22, leash: 40 },
      ravager: { name: 'Behemoth', hp: 650, speed: 3.2, radius: 1.4, cost: 120, needs: 'broodPit', minWave: 2, weapon: { damage: 32, range: 3.2, cooldown: 1.6 }, aggro: 18, leash: 40 },
      wasp: { name: 'Wasp', hp: 90, speed: 11, radius: 0.8, cost: 45, needs: 'broodSpire', flying: true, altitude: 8, weapon: { damage: 9, range: 11, cooldown: 0.9 }, aggro: 26, leash: 50 },
      seeker: { name: 'Brood Seeker', hp: 120, speed: 13, radius: 0.9, flying: true, altitude: 16 },
      broodCarrier: { name: 'Brood Carrier', hp: 900, speed: 9, radius: 2.6, flying: true, altitude: 14 },
    },
    structures: {
      broodChrysalis: { name: 'Sealed Chrysalis', hp: 3500, radius: 4.2 },
      broodHive: { name: 'Brood Hive', hp: 3500, radius: 4.5, weapon: { damage: 16, range: 12, cooldown: 1.0 } },
      feederPod: { name: 'Biomass Feeder', hp: 420, radius: 1.6, cost: 70, growTime: 30, income: 0.6 },
      sporeSpitter: { name: 'Spore Spitter', hp: 520, radius: 1.3, cost: 90, growTime: 35, weapon: { damage: 14, range: 22, cooldown: 1.2 } },
      broodPit: { name: 'Brood Pit', hp: 800, radius: 2.4, cost: 130, growTime: 45 },
      broodSpire: { name: 'Bio-Spire', hp: 850, radius: 1.8, cost: 180, growTime: 55 },
      veilSpire: { name: 'Resonance Veil Spire', hp: 600, radius: 1.6, cost: 150, growTime: 40, veil: true },
    },
  },

  // The three paths offered when reaching the Singularity tier.
  singularity: {
    swarm: {
      name: 'Autonomous Swarm', icon: '⬡',
      desc: 'Robots and workers move, gather and build 50% faster.',
      unitSpeed: 1.5,
    },
    defense: {
      name: 'Predictive Defense', icon: '⛨',
      desc: 'Buildings repair themselves and Defense Turrets are unlocked.',
      repairPerSec: 0.02,     // share of max HP regenerated per second
      repairDelay: 4,         // seconds after the last hit before repairs start
    },
    quantum: {
      name: 'Quantum Economy', icon: '⟁',
      desc: 'All buildings cost 30% fewer resources.',
      costMultiplier: 0.7,
    },
  },

  // ================================================================ audio
  /** Everything is synthesised in audio.js (Web Audio API, no sound files). */
  audio: {
    master: 0.8,              // default volumes; the menu sliders override them (saved per browser)
    music: 0.5,
    sfx: 0.85,
    refDistance: 18,          // a positioned sound at this distance plays at half volume
    maxDistance: 220,         // positioned sounds farther than this are not played
    maxVoices: 36,            // one-shot sounds playing at once (extra ones are dropped)
    musicChordSeconds: 9,     // calm music: seconds per chord
    tensionChordSeconds: 4,   // raid music: seconds per chord
    tensionStep: 0.25,        // raid music: seconds between bass pulses
    storageKey: 'echo-star-audio',
  },

  save: {
    key: 'echo-star-save-v1',
    autosaveSeconds: 30,
  },

  hud: {
    notificationSeconds: 4.5,
  },

  // ----------------------------------------------------------------- touch
  // On-screen controls for phones and tablets (js/touch.js). In "Auto" mode they
  // are ALWAYS shown on phones / tablets — even with a keyboard attached, since many
  // tablet keyboards have no trackpad — and on touch-screen laptops after the first
  // touch. Desktop PCs without a touch screen never see them.
  touch: {
    storageKey: 'echo-star-touch',  // where the Auto / On / Off choice is remembered
    joystickRadius: 60,       // px the stick knob can travel from its centre
    joystickDeadZone: 0.2,    // fraction of the radius ignored around the centre
    walkThreshold: 0.35,      // walking: stick component needed to press a direction
    runThreshold: 0.9,        // walking: stick pushed this far = run
    lookSensitivity: 1.5,     // drag-to-look, relative to the mouse
    flightSteer: 1.1,         // full stick = this × the keyboard turn rate
    invertFlightY: false,     // true: push the stick up to dive (airplane style)
    tapMaxMove: 12,           // px: a touch that moves less than this is a tap (however long it lasts)
    buildPanSpeed: 1.4,       // build mode: drag distance → camera pan
    // Lighter graphics on phones / tablets (gameplay, saves and resources are unchanged).
    lite: {
      enabled: true,
      maxPixelRatio: 1.25,    // phones often have 3× screens: rendering every pixel is very slow
      bloom: false,           // the glow post-effect is the most expensive pass
      shadowMapSize: 1024,
      skyboxResolution: 512,
      starCount: 3500,
      bandStarCount: 2000,
      dustCount: 250,
      weatherParticles: 350,
      scatterPerPlanet: 2600, // grass / flowers (own seed: trees and resources don't move)
    },
  },
};
