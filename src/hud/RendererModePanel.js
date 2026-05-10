import { measureText } from '../utils/textLayout.js';

const STORAGE_KEY = 'mouse-renderer-mode-v2';
const PERF_TOGGLES_STORAGE_KEY = 'mouse-trouble-perf-toggles-v1';
const DEFAULT_MODE = 'webgl';
const METRICS_FONT = '12px monospace';
const METRICS_LINE_HEIGHT = 16;

function isValidMode(mode) {
  return mode === 'webgl';
}

/** @deprecated Only `webgl` is supported; kept to migrate old `webgpu` localStorage entries. */
export function readRendererMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'webgpu') {
      try {
        localStorage.setItem(STORAGE_KEY, 'webgl');
      } catch {
        /* ignore */
      }
      return 'webgl';
    }
    if (isValidMode(raw)) return raw;
  } catch {
    // Ignore storage access failures.
  }

  return DEFAULT_MODE;
}

/** @deprecated Only `webgl` is supported. */
export function writeRendererMode(mode) {
  if (!isValidMode(mode)) return DEFAULT_MODE;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore storage access failures.
  }
  return mode;
}

function readPerfTogglesFromStorage() {
  try {
    const raw = localStorage.getItem(PERF_TOGGLES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePerfToggleToStorage(key, value) {
  try {
    const cur = readPerfTogglesFromStorage();
    cur[key] = !!value;
    localStorage.setItem(PERF_TOGGLES_STORAGE_KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

export class RendererModePanel {
  constructor({ container = document.body, visible = false } = {}) {
    this.container = container;
    this.fpsTarget = 60;
    this.samples = [];
    this.sampleWindowMs = 5000;
    this.visible = visible;
    /** Baseline counts captured ~10s after first sample so we can spot leaks (Δ from baseline). */
    this._memBaseline = null;
    this._memBaselineCaptureAtMs = 0;
    /** Last time we logged the memory trend to console (ms). */
    this._memLogLastMs = 0;
    this._memLogIntervalMs = 30_000;
    this._sessionStartMs = 0;
    /** @type {Record<string, { label: string, get: () => boolean, set: (v: boolean) => void }> | null} */
    this._perfToggleDefs = null;
    /** @type {Map<string, HTMLInputElement>} */
    this._perfToggleInputs = new Map();
    this._createElements();
  }

  _createElements() {
    this.element = document.createElement('section');
    this.element.id = 'renderer-mode-panel';
    Object.assign(this.element.style, {
      position: 'fixed',
      top: '20px',
      left: '20px',
      zIndex: '121',
      width: '320px',
      maxWidth: 'calc(100vw - 40px)',
      maxHeight: 'calc(100dvh - 40px)',
      padding: '12px',
      borderRadius: '12px',
      background: 'rgba(10, 12, 16, 0.86)',
      color: '#f4f4f4',
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.2',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      backdropFilter: 'blur(6px)',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      WebkitOverflowScrolling: 'touch',
      touchAction: 'pan-y',
      display: this.visible ? 'block' : 'none',
    });

    const title = document.createElement('div');
    title.textContent = 'PERFORMANCE';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      marginBottom: '6px',
      color: '#9ed7ff',
    });
    this.element.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Toggle with P · O = nav overlay · WebGL';
    Object.assign(hint.style, {
      color: '#b7c7d6',
      marginBottom: '10px',
      fontSize: '11px',
    });
    this.element.appendChild(hint);

    this.targetNote = document.createElement('div');
    Object.assign(this.targetNote.style, {
      color: '#b7c7d6',
      marginBottom: '8px',
    });
    this.targetNote.textContent = `FPS chart target: ${this.fpsTarget}`;
    this.element.appendChild(this.targetNote);

    this.perfTogglesSection = document.createElement('div');
    Object.assign(this.perfTogglesSection.style, {
      marginTop: '10px',
      padding: '8px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      display: 'none',
    });
    const perfTitle = document.createElement('div');
    perfTitle.textContent = 'DRAW / SCENE TOGGLES';
    Object.assign(perfTitle.style, {
      fontWeight: '700',
      letterSpacing: '0.06em',
      marginBottom: '8px',
      color: '#c9b8ff',
      fontSize: '11px',
    });
    this.perfTogglesSection.appendChild(perfTitle);
    this.perfTogglesRoot = document.createElement('div');
    Object.assign(this.perfTogglesRoot.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    });
    this.perfTogglesSection.appendChild(this.perfTogglesRoot);
    this.element.appendChild(this.perfTogglesSection);

    this._createPerformanceSection();
    this.container.appendChild(this.element);
  }

  /**
   * @param {Record<string, { label: string, get: () => boolean, set: (v: boolean) => void }>} definitions
   */
bindPerformanceToggles(definitions) {
    if (!definitions || typeof definitions !== 'object') return;
    this._perfToggleDefs = definitions;
    this.perfTogglesRoot.replaceChildren();
    this._perfToggleInputs.clear();

    const stored = readPerfTogglesFromStorage();
    for (const [key, def] of Object.entries(definitions)) {
      if (!def?.label || typeof def.get !== 'function' || typeof def.set !== 'function') continue;

      if (Object.prototype.hasOwnProperty.call(stored, key)) {
        def.set(!!stored[key]);
      }

      const row = document.createElement('label');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        color: '#d8e6f3',
        fontSize: '11px',
        lineHeight: '1.25',
      });

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!def.get();
      input.addEventListener('change', () => {
        def.set(input.checked);
        writePerfToggleToStorage(key, input.checked);
      });

      const text = document.createElement('span');
      text.textContent = def.label;

      row.appendChild(input);
      row.appendChild(text);
      this.perfTogglesRoot.appendChild(row);
      this._perfToggleInputs.set(key, input);
    }

    this.perfTogglesSection.style.display = this.perfTogglesRoot.childElementCount > 0 ? 'block' : 'none';
  }

  /** Sync checkboxes from live state (e.g. after O key changes nav overlay). */
  syncPerformanceToggleChecks() {
    if (!this._perfToggleDefs) return;
    for (const [key, def] of Object.entries(this._perfToggleDefs)) {
      const input = this._perfToggleInputs.get(key);
      if (input && typeof def.get === 'function') {
        input.checked = !!def.get();
      }
    }
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (this.element) {
      this.element.style.display = this.visible ? 'block' : 'none';
    }
  }

  toggleVisible() {
    this.setVisible(!this.visible);
  }

  _createPerformanceSection() {
    const section = document.createElement('div');
    Object.assign(section.style, {
      padding: '8px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
    });

    this.metrics = document.createElement('div');
    Object.assign(this.metrics.style, {
      display: 'grid',
      gap: '4px',
      marginBottom: '8px',
      color: '#d8e6f3',
    });
    section.appendChild(this.metrics);

    this.chart = document.createElement('canvas');
    this.chart.width = 288;
    this.chart.height = 92;
    Object.assign(this.chart.style, {
      width: '100%',
      height: '92px',
      display: 'block',
      background: 'rgba(0,0,0,0.22)',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.08)',
    });
    this.chartCtx = this.chart.getContext('2d');
    section.appendChild(this.chart);

    this.element.appendChild(section);
  }

  updatePerformance({
    timeMs = 0,
    deltaSeconds = 0,
    drawCalls = 0,
    triangles = 0,
    geometries = 0,
    textures = 0,
    programs = 0,
    bakeStats = null,
  } = {}) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;

    const now = timeMs;
    const fps = 1 / deltaSeconds;
    this.samples.push({ timeMs: now, fps, drawCalls, triangles });

    // Capture a baseline ~10s in (after initial GLB streaming settles), then
    // report deltas + log every 30s so leaks are visible without DevTools.
    if (this._sessionStartMs === 0) {
      this._sessionStartMs = now;
      this._memBaselineCaptureAtMs = now + 10_000;
    }
    if (this._memBaseline === null && now >= this._memBaselineCaptureAtMs) {
      this._memBaseline = { geometries, textures, programs };
      this._memLogLastMs = now;
      console.log('[mem] baseline', this._memBaseline);
    }
    if (this._memBaseline && (now - this._memLogLastMs) >= this._memLogIntervalMs) {
      this._memLogLastMs = now;
      const dG = geometries - this._memBaseline.geometries;
      const dT = textures - this._memBaseline.textures;
      const dP = programs - this._memBaseline.programs;
      const ageMin = ((now - this._sessionStartMs) / 60000).toFixed(1);
      // performance.memory is Chromium-only but invaluable when present.
      const heap = performance?.memory?.usedJSHeapSize
        ? ` heap=${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB`
        : '';
      console.log(
        `[mem] +${ageMin}min geo=${geometries}(Δ${dG >= 0 ? '+' : ''}${dG}) `
        + `tex=${textures}(Δ${dT >= 0 ? '+' : ''}${dT}) `
        + `prog=${programs}(Δ${dP >= 0 ? '+' : ''}${dP})${heap}`,
      );
    }

    while (this.samples.length > 1 && now - this.samples[0].timeMs > this.sampleWindowMs) {
      this.samples.shift();
    }

    const lastSample = this.samples[this.samples.length - 1];
    const totalTime = this.samples.length > 0
      ? Math.max(0.001, (lastSample.timeMs - this.samples[0].timeMs) / 1000)
      : 0.001;
    const avgFps = this.samples.reduce((sum, sample) => sum + sample.fps, 0) / this.samples.length;
    const drawCallsPerSecond = this.samples.reduce((sum, sample) => sum + sample.drawCalls, 0) / totalTime;
    const avgDrawCalls = this.samples.reduce((sum, sample) => sum + sample.drawCalls, 0) / this.samples.length;
    const avgTriangles = this.samples.reduce((sum, sample) => sum + (sample.triangles ?? 0), 0) / this.samples.length;

    this._renderPerformance(avgFps, avgDrawCalls, drawCallsPerSecond, avgTriangles, geometries, textures, programs, bakeStats);
  }

  _renderPerformance(avgFps, avgDrawCalls, drawCallsPerSecond, avgTriangles, geometries, textures, programs, bakeStats) {
    if (!this.chartCtx) return;

    const ctx = this.chartCtx;
    const { width, height } = this.chart;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const samples = this.samples;
    const maxValue = Math.max(
      this.fpsTarget,
      1,
      ...samples.map((sample) => sample.fps),
      ...samples.map((sample) => sample.drawCalls),
    );

    const targetY = height - 4 - ((this.fpsTarget / maxValue) * (height - 12));
    ctx.strokeStyle = 'rgba(158, 232, 178, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawLine = (getter, color) => {
      if (samples.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      samples.forEach((sample, index) => {
        const x = (index / (samples.length - 1)) * (width - 8) + 4;
        const value = getter(sample);
        const y = height - 4 - ((value / maxValue) * (height - 12));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    drawLine((sample) => sample.fps, '#9ee8b2');
    drawLine((sample) => sample.drawCalls, '#ffd97a');

    const fpsText = `Avg FPS: ${avgFps.toFixed(1)}`;
    const dcText = `Draw calls/frame: ${avgDrawCalls.toFixed(1)}`;
    const dcsText = `Draw calls/sec: ${drawCallsPerSecond.toFixed(1)}`;
    const triText = `Triangles: ${Math.round(avgTriangles).toLocaleString()}`;
    const fmtDelta = (v) => (v > 0 ? `+${v}` : `${v}`);
    const geoDelta = this._memBaseline ? ` (${fmtDelta(geometries - this._memBaseline.geometries)})` : '';
    const texDelta = this._memBaseline ? ` (${fmtDelta(textures - this._memBaseline.textures)})` : '';
    const progDelta = this._memBaseline ? ` (${fmtDelta(programs - this._memBaseline.programs)})` : '';
    const geoText = `Geometries: ${geometries}${geoDelta} · Textures: ${textures}${texDelta} · Programs: ${programs}${progDelta}`;

    const fpsMeasured = measureText(fpsText, METRICS_FONT, 288, METRICS_LINE_HEIGHT);
    const dcMeasured = measureText(dcText, METRICS_FONT, 288, METRICS_LINE_HEIGHT);
    const dcsMeasured = measureText(dcsText, METRICS_FONT, 288, METRICS_LINE_HEIGHT);
    const triMeasured = measureText(triText, METRICS_FONT, 288, METRICS_LINE_HEIGHT);
    const geoMeasured = measureText(geoText, METRICS_FONT, 288, METRICS_LINE_HEIGHT);

    let bakeHtml = '';
    if (bakeStats) {
      const saved = Math.max(0, (bakeStats.replacedDrawCalls ?? 0) - (bakeStats.bakedDrawCalls ?? 0));
      const bakeLine = `Bake: ${bakeStats.instancedGroups ?? 0} inst · ${bakeStats.mergedGroups ?? 0} merge · -${saved} dc`;
      const detailLine = `Inst prims: ${bakeStats.instancedPrimitives ?? 0} · Merge prims: ${bakeStats.mergedPrimitives ?? 0} · Skipped: ${bakeStats.skippedPrimitives ?? 0}`;
      const bakeMeasured = measureText(bakeLine, METRICS_FONT, 288, METRICS_LINE_HEIGHT);
      const detailMeasured = measureText(detailLine, METRICS_FONT, 288, METRICS_LINE_HEIGHT);
      bakeHtml = `
      <div style="height:${bakeMeasured.height}px">Bake: <span style="color:#9ee8b2">${bakeStats.instancedGroups ?? 0}</span> inst · <span style="color:#9ee8b2">${bakeStats.mergedGroups ?? 0}</span> merge · <span style="color:#9ee8b2">-${saved}</span> dc</div>
      <div style="height:${detailMeasured.height}px">Inst prims: <span style="color:#b7c7d6">${bakeStats.instancedPrimitives ?? 0}</span> · Merge prims: <span style="color:#b7c7d6">${bakeStats.mergedPrimitives ?? 0}</span> · Skipped: <span style="color:#b7c7d6">${bakeStats.skippedPrimitives ?? 0}</span></div>
      `;
    }

    this.metrics.innerHTML = `
      <div style="height:${fpsMeasured.height}px">Avg FPS: <span style="color:#9ee8b2">${avgFps.toFixed(1)}</span></div>
      <div style="height:${dcMeasured.height}px">Draw calls/frame: <span style="color:#ffd97a">${avgDrawCalls.toFixed(1)}</span></div>
      <div style="height:${dcsMeasured.height}px">Draw calls/sec: <span style="color:#ffd97a">${drawCallsPerSecond.toFixed(1)}</span></div>
      <div style="height:${triMeasured.height}px">Triangles: <span style="color:#c9b8ff">${Math.round(avgTriangles).toLocaleString()}</span></div>
      <div style="height:${geoMeasured.height}px">Geo: <span style="color:#b7c7d6">${geometries}</span><span style="color:#9ee8b2">${geoDelta}</span> · Tex: <span style="color:#b7c7d6">${textures}</span><span style="color:#9ee8b2">${texDelta}</span> · Prog: <span style="color:#b7c7d6">${programs}</span><span style="color:#9ee8b2">${progDelta}</span></div>
      ${bakeHtml}
    `;
  }

  dispose() {
    this.element?.remove();
  }
}
