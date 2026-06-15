// app.js — Spotkick frontend controller
// Laget av Mohibb Malik, 2025

import {
  loadData, applyFilters, summary, zoneStats, bySeason,
  takerProfile, uniqueValues, ZONE_LABEL, byPressureBucket, pressureByTaker,
} from './data.js';

const EMOJI = { goal: '⚽', saved: '🧤', missed: '✗' };
const ZONE_ORDER = ['TL','TC','TR','ML','MC','MR','BL','BC','BR'];

const state = {
  filters: { competition: 'all', season: 'all', taker: null, keeper: null, team: null, outcomes: new Set(), zone: null },
  visibleRows: 8,
};

async function init() {
  const data = await loadData();
  if (!data.length) {
    document.body.innerHTML = '<div class="empty">No data loaded. Run the build script or check that penalties.json exists.</div>';
    return;
  }
  populateFilterOptions();
  render();
  wireEvents();
}

function render() {
  const rows = applyFilters(state.filters);
  renderTopbarCount(rows.length);
  renderChips();
  renderStats(rows);
  renderHeatmap(rows);
  renderPlayer(rows);
  renderTrend(rows);
  renderPressure(rows);
  renderPressureTakers(rows);
  renderPenalties(rows);
}

function renderTopbarCount(n) {
  document.getElementById('topbarCount').textContent =
    `${n.toLocaleString()} penalt${n === 1 ? 'y' : 'ies'}`;
}

function renderChips() {
  const f = state.filters;
  const set = (id, label, active) => {
    const el = document.getElementById(id);
    el.textContent = label;
    el.classList.toggle('active', active);
  };
  set('chipComp', f.competition === 'all' ? 'All competitions' : f.competition, f.competition !== 'all');
  set('chipSeason', f.season === 'all' ? 'All seasons' : f.season, f.season !== 'all');
  set('chipOutcome', f.outcomes.size ? [...f.outcomes].join(', ') : 'All outcomes', f.outcomes.size > 0);
  set('chipTaker', f.taker || 'Any taker', !!f.taker);
  set('chipKeeper', f.keeper || 'Any keeper', !!f.keeper);
}

function renderStats(rows) {
  const s = summary(rows);
  document.getElementById('statConversion').textContent = s.conversion.toFixed(1) + '%';
  document.getElementById('statConversionSub').textContent = `${s.goals.toLocaleString()} goals from ${s.total.toLocaleString()}`;
  document.getElementById('statTotal').textContent = s.total.toLocaleString();
  document.getElementById('statTotalSub').textContent = `${s.takers.toLocaleString()} unique takers`;
  document.getElementById('statSaved').textContent = s.savedPct.toFixed(1) + '%';
  document.getElementById('statSavedSub').textContent = s.saved.toLocaleString();
  document.getElementById('statMissed').textContent = s.missedPct.toFixed(1) + '%';
  document.getElementById('statMissedSub').textContent = s.missed.toLocaleString();
  document.getElementById('statPI').textContent = s.avgPI.toFixed(0);
  document.getElementById('statPISub').textContent = 'avg index';
}

function heatClass(pct, n) {
  if (!n) return 'zh-0';
  if (pct >= 85) return 'zh-h';
  if (pct >= 78) return 'zh-mh';
  if (pct >= 68) return 'zh-m';
  if (pct >= 58) return 'zh-ml';
  return 'zh-l';
}

function renderHeatmap(rows) {
  const z = zoneStats(rows);
  const grid = document.getElementById('zoneGrid');
  grid.innerHTML = ZONE_ORDER.map(key => {
    const cell = z[key];
    const cls = heatClass(cell.pct, cell.n);
    const sel = state.filters.zone === key ? ' selected' : '';
    const pct = cell.n ? Math.round(cell.pct) + '%' : '–';
    return `<div class="zone ${cls}${sel}" data-zone="${key}">
      <span class="z-pct">${pct}</span>
      <span class="z-n">${cell.n} shot${cell.n === 1 ? '' : 's'}</span>
    </div>`;
  }).join('');
  grid.querySelectorAll('.zone').forEach(el => {
    el.addEventListener('click', () => {
      state.filters.zone = state.filters.zone === el.dataset.zone ? null : el.dataset.zone;
      render();
    });
  });
}

