/**
 * Units (Phase 3).
 *
 *  Actor        – one unit or enemy. Player units and enemies share the same
 *                 movement (straight lines over the sphere with simple
 *                 obstacle avoidance) and combat (hitscan shots + glowing bolts).
 *  UnitManager  – owns every actor, runs their AI, upkeep (food / energy),
 *                 selection rings, health bars and InstancedMesh rendering.
 *
 * Player unit orders: move · gather (node → nearest Command Core) ·
 * build / repair · attack. Idle combat units auto-attack the nearest enemy
 * in range; idle Workers auto-help nearby construction and repairs.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { box, part, merge, paint } from './geometry.js';
import { makeBar } from './buildings.js';
import { RESOURCE_LABELS } from './inventory.js';
import { projectOnPlane, anyPerpendicular, quatFromUpForward } from './utils.js';
import { getNav } from './navigation.js';
import { SHOT_SOUND } from './audio.js';
import {
  C, CYAN, RED, RIG, ANIM_TIME, RIG_BODY, RIG_GLOW, RIG_FLAME,
  rig, rigMerge, strut, ringOf, tubeZ, pyramid, sweptWing, flame,
} from './rig.js';
import { BROOD_MODELS, BROOD_BAR_HEIGHT } from './broodmodels.js';

// unit palette
const U = {
  orange: 0xff9a3c, hivis: 0xe8f060, white: 0xf0f2f5, hat: 0xffc23a, hatDark: 0xd99a1a,
  blue: 0x4f6d8a, blueDark: 0x3a5068, armour: 0x2a3442, yellow: 0xf2c14e, grey: 0x7d8a96, greyDark: 0x5c6772,
  panel: 0xc9d0da, glass: 0x1c3a4a,
};
// Spatial grid cell sizes (metres). Must be ≥ the largest interaction distance:
// separation ≈ 2.4 m, obstacle avoidance ≈ core radius 3.8 + unit 1 + 1.2 margin.
const ACTOR_CELL = 4;
const OBSTACLE_CELL = 7;

// ================================================================ models
// Each model: list of { geo, mat } parts (body + glowing bits), drawn instanced.
// Ground units stand on y = 0 and face +Z; flyers are centred on their origin.
// Player units use the rigged materials (animated in the shader); each returns
// [body (casts shadows), glowing bits, optional flames].
const MODELS = {
  // Worker: orange hi-vis work suit, hard hat with lamp, tool pack; the wrench arm hammers while working.
  worker: () => {
    const legs = [-1, 1].map((s) => rig(merge([
      box(0.22, 0.42, 0.26, U.orange, s * 0.13, 0.33, 0),
      box(0.16, 0.08, 0.06, C.dark, s * 0.13, 0.34, 0.14),
      box(0.24, 0.13, 0.32, C.dark, s * 0.13, 0.07, 0.03),
    ]), RIG.SWING, s, [s * 0.13, 0.54, 0]));
    const armL = rig(merge([
      box(0.15, 0.4, 0.18, U.orange, -0.36, 0.8, 0),
      box(0.16, 0.12, 0.18, C.dark, -0.36, 0.55, 0.01),
    ]), RIG.SWING, 0.8, [-0.36, 0.98, 0]);
    const armR = rig(merge([
      box(0.15, 0.4, 0.18, U.orange, 0.36, 0.8, 0),
      box(0.16, 0.12, 0.18, C.dark, 0.36, 0.55, 0.01),
      box(0.05, 0.05, 0.36, C.metal, 0.36, 0.53, 0.2),        // wrench handle
      box(0.16, 0.07, 0.08, C.metal, 0.36, 0.53, 0.4),        // wrench head
    ]), RIG.TOOL, -0.8, [0.36, 0.98, 0]);
    return [
      { geo: rigMerge([
        ...legs, armL, armR,
        box(0.5, 0.12, 0.34, C.dark, 0, 0.6, 0),                 // belt
        box(0.56, 0.44, 0.36, U.orange, 0, 0.84, 0),             // torso
        box(0.58, 0.05, 0.38, U.hivis, 0, 0.74, 0), box(0.58, 0.05, 0.38, U.hivis, 0, 0.92, 0),
        box(0.12, 0.12, 0.08, 0x8a6a45, 0.18, 0.6, 0.2),         // tool pouch
        box(0.4, 0.42, 0.18, C.metal, 0, 0.84, -0.27),           // tool pack
        part(new THREE.CylinderGeometry(0.06, 0.06, 0.36, 6), C.dark, { x: 0.15, y: 0.84, z: -0.38 }),
        box(0.03, 0.3, 0.03, C.dark, -0.14, 1.16, -0.3),         // pack antenna
        box(0.24, 0.08, 0.24, C.dark, 0, 1.1, 0),
        box(0.4, 0.32, 0.38, U.white, 0, 1.26, 0),               // helmet
        box(0.46, 0.05, 0.46, U.hat, 0, 1.43, 0.02),             // hard-hat brim
        box(0.34, 0.1, 0.34, U.hat, 0, 1.5, 0),
        box(0.08, 0.04, 0.36, U.hatDark, 0, 1.56, 0),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.3, 0.13, 0.04, CYAN, 0, 1.27, 0.19),               // visor
        box(0.08, 0.06, 0.04, 0xfff0c8, 0, 1.47, 0.24),          // hard-hat lamp
        box(0.06, 0.06, 0.06, 0xff8a2a, -0.14, 1.33, -0.3),      // pack beacon
      ]), mat: RIG_GLOW },
    ];
  },

  // Soldier: blue armour, T-visor helmet, rifle held in both hands, jump-jet pack that fires while running.
  soldier: () => {
    const legs = [-1, 1].map((s) => rig(merge([
      box(0.24, 0.44, 0.28, U.blue, s * 0.15, 0.36, 0),
      box(0.26, 0.2, 0.3, U.blueDark, s * 0.15, 0.22, 0.01),
      box(0.18, 0.1, 0.08, U.blueDark, s * 0.15, 0.42, 0.15),
      box(0.26, 0.13, 0.34, C.dark, s * 0.15, 0.07, 0.03),
    ]), RIG.SWING, s, [s * 0.15, 0.58, 0]));
    return [
      { geo: rigMerge([
        ...legs,
        box(0.64, 0.12, 0.44, C.dark, 0, 0.64, 0),
        box(0.12, 0.12, 0.08, C.dark, -0.18, 0.64, 0.25), box(0.12, 0.12, 0.08, C.dark, 0.18, 0.64, 0.25),
        box(0.62, 0.54, 0.42, U.blue, 0, 0.94, 0),
        box(0.66, 0.32, 0.46, U.blueDark, 0, 1.04, 0.01),        // chest armour
        box(0.26, 0.14, 0.36, U.blueDark, -0.42, 1.18, 0), box(0.26, 0.14, 0.36, U.blueDark, 0.42, 1.18, 0),
        box(0.16, 0.42, 0.2, U.blue, 0.4, 0.98, 0.12, { rx: -0.9 }),               // arms reaching to the rifle
        box(0.16, 0.42, 0.2, U.blue, -0.32, 0.98, 0.16, { rx: -1.1, ry: 0.35 }),
        box(0.1, 0.16, 0.8, C.dark, 0.26, 0.88, 0.42),            // rifle
        box(0.05, 0.05, 0.3, C.metal, 0.26, 0.9, 0.95),
        box(0.06, 0.07, 0.18, C.metal, 0.26, 1.0, 0.32),
        box(0.06, 0.18, 0.08, C.dark, 0.26, 0.76, 0.3),
        box(0.46, 0.46, 0.2, U.armour, 0, 0.98, -0.32),           // jet pack
        box(0.5, 0.06, 0.22, C.accent, 0, 1.22, -0.32),
        part(new THREE.CylinderGeometry(0.08, 0.1, 0.34, 8), C.metal, { x: -0.16, y: 0.8, z: -0.44 }),
        part(new THREE.CylinderGeometry(0.08, 0.1, 0.34, 8), C.metal, { x: 0.16, y: 0.8, z: -0.44 }),
        box(0.05, 0.16, 0.2, U.armour, -0.3, 1.0, -0.36), box(0.05, 0.16, 0.2, U.armour, 0.3, 1.0, -0.36),
        box(0.26, 0.08, 0.26, C.dark, 0, 1.24, 0),
        box(0.44, 0.38, 0.44, U.armour, 0, 1.44, 0),              // helmet
        box(0.06, 0.08, 0.4, U.blueDark, 0, 1.66, -0.02),
        box(0.48, 0.1, 0.12, U.blueDark, 0, 1.3, 0.18),
        box(0.03, 0.26, 0.03, C.dark, 0.18, 1.72, -0.12),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.34, 0.08, 0.04, CYAN, 0, 1.47, 0.23), box(0.08, 0.12, 0.04, CYAN, 0, 1.38, 0.23),   // T visor
        box(0.08, 0.05, 0.02, 0x7dff9a, 0.16, 1.1, 0.25),
        box(0.12, 0.03, 0.12, 0xff8a2a, -0.16, 0.62, -0.44), box(0.12, 0.03, 0.12, 0xff8a2a, 0.16, 0.62, -0.44),
      ]), mat: RIG_GLOW },
      { geo: rigMerge([-1, 1].map((s) => flame(0.08, 0.5, 0xff9a50, [s * 0.16, 0.62, -0.44]))), mat: RIG_FLAME },
    ];
  },

  // Mining Bot: yellow industrial crawler, wheels roll as it drives, the drill spins while mining.
  miningBot: () => {
    const wheels = [];
    for (const s of [-1, 1]) for (const z of [-0.45, 0, 0.45]) {
      wheels.push(rig(merge([
        part(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 8), C.dark, { rz: Math.PI / 2, x: s * 0.66, y: 0.22, z }),
        box(0.13, 0.06, 0.3, C.metal, s * 0.66, 0.22, z),
      ]), RIG.ROLL, 1, [s * 0.66, 0.22, z]));
    }
    const drill = rig(merge([
      part(new THREE.ConeGeometry(0.2, 0.5, 6), C.metal, { rx: Math.PI / 2, x: 0.22, y: 0.62, z: 1.33 }),
      box(0.05, 0.05, 0.12, C.dark, 0.35, 0.62, 1.15), box(0.05, 0.05, 0.12, C.dark, 0.22, 0.72, 1.3), box(0.05, 0.05, 0.1, C.dark, 0.15, 0.62, 1.42),
    ]), RIG.DRILL, 18, [0.22, 0.62, 1.08]);
    return [
      { geo: rigMerge([
        ...wheels, drill,
        box(0.26, 0.34, 1.3, C.dark, -0.52, 0.24, 0), box(0.26, 0.34, 1.3, C.dark, 0.52, 0.24, 0),
        box(1.0, 0.42, 1.2, U.yellow, 0, 0.6, 0),                // chassis
        ...[1, 3].map((k) => box(0.18, 0.12, 0.04, C.dark, -0.36 + k * 0.18, 0.46, 0.61)),   // hazard stripes
        box(0.18, 0.12, 0.04, C.dark, 0.36, 0.46, 0.61),
        box(1.04, 0.06, 1.24, C.dark, 0, 0.82, 0),
        box(0.56, 0.36, 0.44, C.dark, -0.18, 1.02, 0.28),        // cab
        box(0.6, 0.05, 0.48, U.yellow, -0.18, 1.22, 0.28),
        box(0.42, 0.28, 0.44, C.metal, 0.22, 0.98, -0.32),       // ore hopper
        box(0.16, 0.16, 0.5, C.metal, 0.22, 0.62, 0.78),         // drill arm
        box(0.3, 0.3, 0.12, C.accent, 0.22, 0.62, 1.02),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.44, 0.12, 0.03, CYAN, -0.18, 1.06, 0.505),         // cab window
        box(0.1, 0.08, 0.03, 0xfff4dd, -0.36, 0.66, 0.61), box(0.1, 0.08, 0.03, 0xfff4dd, 0.36, 0.66, 0.61),
        box(0.1, 0.08, 0.1, 0xff8a2a, -0.18, 1.29, 0.28),        // beacon
        box(0.12, 0.12, 0.12, CYAN, 0.15, 1.15, -0.28), box(0.1, 0.1, 0.1, CYAN, 0.3, 1.14, -0.4),   // ore in the hopper
      ]), mat: RIG_GLOW },
    ];
  },

  // Combat Robot: heavy walker with twin arm cannons, shoulder missile pod and a glowing reactor.
  combatBot: () => {
    const legs = [-1, 1].map((s) => rig(merge([
      box(0.32, 0.5, 0.4, U.grey, s * 0.32, 0.8, 0),
      box(0.34, 0.16, 0.18, U.greyDark, s * 0.32, 0.56, 0.17),
      box(0.3, 0.42, 0.36, C.dark, s * 0.32, 0.34, 0),
      box(0.06, 0.3, 0.06, C.accent, s * 0.49, 0.36, -0.08),
      box(0.44, 0.12, 0.62, U.greyDark, s * 0.32, 0.06, 0.06),
      box(0.12, 0.08, 0.16, C.dark, s * 0.32 - 0.12, 0.04, 0.42), box(0.12, 0.08, 0.16, C.dark, s * 0.32 + 0.12, 0.04, 0.42),
    ]), RIG.SWING, s * 0.8, [s * 0.32, 1.05, 0]));
    const body = [
      ...legs,
      box(0.72, 0.24, 0.52, C.dark, 0, 1.08, 0),
      box(1.1, 0.72, 0.8, U.grey, 0, 1.52, 0),
      box(0.8, 0.4, 0.16, U.greyDark, 0, 1.58, 0.46),
      box(1.12, 0.07, 0.82, C.accent, 0, 1.86, 0),
      box(0.6, 0.5, 0.28, C.dark, 0, 1.5, -0.52),                // reactor pack
      ...[1.36, 1.46, 1.56].map((y) => box(0.5, 0.04, 0.04, 0x1c2430, 0, y + 0.08, -0.67)),
      box(0.46, 0.28, 0.46, C.dark, 0, 2.02, 0.06),              // sensor head
      box(0.5, 0.06, 0.5, U.greyDark, 0, 2.18, 0.06),
      box(0.03, 0.34, 0.03, C.dark, -0.16, 2.36, -0.08),
      box(0.3, 0.26, 0.4, U.greyDark, 0.5, 2.06, -0.14),         // missile pod
      ...[[-0.07, -0.06], [0.07, -0.06], [-0.07, 0.06], [0.07, 0.06]].map(([dx, dy]) => box(0.06, 0.06, 0.02, 0x1c2430, 0.5 + dx, 2.06 + dy, 0.07)),
    ];
    for (const s of [-1, 1]) {
      body.push(
        box(0.38, 0.3, 0.52, U.greyDark, s * 0.74, 1.76, 0),     // shoulder
        box(0.26, 0.26, 0.86, C.dark, s * 0.74, 1.42, 0.24),     // arm cannon
        box(0.3, 0.08, 0.3, C.accent, s * 0.74, 1.42, 0.5),
        tubeZ(0.07, 0.07, 0.34, C.metal, s * 0.74, 1.42, 0.82),
      );
    }
    return [
      { geo: rigMerge(body), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.36, 0.06, 0.04, CYAN, 0, 2.04, 0.3),               // sensor slit
        box(0.2, 0.2, 0.04, CYAN, 0, 1.5, -0.67),                // reactor core
        box(0.08, 0.08, 0.03, 0xff8a2a, -0.74, 1.42, 1.0), box(0.08, 0.08, 0.03, 0xff8a2a, 0.74, 1.42, 1.0),
        box(0.08, 0.05, 0.02, 0x7dff9a, -0.25, 1.66, 0.55),
      ]), mat: RIG_GLOW },
    ];
  },

  // Scout Drone: quad-rotor with spinning blades, camera gimbal and landing skids.
  scoutDrone: () => {
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const rotors = corners.map(([x, z]) => {
      const px = x * 0.62, pz = z * 0.62;
      return rig(merge([box(0.9, 0.025, 0.09, C.dark, px, 0.18, pz), box(0.09, 0.025, 0.9, C.dark, px, 0.18, pz)]),
        RIG.SPIN, 30 * x * z, [px, 0.18, pz]);
    });
    return [
      { geo: rigMerge([
        ...rotors,
        box(0.56, 0.22, 0.78, C.hull, 0, 0, 0),
        box(0.4, 0.14, 0.5, U.armour, 0, 0.16, -0.04),
        box(0.58, 0.04, 0.8, C.accent, 0, -0.02, 0),
        box(0.22, 0.16, 0.16, C.dark, 0, -0.02, 0.45),           // sensor head
        box(1.75, 0.07, 0.12, C.dark, 0, 0.04, 0, { ry: Math.PI / 4 }), box(1.75, 0.07, 0.12, C.dark, 0, 0.04, 0, { ry: -Math.PI / 4 }),
        ...corners.flatMap(([x, z]) => [
          part(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), C.metal, { x: x * 0.62, y: 0.08, z: z * 0.62 }),
          box(0.06, 0.06, 0.06, C.accent, x * 0.62, 0.19, z * 0.62),
          box(0.04, 0.18, 0.04, C.dark, x * 0.2, -0.18, z * 0.25),
        ]),
        box(0.04, 0.04, 0.7, C.dark, -0.2, -0.27, 0), box(0.04, 0.04, 0.7, C.dark, 0.2, -0.27, 0),   // skids
        box(0.14, 0.12, 0.14, C.dark, 0, -0.18, 0.25),           // camera gimbal
        box(0.02, 0.25, 0.02, C.dark, 0.12, 0.3, -0.25),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.12, 0.08, 0.03, CYAN, 0, -0.02, 0.535),            // eye
        box(0.08, 0.06, 0.03, CYAN, 0, -0.18, 0.33),             // camera lens
        box(0.2, 0.03, 0.2, CYAN, 0, -0.12, -0.12),              // under light
        box(0.05, 0.05, 0.05, 0xff2a2a, 0.75, 0.08, 0.62), box(0.05, 0.05, 0.05, 0x2aff6a, -0.75, 0.08, 0.62),   // nav lights
      ]), mat: RIG_GLOW },
    ];
  },

  // Fighter: a small cousin of your ship — swept wings, twin canted tail, wingtip guns, twin engines with flames.
  fighter: () => {
    const wingPts = [[0.3, 0.55], [1.45, -0.1], [1.45, -0.55], [0.3, -0.75]];
    const body = [
      box(0.6, 0.36, 1.9, C.hull, 0, 0, -0.05),
      pyramid(0.42, 0.75, C.hull, { sz: 0.75, rx: Math.PI / 2, z: 1.27 }),
      box(0.62, 0.38, 0.1, C.accent, 0, 0, 0.85),                // nose band
      box(0.36, 0.2, 0.62, U.glass, 0, 0.24, 0.35),              // canopy
      box(0.04, 0.04, 0.62, C.hull, 0, 0.345, 0.35),
      box(0.5, 0.2, 0.7, U.panel, 0, 0.12, -0.55),               // dorsal
      box(0.08, 0.3, 0.5, C.dark, 0, -0.28, -0.4),               // ventral fin
    ];
    for (const s of [-1, 1]) {
      body.push(
        sweptWing(wingPts, s, 0.08, -0.05, C.hull),
        box(1.1, 0.02, 0.1, C.accent, s * 0.86, -0.005, 0.12, { ry: s * 0.515 }),
        box(0.02, 0.38, 1.4, 0x1c2430, s * 0.31, 0, 0),           // panel line
        box(0.08, 0.08, 0.7, C.dark, s * 1.45, -0.03, -0.1),     // wingtip gun
        box(0.03, 0.03, 0.25, C.metal, s * 1.45, -0.03, 0.35),
        box(0.06, 0.42, 0.45, C.hull, s * 0.22, 0.32, -0.75, { rz: -s * 0.35 }),
        box(0.07, 0.12, 0.3, C.accent, s * 0.29, 0.51, -0.8, { rz: -s * 0.35 }),
        tubeZ(0.13, 0.15, 0.5, C.metal, s * 0.2, 0, -0.95),
        tubeZ(0.12, 0.15, 0.12, C.dark, s * 0.2, 0, -1.24),
      );
    }
    return [
      { geo: rigMerge(body), mat: RIG_BODY },
      { geo: rigMerge([
        tubeZ(0.1, 0.1, 0.02, 0x5ff0ff, -0.2, 0, -1.31), tubeZ(0.1, 0.1, 0.02, 0x5ff0ff, 0.2, 0, -1.31),
        box(0.06, 0.06, 0.06, 0xff2a2a, 1.45, 0.03, -0.48), box(0.06, 0.06, 0.06, 0x2aff6a, -1.45, 0.03, -0.48),
        box(0.18, 0.01, 0.04, 0x9fdfff, 0.06, 0.345, 0.45, { ry: 0.5 }),   // canopy glint
      ]), mat: RIG_GLOW },
      { geo: rigMerge([-1, 1].map((s) => flame(0.1, 0.8, 0x7fdfff, [s * 0.2, 0, -1.32], true))), mat: RIG_FLAME },
    ];
  },
  // ASI Architect: pearl-white floating builder in the ASI's colour — spinning halo, two manipulator
  // arms that hammer and weld while it builds, thrusters, and a construction beam projected below.
  architect: () => {
    const AI = 0xe6d6ff, PEARL = 0xf3f1f8, HALO = [0, 0.72, 0];
    const arms = [-1, 1].map((s) => rig(merge([
      box(0.18, 0.18, 0.18, C.dark, s * 0.6, -0.05, 0.15),
      box(0.12, 0.6, 0.12, C.metal, s * 0.6, -0.4, 0.15),
      box(0.11, 0.11, 0.5, C.metal, s * 0.6, -0.72, 0.38),
      ...(s < 0
        ? [box(0.16, 0.16, 0.16, C.dark, s * 0.6, -0.72, 0.66)]                                     // welder
        : [box(0.06, 0.18, 0.08, C.dark, s * 0.6 - 0.06, -0.78, 0.66), box(0.06, 0.18, 0.08, C.dark, s * 0.6 + 0.06, -0.78, 0.66)]),   // claw
    ]), RIG.TOOL, s * 0.5, [s * 0.6, -0.05, 0.15]));
    const beam = new THREE.ConeGeometry(0.55, 1.65, 10, 1, true);
    beam.translate(0, -0.825 - 0.88, 0);
    return [
      { geo: rigMerge([
        ...arms,
        rig(merge(ringOf(10, 0.95, 0.72, 0.36, 0.06, 0.1, C.hull)), RIG.SPIN, 1.2, HALO),
        part(new THREE.OctahedronGeometry(0.62), PEARL, { sy: 1.3 }),
        part(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 8), C.accent),
        box(1.3, 0.1, 0.14, C.metal, 0, -0.05, 0.15),                                                // arm mount
        pyramid(0.18, 0.4, C.accent, { y: 0.98 }),                                                   // crown fin
        part(new THREE.CylinderGeometry(0.16, 0.1, 0.18, 8), C.dark, { y: -0.78 }),                  // beam projector
        ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => part(new THREE.CylinderGeometry(0.12, 0.15, 0.22, 8), C.dark, { x: x * 0.45, y: -0.45, z: z * 0.4 })),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.42, 0.16, 0.06, AI, 0, 0.18, 0.5),                                                    // visor
        rig(merge([0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2 + 0.3; return box(0.14, 0.14, 0.14, AI, Math.cos(a) * 0.95, 0.72, Math.sin(a) * 0.95); })), RIG.SPIN, 1.2, HALO),
        ...[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2 + Math.PI / 4; return box(0.08, 0.08, 0.08, AI, Math.cos(a) * 0.51, 0, Math.sin(a) * 0.51); }),
        rig(merge([box(0.08, 0.08, 0.1, 0xffa040, -0.6, -0.72, 0.76)]), RIG.TOOL, -0.5, [-0.6, -0.05, 0.15]),   // welder tip
        ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => box(0.18, 0.03, 0.18, AI, x * 0.45, -0.57, z * 0.4)),
        box(0.14, 0.03, 0.14, AI, 0, -0.88, 0),
      ]), mat: RIG_GLOW },
      { geo: rigMerge([
        ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => flame(0.07, 0.35, 0xb9a4ff, [x * 0.45, -0.57, z * 0.4])),
        rig(paint(beam, 0x4a3d80), RIG.BEAM, 0, [0, -0.88, 0]),                                    // construction beam
      ]), mat: RIG_FLAME },
    ];
  },

  // ----- enemies
  // Crawler: six-legged alien bug (tripod gait), snapping mandibles, glowing stripes, tail stinger.
  crawler: () => {
    const CH = 0x3b2350, CHD = 0x2a1838, LEG = 0x24162f, SPK = 0x5a2f74, BIO = 0xff3aa0;
    const legs = [];
    [0.42, 0.05, -0.32].forEach((z, k) => {
      for (const s of [-1, 1]) {
        const offset = ((k % 2 === 0) === (s > 0) ? 0 : Math.PI) + (s < 0 ? Math.PI : 0);   // tripod gait
        const hip = [s * 0.42, 0.62, z], knee = [s * 1.0, 0.95, z + 0.12 * (1 - k)], foot = [s * 1.3, 0.02, z + 0.3 * (1 - k)];
        legs.push(rig(merge([strut(hip, knee, 0.12, LEG), strut(knee, foot, 0.09, LEG), box(0.16, 0.16, 0.16, SPK, ...knee)]), RIG.LEG_Y, offset, hip));
      }
    });
    const jaws = [-1, 1].map((s) => rig(merge([
      box(0.08, 0.08, 0.42, SPK, s * 0.2, 0.48, 1.08, { ry: -s * 0.35 }),
      box(0.06, 0.06, 0.18, 0xd8c8e8, s * 0.08, 0.48, 1.3, { ry: -s * 0.9 }),
    ]), RIG.JAW, s, [s * 0.16, 0.48, 0.88]));
    return [
      { geo: rigMerge([
        ...legs, ...jaws,
        box(0.9, 0.48, 0.8, CH, 0, 0.62, 0.1),                                                       // thorax
        box(1.0, 0.12, 0.84, CHD, 0, 0.88, 0.1),                                                     // carapace
        box(0.62, 0.42, 0.5, CHD, 0, 0.6, 0.7),                                                      // head
        box(0.66, 0.1, 0.4, SPK, 0, 0.84, 0.72),
        part(new THREE.DodecahedronGeometry(0.62, 0), CH, { sx: 1.1, sy: 0.75, sz: 1.35, y: 0.78, z: -0.75 }),   // abdomen
        part(new THREE.ConeGeometry(0.14, 0.6, 5), SPK, { rx: -1.2, y: 0.95, z: -1.5 }),             // stinger
        ...[0.35, 0.05, -0.3, -0.65, -0.95].map((z, i) => part(new THREE.ConeGeometry(0.12, 0.45 + (i % 2) * 0.15, 4), SPK, { y: z > -0.4 ? 1.1 : 1.22, z })),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.12, 0.1, 0.04, RED, 0.16, 0.7, 0.955), box(0.12, 0.1, 0.04, RED, -0.16, 0.7, 0.955),
        box(0.07, 0.06, 0.04, RED, 0.27, 0.78, 0.94), box(0.07, 0.06, 0.04, RED, -0.27, 0.78, 0.94),
        rig(merge([
          box(0.6, 0.04, 0.09, BIO, 0, 1.2, -0.75), box(0.5, 0.04, 0.08, BIO, 0, 1.15, -0.5), box(0.5, 0.04, 0.08, BIO, 0, 1.12, -1.02),
          box(0.04, 0.08, 0.4, BIO, 0.66, 0.8, -0.75), box(0.04, 0.08, 0.4, BIO, -0.66, 0.8, -0.75),
        ]), RIG.PULSE, 0, [0, 1.0, -0.75]),
      ]), mat: RIG_GLOW },
    ];
  },

  // Rogue Drone: dark octahedral core inside a spinning bladed ring, red eye, twin gun pods, red thruster.
  rogueDrone: () => {
    const DK = 0x1b1b24, PL = 0x2a2a36, RD = 0x8a1a22;
    const spikes = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return box(0.08, 0.08, 0.4, RD, Math.cos(a) * 1.18, 0, Math.sin(a) * 1.18, { ry: Math.PI / 2 - a });
    });
    return [
      { geo: rigMerge([
        rig(merge([...ringOf(8, 0.95, 0, 0.4, 0.08, 0.12, PL), ...spikes]), RIG.SPIN, 6, [0, 0, 0]),
        part(new THREE.OctahedronGeometry(0.55), DK, { sy: 0.85 }),
        box(0.95, 0.1, 0.42, PL, 0, 0.12, 0), box(0.42, 0.1, 0.95, PL, 0, 0.12, 0),               // armour cross
        box(0.3, 0.2, 0.3, PL, 0, 0.42, -0.05),
        box(0.03, 0.4, 0.03, RD, 0.1, 0.62, -0.1), box(0.03, 0.4, 0.03, RD, -0.1, 0.62, -0.1),    // antennae
        box(0.14, 0.14, 0.55, DK, 0.42, -0.18, 0.25), box(0.14, 0.14, 0.55, DK, -0.42, -0.18, 0.25),
        box(0.05, 0.05, 0.25, C.metal, 0.42, -0.18, 0.62), box(0.05, 0.05, 0.25, C.metal, -0.42, -0.18, 0.62),
        part(new THREE.CylinderGeometry(0.12, 0.18, 0.18, 8), PL, { y: -0.42 }),
      ]), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.32, 0.14, 0.08, RED, 0, 0, 0.47),
        rig(merge([box(0.12, 0.12, 0.06, 0xffa0a0, 0, 0, 0.53)]), RIG.PULSE, 0, [0, 0, 0.53]),
        rig(merge([0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2; return box(0.1, 0.1, 0.14, RED, Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95); })), RIG.SPIN, 6, [0, 0, 0]),
        box(0.07, 0.07, 0.04, RED, 0.42, -0.18, 0.76), box(0.07, 0.07, 0.04, RED, -0.42, -0.18, 0.76),
        box(0.02, 0.04, 0.5, RED, 0.5, -0.02, -0.05), box(0.02, 0.04, 0.5, RED, -0.5, -0.02, -0.05),
      ]), mat: RIG_GLOW },
      { geo: rigMerge([flame(0.12, 0.5, 0xff4030, [0, -0.51, 0])]), mat: RIG_FLAME },
    ];
  },

  // Rogue Walker: heavy reverse-jointed mech with shoulder cannons, a missile rack and a red visor slit.
  rogueWalker: () => {
    const DK = 0x22222c, HL = 0x2e2e3a, RD = 0x8a1a22;
    const legs = [-1, 1].map((s) => {
      const hip = [s * 0.5, 1.4, 0], knee = [s * 0.55, 0.8, -0.35], ankle = [s * 0.55, 0.22, 0.12];
      return rig(merge([
        box(0.36, 0.36, 0.42, HL, ...hip),
        strut(hip, knee, 0.26, DK), strut(knee, ankle, 0.2, DK),
        box(0.22, 0.22, 0.22, RD, ...knee),
        strut([s * 0.66, 1.1, -0.2], [s * 0.66, 0.45, 0.0], 0.06, C.metal),                       // piston
        box(0.46, 0.12, 0.72, HL, s * 0.55, 0.06, 0.2),                                             // foot
        box(0.1, 0.08, 0.2, DK, s * 0.55 - 0.15, 0.04, 0.6), box(0.1, 0.08, 0.2, DK, s * 0.55 + 0.15, 0.04, 0.6),
        box(0.1, 0.08, 0.2, DK, s * 0.55, 0.04, -0.2),                                              // heel spur
      ]), RIG.SWING, s * 0.7, hip);
    });
    const body = [
      ...legs,
      box(1.0, 0.3, 0.7, DK, 0, 1.4, 0),
      box(1.4, 0.9, 1.2, HL, 0, 1.95, -0.05),
      box(1.1, 0.5, 0.3, DK, 0, 2.0, 0.62, { rx: -0.35 }),                                          // armoured wedge
      box(1.42, 0.08, 1.22, RD, 0, 2.42, -0.05),
      box(0.7, 0.36, 0.5, DK, 0, 2.6, 0.25),                                                        // cockpit head
      box(0.9, 0.5, 0.4, HL, 0, 2.6, -0.65),                                                        // missile rack
      ...[-0.3, 0, 0.3].flatMap((x) => [box(0.14, 0.04, 0.14, 0x101016, x, 2.86, -0.56), box(0.14, 0.04, 0.14, 0x101016, x, 2.86, -0.76)]),
      box(0.5, 0.3, 0.1, DK, 0, 1.85, -0.68),                                                       // exhaust
      box(0.03, 0.6, 0.03, C.metal, 0.3, 3.05, 0.1),
    ];
    for (const s of [-1, 1]) {
      body.push(
        box(0.2, 0.5, 0.6, HL, s * 0.8, 2.15, -0.05),
        box(0.26, 0.26, 1.3, DK, s * 0.9, 1.95, 0.55),
        box(0.32, 0.18, 0.14, C.metal, s * 0.9, 1.95, 1.2),
        box(0.3, 0.06, 0.3, RD, s * 0.9, 1.95, 0.3),
      );
    }
    return [
      { geo: rigMerge(body), mat: RIG_BODY },
      { geo: rigMerge([
        box(0.5, 0.08, 0.04, RED, 0, 2.62, 0.51),                                                   // visor slit
        box(0.12, 0.12, 0.03, RED, -0.9, 1.95, 1.28), box(0.12, 0.12, 0.03, RED, 0.9, 1.95, 1.28),
        ...[-0.3, 0, 0.3].flatMap((x) => [box(0.08, 0.03, 0.08, RED, x, 2.885, -0.56), box(0.08, 0.03, 0.08, RED, x, 2.885, -0.76)]),
        rig(merge([box(0.4, 0.18, 0.03, 0xff5030, 0, 1.85, -0.74)]), RIG.PULSE, 0, [0, 1.85, -0.74]),
        box(0.06, 0.06, 0.06, RED, 0.3, 3.37, 0.1),
      ]), mat: RIG_GLOW },
    ];
  },
};
Object.assign(MODELS, BROOD_MODELS);
const modelCache = {};
const modelParts = (type) => (modelCache[type] ??= MODELS[type]());
/** Model parts [{ geo, mat }] of a unit type (also used for Brood ships flying through space). */
export const unitModelParts = modelParts;

