/**
 * Server-only cannon-es sphere for mice launched through the roomba (bouncy wall hits).
 * Separate from pushBallWorld so flight uses higher restitution and doesn’t fight the main ball.
 */

import { World, Vec3, Sphere, Box, Body } from 'cannon-es';
import { PHYSICS } from '../shared/physics.js';
import { aabbToStaticBody, shouldSkipLayoutColliderForBall } from './pushBallWorld.js';

const MOUSE_SPHERE_RADIUS = Math.max(0.2, PHYSICS.playerRadius * 1.1);
const MOUSE_MASS = 2.35;
const LAUNCH_HORIZ_SPEED = 7.2;
const LAUNCH_UP_SPEED = 9.4;
const LAUNCH_COOLDOWN_S = 1.75;
const GROUNDED_EXIT_TIME = 0.16;
const MAX_FLIGHT_S = 5.2;
const CENTER_Y_OFFSET = PHYSICS.playerHeight * 0.42;

/**
 * @returns {{
 *   setLevelColliders: (colliders: object[] | null) => void,
 *   startFlight: (playerId: string, state: object, outNx: number, outNz: number, speedScale?: number, options?: object) => void,
 *   step: (dt: number, getPlayerState: (id: string) => object | undefined) => void,
 *   isFlying: (playerId: string) => boolean,
 *   removePlayer: (playerId: string) => void,
 * }}
 */
