export function bindPerformancePanelToggles(panel, {
  renderer,
  room,
  outlinePipeline,
  roomOutlineMeshes,
  localMouseOutlineMeshes,
  remotePlayerManager,
  setOutlineListVisible,
  perfFlags,
  setLabelsEnabled,
  setGameplayUiEnabled,
  setLocalPlayerVisible,
  setRemotePlayersVisible,
  setPredatorsVisible,
  navMeshOverlay,
  vibePortalManager,
  cheesePickupGroup,
  getPushBallsVisible,
  setPushBallsVisible,
  setWindVisible,
  setRopesVisible,
  setRaidMarkersVisible,
  occlusionFader,
}) {
  if (!panel?.bindPerformanceToggles) return;
  panel.bindPerformanceToggles({
    shadows: {
      label: 'Shadow maps (extra passes per light)',
      get: () => renderer.shadowMap.enabled,
      set: (v) => {
        renderer.shadowMap.enabled = !!v;
      },
    },
    staticMerge: {
      label: 'Static geometry merge (combine by material)',
      get: () => room.isStaticMergeEnabled?.() === true,
      set: (v) => room.setStaticMergeEnabled?.(!!v),
    },
    fullscreenOutline: {
      label: 'Fullscreen outline (post-process)',
      get: () => outlinePipeline.isEnabled(),
      set: (v) => outlinePipeline.setEnabled(v),
    },
    roomOutlines: {
      label: 'Room edge outlines (batched)',
      get: () => roomOutlineMeshes.some((m) => m && m.visible !== false),
      set: (v) => setOutlineListVisible(roomOutlineMeshes, v),
    },
    localMouseOutlines: {
      label: 'Local mouse edge outlines (per mesh)',
      get: () => localMouseOutlineMeshes.some((m) => m && m.visible !== false),
      set: (v) => setOutlineListVisible(localMouseOutlineMeshes, v),
    },
    remoteMouseOutlines: {
      label: 'Remote mouse edge outlines',
      get: () => remotePlayerManager.getEdgeOutlinesVisible(),
      set: (v) => remotePlayerManager.setEdgeOutlinesVisible(v),
    },
    labels: {
      label: 'CSS labels / nameplates',
      get: () => perfFlags.labels,
      set: (v) => setLabelsEnabled(v),
    },
    gameplayUi: {
      label: 'HUD / overlays / toolbar',
      get: () => perfFlags.gameplayUi,
      set: (v) => setGameplayUiEnabled(v),
    },
    localPlayer: {
      label: 'Local player model',
      get: () => perfFlags.localPlayer,
      set: (v) => setLocalPlayerVisible(v),
    },
    remotePlayers: {
      label: 'Remote player models',
      get: () => perfFlags.remotePlayers,
      set: (v) => setRemotePlayersVisible(v),
    },
    predators: {
      label: 'Predator models (cat / roomba / human)',
      get: () => perfFlags.predators,
      set: (v) => setPredatorsVisible(v),
    },
    navOverlay: {
      label: 'Nav mesh overlay',
      get: () => navMeshOverlay.visible === true,
      set: (v) => {
        navMeshOverlay.visible = !!v;
      },
    },
    ...(vibePortalManager ? {
      vibePortals: {
        label: 'Vibe portals (rings / particles / sprites)',
        get: () => vibePortalManager.getPortalsVisible(),
        set: (v) => vibePortalManager.setPortalsVisible(v),
      },
    } : {}),
    cheesePickups: {
      label: 'Cheese pickup meshes',
      get: () => cheesePickupGroup.visible !== false,
      set: (v) => {
        cheesePickupGroup.visible = !!v;
      },
    },
    pushBalls: {
      label: 'Push ball meshes',
      get: () => getPushBallsVisible(),
      set: (v) => setPushBallsVisible(v),
    },
    wind: {
      label: 'Wind streaks',
      get: () => perfFlags.wind,
      set: (v) => setWindVisible(v),
    },
    ropes: {
      label: 'Rope visuals',
      get: () => perfFlags.ropes,
      set: (v) => setRopesVisible(v),
    },
    raidMarkers: {
      label: 'Raid / extraction markers',
      get: () => perfFlags.raidMarkers,
      set: (v) => setRaidMarkersVisible(v),
    },
    occlusionFader: {
      label: 'Occlusion x-ray fader (wall fade)',
      get: () => occlusionFader.enabled !== false,
      set: (v) => occlusionFader.setEnabled(v),
    },
    grass: {
      label: 'Grass (vegetation instanced cards)',
      get: () => room.vegetationSystem?.isKindVisible('grass') !== false,
      set: (v) => room.vegetationSystem?.setKindVisible('grass', v),
    },
    trees: {
      label: 'Trees (vegetation canopies + trunks)',
      get: () => room.vegetationSystem?.isKindVisible('tree') !== false,
      set: (v) => room.vegetationSystem?.setKindVisible('tree', v),
    },
  });
}
