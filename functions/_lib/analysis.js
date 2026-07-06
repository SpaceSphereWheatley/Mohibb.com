"use strict";
/* ============================================================
   Pure race-analysis primitives, ported from pitwall/script.js
   (and pitwall/live/script.js's loadPrevious for the podium
   approach) for use in a Workers runtime — no window/document/
   sessionStorage. Scoped to only what the Race Report needs:
   classification, fastest lap, race history, tyre strategy + pit
   stops, safety car/VSC periods, race pace. Quali pace, car-
   performance ratings, tyre-deg slope modelling, the strategy
   simulator and undercut calc are out of scope and not ported.
   ============================================================ */

export const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
export const posInt = (x) => { const n = num(x); return (n != null && n > 0) ? n : null; };

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function groupByDriver(rows) {
  const m = {};
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const n = num(r.driver_number); if (n == null) return;
    (m[n] = m[n] || []).push(r);
  });
  return m;
}

const COMPOUND = { SOFT: 'SOFT', MEDIUM: 'MEDIUM', HARD: 'HARD', DRY: 'HARD', INTERMEDIATE: 'INTERMEDIATE', INTERMEDIATES: 'INTERMEDIATE', INTER: 'INTERMEDIATE', WET: 'WET' };
export function normCompound(c) { return COMPOUND[(c || '').toUpperCase()] || 'UNKNOWN'; }
export const COMPOUND_ORDER = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'];

export function bestLap(laps) {
  let best = Infinity;
  for (const l of (laps || [])) {
    if (l.is_pit_out_lap) continue;
    const ld = num(l.lap_duration); if (ld != null && ld > 0) best = Math.min(best, ld);
  }
  return isFinite(best) ? best : null;
}

// Rebuild a clean, contiguous stint timeline from OpenF1's stints rows — ported
// verbatim from pitwall/script.js's reconstructStints().
export function reconstructStints(rows, lastLap) {
  const byNum = new Map(), loose = [];
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const seg = { sn: posInt(r.stint_number), ls: posInt(r.lap_start), le: posInt(r.lap_end), cmp: normCompound(r.compound) };
    if (seg.sn == null) { loose.push(seg); return; }
    const e = byNum.get(seg.sn);
    if (!e) { byNum.set(seg.sn, seg); return; }
    e.ls = e.ls == null ? seg.ls : (seg.ls == null ? e.ls : Math.min(e.ls, seg.ls));
    e.le = e.le == null ? seg.le : (seg.le == null ? e.le : Math.max(e.le, seg.le));
    if (e.cmp === 'UNKNOWN' && seg.cmp !== 'UNKNOWN') e.cmp = seg.cmp;
  });
  const segs = [...byNum.values(), ...loose].sort((a, b) => (a.ls ?? a.sn ?? 0) - (b.ls ?? b.sn ?? 0));
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], next = segs[i + 1];
    let start = s.ls != null ? s.ls : (out.length ? out[out.length - 1].end + 1 : 1);
    const nextStart = next ? next.ls : null;
    let end = s.le;
    if (end == null) end = (nextStart != null) ? nextStart - 1 : (lastLap != null ? lastLap : start);
    if (nextStart != null && end >= nextStart) end = nextStart - 1;
    if (next == null && lastLap != null) end = Math.max(start, lastLap);
    if (end >= start) out.push({ start, end, laps: end - start + 1, cmp: s.cmp });
  }
  return out;
}

// Is the raw stints feed actually complete? Ported verbatim from
// pitwall/script.js's stintsLookComplete().
export function stintsLookComplete(byDrv, lastLapOf) {
  const dn = Object.keys(byDrv).map(Number);
  if (!dn.length) return false;
  let complete = 0;
  for (const n of dn) {
    const segs = (byDrv[n] || []).map(r => ({ ls: posInt(r.lap_start), le: posInt(r.lap_end) }))
      .filter(s => s.ls != null && s.le != null && s.le >= s.ls).sort((a, b) => a.ls - b.ls);
    if (!segs.length) continue;
    if (segs[0].ls > 1) continue;
    let cursor = segs[0].le, ok = true;
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].ls > cursor + 1) { ok = false; break; }
      cursor = Math.max(cursor, segs[i].le);
    }
    if (!ok) continue;
    const last = lastLapOf(n);
    if (last != null && cursor < last - 1) continue;
    complete++;
  }
  return complete / dn.length >= 0.6;
}

