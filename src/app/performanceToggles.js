export function createPerformanceToggles({
  perfFlags,
  labelRenderer,
  localNameplate,
  remotePlayerManager,
  actionJuice,
  hud,
  roundRaid,
  mischiefMeter,
  catLocator,
  scoreboard,
  toolbar,
  chaseAlert,
  adversaryStatus,
  heroPrompt,
  taskPromptElement,
  mouse,
  getPredictionState,
  getHuman,
  getCat,
  getRoomba,
  windStreaks,
  ropeSystem,
  room,
  extractionMarkerGroup,
}) {
  function setLabelsEnabled(enabled) {
    perfFlags.labels = !!enabled;
    labelRenderer.domElement.style.display = perfFlags.labels ? '' : 'none';
    localNameplate.setVisible(perfFlags.labels);
    remotePlayerManager.setNameplatesVisible(perfFlags.labels);
    actionJuice.setEnabled(perfFlags.labels && perfFlags.gameplayUi);
  }

  function setGameplayUiEnabled(enabled) {
    perfFlags.gameplayUi = !!enabled;
    hud.setVisible(perfFlags.gameplayUi);
    roundRaid.setVisible(perfFlags.gameplayUi);
    mischiefMeter.setVisible(perfFlags.gameplayUi);
    catLocator.setVisible(perfFlags.gameplayUi);
    scoreboard.setVisible(perfFlags.gameplayUi);
    toolbar.setVisible(perfFlags.gameplayUi);
    chaseAlert.setVisible(perfFlags.gameplayUi);
    adversaryStatus.setVisible(perfFlags.gameplayUi);
    heroPrompt.setEnabled(perfFlags.gameplayUi);
    actionJuice.setEnabled(perfFlags.labels && perfFlags.gameplayUi);
    taskPromptElement.style.display = 'none';
  }

  function setLocalPlayerVisible(enabled) {
    const predictionState = getPredictionState();
    const human = getHuman();
    perfFlags.localPlayer = !!enabled;
    mouse.visible = perfFlags.localPlayer && !(predictionState.isAdversary && human?.playerControlled);
  }

  function setRemotePlayersVisible(enabled) {
    perfFlags.remotePlayers = !!enabled;
    remotePlayerManager.setPlayersVisible(perfFlags.remotePlayers);
  }

  function setPredatorsVisible(enabled) {
    perfFlags.predators = !!enabled;
    if (!perfFlags.predators) {
      const cat = getCat();
      const roomba = getRoomba();
      const human = getHuman();
      if (cat) cat.visible = false;
      if (roomba) {
        roomba.visible = false;
        roomba.dockGroup.visible = false;
      }
      if (human) human.visible = false;
    }
  }

  function setWindVisible(enabled) {
    perfFlags.wind = !!enabled;
    if (!perfFlags.wind) {
      windStreaks.setIntensity(0);
      windStreaks.update(0);
    }
  }

  function setRopesVisible(enabled) {
    perfFlags.ropes = !!enabled;
    ropeSystem.visible = perfFlags.ropes;
  }

  function setRaidMarkersVisible(enabled) {
    perfFlags.raidMarkers = !!enabled;
    room.setRaidTaskHelpersVisible(perfFlags.raidMarkers);
    extractionMarkerGroup.visible = perfFlags.raidMarkers && extractionMarkerGroup.children.length > 0;
  }

  return {
    setLabelsEnabled,
    setGameplayUiEnabled,
    setLocalPlayerVisible,
    setRemotePlayersVisible,
    setPredatorsVisible,
    setWindVisible,
    setRopesVisible,
    setRaidMarkersVisible,
  };
}
