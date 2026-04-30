/**
 * Shared physics constants and simulation logic.
 * Used by both client (prediction) and server (authority).
 * Keep this file free of Three.js / DOM / Node dependencies.
 */

import { LIVES_PER_ROUND, createRoundStats } from './roundState.js';
import {
  sampleWedgeCeilingY,
  sampleWedgeSupportY,
} from './wedgeCollision.js';

export const PHYSICS = Object.freeze({
  walkSpeed: 4.0,
  sprintSpeed: 9.0,
  crouchSpeed: 2.0,
  slideSpeed: 10.5,
  slideDuration: 0.6,
  slideCooldown: 1.0,
  jumpForce: 6.2,
  doubleJumpForce: 5.3,
  chargedJumpFullHoldSeconds: 1.6,
  chargedJumpMaxMultiplier: 3.65,
  chargedJumpGroundedGraceSeconds: 0.16,
  wallJumpForce: 7.6,
  wallJumpAwayForce: 5.6,
  gravity: -20.0,
  groundOffset: 0.35,
  playerHeightOffset: -0.035,
  playerRadius: 0.22,
  playerHeight: 0.78,
  adversaryHumanRadius: 0.82,
  adversaryHumanHeight: 2.2,
  groundSnapDistance: 0.18,
  /** Max vertical rise (m) when walking onto a short ledge while grounded. */
  maxStepHeight: 0.35,
  wallProbeDistance: 0.14,
  wallJumpWindow: 0.22,
  wallAttachCooldown: 0.16,
  turnSmooth: 12,

  // --- Movement feel tuning ---
  /** Exponential-approach rate toward target horizontal velocity when actively inputting, on ground. */
  groundAccel: 55,
  /** Exponential-approach rate toward 0 on ground when no input — snappy stop. */
  groundDecel: 42,
  /** Weaker air control — can still steer but not as snappy. */
  airAccel: 14,
  /** Very slow air drag so momentum is preserved mid-jump (parkour floaty feel). */
  airDecel: 1.2,
  /** While wall-holding, horizontal input has almost no effect (wall clamps one axis). */
  wallAccel: 6,

  // --- Wall climb ---
  /** Upward crawl speed while wall-holding and pressing into the wall (consumes stamina). */
  wallClimbSpeed: 2.8,
  /** Stamina per second consumed while wall-climbing. */
  wallClimbStaminaDrain: 40,

  maxStamina: 100,
  staminaDrainRate: 30,
  staminaRegenRate: 15,
  staminaRegenDelay: 1.0,

  maxHealth: 2,

  bumpForce: 3.0,
  carrySpeedMult: 0.6,
  heavyCarrySpeedMult: 0.35,
  /** Movement multiplier while piloting the human adversary role. */
  adversaryHumanSpeedMult: 1.35,
});

function getPlayerCollisionConfig(state) {
  if (state?.isAdversary && state.adversaryRole === 'human') {
    return {
      radius: PHYSICS.adversaryHumanRadius,
      height: PHYSICS.adversaryHumanHeight,
    };
  }
  return {
    radius: PHYSICS.playerRadius,
    height: PHYSICS.playerHeight,
  };
}

function heroSpeedMultiplier(state) {
  if (!state?.isHero) return 1;
  switch (state.heroAvatar) {
    case 'speedy':
      return 1.8;
    case 'gus':
      return 1.22;
    case 'brain':
      return 1.35;
    case 'jerry':
      return 1.45;
    default:
      return 1.45;
  }
}

function heroJumpMultiplier(state) {
  if (!state?.isHero) return 1;
  switch (state.heroAvatar) {
    case 'brain':
      return 1.34;
    case 'speedy':
      return 1.18;
    case 'gus':
      return 1.08;
    default:
      return 1.2;
  }
}

/**
 * Create a fresh player physics state.
 */
