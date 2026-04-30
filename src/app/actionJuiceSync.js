function copyPlayerActionJuiceState(playerState) {
  return {
    cheeseCarried: Math.max(0, Math.floor(Number(playerState?.cheeseCarried) || 0)),
    mischiefScore: Math.max(0, Math.floor(Number(playerState?.roundStats?.mischiefScore) || 0)),
    mischiefCombo: Math.max(0, Math.floor(Number(playerState?.roundStats?.mischiefCombo) || 0)),
    grabsInitiated: Math.max(0, Math.floor(Number(playerState?.roundStats?.grabsInitiated) || 0)),
    throwsLanded: Math.max(0, Math.floor(Number(playerState?.roundStats?.throwsLanded) || 0)),
    smacksLanded: Math.max(0, Math.floor(Number(playerState?.roundStats?.smacksLanded) || 0)),
    smackStunTimer: Math.max(0, Number(playerState?.smackStunTimer) || 0),
  };
}

export function syncActionJuicePopups({
  allPlayers,
  nowSeconds,
  previousState,
  mischiefChains,
  chainWindowSeconds,
  spawnActionJuice,
}) {
  const seen = new Set();
  for (const [playerId, playerState] of allPlayers) {
    if (!playerState) continue;
    seen.add(playerId);
    const next = copyPlayerActionJuiceState(playerState);
    const prev = previousState.get(playerId);
    if (prev) {
      const cheeseGain = next.cheeseCarried - prev.cheeseCarried;
      if (cheeseGain > 0 && playerState.alive !== false && !playerState.isAdversary) {
        spawnActionJuice(playerState, `+${cheeseGain} \u{1f9c0}`, 'cheese');
      }

      const mischiefGain = next.mischiefScore - prev.mischiefScore;
      if (mischiefGain > 0 && playerState.alive !== false) {
        const chain = mischiefChains.get(playerId) ?? { combo: 0, lastAt: -Infinity };
        chain.combo = (nowSeconds - chain.lastAt) <= chainWindowSeconds ? chain.combo : 0;
        chain.combo = Math.max(chain.combo + 1, next.mischiefCombo);
        chain.lastAt = nowSeconds;
        mischiefChains.set(playerId, chain);
        if (chain.combo > 1) {
          spawnActionJuice(playerState, `x${chain.combo} COMBO! +${mischiefGain}`, 'combo');
        } else {
          spawnActionJuice(playerState, `+${mischiefGain} mischief`, 'mischief');
        }
      }

      const grabGain = next.grabsInitiated - prev.grabsInitiated;
      if (grabGain > 0 && playerState.alive !== false) {
        spawnActionJuice(playerState, 'Grabbed!', 'grab');
      }

      const throwGain = next.throwsLanded - prev.throwsLanded;
      if (throwGain > 0 && playerState.alive !== false) {
        spawnActionJuice(playerState, 'Yeet!', 'grab');
      }

      const smackGain = next.smacksLanded - prev.smacksLanded;
      if (smackGain > 0 && playerState.alive !== false) {
        spawnActionJuice(playerState, 'Smack landed!', 'smack');
      }

      if (next.smackStunTimer > 0 && prev.smackStunTimer <= 0) {
        spawnActionJuice(playerState, 'Smacked!', 'smack');
      }
    }
    previousState.set(playerId, next);
  }

  for (const playerId of Array.from(previousState.keys())) {
    if (!seen.has(playerId)) previousState.delete(playerId);
  }
  for (const playerId of Array.from(mischiefChains.keys())) {
    if (!seen.has(playerId)) mischiefChains.delete(playerId);
  }
}
