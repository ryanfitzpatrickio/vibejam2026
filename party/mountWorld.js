import {
  getColliderBox,
  resolveAgainstBox,
  shouldSkipSurfaceCollider,
  sortCollidersForPlaneZIndex,
  tryAutoStepUp,
} from '../shared/physics.js';
import {
  sampleWedgeCeilingY,
  sampleWedgeSupportY,
} from '../shared/wedgeCollision.js';

const DEFAULT_RIDER_OFFSET = Object.freeze({ x: 0, y: 0.42, z: 0.12 });
const DEFAULT_GRAB_OFFSET = Object.freeze({ x: 0, y: -0.38, z: 0.24 });
const ROUND_END_DISMOUNT_SIDE_OFFSET = 0.72;
const ROUND_END_DISMOUNT_BACK_OFFSET = 0.18;
const ROUND_END_JUMP_SPEED = 6.8;
const ROUND_END_BIRD_JUMP_SPEED = 7.4;
const ROUND_END_GRAVITY = -18;
const DEFAULT_SOCKET_NAME = 'spine';
const INTERACT_RANGE = 1.45;
const WALK_SPEED = 3.6;
const FLIGHT_SPEED = 6.2;
const ASCEND_SPEED = 3.9;
const DESCEND_SPEED = 3.7;
const GLIDE_DROP_SPEED = 0.45;
const LEDGE_DROP_SPEED = 5.2;
const TAKEOFF_SPEED = 3.4;
const MIN_FLIGHT_HEIGHT = 0.45;
const MAX_FLIGHT_HEIGHT = 38;
const MOUNT_RADIUS = 0.42;
const MOUNT_HEIGHT = 0.9;
const MOUNT_GROUND_SNAP_DISTANCE = 0.18;
const MOUNT_LEDGE_DROP_FLIGHT_GRACE = 0.08;
const MOUNT_FLOOR_PROBE_DISTANCE = 0.32;
const MOUNT_FLOOR_PROBE_EPSILON = 0.025;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function vectorFrom(value, fallback) {
  return {
    x: finiteNumber(Number(value?.x), fallback.x),
    y: finiteNumber(Number(value?.y), fallback.y),
    z: finiteNumber(Number(value?.z), fallback.z),
  };
}

function rotateOffset(offset, yaw) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: offset.x * cos + offset.z * sin,
    y: offset.y,
    z: -offset.x * sin + offset.z * cos,
  };
}

function yawQuaternion(yaw) {
  const half = yaw * 0.5;
  return {
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  };
}

function clampBounds(position, bounds) {
  if (!bounds) return;
  if (Number.isFinite(bounds.minX)) position.x = Math.max(bounds.minX, position.x);
  if (Number.isFinite(bounds.maxX)) position.x = Math.min(bounds.maxX, position.x);
  if (Number.isFinite(bounds.minZ)) position.z = Math.max(bounds.minZ, position.z);
  if (Number.isFinite(bounds.maxZ)) position.z = Math.min(bounds.maxZ, position.z);
}

