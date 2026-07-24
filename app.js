"use strict";

const MAX_SELECTED = 6;
const SELECTION_COLORS = ["#1a5fb4", "#c2185b", "#7b1fa2", "#00838f", "#e65100", "#33691e"];
const PAPER_COMPOSITE_KEYS = ["score_rmse", "score_Ps", "score_Pv", "score_R", "score_Sfront", "score_Iratio"];

const state = {
  manifest: null,
  angle: null,
  data: null,        // parsed data/{angle}deg.json
  grid: null,        // Map "gi,pj" -> cell
  selected: [],       // [{gi,pj}], order = selection order = color order
  weights: {},        // score key -> 0..100
  overlays: { centroid: false, peak: false, runout: false, frontslope: false },
};

const els = {};

function $(id) { return document.getElementById(id); }

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function cellKey(gi, pj) { return gi + "," + pj; }

function selectionColor(index) { return SELECTION_COLORS[index % SELECTION_COLORS.length]; }

function selectionIndexOf(gi, pj) {
  return state.selected.findIndex((s) => s.gi === gi && s.pj === pj);
}

// ---------------- color scale (RdYlGn, low=good=green, high=bad=red) ----------------
const RDYLGN_STOPS = [
  [165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 139],
  [255, 255, 191], [217, 239, 139], [166, 217, 106], [102, 189, 99], [26, 152, 80], [0, 104, 55],
];

function rdylgnColor(t) {
  // t in [0,1], 0 = green (good), 1 = red (bad)
  t = Math.max(0, Math.min(1, t));
  const stops = RDYLGN_STOPS.slice().reverse();
  const n = stops.length - 1;
  const pos = t * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const frac = pos - i;
  const a = stops[i], b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * frac);
  const g = Math.round(a[1] + (b[1] - a[1]) * frac);
  const bch = Math.round(a[2] + (b[2] - a[2]) * frac);
  return `rgb(${r},${g},${bch})`;
}

// ---------------- custom weighted score ----------------

function customScore(cell) {
  if (!cell.scores) return null;
  let num = 0, den = 0;
  for (const key in state.weights) {
    const w = state.weights[key];
    const v = cell.scores[key];
    if (w > 0 && v !== null && v !== undefined) {
      num += w * v;
      den += w;
    }
  }
  return den > 0 ? num / den : null;
}

// ---------------- data loading ----------------

async function loadManifest() {
  const res = await fetch("data/manifest.json");
  state.manifest = await res.json();
  (state.manifest.score_meta || []).forEach((m) => {
    state.weights[m.key] = PAPER_COMPOSITE_KEYS.includes(m.key) ? 100 : 0;
  });
}

async function loadAngle(angle) {
  els.heatmapWrap.classList.add("is-loading");
  els.status.textContent = "Loading " + angle + "°…";
  const res = await fetch(`data/${angle}deg.json`);
  const data = await res.json();
  state.angle = angle;
  state.data = data;
  state.grid = new Map();
  data.cells.forEach((c) => {
    const gi = data.gmod_vals.findIndex((g) => Math.abs(g - c.gmod) < 1e-4);
    const pj = data.phi_vals.findIndex((p) => Math.abs(p - c.phi) < 1e-4);
    state.grid.set(cellKey(gi, pj), { ...c, gi, pj });
  });

  // select the best-combined cell by default
  let best = null;
  state.grid.forEach((c) => { if (!best || c.combined < best.combined) best = c; });
  state.selected = best ? [{ gi: best.gi, pj: best.pj }] : [];

  els.status.textContent = "";
  els.heatmapWrap.classList.remove("is-loading");
  renderAll();
}

// ---------------- heatmap rendering ----------------

function bestCell() {
  let best = null;
  state.grid.forEach((c) => { if (!best || c.combined < best.combined) best = c; });
  return best;
}

function metricRange() {
  // custom score is 0-100, higher is better
  const vals = [];
  state.grid.forEach((c) => {
    const v = customScore(c);
    if (v !== null && v !== undefined && isFinite(v)) vals.push(v);
  });
  vals.sort((a, b) => a - b);
  if (!vals.length) return [0, 1];
  const lo = vals[Math.ceil(vals.length * 0.1)] ?? vals[0];
  const hi = vals[vals.length - 1];
  return [lo, Math.max(hi, lo + 0.01)];
}

