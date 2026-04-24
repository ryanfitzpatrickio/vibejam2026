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
 *   startFlight: (playerId: string, state: object, outNx: number, outNz: number, speedScale?: number) => void,
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

  /** @type {Map<string, { body: Body, groundedMs: number, flightTime: number }>} */
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
  }

  /**
   * @param {string} playerId
   * @param {{ position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number}, id?: string }} state
   * @param {number} outNx
   * @param {number} outNz
   */
  function startFlight(playerId, state, outNx, outNz, speedScale = 1) {
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

    const scale = Math.max(0.75, Math.min(1.9, Number(speedScale) || 1));
    const hs = LAUNCH_HORIZ_SPEED * scale * (0.9 + Math.random() * 0.22);
    const up = LAUNCH_UP_SPEED * Math.sqrt(scale) * (0.85 + Math.random() * 0.35);
    body.velocity.set(nx * hs, up, nz * hs);

    world.addBody(body);
    flights.set(playerId, { body, groundedMs: 0, flightTime: 0 });
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

      if (st.roombaLaunchCooldown > 0) {
        st.roombaLaunchCooldown = Math.max(0, st.roombaLaunchCooldown - maxDt);
      }

      entry.flightTime += maxDt;
      if (entry.flightTime >= MAX_FLIGHT_S) {
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