function getMountSupportHeight(mount, colliders, baseGroundY = 0) {
  let supportY = baseGroundY;
  let foundSupport = false;

  for (const collider of colliders ?? []) {
    const wedge = collider?.metadata?.wedge;
    if (wedge) {
      if (collider?.metadata?.nonWalkable === true) continue;
      const wedgeY = sampleWedgeSupportY(wedge, mount.position.x, mount.position.z, MOUNT_RADIUS);
      if (wedgeY == null) continue;
      const snapWindow = (collider.type === 'surface' || collider.metadata?.runnable)
        ? MOUNT_GROUND_SNAP_DISTANCE
        : MOUNT_GROUND_SNAP_DISTANCE * 1.5;
      if (mount.position.y >= wedgeY - snapWindow && mount.velocity.y <= 0.01) {
        supportY = Math.max(supportY, wedgeY);
        foundSupport = true;
      }
      continue;
    }

    const box = getColliderBox(collider);
    if (!box) continue;

    const withinX = mount.position.x >= box.min.x - MOUNT_RADIUS && mount.position.x <= box.max.x + MOUNT_RADIUS;
    const withinZ = mount.position.z >= box.min.z - MOUNT_RADIUS && mount.position.z <= box.max.z + MOUNT_RADIUS;
    if (!withinX || !withinZ) continue;
    if (collider?.metadata?.nonWalkable === true) continue;

    const surfaceY = box.max.y;
    const snapWindow = (collider.type === 'surface' || collider.metadata?.runnable)
      ? MOUNT_GROUND_SNAP_DISTANCE
      : MOUNT_GROUND_SNAP_DISTANCE * 1.5;

    if (mount.position.y >= surfaceY - snapWindow && mount.velocity.y <= 0.01) {
      supportY = Math.max(supportY, surfaceY);
      foundSupport = true;
    }
  }

  if (!foundSupport && mount.position.y <= baseGroundY + MOUNT_GROUND_SNAP_DISTANCE && mount.velocity.y <= 0.01) {
    supportY = baseGroundY;
    foundSupport = true;
  }

  return { supportY, foundSupport };
}

function probeMountFloorBelow(mount, colliders, maxDistance = MOUNT_FLOOR_PROBE_DISTANCE, baseGroundY = 0) {
  let supportY = baseGroundY;
  let foundSupport = false;
  const probeBottom = mount.position.y - Math.max(0, maxDistance);

  for (const collider of colliders ?? []) {
    if (collider?.metadata?.nonWalkable === true) continue;
    const wedge = collider?.metadata?.wedge;
    if (wedge) {
      const wedgeY = sampleWedgeSupportY(wedge, mount.position.x, mount.position.z, MOUNT_RADIUS);
      if (wedgeY != null && wedgeY <= mount.position.y + MOUNT_GROUND_SNAP_DISTANCE && wedgeY >= probeBottom) {
        supportY = Math.max(supportY, wedgeY);
        foundSupport = true;
      }
      continue;
    }

    const box = getColliderBox(collider);
    if (!box) continue;

    const withinX = mount.position.x >= box.min.x + MOUNT_FLOOR_PROBE_EPSILON
      && mount.position.x <= box.max.x - MOUNT_FLOOR_PROBE_EPSILON;
    const withinZ = mount.position.z >= box.min.z + MOUNT_FLOOR_PROBE_EPSILON
      && mount.position.z <= box.max.z - MOUNT_FLOOR_PROBE_EPSILON;
    if (!withinX || !withinZ) continue;

    const surfaceY = box.max.y;
    if (surfaceY <= mount.position.y + MOUNT_GROUND_SNAP_DISTANCE && surfaceY >= probeBottom) {
      supportY = Math.max(supportY, surfaceY);
      foundSupport = true;
    }
  }

  if (!foundSupport && baseGroundY <= mount.position.y + MOUNT_GROUND_SNAP_DISTANCE && baseGroundY >= probeBottom) {
    supportY = baseGroundY;
    foundSupport = true;
  }

  return { supportY, foundSupport };
}