// Parse OpenF1 race_control into Safety Car / Virtual Safety Car periods —
// ported verbatim from pitwall/script.js's parseSafety()/safetyByLap().
export function parseSafety(rc) {
  const msgs = (Array.isArray(rc) ? rc : []).filter(r => r.date).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const periods = []; let open = null;
  const close = (m) => { if (open) { open.endDate = m.date; open.endLap = num(m.lap_number); periods.push(open); open = null; } };
  for (const m of msgs) {
    const text = (m.message || '').toUpperCase(), flag = (m.flag || '').toUpperCase();
    const vsc = text.includes('VIRTUAL SAFETY CAR'), sc = text.includes('SAFETY CAR') && !vsc;
    if ((vsc || sc) && text.includes('DEPLOY')) {
      if (open) close(m);
      open = { kind: vsc ? 'VSC' : 'SC', startDate: m.date, startLap: num(m.lap_number) };
    } else if (vsc && open && open.kind === 'VSC' && text.includes('END')) {
      close(m);
    } else if (flag === 'GREEN' && (m.scope || '').toUpperCase() !== 'SECTOR' && open) {
      close(m);
    }
  }
  if (open) periods.push(open);
  return periods;
}
export const safetyByLap = (periods) => periods.filter(p => p.startLap != null).map(p => ({ x0: p.startLap, x1: p.endLap ?? p.startLap, kind: p.kind }));

// ported from pitwall/script.js's loadDriversInto(), minus the TEAM_COLOURS
// browser-side fallback (team_colour is present on almost every OpenF1 driver row)
export function buildDriverMap(arr) {
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach(d => {
    const n = num(d.driver_number); if (n == null) return;
    map[n] = {
      acr: d.name_acronym || ('#' + n),
      name: d.full_name || d.broadcast_name || ('#' + n),
      team: d.team_name || '',
      colour: d.team_colour ? ('#' + String(d.team_colour).replace('#', '')) : null,
    };
  });
  return map;
}
function driverOf(driverMap, n) { return driverMap[n] || { acr: '#' + n, name: '—', team: '', colour: null }; }

/* ============================================================
   Composition functions — built from the primitives above plus
   the raw OpenF1 endpoints, specific to this report.
   ============================================================ */

// Final classification: last `position` reading per driver, same approach as
// pitwall/live/script.js's loadPrevious(). Deliberately does not fabricate a
// finish-time gap — OpenF1's free historical endpoints don't expose one.
export function buildClassification(position, laps, driverMap) {
  const latest = {};
  (Array.isArray(position) ? position : []).forEach(p => {
    const n = num(p.driver_number); if (n == null || p.position == null) return;
    const cur = latest[n];
    if (!cur || new Date(p.date) > new Date(cur.date)) latest[n] = p;
  });
  const lapsByDrv = groupByDriver(laps);
  const lapsCompleted = (n) => {
    const ls = lapsByDrv[n]; if (!ls || !ls.length) return 0;
    let m = 0; for (const l of ls) { const v = num(l.lap_number); if (v != null && v > m) m = v; }
    return m;
  };
  return Object.keys(latest).map(Number)
    .map(n => ({ n, position: num(latest[n].position), laps: lapsCompleted(n), driver: driverOf(driverMap, n) }))
    .filter(r => r.position != null)
    .sort((a, b) => a.position - b.position);
}

export function fastestLapOfRace(laps, driverMap) {
  const byDrv = groupByDriver(laps);
  let best = null;
  Object.keys(byDrv).map(Number).forEach(n => {
    const b = bestLap(byDrv[n]);
    if (b != null && (!best || b < best.time)) {
      const lapRow = byDrv[n].find(l => num(l.lap_duration) === b);
      best = { n, time: b, lap: lapRow ? num(lapRow.lap_number) : null, driver: driverOf(driverMap, n) };
    }
  });
  return best;
}

// Per-driver tyre strategy + pit stops — ported from renderStrategy()'s
// computation (pitwall/script.js:1829-1860), minus the HTML rendering.
export function driverStrategies(stints, pit, laps, driverMap) {
  const byDrv = groupByDriver(stints);
  const lapGroups = groupByDriver(laps);
  const lastLapOf = (n) => {
    const ls = lapGroups[n]; if (!ls || !ls.length) return null;
    let m = 0; for (const l of ls) { const v = num(l.lap_number); if (v != null && v > m) m = v; }
    return m || null;
  };
  const drivers = Object.keys(byDrv).map(Number).sort((a, b) => a - b);
  const complete = drivers.length ? stintsLookComplete(byDrv, lastLapOf) : false;
  const strategies = complete ? drivers.map(n => ({
    n, driver: driverOf(driverMap, n), stints: reconstructStints(byDrv[n], lastLapOf(n)),
  })) : [];
  const pitStops = (Array.isArray(pit) ? pit : []).map(p => ({
    n: num(p.driver_number), lap: num(p.lap_number), dur: num(p.pit_duration) ?? num(p.stop_duration),
  })).filter(p => p.dur != null).sort((a, b) => a.dur - b.dur);
  return { complete, strategies, pitStops, hasStintRows: drivers.length > 0 };
}