/** Height of the health bar above an actor's origin. */
const BAR_HEIGHT = { architect: 1.6, worker: 1.95, soldier: 2.0, miningBot: 1.7, combatBot: 2.75, scoutDrone: 0.9, fighter: 1.0, crawler: 1.7, rogueDrone: 1.2, rogueWalker: 4.1, ...BROOD_BAR_HEIGHT };

// ================================================================= Actor
let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _w2 = new THREE.Vector3();
const _raw = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class Actor {
  constructor(mgr, type, faction, planet, dir) {
    this.id = NEXT_ID++;
    this.mgr = mgr;
    this.type = type;
    this.faction = faction;                     // 'player' | 'enemy'
    const brood = CONFIG.brood.units[type] ?? CONFIG.brood.structures[type];
    this.def = faction === 'player' ? (CONFIG.units[type] ?? CONFIG.asiUnits[type]) : (CONFIG.enemies[type] ?? brood);
    this.brood = !!brood;                       // a Brood organism (brood.js runs its AI)
    this.structure = !!CONFIG.brood.structures[type];
    this.altitude = null;                       // flyers: overrides def.altitude (Brood ships descending / climbing)
    this.planet = planet;
    this.dir = dir.clone().normalize();
    this.home = this.dir.clone();               // crawlers wander around their nest
    this.heading = anyPerpendicular(this.dir, new THREE.Vector3());
    this.local = new THREE.Vector3();           // planet-local position
    this.hp = this.def.hp;
    this.alive = true;
    this.state = 'idle';
    this.task = null;
    this.cooldown = 0;
    this.scanT = Math.random() * 0.4;
    this.workT = 0;
    this.carry = { item: null, amount: 0 };
    this.bob = Math.random() * 6;
    this.moving = false;
    this.lastHit = -99;
    this._place();
  }

  get flying() { return !!this.def.flying; }
  get radius() { return this.def.radius; }
  get worldPos() { return this.local.clone().add(this.planet.position); }
  get isGatherer() { return !!this.def.gather; }
  get isBuilder() { return !!this.def.build; }
  get hasWeapon() { return !!this.def.weapon; }

  _place() {
    const lift = this.flying ? (this.altitude ?? this.def.altitude) + Math.sin(this.bob) * 0.3 : 0;
    this.local.copy(this.dir).multiplyScalar(this.planet.radius + this.planet.walkHeight(this.dir) + lift);
  }

  /** Movement speed after hunger / power penalties. */
  speed() {
    return this.def.speed * this.mgr.speedFactor(this);
  }

  /**
   * Walk / fly toward a planet-local point. Returns true once within `stopDist`.
   *
   * Ground units follow an A* route over dry land (navigation.js) whenever the
   * straight line is blocked by water, lava or buildings, steer locally around
   * trees and rocks, never step into liquid, and have a safety net so they can
   * never stay stuck: re-route after a few seconds, then hop to the next waypoint.
   */
  moveTowards(target, dt, stopDist, usePath = true) {
    const up = this.dir;
    const flat = _v.copy(target).sub(this.local);
    projectOnPlane(flat, up);
    const dist = flat.length();
    if (dist <= stopDist) { this.moving = false; this._resetStuck(); this.path = null; return true; }

    // Where to head right now: the target itself, or the next waypoint of a route.
    const aim = !this.flying && usePath ? this._steerTarget(target, dt) : target;
    const want = _v.copy(aim).sub(this.local);
    projectOnPlane(want, up);
    if (want.lengthSq() < 1e-6) want.copy(this.heading);
    want.normalize();
    const route = _raw.copy(want);                // the direction we really need to go
    if (!this.flying) this._avoidObstacles(want, target, this.path ? 0.6 : 1);
    this.mgr.separate(this, want);
    projectOnPlane(want, up);
    if (want.lengthSq() < 1e-6) want.copy(route);
    want.normalize();
    this.heading.lerp(want, 1 - Math.exp(-10 * dt));
    projectOnPlane(this.heading, up);
    if (this.heading.lengthSq() < 1e-6) anyPerpendicular(up, this.heading);
    this.heading.normalize();

    const step = Math.min(dist, this.speed() * dt);
    const next = _w.copy(this.dir).addScaledVector(this.heading, step / this.planet.radius).normalize();
    if (!this.flying && this.planet.isSubmerged(next)) {
      // Never walk into liquid: take the closest dry direction to the route instead.
      if (!this._dryStep(route, step)) { this.moving = false; this._checkStuck(dt, target); return false; }
    } else {
      this.dir.copy(next);
    }
    this.moving = step > 0.001;
    this.bob += dt * this.speed() * 2.2;
    if (!this.flying) this._checkStuck(dt, target);
    return false;
  }

  /** Step along the route direction, or the nearest rotation of it that stays dry. */
  _dryStep(route, step) {
    const up = this.dir, h = new THREE.Vector3(), probe = new THREE.Vector3();
    for (const ang of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
      h.copy(route).applyAxisAngle(up, ang);
      probe.copy(up).addScaledVector(h, step / this.planet.radius).normalize();
      if (!this.planet.isSubmerged(probe)) {
        this.dir.copy(probe);
        this.heading.copy(h);
        return true;
      }
    }
    return false;
  }

  /**
   * Route planning: go straight when the line is clear, otherwise follow A*
   * waypoints (string-pulled so the walk stays smooth). Returns the point to head for.
   */
  _steerTarget(target, dt) {
    const nav = getNav(this.planet), N = CONFIG.navigation, R = this.planet.radius;
    this.repathT = (this.repathT ?? 0) - dt;
    const goalMoved = !this.pathGoal || this.pathGoal.distanceToSquared(target) > 9;
    if ((goalMoved || this.forceRepath) && this.repathT <= 0) {
      this.repathT = N.repathInterval;
      this.forceRepath = false;
      this.pathGoal = (this.pathGoal ?? new THREE.Vector3()).copy(target);
      const goalDir = target.clone().normalize();
      if (nav.lineClear(this.dir, goalDir)) {
        this.path = null;
        this.pathFailed = false;
      } else {
        this.path = nav.findPath(this.dir, goalDir, THREE.Vector3);
        this.pathIdx = 0;
        this.pathFailed = !this.path;
      }
    }
    if (!this.path) return target;
    const path = this.path;
    // advance past waypoints we have reached
    while (this.pathIdx < path.length - 1 && this.dir.angleTo(path[this.pathIdx]) * R < N.waypointReach) this.pathIdx++;
    // string-pulling: skip ahead to the farthest waypoint in a clear straight line
    this.pullT = (this.pullT ?? 0) - dt;
    if (this.pullT <= 0) {
      this.pullT = 0.3;
      for (let k = Math.min(path.length - 1, this.pathIdx + 6); k > this.pathIdx; k--) {
        if (nav.lineClear(this.dir, path[k])) { this.pathIdx = k; break; }
      }
    }
    const wp = path[this.pathIdx];
    if (this.pathIdx === path.length - 1) return target;
    return _aim.copy(wp).multiplyScalar(R + this.planet.walkHeight(wp));
  }

  _resetStuck() {
    this.stuckClock = 0;
    this.stuckCount = 0;
    this.stuckFrom = null;
  }

  /**
   * Safety net: if the unit barely moves for a while, re-plan its route; if it
   * is still stuck, hop it to the next waypoint (or a little toward the target).
   */
  _checkStuck(dt, target) {
    const N = CONFIG.navigation;
    this.stuckClock = (this.stuckClock ?? 0) + dt;
    if (!this.stuckFrom) this.stuckFrom = this.dir.clone();
    if (this.stuckClock < N.stuckCheck) return;
    const moved = this.stuckFrom.angleTo(this.dir) * this.planet.radius;
    this.stuckClock = 0;
    this.stuckFrom.copy(this.dir);
    if (moved >= N.stuckDistance) { this.stuckCount = 0; return; }
    this.stuckCount = (this.stuckCount ?? 0) + 1;
    this.forceRepath = true;
    this.repathT = 0;
    if (this.stuckCount < N.stuckNudgeAfter) return;
    // Hop: next waypoint if we have a route, else 2.5 m toward the target if dry.
    this.stuckCount = 0;
    const R = this.planet.radius;
    let hop = null;
    if (this.path && this.path[this.pathIdx]) {
      hop = this.path[Math.min(this.path.length - 1, this.pathIdx + 1)].clone();
      if (this.planet.isSubmerged(hop)) hop = this.path[this.pathIdx].clone();
    } else {
      const toward = _raw.copy(target).sub(this.local);
      projectOnPlane(toward, this.dir);
      if (toward.lengthSq() > 1e-6) hop = this.dir.clone().addScaledVector(toward.normalize(), 2.5 / R).normalize();
    }
    if (hop && !this.planet.isSubmerged(hop) && hop.angleTo(this.dir) * R < 8) {
      this.dir.copy(hop);
      this.pathIdx = Math.min((this.pathIdx ?? 0) + 1, (this.path?.length ?? 1) - 1);
    }
  }

  _avoidObstacles(want, target, strength = 1) {
    const local = this.local;
    const near = this.mgr.obstaclesNear(this.planet, local);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      const reach = o.r + this.radius + 1.2;
      const dx = local.x - o.pos.x, dy = local.y - o.pos.y, dz = local.z - o.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach * reach) continue;
      // don't be pushed away from what we are walking to
      if (o.pos.distanceToSquared(target) < (o.r + 0.5) ** 2) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = ((reach - d) / reach) * 2.2 * strength;
      want.x += (dx / d) * push; want.y += (dy / d) * push; want.z += (dz / d) * push;
    }
  }

  facePoint(target) {
    const f = _v.copy(target).sub(this.local);
    projectOnPlane(f, this.dir);
    if (f.lengthSq() > 1e-6) this.heading.copy(f.normalize());
  }

  /**
   * Ground distance to a target's edge. Measured along the surface (ignoring
   * flight altitude) so flyers and ground units use the same ranges as
   * their movement does.
   */
  edgeDistance(t) {
    const d = _w2.copy(targetLocal(t)).normalize();
    return this.dir.angleTo(d) * this.planet.radius - (t.radius || 0);
  }

  takeDamage(amount, game, source) {
    if (!this.alive) return;
    if (this.invulnerable) { game.brood?.onSealedHit(this); return; }   // the dormant Brood chrysalis
    this.hp -= amount;
    this.lastHit = game.time;
    if (this.hp <= 0) { this.alive = false; this.mgr.onDeath(this, source); return; }
    // Fight back: enemies always turn on whoever shot them; idle player units too.
    if (!source || source.alive === false || !this.hasWeapon || this.state === 'attack') return;
    if (this.faction === 'enemy') {
      const raid = this.state === 'raid' ? this.task : this.task?.raid ?? null;
      this.order({ kind: 'attack', target: source, raid });
    } else if (this.state === 'idle') {
      this.order({ kind: 'attack', target: source, auto: true, origin: this.local.clone() });
    }
  }

  /** Give this actor a new task. */
  order(task) {
    this.task = task;
    this.workT = 0;
    this.state = task ? task.kind : 'idle';
  }

  fireAt(t, game) {
    const w = this.def.weapon;
    this.cooldown = w.cooldown;
    this.facePoint(targetLocal(t));
    const from = this.worldPos.addScaledVector(this.dir, this.flying ? 0 : 1.1);
    const to = targetLocal(t).clone().add(this.planet.position).addScaledVector(this.dir, t.flying ? 0 : 0.8);
    this.mgr.spawnBolt(this.brood ? 'brood' : this.faction, from, to, SHOT_SOUND[this.type]);
    t.takeDamage(w.damage * (this.faction === 'player' ? (game.modifiers.damage ?? 1) : 1), game, this);
  }
}