function renderPlayer(rows) {
  // Show profile for the filtered taker, else the most frequent taker in view.
  let taker = state.filters.taker;
  if (!taker) {
    const counts = {};
    for (const p of rows) counts[p.taker] = (counts[p.taker] || 0) + 1;
    taker = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  const card = document.getElementById('playerCard');
  if (!taker) { card.style.display = 'none'; return; }
  card.style.display = '';

  const prof = takerProfile(taker);
  if (!prof) { card.style.display = 'none'; return; }

  const initials = prof.taker.split(/[\s.]+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('playerInitials').textContent = initials;
  document.getElementById('playerName').textContent = prof.taker;
  document.getElementById('playerSub').textContent = prof.team;
  document.getElementById('playerTaken').textContent = prof.taken;
  document.getElementById('playerGoals').textContent = prof.goals;
  document.getElementById('playerRate').textContent = Math.round(prof.rate) + '%';
  document.getElementById('playerFavoured').textContent = prof.favoured;

  const maxN = Math.max(...prof.h2h.map(h => h.n), 1);
  document.getElementById('h2hList').innerHTML = prof.h2h.slice(0, 5).map(h => {
    const pct = (h.goals / h.n) * 100;
    const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<div class="h2h-row">
      <span class="h2h-keeper">${h.keeper}</span>
      <div class="h2h-right">
        <div class="h2h-bar-wrap"><div class="h2h-bar-fill" style="width:${(h.n / maxN) * 100}%;background:${color};"></div></div>
        <span class="h2h-score" style="color:${color};">${h.goals}/${h.n}</span>
      </div>
    </div>`;
  }).join('');
}

function renderTrend(rows) {
  const data = bySeason(rows);
  const canvas = document.getElementById('trendCanvas');
  if (!canvas || !data.length) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth - 32;
  const H = 110;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const padL = 28, padR = 8, padT = 8, padB = 22;
  const pW = W - padL - padR, pH = H - padT - padB;
  const minV = 50, maxV = 100;
  const n = data.length;
  const tx = i => n === 1 ? padL + pW / 2 : padL + (i / (n - 1)) * pW;
  const ty = v => padT + pH - ((v - minV) / (maxV - minV)) * pH;

  [60, 70, 80, 90].forEach(v => {
    const y = ty(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
    ctx.strokeStyle = '#C9C0AE'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui";
    ctx.textAlign = 'right'; ctx.fillText(v + '%', padL - 3, y + 3);
  });

  ctx.beginPath();
  data.forEach((d, i) => i === 0 ? ctx.moveTo(tx(i), ty(d.pct)) : ctx.lineTo(tx(i), ty(d.pct)));
  ctx.lineTo(tx(n - 1), padT + pH); ctx.lineTo(tx(0), padT + pH); ctx.closePath();
  ctx.fillStyle = 'rgba(180,71,31,0.10)'; ctx.fill();

  ctx.beginPath();
  data.forEach((d, i) => i === 0 ? ctx.moveTo(tx(i), ty(d.pct)) : ctx.lineTo(tx(i), ty(d.pct)));
  ctx.strokeStyle = '#B4471F'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  data.forEach((d, i) => { ctx.beginPath(); ctx.arc(tx(i), ty(d.pct), 3, 0, Math.PI * 2); ctx.fillStyle = '#B4471F'; ctx.fill(); });

  ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui"; ctx.textAlign = 'center';
  data.forEach((d, i) => ctx.fillText(d.season.replace(/^20/, '').replace('/20', '/'), tx(i), H - 4));
}

function renderPressure(rows) {
  const buckets = byPressureBucket(rows).filter(b => b.n);
  const canvas = document.getElementById('pressureCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth - 32;
  const H = 160;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!buckets.length) {
    ctx.fillStyle = '#8C8475'; ctx.font = "italic 12px 'Newsreader',serif"; ctx.textAlign = 'center';
    ctx.fillText('Not enough data for this view', W / 2, H / 2);
    return;
  }

  const padL = 32, padR = 8, padT = 18, padB = 32;
  const pW = W - padL - padR, pH = H - padT - padB;
  const n = buckets.length;
  const bw = pW / n;
  const tx = i => padL + i * bw;
  const ty = v => padT + pH - (v / 100) * pH;

  [0, 25, 50, 75, 100].forEach(v => {
    const y = ty(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
    ctx.strokeStyle = '#C9C0AE'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui";
    ctx.textAlign = 'right'; ctx.fillText(v + '%', padL - 5, y + 3);
  });

  // Bars: conversion % per pressure band, labelled with value and sample size.
  buckets.forEach((b, i) => {
    const x = tx(i) + bw * 0.15, w = bw * 0.7;
    const y = ty(b.pct);
    ctx.fillStyle = 'rgba(180,71,31,0.18)';
    ctx.fillRect(x, y, w, padT + pH - y);
    ctx.strokeStyle = '#B4471F'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, padT + pH - y);

    ctx.fillStyle = '#211D17'; ctx.font = "700 11px 'Plus Jakarta Sans',system-ui"; ctx.textAlign = 'center';
    ctx.fillText(Math.round(b.pct) + '%', x + w / 2, Math.max(12, y - 6));

    ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui";
    ctx.fillText(`${b.lo}–${b.hi} (n=${b.n})`, tx(i) + bw / 2, H - 4);
  });
}

let pressureTakerPoints = [];

// Global reference stats: avg pressure index + conversion %, ignoring the
// taker filter (but respecting any other active filters).
function globalPressureStats() {
  const rows = applyFilters({ ...state.filters, taker: null });
  if (!rows.length) return null;
  const avgPI = rows.reduce((s, p) => s + p.pressureIndex, 0) / rows.length;
  const avgConv = summary(rows).conversion;
  return { avgPI, avgConv };
}

function renderPressureTakers(rows) {
  const canvas = document.getElementById('pressureTakerCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth;
  const H = W * 3 / 4;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  pressureTakerPoints = [];

  const padL = 32, padR = 8, padT = 8, padB = 28;
  const pW = W - padL - padR, pH = H - padT - padB;
  const tx = v => padL + (v / 100) * pW;
  const ty = v => padT + pH - (v / 100) * pH;

  const drawAxes = () => {
    [0, 25, 50, 75, 100].forEach(v => {
      const y = ty(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
      ctx.strokeStyle = '#C9C0AE'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui";
      ctx.textAlign = 'right'; ctx.fillText(v + '%', padL - 5, y + 3);
    });
    [0, 25, 50, 75, 100].forEach(v => {
      const x = tx(v);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + pH); ctx.strokeStyle = '#E7E1D4'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui";
      ctx.textAlign = 'center'; ctx.fillText(v, x, padT + pH + 12);
    });
    ctx.fillStyle = '#8C8475'; ctx.font = "500 9px 'Plus Jakarta Sans',system-ui"; ctx.textAlign = 'center';
    ctx.fillText('Pressure index', padL + pW / 2, H - 4);
  };

  const drawRefLines = (avgConv, avgPI, color) => {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    const ay = ty(avgConv);
    ctx.beginPath(); ctx.moveTo(padL, ay); ctx.lineTo(W - padR, ay); ctx.stroke();
    const ax = tx(avgPI);
    ctx.beginPath(); ctx.moveTo(ax, padT); ctx.lineTo(ax, padT + pH); ctx.stroke();
    ctx.restore();
  };

  const single = state.filters.taker;
  const title = document.getElementById('pressureTakerTitle');
  const legend = document.getElementById('pressureTakerLegend');
  document.getElementById('minSampleGroup').style.display = single ? 'none' : '';

  if (single) {
    // Per-penalty view for one player: x = pressure index, y = outcome (jittered).
    title.textContent = `${single}'s penalties by pressure`;
    legend.innerHTML = `
      <div class="tl-item"><div class="gl-dot zh-h"></div>Goal</div>
      <div class="tl-item"><div class="gl-dot zh-l"></div>Saved/missed</div>
      <div class="tl-item"><div class="tl-line tl-line-accent"></div>This player's avg conversion / pressure</div>
      <div class="tl-item"><div class="tl-line tl-line-muted"></div>Global avg conversion / pressure</div>`;

    if (!rows.length) {
      ctx.fillStyle = '#8C8475'; ctx.font = "italic 12px 'Newsreader',serif"; ctx.textAlign = 'center';
      ctx.fillText('Not enough data for this view', W / 2, H / 2);
      return;
    }

    drawAxes();

    const global = globalPressureStats();
    if (global) drawRefLines(global.avgConv, global.avgPI, '#8C8475');

    const playerAvgPI = rows.reduce((s, p) => s + p.pressureIndex, 0) / rows.length;
    const playerAvgConv = summary(rows).conversion;
    drawRefLines(playerAvgConv, playerAvgPI, '#B4471F');

    rows.forEach((p, i) => {
      const jitter = ((i * 37) % 100) / 100 * 16 - 8; // deterministic ±8
      const y = ty(p.outcome === 'goal' ? 90 + jitter * 0.3 : 10 + jitter * 0.3);
      const x = tx(p.pressureIndex);
      const color = p.outcome === 'goal' ? '#2E6F4F' : '#C0392B';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = 0.65; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      pressureTakerPoints.push({
        x, y, r: 4,
        taker: p.taker, n: 1, avgPI: p.pressureIndex, pct: p.outcome === 'goal' ? 100 : 0,
        label: `vs ${p.keeper} · ${p.competition} · ${p.minute}' · PI ${p.pressureIndex} · ${p.outcome}`,
      });
    });
    return;
  }

  // Aggregate view: one dot per player.
  title.textContent = 'Avg pressure vs conversion (per player)';
  legend.innerHTML = `
    <div class="tl-item"><div class="gl-dot zh-h"></div>Each dot = one player · size = penalties taken</div>
    <div class="tl-item"><div class="tl-line tl-line-accent"></div>Dashed lines = overall avg conversion / pressure</div>`;

  const minSample = Number(document.getElementById('selMinSample').value);
  const points = pressureByTaker(rows, minSample);

  if (!points.length) {
    ctx.fillStyle = '#8C8475'; ctx.font = "italic 12px 'Newsreader',serif"; ctx.textAlign = 'center';
    ctx.fillText('Not enough data for this view', W / 2, H / 2);
    return;
  }

  drawAxes();

  const avgConv = points.reduce((s, p) => s + p.pct, 0) / points.length;
  const avgPI = points.reduce((s, p) => s + p.avgPI, 0) / points.length;
  drawRefLines(avgConv, avgPI, '#B4471F');

  const maxN = Math.max(...points.map(p => p.n));
  points.forEach(p => {
    const r = 3 + Math.sqrt(p.n / maxN) * 9;
    const x = tx(p.avgPI), y = ty(p.pct);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(180,71,31,0.18)';
    ctx.fill();
    ctx.strokeStyle = '#B4471F'; ctx.lineWidth = 1.5; ctx.stroke();
    pressureTakerPoints.push({ x, y, r, ...p });
  });
}

function handlePressureTakerHover(evt) {
  const canvas = document.getElementById('pressureTakerCanvas');
  const tooltip = document.getElementById('pressureTakerTooltip');
  const rect = canvas.getBoundingClientRect();
  const mx = evt.clientX - rect.left, my = evt.clientY - rect.top;
  const hit = pressureTakerPoints.find(p => Math.hypot(p.x - mx, p.y - my) <= p.r + 1.5);
  if (!hit) { tooltip.classList.remove('visible'); return; }
  tooltip.textContent = hit.label || `${hit.taker} — ${Math.round(hit.pct)}% (${hit.n} taken, avg PI ${Math.round(hit.avgPI)})`;
  tooltip.style.left = hit.x + 'px';
  tooltip.style.top = (hit.y - hit.r - 6) + 'px';
  tooltip.classList.add('visible');
}

function renderPenalties(rows) {
  const list = document.getElementById('penaltyList');
  const slice = rows.slice(0, state.visibleRows);
  if (!slice.length) {
    list.innerHTML = '<div class="empty">No penalties match these filters. Try clearing one.</div>';
    document.getElementById('showMore').style.display = 'none';
    return;
  }
  list.innerHTML = slice.map(p => `
    <div class="penalty-item">
      <div class="outcome-dot ${p.outcome}">${EMOJI[p.outcome]}</div>
      <div class="pi-main">
        <div class="pi-taker">${p.taker}</div>
        <div class="pi-meta">vs ${p.keeper} · ${p.competition} · ${p.minute}'</div>
      </div>
      <div class="pi-right">
        <div class="pi-badge ${p.outcome}">${p.outcome}</div>
        <div class="pi-pressure">PI <b>${p.pressureIndex}</b> · ${ZONE_LABEL[p.placement]}</div>
      </div>
    </div>`).join('');
  document.getElementById('showMore').style.display = rows.length > state.visibleRows ? '' : 'none';
}

// -- FILTER OPTIONS --
function populateFilterOptions() {
  fillSelect('selComp', ['All competitions', ...uniqueValues('competition')]);
  fillSelect('selSeason', ['All seasons', ...uniqueValues('season')]);
  fillDatalist('takerOptions', uniqueValues('taker'));
  fillDatalist('keeperOptions', uniqueValues('keeper'));
}
function fillSelect(id, options) {
  document.getElementById(id).innerHTML = options.map(o => `<option>${o}</option>`).join('');
}
function fillDatalist(id, options) {
  document.getElementById(id).innerHTML = options.map(o => `<option value="${o}"></option>`).join('');
}

// -- EVENTS --
function wireEvents() {
  document.getElementById('chipFilters').addEventListener('click', openFilter);
  document.getElementById('chipPlayerChange').addEventListener('click', () => {
    openFilter();
    const input = document.getElementById('selTaker');
    input.focus();
    input.select();
  });
  document.getElementById('filterOverlay').addEventListener('click', closeFilter);
  document.getElementById('applyBtn').addEventListener('click', applyFromSheet);
  document.getElementById('showMore').addEventListener('click', () => {
    state.visibleRows += 10;
    renderPenalties(applyFilters(state.filters));
  });
  document.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cls = btn.dataset.active;
      btn.classList.toggle(cls);
    });
  });
  document.getElementById('selMinSample').addEventListener('change', () => {
    renderPressureTakers(applyFilters(state.filters));
  });

  const pressureTakerCanvas = document.getElementById('pressureTakerCanvas');
  pressureTakerCanvas.addEventListener('mousemove', handlePressureTakerHover);
  pressureTakerCanvas.addEventListener('mouseleave', () => {
    document.getElementById('pressureTakerTooltip').classList.remove('visible');
  });

  window.addEventListener('resize', () => {
    const rows = applyFilters(state.filters);
    renderTrend(rows);
    renderPressure(rows);
    renderPressureTakers(rows);
  });
}

function applyFromSheet() {
  const comp = document.getElementById('selComp').value;
  const season = document.getElementById('selSeason').value;
  const taker = document.getElementById('selTaker').value.trim();
  const keeper = document.getElementById('selKeeper').value.trim();

  state.filters.competition = comp.startsWith('All') ? 'all' : comp;
  state.filters.season = season.startsWith('All') ? 'all' : season;
  state.filters.taker = taker && uniqueValues('taker').includes(taker) ? taker : null;
  state.filters.keeper = keeper && uniqueValues('keeper').includes(keeper) ? keeper : null;

  const outcomes = new Set();
  document.querySelectorAll('.outcome-btn').forEach(btn => {
    const cls = btn.dataset.active;
    if (btn.classList.contains(cls)) outcomes.add(btn.dataset.outcome);
  });
  state.filters.outcomes = outcomes;
  state.visibleRows = 8;

  closeFilter();
  render();
}

function openFilter() {
  document.getElementById('filterOverlay').classList.add('open');
  document.getElementById('filterSheet').classList.add('open');
}
function closeFilter() {
  document.getElementById('filterOverlay').classList.remove('open');
  document.getElementById('filterSheet').classList.remove('open');
}

init();
