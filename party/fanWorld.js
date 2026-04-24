import { PHYSICS } from '../shared/physics.js';
import {
  CEILING_FAN_CENTER_PICKUP_RADIUS,
  CEILING_FAN_GRAB_RANGE,
  normalizeCeilingFan,
} from '../shared/ceilingFans.js';

const TAU = Math.PI * 2;
const PLAYER_GRAB_OFFSET_Y = PHYSICS.playerHeight * 0.62;
const FAN_BUMP_UP_SPEED = 4.2;
const FAN_BUMP_TANGENT_SPEED = 7.4;
const FAN_BUMP_COOLDOWN_S = 0.45;
const FAN_BLADE_ANGLE_TOLERANCE = 0.22;
const FAN_GRAB_MIN_ANGLE_TOLERANCE = 0.28;
const FAN_GRAB_VERTICAL_RANGE = 1.15;
const FAN_HUB_LANDING_VERTICAL_RANGE = 0.38;
const FAN_HUB_LANDING_BOUNCE = 1.2;

function shortestAngleDelta(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  return diff;
}

function wrapAngle(angle) {
  let value = angle % TAU;
  if (value < 0) value += TAU;
  return value;
}

function ringRadius(fan, ringIndex) {
  const inner = Math.max(0.08, fan.hubRadius * 0.68);
  const outer = fan.hubRadius * 0.42 + fan.bladeLength;
  const steps = Math.max(1, fan.gripRingCount - 1);
  const t = Math.min(1, Math.max(0, ringIndex / steps));
  return inner + ((outer - inner) * t);
}

function ringIndexForRadius(fan, radius) {
  const rings = Math.max(2, fan.gripRingCount);
  const inner = Math.max(0.08, fan.hubRadius * 0.68);
  const outer = fan.hubRadius * 0.42 + fan.bladeLength;
  const t = Math.min(1, Math.max(0, (radius - inner) / Math.max(0.001, outer - inner)));
  return Math.min(rings - 1, Math.max(0, Math.round(t * (rings - 1))));
}

function anchorState(fanState, bladeIndex, ringIndex) {
  const fan = fanState.def;
  const bladeBase = (bladeIndex / fan.bladeCount) * TAU;
  const theta = fan.rotation.y + fanState.angle + bladeBase;
  const radius = ringRadius(fan, ringIndex);
  return {
    x: fan.position.x + Math.sin(theta) * radius,
    y: fan.position.y - fan.rodLength,
    z: fan.position.z + Math.cos(theta) * radius,
    theta,
    radius,
  };
}

