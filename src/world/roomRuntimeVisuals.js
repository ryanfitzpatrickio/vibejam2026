export function updateRoomRuntimeVisuals(room, timeMs) {
  const t = timeMs * 0.001;

  room.lootItems.forEach((item) => {
    const baseY = item.userData.baseY ?? item.position.y;
    item.position.y = baseY + Math.sin(t * 2) * 0.1;
    item.rotation.x += 0.005;
    item.rotation.y += 0.008;

    if (item.userData.sparkle) {
      const scale = 1 + Math.sin(t * 3) * 0.15;
      item.userData.sparkle.scale.set(scale, scale, scale);
      item.userData.sparkle.position.y = item.position.y;
    }
  });

  room.editableFanObjects.forEach((entry) => {
    if (!entry?.group || entry.group.visible === false) return;
    const runtime = room.fanRuntimeStates.get(entry.definition?.id) ?? null;
    if (entry.spinRoot) {
      entry.spinRoot.rotation.y = Number.isFinite(runtime?.angle)
        ? runtime.angle
        : t * (entry.definition?.spinSpeed ?? 0);
    }
    if (entry.cheeseGroup) {
      entry.cheeseGroup.visible = runtime?.cheeseAvailable ?? ((entry.definition?.cheeseAmount ?? 0) > 0);
    }
    if (entry.cheeseGroup?.visible) {
      const pulse = 1 + Math.sin((t * 4.6) + (entry.group.position.x * 0.17)) * 0.08;
      entry.cheeseGroup.scale.setScalar(pulse);
    }
  });
}

export function applyRoomFanRuntimeStates(room, states = null) {
  room.fanRuntimeStates.clear();
  if (!Array.isArray(states)) return;
  for (const state of states) {
    if (!state?.id) continue;
    room.fanRuntimeStates.set(state.id, {
      angle: Number.isFinite(state.angle) ? state.angle : 0,
      cheeseAvailable: state.cheeseAvailable !== false,
    });
  }
}