export function createPlayerState(id) {
  return {
    id,
    /** Shown above the character (server-authoritative string). */
    displayName: 'Mouse',
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: 0,
    grounded: true,
    groundedGraceTimer: PHYSICS.chargedJumpGroundedGraceSeconds,
    stamina: PHYSICS.maxStamina,
    staminaRegenTimer: 0,
    health: PHYSICS.maxHealth,
    alive: true,
    sprinting: false,
    crouching: false,
    sliding: false,
    slideTimer: 0,
    slideCooldownTimer: 0,
    slideDirX: 0,
    slideDirZ: 0,
    canDoubleJump: false,
    hasDoubleJumped: false,
    wallHolding: false,
    wallNormalX: 0,
    wallNormalZ: 0,
    wallJumpWindowTimer: 0,
    wallAttachCooldownTimer: 0,
    /** Anim-only grace: extends wall-run walk/idle anim across brief wallHolding drop-outs. */
    wallAnimGraceTimer: 0,
    animState: 'idle',
    deathTime: 0,
    /** Cumulative deaths (server-authoritative; included in snapshots). */
    deaths: 0,
    /** Best completed single cat chase (seconds); server updates when a streak ends. */
    longestChaseSeconds: 0,
    /** Current uninterrupted chase (seconds); 0 when not hunted. */
    chaseStreakSeconds: 0,
    /** Cheese carried (server-authoritative; dropped in place on death). */
    cheeseCarried: 0,
    /** Current emote id while active; server updates from sanitized input. */
    emote: null,
    /** Roomba vacuum: `suck` (pulled under) then `flight` (cannon-es); server-driven. */
    roombaLaunch: null,
    /** Seconds until roomba can grab this mouse again. */
    roombaLaunchCooldown: 0,
    /** Rope swing: `{ ropeId, segmentIndex }` while server is driving position via cannon-es. */
    ropeSwing: null,
    /** Player id currently grabbing this player (null if free). */
    grabbedBy: null,
    /** Player id this player is grabbing (null if not grabbing). */
    grabbedTarget: null,
    /** Push-ball id this player is currently holding above their head (null if none). */
    grabbedBallId: null,
    /** Rideable mount id while mounted (null if walking normally). */
    mountId: null,
    /** Purchased from a device screen; consumed at the next round start. */
    droneNextRound: false,
    /** True while this player is locked into the purchased drone mount. */
    isDrone: false,
    /** Seconds remaining of smack stun (plays death anim, recovers when 0). */
    smackStunTimer: 0,
    /** Monotonic client effect trigger for charged-smack impact sounds. */
    chargedSmackHitSeq: 0,
    /** After a smack, the player can be thrown limp instead of latching to walls. */
    smackLimpThrowWindowTimer: 0,
    /** While thrown limp, suppress wall/surface latching so collisions knock the player around. */
    limpThrownBounceTimer: 0,
    /** Monotonic client effect trigger for limp thrown collision sounds. */
    limpBounceHitSeq: 0,
    /** Cooldown before this player can grab again (seconds). */
    grabCooldown: 0,
    /** Cooldown before this player can smack again (seconds). */
    smackCooldown: 0,
    /** Burn damage-over-time remaining after touching a hot surface. */
    burnTimer: 0,
    /** Internal burn damage tick timer. */
    burnTickTimer: 0,
    /** Monotonic client effect trigger for burn visuals/audio. */
    burnEffectSeq: 0,

    /** Extraction raid: lives left this round (cat/roomba deaths). */
    livesRemaining: LIVES_PER_ROUND,
    /** True when out of lives until round resets. */
    spectator: false,
    /** Successfully reached an extraction portal. */
    extracted: false,
    /** 0 before extraction, 1 once extracted. Kept for HUD/back-compat. */
    extractProgress: 0,
    /** Per-round scoring / task progress (server). */
    roundStats: createRoundStats(),
    /** Hero system: set by server when this player may press H to become hero. */
    heroAvailable: false,
    /** Hero system: set by server after H press; unlocks super-charged moveset + swapped model. */
    isHero: false,
    /** Hero system: which avatar model (key into client HERO_AVATARS) the server picked. */
    heroAvatar: null,
    /** Seconds remaining before hero mode returns to normal mouse form. */
    heroTimeRemaining: 0,
    /** Hero system: which avatar this player is eligible to respawn as (set at election). */
    heroAvatarAvailable: null,
    /** Session-persistent counts for collection-based hero unlocks. Do NOT reset per round. */
    sewingCollected: 0,
    speedTokensCollected: 0,
    /** True when this player has claimed the single adversary slot this round. */
    isAdversary: false,
    /** Adversary role key. For now only `human` is supported. */
    adversaryRole: null,
    /** Seconds this round spent as adversary with no mice nearby. */
    adversarySafeSeconds: 0,
    /** Current uninterrupted safe streak while playing adversary. */
    adversarySafeStreakSeconds: 0,
  };
}

const FACE_CONTACT_EPSILON = 0.001;

export function getColliderBox(collider) {
  return collider?.aabb ?? collider?.box ?? null;
}

function isNonWalkableCollider(collider) {
  return collider?.metadata?.nonWalkable === true;
}

function getWedgeDescriptor(collider) {
  return collider?.metadata?.wedge ?? null;
}

/**
 * Skip axis-aligned box resolve for co-planar datum floors only.
 * (Previously used ±5 cm from groundY, which skipped low risers entirely—no step-up, no resolve.)
 */
export function shouldSkipSurfaceCollider(collider, groundY = 0) {
  const box = getColliderBox(collider);
  if (!box) return false;
  return (collider.type === 'surface' || collider.metadata?.runnable)
    && box.max.y <= groundY + 0.025;
}

/**
 * Snap feet onto a short ledge while grounded (shared by server sim and client controller).
 * Mutates state.position.y and state.velocity.y when it returns true.
 */
export function tryAutoStepUp(state, collider, { radius, height, grounded }) {
  if (!grounded) return false;
  const box = getColliderBox(collider);
  if (!box) return false;
  if (isNonWalkableCollider(collider)) return false;

  const capsuleMinY = state.position.y;
  const capsuleMaxY = state.position.y + height;
  const ledgeHeight = box.max.y - capsuleMinY;
  if (!(ledgeHeight > 0 && ledgeHeight <= PHYSICS.maxStepHeight)) return false;

  const expandedMinX = box.min.x - radius;
  const expandedMaxX = box.max.x + radius;
  const expandedMinZ = box.min.z - radius;
  const expandedMaxZ = box.max.z + radius;
  const insideX = state.position.x >= expandedMinX && state.position.x <= expandedMaxX;
  const insideZ = state.position.z >= expandedMinZ && state.position.z <= expandedMaxZ;
  const inYRange = capsuleMaxY >= box.min.y && capsuleMinY <= box.max.y;

  if (!(insideX && insideZ && inYRange)) return false;

  state.position.y = box.max.y;
  if (state.velocity) state.velocity.y = 0;
  return true;
}