function drawHeatmap() {
  const canvas = els.heatmap;
  const data = state.data;
  const nG = data.gmod_vals.length, nP = data.phi_vals.length;
  const size = Math.min(560, canvas.parentElement.clientWidth);
  const cell = Math.floor(size / nG);
  const w = cell * nG, h = cell * nP;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const [lo, hi] = metricRange();

  for (let gi = 0; gi < nG; gi++) {
    for (let pj = 0; pj < nP; pj++) {
      const c = state.grid.get(cellKey(gi, pj));
      const x = gi * cell;
      const y = (nP - 1 - pj) * cell; // phi increases upward
      if (!c) {
        ctx.fillStyle = cssVar("--line");
        ctx.fillRect(x, y, cell, cell);
        continue;
      }
      const v = customScore(c);
      if (v === null || v === undefined || !isFinite(v)) {
        ctx.fillStyle = cssVar("--line");
        ctx.fillRect(x, y, cell, cell);
        continue;
      }
      const t = 1 - (v - lo) / (hi - lo); // higher score = greener
      ctx.fillStyle = rdylgnColor(t);
      ctx.fillRect(x, y, cell, cell);
    }
  }

  // best-cell marker (always by combined score, regardless of display metric)
  const best = bestCell();
  if (best) {
    const bx = best.gi * cell + cell / 2;
    const by = (nP - 1 - best.pj) * cell + cell / 2;
    drawStar(ctx, bx, by, Math.max(5, cell * 0.28), cssVar("--focus"));
  }

  // selection outlines, one colour per selected cell
  state.selected.forEach((s, idx) => {
    const selX = s.gi * cell, selY = (nP - 1 - s.pj) * cell;
    ctx.strokeStyle = selectionColor(idx);
    ctx.lineWidth = 3;
    ctx.strokeRect(selX + 1.5, selY + 1.5, cell - 3, cell - 3);
  });

  els.heatmapMeta.textContent =
    `gmod ${data.gmod_vals[0].toFixed(1)}–${data.gmod_vals[nG - 1].toFixed(1)} MPa  ×  ` +
    `phi ${data.phi_vals[0].toFixed(2)}–${data.phi_vals[nP - 1].toFixed(2)} rad`;

  canvas.dataset.cell = cell;
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = (Math.PI / 5) * (2 * i) - Math.PI / 2;
    const a2 = (Math.PI / 5) * (2 * i + 1) - Math.PI / 2;
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.lineTo(Math.cos(a2) * r * 0.42, Math.sin(a2) * r * 0.42);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = cssVar("--surface-raised");
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function heatmapPick(evt) {
  const canvas = els.heatmap;
  const rect = canvas.getBoundingClientRect();
  const cell = parseFloat(canvas.dataset.cell);
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;
  const data = state.data;
  const nP = data.phi_vals.length;
  const gi = Math.max(0, Math.min(data.gmod_vals.length - 1, Math.floor(x / cell)));
  const pj = Math.max(0, Math.min(nP - 1, nP - 1 - Math.floor(y / cell)));
  if (!state.grid.has(cellKey(gi, pj))) return;

  const idx = selectionIndexOf(gi, pj);
  if (idx >= 0) {
    state.selected.splice(idx, 1); // toggle off
  } else {
    if (state.selected.length >= MAX_SELECTED) state.selected.shift(); // drop oldest
    state.selected.push({ gi, pj });
  }
  renderAll();
}

// ---------------- detail (particle) plot ----------------

function drawDetail() {
  const canvas = els.detail;
  const data = state.data;
  const wrapW = canvas.parentElement.clientWidth;
  const w = Math.min(680, wrapW);
  const h = Math.round(w * 0.62);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const wallX = (data.wall_segments || []).flatMap((s) => s.x);
  const wallZ = (data.wall_segments || []).flatMap((s) => s.z);
  const allX = data.exp_x.concat(wallX);
  let xMin = -0.25, xMax = Math.max(1.1, Math.max(...allX) + 0.15);
  const floorZ = wallZ.length ? Math.min(...wallZ) : -Infinity;
  let zMin = -0.08, zMax = 0.38;

  const padL = 42, padR = 14, padT = 10, padB = 26;
  const availW = w - padL - padR;
  const availH = h - padT - padB;
  const scale = Math.min(availW / (xMax - xMin), availH / (zMax - zMin));
  const plotW = (xMax - xMin) * scale;
  const plotH = (zMax - zMin) * scale;
  const originX = padL + (availW - plotW) / 2;
  const originY = padT + (availH - plotH) / 2;

  const sx = (x) => originX + (x - xMin) * scale;
  const sy = (z) => originY + plotH - (z - zMin) * scale;

  ctx.strokeStyle = cssVar("--line");
  ctx.lineWidth = 1;
  ctx.font = "10.5px Arial, Helvetica, sans-serif";
  ctx.fillStyle = cssVar("--ink-faint");
  for (let xv = Math.ceil(xMin * 5) / 5; xv <= xMax; xv += 0.2) {
    const px = sx(xv);
    ctx.beginPath(); ctx.moveTo(px, originY); ctx.lineTo(px, originY + plotH); ctx.stroke();
    ctx.fillText(xv.toFixed(1), px - 8, originY + plotH + 14);
  }
  for (let zv = 0; zv <= zMax; zv += 0.1) {
    const py = sy(zv);
    ctx.beginPath(); ctx.moveTo(originX, py); ctx.lineTo(originX + plotW, py); ctx.stroke();
    ctx.fillText(zv.toFixed(2), 2, py + 3);
  }

  // wall -- slide and floor are separate physical parts; draw each
  // segment as its own polyline so they never connect to each other.
  ctx.strokeStyle = cssVar("--ink-faint");
  ctx.lineWidth = 2;
  (data.wall_segments || []).forEach((seg) => {
    ctx.beginPath();
    seg.x.forEach((x, i) => {
      const px = sx(x), py = sy(seg.z[i]);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  // simulated particles, one colour per selected cell (below-floor hidden)
  state.selected.forEach((s, idx) => {
    const c = state.grid.get(cellKey(s.gi, s.pj));
    if (!c) return;
    const [r, g, b] = hexToRgb(selectionColor(idx));
    ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
    for (let i = 0; i < c.px.length; i++) {
      if (c.pz[i] < floorZ) continue;
      const px = sx(c.px[i]), py = sy(c.pz[i]);
      if (px < 0 || px > w || py < 0 || py > h) continue;
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // experiment curve, drawn last so it stays legible over particles
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  data.exp_x.forEach((x, i) => {
    const px = sx(x), py = sy(data.exp_z[i]);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();

  // geometry overlays (centroid/peak/runout/front-slope), on top of everything
  const anyOverlay = Object.values(state.overlays).some(Boolean);
  if (anyOverlay) {
    if (data.exp_geo) drawGeoSet(ctx, sx, sy, data.exp_geo, "#000000", floorZ, data.z_th, data.exp_x[0]);
    state.selected.forEach((s, idx) => {
      const c = state.grid.get(cellKey(s.gi, s.pj));
      if (c && c.geo) drawGeoSet(ctx, sx, sy, c.geo, selectionColor(idx), floorZ, data.z_th, data.exp_x[0]);
    });
  }

  ctx.strokeStyle = cssVar("--line-strong");
  ctx.lineWidth = 1.2;
  ctx.strokeRect(originX, originY, plotW, plotH);
}

// geo = {cs, cv, ps, pv, r, sf_k, sf_b[, xfront]}; xfront lives on exp_geo only,
// so front-slope re-uses exp_geo.xfront for every series (sim and exp share
// the same front-region x-window by construction).
function drawGeoSet(ctx, sx, sy, geo, color, floorZ, zTh, xDomainMin) {
  const xfront = (state.data.exp_geo && state.data.exp_geo.xfront != null) ? state.data.exp_geo.xfront : null;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  if (state.overlays.centroid && geo.cs != null && geo.cv != null) {
    drawDiamond(ctx, sx(geo.cs), sy(geo.cv), 5);
  }
  if (state.overlays.peak && geo.ps != null && geo.pv != null) {
    drawTriangle(ctx, sx(geo.ps), sy(geo.pv), 6);
  }
  if (state.overlays.runout && geo.r != null) {
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx(geo.r), sy(floorZ));
    ctx.lineTo(sx(geo.r), sy(zTh));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.overlays.frontslope && geo.sf_k != null && geo.sf_b != null && xfront != null) {
    const x0 = xDomainMin, x1 = xfront;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sx(x0), sy(geo.sf_k * x0 + geo.sf_b));
    ctx.lineTo(sx(x1), sy(geo.sf_k * x1 + geo.sf_b));
    ctx.stroke();
  }
  ctx.restore();
}

function drawDiamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function drawTriangle(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------- readouts ----------------

function renderReadouts() {
  const info = state.manifest.angles.find((a) => a.angle === state.angle);
  if (info) {
    els.bestGmod.textContent = info.best_gmod.toFixed(2) + " MPa";
    els.bestPhi.textContent = info.best_phi.toFixed(3) + " rad";
    els.bestRmse.textContent = info.best_rmse.toFixed(2) + " cm";
    els.bestCombined.textContent = info.best_combined.toFixed(2) + " cm";
  }

  els.compareBody.innerHTML = "";
  if (!state.selected.length) {
    els.compareEmpty.style.display = "block";
    return;
  }
  els.compareEmpty.style.display = "none";

  state.selected.forEach((s, idx) => {
    const c = state.grid.get(cellKey(s.gi, s.pj));
    if (!c) return;
    const cs = customScore(c);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="chip" style="background:${selectionColor(idx)}"></span></td>
      <td class="num">${c.gmod.toFixed(2)}</td>
      <td class="num">${c.phi.toFixed(3)}</td>
      <td class="num">${c.rmse.toFixed(2)}</td>
      <td class="num">${c.combined.toFixed(2)}</td>
      <td class="num">${cs === null ? "–" : cs.toFixed(1)}</td>
    `;
    els.compareBody.appendChild(tr);
  });
}

function renderAll() {
  drawHeatmap();
  drawDetail();
  renderReadouts();
}

// ---------------- angle rail ----------------

function renderAngleList() {
  els.angleList.innerHTML = "";
  state.manifest.angles.forEach((a) => {
    const btn = document.createElement("button");
    btn.className = "angle-btn";
    btn.disabled = a.n_cells === 0;
    btn.innerHTML = `<span class="deg display">${a.angle}°</span>` +
      `<span class="status mono">${a.n_cells ? a.n_cells + " pts" : "pending"}</span>`;
    btn.addEventListener("click", () => {
      if (a.n_cells === 0) return;
      document.querySelectorAll(".angle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadAngle(a.angle);
    });
    els.angleList.appendChild(btn);
    if (a.angle === state.angle) btn.classList.add("active");
  });
}

// ---------------- scoring panel ----------------

function renderScoringPanel() {
  els.scoreRows.innerHTML = "";
  (state.manifest.score_meta || []).forEach((m) => {
    const row = document.createElement("div");
    row.className = "score-row";
    const w = state.weights[m.key] ?? 0;
    row.innerHTML = `
      <label class="score-label" for="w_${m.key}">${m.label}</label>
      <input type="range" min="0" max="100" step="5" value="${w}" id="w_${m.key}" data-key="${m.key}" />
      <span class="score-val num" id="wv_${m.key}">${w}</span>
    `;
    els.scoreRows.appendChild(row);
    row.querySelector("input").addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      state.weights[m.key] = val;
      $("wv_" + m.key).textContent = val;
      drawHeatmap();
      renderReadouts();
    });
  });
}

function applyPreset(preset) {
  (state.manifest.score_meta || []).forEach((m) => {
    if (preset === "paper") state.weights[m.key] = PAPER_COMPOSITE_KEYS.includes(m.key) ? 100 : 0;
    else if (preset === "equal") state.weights[m.key] = 100;
    else if (preset === "clear") state.weights[m.key] = 0;
  });
  renderScoringPanel();
  drawHeatmap();
  renderReadouts();
}

// ---------------- init ----------------

async function init() {
  els.angleList = $("angleList");
  els.heatmap = $("heatmapCanvas");
  els.heatmapWrap = $("heatmapWrap");
  els.heatmapMeta = $("heatmapMeta");
  els.detail = $("detailCanvas");
  els.status = $("status");
  els.bestGmod = $("bestGmod");
  els.bestPhi = $("bestPhi");
  els.bestRmse = $("bestRmse");
  els.bestCombined = $("bestCombined");
  els.compareBody = $("compareBody");
  els.compareEmpty = $("compareEmpty");
  els.scoreRows = $("scoreRows");

  els.heatmap.addEventListener("click", heatmapPick);

  $("presetPaper").addEventListener("click", () => applyPreset("paper"));
  $("presetEqual").addEventListener("click", () => applyPreset("equal"));
  $("presetClear").addEventListener("click", () => applyPreset("clear"));

  document.querySelectorAll("#overlayToggles input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      state.overlays[cb.dataset.overlay] = cb.checked;
      if (state.data) drawDetail();
    });
  });

  window.addEventListener("resize", () => { if (state.data) renderAll(); });

  await loadManifest();
  renderAngleList();
  renderScoringPanel();
  const first = state.manifest.angles.find((a) => a.n_cells > 0);
  if (first) await loadAngle(first.angle);
}

init();
