# 🚀 Echo Star

A stylised low-poly sci-fi game in the browser, built with **HTML, CSS, JavaScript and Three.js**.
Fly a ship between small procedural planets, land, explore on foot, gather resources and build a colony
whose AI evolves — from a narrow AI all the way to a mobile **Tech Moon** — while fending off rogue AI
raids and a living bio-alien faction, **the Brood**.

Everything (models, textures, sound and music) is generated in code: there are no image, audio or 3D model files.

## How to play

There are three ways, from simplest to most "dev":

1. **Single file (recommended):** download [`dist/echo-star.html`](dist/echo-star.html) and double-click it.
   It is the whole game in one file — no server, no installation, works offline.
2. **Local server (for development):** double-click **`start.bat`** (Windows, needs Python), or run
   ```bash
   python serve.py 8080
   ```
   and open <http://localhost:8080>. `index.html` uses ES modules, which browsers only load from a server —
   opening `index.html` directly won't work. The server disables caching, so a normal reload always picks up
   your latest changes.
3. **Online link:** enable GitHub Pages for the repository (see the root README).

Runs in desktop browsers with WebGL (Chrome, Edge, Firefox). There are no touch controls.

> **Saves** live in the browser's `localStorage`, tied to the page's address: progress made in
> `dist/echo-star.html` and progress made at `http://localhost:8080` are kept separately.

Click the game to capture the mouse. If pointer lock is unavailable, hold a mouse button and drag to look.

## Controls

| Mode | Keys |
|---|---|
| Ship | `W`/`S` throttle/brake · mouse or `A`/`D` + `↑`/`↓` steer · `Q`/`E` roll · `Space`/`C` rise/sink · `Shift` boost · `L` land / take off |
| On foot | `WASD` move · `Shift` run · `Space` jump · mouse look · hold `E` harvest / capture · hold `X` dismantle a building · `F` exit / board ship · `B` build mode · `G` ship locator (auto-walk to the ship; `G` / `WASD` stops) |
| Build mode | `1`–`9`, `0` choose building · `R` rotate · left-click place / select · right-click or `Esc` cancel · `WASD` pan · `Q`/`E` or right-drag rotate view · wheel zoom · `Tab` next colony · `B` exit |
| Units (build mode) | click or drag a box to select (`Shift` adds) · right-click: ground = move · resource = gather · unfinished / damaged building = build / repair · enemy = attack |
| General | `H` help · `Esc` pause (saves) · `U` evolve the base AI · `M` Tech Moon panel · `N` summon the Tech Moon · `K` mute sound · autosave every 30 s |

## Phases

- [x] **Phase 1 – Exploration core**: ship, planets, landing, walking, collecting all resource types
- [x] **Phase 2 – Base building**: build mode, grid placement, Command Core, Extractor, Farm, Ranch, Power Generator, energy economy
- [x] **Phase 3 – Units, enemies and raids**: Barracks / Robotics Factory / Hangar with training queues,
      RTS selection & orders, gathering workers, alien nests, rogue AI raids, astronaut blaster, energy storage
- [x] **Phase 4 – AI evolution**: Data Center → Compute → AGI and Singularity (3 paths), Defense Turrets
- [x] **Phase 5 – ASI and the Tech Moon**
- [x] **The Brood**: a second, living enemy faction

## Colony economy (Phase 2)

1. Land, press `B`, place a **Command Core** (30 rock · 20 iron · 5 crystals). It trickles a little energy.
   Each planet supports up to **5 Command Cores**; each one founds its own colony (own grid and 30 m build radius),
   at least 45 m apart — handy for outposts next to distant resources. `Tab` jumps the camera between colonies.
