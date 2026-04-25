# Code Report

Snapshot of JS/JSX/MJS source files under `src/`, `shared/`, `party/`, `worker/`, `scripts/`. Generated `*.generated.js` files (navmesh / layout bakes) are excluded — they are huge by design and not hand-authored.

**Last regenerated:** 2026-04-25 (`node scripts/code-report-scan.mjs`)

- Total files scanned: **162**
- Total SLOC (non-blank, non-comment): **51,584**

### Metric notes

- **LOC** — raw line count.
- **SLOC** — non-blank, non-comment source lines (after stripping block/line comments and string/template contents).
- **Cyclomatic** — approximate McCabe-style complexity: `1 + (if + for + while + case + catch + && + || + ternary + ??)`, counted on comment/string-stripped text. Ternaries exclude optional-chaining `?.`.
- **Density** — `cyclomatic / SLOC`. High values ≈ tangled branching per line; low values ≈ mostly declarative code.
- **Fns** — rough function count (`function` keyword + `=>` arrows), for context only.

Thresholds treated as "too much":

- SLOC > ~800 per module (splitting becomes cheap wins)
- Cyclomatic > ~200 per module (hard to reason about in one head)
- Density > ~0.30 with SLOC ≥ 80 (branch-per-line soup)

---

## 1. Too Much Code — ranked by SLOC

Top 25 hand-written files by source lines.

| Rank | File | LOC | SLOC | Fns |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `src/world/Room.js` | 4525 | **3990** | 194 |
| 2 | `src/app/createGameSession.js` | 3223 | **2918** | 172 |
| 3 | `party/server.js` | 3173 | **2871** | 54 |
| 4 | `src/dev/installBuildMode.js` | 3076 | **2812** | 103 |
| 5 | `shared/predator.js` | 2135 | 1895 | 73 |
| 6 | `shared/roomba.js` | 1847 | 1619 | 71 |
| 7 | `src/audio/AudioManager.js` | 1851 | 1460 | 33 |
| 8 | `src/dev/PrefabEditorDialog.js` | 1551 | 1392 | 71 |
| 9 | `src/dev/VegetationEditorDialog.js` | 1457 | 1353 | 162 |
| 10 | `src/hud/RoundRaidOverlay.jsx` | 995 | 951 | 57 |
| 11 | `src/hud/GameToolbar.jsx` | 992 | 939 | 70 |
| 12 | `src/dev/DressingRoomDialog.js` | 1063 | 926 | 42 |
| 13 | `shared/mouseBot.js` | 1017 | 908 | 35 |
| 14 | `src/hud/HudView.jsx` | 892 | 849 | 56 |
| 15 | `src/input/MobileControls.js` | 808 | 736 | 43 |
| 16 | `shared/physics.js` | 915 | 707 | 25 |
| 17 | `scripts/bake-house-glb.mjs` | 770 | 694 | 51 |
| 18 | `src/entities/Human.js` | 749 | 649 | 4 |
| 19 | `party/stats.js` | 723 | 642 | 34 |
| 20 | `worker/index.js` | 725 | 638 | 51 |
| 21 | `src/controllers/CharacterController.js` | 690 | 604 | 6 |
| 22 | `src/world/VegetationSystem.js` | 695 | 591 | 40 |
| 23 | `src/entities/Mouse.js` | 806 | 579 | 17 |
| 24 | `src/tasks/ChewWiresTask.jsx` | 586 | 535 | 52 |
| 25 | `scripts/live-bots.mjs` | 565 | 499 | 46 |

### Notable offenders

- **`src/world/Room.js` (~4k SLOC)** — still the single largest gameplay module: scene graph, props, interactions. Prime split candidate by area or concern (furniture, lighting, triggers, ropes/portals).
- **`src/app/createGameSession.js` (~2.9k)** — session bootstrap: wiring for net, HUD, input, FX, tasks. Natural seams are “network/session”, “HUD/overlays”, “juice/FX”, “input/controllers”.
- **`party/server.js` (~2.9k SLOC, highest cyclomatic in repo)** — authoritative multiplayer + raid + tasks + limits in one surface. Strong candidate to peel `raid`, scoring/mischief, rate limits, and origin/auth into focused modules with a thin PartyKit entry.
- **`src/dev/installBuildMode.js` (~2.8k)** — dev-only but still top-tier size; already neighbored by `dev/sections/` and subsystems — more carving along editor concerns would help.
- **`shared/predator.js` / `shared/roomba.js`** — long shared AI state machines; same extraction story as before (states / tables / pure update steps).
- **`src/audio/AudioManager.js`** — loader vs mixer vs ducking vs spatial split still applies.
- **Dev dialogs** (`PrefabEditorDialog`, `VegetationEditorDialog`, `DressingRoomDialog`) — shared UI primitives (forms, lists, modals) would amortize a lot of repetition.
- **`src/controllers/CharacterController.js`** — now in the same size band as `Mouse.js` / `VegetationSystem.js`; worth watching if it keeps absorbing modes.

---

## 2. Too Much Complexity — ranked by cyclomatic

Top 25 by approximate McCabe-style complexity.