export function createMouseLaunchWorld() {
  const world = new World({ gravity: new Vec3(0, -22, 0) });
  world.defaultContactMaterial.friction = 0.22;
  world.defaultContactMaterial.restitution = 0.58;

  const groundHalf = new Vec3(52, 0.14, 52);
  const ground = new Body({ mass: 0 });
  ground.addShape(new Box(groundHalf));
  ground.position.set(0, -groundHalf.y, 0);
  world.addBody(ground);

  /** @type {import('cannon-es').Body[]} */
  const levelStaticBodies = [];

  /** @type {Map<string, { body: Body, groundedMs: number, flightTime: number, limp: boolean, limpSeconds: number, pendingBounceHits: number, bounceCooldown: number }>} */
  const flights = new Map();

  function setLevelColliders(colliders) {
    for (const b of levelStaticBodies) world.removeBody(b);
    levelStaticBodies.length = 0;
    if (!Array.isArray(colliders)) return;
    for (const c of colliders) {
      if (shouldSkipLayoutColliderForBall(c)) continue;
      if (c.type !== 'wall' && c.type !== 'furniture' && c.type !== 'surface') continue;
      const body = aabbToStaticBody(c.aabb, c.type);
      world.addBody(body);
      levelStaticBodies.push(body);
    }
  }

  function stripBody(playerId) {
    const entry = flights.get(playerId);
    if (!entry) return;
    world.removeBody(entry.body);
    flights.delete(playerId);
  }

  function finishFlight(playerId, state) {
    stripBody(playerId);
    if (!state) return;
    state.roombaLaunch = null;
    state.roombaLaunchCooldown = LAUNCH_COOLDOWN_S;
    state.position.y = Math.max(0, state.position.y);
    state.velocity.y = 0;
    state.velocity.x *= 0.5;
    state.velocity.z *= 0.5;
    state.grounded = true;
    state.animState = 'idle';
    state.wallHolding = false;
    state.limpThrownBounceTimer = 0;
  }

  /**
   * @param {string} playerId
   * @param {{ position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number}, id?: string }} state
   * @param {number} outNx
   * @param {number} outNz
   */
  function startFlight(playerId, state, outNx, outNz, speedScale = 1, options = null) {
    stripBody(playerId);
    const hLen = Math.hypot(outNx, outNz);
    const nx = hLen > 0.001 ? outNx / hLen : 0;
    const nz = hLen > 0.001 ? outNz / hLen : 1;

    const body = new Body({
      mass: MOUSE_MASS,
      shape: new Sphere(MOUSE_SPHERE_RADIUS),
      linearDamping: 0.035,
      angularDamping: 0.99,
      material: world.defaultContactMaterial,
    });
    body.angularFactor.set(0, 0, 0);

    const cx = state.position.x;
    const cy = state.position.y + CENTER_Y_OFFSET;
    const cz = state.position.z;
    body.position.set(cx, cy, cz);

    const scale = Math.max(0.75, Math.min(5.0, Number(speedScale) || 1));
    const jitter = options?.jitter !== false;
    const upMultiplier = Math.max(0.4, Math.min(2.2, Number(options?.upMultiplier) || 1));
    const hs = LAUNCH_HORIZ_SPEED * scale * (jitter ? (0.9 + Math.random() * 0.22) : 1);
    const up = LAUNCH_UP_SPEED * Math.sqrt(scale) * upMultiplier * (jitter ? (0.85 + Math.random() * 0.35) : 1);
    body.velocity.set(nx * hs, up, nz * hs);

    const limp = !!options?.limp;
    const limpSeconds = Math.max(0, Number(options?.limpSeconds) || 0);
    if (limp) {
      state.limpThrownBounceTimer = Math.max(Number(state.limpThrownBounceTimer) || 0, limpSeconds);
      state.wallHolding = false;
      state.wallJumpWindowTimer = 0;
    }

    const entry = {
      body,
      groundedMs: 0,
      flightTime: 0,
      limp,
      limpSeconds,
      pendingBounceHits: 0,
      bounceCooldown: 0,
    };
    if (limp) {
      body.addEventListener('collide', () => {
        if (entry.bounceCooldown > 0) return;
        const impactSpeed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
        if (impactSpeed < 3.2) return;
        entry.pendingBounceHits += 1;
        entry.bounceCooldown = 0.13;
      });
    }

    world.addBody(body);
    flights.set(playerId, entry);
  }

  function removePlayer(playerId) {
    stripBody(playerId);
  }

  /**
   * @param {number} dt
   * @param {(id: string) => object | undefined} getPlayerState
   */
  function step(dt, getPlayerState) {
    const maxDt = Math.min(Math.max(dt, 1e-4), 0.05);
    const sub = 10;
    const h = maxDt / sub;
    for (let i = 0; i < sub; i += 1) {
      world.step(h);
    }

    for (const playerId of [...flights.keys()]) {
      const entry = flights.get(playerId);
      if (!entry) continue;
      const st = getPlayerState(playerId);
      if (!st?.alive) {
        finishFlight(playerId, st);
        continue;
      }

      const b = entry.body;
      st.position.x = b.position.x;
      st.position.y = Math.max(0, b.position.y - CENTER_Y_OFFSET);
      st.position.z = b.position.z;
      st.velocity.x = b.velocity.x;
      st.velocity.y = b.velocity.y;
      st.velocity.z = b.velocity.z;
      st.grounded = false;
      st.animState = 'jump';
      if (entry.limp) {
        entry.bounceCooldown = Math.max(0, entry.bounceCooldown - maxDt);
        if (entry.pendingBounceHits > 0) {
          st.limpBounceHitSeq = (Number(st.limpBounceHitSeq) || 0) + entry.pendingBounceHits;
          entry.pendingBounceHits = 0;
        }
        const currentLimpTimer = Number.isFinite(Number(st.limpThrownBounceTimer))
          ? Math.max(0, Number(st.limpThrownBounceTimer))
          : entry.limpSeconds;
        st.limpThrownBounceTimer = Math.max(0, currentLimpTimer - maxDt);
        st.wallHolding = false;
        st.wallJumpWindowTimer = 0;
        st.wallAttachCooldownTimer = Math.max(st.wallAttachCooldownTimer ?? 0, 0.18);
      }

      if (st.roombaLaunchCooldown > 0) {
        st.roombaLaunchCooldown = Math.max(0, st.roombaLaunchCooldown - maxDt);
      }

      entry.flightTime += maxDt;
      const maxFlight = entry.limp ? Math.max(MAX_FLIGHT_S, entry.limpSeconds) : MAX_FLIGHT_S;
      if (entry.flightTime >= maxFlight) {
        finishFlight(playerId, st);
        continue;
      }

      const hSpeed = Math.hypot(b.velocity.x, b.velocity.z);
      const nearFloor = b.position.y < MOUSE_SPHERE_RADIUS + 0.38;
      if (nearFloor && Math.abs(b.velocity.y) < 2.1 && hSpeed < 4.8) {
        entry.groundedMs += maxDt;
        if (entry.groundedMs >= GROUNDED_EXIT_TIME) {
          finishFlight(playerId, st);
        }
      } else {
        entry.groundedMs = 0;
      }
    }
  }

  function isFlying(playerId) {
    return flights.has(playerId);
  }

  return {
    setLevelColliders,
    startFlight,
    step,
    isFlying,
    removePlayer,
  };
}
