export function createPerfFlags() {
  return {
    labels: true,
    gameplayUi: true,
    localPlayer: true,
    remotePlayers: true,
    predators: true,
    wind: true,
    ropes: true,
    raidMarkers: true,
  };
}

export function createQualityState() {
  return {
    tier: 0,
    dprCap: 1.5,
    baseDprCap: 1.5,
    lowFpsSeconds: 0,
    highFpsSeconds: 0,
    lastResizeWidth: 1,
    lastResizeHeight: 1,
    lastDevicePixelRatio: 1,
    lastScoreboardAt: 0,
    lastCatLocatorAt: 0,
    lastTaskUpdateAt: 0,
    actionJuiceAccum: 0,
    labelsWereEnabled: true,
    outlinesWereEnabled: true,
  };
}

export function applyAdaptiveQualityTier({
  tier,
  qualityState,
  perfFlags,
  actionJuice,
  outlinePipeline,
  setLabelsEnabled,
  resize,
}) {
  const nextTier = Math.max(0, Math.min(3, Math.floor(Number(tier) || 0)));
  if (nextTier === qualityState.tier) return;
  const prevTier = qualityState.tier;
  qualityState.tier = nextTier;

  qualityState.dprCap = [qualityState.baseDprCap, 1.35, 1.15, 1.0][nextTier] ?? 1.0;
  actionJuice.setMaxPopups?.([18, 12, 8, 4][nextTier] ?? 4);

  if (nextTier >= 2 && prevTier < 2) {
    qualityState.labelsWereEnabled = perfFlags.labels;
    setLabelsEnabled(false);
  } else if (nextTier < 2 && prevTier >= 2 && qualityState.labelsWereEnabled && !perfFlags.labels) {
    setLabelsEnabled(true);
  }

  if (nextTier >= 1 && prevTier < 1) {
    qualityState.outlinesWereEnabled = outlinePipeline.isEnabled();
    outlinePipeline.setEnabled(false);
  } else if (nextTier < 1 && prevTier >= 1 && qualityState.outlinesWereEnabled && !outlinePipeline.isEnabled()) {
    outlinePipeline.setEnabled(true);
  }

  resize(
    qualityState.lastResizeWidth,
    qualityState.lastResizeHeight,
    qualityState.lastDevicePixelRatio,
  );
}

export function updateAdaptiveQuality({
  deltaSeconds,
  qualityState,
  perfFlags,
  actionJuice,
  outlinePipeline,
  setLabelsEnabled,
  resize,
}) {
  const dt = Math.max(0, Math.min(0.25, Number(deltaSeconds) || 0));
  if (dt <= 0) return;
  const fps = 1 / dt;
  if (fps < 42) {
    qualityState.lowFpsSeconds += dt;
    qualityState.highFpsSeconds = 0;
  } else if (fps > 56) {
    qualityState.highFpsSeconds += dt;
    qualityState.lowFpsSeconds = 0;
  } else {
    qualityState.lowFpsSeconds = Math.max(0, qualityState.lowFpsSeconds - dt * 0.5);
    qualityState.highFpsSeconds = Math.max(0, qualityState.highFpsSeconds - dt * 0.35);
  }

  if (qualityState.lowFpsSeconds > 2.2 && qualityState.tier < 3) {
    qualityState.lowFpsSeconds = 0;
    applyAdaptiveQualityTier({
      tier: qualityState.tier + 1,
      qualityState,
      perfFlags,
      actionJuice,
      outlinePipeline,
      setLabelsEnabled,
      resize,
    });
  } else if (qualityState.highFpsSeconds > 8 && qualityState.tier > 0) {
    qualityState.highFpsSeconds = 0;
    applyAdaptiveQualityTier({
      tier: qualityState.tier - 1,
      qualityState,
      perfFlags,
      actionJuice,
      outlinePipeline,
      setLabelsEnabled,
      resize,
    });
  }
}
