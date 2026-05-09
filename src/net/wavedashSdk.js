let initStarted = null;

export function getWavedashSDK() {
  return globalThis.WavedashJS ?? globalThis.Wavedash ?? null;
}

export function hasWavedashSDK() {
  return !!getWavedashSDK();
}

export function updateWavedashLoadProgress(value) {
  const sdk = getWavedashSDK();
  const n = Math.max(0, Math.min(1, Number(value) || 0));
  try {
    sdk?.updateLoadProgressZeroToOne?.(n);
    sdk?.UpdateLoadProgressZeroToOne?.(n);
  } catch {
    // Progress reporting is best-effort; gameplay boot should not depend on it.
  }
}

export async function initWavedashSDK({
  debug = false,
  deferEvents = true,
} = {}) {
  if (initStarted) return initStarted;
  initStarted = (async () => {
    const sdk = getWavedashSDK();
    if (!sdk) {
      throw new Error('Wavedash SDK is not available. Run through wavedash dev or the Wavedash shell.');
    }
    const config = {
      debug,
      deferEvents,
      p2p: {
        maxPeers: 16,
        enableReliableChannel: true,
        enableUnreliableChannel: true,
        messageSize: 65536,
        maxIncomingMessages: 1024,
      },
    };
    if (typeof sdk.init === 'function') {
      sdk.init(config);
    } else if (typeof sdk.Init === 'function') {
      sdk.Init(config);
    }
    updateWavedashLoadProgress(1);
    return sdk;
  })();
  return initStarted;
}

export function getWavedashEventName(sdk, key) {
  return sdk?.Events?.[key] ?? key;
}