/** Horizontal plane surfaces (`metadata.plane`) only; used for collision resolution order. */
function isPlaneSurfaceCollider(collider) {
  return collider?.type === 'surface' && collider?.metadata?.plane === true;
}

/**
 * Sort horizontal plane surfaces by `metadata.zIndex` descending (higher first), then
 * append all other colliders in their original order. Raised planes should resolve before
 * the datum floor so step-up and pushes behave predictably.
 */
export function sortCollidersForPlaneZIndex(colliders) {
  if (!colliders?.length) return colliders ?? [];
  const tagged = colliders.map((c, i) => ({ c, i }));
  const planeTagged = tagged.filter(({ c }) => isPlaneSurfaceCollider(c));
  const restTagged = tagged.filter(({ c }) => !isPlaneSurfaceCollider(c));
  planeTagged.sort((a, b) => {
    const za = a.c.metadata?.zIndex ?? 0;
    const zb = b.c.metadata?.zIndex ?? 0;
    if (zb !== za) return zb - za;
    return a.i - b.i;
  });
  restTagged.sort((a, b) => a.i - b.i);
  return [...planeTagged.map((t) => t.c), ...restTagged.map((t) => t.c)];
}

function isWallCollider(collider) {
  const box = getColliderBox(collider);
  if (!box) return false;
  if (collider.type === 'loot') return false;
  if (collider.metadata?.runnable) return false;
  if (collider.type === 'surface') {
    // Plane primitives are tagged 'surface' regardless of orientation. Treat a vertical plane
    // (tall, thin on one horizontal axis) as a wall so wall-run detection picks it up.
    const dx = box.max.x - box.min.x;
    const dy = box.max.y - box.min.y;
    const dz = box.max.z - box.min.z;
    return dy > 0.3 && (dx < 0.1 || dz < 0.1);
  }
  return true;
}

function getSupportHeight(state, colliders, radius, groundSnapDistance, baseGroundY = 0) {
  let supportY = baseGroundY;

  for (const collider of colliders ?? []) {
    const wedge = getWedgeDescriptor(collider);
    if (wedge) {
      if (isNonWalkableCollider(collider)) continue;
      const wedgeY = sampleWedgeSupportY(wedge, state.position.x, state.position.z, radius);
      if (wedgeY == null) continue;
      const snapWindow = (collider.type === 'surface' || collider.metadata?.runnable)
        ? groundSnapDistance
        : groundSnapDistance * 1.5;
      if (state.position.y >= wedgeY - snapWindow && state.velocity.y <= 0.01) {
        supportY = Math.max(supportY, wedgeY);
      }
      continue;
    }

    const box = getColliderBox(collider);
    if (!box) continue;

    const withinX = state.position.x >= box.min.x - radius && state.position.x <= box.max.x + radius;
    const withinZ = state.position.z >= box.min.z - radius && state.position.z <= box.max.z + radius;
    if (!withinX || !withinZ) continue;

    const isSurface = collider.type === 'surface' || collider.metadata?.runnable;
    const surfaceY = box.max.y;
    const canSupport = !isNonWalkableCollider(collider);

    if (isSurface) {
      // Explicit surfaces (planes, runnable floors) — snap when near
      if (canSupport && state.position.y >= surfaceY - groundSnapDistance) {
        supportY = Math.max(supportY, surfaceY);
      }
    } else {
      // Furniture / solid boxes — land on top when player is at or above the top face
      // Use a slightly larger snap window so small gaps don't prevent landing
      const snapWindow = groundSnapDistance * 1.5;
      if (canSupport && state.position.y >= surfaceY - snapWindow && state.velocity.y <= 0.01) {
        supportY = Math.max(supportY, surfaceY);
      }
    }
  }

  return supportY;
}

