# Mouse Trouble

![Mouse preview](./mouse.gif)

[Play Mouse Trouble](https://mouse.ryanfitzpatrick.io/)

Mouse Trouble is a browser multiplayer kitchen game built with Vite, Three.js, PartyKit, and Cloudflare Workers. You play as a mouse in a large stylized kitchen, collect cheese, survive cat chases, dodge the roomba, shove other mice around, and try to hold the best chase and cheese scores.

The current build includes:

- WebGL third-person play with a rigged mouse, animated eye atlas, cel-style materials, edge outlines, shadows, nameplates, and wall occlusion fading.
- Server-authoritative multiplayer through PartyKit at 30 ticks per second, with client prediction, reconciliation, remote player interpolation, public room overflow after 16 humans, and URL-addressable private rooms.
- Mouse bots that fill empty seats up to 8 total occupants in quieter rooms, chase cheese, and use the same shared movement/navmesh code as players.
- A kitchen level authored from JSON primitives, prefabs, custom GLB placements, texture atlases, lights, spawn markers, and Vibe Jam portals.
- Server-side cat and roomba predators, cheese pickup/drop state, push balls, roomba cannon and mouse launch interactions.
- HUD, scoreboard, player display names, audio controls, emotes, mobile touch controls, cat locator, chase alert, and all-time leaderboards.
- Aggregate stats and public leaderboards backed by a Cloudflare Worker and `GAME_STATS` KV.
- Dev-only build mode for editing the level, prefabs, texture assignments, lights, spawn points, GLB registry entries, and portal placements.

## Controls

Desktop:

- `WASD`: move relative to the camera
- Mouse: look around after clicking the canvas
- `Shift`: sprint
- `Space`: jump / double jump
- `Ctrl`: crouch or slide
- `Q`: grab another mouse
- `E`: smack another mouse
- `G`: drop carried item
- `F`: emote wheel
- `J`: claim or release the adversary human role when available
- `Tab`: hold scoreboard
- `N`: spawn an extra push ball
- `P`: performance panel
- `O`: navmesh overlay
- `B`: build mode in Vite dev only

Touch devices get a virtual joystick, camera drag area, and buttons for jump, sprint, slide, use, drop, ball, and emote.

## Development

Install dependencies:

```bash
npm install
```

Create a local env file if you need stats/admin tokens or dev layout sync:

```bash
cp .env.example .env
```

Vite loads `.env` for the client, and `npm run dev:party` loads the same file through `node --env-file=.env`.

Run the Vite client:

```bash
npm run dev
```

Run the PartyKit game server in another terminal when testing multiplayer, bots, predators, cheese, leaderboards, or stats:

```bash
npm run dev:party
```

By default the client connects to `localhost:1999`. Set `VITE_PARTYKIT_HOST` when pointing a local client at a deployed PartyKit host.

```bash
VITE_PARTYKIT_HOST=mouse-trouble.username.partykit.dev
```

The Vite app can boot without PartyKit, but most game systems are server-owned and only fully work with the PartyKit server running.

## Build

```bash
npm run build
```

`npm run build` runs the `prebuild` pipeline before Vite builds. The pipeline currently:

- Converts `public/levels/kitchen-layout.json` into `shared/kitchen-layout.generated.js`.
- Regenerates cat, mouse, and roomba navmeshes from the level layout.
- Applies the mouse skin and optimizes runtime GLB assets.
- Generates the texture atlas registry and atlas manifests.
- Optimizes runtime images and ambient audio.
- Optimizes custom GLBs from `assets/source/custom` into `public/models`.

Useful asset/dev scripts:

```bash
npm run mouse:skin
npm run textures:analyze
npm run dev:trim-audio
npm run preview
```

## Build Mode

Build mode is only installed in Vite dev. Press `B` to open it.

Build mode saves through Vite-only endpoints in `vite.config.js`:

- `/__dev/save-level` writes `public/levels/kitchen-layout.json`, then regenerates `shared/kitchen-layout.generated.js` and the navmesh modules.
- `/__dev/save-prefabs` writes `public/levels/prefabs.json`.
- `/__dev/upload-glb` stores custom GLBs in `assets/source/custom` and `public/models`.
- `/__dev/save-glb-registry` writes `public/levels/glb-registry.json`.

To sync saved level colliders into a running PartyKit dev room without restarting the server, configure both sides with the same token:

```bash
VITE_DEV_LAYOUT_SYNC_TOKEN=your-token
DEV_LAYOUT_SYNC_ENABLED=true
DEV_LAYOUT_SYNC_TOKEN=your-token
```

## Architecture

- `src/main.js` boots the canvas app, mobile controls, performance panel, and dev build mode.
- `src/app/createGameSession.js` wires Three.js rendering, controls, networking, HUD, audio, predators, cheese visuals, push balls, portals, and prediction.
- `shared/` contains simulation code used by both client and server: movement physics, predators, roomba logic, nav config, room collision, spawn points, player input sanitization, bots, display names, chase scoring, and Vibe portal handling.
- `party/server.js` is the PartyKit authoritative game server.
- `party/stats.js` tracks per-player and aggregate stats, either through a PartyKit KV binding or by forwarding deltas to the Cloudflare Worker.
- `worker/index.js` serves the built Vite app, applies security headers, receives signed stats events, exposes admin stats, and exposes public leaderboards.
- `public/levels/` holds editable level, prefab, and GLB registry data.
- `assets/source/` holds source models, textures, FBX clips, and custom GLBs.
- `public/` holds optimized runtime assets served by Vite/Workers.

## Environment

Client:

```bash
VITE_PARTYKIT_HOST=mouse-trouble.username.partykit.dev
VITE_DEV_LAYOUT_SYNC_TOKEN=your-dev-sync-token
```

PartyKit:

```bash
ALLOWED_ORIGINS=https://mouse.ryanfitzpatrick.io,http://localhost:5173
STATS_COLLECTOR_URL=https://mouse.ryanfitzpatrick.io/api/stats/event
STATS_COLLECTOR_TOKEN=shared-secret
STATS_ADMIN_TOKEN=admin-secret
DEV_LAYOUT_SYNC_ENABLED=false
DEV_LAYOUT_SYNC_TOKEN=your-dev-sync-token
```

Cloudflare Worker:

```bash
STATS_COLLECTOR_TOKEN=shared-secret
STATS_ADMIN_TOKEN=admin-secret
```

Set secrets with:

```bash
npx wrangler secret put STATS_COLLECTOR_TOKEN
npx wrangler secret put STATS_ADMIN_TOKEN
npx partykit env add STATS_COLLECTOR_URL
npx partykit env add STATS_COLLECTOR_TOKEN
npx partykit env add STATS_ADMIN_TOKEN
npx partykit env add ALLOWED_ORIGINS
```

`ALLOWED_ORIGINS` is a comma-separated list of browser origins allowed to open PartyKit WebSockets. Localhost and loopback origins are allowed by the server for development.

## Stats And Leaderboards

The deployed Worker exposes:

- `POST /api/stats/event`: accepts signed stat batches from PartyKit.
- `POST /api/rooms/event`: accepts signed room occupancy updates from PartyKit for matchmaking.
- `POST /api/matchmake`: returns a public overflow room or creates a private room allocation.
- `GET /api/stats`: returns aggregate stats with `Authorization: Bearer $STATS_ADMIN_TOKEN`.
- `GET /api/leaderboard`: returns public all-time leaderboards for longest cat chase and most cheese held.

Example admin request:

```bash
curl -H "Authorization: Bearer $STATS_ADMIN_TOKEN" https://mouse.ryanfitzpatrick.io/api/stats
```

The PartyKit server also handles `GET /stats` and `GET /leaderboard` for local/dev access.

## Deploy

Wrangler serves the static Vite build from `dist` using the Worker in `worker/index.js` with SPA fallback. PartyKit is deployed separately.

```bash
npm run deploy:cf
npm run deploy:party
```

Or deploy both:

```bash
npm run deploy
```

Cloudflare configuration lives in `wrangler.jsonc`; PartyKit configuration lives in `partykit.json`.

## Project Notes

- Only WebGL is currently supported. The renderer mode code keeps a small migration path for older `webgpu` localStorage values.
- `GDD.md` is an older design document and does not exactly describe the current playable build.
- `SECURITY.md` still contains placeholder version/support text.
- `dist/` is checked in as a build artifact in this workspace, but runtime source lives in `src/`, `shared/`, `party/`, `worker/`, `public/`, and `assets/source/`.
