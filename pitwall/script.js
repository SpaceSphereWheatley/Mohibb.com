"use strict";
/* ============================================================
   Pit Wall · Analyse — completed-session F1 analysis
   Single file. Vanilla JS. Chart.js is the only external lib.
   All data from OpenF1's free historical endpoints. Completed
   sessions never change, so everything is cached in sessionStorage.
   ============================================================ */

const OPENF1 = 'https://api.openf1.org/v1/';
const TZ = 'Europe/Oslo';
const FIRST_YEAR = 2023;                 // OpenF1 history starts in 2023
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PACE_WINDOW = 1.07;                // long-run "clean lap" filter: within 107% of the stint's quickest lap
// Tyre-deg modelling: a car quickens through a stint as its fuel load burns off, which masks tyre wear.
// We add this back to each stint's observed lap-time slope to isolate the tyre component. It's an
// approximation (~0.055s/lap, from ~1.6kg/lap burn × ~0.035s/lap/kg) — the main source of error in the
// deg figures, so it's surfaced in the panel note. A documented magic number, like PACE_WINDOW above.
const FUEL_S_PER_LAP = 0.055;

// car-performance ratings: corner-speed buckets, acceleration window, Top-N choices
const CORNER_SLOW_MAX = 120;             // km/h — below this, a corner counts as "slow"
const CORNER_FAST_MIN = 200;             // km/h — above this, a corner counts as "fast"
const CORNER_DROP_KMH = 10;              // minimum speed drop from the preceding peak to count as a corner
const ACCEL_WINDOW_S = 2;                // seconds after a corner-exit minimum used for the acceleration rating
const CARPERF_TOPN = [5, 10, 0];         // 0 = all

const state = {
  year: null,
  meetings: [],          // for the selected year
  sessions: [],          // for the selected meeting
  session: null,         // the selected session object
  view: null,            // active view: 'practice' | 'qualifying' | 'prerace' | 'race'
  pendingTab: null,      // tab to apply from a shared link once the session loads ('prerace')
  drivers: {},           // number -> {acr, name, team, colour}
  charts: { lap: null, pos: null, hist: null, qpace: null, qtheo: null, carperf: null, carstrength: null, tyredeg: null },
  history: null,         // cached cumulative-time data for the race-history chart
  qualiView: { qpace: 'graph', qtheo: 'graph' },   // per-panel graph/table toggle
  raceTopN: 0,           // race-chart driver filter: 0 = all, else top N by finishing order
  showPits: true,        // race charts: mark each driver's pit stops with a dot
  renderGen: 0,          // bumped per session load; a scheduled panel retry aborts if it changed
  raceRedraw: {},        // per-chart redraw closures, so the Top-N buttons refresh every race chart at once
  pitLoss: null,         // {meeting, seconds, samples} weekend pit-loss estimate, memoised per meeting
  degModel: null,        // {meeting, model, practiceCount} pooled-practice tyre-deg model, memoised per meeting
  raceLaps: null,        // {meeting, laps, src} estimated race distance for the strategy optimiser, memoised per meeting
  carPerf: { mode: 'driver', topN: 5, trim: 'race' },  // car-performance panel controls
  carPerfCtx: null,      // computed traits/strengths for the current session, redrawn on toggle
};

/* ---------- tiny DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
// lap / stint numbers are 1-based, but num(null)===0 (Number(null)===0), so treat <=0 as missing
const posInt = (x) => { const n = num(x); return (n != null && n > 0) ? n : null; };

/* ---------- time / number formatting ---------- */
const fmtClock = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour:'2-digit', minute:'2-digit', hour12:false });
const fmtDate  = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday:'short', day:'2-digit', month:'short', year:'numeric' });
const fmtDateTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false });
function osloDate(iso){ try { return fmtDate.format(new Date(iso)); } catch { return '—'; } }
function osloDateTime(iso){ try { return fmtDateTime.format(new Date(iso)); } catch { return '—'; } }

