# Wavedash Backend Migration

This folder is the migration target for the new Wavedash multiplayer backend.
Wavedash multiplayer is lobby plus peer-to-peer WebRTC, so there is no PartyKit-style
dedicated room process to deploy. The practical migration is host-authoritative P2P:
the Wavedash lobby host runs the existing room simulation in the browser and relays
the same game messages to peers.

## Current Game Contract

The client already talks through a narrow API in `src/net/NetworkClient.js`:

- sends JSON commands: `hello`, `input`, `task-complete`, `squeak`, `spawn-extra-ball`,
  `unlock-pickup`, `claim-hero`, `purchase-drone`, `dev-sync-layout`
- receives JSON events: `init`, `snapshot`, `player-joined`, `player-left`, `round-phase`,
  `round-end`, task/unlock/hero/drone events
- stores the authoritative local player in `net.serverState`, other players in
  `net.remotePlayers`, and world state in `remotePredators`, `pushBalls`, `mounts`,
  `ropes`, `fans`, `physicalTasks`, `cheesePickups`, `round`, `extractionPortals`,
  and `adversary`

The PartyKit backend owns the simulation in `party/gameRoomRuntime.js`: input queues,
predators, rounds, task completion, balls, mounts, ropes, fans, unlocks, and snapshots.
Keeping that runtime is the lowest-risk path.

## Wavedash Shape

Wavedash injects the SDK global before the game starts on Wavedash, and `wavedash dev`
does the same locally. The game must call `Wavedash.init()` once during boot.

Lobby flow:

- read `Wavedash.getLaunchParams().lobby` for invite links
- otherwise list/create/join a lobby with `createLobby`, `joinLobby`,
  `listAvailableLobbies`, and lobby metadata
- use `getLobbyHostId(lobbyId)` to decide who runs the host backend
- use `getLobbyInviteLink(true)` instead of building `?room=priv-*` URLs

P2P flow:

- Wavedash creates a full mesh between lobby members
- messages are `Uint8Array`
- channel 0 should carry reliable backend events such as init/snapshot/control
- channel 1 can carry unreliable high-rate inputs after we compact them
- configure `p2p.messageSize` to `65536`, then add chunking/compaction because current
  JSON snapshots may exceed the default 2048 byte slot

## Files In This Folder

- `hostBackend.js` wraps `party/gameRoomRuntime.js` with a browser-compatible fake room
  and fake connections. It lets the Wavedash lobby host reuse the current simulation.
- `memoryStorage.js` provides the small async storage API that `StatsTracker` expects.

## Implementation Steps

1. Add a Wavedash SDK wrapper in `src/net` that resolves `window.Wavedash` or
   `window.WavedashJS`, calls `init({ deferEvents: true, p2p: { maxPeers: 8,
   messageSize: 65536, maxIncomingMessages: 1024 } })`, installs event listeners, and
   drains P2P messages each frame.
2. Add `src/net/WavedashNetworkClient.js` implementing the same public fields and
   methods as `NetworkClient`. It should encode/decode the existing JSON protocol first,
   then can be optimized to binary once functional.
3. When this client is the lobby host, create `createWavedashHostBackend()`, call
   `start()`, and connect the local user plus each lobby user. When not host, send all
   commands to the host peer.
4. Route backend output with `onSend(targetUserId, message)`: deliver directly to the
   local `WavedashNetworkClient` for the host player, otherwise send to the target peer
   over reliable P2P.
5. Replace `src/main.js` room/matchmaking flow with Wavedash lobby flow behind a feature
   flag, then remove `/api/matchmake`, PartySocket, and Cloudflare room registry code
   after parity testing.
6. Replace `fetchLeaderboard()` with Wavedash leaderboards/stats, or intentionally keep
   game-only leaderboards disabled until the platform scoring model is decided.

## Risks To Handle Before Cutover

- Host migration: if the lobby host leaves, either pause and elect a new host with a
  transferred snapshot or return players to the lobby. Wavedash does not preserve a
  dedicated room authority for us.
* noted, we will implement host migration in the next iteration

- Message size: current JSON snapshots include many systems. Wavedash P2P payload slots
  must be sized and likely chunked/compacted.
* we will do analysis of the current snapshot size and chunking/compaction strategy

- Trust model: host-authoritative means the host can cheat. If this matters for ranked
  scoring, Wavedash P2P alone is not equivalent to PartyKit authority.
* this is fine

- Local dev: regular `vite` will not inject the SDK. Use `wavedash dev` for platform
  testing and keep an offline/dev fallback for normal asset iteration.
* i want both still available vite dev for building and using editors, wavedash dev for testing before deploying
