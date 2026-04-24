# Code Report

Snapshot of JS/JSX/MJS source files under `src/`, `shared/`, `party/`, `worker/`, `scripts/`. Generated `*.generated.js` files (navmesh / layout bakes) are excluded — they are huge by design and not hand-authored.

- Total files scanned: **161**
- Total SLOC (non-blank, non-comment): **48,633**

### Metric notes

- **LOC** — raw line count.
- **SLOC** — non-blank, non-comment source lines.
- **Cyclomatic** — approximate McCabe complexity: `1 + (if + else-if + for + while + case + catch + && + || + ternary + ??)`, counted after stripping comments and string literals.
- **Density** — `cyclomatic / SLOC`. High values ≈ tangled branching per line; low values ≈ mostly declarative code.
- **Fns** — rough function count (`function` keyword + arrow `=>`), for context only.

Thresholds I treated as "too much":
- SLOC > ~800 per module (splitting becomes cheap wins)
- Cyclomatic > ~200 per module (hard to reason about in one head)
- Density > ~0.30 with SLOC ≥ 80 (branch-per-line soup)

---

## 1. Too Much Code — ranked by SLOC

Top 25 hand-written files by source lines.

| Rank | File | LOC | SLOC | Fns |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `src/world/Room.js` | 4219 | **3701** | 176 |
| 2 | `src/dev/installBuildMode.js` | 2952 | **2691** | 46 |
| 3 | `src/app/createGameSession.js` | 2796 | **2509** | 168 |
| 4 | `party/server.js` | 2531 | 2249 | 14 |
| 5 | `shared/predator.js` | 2135 | 1894 | 73 |
| 6 | `shared/roomba.js` | 1847 | 1619 | 71 |
| 7 | `src/audio/AudioManager.js` | 1851 | 1460 | 33 |
| 8 | `src/dev/VegetationEditorDialog.js` | 1457 | 1353 | 150 |
| 9 | `src/dev/PrefabEditorDialog.js` | 1365 | 1221 | 38 |
| 10 | `src/hud/GameToolbar.jsx` | 992 | 939 | 70 |
| 11 | `src/dev/DressingRoomDialog.js` | 1063 | 926 | 42 |
| 12 | `shared/mouseBot.js` | 1013 | 902 | 35 |
| 13 | `src/hud/RoundRaidOverlay.jsx` | 771 | 740 | 28 |
| 14 | `src/input/MobileControls.js` | 808 | 736 | 43 |
| 15 | `scripts/bake-house-glb.mjs` | 770 | 697 | 51 |
| 16 | `shared/physics.js` | 903 | 695 | 25 |
| 17 | `src/hud/HudView.jsx` | 711 | 677 | 51 |
| 18 | `src/entities/Human.js` | 749 | 649 | 4 |
| 19 | `party/stats.js` | 723 | 642 | 34 |
| 20 | `worker/index.js` | 725 | 638 | 51 |
| 21 | `src/world/VegetationSystem.js` | 695 | 625 | 40 |
| 22 | `src/entities/Mouse.js` | 806 | 579 | 17 |
| 23 | `src/tasks/ChewWiresTask.jsx` | 586 | 544 | 52 |
| 24 | `scripts/live-bots.mjs` | 565 | 499 | 28 |
| 25 | `src/animation/MouseEyeAtlasAnimator.js` | 551 | 484 | 7 |

### Notable offenders

- **`src/world/Room.js` (3.7k SLOC)** — single file holding the entire scene graph. 4× bigger than the next gameplay file. Prime split candidate — likely clusters into `furniture/`, `lighting/`, `props/`, `triggers/`.
- **`src/dev/installBuildMode.js` (2.7k)** — dev-only but still the #2 file in the repo. Can be carved per subsystem (already has `subsystems/` neighbors).
- **`src/app/createGameSession.js` (2.5k, 168 fns)** — the god-function of boot. Action-juice handlers, portal FX, HUD wiring, net wiring, input wiring all co-located.
- **`party/server.js` (2.2k)** — authoritative room + raid + tasks + rate limits + turnstile + origin checks in one file. Logic modules (raid, mischief scoring, origin/auth, rate limits) would extract cleanly.
- **`shared/predator.js` (1.9k)** and **`shared/roomba.js` (1.6k)** — AI state machines; readable but long.
- **`src/audio/AudioManager.js` (1.5k)** — could split into loader / mixer / ducking.
- Dev dialogs (`VegetationEditorDialog`, `PrefabEditorDialog`, `DressingRoomDialog`) together are ~3.5k SLOC — they share UI patterns that could be extracted into a small dialog kit.

---

## 2. Too Much Complexity — ranked by cyclomatic

Top 25 by approximate McCabe complexity.