// lap time as m:ss.SSS (or ss.SSS under a minute)
function fmtLap(sec){
  const n = num(sec); if (n == null || n <= 0) return '—';
  const m = Math.floor(n / 60), s = n - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6,'0')}` : s.toFixed(3);
}
// signed gap in seconds, e.g. +0.214 / −0.080
function fmtGap(sec){
  const n = num(sec); if (n == null) return '—';
  if (Math.abs(n) < 0.0005) return '+0.000';
  return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(3);
}
function median(arr){
  if (!arr.length) return null;
  const s = [...arr].sort((a,b)=> a-b), m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}
// ordinary least-squares fit of points [{x,y}] -> { slope, intercept }; null if degenerate (no x spread)
function linFit(points){
  const n = points.length;
  if (n < 2) return null;
  let sx=0, sy=0, sxx=0, sxy=0;
  for (const p of points){ sx+=p.x; sy+=p.y; sxx+=p.x*p.x; sxy+=p.x*p.y; }
  const denom = n*sxx - sx*sx;
  if (denom === 0) return null;                  // every point at the same x
  const slope = (n*sxy - sx*sy) / denom;
  return { slope, intercept: (sy - slope*sx) / n };
}

/* ---------- fetch helpers ---------- */
const FETCH_TIMEOUT_MS = 15000;
async function getJSON(url, retries = 1){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok){
      const err = new Error('HTTP ' + res.status); err.status = res.status; throw err;
    }
    return await res.json();
  } catch (e) {
    const transient = e.name === 'AbortError' || e.status === 429 || (e.status >= 500 && e.status < 600);
    if (retries > 0 && transient){ await new Promise(r => setTimeout(r, 1000)); return getJSON(url, retries - 1); }
    throw e;
  } finally { clearTimeout(timer); }
}
function logError(context, err){ console.warn('[analyse] ' + context + ':', err); }
// run async tasks with limited concurrency — OpenF1 rate-limits bursts (e.g. 20 simultaneous
// car_data requests), so most fail even with one retry; a small pool keeps them all succeeding.
async function mapLimit(items, limit, fn){
  const results = new Array(items.length);
  let next = 0;
  async function worker(){
    while (next < items.length){
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* sessionStorage-cached JSON — completed-session data is immutable, so cache hard.
   Concurrent callers for the same data share one request (the race + practice
   views fetch overlapping endpoints in parallel; without this, OpenF1 sees a
   duplicate burst and rate-limits one of them). */
const inflight = new Map();
async function cachedJSON(cacheKey, url, slimmer){
  try { const c = sessionStorage.getItem(cacheKey); if (c) return JSON.parse(c); } catch {}
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const p = (async () => {
    const data = await getJSON(url);
    const out = slimmer ? slimmer(data) : data;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(out)); } catch {}   // quota — fine, just skip
    return out;
  })();
  inflight.set(cacheKey, p);
  try { return await p; }
  finally { inflight.delete(cacheKey); }
}
// /laps rows carry big segment arrays we never use — strip before caching to stay under quota
function slimLaps(data){
  if (!Array.isArray(data)) return data;
  return data.map(l => ({
    driver_number: l.driver_number, lap_number: l.lap_number, lap_duration: l.lap_duration,
    duration_sector_1: l.duration_sector_1, duration_sector_2: l.duration_sector_2,
    duration_sector_3: l.duration_sector_3, is_pit_out_lap: l.is_pit_out_lap, date_start: l.date_start,
  }));
}
// race_control carries flags/SC/VSC messages — keep only the fields we shade with
function slimRC(data){
  if (!Array.isArray(data)) return data;
  return data.map(r => ({ date: r.date, lap_number: r.lap_number, category: r.category, flag: r.flag, scope: r.scope, message: r.message }));
}
const fetchLaps     = (sk) => cachedJSON(`pwa.${sk}.laps`,     `${OPENF1}laps?session_key=${sk}`, slimLaps);
const fetchStints   = (sk) => cachedJSON(`pwa.${sk}.stints`,   `${OPENF1}stints?session_key=${sk}`);
const fetchPit      = (sk) => cachedJSON(`pwa.${sk}.pit`,      `${OPENF1}pit?session_key=${sk}`);
const fetchPosition = (sk) => cachedJSON(`pwa.${sk}.position`, `${OPENF1}position?session_key=${sk}`);
const fetchDrivers  = (sk) => cachedJSON(`pwa.${sk}.drivers`,  `${OPENF1}drivers?session_key=${sk}`);
const fetchRC       = (sk) => cachedJSON(`pwa.${sk}.rc`,       `${OPENF1}race_control?session_key=${sk}`, slimRC);
// one driver's telemetry for a single lap (date-range bounded, so each request stays small)
const fetchCarData  = (sk, n, dateStart, dateEnd) => cachedJSON(`pwa.${sk}.car.${n}.${dateStart}`,
  `${OPENF1}car_data?session_key=${sk}&driver_number=${n}&date>=${encodeURIComponent(dateStart)}&date<${encodeURIComponent(dateEnd)}`);

/* clear every cache entry for a session (used by Reload) */
function clearSessionCache(sk){
  ['laps','stints','pit','position','drivers','rc'].forEach(ep => { try { sessionStorage.removeItem(`pwa.${sk}.${ep}`); } catch {} });
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--){
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`pwa.${sk}.car.`)) sessionStorage.removeItem(k);
    }
  } catch {}
}

/* ---------- rendering helpers ---------- */
function stateBox(badge, msg, kind){
  return `<div class="state ${kind||''}"><span class="badge">${esc(badge)}</span><span class="msg">${esc(msg)}</span></div>`;
}
function loadingBox(msg){ return stateBox('Loading', msg || 'Fetching session data…'); }
// shown by the practice-based qualifying panels when thin data is explained by the sprint format
function sprintWeekendBox(){
  return stateBox('Sprint weekend', 'Sprint weekends run only one practice hour, and teams spend it on qualifying prep rather than long runs — so there usually isn’t enough green-flag practice data for this analysis. Try a regular (non-sprint) weekend.');
}

/* ---------- panel auto-retry ----------
   A panel that fails (usually OpenF1 rate-limiting a burst of concurrent
   requests) waits a randomised 5–10s — to desync it from its siblings — and
   re-runs itself, up to PANEL_RETRIES times, before falling back to its error
   state. Each render function takes an `attempt` arg (0 on the first try) and
   calls panelRetry() from its catch. */
const PANEL_RETRIES = 2;
const retryWait = () => 5000 + Math.random() * 5000;   // 5–10s, jittered per panel
function panelRetry(label, err, body, attempt, again, failHtml){
  logError(`${label} (attempt ${attempt + 1})`, err);
  if (attempt < PANEL_RETRIES){
    const gen = state.renderGen;   // don't let a queued retry clobber a newly-loaded session
    if (body) body.innerHTML = stateBox('Retrying', `That didn’t load — trying again in a few seconds (attempt ${attempt + 2} of ${PANEL_RETRIES + 1})…`);
    setTimeout(() => { if (state.renderGen === gen) again(); }, retryWait());
  } else if (body){
    body.innerHTML = failHtml +
      `<div class="retry-row"><button type="button" class="sec-retry"><span class="ico">⟳</span> Retry</button></div>`;
    const btn = body.querySelector('.sec-retry');
    if (btn) btn.addEventListener('click', () => {
      const gen = state.renderGen;            // ignore a click left over from a previous session
      if (state.renderGen === gen) again();   // re-enters the render; it sets its own loading box
    });
  }
}

/* team colour fallbacks (so cross-session tables still get an accent) */
const TEAM_COLOURS = {
  'red bull':'#3671C6','mclaren':'#FF8000','ferrari':'#E8002D','mercedes':'#27F4D2',
  'aston martin':'#229971','alpine':'#0093CC','williams':'#64C4FF','rb':'#6692FF',
  'racing bulls':'#6692FF','haas':'#B6BABD','sauber':'#52E252','kick sauber':'#52E252','alfa romeo':'#52E252',
};
function teamColour(name){ const k=(name||'').toLowerCase(); for (const key in TEAM_COLOURS){ if (k.includes(key)) return TEAM_COLOURS[key]; } return null; }

function loadDriversInto(arr){
  const map = {};
  (Array.isArray(arr)?arr:[]).forEach(d => {
    const n = num(d.driver_number); if (n == null) return;
    map[n] = {
      acr: d.name_acronym || ('#'+n),
      name: d.full_name || d.broadcast_name || ('#'+n),
      team: d.team_name || '',
      colour: d.team_colour ? ('#'+String(d.team_colour).replace('#','')) : (teamColour(d.team_name) || null),
    };
  });
  return map;
}
function drv(n){ const d = state.drivers[num(n)]; return d || { acr: (n!=null?'#'+n:'—'), name:'—', team:'', colour:null }; }
function drvColour(n){ return drv(n).colour || '#8C8475'; }
function drvCell(n){
  const d = drv(n);
  return `<td class="accent-cell" style="--team:${d.colour||'var(--ink-4)'}"><span class="code">${esc(d.acr)}</span> <span class="muted">${esc(d.name)}</span></td>`;
}
function groupByDriver(rows){
  const m = {};
  (Array.isArray(rows)?rows:[]).forEach(r => { const n = num(r.driver_number); if (n==null) return; (m[n]=m[n]||[]).push(r); });
  return m;
}

/* ============================================================
   ANALYSIS PRIMITIVES
   ============================================================ */

// theoretical best from one driver's laps: min of each sector, summed
function theoretical(laps){
  let s1=Infinity, s2=Infinity, s3=Infinity, best=Infinity;
  for (const l of (laps||[])){
    if (l.is_pit_out_lap) continue;                 // out-laps are slow & not representative
    const a=num(l.duration_sector_1), b=num(l.duration_sector_2), c=num(l.duration_sector_3), ld=num(l.lap_duration);
    if (a!=null && a>0) s1=Math.min(s1,a);
    if (b!=null && b>0) s2=Math.min(s2,b);
    if (c!=null && c>0) s3=Math.min(s3,c);
    if (ld!=null && ld>0) best=Math.min(best,ld);
  }
  const theo = (isFinite(s1)&&isFinite(s2)&&isFinite(s3)) ? s1+s2+s3 : null;
  return { actual: isFinite(best)?best:null, theo, s1:isFinite(s1)?s1:null, s2:isFinite(s2)?s2:null, s3:isFinite(s3)?s3:null };
}
function bestLap(laps){
  let best=Infinity;
  for (const l of (laps||[])){ if (l.is_pit_out_lap) continue; const ld=num(l.lap_duration); if (ld!=null && ld>0) best=Math.min(best,ld); }
  return isFinite(best)?best:null;
}

const COMPOUND = { SOFT:'SOFT', MEDIUM:'MEDIUM', HARD:'HARD', DRY:'HARD', INTERMEDIATE:'INTERMEDIATE', INTERMEDIATES:'INTERMEDIATE', INTER:'INTERMEDIATE', WET:'WET' };
function normCompound(c){ return COMPOUND[(c||'').toUpperCase()] || 'UNKNOWN'; }

/* Rebuild a clean, contiguous stint timeline from OpenF1's stints rows, which
   in practice carry duplicates, missing lap_start/lap_end, overlaps, and a null
   lap_end on the final stint. `lastLap` (the driver's last completed lap, from
   lap data) closes the final stint and bounds the total. Returns ordered
   [{start, end, laps, cmp}]. */
function reconstructStints(rows, lastLap){
  // merge rows that share a stint_number (OpenF1 can emit several per stint)
  const byNum = new Map(), loose = [];
  (Array.isArray(rows)?rows:[]).forEach(r => {
    const seg = { sn:posInt(r.stint_number), ls:posInt(r.lap_start), le:posInt(r.lap_end), cmp:normCompound(r.compound) };
    if (seg.sn == null){ loose.push(seg); return; }
    const e = byNum.get(seg.sn);
    if (!e){ byNum.set(seg.sn, seg); return; }
    e.ls = e.ls==null ? seg.ls : (seg.ls==null ? e.ls : Math.min(e.ls, seg.ls));
    e.le = e.le==null ? seg.le : (seg.le==null ? e.le : Math.max(e.le, seg.le));
    if (e.cmp==='UNKNOWN' && seg.cmp!=='UNKNOWN') e.cmp = seg.cmp;
  });
  const segs = [...byNum.values(), ...loose].sort((a,b)=> (a.ls ?? a.sn ?? 0) - (b.ls ?? b.sn ?? 0));
  const out = [];
  for (let i=0; i<segs.length; i++){
    const s = segs[i], next = segs[i+1];
    let start = s.ls != null ? s.ls : (out.length ? out[out.length-1].end + 1 : 1);
    const nextStart = next ? next.ls : null;
    let end = s.le;
    if (end == null) end = (nextStart != null) ? nextStart - 1 : (lastLap != null ? lastLap : start);
    if (nextStart != null && end >= nextStart) end = nextStart - 1;        // trim overlaps with the next stint
    if (next == null && lastLap != null) end = Math.max(start, lastLap);   // final stint runs to the driver's last lap
    if (end >= start) out.push({ start, end, laps: end - start + 1, cmp: s.cmp });
  }
  return out;
}

/* Is the raw stints feed actually complete? OpenF1 sometimes returns only a
   subset of stints (missing opening stints, mid-race gaps), which would make
   the strategy bars misleading. A driver's stints are "complete" when they
   open on lap 1, have no lap gaps between them, and reach the driver's last
   lap. We trust the dataset only if most drivers pass. */
function stintsLookComplete(byDrv, lastLapOf){
  const dn = Object.keys(byDrv).map(Number);
  if (!dn.length) return false;
  let complete = 0;
  for (const n of dn){
    const segs = (byDrv[n]||[]).map(r => ({ ls:posInt(r.lap_start), le:posInt(r.lap_end) }))
      .filter(s => s.ls!=null && s.le!=null && s.le>=s.ls).sort((a,b)=> a.ls-b.ls);
    if (!segs.length) continue;
    if (segs[0].ls > 1) continue;                               // missing the opening stint
    let cursor = segs[0].le, ok = true;
    for (let i=1; i<segs.length; i++){
      if (segs[i].ls > cursor + 1){ ok = false; break; }        // gap between stints
      cursor = Math.max(cursor, segs[i].le);
    }
    if (!ok) continue;
    const last = lastLapOf(n);
    if (last != null && cursor < last - 1) continue;            // missing the final stint(s)
    complete++;
  }
  return complete / dn.length >= 0.6;
}

// Per-stint clean-lap series, the shared basis for long-run pace and tyre-deg modelling.
// Stints come from reconstructStints(), so duplicate rows are merged and a final stint with a
// null lap_end (common in OpenF1's feed, and often exactly where the race-sim long run lives) is
// closed at the driver's last lap rather than dropped. For each stint of >=5 clean laps (not
// out-laps, within 107% of the stint's quickest) returns one run with its lap-in-stint series:
// [{ driver, compound, startLap, points:[{x:lapInStint, t}] }]. x is 1-based laps into the stint,
// so a fit's slope is the lap-time trend per lap of tyre life.
function stintRuns(laps, stints){
  const lapsByDrv = groupByDriver(laps);
  const stintsByDrv = groupByDriver(stints);
  const runs = [];
  Object.keys(stintsByDrv).map(Number).forEach(n => {
    const dl = lapsByDrv[n] || [];
    let lastLap = null;
    for (const l of dl){ const v = num(l.lap_number); if (v!=null && (lastLap==null || v>lastLap)) lastLap = v; }
    reconstructStints(stintsByDrv[n], lastLap).forEach(st => {
      const inStint = dl.filter(l => {
        const ln = num(l.lap_number);
        return ln!=null && ln>=st.start && ln<=st.end && !l.is_pit_out_lap && num(l.lap_duration)!=null && num(l.lap_duration)>0;
      }).map(l => ({ x: num(l.lap_number) - st.start + 1, t: num(l.lap_duration) }));
      if (inStint.length < 5) return;
      const fastest = Math.min(...inStint.map(p => p.t));
      const points = inStint.filter(p => p.t <= fastest * PACE_WINDOW);
      if (points.length < 5) return;                // not enough representative green-flag laps
      runs.push({ driver: n, compound: st.cmp, startLap: st.start, points });
    });
  });
  return runs;
}

// long-run pace per driver: each clean stint -> median lap time. returns { n: {best:{compound,laps,median}, runs:[...]} }
function longRunPace(laps, stints){
  const byDriver = {};
  stintRuns(laps, stints).forEach(r => {
    const run = { compound: r.compound, laps: r.points.length, median: median(r.points.map(p => p.t)) };
    (byDriver[r.driver] = byDriver[r.driver] || { runs: [] }).runs.push(run);
  });
  Object.keys(byDriver).map(Number).forEach(n => {
    byDriver[n].best = byDriver[n].runs.slice().sort((a,b)=> a.median - b.median)[0];
  });
  return byDriver;
}

// Tyre-degradation model from a set of stint runs. Each run is fitted (lap time vs lap-in-stint);
// the slope is the observed lap-time trend, which blends tyre wear with the fuel-burn gain. Adding
// FUEL_S_PER_LAP back isolates the tyre component. Runs are aggregated per compound by median (robust
// to a single scrappy stint). Returns COMPOUND_ORDER-sorted entries:
//   { compound, degRate, observedSlope, basePace, intercept, stints, runs:[{driver,points,slope,intercept}] }
function tyreDegModel(runs){
  const byCmp = {};
  for (const r of runs){
    if (r.compound === 'UNKNOWN') continue;            // can't attribute deg to an unknown compound
    const fit = linFit(r.points.map(p => ({ x: p.x, y: p.t }))); if (!fit) continue;
    (byCmp[r.compound] = byCmp[r.compound] || []).push({
      driver: r.driver, points: r.points, slope: fit.slope, intercept: fit.intercept,
      median: median(r.points.map(p => p.t)),
    });
  }
  return COMPOUND_ORDER.map(cmp => {
    const rs = byCmp[cmp]; if (!rs || !rs.length) return null;
    const observedSlope = median(rs.map(r => r.slope));
    return {
      compound: cmp,
      observedSlope,
      degRate: observedSlope + FUEL_S_PER_LAP,
      basePace: median(rs.map(r => r.median)),
      intercept: median(rs.map(r => r.intercept)),
      stints: rs.length,
      runs: rs,
    };
  }).filter(Boolean);
}
// signed deg rate, e.g. +0.043 / −0.012 (s/lap)
function fmtDeg(v){ const n = num(v); if (n==null) return '—'; return (n>=0?'+':'−') + Math.abs(n).toFixed(3); }

/* ---------- car performance: telemetry analysis ---------- */
// a driver's fastest clean lap, with date_start (needed to bound the car_data fetch)
function fastestCleanLapRow(laps){
  let best = null;
  for (const l of (laps||[])){
    if (l.is_pit_out_lap || !l.date_start) continue;
    const d = num(l.lap_duration); if (d==null || d<=0) continue;
    if (!best || d < num(best.lap_duration)) best = l;
  }
  return best;
}
function avg(arr){ return arr.reduce((a,b)=>a+b,0) / arr.length; }
// centred moving average over the speed trace, to smooth out telemetry noise
function smoothSpeeds(samples, win){
  return samples.map((s,i) => {
    let sum=0, cnt=0;
    for (let j=Math.max(0,i-win); j<=Math.min(samples.length-1,i+win); j++){ sum += samples[j].speed; cnt++; }
    return sum/cnt;
  });
}
// walk peak->valley pairs; a valley counts as a "corner" if it dropped enough from the preceding peak
function findCorners(sm, dropKmh){
  const out = []; let i = 0;
  while (i < sm.length - 1){
    let peak = i;
    while (peak < sm.length-1 && sm[peak+1] >= sm[peak]) peak++;
    let valley = peak;
    while (valley < sm.length-1 && sm[valley+1] <= sm[valley]) valley++;
    if (sm[peak] - sm[valley] >= dropKmh) out.push({ idx: valley, speed: sm[valley] });
    i = (valley > i) ? valley : i+1;
  }
  return out;
}
// speed gained per second over the window following a corner-exit minimum
function accelAfter(samples, sm, idx, windowS){
  const t0 = new Date(samples[idx].date).getTime();
  for (let k=idx+1; k<samples.length; k++){
    const dt = (new Date(samples[k].date).getTime() - t0) / 1000;
    if (dt >= windowS) return (sm[k] - sm[idx]) / dt;
  }
  return null;
}
// from one lap's car_data samples: top speed, corner-exit acceleration, slow/medium/fast cornering speeds
function analyseLapTelemetry(samples){
  const clean = (Array.isArray(samples)?samples:[])
    .filter(s => s.date && num(s.speed)!=null)
    .map(s => ({ date: s.date, speed: num(s.speed) }));
  if (clean.length < 8) return null;
  clean.sort((a,b)=> new Date(a.date)-new Date(b.date));
  const sm = smoothSpeeds(clean, 2);
  const topSpeed = Math.max(...sm);
  const corners = findCorners(sm, CORNER_DROP_KMH);
  const buckets = { slow: [], medium: [], fast: [] };
  const accels = [];
  corners.forEach(c => {
    const bucket = c.speed < CORNER_SLOW_MAX ? 'slow' : (c.speed > CORNER_FAST_MIN ? 'fast' : 'medium');
    buckets[bucket].push(c.speed);
    const a = accelAfter(clean, sm, c.idx, ACCEL_WINDOW_S);
    if (a != null) accels.push(a);
  });
  return {
    topSpeed,
    accel: accels.length ? avg(accels) : null,
    cornerSlow: buckets.slow.length ? avg(buckets.slow) : null,
    cornerMedium: buckets.medium.length ? avg(buckets.medium) : null,
    cornerFast: buckets.fast.length ? avg(buckets.fast) : null,
  };
}
// rank a {n,v} list and spread scores evenly 0-100 by percentile (so close raw values still separate visually);
// invert=true for "lower is better" metrics (lap/pace times)
function percentileScore(entries, invert){
  const out = {};
  const valid = entries.filter(e=>e.v!=null);
  entries.forEach(e => { if (e.v == null) out[e.n] = null; });
  if (!valid.length) return out;
  const sorted = [...valid].sort((a,b)=>a.v-b.v);
  const n = sorted.length;
  sorted.forEach((e,i) => {
    const score = n>1 ? i/(n-1)*100 : 100;
    out[e.n] = invert ? 100-score : score;
  });
  return out;
}

/* compound swatch tag */
function compoundTag(cmp){
  const fill = { SOFT:'#E8443B', MEDIUM:'#F2C14E', HARD:'#E6E1D4', INTERMEDIATE:'#3FBF6F', WET:'#3E82F7' }[cmp] || '#B8AE9C';
  const label = cmp.charAt(0) + cmp.slice(1).toLowerCase();
  return `<span class="cmp-tag"><i style="background:${fill}"></i>${esc(label)}</span>`;
}
// chart line/point colour per compound — darker than the swatch fills so they read on the cream chart
// background (the swatch HARD/MEDIUM are pale by design); falls back to ink-grey for unknowns.
function compoundColour(cmp){
  return { SOFT:'#E8443B', MEDIUM:'#D49A1E', HARD:'#8C8475', INTERMEDIATE:'#2E9E57', WET:'#3E82F7' }[cmp] || '#B8AE9C';
}
const COMPOUND_ORDER = ['SOFT','MEDIUM','HARD','INTERMEDIATE','WET','UNKNOWN'];

/* ============================================================
   SESSION CLASSIFICATION + VIEW SWITCHING
   ============================================================ */
function sessionKind(s){
  const t = (s?.session_type || '').toLowerCase();
  if (t === 'practice') return 'practice';
  if (t === 'qualifying') return 'qualifying';
  if (t === 'race') return 'race';
  // fall back to the name if session_type is missing/odd
  const n = (s?.session_name || '').toLowerCase();
  if (n.includes('practice')) return 'practice';
  if (n.includes('qualifying') || n.includes('shootout')) return 'qualifying';
  return 'race';
}
// a weekend is "sprint" if any of its sessions is a sprint race / sprint qualifying / shootout
function isSprintWeekend(){
  return state.sessions.some(s => /sprint/i.test(`${s?.session_name || ''} ${s?.session_type || ''}`));
}
const ALL_SECTIONS = ['sec-theoretical','sec-longrun','sec-qpace','sec-qtheo','sec-rpi','sec-tyredeg','sec-strategysim','sec-undercut','sec-scwhatif','sec-history','sec-strategy','sec-position','sec-carperf','sec-lapchart','sec-pitloss'];
const VIEW_SECTIONS = {
  practice:   ['sec-theoretical','sec-longrun','sec-pitloss'],
  qualifying: ['sec-qpace','sec-qtheo','sec-carperf'],                    // raw quali-session analysis
  prerace:    ['sec-rpi','sec-tyredeg','sec-strategysim','sec-undercut','sec-scwhatif','sec-pitloss'],  // forward-looking race predictors
  race:       ['sec-history','sec-strategy','sec-position','sec-carperf','sec-lapchart'],
};
// the qualifying weekend offers two tabs; the rest are single-view
const QUALI_TABS = [['qualifying','Qualifying'],['prerace','Pre-Race']];
function showView(kind){
  destroyAllCharts();
  state.raceRedraw = {};        // drop stale redraw closures from the previous session
  ALL_SECTIONS.forEach(id => { const n=$(id); if (n) n.style.display = 'none'; });
  // qualifying weekends split into a "Qualifying" / "Pre-Race" tab pair
  const tabs = $('viewTabs');
  if (tabs){
    if (kind === 'qualifying' || kind === 'prerace'){
      tabs.innerHTML = `<div class="seg viewtab">${QUALI_TABS.map(([v,l]) =>
        `<button type="button" data-view="${v}" class="${kind===v?'active':''}">${esc(l)}</button>`).join('')}</div>`;
      tabs.style.display = '';
      wireViewTabs(tabs.querySelector('.seg.viewtab'));
    } else { tabs.style.display = 'none'; tabs.innerHTML = ''; }
  }
  // one shared Top-N toggle for every race chart (only shown in the race view)
  const bar = $('raceTopBar');
  if (bar){
    if (kind === 'race'){
      bar.innerHTML = `<span class="topbar-label">Pit stops</span>${pitToggle()}`
        + `<span class="topbar-label topbar-gap">Drivers shown</span>${topToolbar()}`;
      bar.style.display = '';
      wirePits(bar.querySelector('.seg.pits'));
      wireTopN(bar.querySelector('.seg.topn'));
    } else { bar.style.display = 'none'; bar.innerHTML = ''; }
  }
  const ids = VIEW_SECTIONS[kind] || [];
  ids.forEach((id, i) => {
    const n = $(id); if (!n) return;
    n.style.display = '';
    const idx = n.querySelector('.idx'); if (idx) idx.textContent = String(i+1).padStart(2,'0');
  });
}
function hideAllSections(){ ALL_SECTIONS.forEach(id => { const n=$(id); if (n) n.style.display='none'; }); const bar=$('raceTopBar'); if (bar){ bar.style.display='none'; bar.innerHTML=''; } const tabs=$('viewTabs'); if (tabs){ tabs.style.display='none'; tabs.innerHTML=''; } }

// switch between the Qualifying / Pre-Race tabs of a qualifying weekend, re-rendering
// the now-visible sections so charts size correctly (they can't draw while display:none)
function wireViewTabs(seg){
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    const view = b.dataset.view; if (state.view === view) return;
    state.view = view;
    showView(view);
    writeHash();
    const s = state.session; if (s) dispatchView(view, s, s.session_key);
  });
}

// run the render functions belonging to a given view; mirrors the dispatch in loadSession
function dispatchView(view, s, session_key){
  if (view === 'practice'){
    renderTheoretical(session_key);
    renderLongRun(session_key);
    renderPitLoss();
  } else if (view === 'qualifying'){
    renderQualiPace(session_key);
    renderQualiTheo(s);
    renderCarPerformance(session_key, 'qualifying', s);
  } else if (view === 'prerace'){
    renderRPI(s);
    renderTyreDeg(s);
    renderStrategySim(s);
    renderUndercut(s);
    renderSCWhatif(s);
    renderPitLoss();
  } else {
    renderLapChart(session_key);
    renderHistory(session_key);
    renderStrategy(session_key);
    renderPosition(session_key);
    renderCarPerformance(session_key, 'race', s);
  }
}

function showNotice(eyebrow, title, body){
  $('ntEyebrow').textContent = eyebrow; $('ntTitle').textContent = title; $('ntBody').textContent = body;
  $('notice').classList.add('show');
}
function hideNotice(){ $('notice').classList.remove('show'); }

function setSessionBanner(s){
  $('sessbar').style.display = '';
  const m = state.meetings.find(x => x.meeting_key === s.meeting_key);
  $('sbGp').textContent = (m?.meeting_name) || s.location || 'Grand Prix';
  const where = [s.circuit_short_name || s.location, s.country_name].filter(Boolean).join(', ');
  $('sbSub').textContent = [s.session_name, osloDateTime(s.date_start), where].filter(Boolean).join('  ·  ');
  const kind = sessionKind(s);
  const pill = $('sbType');
  pill.className = 'typepill ' + kind;
  pill.textContent = s.session_name || kind;
}

/* ============================================================
   PICKER
   ============================================================ */
function fillSelect(sel, items, { value, label, selected }){
  sel.innerHTML = items.map(it => {
    const v = value(it), l = label(it);
    return `<option value="${esc(v)}"${String(v)===String(selected)?' selected':''}>${esc(l)}</option>`;
  }).join('');
  sel.disabled = items.length === 0;
}

function populateYears(){
  const cur = new Date().getFullYear();
  const years = [];
  for (let y = cur; y >= FIRST_YEAR; y--) years.push(y);
  fillSelect($('selYear'), years, { value: y=>y, label: y=>y, selected: cur });
}

async function loadMeetings(year){
  const sel = $('selMeeting');
  sel.innerHTML = '<option>Loading…</option>'; sel.disabled = true;
  const data = await cachedJSON(`pwa.meetings.${year}`, `${OPENF1}meetings?year=${year}`);
  // chronological; the picker lists most-recent first
  state.meetings = (Array.isArray(data)?data:[]).slice().sort((a,b)=> new Date(a.date_start)-new Date(b.date_start));
  const ordered = state.meetings.slice().reverse();
  fillSelect(sel, ordered, { value: m=>m.meeting_key, label: m=>m.meeting_name || m.location || ('Meeting '+m.meeting_key) });
}

async function loadSessions(meeting_key){
  const sel = $('selSession');
  sel.innerHTML = '<option>Loading…</option>'; sel.disabled = true;
  const data = await cachedJSON(`pwa.sessions.${meeting_key}`, `${OPENF1}sessions?meeting_key=${meeting_key}`);
  state.sessions = (Array.isArray(data)?data:[]).slice().sort((a,b)=> new Date(a.date_start)-new Date(b.date_start));
  // default to the last session that has already finished, else the last one listed
  const now = Date.now();
  const finished = state.sessions.filter(s => new Date(s.date_end).getTime() < now);
  const def = finished.length ? finished[finished.length-1] : state.sessions[state.sessions.length-1];
  fillSelect(sel, state.sessions, { value: s=>s.session_key, label: s=>s.session_name || s.session_type, selected: def?.session_key });
}

/* ============================================================
   MAIN: load + analyse the selected session
   ============================================================ */
async function loadSession(session_key){
  const s = state.sessions.find(x => String(x.session_key) === String(session_key));
  if (!s){ return; }
  state.renderGen++;   // invalidate any panel retries still pending from a previous session
  state.session = s;
  setSessionBanner(s);

  // qualifying weekends default to the Qualifying tab, but a shared link may pin Pre-Race
  const kind = sessionKind(s);
  const view = (kind === 'qualifying' && state.pendingTab === 'prerace') ? 'prerace' : kind;
  state.pendingTab = null;
  state.view = view;
  writeHash();   // reflect the selection (and active tab) in the URL so it can be shared/bookmarked

  // guard: session not finished yet — historical endpoints would be empty
  if (new Date(s.date_end).getTime() >= Date.now()){
    hideAllSections(); destroyAllCharts();
    showNotice('Not finished yet',
      `${s.session_name} hasn’t run yet`,
      `This session is scheduled for ${osloDateTime(s.date_start)} (Oslo). OpenF1’s historical data — and these analyses — become available once it has finished. For a session in progress, head to the live Pit Wall.`);
    return;
  }
  hideNotice();
  showView(view);

  // drivers for the selected session (numbers are stable across the weekend)
  try { state.drivers = loadDriversInto(await fetchDrivers(session_key)); }
  catch (e){ logError('drivers', e); state.drivers = {}; }

  dispatchView(view, s, session_key);
}

/* ---------- PRACTICE: theoretical best lap ---------- */
async function renderTheoretical(session_key, attempt=0){
  const body = $('theoreticalBody'); body.innerHTML = loadingBox('Computing theoretical best laps…');
  try {
    const laps = await fetchLaps(session_key);
    const groups = groupByDriver(laps);
    const rows = Object.keys(groups).map(Number).map(n => {
      const t = theoretical(groups[n]);
      return { n, ...t, left: (t.actual!=null && t.theo!=null) ? t.actual - t.theo : null };
    }).filter(r => r.actual!=null || r.theo!=null)
      .sort((a,b)=> (a.theo ?? a.actual ?? Infinity) - (b.theo ?? b.actual ?? Infinity));
    if (!rows.length){ body.innerHTML = stateBox('No data', 'No lap times recorded for this session.'); return; }
    body.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>#</th><th>Driver</th><th class="tar">Actual best</th><th class="tar">Theoretical</th><th class="tar">Left on table</th></tr></thead>
      <tbody>${rows.map((r,i)=> `<tr class="${i===0?'best':''}" style="--team:${drvColour(r.n)}">
        <td class="pos">${i+1}</td>
        ${drvCell(r.n)}
        <td class="num tar">${fmtLap(r.actual)}</td>
        <td class="num tar"><b>${fmtLap(r.theo)}</b>${i===0?'<span class="best-badge">Best</span>':''}</td>
        <td class="num tar ${r.left!=null && r.left>0.001?'loss':'muted'}">${r.left!=null?('−'+r.left.toFixed(3)):'—'}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="panel-note">Theoretical best sums each driver’s quickest sector 1, 2 and 3 from this session — the lap they could have strung together. “Left on table” is how much their real fastest lap missed it by. Deleted laps aren’t flagged in the public data, so treat outliers with a pinch of salt.</div>`;
  } catch (e){ panelRetry('theoretical', e, body, attempt, () => renderTheoretical(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load lap data for this session.', 'error')); }
}

/* ---------- PRACTICE: long-run pace ---------- */
async function renderLongRun(session_key, attempt=0){
  const body = $('longrunBody'); body.innerHTML = loadingBox('Finding race-sim stints…');
  try {
    const [laps, stints] = await Promise.all([ fetchLaps(session_key), fetchStints(session_key) ]);
    const pace = longRunPace(laps, stints);
    const rows = Object.keys(pace).map(Number).map(n => ({ n, ...pace[n].best }))
      .sort((a,b)=> a.median - b.median);
    if (!rows.length){ body.innerHTML = stateBox('No long runs', 'No stint of 5+ clean laps on one compound was found — typical of a short or stop-start practice session.'); return; }
    const leader = rows[0].median;
    body.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>#</th><th>Driver</th><th>Tyre</th><th class="tar">Laps</th><th class="tar">Median lap</th><th class="tar">Gap</th></tr></thead>
      <tbody>${rows.map((r,i)=> `<tr class="${i===0?'best':''}" style="--team:${drvColour(r.n)}">
        <td class="pos">${i+1}</td>
        ${drvCell(r.n)}
        <td>${compoundTag(r.compound)}</td>
        <td class="num tar muted">${r.laps}</td>
        <td class="num tar"><b>${fmtLap(r.median)}</b>${i===0?'<span class="best-badge">Quickest</span>':''}</td>
        <td class="num tar ${i===0?'muted':''}">${i===0?'—':fmtGap(r.median-leader)}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="panel-note">Each driver’s best race-sim stint: 5+ laps on one compound, median of the laps within ${Math.round((PACE_WINDOW-1)*100)}% of that stint’s quickest (filtering out traffic and cool-down laps). Fuel loads differ between cars, so read this as a directional pace guide rather than a stopwatch.</div>`;
  } catch (e){ panelRetry('long-run', e, body, attempt, () => renderLongRun(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load stint/lap data.', 'error')); }
}

/* ---------- QUALIFYING: pace ranking ---------- */
async function renderQualiPace(session_key, attempt=0){
  const body = $('qpaceBody'); body.innerHTML = loadingBox('Ranking qualifying laps…');
  try {
    const laps = await fetchLaps(session_key);
    const groups = groupByDriver(laps);
    const rows = Object.keys(groups).map(Number).map(n => ({ n, best: bestLap(groups[n]) }))
      .filter(r => r.best!=null).sort((a,b)=> a.best - b.best);
    if (!rows.length){ body.innerHTML = stateBox('No data', 'No lap times recorded for this session.'); return; }
    const mode = state.qualiView.qpace;
    body.innerHTML = segToolbar('qpace', mode) + `<div id="qpaceView"></div>`
      + `<div class="panel-note">Each driver’s single quickest lap of the session, regardless of which segment (Q1/Q2/Q3) it was set in. “Gap” is to the fastest lap; “Interval” is to the car immediately ahead.</div>`;
    const paint = (m) => { if (m === 'graph') drawQpaceChart(rows); else { destroyChart('qpace'); $('qpaceView').innerHTML = qpaceTable(rows); } };
    wireSeg('qpace', paint);
    paint(mode);
  } catch (e){ panelRetry('quali pace', e, body, attempt, () => renderQualiPace(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load lap data.', 'error')); }
}
function qpaceTable(rows){
  const pole = rows[0].best;
  return `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>#</th><th>Driver</th><th class="tar">Best lap</th><th class="tar">Gap</th><th class="tar">Interval</th></tr></thead>
    <tbody>${rows.map((r,i)=> `<tr class="${i===0?'best':''}" style="--team:${drvColour(r.n)}">
      <td class="pos">${i+1}</td>
      ${drvCell(r.n)}
      <td class="num tar"><b>${fmtLap(r.best)}</b>${i===0?'<span class="best-badge">Pole</span>':''}</td>
      <td class="num tar ${i===0?'muted':''}">${i===0?'—':fmtGap(r.best-pole)}</td>
      <td class="num tar muted">${i===0?'—':fmtGap(r.best-rows[i-1].best)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
function drawQpaceChart(rows){
  const pole = rows[0].best;
  const view = $('qpaceView'); if (!view) return;
  const h = Math.max(280, rows.length * 26 + 56);
  view.innerHTML = `<div class="chart-box" style="height:${h}px"><canvas id="qpaceCanvas"></canvas></div>`;
  destroyChart('qpace');
  if (!window.Chart) return;
  const ctx = $('qpaceCanvas'); if (!ctx) return;
  const colours = rows.map(r => drvColour(r.n));
  state.charts.qpace = new Chart(ctx, {
    type:'bar',
    data:{ labels: rows.map(r => drv(r.n).acr),
      datasets:[{ data: rows.map(r => r.best - pole), backgroundColor: colours, borderColor: colours, borderWidth:1, borderRadius:2, barPercentage:0.84, categoryPercentage:0.84 }] },
    options: Object.assign(chartBase({}), {
      indexAxis:'y',
      plugins:{
        legend:{ display:false },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ title:(it)=> { const r=rows[it[0].dataIndex]; return `${drv(r.n).acr} — ${drv(r.n).name}`; },
            label:(it)=> { const r=rows[it.dataIndex]; return [`Best  ${fmtLap(r.best)}`, it.dataIndex===0 ? 'Pole' : `Gap  ${fmtGap(r.best-pole)}`]; } } },
      },
      scales:{
        x:{ beginAtZero:true, grid:{ color:'#C9C0AE' }, ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback:(v)=> '+'+Number(v).toFixed(1) }, title:{ display:true, text:'Gap to pole (s)', color:'#8C8475', font:{size:10} } },
        y:{ grid:{ color:'transparent' }, ticks:{ color:'#5C554A', font:{family:"'IBM Plex Mono',monospace",size:11} } },
      }
    })
  });
}

/* ---------- QUALIFYING: actual vs practice theoretical ---------- */
async function renderQualiTheo(qSession, attempt=0){
  const body = $('qtheoBody'); body.innerHTML = loadingBox('Comparing quali laps to practice potential…');
  try {
    const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
    if (!practice.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No practice', 'No practice sessions for this weekend in the data, so there’s no practice benchmark to compare against.'); return; }
    // combine every practice lap per driver, then take their theoretical best across all of practice
    const practiceLaps = (await Promise.all(practice.map(s => fetchLaps(s.session_key).catch(()=>[]))))
      .flat();
    const pGroups = groupByDriver(practiceLaps);
    const theoByDrv = {};
    Object.keys(pGroups).map(Number).forEach(n => { theoByDrv[n] = theoretical(pGroups[n]).theo; });

    const qLaps = await fetchLaps(qSession.session_key);
    const qGroups = groupByDriver(qLaps);
    const rows = Object.keys(qGroups).map(Number).map(n => {
      const q = bestLap(qGroups[n]); const t = theoByDrv[n] ?? null;
      return { n, q, t, gap: (q!=null && t!=null) ? q - t : null };
    }).filter(r => r.q!=null).sort((a,b)=> a.q - b.q);
    if (!rows.length){ body.innerHTML = stateBox('No data', 'No qualifying lap times recorded for this session.'); return; }
    const mode = state.qualiView.qtheo;
    body.innerHTML = segToolbar('qtheo', mode) + `<div id="qtheoView"></div>`
      + `<div class="panel-note">Practice potential is each driver’s theoretical best (quickest sectors summed) across all of practice. A <span class="gain">negative</span> delta means they found more in qualifying than practice suggested — track evolution, lower fuel, tow. A <span class="loss">positive</span> one means they left time on the table relative to their practice ceiling.</div>`;
    const paint = (m) => { if (m === 'graph') drawQtheoChart(rows); else { destroyChart('qtheo'); $('qtheoView').innerHTML = qtheoTable(rows); } };
    wireSeg('qtheo', paint);
    paint(mode);
  } catch (e){ panelRetry('quali-theo', e, body, attempt, () => renderQualiTheo(qSession, attempt+1), stateBox('Unavailable', 'Couldn’t load practice/qualifying data.', 'error')); }
}
function qtheoTable(rows){
  return `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>#</th><th>Driver</th><th class="tar">Quali best</th><th class="tar">Practice potential</th><th class="tar">Δ to potential</th></tr></thead>
    <tbody>${rows.map((r,i)=> `<tr style="--team:${drvColour(r.n)}">
      <td class="pos">${i+1}</td>
      ${drvCell(r.n)}
      <td class="num tar"><b>${fmtLap(r.q)}</b></td>
      <td class="num tar muted">${fmtLap(r.t)}</td>
      <td class="num tar ${r.gap==null?'muted':(r.gap<0?'gain':'loss')}">${r.gap==null?'—':fmtGap(r.gap)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
function drawQtheoChart(rows){
  const view = $('qtheoView'); if (!view) return;
  const withGap = rows.filter(r => r.gap!=null).sort((a,b)=> a.gap - b.gap);   // most improved at the top
  if (!withGap.length){ destroyChart('qtheo'); view.innerHTML = stateBox('No benchmark', 'No practice potential to compare against for these drivers (no clean practice laps).'); return; }
  const h = Math.max(280, withGap.length * 26 + 56);
  view.innerHTML = `<div class="chart-box" style="height:${h}px"><canvas id="qtheoCanvas"></canvas></div>`;
  destroyChart('qtheo');
  if (!window.Chart) return;
  const ctx = $('qtheoCanvas'); if (!ctx) return;
  const colours = withGap.map(r => drvColour(r.n));   // colour per team, matching the Qualifying Pace chart above
  state.charts.qtheo = new Chart(ctx, {
    type:'bar',
    data:{ labels: withGap.map(r => drv(r.n).acr),
      datasets:[{ data: withGap.map(r => r.gap), backgroundColor: colours, borderColor: colours, borderWidth:1, borderRadius:2, barPercentage:0.84, categoryPercentage:0.84 }] },
    plugins:[baselinePlugin],
    options: Object.assign(chartBase({}), {
      indexAxis:'y',
      plugins:{
        baseline:{ axis:'x', color:'#211D17', width:1.5 },
        legend:{ display:false },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ title:(it)=> { const r=withGap[it[0].dataIndex]; return `${drv(r.n).acr} — ${drv(r.n).name}`; },
            label:(it)=> { const r=withGap[it.dataIndex]; return [`Quali  ${fmtLap(r.q)}`, `Potential  ${fmtLap(r.t)}`, `Δ  ${fmtGap(r.gap)}`]; } } },
      },
      scales:{
        x:{ grid:{ color:'#C9C0AE' },
            ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback:(v)=> fmtGap(v) },
            title:{ display:true, text:'Δ to potential (s) · left = found more', color:'#8C8475', font:{size:10} } },
        y:{ grid:{ color:'transparent' }, ticks:{ color:'#5C554A', font:{family:"'IBM Plex Mono',monospace",size:11} } },
      }
    })
  });
}

/* ---------- QUALIFYING: race pace indicator ---------- */
async function renderRPI(qSession, attempt=0){
  const body = $('rpiBody'); body.innerHTML = loadingBox('Building the race-pace picture…');
  try {
    // long-run source: prefer FP2, then FP3, then FP1 (teams run race sims mainly in FP2)
    const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
    const byName = (frag) => practice.find(s => (s.session_name||'').toLowerCase().includes(frag));
    const lrSession = byName('practice 2') || byName('practice 3') || byName('practice 1') || practice[practice.length-1];

    let lrPace = {};
    if (lrSession){
      const [laps, stints] = await Promise.all([ fetchLaps(lrSession.session_key), fetchStints(lrSession.session_key) ]);
      lrPace = longRunPace(laps, stints);
    }
    const qLaps = await fetchLaps(qSession.session_key);
    const qGroups = groupByDriver(qLaps);
    const qBest = {};
    Object.keys(qGroups).map(Number).forEach(n => { const b = bestLap(qGroups[n]); if (b!=null) qBest[n] = b; });

    // rank each metric independently
    const qRank = rankMap(Object.entries(qBest).map(([n,v])=>({n:Number(n),v})));
    const lrEntries = Object.keys(lrPace).map(n => ({ n:Number(n), v: lrPace[n].best.median }));
    const lrRank = rankMap(lrEntries);

    const drivers = Array.from(new Set([...Object.keys(qBest), ...Object.keys(lrPace)].map(Number)));
    if (!drivers.length){ body.innerHTML = stateBox('No data', 'Not enough qualifying or long-run data to build an indicator.'); return; }
    const rows = drivers.map(n => {
      const qr = qRank[n] ?? null, lr = lrRank[n] ?? null;
      const parts = [qr, lr].filter(x => x!=null);
      const combined = parts.length ? parts.reduce((a,b)=>a+b,0)/parts.length : Infinity;
      return { n, qr, lr, lrMedian: lrPace[n]?.best.median ?? null, lrCompound: lrPace[n]?.best.compound ?? null, combined };
    }).sort((a,b)=> a.combined - b.combined);

    const lrLabel = lrSession ? esc(lrSession.session_name) : 'practice';
    body.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>#</th><th>Driver</th><th class="tar">Quali rank</th><th class="tar">Long-run rank</th><th class="tar">Long-run pace</th><th class="tar">Combined</th></tr></thead>
      <tbody>${rows.map((r,i)=> `<tr class="${i===0?'best':''}" style="--team:${drvColour(r.n)}">
        <td class="pos">${i+1}</td>
        ${drvCell(r.n)}
        <td class="num tar ${r.qr==null?'muted':''}">${r.qr ?? '—'}</td>
        <td class="num tar ${r.lr==null?'muted':''}">${r.lr ?? '—'}</td>
        <td class="num tar muted">${r.lrMedian!=null?fmtLap(r.lrMedian):'—'}</td>
        <td class="num tar"><b>${r.combined===Infinity?'—':r.combined.toFixed(1)}</b></td>
      </tr>`).join('')}</tbody></table></div>
      <div class="panel-note"><b>Informational, not a prediction.</b> This blends one-lap qualifying rank with long-run pace rank (from ${lrLabel}) into a single directional signal of who looks strong heading into the race. It can’t see fuel loads, reliability, weather, strategy or Sunday track evolution — so it’s a rough guide, not a forecast.</div>`;
  } catch (e){ panelRetry('rpi', e, body, attempt, () => renderRPI(qSession, attempt+1), stateBox('Unavailable', 'Couldn’t assemble the race-pace indicator.', 'error')); }
}
// {n,v} (lower v = better) -> {n: rank}
function rankMap(entries){
  const sorted = entries.filter(e => e.v!=null).sort((a,b)=> a.v-b.v);
  const m = {}; sorted.forEach((e,i)=> m[e.n] = i+1); return m;
}

/* ---------- QUALIFYING: tyre-degradation model ---------- */
// Pool race-sim long runs from EVERY practice session this weekend and model per-compound tyre deg.
// Lap and stint numbers reset per session, so runs are built per session and concatenated — laps are
// never flattened across sessions. Memoised per meeting on state. Also feeds the strategy optimiser.
async function practiceDegModel(){
  const mk = state.session?.meeting_key ?? null;
  if (state.degModel && state.degModel.meeting === mk) return state.degModel;
  const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
  const runs = [];
  for (const s of practice){
    let laps, stints;
    try { [laps, stints] = await Promise.all([ fetchLaps(s.session_key), fetchStints(s.session_key) ]); }
    catch (e){ logError('deg fetch ' + s.session_key, e); continue; }
    runs.push(...stintRuns(laps, stints));
  }
  state.degModel = { meeting: mk, model: tyreDegModel(runs), practiceCount: practice.length };
  return state.degModel;
}
async function renderTyreDeg(qSession, attempt=0){
  const body = $('tyredegBody'); if (!body) return;
  body.innerHTML = loadingBox('Modelling tyre degradation from practice long runs…');
  try {
    const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
    if (!practice.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No practice', 'No practice sessions for this weekend in the data, so there are no long runs to model tyre degradation from.'); return; }
    const { model } = await practiceDegModel();
    if (!model.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No long runs', 'No stint of 5+ clean laps on a known compound was found across this weekend’s practice sessions, so degradation can’t be modelled — practice may have been wet or red-flagged.'); return; }

    body.innerHTML = `${tyreDegTable(model)}<div class="chart-box" style="height:340px"><canvas id="tyredegCanvas"></canvas></div>
      <div class="panel-note"><b>Informational, not a prediction.</b> Each compound’s lap-time trend through a stint, fitted from race-sim long runs across all of this weekend’s practice sessions and corrected for fuel burn (assumed ${FUEL_S_PER_LAP.toFixed(3)}s/lap), to isolate tyre wear. <b>Deg</b> is the resulting pace loss per lap; <b>base pace</b> is a typical long-run lap. Pooled across drivers and sessions, so the vertical scatter mixes car pace and track evolution — it’s the slope that matters. Practice fuel loads and traffic add noise, so read it as a guide to which tyres drop off fastest, not a stopwatch.</div>`;
    drawTyreDegChart(model);
  } catch (e){ panelRetry('tyre-deg', e, body, attempt, () => renderTyreDeg(qSession, attempt+1), stateBox('Unavailable', 'Couldn’t model tyre degradation.', 'error')); }
}
function tyreDegTable(model){
  const ordered = model.slice().sort((a,b)=> a.degRate - b.degRate);   // gentlest deg first
  return `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>Tyre</th><th class="tar">Deg</th><th class="tar">Base pace</th><th class="tar">Stints</th></tr></thead>
    <tbody>${ordered.map((m,i)=> `<tr class="${i===0?'best':''}" style="--team:${compoundColour(m.compound)}">
      <td>${compoundTag(m.compound)}</td>
      <td class="num tar"><b>${fmtDeg(m.degRate)}</b><span class="muted"> s/lap</span></td>
      <td class="num tar muted">${fmtLap(m.basePace)}</td>
      <td class="num tar muted">${m.stints}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
function drawTyreDegChart(model){
  destroyChart('tyredeg');
  if (!window.Chart) return;                       // table still renders; chart is progressive enhancement
  const ctx = $('tyredegCanvas'); if (!ctx) return;
  const allT = model.flatMap(m => m.runs.flatMap(r => r.points.map(p => p.t)));
  if (!allT.length) return;
  const yMin = Math.min(...allT) - 0.4, yMax = Math.max(...allT) + 0.4;
  const datasets = [];
  model.forEach(m => {
    const colour = compoundColour(m.compound);
    // raw clean laps (faint), then the fitted deg line on top
    datasets.push({
      data: m.runs.flatMap(r => r.points.map(p => ({ x: p.x, y: p.t }))),
      backgroundColor: colour+'66', borderColor: 'transparent', pointRadius: 2.4, pointHoverRadius: 4, showLine: false,
      _cmp: m.compound,
    });
    const maxX = Math.max(...m.runs.flatMap(r => r.points.map(p => p.x)));
    datasets.push({
      label: m.compound.charAt(0)+m.compound.slice(1).toLowerCase(),
      data: [{ x:1, y: m.intercept + m.observedSlope*1 }, { x:maxX, y: m.intercept + m.observedSlope*maxX }],
      borderColor: colour, backgroundColor: colour, borderWidth: 2.5, pointRadius: 0, showLine: true, fill: false,
    });
  });
  state.charts.tyredeg = new Chart(ctx, {
    type:'scatter',
    data:{ datasets },
    options: Object.assign(chartBase({}), {
      plugins:{
        legend:{ display:true, position:'top', labels:{ filter:(it)=> !!it.text, color:'#5C554A', boxWidth:10, boxHeight:10, font:{size:11} } },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          filter:(it)=> it.dataset.showLine === false,
          callbacks:{ title:(it)=> { const cmp = it[0].dataset._cmp; return cmp ? cmp.charAt(0)+cmp.slice(1).toLowerCase() : ''; },
            label:(it)=> [`Lap in stint  ${it.parsed.x}`, `Lap time  ${fmtLap(it.parsed.y)}`] } },
      },
      scales:{
        x:{ type:'linear', beginAtZero:false, grid:{ color:'#C9C0AE' },
            ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, precision:0 },
            title:{ display:true, text:'Lap in stint', color:'#8C8475', font:{size:10} } },
        y:{ min:yMin, max:yMax, grid:{ color:'#C9C0AE' },
            ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback:(v)=> fmtLap(v) },
            title:{ display:true, text:'Lap time', color:'#8C8475', font:{size:10} } },
      }
    })
  });
}

/* ---------- QUALIFYING: stint / stop-count strategy optimiser ---------- */
const DRY_COMPOUNDS = ['SOFT','MEDIUM','HARD'];
// race-lap counts for circuits where we may have to guess (no race session and no prior-year race);
// keyed by lowercased circuit_short_name / location, with common aliases. A last-ditch fallback only.
const CIRCUIT_LAPS = {
  'sakhir':57,'jeddah':50,'melbourne':58,'albert park':58,'suzuka':53,'shanghai':56,'miami':57,
  'imola':63,'monaco':78,'montreal':70,'montréal':70,'gilles villeneuve':70,'catalunya':66,'barcelona':66,
  'spielberg':71,'red bull ring':71,'silverstone':52,'hungaroring':70,'budapest':70,'spa-francorchamps':44,'spa':44,
  'zandvoort':72,'monza':53,'baku':51,'marina bay':62,'singapore':62,'austin':56,'americas':56,
  'mexico city':71,'interlagos':71,'são paulo':71,'sao paulo':71,'las vegas':50,'lusail':57,'losail':57,
  'qatar':57,'yas marina':58,'abu dhabi':58,
};
function maxLapNumber(laps){ let m=0; for (const l of (laps||[])){ const v=num(l.lap_number); if (v!=null && v>m) m=v; } return m || null; }
// Approximate green-flag race laps for the meeting. Primary: the meeting's own race once it has run.
// Fallbacks: the same circuit's race a season earlier, then a static table. Memoised per meeting.
async function raceLapCount(){
  const mk = state.session?.meeting_key ?? null;
  if (state.raceLaps && state.raceLaps.meeting === mk) return state.raceLaps;
  let laps = null, src = null;
  const race = state.sessions.find(s => sessionKind(s) === 'race');
  if (race && new Date(race.date_end).getTime() < Date.now()){
    try { laps = maxLapNumber(await fetchLaps(race.session_key)); if (laps!=null) src = 'this race'; } catch (e){ logError('race laps', e); }
  }
  const circuit = state.session?.circuit_short_name || null;
  if (laps == null && circuit && state.year && state.year - 1 >= FIRST_YEAR){
    try {
      const py = state.year - 1;
      const meetings = await cachedJSON(`pwa.meetings.${py}`, `${OPENF1}meetings?year=${py}`);
      const m = (Array.isArray(meetings)?meetings:[]).find(x => x.circuit_short_name === circuit);
      if (m){
        const ses = await cachedJSON(`pwa.sessions.${m.meeting_key}`, `${OPENF1}sessions?meeting_key=${m.meeting_key}`);
        const r = (Array.isArray(ses)?ses:[]).find(s => sessionKind(s) === 'race');
        if (r){ laps = maxLapNumber(await fetchLaps(r.session_key)); if (laps!=null) src = `${py} race`; }
      }
    } catch (e){ logError('prior-year race laps', e); }
  }
  if (laps == null){
    const key = (circuit || state.session?.location || '').toLowerCase();
    if (CIRCUIT_LAPS[key] != null){ laps = CIRCUIT_LAPS[key]; src = 'typical for this circuit'; }
  }
  state.raceLaps = { meeting: mk, laps, src };
  return state.raceLaps;
}

// projected total race time (s) for a list of [compound, laps] stints, with a pit loss per change.
// Lap time at tyre-lap i (0-based) = basePace + degRate*i; fuel burn is omitted because total laps are
// fixed, so it shifts every strategy equally and cancels for comparison.
function strategyTime(stints, byCmp, pitLoss){
  let t = 0;
  for (const [c, L] of stints){ const m = byCmp[c]; t += L*m.basePace + m.degRate*(L*(L-1)/2); }
  return t + (stints.length - 1) * pitLoss;
}
function bestOneStop(byCmp, pitLoss, L){
  const cmps = Object.keys(byCmp); let best = null;
  for (const A of cmps) for (const B of cmps){
    if (A === B) continue;                                   // two-compound rule
    for (let k=1; k<=L-1; k++){
      const t = strategyTime([[A,k],[B,L-k]], byCmp, pitLoss);
      if (!best || t < best.total) best = { kind:'1-stop', total:t, stops:[k], compounds:[A,B] };
    }
  }
  return best;
}
function bestTwoStop(byCmp, pitLoss, L){
  const cmps = Object.keys(byCmp); let best = null;
  for (const A of cmps) for (const B of cmps) for (const C of cmps){
    if (new Set([A,B,C]).size < 2) continue;                 // must use >=2 distinct compounds
    for (let k1=1; k1<=L-2; k1++) for (let k2=k1+1; k2<=L-1; k2++){
      const t = strategyTime([[A,k1],[B,k2-k1],[C,L-k2]], byCmp, pitLoss);
      if (!best || t < best.total) best = { kind:'2-stop', total:t, stops:[k1,k2], compounds:[A,B,C] };
    }
  }
  return best;
}
// best one- and two-stop plans from the per-compound deg model; null if <2 dry compounds have data
function optimiseStrategies(model, pitLoss, L){
  const byCmp = {};
  model.forEach(m => { if (DRY_COMPOUNDS.includes(m.compound)) byCmp[m.compound] = m; });
  if (Object.keys(byCmp).length < 2) return null;
  return { one: bestOneStop(byCmp, pitLoss, L), two: bestTwoStop(byCmp, pitLoss, L) };
}
async function renderStrategySim(qSession, attempt=0){
  const body = $('strategysimBody'); if (!body) return;
  body.innerHTML = loadingBox('Projecting one-stop vs two-stop strategies…');
  try {
    const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
    if (!practice.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No practice', 'No practice sessions for this weekend in the data, so there’s no degradation model to base strategy projections on.'); return; }
    const [deg, pit, race] = await Promise.all([ practiceDegModel(), weekendPitLoss(), raceLapCount() ]);
    const dryCount = deg.model.filter(m => DRY_COMPOUNDS.includes(m.compound)).length;
    if (dryCount < 2){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('Not enough data', 'Need a modelled degradation figure for at least two dry compounds to compare strategies — this weekend’s practice didn’t provide that.'); return; }
    if (pit.seconds == null){ body.innerHTML = stateBox('No pit loss', 'Couldn’t estimate this weekend’s pit-stop time loss from practice, so race-time projections aren’t possible.'); return; }
    if (race.laps == null){ body.innerHTML = stateBox('Unknown race length', 'Couldn’t determine the race distance for this circuit, so strategy projections aren’t possible.'); return; }

    const opt = optimiseStrategies(deg.model, pit.seconds, race.laps);
    const rows = [opt.one, opt.two].filter(Boolean).sort((a,b)=> a.total - b.total);
    const best = rows[0].total;
    const verdict = rows.length > 1
      ? `<b>${rows[0].kind}</b> projects fastest, by ${(rows[1].total - best).toFixed(1)}s over the best ${rows[1].kind}.`
      : `Only a <b>${rows[0].kind}</b> plan could be built from the available compounds.`;
    const srcNote = race.src && race.src !== 'this race' ? ` (race length from ${esc(race.src)})` : '';

    body.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>Plan</th><th>Tyres</th><th class="tar">Stop lap(s)</th><th class="tar">Δ</th></tr></thead>
      <tbody>${rows.map((r,i)=> `<tr class="${i===0?'best':''}">
        <td><b>${r.kind}</b></td>
        <td>${r.compounds.map(compoundTag).join('<span class="muted"> → </span>')}</td>
        <td class="num tar">${r.stops.join(', ')}</td>
        <td class="num tar ${i===0?'muted':''}">${i===0?'fastest':'+'+(r.total-best).toFixed(1)+'s'}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="panel-note"><b>Informational, not a prediction.</b> ${verdict} A toy what-if over <b>${race.laps} laps</b>${srcNote}: it projects total race time from this weekend’s modelled tyre degradation and a <b>${pit.seconds.toFixed(1)}s</b> pit loss, then searches stop laps for the quickest one- and two-stop plans (dry compounds only, respecting the two-compound rule). It ignores safety cars, traffic, tyre warm-up, fuel saving, track temperature and weather — all of which routinely decide real strategy — and assumes practice pace carries to Sunday. Compound base paces come from practice runs at unknown fuel, so cross-compound gaps are rough. Read it as a sanity check on stop count, not a strategy call.</div>`;
  } catch (e){ panelRetry('strategy sim', e, body, attempt, () => renderStrategySim(qSession, attempt+1), stateBox('Unavailable', 'Couldn’t project strategies.', 'error')); }
}

/* ---------- PRE-RACE: undercut / overcut calculator ---------- */
const OUTLAP_PENALTY_S = 1.2;   // assumed pace lost warming a fresh tyre on the out-lap (cold tyres + pit exit), s
// Per-compound undercut economics from the deg model. The undercut gains, per lap, the gap between a
// rival's worn-tyre pace (≈ deg × their tyre age) and your fresh-but-cold out-lap (the out-lap penalty);
// the overcut is the mirror, favoured while the rival's tyres are younger than the break-even age.
function undercutModel(model){
  return model.filter(m => DRY_COMPOUNDS.includes(m.compound))
    .map(m => ({
      compound: m.compound,
      deg: m.degRate,
      breakeven: m.degRate > 0 ? OUTLAP_PENALTY_S / m.degRate : null,   // rival tyre age (laps) where the undercut turns net-positive
      swing15: m.degRate * 15 - OUTLAP_PENALTY_S,                       // net seconds gained vs a rival 15 laps into a stint
    }))
    .sort((a,b)=> (a.breakeven==null) - (b.breakeven==null) || (a.breakeven - b.breakeven));  // most undercut-friendly first
}
async function renderUndercut(qSession, attempt=0){
  const body = $('undercutBody'); if (!body) return;
  body.innerHTML = loadingBox('Working out undercut vs overcut economics…');
  try {
    const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
    if (!practice.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No practice', 'No practice sessions for this weekend in the data, so there’s no degradation model to work undercut economics from.'); return; }
    const { model } = await practiceDegModel();
    const rows = undercutModel(model);
    if (!rows.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No long runs', 'No dry-compound degradation could be modelled from this weekend’s practice long runs, so undercut economics aren’t available.'); return; }

    body.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>Tyre</th><th class="tar">Deg</th><th class="tar">Undercut from</th><th class="tar">Swing @15 laps</th></tr></thead>
      <tbody>${rows.map((r,i)=> `<tr class="${i===0?'best':''}" style="--team:${compoundColour(r.compound)}">
        <td>${compoundTag(r.compound)}</td>
        <td class="num tar"><b>${fmtDeg(r.deg)}</b><span class="muted"> s/lap</span></td>
        <td class="num tar">${r.breakeven!=null ? '~'+Math.round(r.breakeven)+'-lap tyre' : '—'}</td>
        <td class="num tar ${r.swing15>=0?'':'muted'}">${r.swing15>=0?'+':'−'}${Math.abs(r.swing15).toFixed(2)}s</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="panel-note"><b>Informational, not a prediction.</b> The <b>undercut</b> — pitting before a rival — gains, each lap, the gap between their worn-tyre pace (about deg × their tyre age) and the pace you give up warming a fresh tyre on the out-lap (assumed ${OUTLAP_PENALTY_S.toFixed(1)}s). <b>Undercut from</b> is the rival tyre age past which it nets time; while their tyres are younger than that, the <b>overcut</b> (staying out as they warm cold tyres) is the better play. <b>Swing @15 laps</b> is the net gain against a rival 15 laps into a stint. A single-lap toy off practice deg: it ignores that a real undercut also banks the rival’s slow in-lap, plus traffic, dirty air and tyre temperature — read it as which compounds make the undercut bite, not a stopwatch.</div>`;
  } catch (e){ panelRetry('undercut', e, body, attempt, () => renderUndercut(qSession, attempt+1), stateBox('Unavailable', 'Couldn’t work out undercut economics. Tap Reload to retry.', 'error')); }
}

/* ---------- PRE-RACE: safety-car what-if ---------- */
const SC_PIT_FACTOR = 0.5;   // a stop made under the safety car costs about half the green-flag time loss
const SC_WINDOW = 3;         // laps either side of the SC lap that can still catch the cheap stop
function dryByCompound(model){
  const b = {}; model.forEach(m => { if (DRY_COMPOUNDS.includes(m.compound)) b[m.compound] = m; }); return b;
}
// pit-stop time cost at a given lap: discounted if the stop falls within the safety-car window
function scPitCost(pitLoss, scLap, lap){
  return (scLap != null && Math.abs(lap - scLap) <= SC_WINDOW) ? pitLoss * SC_PIT_FACTOR : pitLoss;
}
// total race time for a plan, charging each stop the (possibly SC-discounted) pit cost for its lap
function planTime(stints, byCmp, stops, pitLoss, scLap){
  let t = 0;
  for (const [c, Ls] of stints) t += Ls * byCmp[c].basePace + byCmp[c].degRate * (Ls * (Ls - 1) / 2);
  for (const k of stops) t += scPitCost(pitLoss, scLap, k);
  return t;
}
// best one-/two-stop plan when a safety car at scLap (null = green flag) makes a nearby stop cheaper
function optimiseStrategiesSC(model, pitLoss, L, scLap){
  const byCmp = dryByCompound(model);
  const cmps = Object.keys(byCmp);
  if (cmps.length < 2) return null;
  let best = null;
  const consider = (kind, compounds, stops, stints) => {
    const t = planTime(stints, byCmp, stops, pitLoss, scLap);
    if (!best || t < best.total) best = { kind, total: t, stops, compounds, stints };
  };
  for (const A of cmps) for (const B of cmps){
    if (A === B) continue;
    for (let k=1; k<=L-1; k++) consider('1-stop', [A,B], [k], [[A,k],[B,L-k]]);
  }
  for (const A of cmps) for (const B of cmps) for (const C of cmps){
    if (new Set([A,B,C]).size < 2) continue;
    for (let k1=1; k1<=L-2; k1++) for (let k2=k1+1; k2<=L-1; k2++) consider('2-stop', [A,B,C], [k1,k2], [[A,k1],[B,k2-k1],[C,L-k2]]);
  }
  return best;
}
async function renderSCWhatif(qSession, attempt=0){
  const body = $('scwhatifBody'); if (!body) return;
  body.innerHTML = loadingBox('Working out safety-car strategy swings…');
  try {
    const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
    if (!practice.length){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('No practice', 'No practice sessions for this weekend in the data, so there’s no degradation model to base a safety-car what-if on.'); return; }
    const [deg, pit, race] = await Promise.all([ practiceDegModel(), weekendPitLoss(), raceLapCount() ]);
    const dryCount = deg.model.filter(m => DRY_COMPOUNDS.includes(m.compound)).length;
    if (dryCount < 2){ body.innerHTML = isSprintWeekend() ? sprintWeekendBox() : stateBox('Not enough data', 'Need a modelled degradation figure for at least two dry compounds to project safety-car strategy — this weekend’s practice didn’t provide that.'); return; }
    if (pit.seconds == null){ body.innerHTML = stateBox('No pit loss', 'Couldn’t estimate this weekend’s pit-stop time loss from practice, so a safety-car what-if isn’t possible.'); return; }
    if (race.laps == null){ body.innerHTML = stateBox('Unknown race length', 'Couldn’t determine the race distance for this circuit, so a safety-car what-if isn’t possible.'); return; }

    const L = race.laps, byCmp = dryByCompound(deg.model);
    const baseline = optimiseStrategiesSC(deg.model, pit.seconds, L, null);   // green-flag optimum
    const init = Math.max(1, Math.min(L-1, Math.round(L * 0.4)));
    body.innerHTML = `<div class="sc-controls">
        <label for="scLap">Safety car around lap <b id="scLapVal">${init}</b> of ${L}</label>
        <input type="range" id="scLap" min="1" max="${L-1}" value="${init}" step="1">
      </div>
      <div id="scOut" class="sc-out"></div>
      <div class="panel-note"><b>Informational, not a prediction.</b> Drag the lap to drop a safety car into the race. Under it the field circulates slowly, so a pit stop costs about <b>half</b> its green-flag time loss (here ~${(pit.seconds*SC_PIT_FACTOR).toFixed(1)}s vs ${pit.seconds.toFixed(1)}s) — often turning a near-free stop. The figure is how much re-optimising around the safety car beats sticking to the green-flag plan (<b>${baseline.kind}</b>, stopping on lap ${baseline.stops.join(', ')}). A toy built on practice degradation: it ignores where you actually are on track when the SC appears, the pack shuffle, lap-down cars and the luck of the timing — read it as how much a safety car can reshape the call, not a guaranteed gain.</div>`;
    const slider = body.querySelector('#scLap'), out = body.querySelector('#scOut'), lapVal = body.querySelector('#scLapVal');
    const renderOut = (lap) => {
      const reaction = optimiseStrategiesSC(deg.model, pit.seconds, L, lap);
      const ignoreTotal = planTime(baseline.stints, byCmp, baseline.stops, pit.seconds, lap);
      const saving = ignoreTotal - reaction.total;
      const react = saving < 0.1
        ? `your planned stop already lines up — no real gain from reacting.`
        : `best response is a <b>${reaction.kind}</b>, stopping on lap ${reaction.stops.join(', ')} — about <b>${saving.toFixed(1)}s</b> better than sticking to the green-flag plan.`;
      out.innerHTML = `Safety car around lap <b>${lap}</b>: ${react}`;
    };
    if (slider){ slider.addEventListener('input', () => { const v = +slider.value; lapVal.textContent = v; renderOut(v); }); }
    renderOut(init);
  } catch (e){ panelRetry('sc what-if', e, body, attempt, () => renderSCWhatif(qSession, attempt+1), stateBox('Unavailable', 'Couldn’t run the safety-car what-if. Tap Reload to retry.', 'error')); }
}

/* ---------- QUALIFYING / RACE: car performance (acceleration, top speed, cornering, strength) ---------- */
const CARPERF_AXES = [
  { key:'accel',        label:'Acceleration' },
  { key:'topSpeed',     label:'Top Speed' },
  { key:'cornerSlow',   label:'Slow Corners' },
  { key:'cornerMedium', label:'Medium Corners' },
  { key:'cornerFast',   label:'Fast Corners' },
];

async function renderCarPerformance(session_key, kind, session, attempt=0){
  const body = $('carperfBody'); if (!body) return;
  body.innerHTML = loadingBox('Pulling car telemetry…');
  try {
    const laps = await fetchLaps(session_key);
    const groups = groupByDriver(laps);
    const drivers = Object.keys(groups).map(Number);
    if (!drivers.length){ body.innerHTML = stateBox('No data', 'No lap times recorded for this session.'); return; }

    // representative lap per driver: fastest clean lap of this session
    const repLaps = {};
    drivers.forEach(n => { const r = fastestCleanLapRow(groups[n]); if (r) repLaps[n] = r; });

    // pull one lap's telemetry per driver — small, date-bounded car_data requests, throttled
    // so OpenF1 doesn't rate-limit a 20-way burst
    const traits = {};
    await mapLimit(drivers, 4, async n => {
      const lap = repLaps[n]; if (!lap) return;
      const start = new Date(lap.date_start);
      const end = new Date(start.getTime() + Math.round(num(lap.lap_duration)*1000) + 1000);
      try {
        const samples = await fetchCarData(session_key, n, start.toISOString(), end.toISOString());
        const t = analyseLapTelemetry(samples);
        if (t) traits[n] = t;
      } catch (e){ logError('car_data '+n, e); }
    });

    if (!Object.keys(traits).length){
      body.innerHTML = stateBox('No telemetry', 'OpenF1 doesn’t have car telemetry for this session, so car-performance traits can’t be computed.');
      return;
    }

    // strength: qualifying = best lap vs pole; race = best race-sim stint (long-run median)
    let strengthLabel, strengthRaw;
    if (kind === 'race'){
      strengthLabel = 'Race Strength';
      const stints = await fetchStints(session_key).catch(()=>[]);
      const pace = longRunPace(laps, stints);
      strengthRaw = drivers.map(n => ({ n, v: pace[n]?.best?.median ?? null }));
    } else {
      strengthLabel = 'Qualifying Strength';
      strengthRaw = drivers.map(n => ({ n, v: bestLap(groups[n]) }));
    }

    // cache this weekend's quali-trim traits so the race view can offer them too
    const mk = session?.meeting_key;
    if (kind === 'qualifying' && mk != null){
      try { sessionStorage.setItem(`pwa.meeting.${mk}.qualiCarPerf`, JSON.stringify({ traits, strengthRaw })); } catch {}
    }
    let qualiTrim = null;
    if (kind === 'race' && mk != null){
      try { const c = sessionStorage.getItem(`pwa.meeting.${mk}.qualiCarPerf`); if (c) qualiTrim = JSON.parse(c); } catch {}
    }

    paintCarPerf(body, { kind, drivers, traits, strengthRaw, strengthLabel, qualiTrim });
  } catch (e){ panelRetry('car performance', e, body, attempt, () => renderCarPerformance(session_key, kind, session, attempt+1), stateBox('Unavailable', 'Couldn’t load car telemetry.', 'error')); }
}

// build one entity (driver or team) per row, with raw axis values + raw strength
function buildCarPerfEntities(drivers, traits, strengthRaw, mode){
  if (mode === 'team'){
    const groups = {};
    drivers.forEach(n => { const t = drv(n).team || 'Unknown'; (groups[t]=groups[t]||[]).push(n); });
    return Object.keys(groups).map(team => {
      const ns = groups[team];
      const axesRaw = {};
      CARPERF_AXES.forEach(ax => {
        const vals = ns.map(n => traits[n]?.[ax.key]).filter(v=>v!=null);
        axesRaw[ax.key] = vals.length ? avg(vals) : null;
      });
      const sVals = ns.map(n => strengthRaw.find(r=>r.n===n)?.v).filter(v=>v!=null);
      return { key: team, label: team || 'Unknown', colour: teamColour(team) || drvColour(ns[0]), axesRaw, rawStrength: sVals.length ? avg(sVals) : null };
    });
  }
  return drivers.map(n => ({
    key: String(n), label: drv(n).acr, colour: drvColour(n),
    axesRaw: CARPERF_AXES.reduce((o,ax)=> (o[ax.key]=traits[n]?.[ax.key] ?? null, o), {}),
    rawStrength: strengthRaw.find(r=>r.n===n)?.v ?? null,
  }));
}
// scale each axis + strength to 0-100 across the entities (field-relative)
function normalizeCarPerfEntities(entities){
  CARPERF_AXES.forEach(ax => {
    const scores = percentileScore(entities.map(e=>({ n:e.key, v:e.axesRaw[ax.key] })), false);
    entities.forEach(e => { e.axisScore = e.axisScore || {}; e.axisScore[ax.key] = scores[e.key]; });
  });
  const sScores = percentileScore(entities.map(e=>({ n:e.key, v:e.rawStrength })), true);
  entities.forEach(e => e.strengthScore = sScores[e.key]);
  return entities;
}

function paintCarPerf(body, ctx){
  state.carPerfCtx = ctx;
  const trimAvailable = ctx.kind === 'race' && !!ctx.qualiTrim;
  body.innerHTML = `
    <div class="panel-toolbar" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div class="seg" id="carperf-mode">
        <button type="button" data-mode="driver" class="${state.carPerf.mode==='driver'?'active':''}">Driver</button>
        <button type="button" data-mode="team" class="${state.carPerf.mode==='team'?'active':''}">Team</button>
      </div>
      ${trimAvailable ? `<div class="seg" id="carperf-trim">
        <button type="button" data-trim="race" class="${state.carPerf.trim!=='quali'?'active':''}">Race trim</button>
        <button type="button" data-trim="quali" class="${state.carPerf.trim==='quali'?'active':''}">Quali trim</button>
      </div>` : ''}
      <div class="seg" id="carperf-topn">
        ${CARPERF_TOPN.map(n => `<button type="button" data-topn="${n}" class="${state.carPerf.topN===n?'active':''}">${n===0?'All':'Top '+n}</button>`).join('')}
      </div>
    </div>
    <div class="chart-box" id="carperfRadarHost"><canvas id="carperfRadarCanvas"></canvas></div>
    <div id="carperfStrengthView"></div>
    <div class="panel-note">Acceleration, top speed and cornering speeds come from each car's fastest clean lap telemetry, with corners bucketed by exit speed (under ${CORNER_SLOW_MAX} km/h = slow, ${CORNER_SLOW_MAX}–${CORNER_FAST_MIN} = medium, over ${CORNER_FAST_MIN} = fast) and scaled 0–100 against this field — a relative read for this weekend, not an absolute or cross-circuit number. ${ctx.kind==='race' ? 'Race Strength ranks each car’s best race-sim stint (median green-flag lap).' : 'Qualifying Strength ranks each car’s best lap against pole.'}</div>
  `;
  const seg1 = $('carperf-mode');
  seg1.addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    const m = b.dataset.mode; if (state.carPerf.mode===m) return;
    state.carPerf.mode = m;
    seg1.querySelectorAll('button').forEach(x=>x.classList.toggle('active', x.dataset.mode===m));
    drawCarPerf();
  });
  const seg2 = $('carperf-trim');
  if (seg2) seg2.addEventListener('click', e => {
    const b = e.target.closest('button[data-trim]'); if (!b) return;
    const t = b.dataset.trim; if ((state.carPerf.trim||'race')===t) return;
    state.carPerf.trim = t;
    seg2.querySelectorAll('button').forEach(x=>x.classList.toggle('active', x.dataset.trim===t));
    drawCarPerf();
  });
  const seg3 = $('carperf-topn');
  seg3.addEventListener('click', e => {
    const b = e.target.closest('button[data-topn]'); if (!b) return;
    const n = Number(b.dataset.topn); if (state.carPerf.topN===n) return;
    state.carPerf.topN = n;
    seg3.querySelectorAll('button').forEach(x=>x.classList.toggle('active', Number(x.dataset.topn)===n));
    drawCarPerf();
  });
  drawCarPerf();
}

function drawCarPerf(){
  const ctx = state.carPerfCtx; if (!ctx) return;
  const { kind, drivers, traits, strengthRaw, strengthLabel, qualiTrim } = ctx;
  const useQualiTrim = kind === 'race' && state.carPerf.trim === 'quali' && qualiTrim;
  const traitsSrc = useQualiTrim ? qualiTrim.traits : traits;

  let entities = buildCarPerfEntities(drivers, traitsSrc, strengthRaw, state.carPerf.mode);
  entities = entities.filter(e => CARPERF_AXES.some(ax => e.axesRaw[ax.key]!=null));
  normalizeCarPerfEntities(entities);
  entities.sort((a,b)=> (b.strengthScore ?? -1) - (a.strengthScore ?? -1));

  const topN = state.carPerf.topN;
  const shown = topN>0 ? entities.slice(0, topN) : entities;

  drawCarRadar(shown);
  drawCarStrength(shown, strengthLabel);
}

function drawCarRadar(entities){
  const host = $('carperfRadarHost'); if (!host) return;
  if (!entities.length){ destroyChart('carperf'); host.innerHTML = stateBox('No data', 'Not enough telemetry to plot car traits for these drivers.'); return; }
  host.innerHTML = '<canvas id="carperfRadarCanvas"></canvas>';
  destroyChart('carperf');
  if (!window.Chart) return;
  const ctx = $('carperfRadarCanvas'); if (!ctx) return;
  state.charts.carperf = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: CARPERF_AXES.map(ax => ax.label),
      datasets: entities.map(e => ({
        label: e.label,
        data: CARPERF_AXES.map(ax => e.axisScore[ax.key]),
        borderColor: e.colour, backgroundColor: e.colour + '33', borderWidth: 1.5,
        pointBackgroundColor: e.colour, pointRadius: 2, spanGaps: true,
      })),
    },
    options: Object.assign(chartBase({}), {
      plugins: {
        legend: { display:true, position:'top', labels:{ usePointStyle:true, boxWidth:8, boxHeight:8, color:'#5C554A', font:{family:"'IBM Plex Mono',monospace", size:10}, padding:8 } },
        tooltip: { backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ label:(it)=> `${it.dataset.label} — ${it.label}: ${Math.round(it.formattedValue)}` } },
      },
      scales: {
        r: { min:0, max:100, ticks:{ display:false, stepSize:25 }, grid:{ color:'#C9C0AE' }, angleLines:{ color:'#C9C0AE' },
          pointLabels:{ color:'#5C554A', font:{family:"'Plus Jakarta Sans',sans-serif",size:11,weight:600} } },
      }
    })
  });
}

function drawCarStrength(entities, label){
  const view = $('carperfStrengthView'); if (!view) return;
  const ranked = entities.filter(e=>e.strengthScore!=null);
  if (!ranked.length){ destroyChart('carstrength'); view.innerHTML = stateBox('No data', `Not enough data to rank ${label.toLowerCase()}.`); return; }
  const h = Math.max(220, ranked.length * 24 + 56);
  view.innerHTML = `<div class="chart-box" style="height:${h}px"><canvas id="carstrengthCanvas"></canvas></div>`;
  destroyChart('carstrength');
  if (!window.Chart) return;
  const c = $('carstrengthCanvas'); if (!c) return;
  state.charts.carstrength = new Chart(c, {
    type: 'bar',
    data:{ labels: ranked.map(e=>e.label),
      datasets:[{ data: ranked.map(e=>e.strengthScore), backgroundColor: ranked.map(e=>e.colour), borderColor: ranked.map(e=>e.colour), borderWidth:1, borderRadius:2, barPercentage:0.84, categoryPercentage:0.84 }] },
    options: Object.assign(chartBase({}), {
      indexAxis:'y',
      plugins:{
        legend:{ display:false },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ label:(it)=> `${label}: ${Math.round(it.parsed.x)}` } },
      },
      scales:{
        x:{ min:0, max:100, grid:{ color:'#C9C0AE' }, ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10} }, title:{ display:true, text:label+' (0–100, field-relative)', color:'#8C8475', font:{size:10} } },
        y:{ grid:{ color:'transparent' }, ticks:{ color:'#5C554A', font:{family:"'IBM Plex Mono',monospace",size:11} } },
      }
    })
  });
}