// Median "clean" (green-flag, non-pit) lap time per driver — a directional
// pace guide, not the fuel-corrected tyre-deg slope model (out of scope).
export function racePaceSummary(laps, pit, safetyPeriods, driverMap) {
  const bands = safetyByLap(safetyPeriods);
  const inBand = (lap) => bands.some(b => lap >= b.x0 && lap <= b.x1);
  const pitLapsByDrv = {};
  (Array.isArray(pit) ? pit : []).forEach(p => {
    const n = num(p.driver_number), l = num(p.lap_number);
    if (n == null || l == null) return;
    (pitLapsByDrv[n] = pitLapsByDrv[n] || new Set()).add(l);
  });
  const byDrv = groupByDriver(laps);
  const rows = Object.keys(byDrv).map(Number).map(n => {
    const clean = byDrv[n].filter(l => {
      if (l.is_pit_out_lap) return false;
      const ln = num(l.lap_number), ld = num(l.lap_duration);
      if (ln == null || ld == null || ld <= 0) return false;
      if (pitLapsByDrv[n] && pitLapsByDrv[n].has(ln)) return false;
      if (inBand(ln)) return false;
      return true;
    }).map(l => num(l.lap_duration));
    return { n, driver: driverOf(driverMap, n), median: median(clean), sampleLaps: clean.length };
  }).filter(r => r.median != null).sort((a, b) => a.median - b.median);
  const best = rows.length ? rows[0].median : null;
  rows.forEach(r => { r.gap = best != null ? r.median - best : null; });
  return rows;
}

// Per-lap gap-to-winner traces — ported from renderHistory()/drawHistory()'s
// computation (pitwall/script.js:1712-1774), minus the Chart.js rendering.
// The reference driver is the race winner (from `classification`) rather than
// re-deriving the "most laps, then least cumulative time" ranking, except as
// a fallback if the winner's own lap data is unusable.
export function buildHistoryTraces(laps, pit, safetyPeriods, classification, driverMap) {
  const groups = groupByDriver(laps);
  const drivers = Object.keys(groups).map(Number);
  if (!drivers.length) return null;

  const cum = {}, lastLap = {};
  drivers.forEach(n => {
    const ls = groups[n].slice().filter(l => num(l.lap_number) != null).sort((a, b) => a.lap_number - b.lap_number);
    const med = median(ls.map(l => num(l.lap_duration)).filter(v => v != null && v > 0));
    const map = new Map(); let total = 0, last = 0;
    ls.forEach(l => {
      let d = num(l.lap_duration); if (d == null || d <= 0) d = med;
      if (d == null) return;
      total += d; map.set(num(l.lap_number), total); last = num(l.lap_number);
    });
    cum[n] = map; lastLap[n] = last;
  });

  const ranked = drivers.filter(n => lastLap[n] > 0).sort((a, b) => {
    if (lastLap[b] !== lastLap[a]) return lastLap[b] - lastLap[a];
    return (cum[a].get(lastLap[a]) ?? Infinity) - (cum[b].get(lastLap[b]) ?? Infinity);
  });
  if (!ranked.length) return null;

  let refN = classification.length ? classification[0].n : null;
  if (refN == null || !cum[refN] || !lastLap[refN]) refN = ranked[0];
  const refCum = cum[refN], refLast = lastLap[refN];
  if (!refCum || !refLast) return null;

  const pitLaps = {};
  (Array.isArray(pit) ? pit : []).forEach(p => {
    const n = num(p.driver_number), l = num(p.lap_number);
    if (n == null || l == null) return;
    (pitLaps[n] = pitLaps[n] || new Set()).add(l);
  });

  const traces = ranked.map(n => {
    const map = cum[n], pts = [];
    for (let lap = 1; lap <= refLast; lap++) {
      const rc = refCum.get(lap), dc = map.get(lap);
      if (rc == null || dc == null) continue;
      pts.push({ lap, gap: rc - dc });
    }
    return { n, driver: driverOf(driverMap, n), isRef: n === refN, points: pts, pitLaps: pitLaps[n] ? [...pitLaps[n]] : [] };
  });

  return { refN, refLast, traces, bands: safetyByLap(safetyPeriods) };
}
