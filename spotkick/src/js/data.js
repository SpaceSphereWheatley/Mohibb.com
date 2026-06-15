// data.js
// Loads penalties.json (falls back to sample), indexes it, and exposes
// filtering + aggregation helpers used by the UI.
// Laget av Mohibb Malik, 2025

export const ZONE_LABEL = {
  TL: 'Top left', TC: 'Top centre', TR: 'Top right',
  ML: 'Mid left', MC: 'Centre', MR: 'Mid right',
  BL: 'Bot left', BC: 'Bot centre', BR: 'Bot right',
};

let ALL = [];

export async function loadData() {
  // Try the real build output first, then the sample.
  for (const path of ['./data/penalties.json', './data/penalties.sample.json']) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        ALL = await res.json();
        return ALL;
      }
    } catch (_) { /* try next */ }
  }
  ALL = [];
  return ALL;
}

export function getAll() { return ALL; }

// filters: { competition, season, taker, keeper, team, outcomes:Set, zone, minPI, maxPI }
export function applyFilters(filters = {}) {
  return ALL.filter(p => {
    if (filters.competition && filters.competition !== 'all' && p.competition !== filters.competition) return false;
    if (filters.season && filters.season !== 'all' && p.season !== filters.season) return false;
    if (filters.taker && p.taker !== filters.taker) return false;
    if (filters.keeper && p.keeper !== filters.keeper) return false;
    if (filters.team && p.team !== filters.team) return false;
    if (filters.outcomes && filters.outcomes.size && !filters.outcomes.has(p.outcome)) return false;
    if (filters.zone && p.placement !== filters.zone) return false;
    if (filters.minPI != null && p.pressureIndex < filters.minPI) return false;
    if (filters.maxPI != null && p.pressureIndex > filters.maxPI) return false;
    return true;
  });
}

export function summary(rows) {
  const total = rows.length;
  const goals  = rows.filter(p => p.outcome === 'goal').length;
  const saved  = rows.filter(p => p.outcome === 'saved').length;
  const missed = rows.filter(p => p.outcome === 'missed').length;
  const takers = new Set(rows.map(p => p.takerId ?? p.taker)).size;
  const avgPI = total ? rows.reduce((s, p) => s + p.pressureIndex, 0) / total : 0;
  return {
    total, goals, saved, missed, takers,
    conversion: total ? (goals / total) * 100 : 0,
    savedPct:   total ? (saved / total) * 100 : 0,
    missedPct:  total ? (missed / total) * 100 : 0,
    avgPI,
  };
}

// Per-zone conversion + counts, returns { TL:{n,goals,pct}, ... }
export function zoneStats(rows) {
  const z = {};
  for (const key of Object.keys(ZONE_LABEL)) z[key] = { n: 0, goals: 0, pct: 0 };
  for (const p of rows) {
    const cell = z[p.placement];
    if (!cell) continue;
    cell.n++;
    if (p.outcome === 'goal') cell.goals++;
  }
  for (const key of Object.keys(z)) {
    z[key].pct = z[key].n ? (z[key].goals / z[key].n) * 100 : 0;
  }
  return z;
}

// Top takers by conversion, minimum sample size.
export function topTakers(rows, minSample = 3, limit = 8) {
  const map = new Map();
  for (const p of rows) {
    const key = p.taker;
    if (!map.has(key)) map.set(key, { taker: key, n: 0, goals: 0 });
    const t = map.get(key);
    t.n++;
    if (p.outcome === 'goal') t.goals++;
  }
  return [...map.values()]
    .filter(t => t.n >= minSample)
    .map(t => ({ ...t, pct: (t.goals / t.n) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, limit);
}

// Conversion grouped by season label, sorted chronologically.
export function bySeason(rows) {
  const map = new Map();
  for (const p of rows) {
    if (!map.has(p.season)) map.set(p.season, { n: 0, goals: 0 });
    const s = map.get(p.season);
    s.n++;
    if (p.outcome === 'goal') s.goals++;
  }
  return [...map.entries()]
    .map(([season, v]) => ({ season, pct: (v.goals / v.n) * 100, n: v.n }))
    .sort((a, b) => (a.season < b.season ? -1 : 1));
}

// Conversion grouped into Pressure Index buckets of width `step` (0-100).
export function byPressureBucket(rows, step = 10) {
  const buckets = [];
  for (let lo = 0; lo < 100; lo += step) {
    buckets.push({ lo, hi: lo + step, n: 0, goals: 0, pct: 0 });
  }
  for (const p of rows) {
    const idx = Math.min(buckets.length - 1, Math.floor(p.pressureIndex / step));
    buckets[idx].n++;
    if (p.outcome === 'goal') buckets[idx].goals++;
  }
  for (const b of buckets) b.pct = b.n ? (b.goals / b.n) * 100 : 0;
  return buckets;
}

// Per-taker avg pressure index vs conversion rate, minimum sample size.
export function pressureByTaker(rows, minSample = 3) {
  const map = new Map();
  for (const p of rows) {
    const key = p.taker;
    if (!map.has(key)) map.set(key, { taker: key, n: 0, goals: 0, piSum: 0 });
    const t = map.get(key);
    t.n++;
    t.piSum += p.pressureIndex;
    if (p.outcome === 'goal') t.goals++;
  }
  return [...map.values()]
    .filter(t => t.n >= minSample)
    .map(t => ({ taker: t.taker, n: t.n, avgPI: t.piSum / t.n, pct: (t.goals / t.n) * 100 }));
}

// One taker's full profile incl. per-keeper head-to-head.
export function takerProfile(taker) {
  const rows = ALL.filter(p => p.taker === taker);
  if (!rows.length) return null;
  const goals = rows.filter(p => p.outcome === 'goal').length;
  // favoured zone
  const zoneCount = {};
  for (const p of rows) zoneCount[p.placement] = (zoneCount[p.placement] || 0) + 1;
  const favoured = Object.entries(zoneCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MC';
  // h2h
  const h2h = new Map();
  for (const p of rows) {
    if (!h2h.has(p.keeper)) h2h.set(p.keeper, { keeper: p.keeper, n: 0, goals: 0 });
    const k = h2h.get(p.keeper);
    k.n++;
    if (p.outcome === 'goal') k.goals++;
  }
  return {
    taker,
    team: rows[0].team,
    taken: rows.length,
    goals,
    rate: (goals / rows.length) * 100,
    favoured,
    h2h: [...h2h.values()].sort((a, b) => b.n - a.n),
  };
}

export function uniqueValues(field) {
  return [...new Set(ALL.map(p => p[field]).filter(Boolean))].sort();
}