/* ---------- PRACTICE-DERIVED: weekend pit-loss estimate ---------- */
/* The full time a stop costs — pit-lane transit plus the stationary change —
   measured from every clean practice in/out-lap pair against that driver's
   green-lap pace, then taken as a median across the weekend (implausible pairs
   trimmed). Memoised per meeting and stashed on state for later use (e.g.
   estimating track position after a race stop). */
async function weekendPitLoss(){
  const mk = state.session?.meeting_key ?? null;
  if (state.pitLoss && state.pitLoss.meeting === mk) return state.pitLoss;   // one estimate per weekend
  const practice = state.sessions.filter(s => sessionKind(s) === 'practice');
  const deltas = [];
  for (const s of practice){
    let laps, pits;
    try { [laps, pits] = await Promise.all([ fetchLaps(s.session_key), fetchPit(s.session_key) ]); }
    catch (e){ logError('pitloss fetch', e); continue; }
    const groups = groupByDriver(laps);
    const stopsByDrv = groupByDriver(pits);
    for (const n of Object.keys(groups).map(Number)){
      const ls = groups[n];
      const byLap = {}; ls.forEach(l => { const ln = num(l.lap_number); if (ln!=null) byLap[ln] = l; });
      // green baseline: this driver's clean laps (exclude out-laps), median
      const base = median(ls.filter(l => !l.is_pit_out_lap && num(l.lap_duration)>0).map(l => num(l.lap_duration)));
      if (base == null) continue;
      for (const p of (stopsByDrv[n] || [])){
        const L = num(p.lap_number); if (L == null) continue;
        // pit lap_number is usually the in-lap; sometimes it's tagged on the out-lap
        let inLap, outLap;
        if (byLap[L] && byLap[L].is_pit_out_lap){ outLap = byLap[L]; inLap = byLap[L-1]; }
        else { inLap = byLap[L]; outLap = byLap[L+1]; }
        if (!inLap || !outLap || !outLap.is_pit_out_lap) continue;
        const di = num(inLap.lap_duration), doo = num(outLap.lap_duration);
        if (di==null || doo==null || di<=0 || doo<=0) continue;
        const loss = (di + doo) - 2 * base;            // total time lost vs two green laps
        if (loss > 8 && loss < 60) deltas.push(loss);  // trim garage stops / cold out-laps / bad timing
      }
    }
  }
  state.pitLoss = { meeting: mk, seconds: median(deltas), samples: deltas.length };
  return state.pitLoss;
}