2. **Extractors** must touch a Crystal / Iron / Stone node and drill it forever (they don't deplete it).
3. **Farms** and **Ranches** turn energy into food.
4. **Power Generators** burn 1 crystal every 6 s for 15 energy — put an Extractor on a crystal node to keep them fed.
5. If energy hits 0, buildings go offline (red health bar) until power returns.

**Auto-levelling:** uneven ground is never a problem — placing a building terraforms a flat pad
(average ground height, snapped to the terrace step) with smooth ramps around it; trees, rocks and
resource nodes nearby are re-seated on the new ground. Only water / lava blocks construction.
Toggle with `CONFIG.base.autoLevel`; ramp width is `CONFIG.base.levelBlend`.

All costs, timers and rates are in `CONFIG.buildings` / `CONFIG.base` in `js/config.js`.

## Units & threats (Phase 3)

- **Train** units by selecting a Barracks, Robotics Factory or Hangar in build mode (`B`). Click a queued unit to cancel it (full refund).
  Combat Robot and Fighter need the **AGI** AI tier (Phase 4).
- **Select** units by clicking or dragging a box (`Shift` adds). **Right-click** = move · on a resource = gather ·
  on an unfinished / damaged building = build or repair · on an enemy = attack.
- Workers and Mining Bots carry resources to the nearest Command Core. Idle Workers help construction and repairs;
  idle Soldiers / Drones attack enemies in range and rally to buildings under attack.
- Humans eat food, robots and drones use energy. Running out slows them down.
- **Unit limit** (shared by all unit types): 40, **+33.3% (+13) for every finished Command Core** on any planet
  (1 core → 53 · 2 → 67 · 5 → 107), up to a ceiling of 160. `CONFIG.unitRules.baseUnits / perCoreBonus / hardCap`.
- **Energy storage**: 50 + 100 per Command Core + 150 per Power Generator. Generators go on *Standby* when storage is full,
  so crystals are only burned when energy is actually needed.
- **Threats**: some planets (never the home world) have Crawler nests. Once you have a colony, a rogue AI raids it
  every few minutes, with a warning banner. Raids grow over time. If a Command Core is destroyed, its colony falls.
- On foot, the astronaut's blaster fires automatically. If the suit breaks you are teleported back to the ship.

All numbers are in `CONFIG.units`, `CONFIG.unitRules`, `CONFIG.enemies`, `CONFIG.aliens`, `CONFIG.raids` and `CONFIG.energy`.

## AI evolution (Phase 4)

1. Build a **Data Center** (key `9`): it uses 1 energy/s and makes 8 Compute every 4 s.
2. When the AI panel (top right) glows, press **`U`** or click **EVOLVE** (Compute is spent along with the resource cost).
   - **Tier 1 · AGI** (500 Compute + 60 crystals + 80 iron): +25% gathering and production. Unlocks the Combat Robot and Fighter.
   - **Tier 2 · Singularity** (2000 Compute + 150 crystals + 150 iron + 100 rock): pick one path, permanently:
     **Autonomous Swarm** (workers/robots +50% speed) · **Predictive Defense** (buildings self-repair + **Defense Turrets**, key `0`)
     · **Quantum Economy** (buildings cost −30%).
   - **Tier 3 · ASI** unlocks the Tech Moon (Phase 5).
3. The AI cube on every Command Core changes colour with the tier.

Numbers: `CONFIG.aiTiers`, `CONFIG.singularity`, `CONFIG.buildings.datacenter / turret`.

## The Tech Moon (Phase 5)

1. Evolve the base AI to **Tier 3 · ASI** (5000 Compute + 300 crystals + 400 iron + 300 rock):
   +20% production and gathering, +50% weapon damage.
2. Press **`M`** → *Build above <planet>* (needs a finished Command Core there). Five stages are built in orbit,
   each paid automatically when you have the resources: **Orbital Frame → Hull Lattice → Quantum Reactor →
   Weapon Arrays → Mind Upload**. You can watch the moon take shape in the sky.
3. Once online, the moon:
   - fires **beam cannons** at enemies on the planet it orbits;
   - adds **+30 crystals, iron, rock and +20 food per minute**, everywhere;
   - **automates** the planet below: idle gatherers get to work, construction is 2× faster,
     production buildings can be set to **Auto-recruit**, and in build mode you can place buildings you can't
     afford yet as **blueprints** — the moon pays for and starts them when resources allow;
   - **travels** to any planet (`M` → *Travel to*), carrying your units and beaming them down on arrival.
   - **`N` summons it** to the planet you are on (on foot, landed or flying within 600 m) — even mid-flight it changes course.
   - **Fire support**: each volley hits up to 4 visible enemies, those near your colonies first. It only fires with
     **line of sight** (not through the planet). **4 guardian drones** orbit the moon, each with its own beam.
   - **ASI Architect**: an autonomous builder robot dropped from the moon in a capsule. On a planet without a colony it
     founds one (near you if you are there) and lays out a starter base — power, 3 extractors, farm, data center,
     barracks, turret — as blueprints the moon pays for. It repairs damage, goes back aboard when the moon travels, and
     is **replaced 30 s after being destroyed**. Toggle in the `M` panel (*Architect auto-colonize*).

Numbers: `CONFIG.techMoon`.

## The Brood (bio-alien colony)

A second, living enemy faction, separate from the rogue AI raids. All numbers: `CONFIG.brood`.

1. **Dormant**: from the start a sealed **Chrysalis** rests on the planet farthest from the home world, on a small
   patch of purple creep, watched by a few guards. Its carapace can't be harmed and it does nothing else.
2. **Awakening**: once the **Tech Moon is online** (`awakenOn`), bio-signals are detected and 60 s later the
   chrysalis hatches into the **Brood Hive**.
3. **Growth**: the colony earns **biomass** (Hive + Biomass Feeders) and grows structures from `buildPlan`
   (destroyed ones are regrown): Biomass Feeder · Resonance Veil Spire · Spore Spitter (defence, also hits flyers) ·
   Brood Pit (unlocks Spitters and Behemoths) · Bio-Spire (unlocks Wasps). Creep spreads around every structure.
   Damaged structures heal by spending biomass. A home garrison grows with the colony.
4. **Organisms**: Skitter (fast melee swarmer) · Spitter (ranged acid) · Behemoth (armoured siege beast) ·
   Wasp (bio-flyer) · Brood Seeker (scout) · Brood Carrier (living transport ship).
5. **Seekers** fly to other planets (never-scouted ones first) and sweep them for colonies. A Seeker that finds one
   must hover over it for 20 s to relay its position — **kill it in time and the Brood still doesn't know**.
   Colonies on the Brood's own planet are always known.
6. **Invasions**: a **Brood Carrier** lifts off, flies through space (red ☣ marker in flight), descends slowly
   55 m from a known colony and unloads its organisms, then flies home. Destroying it before it unloads kills its
   cargo. Waves grow over time, paid with biomass (the Brood doesn't get stronger just because you reached ASI).
7. **Resonance Veil**: the Tech Moon can't lock on to anything inside a Veil Spire's field (26 m, shimmering violet
   dome) or the Hive's own small field (13 m). It keeps orbiting and works normally elsewhere; ground units,
   fighters, turrets and the astronaut are not affected. Destroy the spires to open the area to the moon's beams.
8. **Victory**: destroy the **Hive** — the colony withers, the creep recedes and you salvage crystals, iron and rock.

Saves keep the colony (structures, biomass, garrison, what it knows); a wave in flight comes back shortly after loading.

## Wildlife

Every planet gets 2–3 species from its biome's pool (the home world always 3), animated like the units:
legs walk, heads dip to graze, tails and tentacles sway. Hold `E` next to one to capture it for food —
bigger animals give more.

| Species | Biomes | Notes |
|---|---|---|
| Mooblet (Glorp, Fluffin…) | verdant, arid, aether | the original random blocky grazer — looks different on every planet |
| Hopjack | verdant · arid (Dune) · glacial (Snow) | giant rabbit, travels in long hops, very skittish |
| Tigrex | verdant · arid (Dune) · glacial (Frost) | giant striped cat with glowing eyes, never runs away · 1.6× food |
| Shellback | arid · volcanic (Obsidian, glowing lava seams) | slow armoured shell walker · 1.8× food |
| Tuskmoth | glacial | woolly tusked giant with a trunk · 3× food |
| Magmander | volcanic | six-legged salamander with glowing lava cracks and crest |
| Glowstag | aether | deer with luminous crystal antlers and glowing spots |
| Driftjelly | aether (rarely verdant) | floating jellyfish — drifts over land and water |

Species, colourings and biome weights: `SPECIES` in `js/animals.js`; counts and speeds: `CONFIG.animals`.

## Sound

Everything you hear is generated in code by `js/audio.js` (Web Audio API) — there are no audio files.

- **Effects**: every weapon has its own shot sound, explosions, harvesting and dismantling tools, footsteps that
  change with the biome, building, landing / take-off, the Tech Moon's beams, warp, capsule drops, UI clicks and
  notification chimes. Effects are positioned: they fade with distance and pan left / right.
- **Loops**: the ship engine follows throttle, speed and boost; wind inside atmospheres (stronger on arid and
  glacial worlds), a rumble on volcanic ones, critters / lava / cracking ice, and the hum of the Tech Moon.
- **Music**: a generative ambient score (slow chords + bells, brighter on a planet in daylight) that switches to a
  pulsing tension track while a rogue AI raid is coming or under way.
- **Volume**: Master / Music / Effects sliders in the pause menu (saved per browser); `K` mutes.

The browser only allows sound after the first click or key press. Numbers: `CONFIG.audio`.

## Planet visuals

Purely visual — none of this changes gameplay, resource positions or saves (each effect uses its own seed).

- **Water** has rolling faceted waves, turquoise shallows fading to dark depths and animated foam along the shore.
  **Lava** is dark cooled crust broken by glowing, slowly drifting veins and pools. **Ice** is a faceted sheet with
  tints, cracks and snow drifts.
- **Terrain** detail: meadow / rock patches, layered rock strata on cliffs, wet sand at the waterline.
- **Clouds**: low-poly puffs in weather systems that drift around the planet and cast moving shadows. They fade out
  near the camera (much farther in build mode, where their shadows are also switched off) and darken at night.
- **Atmosphere** seen from space: a sun-lit halo plus a glowing rim over the planet, tinted like a sunset along the
  line between day and night.
- **Ground scatter** per biome, swaying in the wind: grass and flowers, dry grass and pebbles, ice crystals, ember
  rocks, glowing spore stalks. Cleared under buildings like trees; only drawn on the planet you are near.
- **Weather particles** around the camera: pollen by day and fireflies at night, desert dust, snow, rising embers,
  floating spores.
- **Rings** of tumbling rocks and banded dust around some planets (never the home world).

Numbers: `CONFIG.fx`.

## Project structure

```
echo-star/
├── index.html            ← game page (HUD and menus in HTML) — loads js/main.js as an ES module
├── css/
│   ├── style.css         ← HUD & menu styling (colours and fonts in the :root variables)
│   └── fonts.css         ← @font-face rules for the local fonts in vendor/fonts
├── js/                   ← game code (see the code map below)
├── vendor/
│   ├── three/            ← Three.js r160 (three.module.min.js + only the addons the game uses), MIT licence
│   └── fonts/            ← Orbitron and Rajdhani (woff2), SIL Open Font License
├── dist/echo-star.html   ← the whole game in a single file (generated — do not edit by hand)
├── tools/
│   ├── build.js          ← builds dist/echo-star.html
│   └── smoke-test.js     ← plays a short session in a real browser
├── serve.py              ← local no-cache server (python serve.py 8080)
└── start.bat             ← Windows: starts serve.py and opens the browser
```

### Code map (`js/`)

| File | Purpose |
|---|---|
| `config.js` | **All balance numbers** (speeds, costs, timers, spawn counts, tiers) — the main "tuning knobs" |
| `main.js` | `Game` class: renderer, state machine (flight → landing → landed → walking ↔ build), harvesting, save/load glue |
| `buildings.js` | Detailed, animated building models (built with a small `Kit` that merges parts per material and gives each glow its own dimmable material), surface `Grid`, `Building` (construction, production, upkeep, health bar), `Base` (colony + economy), placement rules |
| `buildmode.js` | Strategic camera, cursor picking, hologram preview, grid overlay, building / unit selection and orders |
| `units.js` | Unit & enemy models (player units animated in the vertex shader: walking legs, hammering tool arm, rolling wheels, drill, rotors, flickering jets), shared `Actor` AI (move, gather, build, fight), `UnitManager` (upkeep, bolts, instanced rendering) |
| `enemies.js` | Alien nests on hostile planets and the rogue AI raid director |
| `brood.js` | The Brood bio-alien faction: dormant chrysalis, awakening, biomass economy, growing colony + creep, Seekers, Brood Carrier invasions through space, Resonance Veil jamming |
| `broodmodels.js` | Brood creature, bio-ship and living-structure models |
| `rig.js` | Shared vertex-shader rig (animated joints) and model helpers used by every unit model |
| `techmoon.js` | The Tech Moon: staged orbital construction, model, beam cannons, income, automation, travel with cargo |
| `navigation.js` | Ground path-finding: A* over the terrain grid around water, lava and buildings (`CONFIG.navigation`) |
| `planet.js` | Cube-sphere terrain, biomes, `heightAt()` queries, liquid, atmosphere, star-system generation |
| `decor.js` | Instanced trees/flora, rocks, ancient relics, swaying ground scatter (grass, flowers, crystals…); tree "ghosting" when they block the camera |
| `planetfx.js` | Visual-only planet effects: drifting low-poly clouds, asteroid rings, weather particles around the camera |
| `resources.js` | Harvestable nodes (crystal, iron, rock, plant) + wandering animal herds |
| `animals.js` | Wildlife species: animated models, biome pools and colourings, behaviour (hop, float, food value) |
| `ship.js` | Detailed ship model (nav lights, beacon, strobes, landing light, two-layer engine flames), flight physics, fuel, collision, landing / take-off animation, chase camera |
| `player.js` | Detailed astronaut (knees / elbows, life-support pack with jump jets, wrist computer), spherical-gravity walking, third-person camera |
| `space.js` | Starfield (soft twinkling stars in real star colours), bright stars with diffraction spikes, distant galaxies, sun with corona, lights, day/night sky blending, space dust |
| `skybox.js` | Procedural deep-space skybox baked once into a cube texture: Milky Way band with dust lanes, coloured nebulae, faint star field |
| `camera.js` | Smooth camera blends between modes |
| `audio.js` | All sound, synthesised with the Web Audio API (no files): effects, engine / wind loops, generative music |
| `hud.js` | DOM HUD: resources, AI tier, flight panel, prompts, notifications, planet markers |
| `inventory.js` / `save.js` / `input.js` / `geometry.js` / `utils.js` | Helpers |

## Development

After changing anything in `js/`, `css/`, `vendor/` or `index.html`:

```bash
node tools/build.js          # rebuilds dist/echo-star.html (Node.js only, nothing to install)
node tools/smoke-test.js     # plays a short session on dist/echo-star.html in a real browser
node tools/smoke-test.js --dev   # same test on index.html through a local server
```

The smoke test needs [Playwright](https://playwright.dev/) (`npm install playwright`). It flies, lands, steps
outside, walks, harvests a resource, enters and leaves build mode, boards, takes off and saves — and fails if any
step doesn't happen, if the browser console shows an error, or if the game tries to reach the internet.
Set `SHOTS_DIR=some/folder` to save a screenshot of every step.

**How the single file works:** browsers don't load ES modules from `file://`, so `tools/build.js` embeds every
module (game + Three.js), rewrites their imports to fixed names and adds a small loader that turns each one into
a Blob URL listed in an import map. The CSS and fonts are inlined too. Nothing in `js/` needs to change for this.

**Changing the Three.js version:** replace the files in `vendor/three/` (from the `three` npm package:
`build/three.module.min.js` and the files used from `examples/jsm/`) and keep the import map in `index.html`
pointing at them — `tools/build.js` reads that same import map.

### Tuning

| I want to… | Where |
|---|---|
| Change speeds, costs, timers, spawn counts, AI tiers | `CONFIG` in `js/config.js` |
| Get a different star system | `CONFIG.seed` in `js/config.js` (changing it also invalidates old saves) |
| Change biome colours / palettes | `BIOMES` in `js/planet.js` |
| Add or edit wildlife | `SPECIES` in `js/animals.js` |
| Change HUD colours and fonts | `:root` variables in `css/style.css` |

## Credits

- [Three.js](https://threejs.org/) r160 — MIT licence (see `vendor/three/LICENSE.txt`).
- Fonts [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani) —
  SIL Open Font License 1.1 (see `vendor/fonts/OFL-*.txt`).
- Game code and design: created with Claude.
