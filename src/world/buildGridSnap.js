import * as THREE from 'three';
import {
  normalizeEditableExtractionPortal,
  normalizeEditableLight,
  normalizeEditablePortal,
  normalizeEditablePrimitive,
  normalizeEditableRaidTask,
  normalizeEditableRope,
  normalizeEditableFan,
  normalizeEditableVegetation,
} from './editableLayoutNormalize.js';

const BUILD_GRID_VERTICAL_STEP = 0.25;
const EXTRACTION_HELPER_BASE_RADIUS = 1.15;

function roundVectorLike(source, fallback) {
  return {
    x: Number((source?.x ?? fallback.x).toFixed(4)),
    y: Number((source?.y ?? fallback.y).toFixed(4)),
    z: Number((source?.z ?? fallback.z).toFixed(4)),
  };
}

export function snapToStep(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function getBuildGridConfig(room) {
  const columns = Math.max(1, room.buildGrid.columns);
  const rows = Math.max(1, room.buildGrid.rows);
  return {
    columns,
    rows,
    cellWidth: room.width / columns,
    cellDepth: room.depth / rows,
    verticalStep: room.buildGrid.verticalStep,
    roomWidth: room.width,
    roomDepth: room.depth,
  };
}

export function setBuildGridSnapSize(room, size) {
  if (!Number.isFinite(size) || size <= 0) return getBuildGridConfig(room);

  room.buildGrid.columns = Math.max(1, Math.round(room.width / size));
  room.buildGrid.rows = Math.max(1, Math.round(room.depth / size));
  room.buildGrid.verticalStep = Math.min(BUILD_GRID_VERTICAL_STEP, size);
  return getBuildGridConfig(room);
}

export function getBuildGridAnchorPosition(room, col, row, spanX = 1, spanZ = 1) {
  const grid = getBuildGridConfig(room);
  const safeSpanX = Math.max(1, Math.round(spanX));
  const safeSpanZ = Math.max(1, Math.round(spanZ));
  const clampedCol = THREE.MathUtils.clamp(col, 0, grid.columns - safeSpanX);
  const clampedRow = THREE.MathUtils.clamp(row, 0, grid.rows - safeSpanZ);
  return new THREE.Vector3(
    -grid.roomWidth * 0.5 + (clampedCol + safeSpanX * 0.5) * grid.cellWidth,
    0,
    -grid.roomDepth * 0.5 + (clampedRow + safeSpanZ * 0.5) * grid.cellDepth,
  );
}

function getPrimitiveFootprint(primitive) {
  if (primitive.type === 'plane') {
    return {
      width: Math.max(0.0001, primitive.scale.x),
      depth: Math.max(0.0001, primitive.scale.y),
    };
  }
  if (primitive.type === 'prop') {
    return {
      width: Math.max(0.0001, primitive.scale.x),
      depth: Math.max(0.0001, primitive.scale.x),
    };
  }

  return {
    width: Math.max(0.0001, primitive.scale.x),
    depth: Math.max(0.0001, primitive.scale.z),
  };
}

function snapGridScale(value, cellSize) {
  if (!Number.isFinite(value)) return cellSize;
  return Math.max(cellSize, Math.round(value / cellSize) * cellSize);
}

function snapGridAxisPosition(value, footprint, totalSize, cellSize, allowOverflow = false) {
  const halfRoom = totalSize * 0.5;
  const min = allowOverflow ? -halfRoom : -halfRoom + (Math.min(Math.max(footprint, cellSize), totalSize) * 0.5);
  const max = allowOverflow ? halfRoom : halfRoom - (Math.min(Math.max(footprint, cellSize), totalSize) * 0.5);

  if (max <= min) {
    return 0;
  }

  const snapped = min + Math.round((value - min) / cellSize) * cellSize;
  return THREE.MathUtils.clamp(snapped, min, max);
}

export function snapPrimitiveToGrid(room, definition, {
  snapY = false,
  snapScale = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const primitive = normalizeEditablePrimitive(definition);
  const grid = getBuildGridConfig(room);

  if (snapScale) {
    if (primitive.type === 'plane' || primitive.type === 'prop') {
      primitive.scale.x = snapGridScale(primitive.scale.x, grid.cellWidth);
      primitive.scale.y = snapGridScale(primitive.scale.y, grid.cellDepth);
    } else {
      primitive.scale.x = snapGridScale(primitive.scale.x, grid.cellWidth);
      primitive.scale.z = snapGridScale(primitive.scale.z, grid.cellDepth);
    }
  }

  if (snapPosition) {
    const footprint = getPrimitiveFootprint(primitive);
    primitive.position.x = snapGridAxisPosition(
      primitive.position.x,
      footprint.width,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    primitive.position.z = snapGridAxisPosition(
      primitive.position.z,
      footprint.depth,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    primitive.position.y = snapToStep(primitive.position.y, grid.verticalStep);
  }

  primitive.position = roundVectorLike(primitive.position, { x: 0, y: 0, z: 0 });
  primitive.scale = roundVectorLike(primitive.scale, { x: 1, y: 1, z: 1 });
  return primitive;
}

export function snapLightToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const light = normalizeEditableLight(definition);
  const grid = getBuildGridConfig(room);

  if (snapPosition) {
    light.position.x = snapGridAxisPosition(
      light.position.x,
      grid.cellWidth,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    light.position.z = snapGridAxisPosition(
      light.position.z,
      grid.cellDepth,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    light.position.y = snapToStep(light.position.y, grid.verticalStep);
  }

  light.position = roundVectorLike(light.position, { x: 0, y: 0, z: 0 });
  light.rotation = roundVectorLike(light.rotation, { x: 0, y: 0, z: 0 });
  return light;
}

export function snapPortalToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const portal = normalizeEditablePortal(definition);
  const grid = getBuildGridConfig(room);

  if (snapPosition) {
    portal.position.x = snapGridAxisPosition(
      portal.position.x,
      portal.triggerRadius * 2,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    portal.position.z = snapGridAxisPosition(
      portal.position.z,
      portal.triggerRadius * 2,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    portal.position.y = snapToStep(portal.position.y, grid.verticalStep);
  }

  portal.position = roundVectorLike(portal.position, { x: 0, y: 0, z: 0 });
  portal.rotation = roundVectorLike(portal.rotation, { x: 0, y: 0, z: 0 });
  portal.triggerRadius = Number(portal.triggerRadius.toFixed(4));
  return portal;
}

export function snapExtractionPortalToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const ep = normalizeEditableExtractionPortal(definition);
  const grid = getBuildGridConfig(room);
  const footprint = (ep.radius ?? EXTRACTION_HELPER_BASE_RADIUS) * 2;

  if (snapPosition) {
    ep.position.x = snapGridAxisPosition(
      ep.position.x,
      footprint,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    ep.position.z = snapGridAxisPosition(
      ep.position.z,
      footprint,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    ep.position.y = snapToStep(ep.position.y, grid.verticalStep);
  }

  ep.position = roundVectorLike(ep.position, { x: 0, y: 0, z: 0 });
  ep.rotation = roundVectorLike(ep.rotation, { x: 0, y: 0, z: 0 });
  ep.radius = Number((ep.radius ?? EXTRACTION_HELPER_BASE_RADIUS).toFixed(4));
  return ep;
}

export function snapRaidTaskToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const task = normalizeEditableRaidTask(definition);
  const grid = getBuildGridConfig(room);
  const footprint = 0.6;

  if (snapPosition) {
    task.position.x = snapGridAxisPosition(
      task.position.x,
      footprint,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    task.position.z = snapGridAxisPosition(
      task.position.z,
      footprint,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    task.position.y = snapToStep(task.position.y, grid.verticalStep);
  }

  task.position = roundVectorLike(task.position, { x: 0, y: 0, z: 0 });
  task.rotation = roundVectorLike(task.rotation, { x: 0, y: 0, z: 0 });
  return task;
}

export function snapRopeToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const rope = normalizeEditableRope(definition);
  const grid = getBuildGridConfig(room);

  if (snapPosition) {
    rope.anchor.x = snapGridAxisPosition(
      rope.anchor.x,
      0.3,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    rope.anchor.z = snapGridAxisPosition(
      rope.anchor.z,
      0.3,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    rope.anchor.y = snapToStep(rope.anchor.y, grid.verticalStep);
  }

  rope.anchor = roundVectorLike(rope.anchor, { x: 0, y: 0, z: 0 });
  rope.length = Number(rope.length.toFixed(4));
  return rope;
}

export function snapFanToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  allowEdgeOverflow = false,
} = {}) {
  const fan = normalizeEditableFan(definition);
  const grid = getBuildGridConfig(room);

  if (snapPosition) {
    fan.position.x = snapGridAxisPosition(
      fan.position.x,
      0.5,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    fan.position.z = snapGridAxisPosition(
      fan.position.z,
      0.5,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    fan.position.y = snapToStep(fan.position.y, grid.verticalStep);
  }

  fan.position = roundVectorLike(fan.position, { x: 0, y: 3.35, z: 0 });
  fan.rotation = roundVectorLike(fan.rotation, { x: 0, y: 0, z: 0 });
  return fan;
}

export function snapVegetationToGrid(room, definition, {
  snapY = false,
  snapPosition = true,
  snapScale = false,
  allowEdgeOverflow = false,
} = {}) {
  let vegetation = normalizeEditableVegetation(definition);
  const grid = getBuildGridConfig(room);

  if (snapPosition) {
    vegetation.position.x = snapGridAxisPosition(
      vegetation.position.x,
      0.4,
      grid.roomWidth,
      grid.cellWidth,
      allowEdgeOverflow,
    );
    vegetation.position.z = snapGridAxisPosition(
      vegetation.position.z,
      0.4,
      grid.roomDepth,
      grid.cellDepth,
      allowEdgeOverflow,
    );
  }

  if (snapY) {
    vegetation.position.y = snapToStep(vegetation.position.y, grid.verticalStep);
  }

  if (snapScale) {
    vegetation.scale.x = snapToStep(vegetation.scale.x, 0.1);
    vegetation.scale.y = snapToStep(vegetation.scale.y, 0.1);
    vegetation.scale.z = snapToStep(vegetation.scale.z, 0.1);
  }

  vegetation.position = roundVectorLike(vegetation.position, { x: 0, y: 0, z: 0 });
  vegetation.scale = roundVectorLike(vegetation.scale, { x: 1, y: 1, z: 1 });
  vegetation = normalizeEditableVegetation(vegetation);
  return vegetation;
}