async function renderPitLoss(attempt=0){
  const body = $('pitlossBody'); if (!body) return;
  body.innerHTML = loadingBox('Estimating the weekend pit loss…');
  try {
    const r = await weekendPitLoss();
    if (r.seconds == null){
      body.innerHTML = stateBox('No estimate', 'Not enough clean practice in/out-lap pairs to estimate pit loss for this weekend.');
      return;
    }
    body.innerHTML = `<div class="pitloss">
      <div class="pl-figure"><span class="pl-value">${r.seconds.toFixed(1)}<span class="pl-unit">s</span></span><span class="pl-label">estimated pit loss</span></div>
      <div class="panel-note" style="border-top:none;padding:0">The full time a stop costs — pit-lane transit plus the stationary tyre change — taken as the median of ${r.samples} clean practice in/out-lap pair${r.samples===1?'':'s'} measured against each driver's green-lap pace. A single weekend-level figure for gauging where a car rejoins after a race stop, not a per-team number; practice stops are noisy, so treat it as a guide.</div>
    </div>`;
  } catch (e){ panelRetry('pitloss', e, body, attempt, () => renderPitLoss(attempt+1), stateBox('Unavailable', 'Couldn’t estimate pit loss.', 'error')); }
}

/* ---------- RACE: lap chart ---------- */
/* ---------- RACE: shared helpers (SC/VSC shading + Top-N filter) ---------- */
// Parse OpenF1 race_control into Safety Car / Virtual Safety Car periods.
function parseSafety(rc){
  const msgs = (Array.isArray(rc)?rc:[]).filter(r => r.date).slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
  const periods = []; let open = null;
  const close = (m) => { if (open){ open.endDate = m.date; open.endLap = num(m.lap_number); periods.push(open); open = null; } };
  for (const m of msgs){
    const text = (m.message||'').toUpperCase(), flag = (m.flag||'').toUpperCase();
    const vsc = text.includes('VIRTUAL SAFETY CAR'), sc = text.includes('SAFETY CAR') && !vsc;
    if ((vsc || sc) && text.includes('DEPLOY')){
      if (open) close(m);                                   // a new deploy supersedes any open period
      open = { kind: vsc ? 'VSC' : 'SC', startDate: m.date, startLap: num(m.lap_number) };
    } else if (vsc && open && open.kind === 'VSC' && text.includes('END')){
      close(m);                                             // "VIRTUAL SAFETY CAR ENDING"
    } else if (flag === 'GREEN' && (m.scope||'').toUpperCase() !== 'SECTOR' && open){
      close(m);                                             // track-wide green ends a safety car (ignore local sector greens)
    }
  }
  if (open) periods.push(open);                             // unterminated — keep what we have
  return periods;
}
const safetyByLap  = (periods) => periods.filter(p => p.startLap!=null).map(p => ({ x0: p.startLap, x1: p.endLap ?? p.startLap, kind: p.kind }));
const safetyByTime = (periods, t0) => periods.filter(p => p.startDate).map(p => ({
  x0: (new Date(p.startDate).getTime() - t0) / 60000,
  x1: ((p.endDate ? new Date(p.endDate) : new Date(p.startDate)).getTime() - t0) / 60000,
  kind: p.kind,
}));