| Rank | File | Cyclomatic | SLOC | Density |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `party/server.js` | **919** | 2871 | 0.32 |
| 2 | `src/world/Room.js` | **885** | 3990 | 0.22 |
| 3 | `src/app/createGameSession.js` | **789** | 2918 | 0.27 |
| 4 | `src/dev/installBuildMode.js` | 608 | 2812 | 0.22 |
| 5 | `shared/predator.js` | 563 | 1895 | 0.30 |
| 6 | `shared/roomba.js` | 423 | 1619 | 0.26 |
| 7 | `shared/physics.js` | 238 | 707 | 0.34 |
| 8 | `src/dev/VegetationEditorDialog.js` | 235 | 1353 | 0.17 |
| 9 | `shared/mouseBot.js` | 226 | 908 | 0.25 |
| 10 | `src/audio/AudioManager.js` | 219 | 1460 | 0.15 |
| 11 | `worker/index.js` | 187 | 638 | 0.29 |
| 12 | `party/stats.js` | 163 | 642 | 0.25 |
| 13 | `src/dev/PrefabEditorDialog.js` | 162 | 1392 | 0.12 |
| 14 | `src/entities/Human.js` | 160 | 649 | 0.25 |
| 15 | `src/controllers/CharacterController.js` | 153 | 604 | 0.25 |
| 16 | `scripts/bake-house-glb.mjs` | 148 | 694 | 0.21 |
| 17 | `scripts/live-bots.mjs` | 146 | 499 | 0.29 |
| 18 | `src/hud/RoundRaidOverlay.jsx` | 142 | 951 | 0.15 |
| 19 | `src/world/VegetationSystem.js` | 115 | 591 | 0.19 |
| 20 | `src/entities/Mouse.js` | 102 | 579 | 0.18 |
| 21 | `src/animation/MouseEyeAtlasAnimator.js` | 99 | 484 | 0.20 |
| 22 | `src/dev/DressingRoomDialog.js` | 98 | 926 | 0.11 |
| 23 | `shared/roomCollision.js` | 97 | 358 | 0.27 |
| 24 | `src/net/RemotePlayerManager.js` | 96 | 302 | **0.32** |
| 25 | `src/dev/subsystems/probeVisuals.js` | 90 | 225 | **0.40** |

---

## 3. Branch-Dense Hotspots — ranked by density (SLOC ≥ 80)

Files where the ratio of decisions to lines is unusually high. Good candidates for table-driven rewrites or dispatch maps.

| Rank | File | Density | Cyclomatic | SLOC |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `src/physics/UprightCapsuleCollider.js` | **0.41** | 50 | 121 |
| 2 | `src/dev/subsystems/probeVisuals.js` | **0.40** | 90 | 225 |
| 3 | `src/tasks/HeroUnlockTask.jsx` | 0.38 | 85 | 221 |
| 4 | `src/utils/nameplateOcclusion.js` | 0.38 | 31 | 81 |
| 5 | `shared/raidLayout.js` | 0.35 | 68 | 192 |
| 6 | `shared/physics.js` | 0.34 | 238 | 707 |
| 7 | `party/server.js` | 0.32 | 919 | 2871 |
| 8 | `src/net/RemotePlayerManager.js` | 0.32 | 96 | 302 |
| 9 | `src/input/GamepadManager.js` | 0.32 | 45 | 142 |
| 10 | `shared/predator.js` | 0.30 | 563 | 1895 |
| 11 | `shared/ropes.js` | 0.30 | 31 | 105 |
| 12 | `worker/index.js` | 0.29 | 187 | 638 |
| 13 | `scripts/live-bots.mjs` | 0.29 | 146 | 499 |
| 14 | `src/dev/prefabRegistry.js` | 0.29 | 43 | 150 |
| 15 | `src/world/RopeSystem.js` | 0.28 | 62 | 218 |

`shared/devLayoutValidation.js` is intentionally guard-heavy validation (small file); it can spike density in some counting styles but is below the SLOC ≥ 80 cutoff here — still worth a skim when changing dev sync payloads.

---

## Suggested refactor order

Best ROI first (largest files that are also hard to navigate or branch-heavy):

1. **`party/server.js`** — highest cyclomatic and very large; extract raid/scoring/tasks/rate-limit/auth into modules and keep the PartyKit entry thin.
2. **`src/world/Room.js`** — largest SLOC; split by subsystem or physical zone.
3. **`src/app/createGameSession.js`** — pull HUD wiring, net wiring, juice/FX, and portal/session setup into named setup modules.
4. **`shared/predator.js` / `shared/roomba.js`** — state-centric extraction (same pattern for both).
5. **`worker/index.js`** — high density at moderate size; split security/CSP, routing, and room/match handlers.
6. **`shared/physics.js` + `shared/roomCollision.js`** — collision/response paths are dense; consider tables or shared helpers for repeated branches.
7. **`src/audio/AudioManager.js`** — loader / mixer / spatial / ducking.
8. **Dev stack** (`installBuildMode.js`, editor dialogs) — shared dialog/field kit.

---

_Methodology: character scanner strips comments and string/template literal bodies, then applies token counts. Numbers are directional, not exact — use as a map, not a verdict. The scan script excludes itself (`scripts/code-report-scan.mjs`) from totals._
