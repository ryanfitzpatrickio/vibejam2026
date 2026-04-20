import * as THREE from 'three';
import { PHYSICS } from '../../shared/physics.js';

const FACE_CONTACT_EPSILON = 0.001;

function isNonWalkableCollider(collider) {
  return collider?.metadata?.nonWalkable === true;
}

export class UprightCapsuleCollider {
  constructor({
    radius = 0.22,
    height = 0.78,
    groundSnapDistance = 0.18,
  } = {}) {
    this.radius = radius;
    this.height = Math.max(height, radius * 2);
    this.groundSnapDistance = groundSnapDistance;
    this.position = new THREE.Vector3();
    this._expandedBox = new THREE.Box3();
  }

  setPosition(position) {
    this.position.copy(position);
  }

  getSupportHeight(colliders = [], baseGroundY = 0) {
    let supportY = baseGroundY;

    for (const collider of colliders) {
      const box = collider?.aabb;
      if (!box) continue;
      if (isNonWalkableCollider(collider)) continue;

      const withinX = this.position.x >= box.min.x - this.radius
        && this.position.x <= box.max.x + this.radius;
      const withinZ = this.position.z >= box.min.z - this.radius
        && this.position.z <= box.max.z + this.radius;

      if (!withinX || !withinZ) continue;

      const isSurface = collider.type === 'surface' || collider.metadata?.runnable;
      const surfaceY = box.max.y;

      if (isSurface) {
        if (this.position.y >= surfaceY - this.groundSnapDistance) {
          supportY = Math.max(supportY, surfaceY);
        }
      } else {
        // Furniture / solid boxes — land on top when near the top face
        const snapWindow = this.groundSnapDistance * 1.5;
        if (this.position.y >= surfaceY - snapWindow) {
          supportY = Math.max(supportY, surfaceY);
        }
      }
    }

    return supportY;
  }

  resolveAgainstBox(box, velocity = null, previousPosition = null, options = {}) {
    const allowVerticalSupport = options.allowVerticalSupport !== false;
    const capsuleMinY = this.position.y;
    const capsuleMaxY = this.position.y + this.height;
    const previousCapsuleMinY = previousPosition?.y ?? capsuleMinY;
    const previousCapsuleMaxY = previousCapsuleMinY + this.height;

    if (capsuleMaxY < box.min.y || capsuleMinY > box.max.y) {
      return false;
    }

    const expandedMinX = box.min.x - this.radius;
    const expandedMaxX = box.max.x + this.radius;
    const expandedMinZ = box.min.z - this.radius;
    const expandedMaxZ = box.max.z + this.radius;

    const insideX = this.position.x >= expandedMinX && this.position.x <= expandedMaxX;
    const insideZ = this.position.z >= expandedMinZ && this.position.z <= expandedMaxZ;

    if (!insideX || !insideZ) {
      return false;
    }

    // Match shared/physics resolvePlayerCollisions: walk onto short ledges instead of sliding along walls.
    if (allowVerticalSupport && options.grounded === true) {
      const maxStep = Number.isFinite(options.maxStepHeight) ? options.maxStepHeight : PHYSICS.maxStepHeight;
      const ledgeHeight = box.max.y - capsuleMinY;
      const isShortLedge = ledgeHeight > 0 && ledgeHeight <= maxStep;
      const inYRange = capsuleMaxY >= box.min.y && capsuleMinY <= box.max.y;
      if (isShortLedge && inYRange) {
        this.position.y = box.max.y;
        if (velocity) velocity.y = Math.max(velocity.y, 0);
        return true;
      }
    }

    const landedFromAbove = previousCapsuleMinY >= box.max.y - FACE_CONTACT_EPSILON
      && capsuleMinY <= box.max.y + FACE_CONTACT_EPSILON
      && velocity?.y <= 0;
    if (allowVerticalSupport && landedFromAbove) {
      this.position.y = box.max.y;
      if (velocity) velocity.y = Math.max(velocity.y, 0);
      return true;
    }

    const hitFromBelow = previousCapsuleMaxY <= box.min.y + FACE_CONTACT_EPSILON
      && capsuleMaxY >= box.min.y - FACE_CONTACT_EPSILON
      && velocity?.y >= 0;
    if (hitFromBelow) {
      this.position.y = box.min.y - this.height;
      if (velocity) velocity.y = Math.min(velocity.y, 0);
      return true;
    }

    const distLeft = this.position.x - expandedMinX;
    const distRight = expandedMaxX - this.position.x;
    const distBack = this.position.z - expandedMinZ;
    const distFront = expandedMaxZ - this.position.z;

    // Y-axis penetration depths
    const distUp = box.max.y - capsuleMinY;   // push player up (landed from above)
    const distDown = capsuleMaxY - box.min.y; // push player down (hit ceiling)

    const minDist = Math.min(distLeft, distRight, distBack, distFront, distUp, distDown);

    if (allowVerticalSupport && minDist === distUp && distUp >= 0) {
      // Player entered from above — push up to stand on top
      this.position.y = box.max.y;
      if (velocity) velocity.y = Math.max(velocity.y, 0);
    } else if (minDist === distDown && distDown >= 0) {
      // Player hit ceiling — push down
      this.position.y = box.min.y - this.height;
      if (velocity) velocity.y = Math.min(velocity.y, 0);
    } else if (minDist === distLeft) {
      this.position.x = expandedMinX;
      if (velocity) velocity.x = Math.min(velocity.x, 0);
    } else if (minDist === distRight) {
      this.position.x = expandedMaxX;
      if (velocity) velocity.x = Math.max(velocity.x, 0);
    } else if (minDist === distBack) {
      this.position.z = expandedMinZ;
      if (velocity) velocity.z = Math.min(velocity.z, 0);
    } else {
      this.position.z = expandedMaxZ;
      if (velocity) velocity.z = Math.max(velocity.z, 0);
    }

    return true;
  }
}