// Chart.js inline plugin: shade SC/VSC bands behind the data (reads options.plugins.scShade.periods).
const scShadePlugin = {
  id: 'scShade',
  beforeDatasetsDraw(chart, _args, opts){
    const periods = opts && opts.periods; if (!periods || !periods.length) return;
    const x = chart.scales.x, area = chart.chartArea, ctx = chart.ctx; if (!x) return;
    ctx.save();
    for (const p of periods){
      if (p.x0 == null) continue;
      const a = x.getPixelForValue(p.x0), b = x.getPixelForValue(p.x1!=null ? p.x1 : p.x0);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const left = Math.max(area.left, Math.min(a, b));
      let right = Math.min(area.right, Math.max(a, b));
      if (right - left < 2) right = Math.min(area.right, left + 2);   // keep a one-lap band visible
      ctx.fillStyle = p.kind === 'VSC' ? 'rgba(242,193,78,0.16)' : 'rgba(242,193,78,0.30)';
      ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
      if (right - left > 24){
        ctx.fillStyle = 'rgba(120,86,0,0.85)';
        ctx.font = "600 9px 'IBM Plex Mono', ui-monospace, monospace";
        ctx.textBaseline = 'top';
        ctx.fillText(p.kind, left + 3, area.top + 3);
      }
    }
    ctx.restore();
  }
};