| Rank | File | Cyclomatic | SLOC | Density |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `src/world/Room.js` | **825** | 3701 | 0.22 |
| 2 | `shared/predator.js` | **614** | 1894 | 0.32 |
| 3 | `src/app/createGameSession.js` | **547** | 2509 | 0.22 |
| 4 | `shared/roomba.js` | **437** | 1619 | 0.27 |
| 5 | `shared/physics.js` | 236 | 695 | 0.34 |
| 6 | `shared/mouseBot.js` | 224 | 902 | 0.25 |
| 7 | `src/dev/VegetationEditorDialog.js` | 211 | 1353 | 0.16 |
| 8 | `worker/index.js` | 197 | 638 | 0.31 |
| 9 | `src/dev/installBuildMode.js` | 188 | 2691 | 0.07 |
| 10 | `party/stats.js` | 174 | 642 | 0.27 |
| 11 | `src/audio/AudioManager.js` | 166 | 1460 | 0.11 |
| 12 | `src/entities/Human.js` | 160 | 649 | 0.25 |
| 13 | `scripts/bake-house-glb.mjs` | 153 | 697 | 0.22 |
| 14 | `src/world/VegetationSystem.js` | 116 | 625 | 0.19 |
| 15 | `src/net/RemotePlayerManager.js` | 113 | 294 | **0.38** |
| 16 | `src/animation/MouseEyeAtlasAnimator.js` | 112 | 484 | 0.23 |
| 17 | `src/controllers/CharacterController.js` | 112 | 477 | 0.23 |
| 18 | `src/entities/Predator.js` | 101 | 359 | 0.28 |
| 19 | `src/dev/DressingRoomDialog.js` | 92 | 926 | 0.10 |
| 20 | `src/entities/Mouse.js` | 90 | 579 | 0.16 |
| 21 | `shared/devLayoutValidation.js` | 89 | 75 | **1.19** |
| 22 | `scripts/generate-kitchen-navmesh-module.mjs` | 89 | 371 | 0.24 |
| 23 | `shared/roomCollision.js` | 88 | 252 | 0.35 |
| 24 | `src/input/MobileControls.js` | 86 | 736 | 0.12 |
| 25 | `src/dev/vegetationRegistry.js` | 86 | 262 | 0.33 |

---

## 3. Branch-Dense Hotspots — ranked by density (SLOC ≥ 80)

Files where the ratio of decisions to lines is unusually high. Good candidates for table-driven rewrites or dispatch maps.

| Rank | File | Density | Cyclomatic | SLOC |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `shared/devLayoutValidation.js` | **1.19** | 89 | 75 |
| 2 | `src/physics/UprightCapsuleCollider.js` | 0.40 | 48 | 121 |
| 3 | `src/net/RemotePlayerManager.js` | 0.38 | 113 | 294 |
| 4 | `src/tasks/HeroUnlockTask.jsx` | 0.37 | 81 | 221 |
| 5 | `shared/roomCollision.js` | 0.35 | 88 | 252 |
| 6 | `shared/physics.js` | 0.34 | 236 | 695 |
| 7 | `src/utils/nameplateOcclusion.js` | 0.33 | 27 | 81 |
| 8 | `src/dev/vegetationRegistry.js` | 0.33 | 86 | 262 |
| 9 | `shared/predator.js` | 0.32 | 614 | 1894 |
| 10 | `src/dev/prefabRegistry.js` | 0.32 | 48 | 150 |
| 11 | `src/dev/subsystems/probeVisuals.js` | 0.32 | 72 | 225 |
| 12 | `worker/index.js` | 0.31 | 197 | 638 |
| 13 | `src/input/GamepadManager.js` | 0.30 | 42 | 142 |
| 14 | `scripts/bench-network.mjs` | 0.29 | 64 | 222 |
| 15 | `src/entities/Predator.js` | 0.28 | 101 | 359 |

`devLayoutValidation.js` at density 1.19 is essentially a wall of guard clauses — probably fine as validation code, but worth glancing at.

---

## Suggested refactor order

Best ROI first (biggest files that are also branch-heavy):

1. **`src/world/Room.js`** — split by room/area or by concern (lighting, props, triggers). Single biggest lever in the repo.
2. **`shared/predator.js`** — extract AI states (idle / chase / grab / throw) into per-state modules; the big switch/case is what's driving the 614.
3. **`src/app/createGameSession.js`** — pull action-juice, portal FX, HUD wiring, and net hookup into their own setup modules.
4. **`shared/roomba.js`** — same pattern as predator; state table + pure updates.
5. **`party/server.js`** — extract `auth/origin/rateLimit`, `raid`, `mischiefScore`, `taskRewards` into sibling files; `server.js` becomes a thin PartyKit entry.
6. **`worker/index.js`** — high density for its size. Split `security/csp`, `matchmake`, `roomEvent`, `stats` handlers.
7. **`src/audio/AudioManager.js`** — loader / mixer / spatial / ducking.
8. Dev dialogs (`VegetationEditorDialog`, `PrefabEditorDialog`, `DressingRoomDialog`) — share a dialog kit.

---

_Methodology: regex-based counts after stripping comments and string literals. Ternaries exclude optional-chaining `?.`. Numbers are directional, not exact — use as a map, not a verdict._
