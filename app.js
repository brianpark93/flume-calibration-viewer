"use strict";

const state = {
  manifest: null,
  angle: null,
  data: null,       // parsed data/{angle}deg.json
  grid: null,       // Map "gi,pj" -> cell
  gi: 0, pj: 0,      // selected cell indices
  metric: "combined", // "combined" | "rmse"
  theme: null,
};

const els = {};

function $(id) { return document.getElementById(id); }

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------------- color scale (RdYlGn, low=good=green, high=bad=red) ----------------
const RDYLGN = [
  [0.00, [0o0, 0, 0]], // placeholder replaced below
];
const RDYLGN_STOPS = [
  [165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 139],
  [255, 255, 191], [217, 239, 139], [166, 217, 106], [102, 189, 99], [26, 152, 80], [0, 104, 55],
];

function rdylgnColor(t) {
  // t in [0,1], 0 = green (good), 1 = red (bad) -> reverse stop order
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

// ---------------- data loading ----------------

async function loadManifest() {
  const res = await fetch("data/manifest.json");
  state.manifest = await res.json();
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
    state.grid.set(gi + "," + pj, { ...c, gi, pj });
  });

  // select the best-combined cell by default
  let best = null;
  state.grid.forEach((c) => { if (!best || c.combined < best.combined) best = c; });
  state.gi = best.gi;
  state.pj = best.pj;

  els.status.textContent = "";
  els.heatmapWrap.classList.remove("is-loading");
  renderAll();
}

// ---------------- heatmap rendering ----------------

function metricRange() {
  const key = state.metric;
  const vals = Array.from(state.grid.values()).map((c) => c[key]).filter((v) => isFinite(v));
  vals.sort((a, b) => a - b);
  const lo = vals[0];
  const hi = vals[Math.floor(vals.length * 0.9)];
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
      const c = state.grid.get(gi + "," + pj);
      const x = gi * cell;
      const y = (nP - 1 - pj) * cell; // phi increases upward
      if (!c) {
        ctx.fillStyle = cssVar("--line");
        ctx.fillRect(x, y, cell, cell);
        continue;
      }
      const t = (c[state.metric] - lo) / (hi - lo);
      ctx.fillStyle = rdylgnColor(t);
      ctx.fillRect(x, y, cell, cell);
    }
  }

  // best-cell marker
  let best = null;
  state.grid.forEach((c) => { if (!best || c.combined < best.combined) best = c; });
  if (best) {
    const bx = best.gi * cell + cell / 2;
    const by = (nP - 1 - best.pj) * cell + cell / 2;
    drawStar(ctx, bx, by, Math.max(5, cell * 0.28), cssVar("--focus"));
  }

  // selection outline
  const selX = state.gi * cell, selY = (nP - 1 - state.pj) * cell;
  ctx.strokeStyle = cssVar("--ink");
  ctx.lineWidth = 2;
  ctx.strokeRect(selX + 1, selY + 1, cell - 2, cell - 2);

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
  if (state.grid.has(gi + "," + pj)) {
    state.gi = gi;
    state.pj = pj;
    renderAll();
  }
}

// ---------------- detail (particle) plot ----------------

