export function createBenchMetrics({ tickRate }) {
  let bytesIn = 0;
  let bytesOut = 0;
  let msgsIn = 0;
  let msgsOut = 0;
  let tickCount = 0;
  let tickMsSum = 0;
  let tickMsMax = 0;
  const tickSamples = [];

  function tickPercentiles() {
    const arr = [...tickSamples].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!arr.length) {
      return { p50: 0, p95: 0, samples: 0 };
    }
    const pick = (q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];
    return { p50: pick(0.5), p95: pick(0.95), samples: arr.length };
  }

  return {
    recordIn(byteLen) {
      bytesIn += Math.max(0, Number(byteLen) || 0);
      msgsIn += 1;
    },
    recordOut(byteLen) {
      bytesOut += Math.max(0, Number(byteLen) || 0);
      msgsOut += 1;
    },
    recordTickMs(ms) {
      tickCount += 1;
      tickMsSum += ms;
      tickMsMax = Math.max(tickMsMax, ms);
      const cap = 3600;
      if (tickSamples.length < cap) {
        tickSamples.push(ms);
      } else {
        tickSamples[tickCount % cap] = ms;
      }
    },
    reset() {
      bytesIn = 0;
      bytesOut = 0;
      msgsIn = 0;
      msgsOut = 0;
      tickCount = 0;
      tickMsSum = 0;
      tickMsMax = 0;
      tickSamples.length = 0;
    },
    payload({ connectionCount = 0 } = {}) {
      const pct = tickPercentiles();
      const ticks = tickCount || 1;
      const durationSec = ticks / tickRate;
      return {
        tickRate,
        ticks: tickCount,
        durationSecApprox: Math.round(durationSec * 1000) / 1000,
        tickMsMean: Math.round((tickMsSum / ticks) * 10000) / 10000,
        tickMsMax: Math.round(tickMsMax * 10000) / 10000,
        tickMsP50: Math.round(pct.p50 * 10000) / 10000,
        tickMsP95: Math.round(pct.p95 * 10000) / 10000,
        tickSampleCount: pct.samples,
        bytesIn,
        bytesOut,
        msgsIn,
        msgsOut,
        bytesInPerSecApprox: Math.round(bytesIn / durationSec),
        bytesOutPerSecApprox: Math.round(bytesOut / durationSec),
        connections: connectionCount,
      };
    },
  };
}
