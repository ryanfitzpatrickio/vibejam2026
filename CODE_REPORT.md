# Code Report

Snapshot of JS/JSX/MJS source files under `src/`, `shared/`, `party/`, `worker/`, `scripts/`. Generated `*.generated.js` files (navmesh / layout bakes) are excluded — they are huge by design and not hand-authored.

**Last regenerated:** 2026-04-25 (`node scripts/code-report-scan.mjs`)

- Total files scanned: **215**
- Total SLOC (non-blank, non-comment): **53,325**

### Metric notes

- **LOC** — raw line count.
- **SLOC** — non-blank, non-comment source lines (after stripping block/line comments and string/template literal bodies).
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
| 1 | `src/dev/installBuildMode.js` | 2465 | **2252** | 102 |
| 2 | `src/app/createGameSession.js` | 2201 | **1972** | 91 |
| 3 | `shared/predator.js` | 2107 | **1873** | 67 |
| 4 | `shared/roomba.js` | 1847 | 1619 | 71 |
| 5 | `src/dev/PrefabEditorDialog.js` | 1626 | 1461 | 72 |
| 6 | `src/audio/AudioManager.js` | 1851 | 1460 | 33 |
| 7 | `src/dev/VegetationEditorDialog.js` | 1457 | 1353 | 162 |
| 8 | `src/world/Room.js` | 1543 | 1339 | 38 |
| 9 | `party/gameRoomRuntime.js` | 1348 | 1200 | 18 |
| 10 | `src/hud/RoundRaidOverlay.jsx` | 995 | 951 | 57 |
| 11 | `src/hud/GameToolbar.jsx` | 992 | 939 | 70 |
| 12 | `src/dev/DressingRoomDialog.js` | 1063 | 926 | 42 |
| 13 | `shared/mouseBot.js` | 1017 | 908 | 35 |
| 14 | `src/hud/HudView.jsx` | 892 | 849 | 56 |
| 15 | `src/input/MobileControls.js` | 808 | 736 | 43 |
| 16 | `shared/physics.js` | 923 | 712 | 25 |
| 17 | `scripts/bake-house-glb.mjs` | 780 | 703 | 52 |
| 18 | `src/entities/Human.js` | 749 | 649 | 4 |
| 19 | `party/stats.js` | 723 | 642 | 34 |
| 20 | `worker/index.js` | 725 | 638 | 51 |
| 21 | `src/controllers/CharacterController.js` | 690 | 604 | 6 |
| 22 | `src/world/VegetationSystem.js` | 695 | 591 | 40 |
| 23 | `src/entities/Mouse.js` | 806 | 579 | 17 |
| 24 | `src/tasks/ChewWiresTask.jsx` | 586 | 535 | 52 |
| 25 | `src/world/editableHelperObjects.js` | 565 | 518 | 24 |

### Notable offenders

- **`src/dev/installBuildMode.js` (~2.25k SLOC)** — largest single file overall; dev-only but still the main editor surface. Further splits along `dev/sections/` and subsystem boundaries stay the obvious lever.
- **`src/app/createGameSession.js` (~2k SLOC, highest cyclomatic)** — session bootstrap and cross-cutting wiring (net, HUD, input, FX). Still the main “everything hooks up here” module.
- **`shared/predator.js` / `shared/roomba.js`** — long shared AI cores; same story as before: state tables, per-phase modules, or pure update pipelines.
- **`party/` modularization** — `party/server.js` is now a thin entry (~tens of lines); most authoritative room logic sits in **`party/gameRoomRuntime.js`** (~1.2k SLOC) plus focused modules (`combatSystem.js`, `roundSystem.js`, `taskSystem.js`, `heroSystem.js`, `grabSystem.js`, etc.). Complexity is spread across more files; scan the whole `party/` tree when changing multiplayer behavior.
- **`src/world/Room.js` (~1.34k SLOC)** — far smaller than historical monolith snapshots; remaining bulk is still scene/world glue worth splitting if it keeps growing.
- **`src/dev/PrefabEditorDialog.js`** — largest dialog; shared form/list primitives would still help.
- **`shared/physics.js`** — dense collision/response logic at moderate size; pairs naturally with `shared/roomCollision.js` for refactors.

---

## 2. Too Much Complexity — ranked by cyclomatic

Top 25 by approximate McCabe-style complexity.