// Chart.js inline plugin: draw a bold baseline at value 0 on the given axis.
// (Replaces a scriptable grid colour using context.tick.value, which threw on
//  the deployed Chart.js build when the grid context had no tick.)
const baselinePlugin = {
  id: 'baseline',
  beforeDatasetsDraw(chart, _args, opts){
    if (!opts || !opts.axis) return;
    const scale = chart.scales[opts.axis]; if (!scale) return;
    const area = chart.chartArea, ctx = chart.ctx, p = scale.getPixelForValue(0);
    if (!Number.isFinite(p)) return;
    ctx.save();
    ctx.strokeStyle = opts.color || '#211D17'; ctx.lineWidth = opts.width || 1.5;
    ctx.beginPath();
    if (opts.axis === 'y'){ if (p >= area.top && p <= area.bottom){ ctx.moveTo(area.left, p); ctx.lineTo(area.right, p); } }
    else { if (p >= area.left && p <= area.right){ ctx.moveTo(p, area.top); ctx.lineTo(p, area.bottom); } }
    ctx.stroke(); ctx.restore();
  }
};

// Top-N driver filter shared across the three race charts.
const TOPN = [ { n:3, label:'Top 3' }, { n:6, label:'Top 6' }, { n:8, label:'Top 8' }, { n:0, label:'All' } ];
function topToolbar(){
  return `<div class="seg topn">${TOPN.map(o => `<button type="button" data-n="${o.n}" class="${state.raceTopN===o.n?'active':''}">${esc(o.label)}</button>`).join('')}</div>`;
}
function wireTopN(seg){
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]'); if (!b) return;
    const n = Number(b.dataset.n); if (state.raceTopN === n) return;
    state.raceTopN = n;
    document.querySelectorAll('.seg.topn button').forEach(x => x.classList.toggle('active', Number(x.dataset.n) === n));
    redrawRaceCharts();
  });
}
const topNSet = (order, n) => n > 0 ? new Set(order.slice(0, n)) : null;   // null = show all