/** Planet-local position of anything targetable (actor, building, astronaut). */
export function targetLocal(t) { return t.local ?? t.localPos; }

// =========================================================== UnitManager
export class UnitManager {
  constructor(game) {
    this.game = game;
    this.actors = [];
    this.pools = new Map();     // "planet|type|part" → InstancedMesh
    this.selected = [];         // selected player units
    this.hungry = false;
    this.offline = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._initBolts();
    this._initRings();
  }

  // -------------------------------------------------------------- queries
  /** The player's own units (ASI-controlled units like the Architect are not included). */
  get playerUnits() { return this.actors.filter((a) => a.faction === 'player' && !a.def.asi); }
  playerCount() { let n = 0; for (const a of this.actors) if (a.faction === 'player' && !a.def.asi) n++; return n; }
  canSpawnMore() { return this.playerCount() < this.game.unitCap; }
  enemiesOn(planet) { return this.actors.filter((a) => a.faction === 'enemy' && a.planet === planet); }

  speedFactor(a) {
    if (a.faction !== 'player') return 1;
    // Autonomous Swarm (Singularity): robots and workers move / work faster.
    const swarm = (a.type === 'worker' || a.def.kind === 'robot') ? (this.game.modifiers.unitSpeed ?? 1) : 1;
    if (a.def.kind === 'human' && this.hungry) return CONFIG.unitRules.hungrySpeed * swarm;
    if (a.def.kind !== 'human' && this.offline) return CONFIG.unitRules.offlineSpeed * swarm;
    return swarm;
  }