| Rank | File | Cyclomatic | SLOC | Density |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `src/app/createGameSession.js` | **565** | 1972 | 0.29 |
| 2 | `shared/predator.js` | **558** | 1873 | 0.30 |
| 3 | `src/dev/installBuildMode.js` | 490 | 2252 | 0.22 |
| 4 | `shared/roomba.js` | 423 | 1619 | 0.26 |
| 5 | `party/gameRoomRuntime.js` | 312 | 1200 | 0.26 |
| 6 | `shared/physics.js` | 238 | 712 | 0.33 |
| 7 | `src/dev/VegetationEditorDialog.js` | 235 | 1353 | 0.17 |
| 8 | `shared/mouseBot.js` | 226 | 908 | 0.25 |
| 9 | `src/audio/AudioManager.js` | 219 | 1460 | 0.15 |
| 10 | `src/world/Room.js` | 213 | 1339 | 0.16 |
| 11 | `worker/index.js` | 187 | 638 | 0.29 |
| 12 | `src/dev/PrefabEditorDialog.js` | 183 | 1461 | 0.13 |
| 13 | `party/combatSystem.js` | 163 | 466 | **0.35** |
| 14 | `party/stats.js` | 163 | 642 | 0.25 |
| 15 | `src/entities/Human.js` | 160 | 649 | 0.25 |
| 16 | `src/controllers/CharacterController.js` | 153 | 604 | 0.25 |
| 17 | `scripts/bake-house-glb.mjs` | 151 | 703 | 0.21 |
| 18 | `scripts/live-bots.mjs` | 146 | 499 | 0.29 |
| 19 | `src/hud/RoundRaidOverlay.jsx` | 142 | 951 | 0.15 |
| 20 | `src/world/VegetationSystem.js` | 115 | 591 | 0.19 |
| 21 | `src/entities/Mouse.js` | 102 | 579 | 0.18 |
| 22 | `src/animation/MouseEyeAtlasAnimator.js` | 99 | 484 | 0.20 |
| 23 | `src/dev/DressingRoomDialog.js` | 98 | 926 | 0.11 |
| 24 | `shared/roomCollision.js` | 97 | 358 | 0.27 |
| 25 | `src/net/RemotePlayerManager.js` | 96 | 302 | 0.32 |

---

## 3. Branch-Dense Hotspots — ranked by density (SLOC ≥ 80)

Files where the ratio of decisions to lines is unusually high. Good candidates for table-driven rewrites, dispatch maps, or extra tests.

| Rank | File | Density | Cyclomatic | SLOC |
| ---: | :--- | ---: | ---: | ---: |
| 1 | `party/heroSystem.js` | **0.42** | 71 | 171 |
| 2 | `src/physics/UprightCapsuleCollider.js` | 0.41 | 50 | 121 |
| 3 | `party/grabSystem.js` | 0.40 | 48 | 119 |
| 4 | `src/dev/subsystems/probeVisuals.js` | 0.40 | 90 | 225 |
| 5 | `src/tasks/HeroUnlockTask.jsx` | 0.38 | 85 | 221 |
| 6 | `src/utils/nameplateOcclusion.js` | 0.38 | 31 | 81 |
| 7 | `party/httpSecurity.js` | 0.36 | 58 | 159 |
| 8 | `shared/raidLayout.js` | 0.35 | 68 | 192 |
| 9 | `party/worldStepSystem.js` | 0.35 | 74 | 210 |
| 10 | `party/combatSystem.js` | 0.35 | 163 | 466 |
| 11 | `shared/physics.js` | 0.33 | 238 | 712 |
| 12 | `party/messageRouter.js` | 0.33 | 34 | 102 |
| 13 | `party/taskSystem.js` | 0.33 | 37 | 111 |
| 14 | `src/world/roomEditableLayoutState.js` | 0.33 | 41 | 123 |
| 15 | `src/net/RemotePlayerManager.js` | 0.32 | 96 | 302 |

Several small **`party/*`** modules (`heroSystem`, `grabSystem`, `httpSecurity`, `worldStepSystem`) punch above their weight on density — fine if they are pure policy, but worth unit tests and occasional table-driven cleanup.

`shared/devLayoutValidation.js` stays guard-heavy by design; it often sits below the SLOC ≥ 80 cutoff here but should be reviewed whenever dev-sync payloads change.

---

## Suggested refactor order

Best ROI first (size × churn × branching):

1. **`src/app/createGameSession.js`** — top cyclomatic and very large; peel named setup modules (HUD, net, juice, portals, session lifecycle).
2. **`src/dev/installBuildMode.js`** — top SLOC; keep carving along editor sections and subsystems.
3. **`shared/predator.js` / `shared/roomba.js`** — still the biggest shared gameplay brains after bootstrap/dev.
4. **`party/gameRoomRuntime.js`** — largest Party room module after the server split; identify subdomains that could move behind smaller facades (already started with `combatSystem`, `roundSystem`, etc.).
5. **`shared/physics.js` + `shared/roomCollision.js`** — high density collision paths.
6. **`worker/index.js`** — moderate size, relatively high density.
7. **`src/audio/AudioManager.js`** — loader / mixer / spatial / ducking split.
8. **High-density `party/*` helpers** — `combatSystem.js`, `heroSystem.js`, `grabSystem.js`: add tests before refactors; prefer dispatch tables over nested conditionals where it stays readable.

---

_Methodology: character scanner strips comments and string/template literal bodies, then applies token counts. Numbers are directional, not exact — use as a map, not a verdict. The scan script excludes itself (`scripts/code-report-scan.mjs`) from totals._