// Pit-stop marker toggle, shared across the three race charts.
function pitToggle(){
  return `<div class="seg pits">${[['1','On'],['0','Off']].map(([v,l]) => `<button type="button" data-pits="${v}" class="${(state.showPits?'1':'0')===v?'active':''}">${l}</button>`).join('')}</div>`;
}
function wirePits(seg){
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pits]'); if (!b) return;
    const on = b.dataset.pits === '1'; if (state.showPits === on) return;
    state.showPits = on;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', (x.dataset.pits==='1')===on));
    redrawRaceCharts();
  });
}
// pit dot styling, shared so every race chart marks stops the same way
const PIT_DOT = { fill: '#F7F3EA', ring: '#211D17' };
function redrawRaceCharts(){
  Object.values(state.raceRedraw).forEach(fn => { try { fn && fn(); } catch (err){ logError('race redraw', err); } });
}
// finishing order from laps: most laps completed, then least cumulative time
function orderByLaps(groups){
  return Object.keys(groups).map(Number).map(n => {
    let last = 0, total = 0;
    for (const l of groups[n]){ const ln = num(l.lap_number); if (ln!=null && ln>last) last = ln; const d = num(l.lap_duration); if (d!=null && d>0) total += d; }
    return { n, last, total };
  }).sort((a,b)=> (b.last - a.last) || (a.total - b.total)).map(o => o.n);
}

async function renderLapChart(session_key, attempt=0){
  const body = $('lapchartBody'); body.innerHTML = loadingBox('Plotting lap times…');
  try {
    const [laps, pit, rc] = await Promise.all([ fetchLaps(session_key), fetchPit(session_key).catch(()=>[]), fetchRC(session_key).catch(()=>[]) ]);
    const groups = groupByDriver(laps);
    const drivers = Object.keys(groups).map(Number);
    if (!drivers.length){ body.innerHTML = stateBox('No data', 'No lap times recorded for this session.'); return; }
    // pit-in laps: {driverNumber-lapNumber}
    const pitSet = new Set((Array.isArray(pit)?pit:[]).map(p => `${num(p.driver_number)}-${num(p.lap_number)}`));
    const order = orderByLaps(groups);
    const bands = safetyByLap(parseSafety(rc));

    const all = laps.map(l => num(l.lap_duration)).filter(v => v!=null && v>0);
    const med = median(all) || 90;
    const yMin = Math.max(0, (Math.min(...all)||med) - 0.8);
    const yMax = med * 1.25;            // shows green-flag pace + most pit laps, clips SC/red-flag spikes

    body.innerHTML = `<div class="chart-box" id="lapHost"><canvas id="lapCanvas"></canvas></div>
      <div class="panel-note">Lap time per lap, per driver — pace trends, traffic and the undercut/overcut all show here. Ringed points are pit in-laps and out-laps (toggle with <b>Pit stops</b>). <b>Yellow bands</b> mark Safety Car (darker) and Virtual Safety Car (lighter) periods. Use the legend or the Top buttons to isolate drivers; very slow laps (safety car, red flags) sit above the visible range to keep the racing pace readable.</div>`;

    const isPit = (n, l) => (l.is_pit_out_lap || pitSet.has(`${n}-${num(l.lap_number)}`));
    const redraw = () => {
      const host = $('lapHost'); if (!host) return;
      host.innerHTML = '<canvas id="lapCanvas"></canvas>';
      const set = topNSet(order, state.raceTopN);
      const showP = state.showPits;
      const datasets = drivers.filter(n => !set || set.has(n)).sort((a,b)=> a-b).map(n => {
        const ls = groups[n].slice().filter(l => num(l.lap_number)!=null).sort((a,b)=> a.lap_number-b.lap_number);
        const colour = drvColour(n);
        const mark = (l) => showP && isPit(n,l);
        return {
          label: drv(n).acr, data: ls.map(l => ({ x: num(l.lap_number), y: num(l.lap_duration) })),
          borderColor: colour, backgroundColor: colour, borderWidth: 1.5, tension: 0.25, spanGaps: true,
          pointRadius: ls.map(l => mark(l)?4:0), pointHoverRadius: 5,
          pointBorderColor: ls.map(l => mark(l)?PIT_DOT.ring:colour), pointBorderWidth: 1.5,
          pointBackgroundColor: ls.map(l => mark(l)?PIT_DOT.fill:colour),
        };
      });
      drawLapChart(datasets, yMin, yMax, bands);
    };
    state.raceRedraw.lap = redraw;
    redraw();
  } catch (e){ panelRetry('lap chart', e, body, attempt, () => renderLapChart(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load lap data.', 'error')); }
}

/* ---------- RACE: race-history trace (gap to a reference car) ---------- */
async function renderHistory(session_key, attempt=0){
  const body = $('historyBody'); body.innerHTML = loadingBox('Building the race-history trace…');
  try {
    const [laps, pit, rc] = await Promise.all([ fetchLaps(session_key), fetchPit(session_key).catch(()=>[]), fetchRC(session_key).catch(()=>[]) ]);
    const groups = groupByDriver(laps);
    const drivers = Object.keys(groups).map(Number);
    if (!drivers.length){ body.innerHTML = stateBox('No data', 'No lap times recorded for this session.'); return; }
    // per-driver cumulative race time, keyed by lap number; missing laps filled with that driver's median
    const cum = {}, lastLap = {};
    drivers.forEach(n => {
      const ls = groups[n].slice().filter(l => num(l.lap_number)!=null).sort((a,b)=> a.lap_number-b.lap_number);
      const med = median(ls.map(l => num(l.lap_duration)).filter(v => v!=null && v>0));
      const map = new Map(); let total = 0, last = 0;
      ls.forEach(l => {
        let d = num(l.lap_duration); if (d==null || d<=0) d = med;
        if (d==null) return;
        total += d; map.set(num(l.lap_number), total); last = num(l.lap_number);
      });
      cum[n] = map; lastLap[n] = last;
    });
    // reference defaults to the winner: most laps completed, then least cumulative time
    const ranked = drivers.filter(n => lastLap[n] > 0).sort((a,b)=> {
      if (lastLap[b] !== lastLap[a]) return lastLap[b] - lastLap[a];
      return (cum[a].get(lastLap[a]) ?? Infinity) - (cum[b].get(lastLap[b]) ?? Infinity);
    });
    if (!ranked.length){ body.innerHTML = stateBox('No data', 'Not enough lap timing to build the trace.'); return; }
    // pit in-laps per driver, to dot the trace where each car stopped
    const pitLaps = {};
    (Array.isArray(pit)?pit:[]).forEach(p => { const n = num(p.driver_number), l = num(p.lap_number); if (n==null || l==null) return; (pitLaps[n] = pitLaps[n] || new Set()).add(l); });
    state.history = { cum, lastLap, drivers: ranked, bands: safetyByLap(parseSafety(rc)), ref: ranked[0], pitLaps };

    const opts = ranked.map(n => `<option value="${n}">${esc(drv(n).acr)} — ${esc(drv(n).name)}</option>`).join('');
    body.innerHTML = `<div class="panel-toolbar" style="justify-content:flex-end"><label class="hist-ref">Reference <select id="histRef" class="sel sel-ref">${opts}</select></label></div>
      <div class="chart-box" id="histHost"><canvas id="histCanvas"></canvas></div>
      <div class="panel-note">Each car’s running gap to the reference driver (default: the winner), lap by lap. The bold zero line is the reference’s own race — a trace <span class="gain">above</span> it was ahead of the reference at that lap, <span class="loss">below</span> was behind. <b>Yellow bands</b> mark Safety Car / Virtual Safety Car periods. Dots mark each car's pit in-laps (toggle with <b>Pit stops</b>). Overtakes, undercuts, safety-car bunching and a backmarker being lapped all read straight off the shape. Laps with missing timing are estimated from that driver’s median, so treat sharp one-lap kinks with care.</div>`;
    $('histRef').addEventListener('change', () => { state.history.ref = Number($('histRef').value); drawHistory(); });
    state.raceRedraw.hist = drawHistory;
    drawHistory();
  } catch (e){ panelRetry('history', e, body, attempt, () => renderHistory(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load lap data for the race-history trace.', 'error')); }
}
function drawHistory(){
  const H = state.history; if (!H) return;
  const refN = H.ref, refCum = H.cum[refN], refLast = H.lastLap[refN];
  if (!refCum || !refLast) return;
  const host = $('histHost'); if (host) host.innerHTML = '<canvas id="histCanvas"></canvas>';
  const set = topNSet(H.drivers, state.raceTopN);
  const datasets = H.drivers.filter(n => !set || set.has(n) || n===refN).map(n => {
    const map = H.cum[n], pts = [];
    for (let lap = 1; lap <= refLast; lap++){
      const rc = refCum.get(lap), dc = map.get(lap);
      if (rc==null || dc==null) continue;
      pts.push({ x: lap, y: rc - dc });           // ahead of the reference => positive => above the line
    }
    const colour = drvColour(n);
    const pits = (state.showPits && H.pitLaps && H.pitLaps[n]) || null;   // dot the pit in-laps
    return { label: drv(n).acr, data: pts, borderColor: colour, backgroundColor: colour,
      borderWidth: n===refN ? 2.5 : 1.5, tension: 0.2, spanGaps: true,
      pointRadius: pts.map(p => pits && pits.has(p.x) ? 4 : 0), pointHoverRadius: 5,
      pointBackgroundColor: pts.map(p => pits && pits.has(p.x) ? PIT_DOT.fill : colour),
      pointBorderColor: pts.map(p => pits && pits.has(p.x) ? PIT_DOT.ring : colour), pointBorderWidth: 1.5 };
  });
  drawHistoryChart(datasets, H.bands);
}
function drawHistoryChart(datasets, bands){
  if (!window.Chart) return;
  destroyChart('hist');
  const ctx = $('histCanvas'); if (!ctx) return;
  const signed = (v)=> (v>0?'+':v<0?'−':'') + Math.abs(v).toFixed(0) + 's';
  state.charts.hist = new Chart(ctx, {
    type:'line',
    data:{ datasets },
    plugins:[scShadePlugin, baselinePlugin],
    options: Object.assign(chartBase({}), {
      parsing:false,
      interaction:{ mode:'nearest', intersect:false },
      plugins:{
        scShade:{ periods: bands || [] },
        baseline:{ axis:'y', color:'#211D17', width:1.5 },
        legend:{ display:true, position:'top', labels:{ usePointStyle:true, boxWidth:8, boxHeight:8, color:'#5C554A', font:{family:"'IBM Plex Mono',monospace", size:10}, padding:8 } },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ title:(it)=> 'Lap ' + (it[0]?.parsed.x ?? ''), label:(it)=> `${it.dataset.label}  ${fmtGap(it.parsed.y)}s` } },
      },
      scales:{
        x:{ type:'linear', grid:{ color:'transparent' }, ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, precision:0, maxTicksLimit:14 }, title:{ display:true, text:'Lap', color:'#8C8475', font:{size:10} } },
        y:{ grid:{ color:'#C9C0AE' },
            ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback: signed },
            title:{ display:true, text:'Ahead of reference', color:'#8C8475', font:{size:10} } },
      }
    })
  });
}
function drawLapChart(datasets, yMin, yMax, bands){
  if (!window.Chart) return;
  destroyChart('lap');
  const ctx = $('lapCanvas'); if (!ctx) return;
  state.charts.lap = new Chart(ctx, {
    type:'line',
    data:{ datasets },
    plugins:[scShadePlugin],
    options: Object.assign(chartBase({ xTitle:'Lap', yTitle:'Lap time (s)' }), {
      parsing:false,
      interaction:{ mode:'nearest', intersect:false },
      plugins:{
        scShade:{ periods: bands || [] },
        legend:{ display:true, position:'top', labels:{ usePointStyle:true, boxWidth:8, boxHeight:8, color:'#5C554A', font:{family:"'IBM Plex Mono',monospace", size:10}, padding:8 } },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ title:(it)=> 'Lap ' + (it[0]?.parsed.x ?? ''), label:(it)=> `${it.dataset.label}  ${fmtLap(it.parsed.y)}` } },
      },
      scales:{
        x:{ type:'linear', grid:{ color:'transparent' }, ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, precision:0, maxTicksLimit:14 }, title:{ display:true, text:'Lap', color:'#8C8475', font:{size:10} } },
        y:{ min:yMin, max:yMax, grid:{ color:'#C9C0AE' }, ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback:(v)=> fmtLap(v) }, title:{ display:true, text:'Lap time', color:'#8C8475', font:{size:10} } },
      }
    })
  });
}