export function createFanWorld(options = {}) {
  /** @type {Map<string, { def: object, angle: number, cheeseAvailable: boolean }>} */
  const fans = new Map();
  /** @type {Map<string, { fanId: string, bladeIndex: number, ringIndex: number, lastAnchor: null | {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number} }>} */
  const riders = new Map();
  /** @type {Map<string, number>} */
  const bumpCooldown = new Map();

  function setFans(defs) {
    const next = Array.isArray(defs) ? defs.map((entry) => normalizeCeilingFan(entry)) : [];
    const previous = new Map(fans);
    fans.clear();
    next.forEach((fan) => {
      const prev = previous.get(fan.id);
      fans.set(fan.id, {
        def: fan,
        angle: prev?.angle ?? 0,
        cheeseAvailable: prev?.cheeseAvailable ?? (fan.cheeseAmount > 0),
      });
    });
    for (const [playerId, ride] of riders) {
      if (!fans.has(ride.fanId)) riders.delete(playerId);
    }
  }

  function resetRound() {
    for (const fanState of fans.values()) {
      fanState.cheeseAvailable = fanState.def.cheeseAmount > 0;
    }
  }

  function serialize() {
    return [...fans.values()].map((fanState) => ({
      id: fanState.def.id,
      angle: fanState.angle,
      cheeseAvailable: fanState.cheeseAvailable,
    }));
  }

  function isAttached(playerId) {
    return riders.has(playerId);
  }

  function removePlayer(playerId, state = null) {
    riders.delete(playerId);
    if (state?.ropeSwing) state.ropeSwing = null;
  }

  function tryGrab(playerId, state) {
    if (!state?.alive || state.grounded || state.ropeSwing || riders.has(playerId)) return false;
    let best = null;
    const px = state.position.x;
    const py = state.position.y + PLAYER_GRAB_OFFSET_Y;
    const pz = state.position.z;
    for (const fanState of fans.values()) {
      const fan = fanState.def;
      const fanY = fan.position.y - fan.rodLength;
      const verticalDelta = Math.abs(fanY - py);
      const dx = px - fan.position.x;
      const dz = pz - fan.position.z;
      const radial = Math.hypot(dx, dz);
      const minRadius = Math.max(0.08, fan.hubRadius * 0.55);
      const maxRadius = fan.hubRadius * 0.42 + fan.bladeLength + CEILING_FAN_GRAB_RANGE;
      if (verticalDelta <= FAN_GRAB_VERTICAL_RANGE && radial >= minRadius && radial <= maxRadius) {
        const theta = Math.atan2(dx, dz);
        const ringIndex = ringIndexForRadius(fan, radial);
        const ringRadial = ringRadius(fan, ringIndex);
        const angleTolerance = Math.max(
          FAN_GRAB_MIN_ANGLE_TOLERANCE,
          Math.min(0.72, CEILING_FAN_GRAB_RANGE / Math.max(0.35, radial)),
        );
        for (let bladeIndex = 0; bladeIndex < fan.bladeCount; bladeIndex += 1) {
          const bladeTheta = fan.rotation.y + fanState.angle + ((bladeIndex / fan.bladeCount) * TAU);
          const angleDelta = Math.abs(shortestAngleDelta(theta, bladeTheta));
          if (angleDelta > angleTolerance) continue;
          const tangentMiss = Math.sin(angleDelta) * radial;
          const radialMiss = radial - Math.min(maxRadius, Math.max(minRadius, ringRadial));
          const distSq = (verticalDelta * verticalDelta) + (tangentMiss * tangentMiss) + (radialMiss * radialMiss);
          if (!best || distSq < best.distSq) {
            best = { fanId: fan.id, bladeIndex, ringIndex, distSq };
          }
        }
      }
      for (let bladeIndex = 0; bladeIndex < fan.bladeCount; bladeIndex += 1) {
        for (let ringIndex = 0; ringIndex < fan.gripRingCount; ringIndex += 1) {
          const anchor = anchorState(fanState, bladeIndex, ringIndex);
          const dx = anchor.x - px;
          const dy = anchor.y - py;
          const dz = anchor.z - pz;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > CEILING_FAN_GRAB_RANGE * CEILING_FAN_GRAB_RANGE) continue;
          if (!best || distSq < best.distSq) {
            best = { fanId: fan.id, bladeIndex, ringIndex, distSq };
          }
        }
      }
    }
    if (!best) return false;
    riders.set(playerId, {
      fanId: best.fanId,
      bladeIndex: best.bladeIndex,
      ringIndex: best.ringIndex,
      lastAnchor: null,
      velocity: { x: 0, y: 0, z: 0 },
    });
    state.ropeSwing = { ropeId: `fan:${best.fanId}`, segmentIndex: best.ringIndex };
    state.wallHolding = false;
    state.grounded = false;
    return true;
  }

  function scootUp(playerId, state) {
    const ride = riders.get(playerId);
    if (!ride) return false;
    const nextIndex = Math.max(0, ride.ringIndex - 1);
    if (nextIndex === ride.ringIndex) return false;
    ride.ringIndex = nextIndex;
    ride.lastAnchor = null;
    if (state?.ropeSwing) state.ropeSwing.segmentIndex = nextIndex;
    return true;
  }

  function release(playerId, state) {
    const ride = riders.get(playerId);
    if (!ride) return;
    riders.delete(playerId);
    if (state) {
      state.ropeSwing = null;
      state.velocity.x = ride.velocity.x;
      state.velocity.y = ride.velocity.y;
      state.velocity.z = ride.velocity.z;
      state.grounded = false;
      state.canDoubleJump = true;
      state.hasDoubleJumped = false;
    }
  }

  function awardHubCheese(fanState, state) {
    if (!fanState?.cheeseAvailable || !state?.alive) return false;
    fanState.cheeseAvailable = false;
    state.cheeseCarried = Math.max(0, Math.floor(state.cheeseCarried ?? 0)) + fanState.def.cheeseAmount;
    if (state.roundStats) {
      state.roundStats.cheeseCollected += fanState.def.cheeseAmount;
    }
    return true;
  }

  function tryLandOnHub(fanState, state) {
    if (!state?.alive || state.ropeSwing) return false;
    const fan = fanState.def;
    const hubY = fan.position.y - fan.rodLength;
    const dx = state.position.x - fan.position.x;
    const dz = state.position.z - fan.position.z;
    const radius = Math.max(CEILING_FAN_CENTER_PICKUP_RADIUS, fan.hubRadius + 0.18);
    if ((dx * dx + dz * dz) > radius * radius) return false;
    if (state.velocity.y > 1.2) return false;
    if (Math.abs(state.position.y - hubY) > FAN_HUB_LANDING_VERTICAL_RANGE) return false;

    state.position.y = hubY;
    state.velocity.x *= 0.55;
    state.velocity.z *= 0.55;
    state.velocity.y = Math.max(0, state.velocity.y);
    state.grounded = true;
    state.canDoubleJump = true;
    state.hasDoubleJumped = false;
    awardHubCheese(fanState, state);
    return true;
  }

  function step(dt, players) {
    for (const fanState of fans.values()) {
      fanState.angle = wrapAngle(fanState.angle + (fanState.def.spinSpeed * dt));
    }

    for (const [playerId, ride] of riders) {
      const state = players.get(playerId);
      if (!state?.alive) {
        removePlayer(playerId, state);
        continue;
      }
      if (state._ropeInput?.scootUp) {
        scootUp(playerId, state);
      }
      const fanState = fans.get(ride.fanId);
      if (!fanState) {
        release(playerId, state);
        continue;
      }
      const anchor = anchorState(fanState, ride.bladeIndex, ride.ringIndex);
      if (ride.lastAnchor) {
        ride.velocity.x = (anchor.x - ride.lastAnchor.x) / Math.max(dt, 1e-4);
        ride.velocity.y = (anchor.y - ride.lastAnchor.y) / Math.max(dt, 1e-4);
        ride.velocity.z = (anchor.z - ride.lastAnchor.z) / Math.max(dt, 1e-4);
      } else {
        ride.velocity.x = 0;
        ride.velocity.y = 0;
        ride.velocity.z = 0;
      }
      ride.lastAnchor = anchor;
      state.position.x = anchor.x;
      state.position.y = Math.max(0, anchor.y - PLAYER_GRAB_OFFSET_Y);
      state.position.z = anchor.z;
      state.velocity.x = ride.velocity.x;
      state.velocity.y = ride.velocity.y;
      state.velocity.z = ride.velocity.z;
      state.grounded = false;
      state.animState = 'jump';

      if (fanState.cheeseAvailable && ride.ringIndex <= 1) {
        const dx = state.position.x - fanState.def.position.x;
        const dz = state.position.z - fanState.def.position.z;
        if (dx * dx + dz * dz <= CEILING_FAN_CENTER_PICKUP_RADIUS * CEILING_FAN_CENTER_PICKUP_RADIUS) {
          awardHubCheese(fanState, state);
        }
      }

      if (state._ropeInput?.releasePressed) {
        release(playerId, state);
      }
    }

    for (const [playerId, seconds] of bumpCooldown) {
      const next = seconds - dt;
      if (next <= 0) bumpCooldown.delete(playerId);
      else bumpCooldown.set(playerId, next);
    }

    for (const [playerId, state] of players) {
      if (!state?.alive || riders.has(playerId)) continue;
      for (const fanState of fans.values()) {
        if (tryLandOnHub(fanState, state)) {
          if ((bumpCooldown.get(playerId) ?? 0) <= 0) {
            state.velocity.y = Math.max(state.velocity.y, FAN_HUB_LANDING_BOUNCE);
            bumpCooldown.set(playerId, FAN_BUMP_COOLDOWN_S);
          }
          break;
        }
      }
      if ((bumpCooldown.get(playerId) ?? 0) > 0) continue;
      const handsY = state.position.y + PLAYER_GRAB_OFFSET_Y;
      for (const fanState of fans.values()) {
        const fan = fanState.def;
        const fanY = fan.position.y - fan.rodLength;
        if (Math.abs(handsY - fanY) > 0.34) continue;
        const dx = state.position.x - fan.position.x;
        const dz = state.position.z - fan.position.z;
        const radial = Math.hypot(dx, dz);
        const minRadius = Math.max(0.12, fan.hubRadius * 0.65);
        const maxRadius = fan.hubRadius * 0.42 + fan.bladeLength + 0.18;
        if (radial < minRadius || radial > maxRadius) continue;
        const theta = Math.atan2(dx, dz);
        let hit = false;
        for (let bladeIndex = 0; bladeIndex < fan.bladeCount; bladeIndex += 1) {
          const bladeTheta = fan.rotation.y + fanState.angle + ((bladeIndex / fan.bladeCount) * TAU);
          if (Math.abs(shortestAngleDelta(theta, bladeTheta)) <= FAN_BLADE_ANGLE_TOLERANCE) {
            hit = true;
            break;
          }
        }
        if (!hit) continue;
        const tangentialSign = fan.spinSpeed >= 0 ? 1 : -1;
        const tangentX = Math.cos(theta) * tangentialSign;
        const tangentZ = -Math.sin(theta) * tangentialSign;
        state.velocity.x += tangentX * FAN_BUMP_TANGENT_SPEED;
        state.velocity.z += tangentZ * FAN_BUMP_TANGENT_SPEED;
        state.velocity.y = Math.max(state.velocity.y, FAN_BUMP_UP_SPEED);
        state.grounded = false;
        bumpCooldown.set(playerId, FAN_BUMP_COOLDOWN_S);
        break;
      }
    }
  }

  return {
    setFans,
    resetRound,
    serialize,
    isAttached,
    tryGrab,
    scootUp,
    release,
    removePlayer,
    step,
  };
}