  /** Nearest hostile within range for an actor (or for a point, if `from` is a vector). */
  nearestHostile(a, range) {
    let best = null, bestD = range;
    const consider = (t) => {
      if (!t || !t.alive || t.invulnerable) return;
      const d = a.edgeDistance(t);
      if (d < bestD) { bestD = d; best = t; }
    };
    for (const o of this.actors) {
      if (o.faction !== a.faction && o.planet === a.planet) consider(o);
    }
    if (a.faction === 'enemy') {
      for (const base of a.planet.bases) for (const b of base.buildings) consider(b);
      const astro = this.game.astronautTarget;
      if (astro && astro.planet === a.planet) consider(astro);
    }
    return best;
  }

  /** Nearest enemy actor to a planet-local point (used by the astronaut's blaster). */
  nearestEnemyTo(planet, local, range) {
    let best = null, bestD = range;
    for (const o of this.actors) {
      if (o.faction !== 'enemy' || o.planet !== planet || !o.alive || o.invulnerable) continue;
      const d = o.local.distanceTo(local) - o.radius;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  nearestCore(a) {
    let best = null, bestD = Infinity;
    for (const base of a.planet.bases) {
      const c = base.core;
      if (!c || !c.built) continue;
      const d = c.localPos.distanceTo(a.local);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** Nearest non-empty node of a type (any harvestable type if `type` is null). */
  findNode(a, type, near = a.local) {
    let best = null, bestD = CONFIG.unitRules.nodeSearchRadius;
    const now = this.game.time;
    for (const n of a.planet.resources.nodes) {
      if (n.amount <= 0 || (type && n.type !== type)) continue;
      if (a.unreachable && now - (a.unreachable.get(n.id) ?? -1e9) < 120) continue;   // recently unreachable
      const d = n.pos.distanceTo(near);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** A building on this planet that needs construction or repairs. */
  findBuildJob(a) {
    let best = null, bestD = CONFIG.unitRules.autoTaskRadius;
    for (const base of a.planet.bases) {
      for (const b of base.buildings) {
        if (b.planned || (b.built && b.hp >= b.maxHp - 0.5)) continue;
        const d = b.localPos.distanceTo(a.local);
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    return best;
  }

  // ------------------------------------------------------- spatial grids
  // Units only look at neighbours in nearby grid cells instead of checking
  // every other unit / obstacle — keeps big armies cheap.

  /** Numeric cell id (planet + integer cell coordinates, each offset into 0..255). */
  static cellId(planetIndex, cx, cy, cz) {
    return ((planetIndex * 256 + cx + 128) * 256 + cy + 128) * 256 + cz + 128;
  }

  static cellKey(planetIndex, x, y, z, size) {
    return UnitManager.cellId(planetIndex, Math.floor(x / size), Math.floor(y / size), Math.floor(z / size));
  }

  /** Rebuild the actor grid (once per frame). */
  _buildActorGrid() {
    const S = ACTOR_CELL, grid = (this.actorGrid ??= new Map());
    grid.clear();
    for (const a of this.actors) {
      if (!a.alive) continue;
      const key = UnitManager.cellKey(a.planet.index, a.local.x, a.local.y, a.local.z, S);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(a);
    }
  }

  /**
   * Items stored in the 27 cells around a point, written into `out` (a reused
   * array, so no garbage per call). Returns `out`.
   */
  _near(grid, planetIndex, p, S, out) {
    out.length = 0;
    if (!grid) return out;
    const cx = Math.floor(p.x / S), cy = Math.floor(p.y / S), cz = Math.floor(p.z / S);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const list = grid.get(UnitManager.cellId(planetIndex, x, y, z));
      if (list) for (let i = 0; i < list.length; i++) out.push(list[i]);
    }
    return out;
  }

  /** Obstacles (trees, rocks, nodes, buildings) near a planet-local point. Grid cached per planet. */
  obstaclesNear(planet, p) {
    const version = `${planet.obstacles.length}:${planet.navVersion}`;
    if (!planet._obsGrid || planet._obsGrid.version !== version) {
      const map = new Map();
      for (const o of planet.obstacles) {
        const key = UnitManager.cellKey(planet.index, o.pos.x, o.pos.y, o.pos.z, OBSTACLE_CELL);
        let list = map.get(key);
        if (!list) map.set(key, (list = []));
        list.push(o);
      }
      planet._obsGrid = { version, map };
    }
    return this._near(planet._obsGrid.map, planet.index, p, OBSTACLE_CELL, (this._obsBuf ??= []));
  }

  /** Push actors apart so groups don't stack on one spot. */
  separate(a, want) {
    const near = this._near(this.actorGrid, a.planet.index, a.local, ACTOR_CELL, (this._actBuf ??= []));
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === a || o.flying !== a.flying) continue;
      const min = a.radius + o.radius + 0.4;
      const dx = a.local.x - o.local.x, dy = a.local.y - o.local.y, dz = a.local.z - o.local.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 <= min * min) || d2 < 1e-6) continue;   // also skips NaN
      const d = Math.sqrt(d2);
      const push = ((min - d) / min) * 1.5;
      want.x += (dx / d) * push; want.y += (dy / d) * push; want.z += (dz / d) * push;
    }
  }

  // ------------------------------------------------------------- spawning
  spawn(type, faction, planet, dir) {
    const a = new Actor(this, type, faction, planet, dir);
    this.actors.push(a);
    return a;
  }

  /** A production building finished training a unit: it walks out of the front door. */
  spawnFrom(type, building) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(building.group.quaternion);
    const pos = building.localPos.clone().addScaledVector(fwd, building.radius + 1.8);
    const a = this.spawn(type, 'player', building.planet, pos);
    a.heading.copy(projectOnPlane(fwd.clone(), a.dir).normalize());
    // Gatherers get straight to work on the nearest mineral node.
    if (a.isGatherer) {
      const node = this.findNode(a, null);
      if (node) a.order({ kind: 'gather', node });
    }
    this.game.hud.notify(`${a.def.name} ready — ${building.planet.name}, colony ${building.base.number}`, 'success');
    return a;
  }

  onDeath(a, source) {
    this.selected = this.selected.filter((s) => s !== a);
    if (a.bar) a.bar.group.removeFromParent();
    if (a.faction === 'player') this.game.hud.notify(`${a.def.name} lost on ${a.planet.name}`, 'warn');
    this.game.onActorKilled?.(a, source);
    if (a.brood) this.game.brood?.onActorDeath(a, source);
  }

  // --------------------------------------------------------------- orders
  /**
   * Right-click command from build mode.
   * target: { kind: 'attack', target } | { kind: 'gather', node } | { kind: 'build', building } | { kind: 'move', point }
   */
  command(units, target, heading) {
    if (!units.length) return;
    if (target.kind === 'move') {
      // Spread the group on a small grid around the clicked point.
      const up = target.point.clone().normalize();
      const fwd = projectOnPlane(heading.clone(), up).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, up);
      const cols = Math.ceil(Math.sqrt(units.length));
      units.forEach((u, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const p = target.point.clone()
          .addScaledVector(right, (c - (cols - 1) / 2) * 2.2)
          .addScaledVector(fwd, -(r - (Math.ceil(units.length / cols) - 1) / 2) * 2.2);
        u.order({ kind: 'move', point: p });
      });
      return;
    }
    for (const u of units) {
      if (target.kind === 'gather' && u.isGatherer) u.order({ kind: 'gather', node: target.node });
      else if (target.kind === 'build' && u.isBuilder) u.order({ kind: 'build', building: target.building });
      else if (target.kind === 'attack' && u.hasWeapon) u.order({ kind: 'attack', target: target.target });
      else u.order({ kind: 'move', point: targetLocal(target.node ?? target.building ?? target.target).clone() });
    }
  }

  // --------------------------------------------------------------- update
  update(dt) {
    const game = this.game;
    this._upkeep(dt);
    this._buildActorGrid();
    for (const a of this.actors) {
      if (!a.alive) continue;
      a.cooldown = Math.max(0, a.cooldown - dt);
      a.scanT -= dt;
      if (a.faction === 'player') this._playerAI(a, dt);
      else if (!(a.brood && game.brood.think(a, dt))) this._enemyAI(a, dt);
      // Safety: an invalid position must never spread to neighbours — reset it.
      if (!Number.isFinite(a.dir.x + a.dir.y + a.dir.z)) {
        a.dir.copy(Number.isFinite(a.home.x + a.home.y + a.home.z) ? a.home : new THREE.Vector3(0, 1, 0));
        anyPerpendicular(a.dir, a.heading);
        a.order(null);
      }
      a._place();
    }
    this.actors = this.actors.filter((a) => a.alive);
    this._updateBolts(dt);
    this._render();
  }

  /** Humans eat food, robots and drones draw energy. Shortages slow them down. */
  _upkeep(dt) {
    const inv = this.game.inventory;
    let food = 0, energy = 0;
    for (const a of this.actors) {
      if (a.faction !== 'player') continue;
      food += (a.def.foodPerMin || 0) / 60;
      energy += a.def.energyPerSec || 0;
    }
    const wasHungry = this.hungry, wasOffline = this.offline;
    this.hungry = food > 0 && inv.get('food') < food * dt;
    this.offline = energy > 0 && inv.get('energy') < energy * dt;
    if (!this.hungry) inv.add('food', -food * dt);
    if (!this.offline) inv.add('energy', -energy * dt);
    if (this.hungry && !wasHungry) this.game.hud.notify('Out of food — your humans are starving and slow. Build Farms or Ranches.', 'warn');
    if (this.offline && !wasOffline) this.game.hud.notify('Out of energy — robots and drones are running on reserve power.', 'warn');
  }

  _playerAI(a, dt) {
    const game = this.game, def = a.def, rules = CONFIG.unitRules;
    switch (a.state) {
      case 'idle': {
        a.moving = false;
        if (a.scanT > 0) break;
        a.scanT = 0.35;
        if (a.hasWeapon) {
          const t = this.nearestHostile(a, def.aggro);
          if (t) { a.order({ kind: 'attack', target: t, auto: true, origin: a.local.clone() }); break; }
        }
        if (a.isBuilder) {
          const b = this.findBuildJob(a);
          if (b) a.order({ kind: 'build', building: b, auto: true });
        }
        break;
      }
      case 'move':
        if (a.moveTowards(a.task.point, dt, 0.6) || a.pathFailed) { a.pathFailed = false; a.order(null); }
        break;

      case 'attack': {
        const t = a.task.target;
        if (!t || !t.alive || t.planet && t.planet !== a.planet) { a.order(null); break; }
        const range = def.weapon.range;
        const d = a.edgeDistance(t);
        // auto-acquired targets are not chased forever
        if (a.task.auto && a.task.origin && a.local.distanceTo(a.task.origin) > def.aggro * 1.8) { a.order({ kind: 'move', point: a.task.origin }); break; }
        if (d > range) a.moveTowards(targetLocal(t), dt, range * 0.85 + (t.radius || 0));
        else { a.moving = false; a.facePoint(targetLocal(t)); if (a.cooldown <= 0) a.fireAt(t, game); }
        break;
      }

      case 'gather': {
        let node = a.task.node;
        const item = node && CONFIG.resources.types[node.type].item;
        // Carrying something else (or full)? Deliver first.
        if (a.carry.amount > 0 && (a.carry.item !== item || a.carry.amount >= def.gather.capacity)) { a.state = 'return'; break; }
        if (!node || node.amount <= 0) {
          // Same resource nearby, otherwise whatever is closest.
          node = this.findNode(a, node?.type ?? null, node?.pos ?? a.local) || this.findNode(a, null, a.local);
          if (!node) { if (a.carry.amount > 0) a.state = 'return'; else a.order(null); break; }
          a.task.node = node;
        }
        const there = a.moveTowards(node.pos, dt, rules.gatherReach + 0.6);
        if (!there && a.pathFailed) {
          // No dry route to this node (e.g. it's on an island): remember it and pick another.
          (a.unreachable ??= new Map()).set(node.id, game.time);
          a.pathFailed = false;
          a.pathGoal = null;
          a.task.node = this.findNode(a, null, a.local);
          if (!a.task.node) a.order(null);
          break;
        }
        if (there) {
          a.facePoint(node.pos);
          a.workT += dt * this.speedFactor(a) * (game.modifiers.gatherSpeed ?? 1);
          if (a.workT >= def.gather.time) {
            a.workT = 0;
            const rdef = CONFIG.resources.types[node.type];
            const taken = a.planet.resources.harvest(node, 1);
            if (taken > 0) { a.carry.item = rdef.item; a.carry.amount += rdef.yield * taken; }
          }
        }
        break;
      }

      case 'return': {
        const core = this.nearestCore(a);
        if (!core) {
          if (!this._noCoreWarned) { this._noCoreWarned = true; game.hud.notify(`No finished Command Core on ${a.planet.name} — gatherers can't deliver.`, 'warn'); }
          a.order(null);
          break;
        }
        if (a.moveTowards(core.localPos, dt, core.radius + rules.gatherReach)) {
          const amount = Math.round(a.carry.amount * (game.modifiers.gatherYield ?? 1));
          game.inventory.add(a.carry.item, amount);
          game.onUnitDelivered(a, a.carry.item, amount);
          a.carry.amount = 0;
          a.carry.item = null;
          a.state = a.task?.node ? 'gather' : 'idle';
        }
        break;
      }

      case 'build': {
        const b = a.task.building;
        if (!b || !b.alive || b.planned || (b.built && b.hp >= b.maxHp - 0.5)) { a.order(null); break; }
        if (a.moveTowards(b.localPos, dt, b.radius + rules.gatherReach)) {
          a.facePoint(b.localPos);
          const work = dt * this.speedFactor(a);
          if (!b.built) b.addBuildProgress(work * def.build.speed);
          else b.hp = Math.min(b.maxHp, b.hp + work * def.build.repair);
          a.workT += dt;   // drives the hammering bob
        }
        break;
      }
    }
  }

  _enemyAI(a, dt) {
    const game = this.game, def = a.def;
    if (a.scanT <= 0 && (a.state === 'idle' || a.state === 'raid' || a.state === 'wander')) {
      a.scanT = 0.4;
      const t = this.nearestHostile(a, def.aggro);
      if (t) a.order({ kind: 'attack', target: t, raid: a.task?.raid ?? (a.state === 'raid' ? a.task : null) });
    }
    switch (a.state) {
      case 'idle':
      case 'wander': {
        // Crawlers drift around their nest.
        if (!a.task || a.task.until < game.time) {
          const leash = def.leash ?? 30;   // raiders have no nest leash
          const off = new THREE.Vector3().randomDirection().multiplyScalar(leash * 0.5 / a.planet.radius);
          const dir = a.home.clone().add(off).normalize();
          a.order({ kind: 'wander', point: dir.multiplyScalar(a.planet.radius + a.planet.walkHeight(dir)), until: game.time + 4 + Math.random() * 5 });
        }
        // (roaming is short-range and doesn't need full route planning)
        if (!a.planet.isSubmerged(a.task.point.clone().normalize())) a.moveTowards(a.task.point, dt * 0.45, 1, false);
        break;
      }
      case 'raid': {
        const core = a.task.base?.core;
        const goal = core?.alive ? core : a.task.base?.buildings.find((b) => b.alive);
        if (goal) a.moveTowards(goal.localPos, dt, goal.radius + def.weapon.range * 0.8);
        break;
      }
      case 'attack': {
        const t = a.task.target;
        const leashBroken = def.leash && a.dir.angleTo(a.home) * a.planet.radius > def.leash * 1.6;
        if (!t || !t.alive || leashBroken || (t.planet && t.planet !== a.planet)) {
          if (a.task.raid) a.order(a.task.raid); else a.order(null);
          break;
        }
        const d = a.edgeDistance(t);
        if (d > def.weapon.range) a.moveTowards(targetLocal(t), dt, def.weapon.range * 0.8 + (t.radius || 0));
        else { a.moving = false; a.facePoint(targetLocal(t)); if (a.cooldown <= 0) a.fireAt(t, game); }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- bolts
  _initBolts() {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 1.4);
    const mk = (r, g, b) => {
      const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
      mat.color.setRGB(r, g, b);
      const mesh = new THREE.InstancedMesh(geo, mat, 128);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.game.scene.add(mesh);
      return mesh;
    };
    this.boltMeshes = { player: mk(0.6, 2.6, 3.2), enemy: mk(3.2, 0.5, 0.4), brood: mk(1.9, 3.2, 0.5) };
    this.bolts = [];
  }

  /** A glowing shot from `from` to `to`; `sound` names the shot sound (audio.js). */
  spawnBolt(faction, from, to, sound = null) {
    this.game.audio.play(sound ?? (faction === 'player' ? 'laser' : 'enemyLaser'), { at: from });
    if (this.bolts.length > 240) return;
    const dist = from.distanceTo(to);
    this.bolts.push({ faction, from, to, t: 0, dur: Math.min(0.25, Math.max(0.05, dist / 90)) });
  }

  _updateBolts(dt) {
    const counts = { player: 0, enemy: 0, brood: 0 };
    const p = this._p, q = this._q, dir = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
    for (const b of this.bolts) {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const mesh = this.boltMeshes[b.faction];
      if (counts[b.faction] >= mesh.instanceMatrix.count) continue;
      p.lerpVectors(b.from, b.to, k);
      dir.subVectors(b.to, b.from).normalize();
      q.setFromUnitVectors(Z, dir);
      this._m.compose(p, q, this._s.set(1, 1, 1));
      mesh.setMatrixAt(counts[b.faction]++, this._m);
    }
    this.bolts = this.bolts.filter((b) => b.t < b.dur);
    for (const f of ['player', 'enemy', 'brood']) {
      this.boltMeshes[f].count = counts[f];
      this.boltMeshes[f].instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------- selection rings / pings
  _initRings() {
    const ring = new THREE.RingGeometry(0.85, 1.05, 24);
    ring.rotateX(-Math.PI / 2);
    this.ringGeo = ring;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x4df3ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.pings = [];
    this.pingMesh = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 32);
    this.pingMesh.count = 0;
    this.pingMesh.frustumCulled = false;
    this.game.scene.add(this.pingMesh);
  }

  /** Short expanding ring where an order was given. */
  ping(planet, local, color = 0x7dff9a) {
    this.pingMesh.material.color.set(color);
    this.pings.push({ planet, local: local.clone(), t: 0 });
  }

  // ------------------------------------------------------------ rendering
  /** Per-pool copy of a geometry with room for `cap` instances of animation data (iAnim). */
  static _instGeo(geo, cap) {
    const g = geo.clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iAnim', anim);
    return g;
  }

  _pool(planet, key, geo, mat, castShadow = true) {
    const id = planet.index + '|' + key;
    let mesh = this.pools.get(id);
    if (!mesh) {
      mesh = new THREE.InstancedMesh(UnitManager._instGeo(geo, 64), mat, 64);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = castShadow;
      mesh.userData.used = 0;
      planet.group.add(mesh);
      this.pools.set(id, mesh);
    } else if (mesh.userData.used >= mesh.instanceMatrix.count) {
      // grow: replace with a bigger mesh
      const bigger = new THREE.InstancedMesh(UnitManager._instGeo(geo, mesh.instanceMatrix.count * 2), mat, mesh.instanceMatrix.count * 2);
      bigger.frustumCulled = false;
      bigger.castShadow = bigger.receiveShadow = castShadow;
      for (let i = 0; i < mesh.userData.used; i++) { mesh.getMatrixAt(i, this._m); bigger.setMatrixAt(i, this._m); }
      bigger.userData.used = mesh.userData.used;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      planet.group.add(bigger);
      this.pools.set(id, bigger);
      mesh = bigger;
    }
    return mesh;
  }

  _render() {
    for (const mesh of this.pools.values()) mesh.userData.used = 0;
    const game = this.game, m = this._m, q = this._q, p = this._p;
    ANIM_TIME.value = game.time;
    const selected = new Set(this.selected);
    for (const a of this.actors) {
      const parts = modelParts(a.type);
      p.copy(a.local);
      if (!a.flying && a.moving) p.addScaledVector(a.dir, Math.abs(Math.sin(a.bob)) * 0.1);
      quatFromUpForward(a.dir, a.heading, q);
      const s = (a.def.scale ?? 1) * (a.grow ?? 1);   // Brood structures grow in
      m.compose(p, q, this._s.set(s, s, s));
      // shader animation: walk phase, moving, a per-unit seed, working (building / gathering in place)
      // (enemies "work" while attacking in place: snapping mandibles, firing)
      const busy = a.faction === 'enemy' ? a.state === 'attack' : a.state === 'build' || a.state === 'gather';
      const working = busy && !a.moving ? 1 : 0;
      const seed = (a.id * 1.37) % 6.283;
      parts.forEach((pt, i) => {
        const mesh = this._pool(a.planet, a.type + ':' + i, pt.geo, pt.mat, i === 0);
        const k = mesh.userData.used++;
        mesh.setMatrixAt(k, m);
        mesh.geometry.attributes.iAnim.setXYZW(k, a.bob, a.moving ? 1 : 0, seed, working);
      });
      // selection ring on the ground
      if (selected.has(a)) {
        const ring = this._pool(a.planet, 'ring', this.ringGeo, this.ringMat, false);
        const g = a.dir.clone().multiplyScalar(a.planet.radius + a.planet.walkHeight(a.dir) + 0.12);
        const sc = a.radius * 1.4;
        m.compose(g, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir), this._s.set(sc, sc, sc));
        ring.setMatrixAt(ring.userData.used++, m);
      }
      this._updateBar(a, selected.has(a));
    }
    for (const mesh of this.pools.values()) {
      mesh.count = mesh.userData.used;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.iAnim.needsUpdate = true;
    }
    // order pings
    let n = 0;
    for (const pg of this.pings) {
      pg.t += 1 / 60;
      const s = 0.6 + pg.t * 4;
      m.compose(pg.local.clone().addScaledVector(pg.local.clone().normalize(), 0.15).add(pg.planet.position),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pg.local.clone().normalize()), this._s.set(s, s, s));
      if (n < 32) this.pingMesh.setMatrixAt(n++, m);
    }
    this.pings = this.pings.filter((pg) => pg.t < 0.45);
    this.pingMesh.count = n;
    this.pingMesh.instanceMatrix.needsUpdate = true;
  }

  _updateBar(a, selected) {
    const damaged = a.hp < a.def.hp - 0.5;
    const show = selected || damaged;
    if (!show) { if (a.bar) a.bar.group.visible = false; return; }
    if (!a.bar) {
      a.bar = makeBar();
      a.bar.group.scale.setScalar(0.35);
      a.planet.group.add(a.bar.group);
    }
    a.bar.group.visible = true;
    a.bar.group.position.copy(a.local).addScaledVector(a.dir, BAR_HEIGHT[a.type] ?? 2);
    a.bar.set(a.hp / a.def.hp, a.faction === 'enemy' ? 0xff4d5e : 0x5dff9a);
  }

  // ---------------------------------------------------------- persistence
  serialize() {
    return this.playerUnits.map((a) => ({
      type: a.type, planet: a.planet.index, dir: a.dir.toArray().map((v) => +v.toFixed(5)), hp: Math.round(a.hp),
      node: a.state === 'gather' || a.state === 'return' ? a.task?.node?.id ?? -1 : -1,
      carry: a.carry.amount ? [a.carry.item, a.carry.amount] : null,
    }));
  }

  deserialize(list, planets) {
    for (const s of list || []) {
      const planet = planets[s.planet];
      if (!planet || !CONFIG.units[s.type]) continue;
      const a = this.spawn(s.type, 'player', planet, new THREE.Vector3().fromArray(s.dir));
      a.hp = Math.min(a.def.hp, s.hp ?? a.def.hp);
      if (s.carry) { a.carry.item = s.carry[0]; a.carry.amount = s.carry[1]; }
      const node = s.node >= 0 ? planet.resources.nodes[s.node] : null;
      if (node) a.order({ kind: 'gather', node });
    }
  }

  /** Remove every actor (new game). */
  clear(faction = null) {
    for (const a of this.actors) {
      if (faction && a.faction !== faction) continue;
      a.alive = false;
      if (a.bar) a.bar.group.removeFromParent();
    }
    this.actors = this.actors.filter((a) => a.alive);
    this.selected = this.selected.filter((a) => a.alive);
  }

  /** Units of the player near a screen point (for click selection). */
  pickActor(planet, camera, x, y, faction, maxPx = 22) {
    let best = null, bestD = maxPx;
    const w = window.innerWidth, h = window.innerHeight;
    for (const a of this.actors) {
      if (a.planet !== planet || a.faction !== faction) continue;
      const s = a.worldPos.addScaledVector(a.dir, 0.8).project(camera);
      if (s.z > 1) continue;
      const d = Math.hypot((s.x * 0.5 + 0.5) * w - x, (-s.y * 0.5 + 0.5) * h - y);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** Player units on a planet inside a screen rectangle (drag-box selection). */
  actorsInRect(planet, camera, x0, y0, x1, y1) {
    const w = window.innerWidth, h = window.innerHeight;
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    return this.actors.filter((a) => {
      if (a.planet !== planet || a.faction !== 'player') return false;
      const s = a.worldPos.project(camera);
      if (s.z > 1) return false;
      const sx = (s.x * 0.5 + 0.5) * w, sy = (-s.y * 0.5 + 0.5) * h;
      return sx >= ax && sx <= bx && sy >= ay && sy <= by;
    });
  }
}

export { RESOURCE_LABELS };