/* ---------- RACE: tyre strategy + pit stops ---------- */
async function renderStrategy(session_key, attempt=0){
  const body = $('strategyBody'); body.innerHTML = loadingBox('Reconstructing strategies…');
  try {
    const [stints, pit, laps] = await Promise.all([ fetchStints(session_key), fetchPit(session_key).catch(()=>[]), fetchLaps(session_key).catch(()=>[]) ]);
    const list = Array.isArray(stints) ? stints : [];
    if (!list.length){ body.innerHTML = stateBox('No data', 'No tyre stint data recorded for this session.'); return; }
    const byDrv = groupByDriver(list);
    const lapGroups = groupByDriver(laps);
    const lastLapOf = (n) => { const ls = lapGroups[n]; if (!ls || !ls.length) return null; let m = 0; for (const l of ls){ const v = num(l.lap_number); if (v!=null && v>m) m = v; } return m || null; };
    const drivers = Object.keys(byDrv).map(Number).sort((a,b)=> a-b);
    // OpenF1's stint feed is sometimes incomplete (missing opening/mid stints);
    // reconstructed bars would then be misleading, so show a warning instead.
    const complete = stintsLookComplete(byDrv, lastLapOf);
    const stintRows = !complete ? '' : drivers.map(n => {
      const segs = reconstructStints(byDrv[n], lastLapOf(n));
      const total = segs.reduce((a,s)=> a+s.laps, 0);
      const bars = segs.map(s => `<span class="bar cmp-${s.cmp}" style="width:${total?(s.laps/total*100).toFixed(2):0}%" title="${s.cmp} · laps ${s.start}–${s.end} (${s.laps})">${s.laps>=3?s.laps:''}</span>`).join('');
      return `<div class="stint-row" style="--team:${drvColour(n)}"><span class="drv"><span class="chip"></span>${esc(drv(n).acr)}</span><span class="bars">${bars}</span><span class="stint-total">${total||'—'}</span></div>`;
    }).join('');

    // pit stops ranked by stationary/pit time
    const pitRows = (Array.isArray(pit)?pit:[]).map(p => ({
      n: num(p.driver_number), lap: num(p.lap_number), dur: num(p.pit_duration) ?? num(p.stop_duration),
    })).filter(p => p.dur!=null).sort((a,b)=> a.dur - b.dur);
    const fastest = pitRows.length ? pitRows[0].dur : null;
    const pitHtml = pitRows.length ? `<table class="tbl">
      <thead><tr><th>Driver</th><th class="tar">Lap</th><th class="tar">Pit time (s)</th></tr></thead>
      <tbody>${pitRows.map(p => `<tr class="${p.dur===fastest?'best':''}" style="--team:${drvColour(p.n)}">
        <td class="accent-cell"><span class="code">${esc(drv(p.n).acr)}</span>${p.dur===fastest?'<span class="best-badge">Fastest</span>':''}</td>
        <td class="num tar muted">${p.lap ?? '—'}</td>
        <td class="num tar"><b>${p.dur.toFixed(1)}</b></td>
      </tr>`).join('')}</tbody></table>` : stateBox('No pit data', 'No pit stops recorded for this session.');

    const stintsPane = complete
      ? `<div class="stints">${stintRows}</div>
        <div class="legend">
          <span><i style="background:#E8443B"></i>Soft</span>
          <span><i style="background:#F2C14E"></i>Medium</span>
          <span><i style="background:#E6E1D4"></i>Hard</span>
          <span><i style="background:#3FBF6F"></i>Inter</span>
          <span><i style="background:#3E82F7"></i>Wet</span>
        </div>`
      : stateBox('Incomplete data', 'OpenF1’s tyre-stint feed for this session is missing stints (gaps and absent opening stints), so the strategy bars would be misleading. They’ll appear here once the feed is complete.');

    body.innerHTML = `<div class="two-col">
      <div class="pane">
        <div class="pane-head">Stints by compound</div>
        ${stintsPane}
      </div>
      <div class="pane">
        <div class="pane-head">Pit stops · by pit time</div>
        <div class="tbl-scroll">${pitHtml}</div>
      </div>
    </div>
    <div class="panel-note">${complete ? `Bar width is lap count per stint; the figure at the right is the driver's total race laps (hover a bar for its compound and lap range). ` : ''}Pit time is total time in the pit lane (entry to exit) as reported by OpenF1, not just the stationary time, so it includes pit-lane travel.</div>`;
  } catch (e){ panelRetry('strategy', e, body, attempt, () => renderStrategy(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load strategy data.', 'error')); }
}

/* ---------- RACE: position over time ---------- */
async function renderPosition(session_key, attempt=0){
  const body = $('positionBody'); body.innerHTML = loadingBox('Tracing the order…');
  try {
    const [pos, pit, laps, rc] = await Promise.all([ fetchPosition(session_key), fetchPit(session_key).catch(()=>[]), fetchLaps(session_key).catch(()=>[]), fetchRC(session_key).catch(()=>[]) ]);
    const list = (Array.isArray(pos)?pos:[]).filter(p => num(p.driver_number)!=null && num(p.position)!=null && p.date);
    if (!list.length){ destroyChart('pos'); body.innerHTML = stateBox('No data', 'No position data recorded for this session.'); return; }
    const t0 = Math.min(...list.map(p => new Date(p.date).getTime()));
    const byDrv = groupByDriver(list);
    let maxPos = 0;
    const series = {}, finals = [];
    Object.keys(byDrv).map(Number).forEach(n => {
      const pts = byDrv[n].slice().sort((a,b)=> new Date(a.date)-new Date(b.date))
        .map(p => { const y = num(p.position); maxPos = Math.max(maxPos, y); return { x:(new Date(p.date).getTime()-t0)/60000, y }; });
      series[n] = pts;
      finals.push({ n, lastY: pts.length ? pts[pts.length-1].y : 99 });
    });
    // the position feed only emits on a change, so a car that holds station (or
    // leads flag-to-flag) stops early. Extend each trace to the end of its own
    // last completed lap: finishers run to the flag, retirements stop where they ended.
    const lapGroups = groupByDriver(laps);
    Object.keys(series).map(Number).forEach(n => {
      const pts = series[n], ls = lapGroups[n]; if (!pts.length || !ls || !ls.length) return;
      let endMs = -Infinity;
      for (const l of ls){ if (!l.date_start) continue; const d = num(l.lap_duration); const t = new Date(l.date_start).getTime() + (d>0 ? d*1000 : 0); if (t > endMs) endMs = t; }
      if (endMs === -Infinity) return;
      const endX = (endMs - t0) / 60000, last = pts[pts.length-1];
      if (endX > last.x) pts.push({ x: endX, y: last.y });   // hold final position to the flag (stepped line)
    });
    const order = finals.sort((a,b)=> a.lastY - b.lastY).map(o => o.n);
    const bands = safetyByTime(parseSafety(rc), t0);

    // pit-stop markers: place a dot at the position the car held when it entered the pits
    const posAt = (pts, x) => { let y = null; for (const p of pts){ if (p.x <= x) y = p.y; else break; } return y; };
    const pitMarks = {};
    (Array.isArray(pit)?pit:[]).forEach(p => {
      const n = num(p.driver_number); if (n==null || !p.date || !series[n]) return;
      const x = (new Date(p.date).getTime() - t0) / 60000; const y = posAt(series[n], x);
      if (y!=null) (pitMarks[n] = pitMarks[n] || []).push({ x, y });
    });

    body.innerHTML = `<div class="chart-box" id="posHost"><canvas id="posCanvas"></canvas></div>
      <div class="panel-note">Track position through the session against elapsed time (minutes). Lower is better — P1 sits at the top. Each line runs to that car's final lap, so finishers reach the flag and retirements stop where they ended. <b>Yellow bands</b> mark Safety Car / Virtual Safety Car periods. Dots mark each driver's pit stops (toggle with <b>Pit stops</b>). Toggle drivers in the legend or the Top buttons to follow a recovery drive or an early-stop undercut.</div>`;
    const redraw = () => {
      const host = $('posHost'); if (!host) return;
      host.innerHTML = '<canvas id="posCanvas"></canvas>';
      const set = topNSet(order, state.raceTopN);
      const shown = order.filter(n => !set || set.has(n));
      const datasets = shown.map(n => {
        const colour = drvColour(n);
        return { label: drv(n).acr, data: series[n], borderColor: colour, backgroundColor: colour, borderWidth:1.5, stepped:'before', pointRadius:0, pointHoverRadius:4, tension:0 };
      });
      if (state.showPits){
        const marks = shown.flatMap(n => pitMarks[n] || []);
        if (marks.length) datasets.push({ label:'Pit stops', data: marks, showLine:false, pointStyle:'circle',
          pointRadius:4, pointHoverRadius:5, backgroundColor:PIT_DOT.fill, borderColor:PIT_DOT.ring, borderWidth:1.5 });
      }
      drawPositionChart(datasets, maxPos || 20, bands);
    };
    state.raceRedraw.pos = redraw;
    redraw();
  } catch (e){ destroyChart('pos'); panelRetry('position', e, body, attempt, () => renderPosition(session_key, attempt+1), stateBox('Unavailable', 'Couldn’t load position data.', 'error')); }
}
function drawPositionChart(datasets, maxPos, bands){
  if (!window.Chart) return;
  destroyChart('pos');
  const ctx = $('posCanvas'); if (!ctx) return;
  state.charts.pos = new Chart(ctx, {
    type:'line',
    data:{ datasets },
    plugins:[scShadePlugin],
    options: Object.assign(chartBase({}), {
      parsing:false,
      interaction:{ mode:'nearest', intersect:false },
      plugins:{
        scShade:{ periods: bands || [] },
        legend:{ display:true, position:'top', labels:{ usePointStyle:true, boxWidth:8, boxHeight:8, color:'#5C554A', font:{family:"'IBM Plex Mono',monospace", size:10}, padding:8 } },
        tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"},
          callbacks:{ title:(it)=> (it[0]?.parsed.x ?? 0).toFixed(0) + ' min', label:(it)=> `${it.dataset.label}  P${it.parsed.y}` } },
      },
      scales:{
        x:{ type:'linear', grid:{ color:'transparent' }, ticks:{ color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback:(v)=> v+'′', maxTicksLimit:12 }, title:{ display:true, text:'Elapsed (min)', color:'#8C8475', font:{size:10} } },
        y:{ reverse:true, min:0.5, max:maxPos+0.5, grid:{ color:'#C9C0AE' }, ticks:{ stepSize:1, color:'#8C8475', font:{family:"'IBM Plex Mono',monospace",size:10}, callback:(v)=> Number.isInteger(v)?('P'+v):'' }, title:{ display:true, text:'Position', color:'#8C8475', font:{size:10} } },
      }
    })
  });
}

/* ---------- Chart.js shared theme ---------- */
function chartBase(opts){
  opts = opts || {};
  return {
    responsive:true, maintainAspectRatio:false,
    animation: REDUCED ? false : { duration: 300 },
    plugins:{ legend:{ display:false } },
    scales:{}
  };
}
function destroyChart(key){ if (state.charts[key]){ try{ state.charts[key].destroy(); }catch{} state.charts[key]=null; } }
function destroyAllCharts(){ Object.keys(state.charts).forEach(destroyChart); }

/* graph / table segmented toggle (used by the qualifying panels) */
function segToolbar(panel, mode){
  return `<div class="panel-toolbar"><div class="seg" id="seg-${panel}">
    <button type="button" data-mode="graph" class="${mode==='graph'?'active':''}">Graph</button>
    <button type="button" data-mode="table" class="${mode==='table'?'active':''}">Table</button>
  </div></div>`;
}
function wireSeg(panel, paint){
  const seg = $('seg-'+panel); if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    const mode = b.dataset.mode; if (state.qualiView[panel] === mode) return;
    state.qualiView[panel] = mode;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
    paint(mode);
  });
}

/* ============================================================
   ORCHESTRATION + BOOT
   ============================================================ */
async function onYearChange(){
  const year = Number($('selYear').value);
  state.year = year;
  try {
    await loadMeetings(year);
    if (!state.meetings.length){ pickerError('No race weekends found for ' + year + '.'); return; }
    await onMeetingChange();
  } catch (e){ logError('year change', e); pickerError('Couldn’t load the ' + year + ' calendar. Check your connection and tap Reload.'); }
}
async function onMeetingChange(){
  const mk = Number($('selMeeting').value);
  try {
    await loadSessions(mk);
    if (!state.sessions.length){ pickerError('No sessions found for this weekend.'); return; }
    await onSessionChange();
  } catch (e){ logError('meeting change', e); pickerError('Couldn’t load sessions for this weekend. Tap Reload to retry.'); }
}
async function onSessionChange(){
  const sk = $('selSession').value;
  try { await loadSession(sk); }
  catch (e){ logError('session change', e); pickerError('Couldn’t analyse this session. Tap Reload to retry.'); }
}
function pickerError(msg){
  hideAllSections(); $('sessbar').style.display = 'none'; destroyAllCharts();
  showNotice('Problem', 'Something went sideways', msg);
}

async function reload(){
  const btn = $('refreshBtn');
  if (btn && !REDUCED){ btn.classList.add('spin'); setTimeout(()=> btn.classList.remove('spin'), 600); }
  // bust the cache for the current selection so Reload genuinely re-fetches
  try {
    if (state.year) sessionStorage.removeItem(`pwa.meetings.${state.year}`);
    if (state.session) sessionStorage.removeItem(`pwa.sessions.${state.session.meeting_key}`);
    if (state.session) clearSessionCache(state.session.session_key);
    // also clear sibling practice/quali caches that the quali views pull in
    state.sessions.forEach(s => clearSessionCache(s.session_key));
    state.pitLoss = null;   // recompute the weekend pit-loss estimate from fresh data
    state.degModel = null;  // recompute the pooled-practice tyre-deg model from fresh data
    state.raceLaps = null;  // recompute the race-distance estimate from fresh data
  } catch {}
  if (state.session) await onSessionChange();
  else await onYearChange();
}

/* ---------- deep-linking: encode the selection in the URL hash ---------- */
let lastHash = '';                          // the hash we wrote ourselves (so hashchange ignores it)
function parseHash(){
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const year = Number(p.get('y')), mk = p.get('m'), sk = p.get('s'), t = p.get('t');
  if (!Number.isFinite(year) || !sk) return null;
  return { year, mk, sk, t };
}
function writeHash(){
  if (!state.session) return;
  const tab = state.view === 'prerace' ? '&t=prerace' : '';   // only the non-default tab is pinned
  const h = `#y=${state.year}&m=${state.session.meeting_key}&s=${state.session.session_key}${tab}`;
  lastHash = h;
  if (location.hash !== h){
    try { history.replaceState(null, '', h); } catch { location.hash = h; }   // replaceState doesn't fire hashchange
  }
}
// restore an exact selection from a shared/bookmarked link; throws if the season can't be loaded
async function restoreFromHash(h){
  const inRange = Array.from($('selYear').options).some(o => Number(o.value) === h.year);
  if (!inRange) throw new Error('year out of range');
  state.year = h.year; $('selYear').value = String(h.year);
  await loadMeetings(h.year);
  if (!state.meetings.length) throw new Error('no meetings');
  if (h.mk != null && state.meetings.some(m => String(m.meeting_key) === String(h.mk))) $('selMeeting').value = String(h.mk);
  await loadSessions(Number($('selMeeting').value));
  if (!state.sessions.length) throw new Error('no sessions');
  if (state.sessions.some(s => String(s.session_key) === String(h.sk))) $('selSession').value = String(h.sk);
  state.pendingTab = h.t === 'prerace' ? 'prerace' : null;   // honoured by loadSession if the session is qualifying
  await loadSession($('selSession').value);
}
// react to back/forward or a pasted/edited link
async function onHashChange(){
  if (location.hash === lastHash) return;   // our own replaceState round-trips through here on some browsers
  const h = parseHash(); if (!h) return;
  try { await restoreFromHash(h); }
  catch (e){ logError('hashchange', e); }
}
function initCopyLink(){
  const btn = $('copyLink'); if (!btn) return;
  btn.addEventListener('click', async () => {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); }
    catch {
      const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove();
    }
    const orig = btn.dataset.orig || (btn.dataset.orig = btn.textContent);
    btn.textContent = 'Copied ✓'; btn.classList.add('copied');
    clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1600);
  });
}

async function boot(){
  populateYears();
  $('selYear').addEventListener('change', onYearChange);
  $('selMeeting').addEventListener('change', onMeetingChange);
  $('selSession').addEventListener('change', onSessionChange);
  $('refreshBtn').addEventListener('click', reload);
  window.addEventListener('hashchange', onHashChange);
  initCopyLink();

  // a shared/bookmarked link wins over the default
  const hash = parseHash();
  if (hash){
    try { await restoreFromHash(hash); return; }
    catch (e){ logError('restore from hash', e); }   // fall through to the default selection
  }

  // default to the latest season that actually has a completed weekend
  const cur = new Date().getFullYear();
  for (let y = cur; y >= FIRST_YEAR; y--){
    try {
      await loadMeetings(y);
      const past = state.meetings.filter(m => new Date(m.date_start).getTime() <= Date.now());
      if (past.length){
        state.year = y; $('selYear').value = y;
        $('selMeeting').value = past[past.length-1].meeting_key;
        await onMeetingChange();
        return;
      }
    } catch (e){ logError('boot season ' + y, e); }
  }
  pickerError('No completed F1 sessions were found in OpenF1’s data. Check your connection and tap Reload.');
}

boot();