function resolveAgainstWedge(state, collider, radius, height, previousPosition = null, options = {}) {
  const wedge = getWedgeDescriptor(collider);
  if (!wedge) return false;

  const { position: pos, velocity: vel } = state;
  const allowVerticalSupport = options.allowVerticalSupport !== false;
  const groundSnapDistance = options.groundSnapDistance ?? PHYSICS.groundSnapDistance;
  const previousCapsuleMinY = previousPosition?.y ?? pos.y;
  const previousCapsuleMaxY = previousCapsuleMinY + height;
  const capsuleMaxY = pos.y + height;
  let resolved = false;

  const supportY = sampleWedgeSupportY(wedge, pos.x, pos.z, radius);
  if (allowVerticalSupport && supportY != null) {
    const snapWindow = groundSnapDistance * 1.5;
    const landedFromAbove = previousCapsuleMinY >= supportY - FACE_CONTACT_EPSILON
      && pos.y <= supportY + FACE_CONTACT_EPSILON
      && vel.y <= 0;
    const closeToSurface = pos.y >= supportY - snapWindow && pos.y <= supportY + snapWindow && vel.y <= 0.01;
    const stepOntoSurface = state.grounded
      && supportY - pos.y > 0.0001
      && supportY - pos.y <= PHYSICS.maxStepHeight;
    if (landedFromAbove || closeToSurface || stepOntoSurface) {
      pos.y = supportY;
      if (vel) vel.y = Math.max(vel.y, 0);
      resolved = true;
    }
  }

  const ceilingY = sampleWedgeCeilingY(wedge, pos.x, pos.z, radius);
  if (ceilingY != null) {
    const hitFromBelow = previousCapsuleMaxY <= ceilingY + FACE_CONTACT_EPSILON
      && capsuleMaxY >= ceilingY - FACE_CONTACT_EPSILON
      && vel.y >= 0;
    if (hitFromBelow) {
      pos.y = ceilingY - height;
      if (vel) vel.y = Math.min(vel.y, 0);
      resolved = true;
    }
  }

  return resolved;
}

export function resolveAgainstBox(state, box, radius, height, previousPosition = null, options = {}) {
  const { position: pos, velocity: vel } = state;
  const allowVerticalSupport = options.allowVerticalSupport !== false;
  const capsuleMinY = pos.y;
  const capsuleMaxY = pos.y + height;
  const previousX = previousPosition?.x ?? pos.x;
  const previousZ = previousPosition?.z ?? pos.z;
  const previousCapsuleMinY = previousPosition?.y ?? capsuleMinY;
  const previousCapsuleMaxY = previousCapsuleMinY + height;

  // Early-out when capsule is entirely above or below the box
  if (capsuleMaxY < box.min.y || capsuleMinY > box.max.y) {
    return false;
  }

  const expandedMinX = box.min.x - radius;
  const expandedMaxX = box.max.x + radius;
  const expandedMinZ = box.min.z - radius;
  const expandedMaxZ = box.max.z + radius;

  const insideXEarly = pos.x >= expandedMinX && pos.x <= expandedMaxX;
  const insideZEarly = pos.z >= expandedMinZ && pos.z <= expandedMaxZ;
  // Before swept AABB face clamps, prefer stepping onto a short lip (swept often wins with tiny distX).
  if (allowVerticalSupport && insideXEarly && insideZEarly && state.grounded) {
    const ledgeUp = box.max.y - capsuleMinY;
    if (ledgeUp > 0.0001 && ledgeUp <= PHYSICS.maxStepHeight
      && capsuleMaxY >= box.min.y && capsuleMinY <= box.max.y) {
      pos.y = box.max.y;
      if (vel) vel.y = Math.max(vel.y, 0);
      return true;
    }
  }

  const ySweepOverlaps = Math.max(previousCapsuleMinY, capsuleMinY) <= box.max.y + FACE_CONTACT_EPSILON
    && Math.min(previousCapsuleMaxY, capsuleMaxY) >= box.min.y - FACE_CONTACT_EPSILON;
  const sweptAcrossZ = Math.max(previousZ, pos.z) >= expandedMinZ - FACE_CONTACT_EPSILON
    && Math.min(previousZ, pos.z) <= expandedMaxZ + FACE_CONTACT_EPSILON;
  const sweptAcrossX = Math.max(previousX, pos.x) >= expandedMinX - FACE_CONTACT_EPSILON
    && Math.min(previousX, pos.x) <= expandedMaxX + FACE_CONTACT_EPSILON;

  if (ySweepOverlaps) {
    if (previousX < box.min.x - FACE_CONTACT_EPSILON && pos.x >= box.min.x - FACE_CONTACT_EPSILON && sweptAcrossZ) {
      pos.x = expandedMinX;
      if (vel) vel.x = Math.min(vel.x, 0);
      return true;
    }

    if (previousX > box.max.x + FACE_CONTACT_EPSILON && pos.x <= box.max.x + FACE_CONTACT_EPSILON && sweptAcrossZ) {
      pos.x = expandedMaxX;
      if (vel) vel.x = Math.max(vel.x, 0);
      return true;
    }

    if (previousZ < box.min.z - FACE_CONTACT_EPSILON && pos.z >= box.min.z - FACE_CONTACT_EPSILON && sweptAcrossX) {
      pos.z = expandedMinZ;
      if (vel) vel.z = Math.min(vel.z, 0);
      return true;
    }

    if (previousZ > box.max.z + FACE_CONTACT_EPSILON && pos.z <= box.max.z + FACE_CONTACT_EPSILON && sweptAcrossX) {
      pos.z = expandedMaxZ;
      if (vel) vel.z = Math.max(vel.z, 0);
      return true;
    }
  }

  const insideX = pos.x >= expandedMinX && pos.x <= expandedMaxX;
  const insideZ = pos.z >= expandedMinZ && pos.z <= expandedMaxZ;
  if (!insideX || !insideZ) {
    return false;
  }

  const landedFromAbove = previousCapsuleMinY >= box.max.y - FACE_CONTACT_EPSILON
    && capsuleMinY <= box.max.y + FACE_CONTACT_EPSILON
    && vel.y <= 0;
  if (allowVerticalSupport && landedFromAbove) {
    pos.y = box.max.y;
    if (vel) vel.y = Math.max(vel.y, 0);
    return true;
  }

  const hitFromBelow = previousCapsuleMaxY <= box.min.y + FACE_CONTACT_EPSILON
    && capsuleMaxY >= box.min.y - FACE_CONTACT_EPSILON
    && vel.y >= 0;
  if (hitFromBelow) {
    pos.y = box.min.y - height;
    if (vel) vel.y = Math.min(vel.y, 0);
    return true;
  }

  // --- Penetration depths for all 6 faces ---
  const distLeft = pos.x - expandedMinX;
  const distRight = expandedMaxX - pos.x;
  const distBack = pos.z - expandedMinZ;
  const distFront = expandedMaxZ - pos.z;

  // Y-axis penetration depths (using raw capsule bottom/top vs box faces)
  const distUp = box.max.y - capsuleMinY;   // push player up (landed from above)
  const distDown = capsuleMaxY - box.min.y; // push player down (hit ceiling)

  const minDist = Math.min(distLeft, distRight, distBack, distFront, distUp, distDown);

  if (allowVerticalSupport && minDist === distUp && distUp >= 0) {
    // Player entered from above — push up to stand on top of the box
    pos.y = box.max.y;
    if (vel) vel.y = Math.max(vel.y, 0);
  } else if (minDist === distDown && distDown >= 0) {
    // Player hit the bottom of the box (ceiling) — push down
    pos.y = box.min.y - height;
    if (vel) vel.y = Math.min(vel.y, 0);
  } else if (minDist === distLeft) {
    pos.x = expandedMinX;
    if (vel) vel.x = Math.min(vel.x, 0);
  } else if (minDist === distRight) {
    pos.x = expandedMaxX;
    if (vel) vel.x = Math.max(vel.x, 0);
  } else if (minDist === distBack) {
    pos.z = expandedMinZ;
    if (vel) vel.z = Math.min(vel.z, 0);
  } else {
    pos.z = expandedMaxZ;
    if (vel) vel.z = Math.max(vel.z, 0);
  }

  return true;
}