function resolveMountCollisions(mount, colliders, previousPosition, options = {}) {
  const ordered = sortCollidersForPlaneZIndex(colliders);
  const allowVerticalSupport = options.allowVerticalSupport !== false;

  for (const collider of ordered) {
    const wedge = collider?.metadata?.wedge;
    if (wedge) {
      const supportY = sampleWedgeSupportY(wedge, mount.position.x, mount.position.z, MOUNT_RADIUS);
      if (allowVerticalSupport && supportY != null) {
        const landedFromAbove = (previousPosition?.y ?? mount.position.y) >= supportY - 0.001
          && mount.position.y <= supportY + 0.001
          && mount.velocity.y <= 0;
        const closeToSurface = mount.position.y >= supportY - MOUNT_GROUND_SNAP_DISTANCE * 1.5
          && mount.position.y <= supportY + MOUNT_GROUND_SNAP_DISTANCE * 1.5
          && mount.velocity.y <= 0.01;
        if (landedFromAbove || closeToSurface) {
          mount.position.y = supportY;
          mount.velocity.y = Math.max(mount.velocity.y, 0);
          continue;
        }
      }

      const ceilingY = sampleWedgeCeilingY(wedge, mount.position.x, mount.position.z, MOUNT_RADIUS);
      if (ceilingY != null) {
        const previousTop = (previousPosition?.y ?? mount.position.y) + MOUNT_HEIGHT;
        const currentTop = mount.position.y + MOUNT_HEIGHT;
        if (previousTop <= ceilingY + 0.001 && currentTop >= ceilingY - 0.001 && mount.velocity.y >= 0) {
          mount.position.y = ceilingY - MOUNT_HEIGHT;
          mount.velocity.y = Math.min(mount.velocity.y, 0);
          continue;
        }
      }
      continue;
    }

    const box = getColliderBox(collider);
    if (!box) continue;

    if (tryAutoStepUp(mount, collider, {
      radius: MOUNT_RADIUS,
      height: MOUNT_HEIGHT,
      grounded: mount.grounded,
    })) {
      continue;
    }

    if (shouldSkipSurfaceCollider(collider, mount.groundY)) continue;

    resolveAgainstBox(mount, box, MOUNT_RADIUS, MOUNT_HEIGHT, previousPosition, {
      allowVerticalSupport: allowVerticalSupport && collider?.metadata?.nonWalkable !== true,
    });
  }

  return getMountSupportHeight(mount, colliders);
}

function normalizeMove(input) {
  const x = finiteNumber(Number(input?.moveX), 0);
  const z = finiteNumber(Number(input?.moveZ), 0);
  const len = Math.hypot(x, z);
  if (len <= 1) return { x, z, len };
  return { x: x / len, z: z / len, len: 1 };
}

function mountFromPrimitive(primitive) {
  if (!primitive?.id || primitive?.type !== 'glb' || primitive.mount !== true || !primitive.glbAssetId) return null;
  const scale = primitive.scale ?? { x: 1, y: 1, z: 1 };
  const groundY = finiteNumber(Number(primitive.position?.y), 0);
  return {
    id: primitive.id,
    name: primitive.name ?? primitive.id,
    glbAssetId: primitive.glbAssetId,
    mountKind: primitive.mountKind ?? 'love-bird',
    socketName: primitive.mountSocketName || DEFAULT_SOCKET_NAME,
    riderOffset: vectorFrom(primitive.mountRiderOffset, DEFAULT_RIDER_OFFSET),
    grabOffset: vectorFrom(primitive.mountGrabOffset, DEFAULT_GRAB_OFFSET),
    scale: vectorFrom(scale, { x: 1, y: 1, z: 1 }),
    position: {
      x: finiteNumber(Number(primitive.position?.x), 0),
      y: groundY,
      z: finiteNumber(Number(primitive.position?.z), 0),
    },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: finiteNumber(Number(primitive.rotation?.y), 0),
    groundY,
    riderId: null,
    grounded: true,
    flying: false,
    animState: 'idle',
  };
}

function applyRiderPose(mount, state) {
  const rider = rotateOffset(mount.riderOffset, mount.rotation);
  state.position.x = mount.position.x + rider.x;
  state.position.y = mount.position.y + rider.y;
  state.position.z = mount.position.z + rider.z;
  state.velocity.x = mount.velocity.x;
  state.velocity.y = mount.velocity.y;
  state.velocity.z = mount.velocity.z;
  state.rotation = mount.rotation;
  state.grounded = mount.grounded;
  state.sprinting = false;
  state.crouching = false;
  state.sliding = false;
  state.wallHolding = false;
  state.ropeSwing = null;
  state.mountId = mount.id;
  state.animState = 'sit';
}