function drawDetail() {
  const canvas = els.detail;
  const data = state.data;
  const c = state.grid.get(state.gi + "," + state.pj);
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

  // domain: fixed per angle so the view doesn't jump between cells
  const allX = data.exp_x.concat(data.wall_x.length ? data.wall_x : []);
  const allZ = data.exp_z.concat(data.wall_z.length ? data.wall_z : []);
  let xMin = -0.25, xMax = Math.max(1.1, Math.max(...allX) + 0.15);
  let zMin = -0.08, zMax = 0.38;

  const pad = 34;
  const sx = (x) => pad + ((x - xMin) / (xMax - xMin)) * (w - pad * 1.4);
  const sy = (z) => h - pad - ((z - zMin) / (zMax - zMin)) * (h - pad * 1.6);

  // grid
  ctx.strokeStyle = cssVar("--line");
  ctx.lineWidth = 1;
  ctx.font = "10.5px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillStyle = cssVar("--ink-faint");
  for (let xv = Math.ceil(xMin * 5) / 5; xv <= xMax; xv += 0.2) {
    const px = sx(xv);
    ctx.beginPath(); ctx.moveTo(px, pad * 0.3); ctx.lineTo(px, h - pad); ctx.stroke();
    ctx.fillText(xv.toFixed(1), px - 8, h - pad + 14);
  }
  for (let zv = 0; zv <= zMax; zv += 0.1) {
    const py = sy(zv);
    ctx.beginPath(); ctx.moveTo(pad, py); ctx.lineTo(w - pad * 0.4, py); ctx.stroke();
    ctx.fillText(zv.toFixed(2), 2, py + 3);
  }

  // wall
  if (data.wall_x.length) {
    ctx.strokeStyle = cssVar("--ink-faint");
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.wall_x.forEach((x, i) => {
      const px = sx(x), py = sy(data.wall_z[i]);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // simulated particles
  if (c) {
    ctx.fillStyle = "rgba(168, 83, 46, 0.45)";
    for (let i = 0; i < c.px.length; i++) {
      const px = sx(c.px[i]), py = sy(c.pz[i]);
      if (px < 0 || px > w || py < 0 || py > h) continue;
      ctx.beginPath();
      ctx.arc(px, py, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // experiment curve
  ctx.strokeStyle = cssVar("--focus");
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  data.exp_x.forEach((x, i) => {
    const px = sx(x), py = sy(data.exp_z[i]);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.fillStyle = cssVar("--focus");
  data.exp_x.forEach((x, i) => {
    const px = sx(x), py = sy(data.exp_z[i]);
    ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill();
  });

  // axis border
  ctx.strokeStyle = cssVar("--line-strong");
  ctx.lineWidth = 1.2;
  ctx.strokeRect(pad, pad * 0.3, w - pad * 1.4 - pad, h - pad - pad * 0.3);
}

// ---------------- readouts ----------------

function renderReadouts() {
  const c = state.grid.get(state.gi + "," + state.pj);
  if (!c) return;
  els.statGmod.textContent = c.gmod.toFixed(2) + " MPa";
  els.statPhi.textContent = c.phi.toFixed(3) + " rad";
  els.statRmse.textContent = c.rmse.toFixed(2) + " cm";
  els.statCombined.textContent = c.combined.toFixed(2) + " cm";

  const info = state.manifest.angles.find((a) => a.angle === state.angle);
  if (info) {
    els.bestGmod.textContent = info.best_gmod.toFixed(2) + " MPa";
    els.bestPhi.textContent = info.best_phi.toFixed(3) + " rad";
    els.bestRmse.textContent = info.best_rmse.toFixed(2) + " cm";
    els.bestCombined.textContent = info.best_combined.toFixed(2) + " cm";
  }
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

// ---------------- init ----------------

async function init() {
  els.angleList = $("angleList");
  els.heatmap = $("heatmapCanvas");
  els.heatmapWrap = $("heatmapWrap");
  els.heatmapMeta = $("heatmapMeta");
  els.detail = $("detailCanvas");
  els.status = $("status");
  els.statGmod = $("statGmod");
  els.statPhi = $("statPhi");
  els.statRmse = $("statRmse");
  els.statCombined = $("statCombined");
  els.bestGmod = $("bestGmod");
  els.bestPhi = $("bestPhi");
  els.bestRmse = $("bestRmse");
  els.bestCombined = $("bestCombined");
  els.metricBtns = document.querySelectorAll(".metric-toggle button");

  els.heatmap.addEventListener("click", heatmapPick);
  els.heatmap.addEventListener("mousemove", (e) => { if (e.buttons === 1) heatmapPick(e); });

  els.metricBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.metricBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.metric = btn.dataset.metric;
      drawHeatmap();
    });
  });

  window.addEventListener("resize", () => { if (state.data) renderAll(); });

  await loadManifest();
  renderAngleList();
  const first = state.manifest.angles.find((a) => a.n_cells > 0);
  if (first) await loadAngle(first.angle);
}

init();