export function findNearbyWallContact(state, colliders, radius, height, probeDistance) {
  const footY = state.position.y + 0.02;
  const headY = state.position.y + height - 0.02;
  let bestContact = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const collider of colliders ?? []) {
    if (!isWallCollider(collider)) continue;

    const box = getColliderBox(collider);
    if (!box) continue;
    if (headY < box.min.y || footY > box.max.y) continue;

    const expandedMinX = box.min.x - radius;
    const expandedMaxX = box.max.x + radius;
    const expandedMinZ = box.min.z - radius;
    const expandedMaxZ = box.max.z + radius;
    const withinX = state.position.x >= expandedMinX - probeDistance
      && state.position.x <= expandedMaxX + probeDistance;
    const withinZ = state.position.z >= expandedMinZ - probeDistance
      && state.position.z <= expandedMaxZ + probeDistance;

    if (withinZ) {
      const distMinX = Math.abs(state.position.x - expandedMinX);
      if (distMinX <= probeDistance && distMinX < bestDistance) {
        bestDistance = distMinX;
        bestContact = {
          axis: 'x',
          clampValue: expandedMinX,
          normalX: -1,
          normalZ: 0,
        };
      }

      const distMaxX = Math.abs(state.position.x - expandedMaxX);
      if (distMaxX <= probeDistance && distMaxX < bestDistance) {
        bestDistance = distMaxX;
        bestContact = {
          axis: 'x',
          clampValue: expandedMaxX,
          normalX: 1,
          normalZ: 0,
        };
      }
    }

    if (withinX) {
      const distMinZ = Math.abs(state.position.z - expandedMinZ);
      if (distMinZ <= probeDistance && distMinZ < bestDistance) {
        bestDistance = distMinZ;
        bestContact = {
          axis: 'z',
          clampValue: expandedMinZ,
          normalX: 0,
          normalZ: -1,
        };
      }

      const distMaxZ = Math.abs(state.position.z - expandedMaxZ);
      if (distMaxZ <= probeDistance && distMaxZ < bestDistance) {
        bestDistance = distMaxZ;
        bestContact = {
          axis: 'z',
          clampValue: expandedMaxZ,
          normalX: 0,
          normalZ: 1,
        };
      }
    }
  }

  return bestContact;
}

export function applyWallHold(state, wallContact) {
  if (!wallContact) return false;

  if (wallContact.axis === 'x') {
    state.position.x = wallContact.clampValue;
    state.velocity.x = 0;
  } else {
    state.position.z = wallContact.clampValue;
    state.velocity.z = 0;
  }

  state.velocity.y = 0;
  state.grounded = false;
  state.wallHolding = true;
  state.wallNormalX = wallContact.normalX;
  state.wallNormalZ = wallContact.normalZ;
  state.wallJumpWindowTimer = PHYSICS.wallJumpWindow;
  return true;
}