export function createMountWorld() {
  const mounts = new Map();
  const playerToMount = new Map();

  function clearPlayer(playerId, state = null) {
    const mountId = playerToMount.get(playerId) ?? state?.mountId;
    const mount = mountId ? mounts.get(mountId) : null;
    if (mount?.riderId === playerId) mount.riderId = null;
    playerToMount.delete(playerId);
    if (state) {
      state.mountId = null;
      state._mountDismountHoldSeconds = 0;
      state._suppressMountReleaseSmack = false;
    }
  }

  function setMounts(layout, { preserveExisting = true } = {}) {
    const next = new Map();
    const primitives = Array.isArray(layout?.primitives) ? layout.primitives : [];
    for (const primitive of primitives) {
      const nextMount = mountFromPrimitive(primitive);
      if (!nextMount) continue;
      const existing = mounts.get(nextMount.id);
      if (preserveExisting && existing) {
        nextMount.position = existing.position;
        nextMount.velocity = existing.velocity;
        nextMount.rotation = existing.rotation;
        nextMount.riderId = existing.riderId;
        nextMount.grounded = existing.grounded;
        nextMount.flying = existing.flying;
        nextMount.animState = existing.animState;
      }
      next.set(nextMount.id, nextMount);
    }

    if (preserveExisting) {
      for (const [playerId, mountId] of playerToMount) {
        if (!next.has(mountId)) playerToMount.delete(playerId);
      }
    } else {
      playerToMount.clear();
    }
    mounts.clear();
    for (const [id, mount] of next) mounts.set(id, mount);
  }

  function resetRound(layout) {
    setMounts(layout, { preserveExisting: false });
  }

  function tryMountNearest(playerId, state) {
    if (!state?.alive || state.extracted || state.spectator || state.isAdversary || state.mountId) return false;
    let best = null;
    let bestDist = INTERACT_RANGE;
    for (const mount of mounts.values()) {
      if (mount.riderId) continue;
      const dx = mount.position.x - state.position.x;
      const dz = mount.position.z - state.position.z;
      const dy = Math.abs(mount.position.y - state.position.y);
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist && dy <= 1.6) {
        best = mount;
        bestDist = dist;
      }
    }
    if (!best) return false;

    clearPlayer(playerId, state);
    best.riderId = playerId;
    playerToMount.set(playerId, best.id);
    best.rotation = state.rotation ?? best.rotation;
    state.mountId = best.id;
    state._mountDismountHoldSeconds = 0;
    state._suppressMountReleaseSmack = true;
    state._chargedSmackHoldSeconds = 0;
    state._chargedThrowHoldSeconds = 0;
    applyRiderPose(best, state);
    return true;
  }

  function dismount(playerId, state, mount) {
    const back = rotateOffset({ x: 0, y: 0, z: -0.9 }, mount.rotation);
    mount.riderId = null;
    playerToMount.delete(playerId);
    state.mountId = null;
    state._mountDismountHoldSeconds = 0;
    state._suppressMountReleaseSmack = false;
    state.position.x = mount.position.x + back.x;
    state.position.y = mount.groundY;
    state.position.z = mount.position.z + back.z;
    state.velocity.x = 0;
    state.velocity.y = 0;
    state.velocity.z = 0;
    state.grounded = true;
    state.animState = 'idle';
  }

  function celebrationDismount(playerId, state) {
    const mountId = state?.mountId ?? playerToMount.get(playerId);
    const mount = mountId ? mounts.get(mountId) : null;
    if (!state || !mount || mount.riderId !== playerId) return false;

    const side = rotateOffset({
      x: ROUND_END_DISMOUNT_SIDE_OFFSET,
      y: 0,
      z: ROUND_END_DISMOUNT_BACK_OFFSET,
    }, mount.rotation);
    mount.riderId = null;
    playerToMount.delete(playerId);

    const landingY = mount.groundY;
    state.mountId = null;
    state._mountDismountHoldSeconds = 0;
    state._suppressMountReleaseSmack = false;
    state.position.x = mount.position.x + side.x;
    state.position.y = landingY + 0.08;
    state.position.z = mount.position.z + side.z;
    state.velocity.x = mount.velocity.x * 0.35;
    state.velocity.y = ROUND_END_JUMP_SPEED;
    state.velocity.z = mount.velocity.z * 0.35;
    state.grounded = false;
    state.wallHolding = false;
    state.ropeSwing = null;
    state.animState = 'jump';
    state._roundEndMountCelebrationTimer = 0.9;
    state._roundEndMountCelebrationGroundY = landingY;

    mount.position.y = Math.max(mount.position.y, landingY + 0.08);
    mount.velocity.x = 0;
    mount.velocity.y = ROUND_END_BIRD_JUMP_SPEED;
    mount.velocity.z = 0;
    mount.grounded = false;
    mount.flying = false;
    mount.animState = 'flap';
    mount._celebrationHop = true;
    return true;
  }

  function stepCelebrations(dt, bounds, colliders = []) {
    for (const mount of mounts.values()) {
      if (!mount._celebrationHop || mount.riderId) continue;
      const previousPosition = { ...mount.position };
      mount.velocity.y += ROUND_END_GRAVITY * dt;
      mount.position.y += mount.velocity.y * dt;
      clampBounds(mount.position, bounds);
      const { supportY } = resolveMountCollisions(mount, colliders, previousPosition);
      if (mount.position.y <= supportY && mount.velocity.y <= 0) {
        mount.position.y = supportY;
        mount.groundY = supportY;
        mount.velocity.x = 0;
        mount.velocity.y = 0;
        mount.velocity.z = 0;
        mount.grounded = true;
        mount.flying = false;
        mount.animState = 'idle';
        mount._celebrationHop = false;
      } else {
        mount.grounded = false;
        mount.flying = false;
        mount.animState = mount.velocity.y > 0 ? 'flap' : 'glide';
      }
    }
  }

  function updateMountedPlayer(playerId, state, input, dt, bounds, colliders = []) {
    const mountId = state?.mountId ?? playerToMount.get(playerId);
    const mount = mountId ? mounts.get(mountId) : null;
    if (!state || !mount || mount.riderId !== playerId) {
      clearPlayer(playerId, state);
      return false;
    }

    if (input?.dismountPressed && !input?.dismountBlocked) {
      dismount(playerId, state, mount);
      return true;
    }

    if (Number.isFinite(input?.rotation)) mount.rotation = input.rotation;
    const move = normalizeMove(input);
    const jumpNow = !!(input?.jumpPressed ?? input?.jump);
    const jumpHeld = !!(input?.jumpHeld || input?.jump);
    const descending = !!input?.crouch;

    if (mount.grounded && jumpNow) {
      mount.grounded = false;
      mount.flying = true;
      mount._ledgeDropUntilGround = false;
      mount.velocity.y = TAKEOFF_SPEED;
      mount.position.y = Math.max(mount.position.y + 0.05, mount.groundY + MIN_FLIGHT_HEIGHT);
    }

    if (mount.flying) {
      const previousPosition = { ...mount.position };
      if (jumpHeld) mount._ledgeDropUntilGround = false;
      mount.velocity.x = move.x * FLIGHT_SPEED;
      mount.velocity.z = move.z * FLIGHT_SPEED;
      mount.velocity.y = jumpHeld
        ? ASCEND_SPEED
        : descending
          ? -DESCEND_SPEED
          : mount._ledgeDropUntilGround
            ? -LEDGE_DROP_SPEED
            : -GLIDE_DROP_SPEED;
      mount.position.x += mount.velocity.x * dt;
      mount.position.y += mount.velocity.y * dt;
      mount.position.z += mount.velocity.z * dt;
      clampBounds(mount.position, bounds);
      const baseGroundY = 0;
      const minFlightY = (descending || mount._ledgeDropUntilGround) ? baseGroundY : baseGroundY + MIN_FLIGHT_HEIGHT;
      mount.position.y = Math.max(minFlightY, Math.min(MAX_FLIGHT_HEIGHT, mount.position.y));
      const { supportY, foundSupport } = resolveMountCollisions(mount, colliders, previousPosition, {
        allowVerticalSupport: false,
      });
      const landingY = supportY;
      if (foundSupport && mount.position.y <= landingY + 0.08 && !jumpHeld) {
        mount.position.y = landingY;
        mount.groundY = landingY;
        mount.velocity.y = 0;
        mount.grounded = true;
        mount.flying = false;
        mount._ledgeDropUntilGround = false;
      } else {
        mount.position.y = Math.min(MAX_FLIGHT_HEIGHT, mount.position.y);
      }
      mount.animState = jumpHeld || move.len > 0.1 ? 'flap' : 'glide';
    } else {
      const previousPosition = { ...mount.position };
      mount.velocity.x = move.x * WALK_SPEED;
      mount.velocity.y = 0;
      mount.velocity.z = move.z * WALK_SPEED;
      mount.position.x += mount.velocity.x * dt;
      mount.position.z += mount.velocity.z * dt;
      mount.position.y = mount.groundY;
      clampBounds(mount.position, bounds);
      const { supportY, foundSupport } = resolveMountCollisions(mount, colliders, previousPosition);
      const floorProbe = probeMountFloorBelow(mount, colliders);
      const walkedOffLedge = !floorProbe.foundSupport
        && mount.position.y <= mount.groundY + MOUNT_LEDGE_DROP_FLIGHT_GRACE;
      if (walkedOffLedge) {
        mount.grounded = false;
        mount.flying = true;
        mount._ledgeDropUntilGround = true;
        mount.groundY = floorProbe.supportY;
        mount.position.y = Math.max(mount.position.y, floorProbe.supportY + MIN_FLIGHT_HEIGHT);
        mount.velocity.y = -LEDGE_DROP_SPEED;
        mount.animState = 'glide';
      } else if (mount.position.y <= supportY) {
        mount.position.y = supportY;
        mount.groundY = supportY;
        mount.velocity.y = 0;
        mount.grounded = true;
        mount.flying = false;
        mount._ledgeDropUntilGround = false;
      }
      if (!mount.flying) mount.animState = move.len > 0.1 ? 'walk' : 'idle';
    }

    applyRiderPose(mount, state);
    return true;
  }

  function getGrabPointForPlayer(playerId, state = null) {
    const mountId = state?.mountId ?? playerToMount.get(playerId);
    const mount = mountId ? mounts.get(mountId) : null;
    if (!mount || mount.riderId !== playerId) return null;
    const offset = rotateOffset(mount.grabOffset, mount.rotation);
    return {
      x: mount.position.x + offset.x,
      y: mount.position.y + offset.y,
      z: mount.position.z + offset.z,
    };
  }

  function getMountsState() {
    return [...mounts.values()].map((mount) => {
      const q = yawQuaternion(mount.rotation);
      return {
        id: mount.id,
        kind: 'mount',
        mountKind: mount.mountKind,
        glbAssetId: mount.glbAssetId,
        riderId: mount.riderId,
        x: mount.position.x,
        y: mount.position.y,
        z: mount.position.z,
        ...q,
        sx: mount.scale.x,
        sy: mount.scale.y,
        sz: mount.scale.z,
        rotation: mount.rotation,
        grounded: mount.grounded,
        flying: mount.flying,
        animState: mount.animState,
        socketName: mount.socketName,
      };
    });
  }

  return {
    celebrationDismount,
    clearPlayer,
    getGrabPointForPlayer,
    getMountsState,
    resetRound,
    setMounts,
    stepCelebrations,
    tryMountNearest,
    updateMountedPlayer,
  };
}