function resolvePlayerCollisions(state, colliders, options) {
  const { radius, height, groundSnapDistance, baseGroundY = 0, previousPosition = null } = options;
  const ordered = sortCollidersForPlaneZIndex(colliders);

  // Auto step-up: if the player is walking into a short ledge, step up onto it
  // instead of being blocked horizontally. Only applies when grounded and
  // the obstacle is short enough relative to current foot position.
  for (const collider of ordered) {
    if (getWedgeDescriptor(collider)) {
      resolveAgainstWedge(state, collider, radius, height, previousPosition, {
        allowVerticalSupport: !isNonWalkableCollider(collider),
        groundSnapDistance,
      });
      continue;
    }

    const box = getColliderBox(collider);
    if (!box) continue;

    // Step-up must run before datum-floor skip; otherwise surfaces within the old ±5 cm band
    // never got step-up or resolve (mats / low platforms).
    if (tryAutoStepUp(state, collider, { radius, height, grounded: state.grounded })) {
      continue;
    }

    if (shouldSkipSurfaceCollider(collider, baseGroundY)) continue;

    resolveAgainstBox(state, box, radius, height, previousPosition, {
      allowVerticalSupport: !isNonWalkableCollider(collider),
    });
  }

  const supportY = getSupportHeight(state, colliders, radius, groundSnapDistance, baseGroundY);
  if (state.position.y <= supportY) {
    state.position.y = supportY;
    state.velocity.y = 0;
    state.grounded = true;
    state.canDoubleJump = false;
    state.hasDoubleJumped = false;
  } else {
    state.grounded = false;
  }
}

export function respawnPlayer(state, spawnX, spawnZ, spawnY = 0) {
  state.position.x = spawnX;
  state.position.y = spawnY;
  state.position.z = spawnZ;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.rotation = 0;
  state.grounded = spawnY <= 0.001;
  state.groundedGraceTimer = state.grounded ? PHYSICS.chargedJumpGroundedGraceSeconds : 0;
  state.stamina = PHYSICS.maxStamina;
  state.staminaRegenTimer = 0;
  state.health = PHYSICS.maxHealth;
  state.alive = true;
  state.sprinting = false;
  state.crouching = false;
  state.sliding = false;
  state.slideTimer = 0;
  state.slideCooldownTimer = 0;
  state.slideDirX = 0;
  state.slideDirZ = 0;
  state.canDoubleJump = false;
  state.hasDoubleJumped = false;
  state.wallHolding = false;
  state.wallNormalX = 0;
  state.wallNormalZ = 0;
  state.wallJumpWindowTimer = 0;
  state.wallAttachCooldownTimer = 0;
  state.animState = 'idle';
  state.emote = null;
  state.deathTime = 0;
  state.roombaLaunch = null;
  state.roombaLaunchCooldown = 0;
  state.ropeSwing = null;
  state.grabbedBy = null;
  state.grabbedTarget = null;
  state.grabbedBallId = null;
  state.smackStunTimer = 0;
  state.smackLimpThrowWindowTimer = 0;
  state.limpThrownBounceTimer = 0;
  state.limpBounceHitSeq = 0;
  state.grabCooldown = 0;
  state.smackCooldown = 0;
  state.burnTimer = 0;
  state.burnTickTimer = 0;
  state.extractProgress = 0;
}

/**
 * Simulate one tick of player physics given an input.
 *
 * @param {ReturnType<typeof createPlayerState>} state - mutable player state
 * @param {{
 *   moveX: number, moveZ: number,
 *   sprint: boolean,
 *   jump?: boolean, jumpPressed?: boolean, jumpHeld?: boolean,
 *   crouch: boolean,
 *   rotation: number,
 * }} input - client input for this tick
 * @param {number} dt - delta time in seconds
 * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} bounds - world bounds
 * @param {Array<{ aabb?: { min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }, box?: any, type?: string, metadata?: object }>} colliders
 * @param {{ ax: number, az: number, ay?: number } | null | undefined} [vacuumPull] roomba vacuum acceleration (world space, units/s²); applied after walk input
 */
export function simulateTick(state, input, dt, bounds, colliders = [], vacuumPull = null) {
  if (!state.alive) return;
  if (state.spectator || state.extracted) return;

  if (state.roombaLaunchCooldown > 0) {
    state.roombaLaunchCooldown = Math.max(0, state.roombaLaunchCooldown - dt);
  }
  if (state.smackLimpThrowWindowTimer > 0) {
    state.smackLimpThrowWindowTimer = Math.max(0, state.smackLimpThrowWindowTimer - dt);
  }
  if (state.limpThrownBounceTimer > 0) {
    state.limpThrownBounceTimer = Math.max(0, state.limpThrownBounceTimer - dt);
    state.wallHolding = false;
    state.wallJumpWindowTimer = 0;
  }

  if (state.roombaLaunch?.phase === 'suck' || state.roombaLaunch?.phase === 'flight') {
    state.animState = state.roombaLaunch.phase === 'suck' ? 'slide' : 'jump';
    return;
  }

  if (state.ropeSwing) {
    state.animState = 'jump';
    return;
  }

  const { position: pos, velocity: vel } = state;
  const collisionConfig = getPlayerCollisionConfig(state);
  const jumpHeld = !!(input.jumpHeld ?? input.jump);
  const jumpPressed = !!(input.jumpPressed ?? input.jump);
  const jumpCharge = Math.max(0, Math.min(1, Number(input.jumpCharge) || 0));
  const previousPosition = {
    x: pos.x,
    y: pos.y,
    z: pos.z,
  };

  state.wallJumpWindowTimer = Math.max(0, state.wallJumpWindowTimer - dt);
  state.wallAttachCooldownTimer = Math.max(0, state.wallAttachCooldownTimer - dt);
  state.groundedGraceTimer = state.grounded
    ? PHYSICS.chargedJumpGroundedGraceSeconds
    : Math.max(0, (Number(state.groundedGraceTimer) || 0) - dt);
  if (state.grounded) {
    state.wallHolding = false;
  } else if (state.wallHolding && !jumpHeld) {
    state.wallHolding = false;
  }

  // --- Movement speed ---
  let speed = PHYSICS.walkSpeed;
  if (state.crouching && !state.sliding) speed = PHYSICS.crouchSpeed;

  state.sprinting = false;
  const hasInput = Math.abs(input.moveX) > 0.01 || Math.abs(input.moveZ) > 0.01;
  if (input.sprint && state.stamina > 0 && !state.crouching && hasInput) {
    state.sprinting = true;
    speed = PHYSICS.sprintSpeed;
  }
  // Hero identity: each hero gets a small, readable movement signature.
  speed *= heroSpeedMultiplier(state);
  if (state.isAdversary && state.adversaryRole === 'human') {
    speed *= PHYSICS.adversaryHumanSpeedMult;
  }

  // --- Horizontal velocity (unless sliding) ---
  // Use an exponential-approach accel/decel model so ground movement feels snappy
  // but air / wall-run preserves momentum for a parkour feel.
  if (!state.sliding) {
    const targetVX = input.moveX * speed;
    const targetVZ = input.moveZ * speed;
    let accel;
    if (state.wallHolding) {
      accel = PHYSICS.wallAccel;
    } else if (state.grounded) {
      accel = hasInput ? PHYSICS.groundAccel : PHYSICS.groundDecel;
    } else {
      accel = hasInput ? PHYSICS.airAccel : PHYSICS.airDecel;
    }
    const blend = 1 - Math.exp(-accel * dt);
    vel.x += (targetVX - vel.x) * blend;
    vel.z += (targetVZ - vel.z) * blend;
  }

  if (!state.sliding && vacuumPull && typeof vacuumPull.ax === 'number' && typeof vacuumPull.az === 'number') {
    vel.x += vacuumPull.ax * dt;
    vel.z += vacuumPull.az * dt;
    if (typeof vacuumPull.ay === 'number' && vacuumPull.ay !== 0) {
      vel.y += vacuumPull.ay * dt;
      if (state.grounded && vacuumPull.ay > 2) state.grounded = false;
    }
  }

  // --- Jump ---
  if (jumpPressed) {
    const heroJumpMult = heroJumpMultiplier(state);
    const chargedGroundGrace = jumpCharge > 0 && state.groundedGraceTimer > 0;
    if (state.grounded || chargedGroundGrace) {
      const chargeMult = 1 + jumpCharge * (PHYSICS.chargedJumpMaxMultiplier - 1);
      vel.y = PHYSICS.jumpForce * heroJumpMult * chargeMult;
      state.grounded = false;
      state.groundedGraceTimer = 0;
      state.canDoubleJump = true;
      state.hasDoubleJumped = false;
      state.wallHolding = false;
      state.wallJumpWindowTimer = 0;
    } else if (state.wallJumpWindowTimer > 0 && (state.wallNormalX !== 0 || state.wallNormalZ !== 0)) {
      vel.x = state.wallNormalX * PHYSICS.wallJumpAwayForce;
      vel.z = state.wallNormalZ * PHYSICS.wallJumpAwayForce;
      vel.y = PHYSICS.wallJumpForce * heroJumpMult;
      state.grounded = false;
      state.wallHolding = false;
      state.wallJumpWindowTimer = 0;
      state.wallAttachCooldownTimer = PHYSICS.wallAttachCooldown;
    } else if (state.canDoubleJump && !state.hasDoubleJumped) {
      vel.y = PHYSICS.doubleJumpForce;
      state.hasDoubleJumped = true;
      state.canDoubleJump = false;
    }
  }

  // --- Crouch / Slide ---
  if (input.crouch) {
    if (!state.crouching && state.grounded) {
      state.crouching = true;
      const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (hSpeed > PHYSICS.walkSpeed * 0.8 && state.slideCooldownTimer <= 0) {
        const len = hasInput ? Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ) : 1;
        state.slideDirX = hasInput ? input.moveX / len : 0;
        state.slideDirZ = hasInput ? input.moveZ / len : 1;
        state.sliding = true;
        state.slideTimer = PHYSICS.slideDuration;
        state.slideCooldownTimer = PHYSICS.slideCooldown;
        const slideSpd = Math.max(hSpeed, PHYSICS.slideSpeed);
        vel.x = state.slideDirX * slideSpd;
        vel.z = state.slideDirZ * slideSpd;
      }
    }
  } else if (state.crouching && !state.sliding) {
    state.crouching = false;
  }

  // --- Slide decay ---
  if (state.slideCooldownTimer > 0) state.slideCooldownTimer -= dt;
  if (state.sliding) {
    state.slideTimer -= dt;
    if (state.slideTimer <= 0) {
      state.sliding = false;
      state.crouching = false;
    } else {
      const t = state.slideTimer / PHYSICS.slideDuration;
      const spd = PHYSICS.slideSpeed * t;
      vel.x = state.slideDirX * spd;
      vel.z = state.slideDirZ * spd;
    }
  }

  // --- Gravity ---
  if (!state.grounded && !state.wallHolding) {
    vel.y += PHYSICS.gravity * dt;
  }

  // --- Integrate ---
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;

  // --- Room collisions / ground support ---
  if (colliders?.length) {
    resolvePlayerCollisions(state, colliders, {
      radius: collisionConfig.radius,
      height: collisionConfig.height,
      groundSnapDistance: PHYSICS.groundSnapDistance,
      baseGroundY: 0,
      previousPosition,
    });
  } else if (pos.y <= 0) {
    // --- Ground check fallback ---
    // Ground is y=0 in world space; visual ground offset is applied client-side per mouse model.
    pos.y = 0;
    vel.y = 0;
    state.grounded = true;
    state.canDoubleJump = false;
    state.hasDoubleJumped = false;
  } else {
    state.grounded = false;
  }

  if (state.grounded) {
    state.wallHolding = false;
    state.wallNormalX = 0;
    state.wallNormalZ = 0;
    state.wallJumpWindowTimer = 0;
  } else if (
    jumpHeld
    && state.wallAttachCooldownTimer <= 0
    && (Number(state.limpThrownBounceTimer) || 0) <= 0
    && colliders?.length
  ) {
    const wallContact = findNearbyWallContact(
      state,
      colliders,
      collisionConfig.radius,
      collisionConfig.height,
      PHYSICS.wallProbeDistance,
    );
    if (wallContact) {
      applyWallHold(state, wallContact);
      // --- Wall climb: pressing into the wall with movement input while holding jump lifts the
      // player up the surface, consuming stamina. Enables jumping UP walls, not just along them.
      const into = -(input.moveX * state.wallNormalX + input.moveZ * state.wallNormalZ);
      if (hasInput && into > 0.2 && state.stamina > 0) {
        vel.y = PHYSICS.wallClimbSpeed;
        state.stamina = Math.max(0, state.stamina - PHYSICS.wallClimbStaminaDrain * dt);
        state.staminaRegenTimer = PHYSICS.staminaRegenDelay;
      }
    } else {
      state.wallHolding = false;
    }
  } else {
    state.wallHolding = false;
  }

  // --- World bounds ---
  if (bounds) {
    const r = collisionConfig.radius;
    if (pos.x < bounds.minX + r) { pos.x = bounds.minX + r; vel.x = Math.max(vel.x, 0); }
    if (pos.x > bounds.maxX - r) { pos.x = bounds.maxX - r; vel.x = Math.min(vel.x, 0); }
    if (pos.z < bounds.minZ + r) { pos.z = bounds.minZ + r; vel.z = Math.max(vel.z, 0); }
    if (pos.z > bounds.maxZ - r) { pos.z = bounds.maxZ - r; vel.z = Math.min(vel.z, 0); }
  }

  // --- Rotation ---
  if (input.rotation !== undefined) {
    state.rotation = input.rotation;
  }

  // --- Stamina ---
  if (state.sprinting) {
    state.stamina -= PHYSICS.staminaDrainRate * dt;
    state.staminaRegenTimer = PHYSICS.staminaRegenDelay;
    if (state.stamina <= 0) {
      state.stamina = 0;
      state.sprinting = false;
    }
  } else {
    state.staminaRegenTimer -= dt;
    if (state.staminaRegenTimer <= 0) {
      state.stamina = Math.min(state.stamina + PHYSICS.staminaRegenRate * dt, PHYSICS.maxStamina);
    }
  }

  // --- Wall-hold anim grace timer ---
  if (state.wallHolding) {
    state.wallAnimGraceTimer = 0.18;
  } else {
    state.wallAnimGraceTimer = Math.max(0, (state.wallAnimGraceTimer ?? 0) - dt);
  }

  // --- Animation state ---
  if (!state.alive) {
    state.animState = 'death';
  } else if (state.wallHolding || (state.wallAnimGraceTimer > 0 && jumpHeld && !state.grounded)) {
    // Wall-run: play walk whenever the player has movement input (including pressing into the wall,
    // which applyWallHold zeroes out). Falls back to tangential speed for non-input drift.
    // Grace window smooths over brief wall-contact drops (edges, gaps) so anim doesn't flicker to jump.
    const tangentialSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    state.animState = (hasInput || tangentialSpeed > 0.5) ? 'walk' : 'idle';
  } else if (!state.grounded) {
    state.animState = 'jump';
  } else if (state.sprinting || state.sliding) {
    state.animState = 'run';
  } else {
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    state.animState = hSpeed > 0.5 ? 'walk' : 'idle';
  }
}
