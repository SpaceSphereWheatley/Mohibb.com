"use strict";
/* ============================================================
   Pit Wall — live F1 dashboard
   Single file. Vanilla JS. Chart.js is the only external lib.
   ============================================================ */

const OPENF1 = 'https://api.openf1.org/v1/';
const JOLPI  = 'https://api.jolpi.ca/ergast/f1/';
const POLL_MS = 3000;
const POLL_ENDED_MS = 15000;                // slower cadence once the session has ended but is still in its grace window
const GRACE_MS = 10 * 60 * 1000;            // keep "live" 10 min after session end
const STANDINGS_POLL_MS = 5 * 60 * 1000;    // re-check championship standings every 5 min while live
const TZ = 'Europe/Oslo';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  mode: null,            // 'LIVE' | 'IDLE'
  session: null,
  ended: false,          // session is over but still within its grace window
  drivers: {},           // number -> {acr, name, team, colour}
  pollTimer: null,
  standingsTimer: null,
  cdTimer: null,
  nextRace: null,
  schedule: [],          // [{name, start, end}] parsed from Jolpica, so we can tell a session is live even when OpenF1 is locked/unreachable
  scheduleLoadedAt: null,
  lockedSession: null,   // the scheduled session we believe is live while OpenF1 is locked
  charts: { ot: null, wx: null, season: null },
  standingsLoaded: false,
  standingsLoadedAt: null,
};

/* ---------- tiny DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

/* ---------- time formatting (always Europe/Oslo) ---------- */
const fmtClock = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
const fmtTime  = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour:'2-digit', minute:'2-digit', hour12:false });
const fmtDate  = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false });
function oslo(iso){ try { return fmtTime.format(new Date(iso)); } catch { return '—'; } }
function osloFull(iso){ try { return fmtDate.format(new Date(iso)); } catch { return '—'; } }

/* ---------- fetch helpers ---------- */
const FETCH_TIMEOUT_MS = 15000;
async function getJSON(url, retries = 1){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok){
      let detail = '';
      try { detail = (await res.json())?.detail || ''; } catch {}
      const err = new Error('HTTP ' + res.status);
      // OpenF1 locks the entire API to API-key holders while a session is live —
      // treat any 403 as the lock, since the exact wording of `detail` isn't reliable
      if (res.status === 403) err.liveLocked = true;
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (e) {
    // retry once on transient failures (rate limiting, server errors, timeouts) —
    // both OpenF1 and Jolpica are volunteer/shared infra and occasionally blip
    const transient = e.name === 'AbortError' || e.status === 429 || (e.status >= 500 && e.status < 600);
    if (retries > 0 && transient && !e.liveLocked){
      await new Promise(r => setTimeout(r, 1000));
      return getJSON(url, retries - 1);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
/* surface fetch/parse failures in the console without breaking the per-section UI fallback */
function logError(context, err){ console.warn('[pitwall] ' + context + ':', err); }
const of1 = (ep) => getJSON(OPENF1 + ep + (ep.includes('?') ? '&' : '?') + 'session_key=latest');

/* ---------- state rendering helpers ---------- */
function stateBox(badge, msg, kind){
  return `<div class="state ${kind||''}"><span class="badge">${esc(badge)}</span><span class="msg">${esc(msg)}</span></div>`;
}

/* ============================================================
   LIVENESS DETECTION
   ============================================================ */
async function detect(){
  const arr = await of1('sessions');
  const list = Array.isArray(arr) ? arr : [];
  const now = Date.now();
  state.ended = false;
  // session_key=latest returns every session of the latest meeting (FP1..Race),
  // not just the current one — find whichever of them is live right now.
  const live = list.find(s => {
    const start = new Date(s.date_start).getTime();
    const end = new Date(s.date_end).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end + GRACE_MS;
  });
  state.session = live || (list.length ? list[list.length - 1] : null);
  if (live){
    state.ended = now > new Date(live.date_end).getTime();
    return 'LIVE';
  }
  return 'IDLE';
}

/* ============================================================
   STATUS BAR
   ============================================================ */
function renderStatusBar(){
  const live = state.mode === 'LIVE';
  const locked = state.mode === 'LOCKED';
  const eb = $('sbEyebrow'), title = $('sbTitle');
  if (locked){
    eb.textContent = 'session';
    const ls = state.lockedSession;
    title.textContent = ls ? (ls.name + ' — live, real-time data restricted') : 'Live — real-time data restricted';
  } else if (state.detectError){
    eb.textContent = 'status'; title.textContent = 'Feed unavailable';
  } else if (live && state.session){
    const s = state.session;
    eb.textContent = 'current session';
    const where = [s.circuit_short_name || s.location, s.session_name].filter(Boolean).join(' · ');
    title.textContent = where || (s.session_name || 'F1 Session');
  } else {
    // nothing live — don't surface the most-recent (finished) session as if current
    eb.textContent = 'session';
    title.textContent = 'No live session';
  }
  const pill = $('sbState');
  pill.className = 'pill' + (live ? ' live' : locked ? ' locked' : '');
  $('sbStateText').textContent = live ? 'Live' : (locked ? 'Locked' : 'Idle');
}

function setUpdated(){
  $('sbUpdated').textContent = fmtClock.format(new Date());
  if (!REDUCED){
    const bar = $('statusbar');
    bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
  }
}

/* flag state from latest race control message */
const FLAG_MAP = {
  GREEN:['green','#2E6F4F'], CLEAR:['green','#2E6F4F'],
  YELLOW:['yellow','#B07A12'], 'DOUBLE YELLOW':['yellow','#B07A12'],
  RED:['red','#C0392B'],
  BLUE:['blue','#2E5FA3'],
};
function setFlag(rc){
  const fp = $('sbFlag');
  // the track flag only means something during a live session — hide it otherwise
  if (state.mode !== 'LIVE'){ fp.style.display = 'none'; return; }
  fp.style.display = '';
  let colour = '#8C8475', text = 'Green';
  if (Array.isArray(rc) && rc.length){
    const sorted = [...rc].sort((a,b)=> new Date(b.date) - new Date(a.date));
    for (const m of sorted){
      const cat = (m.category||'').toUpperCase();
      const flag = (m.flag||'').toUpperCase();
      const msg = (m.message||'').toUpperCase();
      if (cat === 'SAFETYCAR' || msg.includes('SAFETY CAR') || msg.includes('VIRTUAL SAFETY')){ colour='#7A5BB0'; text = msg.includes('VIRTUAL')?'VSC':'Safety Car'; break; }
      if (flag && FLAG_MAP[flag]){ [,colour]=FLAG_MAP[flag]; text = flag.charAt(0)+flag.slice(1).toLowerCase(); break; }
    }
  }
  fp.querySelector('.swatch').style.background = colour;
  $('sbFlagText').textContent = text;
}

/* ============================================================
   1. STANDINGS  (Jolpica — once on load / manual refresh)
   ============================================================ */
async function loadStandings(){
  const body = $('standingsBody');
  const note = $('standingsNote');
  note.textContent = '';
  try {
    let label = '';
    let [drv, con] = await Promise.all([
      getJSON(JOLPI + 'current/driverStandings.json'),
      getJSON(JOLPI + 'current/constructorStandings.json'),
    ]);
    let dList = drv?.MRData?.StandingsTable?.StandingsLists?.[0];
    let cList = con?.MRData?.StandingsTable?.StandingsLists?.[0];

    if (!dList || !cList){
      // season not populated yet — fall back to previous year
      const prev = new Date().getFullYear() - 1;
      [drv, con] = await Promise.all([
        getJSON(JOLPI + prev + '/driverStandings.json'),
        getJSON(JOLPI + prev + '/constructorStandings.json'),
      ]);
      dList = drv?.MRData?.StandingsTable?.StandingsLists?.[0];
      cList = con?.MRData?.StandingsTable?.StandingsLists?.[0];
      label = '(' + prev + ' final)';
    } else {
      label = '(' + (dList.season || '') + ')';
    }
    if (!dList || !cList) throw new Error('empty');

    const drvRows = (dList.DriverStandings||[]).map(d => {
      const code = d.Driver?.code || (d.Driver?.familyName||'').slice(0,3).toUpperCase();
      const name = `${d.Driver?.givenName||''} ${d.Driver?.familyName||''}`.trim();
      const team = d.Constructors?.[0]?.name || '—';   // plural array — common gotcha
      return `<tr>
        <td class="pos">${esc(d.position)}</td>
        <td class="accent-cell" style="--team:${teamColourByName(team)}"><span class="code">${esc(code)}</span> <span class="muted">${esc(name)}</span></td>
        <td class="muted">${esc(team)}</td>
        <td class="num tar"><b>${esc(num(d.points) ?? d.points)}</b></td>
        <td class="num tar muted">${esc(d.wins||0)}</td>
      </tr>`;
    }).join('');

    const conRows = (cList.ConstructorStandings||[]).map(c => {
      const team = c.Constructor?.name || '—';
      return `<tr>
        <td class="pos">${esc(c.position)}</td>
        <td class="accent-cell" style="--team:${teamColourByName(team)}">${esc(team)}</td>
        <td class="num tar"><b>${esc(num(c.points) ?? c.points)}</b></td>
        <td class="num tar muted">${esc(c.wins||0)}</td>
      </tr>`;
    }).join('');

    const html = `
      <div class="col">
        <div class="col-head">Drivers</div>
        <div class="tbl-scroll"><table class="tbl">
          <thead><tr><th scope="col">#</th><th scope="col">Driver</th><th scope="col">Team</th><th scope="col" class="tar">Pts</th><th scope="col" class="tar">Wins</th></tr></thead>
          <tbody>${drvRows}</tbody>
        </table></div>
      </div>
      <div class="col">
        <div class="col-head">Constructors</div>
        <div class="tbl-scroll"><table class="tbl">
          <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col" class="tar">Pts</th><th scope="col" class="tar">Wins</th></tr></thead>
          <tbody>${conRows}</tbody>
        </table></div>
      </div>`;
    body.innerHTML = html;
    state.standingsLoaded = true;
    state.standingsLoadedAt = Date.now();
    note.textContent = label + ' · loaded ' + fmtClock.format(new Date(state.standingsLoadedAt));
    try { localStorage.setItem('pitwall.standings', JSON.stringify({ html, label, at: state.standingsLoadedAt })); } catch {}
    loadSeason(dList, cList);
  } catch (e){
    logError('standings', e);
    // fall back to the last successfully loaded standings, if any, rather than blanking the panel
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('pitwall.standings')); } catch {}
    if (cached?.html){
      body.innerHTML = cached.html;
      note.textContent = cached.label + ' · cached ' + fmtClock.format(new Date(cached.at)) + ' (Jolpica unreachable, tap refresh to retry)';
      renderSeasonFromCache();
    } else {
      body.innerHTML = stateBox('Unavailable', 'Standings unavailable — Jolpica API not responding. Tap refresh to retry.', 'error');
    }
  }
}

/* known team colours so standings rows have an accent even without OpenF1 driver data */
const TEAM_COLOURS = {
  'red bull':'#3671C6','mclaren':'#FF8000','ferrari':'#E8002D','mercedes':'#27F4D2',
  'aston martin':'#229971','alpine':'#0093CC','alpine f1 team':'#0093CC','williams':'#64C4FF',
  'rb':'#6692FF','rb f1 team':'#6692FF','racing bulls':'#6692FF','haas':'#B6BABD','haas f1 team':'#B6BABD',
  'sauber':'#52E252','kick sauber':'#52E252','alfa romeo':'#52E252',
  'audi':'#FF2D00','cadillac':'#444444',
};
function teamColourByName(name){
  const k = (name||'').toLowerCase();
  for (const key in TEAM_COLOURS){ if (k.includes(key)) return TEAM_COLOURS[key]; }
  return 'var(--ink-4)';
}

/* ============================================================
   1b. SEASON SO FAR  (Jolpica — cumulative points per round)
   Built from race + sprint results rather than per-round standings,
   so the whole season costs a handful of paginated requests instead
   of one per round. Only re-fetched when the standings change.
   ============================================================ */
const SEASON_CACHE_KEY = 'pitwall.season';
const SEASON_PAGE = 100;                 // Jolpica's max page size (counts result rows, not races)
const SEASON_HIGHLIGHT = 5;              // series shown in colour by default
const SEASON_MUTED = '#C9C0AE';
// most points one entry can take from a single race / sprint (no fastest-lap point since 2025)
const MAX_PTS = {
  drivers:      { race: 25, sprint: 8 },
  constructors: { race: 25 + 18, sprint: 8 + 7 },
};
const COUNTRY_CODES = {
  'Australia':'AUS','China':'CHN','Japan':'JPN','Bahrain':'BHR','Saudi Arabia':'KSA',
  'USA':'USA','United States':'USA','Italy':'ITA','Monaco':'MON','Spain':'ESP','Canada':'CAN',
  'Austria':'AUT','UK':'GBR','United Kingdom':'GBR','Belgium':'BEL','Hungary':'HUN',
  'Netherlands':'NED','Azerbaijan':'AZE','Singapore':'SGP','Mexico':'MEX','Brazil':'BRA',
  'Qatar':'QAT','UAE':'UAE','United Arab Emirates':'UAE','France':'FRA','Portugal':'POR',
  'Germany':'GER','Russia':'RUS','Turkey':'TUR','Vietnam':'VNM','Argentina':'ARG',
};
const seasonState = {
  data: null,            // compact season model (see buildSeason)
  sig: null,             // standings signature the data was built against
  who: 'drivers',        // 'drivers' | 'constructors'
  measure: 'points',     // 'points' | 'gap'
  hl: { drivers: null, constructors: null },   // Set of highlighted ids per view
};
const teamHex = (name) => { const c = teamColourByName(name); return c.startsWith('#') ? c : '#8C8475'; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* fetch every page of a results endpoint, merging races split across pages */
async function fetchSeasonResults(season, kind){
  const key = kind === 'sprint' ? 'SprintResults' : 'Results';
  const byRound = new Map();
  let offset = 0, total = 1;
  while (offset < total){
    if (offset) await sleep(300);        // Jolpica is volunteer-run — don't burst
    const j = await getJSON(JOLPI + season + '/' + (kind === 'sprint' ? 'sprint' : 'results') + '.json?limit=' + SEASON_PAGE + '&offset=' + offset);
    const mr = j?.MRData;
    total = num(mr?.total) ?? 0;
    for (const race of mr?.RaceTable?.Races || []){
      const r = num(race.round); if (r == null) continue;
      if (!byRound.has(r)) byRound.set(r, { race, rows: [] });
      byRound.get(r).rows.push(...(race[key] || []));
    }
    offset += SEASON_PAGE;
  }
  return byRound;
}

/* turn raw results into per-round points for every driver/constructor, ordered by the standings */
function buildSeason(season, races, sprints, dList, cList, calendar){
  const roundNums = [...new Set([...races.keys(), ...sprints.keys()])].sort((a, b) => a - b);
  const rounds = roundNums.map(r => {
    const race = (races.get(r) || sprints.get(r)).race;
    const country = race.Circuit?.Location?.country || '';
    return {
      round: r,
      code: COUNTRY_CODES[country] || country.slice(0, 3).toUpperCase() || ('R' + r),
      name: race.raceName || ('Round ' + r),
      sprint: sprints.has(r),
      race: races.has(r),
    };
  });
  const drivers = new Map(), teams = new Map();
  const ensure = (map, id, init) => { if (!map.has(id)) map.set(id, { id, ...init, pts: rounds.map(() => null) }); return map.get(id); };
  roundNums.forEach((r, i) => {
    for (const src of [races.get(r), sprints.get(r)]){
      for (const row of src?.rows || []){
        const p = num(row.points) ?? 0;
        const d = row.Driver || {}, c = row.Constructor || {};
        if (d.driverId){
          const e = ensure(drivers, d.driverId, {});
          e.code = d.code || (d.familyName || '').slice(0, 3).toUpperCase();
          e.name = `${d.givenName || ''} ${d.familyName || ''}`.trim();
          e.team = c.name || e.team || '';          // latest team wins, for mid-season swaps
          e.pts[i] = (e.pts[i] || 0) + p;
        }
        if (c.constructorId){
          const e = ensure(teams, c.constructorId, { name: c.name || c.constructorId });
          e.pts[i] = (e.pts[i] || 0) + p;
        }
      }
    }
  });

  // order by official standings; anything missing from them goes last by total
  const total = (e) => e.pts.reduce((a, b) => a + (b || 0), 0);
  const order = (map, list, idOf) => {
    const pos = new Map((list || []).map(s => [idOf(s), num(s.position) ?? 999]));
    return [...map.values()].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999) || total(b) - total(a));
  };
  const dOrdered = order(drivers, dList.DriverStandings, s => s.Driver?.driverId);
  const cOrdered = order(teams, cList.ConstructorStandings, s => s.Constructor?.constructorId);

  // teammates share a colour, so the lower-placed one gets a dashed line
  const seenTeam = new Set();
  dOrdered.forEach(e => { e.dash = seenTeam.has(e.team); seenTeam.add(e.team); });

  // reconcile against the official totals (post-race penalties etc. can make them differ)
  const official = new Map((dList.DriverStandings || []).map(s => [s.Driver?.driverId, num(s.points)]));
  const mismatch = dOrdered.filter(e => official.has(e.id) && Math.abs(official.get(e.id) - total(e)) > 0.01).length;

  // races/sprints still to run, from the season calendar; null if the calendar couldn't be loaded
  const remaining = calendar ? calendar.flatMap(c => {
    const race = !races.has(c.round), sprint = c.sprint && !sprints.has(c.round);
    return race || sprint ? [{ round: c.round, name: c.name, race, sprint }] : [];
  }) : null;

  return { season, rounds, drivers: dOrdered, constructors: cOrdered, mismatch, remaining };
}

/* the season calendar: [{round, name, sprint}] */
async function fetchSeasonCalendar(season){
  const j = await getJSON(JOLPI + season + '.json');
  return (j?.MRData?.RaceTable?.Races || []).map(r => ({
    round: num(r.round), name: r.raceName || ('Round ' + r.round), sprint: !!r.Sprint,
  })).filter(c => c.round != null);
}

/* signature of the standings — changes whenever any points are scored or adjusted */
function standingsSig(dList){
  const pts = (dList.DriverStandings || []).reduce((a, s) => a + (num(s.points) || 0), 0);
  return [dList.season, dList.round, pts].join('|');
}

async function loadSeason(dList, cList){
  const sig = standingsSig(dList);
  if (seasonState.sig === sig && seasonState.data) return;   // nothing changed since last render
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(SEASON_CACHE_KEY)); } catch {}
  if (cached?.sig === sig && cached.data && 'remaining' in cached.data){
    setSeasonData(cached.data, sig);
    return;
  }
  try {
    const races = await fetchSeasonResults(dList.season, 'race');
    const sprints = await fetchSeasonResults(dList.season, 'sprint');
    if (!races.size && !sprints.size) throw new Error('no results');
    let calendar = null;
    try { calendar = await fetchSeasonCalendar(dList.season); }
    catch (e){ logError('season calendar', e); }     // chart still works, just without the clinch maths
    const data = buildSeason(dList.season, races, sprints, dList, cList, calendar);
    setSeasonData(data, sig);
    try { localStorage.setItem(SEASON_CACHE_KEY, JSON.stringify({ sig, data, at: Date.now() })); } catch {}
  } catch (e){
    logError('season', e);
    if (cached?.data) setSeasonData(cached.data, null, true);   // stale but better than nothing
    else if (!seasonState.data) $('seasonBox').style.display = 'none';
  }
}
function renderSeasonFromCache(){
  if (seasonState.data) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(SEASON_CACHE_KEY)); } catch {}
  if (cached?.data) setSeasonData(cached.data, null, true);
}

function setSeasonData(data, sig, stale){
  if (seasonState.data?.season !== data.season){
    seasonState.hl.drivers = new Set(data.drivers.slice(0, SEASON_HIGHLIGHT).map(e => e.id));
    seasonState.hl.constructors = new Set(data.constructors.slice(0, SEASON_HIGHLIGHT).map(e => e.id));
  }
  seasonState.data = data;
  seasonState.sig = sig;
  seasonState.stale = !!stale;
  $('seasonBox').style.display = '';
  renderSeason();
}

/* cumulative series for the current view; null until an entry's first result (mid-season debuts) */
function seasonSeries(){
  const { data, who, measure } = seasonState;
  const list = data[who];
  const series = list.map(e => {
    let acc = null;
    return e.pts.map(p => (p == null && acc == null) ? null : (acc = (acc || 0) + (p || 0)));
  });
  if (measure === 'gap'){
    const leader = data.rounds.map((_, i) => Math.max(...series.map(s => s[i] ?? -Infinity)));
    return series.map(s => s.map((v, i) => v == null ? null : v - leader[i]));
  }
  return series;
}

/* ---------- title maths: what the leader needs to clinch ---------- */
const eventPts = (who, ev) => (ev.race ? MAX_PTS[who].race : 0) + (ev.sprint ? MAX_PTS[who].sprint : 0);

/* most points one entry can still score after each completed round (index-aligned with data.rounds) */
function pointsLeftAfter(data, who){
  if (!data.remaining) return null;
  const tail = data.remaining.reduce((a, ev) => a + eventPts(who, ev), 0);
  const out = new Array(data.rounds.length);
  let acc = tail;
  for (let i = data.rounds.length - 1; i >= 0; i--){
    out[i] = acc;
    acc += eventPts(who, data.rounds[i]);   // that round's completed race/sprint was still to come before it
  }
  return out;
}

/* one-sentence title picture for the current view, or null if the calendar is unknown */
function clinchSummary(data, who){
  if (!data.remaining) return null;
  const total = (e) => e.pts.reduce((a, b) => a + (b || 0), 0);
  const ranked = data[who].map(e => ({ name: e.name, pts: total(e) })).sort((a, b) => b.pts - a.pts);
  const [lead, second] = ranked;
  if (!lead || !second) return null;
  const left = data.remaining.reduce((a, ev) => a + eventPts(who, ev), 0);
  const gap = lead.pts - second.pts;
  const cup = who === 'drivers' ? 'drivers’ title' : 'constructors’ title';
  const L = `<b>${esc(lead.name)}</b>`, S = esc(second.name);

  if (gap > left){
    return left === 0
      ? `${L} won the ${esc(data.season)} ${cup}.`
      : `${L} has clinched the ${cup}: ${gap} points clear with only ${left} left.`;
  }
  if (left === 0) return `${L} and ${S} finished level on points, so the ${cup} goes to countback (most wins).`;

  const nR = data.remaining.filter(ev => ev.race).length, nS = data.remaining.filter(ev => ev.sprint).length;
  const alive = ranked.filter(x => x.pts + left >= lead.pts).length - 1;
  let text = `${L} leads ${S} by <b>${gap}</b> with <b>${left}</b> points left `
    + `(${nR} race${nR === 1 ? '' : 's'}${nS ? `, ${nS} sprint${nS === 1 ? '' : 's'}` : ''})`
    + (alive > 1 ? `, and ${alive} rivals can still win it. ` : '. ');

  // clinching needs a lead greater than what's left once the next round is done
  const next = data.remaining[0], w = eventPts(who, next);
  const need = (left - w) + 1 - gap;             // points to gain on P2 at the next round
  const rest = alive > 1 ? ' and stays out of reach of the rest' : '';
  if (need <= 0){
    text += `${L} clinches at the ${esc(next.name)} unless ${S} outscores them there by ${1 - need} or more.`;
  } else if (need <= w){
    text += `${L} can clinch at the ${esc(next.name)} by outscoring ${S} by <b>${need}</b> or more${rest}.`;
  } else {
    // earliest round where even a perfect run (max gain every event) would do it
    let gained = 0, earliest = null;
    for (const ev of data.remaining){
      gained += eventPts(who, ev);
      if (gap + gained > left - gained){ earliest = ev; break; }
    }
    if (earliest) text += `The earliest ${L} could clinch is the ${esc(earliest.name)}.`;
  }
  return text;
}

function renderSeason(animate = true){
  const { data, who, measure } = seasonState;
  if (!data) return;
  const list = data[who];
  const hl = seasonState.hl[who];
  const series = seasonSeries();

  document.querySelectorAll('[data-season-who]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.seasonWho === who)));
  document.querySelectorAll('[data-season-measure]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.seasonMeasure === measure)));
  $('seasonTitle').textContent = data.season + ' season so far · ' + data.rounds.length + (data.rounds.length === 1 ? ' round' : ' rounds');

  $('seasonLegend').innerHTML = list.map(e => {
    const label = who === 'drivers' ? e.code : e.name;
    const team = who === 'drivers' ? e.team : e.name;
    return `<button type="button" class="sl-chip${e.dash ? ' dash' : ''}" data-season-id="${esc(e.id)}" aria-pressed="${hl.has(e.id)}" title="${esc(who === 'drivers' ? e.name + ' · ' + e.team : e.name)}" style="--team:${teamHex(team)}"><i></i>${esc(label)}</button>`;
  }).join('');

  const notes = [];
  if (data.rounds.some(r => r.sprint)) notes.push('* sprint weekend (race + sprint points)');
  notes.push('Tap a name or a line to highlight it.');
  if (data.mismatch) notes.push(`Totals for ${data.mismatch} driver${data.mismatch === 1 ? '' : 's'} differ from the official standings (likely post-race penalties); the chart uses race-by-race results.`);
  if (data.remaining) notes.push('Below the dashed rust line, the title is out of reach. A tie on points goes to countback (most wins), so “clinch” here means certain on points alone.');
  if (seasonState.stale) notes.push('Showing cached data — Jolpica unreachable.');
  $('seasonNote').textContent = notes.join(' ');

  const clinch = clinchSummary(data, who);
  $('seasonClinch').innerHTML = clinch || '';
  $('seasonClinch').style.display = clinch ? '' : 'none';

  $('seasonChart').setAttribute('aria-label', `${measure === 'gap' ? 'Points gap to the leader' : 'Cumulative points'} per round for ${data.season} ${who}. Leader after round ${data.rounds.at(-1)?.round}: ${list[0]?.name || '—'}. Full totals are in the standings tables above.`);

  drawSeasonChart(list, series, hl, animate);
}

/* draws each highlighted series' code at its last point, nudged apart so labels don't collide */
const seasonEndLabels = {
  id: 'seasonEndLabels',
  afterDatasetsDraw(chart){
    const { ctx } = chart;
    const labels = [];
    chart.data.datasets.forEach((ds, i) => {
      if (!ds._hl && !ds._limit) return;
      const meta = chart.getDatasetMeta(i);
      for (let k = ds.data.length - 1; k >= 0; k--){
        if (ds.data[k] != null){ const pt = meta.data[k]; labels.push({ x: pt.x, y: pt.y, text: ds._short, colour: ds._limit ? '#8F371A' : '#211D17' }); break; }
      }
    });
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++){ if (labels[k].y - labels[k - 1].y < 12) labels[k].y = labels[k - 1].y + 12; }
    ctx.save();
    ctx.font = "700 10px 'IBM Plex Mono',monospace";
    ctx.textBaseline = 'middle';
    labels.forEach(l => { ctx.fillStyle = l.colour; ctx.fillText(l.text, l.x + 6, l.y); });
    ctx.restore();
  }
};

function drawSeasonChart(list, series, hl, animate){
  if (!window.Chart) return;
  const { data, who, measure } = seasonState;
  const ctx = $('seasonChart'); if (!ctx) return;
  const anyHl = hl.size > 0;
  const datasets = list.map((e, i) => {
    const on = hl.has(e.id);
    const colour = teamHex(who === 'drivers' ? e.team : e.name);
    return {
      label: who === 'drivers' ? e.code : e.name,
      data: series[i],
      _id: e.id, _hl: on, _short: who === 'drivers' ? e.code : e.name.replace(/ F1 Team$/, ''),
      borderColor: on || !anyHl ? colour : SEASON_MUTED,
      backgroundColor: on || !anyHl ? colour : SEASON_MUTED,
      borderWidth: on ? 2.25 : 1.25,
      borderDash: e.dash ? [6, 4] : [],
      pointRadius: 0, pointHoverRadius: on ? 4 : 0, pointHitRadius: 8,
      tension: 0, spanGaps: false,
      order: on ? 0 : 1,          // lower order draws on top
    };
  });

  // elimination line: the leader's total minus everything still up for grabs — anyone below it can't win
  const left = pointsLeftAfter(data, who);
  let floor = 0;
  if (left){
    const leader = data.rounds.map((_, i) => Math.max(...series.map(s => s[i] ?? -Infinity)));
    if (measure === 'gap') floor = Math.min(...series.flat().filter(v => v != null));
    datasets.push({
      label: 'Out of reach', _limit: true, _short: 'OUT ↓',
      data: left.map((l, i) => (measure === 'gap' ? 0 : leader[i]) - l),
      borderColor: '#B4471F', backgroundColor: 'rgba(180,71,31,0.07)', fill: 'start',
      borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,
      tension: 0, order: 2,     // behind every driver line
    });
  }

  const base = chartBase({ yTitle: measure === 'gap' ? 'pts behind leader' : 'points' });
  // the elimination line starts far below everyone early in the season — don't let it set the scale
  base.scales.y.min = measure === 'gap' ? Math.floor(Math.min(floor, -1) / 50) * 50 : 0;
  base.layout = { padding: { right: who === 'drivers' ? 34 : 84, top: 6 } };
  if (!animate) base.animation = false;
  base.interaction = { mode: 'index', intersect: false };
  base.scales.x.grid.color = 'transparent';
  base.scales.x.ticks.callback = (_, i) => data.rounds[i] ? data.rounds[i].code + (data.rounds[i].sprint ? '*' : '') : '';
  base.scales.y.ticks.precision = 0;
  base.plugins.tooltip = {
    ...base.plugins.tooltip,
    itemSort: (a, b) => b.parsed.y - a.parsed.y,
    filter: (item) => !item.dataset._limit && (!anyHl || item.dataset._hl),
    footerColor: '#8F371A', footerFont: { family: "'IBM Plex Mono',monospace", size: 11, weight: '600' },
    callbacks: {
      footer: (items) => left && items.length ? `Max points left: ${left[items[0].dataIndex]}` : '',
      title: (items) => { const r = data.rounds[items[0].dataIndex]; return r ? `R${r.round} · ${r.name}${r.sprint ? ' (+ sprint)' : ''}` : ''; },
      label: (item) => {
        const e = list[item.datasetIndex];
        const gained = e.pts[item.dataIndex] || 0;
        const v = item.parsed.y;
        return ` ${item.dataset.label}  ${measure === 'gap' ? (v === 0 ? 'leader' : v) : v}  (+${gained} this round)`;
      },
    },
  };
  base.onClick = (evt, _els, chart) => {
    const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false)[0];
    const id = hit && chart.data.datasets[hit.datasetIndex]._id;
    if (id) toggleSeasonHighlight(id);
  };

  destroyChart('season');
  state.charts.season = new Chart(ctx, { type: 'line', data: { labels: data.rounds.map(r => r.round), datasets }, options: base, plugins: [seasonEndLabels] });
}

function toggleSeasonHighlight(id){
  const hl = seasonState.hl[seasonState.who];
  if (hl.has(id)) hl.delete(id); else hl.add(id);
  renderSeason(false);      // no replayed animation for a highlight change
}

$('seasonBox').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.seasonWho){ seasonState.who = b.dataset.seasonWho; renderSeason(); }
  else if (b.dataset.seasonMeasure){ seasonState.measure = b.dataset.seasonMeasure; renderSeason(); }
  else if (b.dataset.seasonId){ toggleSeasonHighlight(b.dataset.seasonId); }
});

/* ============================================================
   DRIVERS lookup (OpenF1, once per session)
   ============================================================ */
async function loadDrivers(){
  try {
    const arr = await of1('drivers');
    const map = {};
    (Array.isArray(arr)?arr:[]).forEach(d => {
      const n = num(d.driver_number);
      if (n == null) return;
      map[n] = {
        acr: d.name_acronym || ('#'+n),
        name: d.full_name || d.broadcast_name || ('#'+n),
        team: d.team_name || '',
        colour: d.team_colour ? ('#'+String(d.team_colour).replace('#','')) : null,
      };
    });
    state.drivers = map;
  } catch (e) { logError('drivers', e); state.drivers = {}; }
}
function drv(n){ const d = state.drivers[num(n)]; return d || { acr: (n!=null?'#'+n:'—'), name:'—', team:'', colour:null }; }

/* ============================================================
   2. RACE CONTROL
   ============================================================ */
function classifyRC(m){
  const cat = (m.category||'').toUpperCase();
  const flag = (m.flag||'').toUpperCase();
  const msg = (m.message||'').toUpperCase();
  if (cat==='SAFETYCAR' || msg.includes('SAFETY CAR') || msg.includes('VIRTUAL SAFETY')) return ['sc', msg.includes('VIRTUAL')?'VSC':'SC'];
  if (flag==='RED' || msg.includes('RED FLAG')) return ['red','Red'];
  if (flag==='YELLOW' || flag==='DOUBLE YELLOW') return ['yellow', flag==='DOUBLE YELLOW'?'2x Yellow':'Yellow'];
  if (flag==='BLUE') return ['blue','Blue'];
  if (flag==='GREEN' || flag==='CLEAR' || msg.includes('TRACK CLEAR') || msg.includes('GREEN')) return ['green','Green'];
  if (msg.includes('PENALTY') || msg.includes('INVESTIGAT') || msg.includes('NOTED') || msg.includes('DELETED')) return ['neutral','Steward'];
  return ['neutral', cat ? cat.charAt(0)+cat.slice(1).toLowerCase() : 'Info'];
}
async function renderRaceControl(){
  const body = $('rcBody');
  try {
    const arr = await of1('race_control');
    setFlag(arr);
    const rows = (Array.isArray(arr)?arr:[]).slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
    if (!rows.length){ body.innerHTML = stateBox('Quiet', 'No race control messages yet this session.'); return; }
    body.innerHTML = `<ul class="feed" role="feed" aria-label="Race control messages">` + rows.map(m => {
      const [cls,tag] = classifyRC(m);
      const who = m.driver_number ? `<span class="who">${esc(drv(m.driver_number).acr)}</span>` : '';
      const lap = m.lap_number!=null ? `L${esc(m.lap_number)}` : '';
      return `<li class="feed-row ${cls}">
        <span class="t">${oslo(m.date)}</span>
        <span class="lap">${lap}</span>
        <span class="body"><span class="tagk ${cls}">${esc(tag)}</span>${esc(m.message||'—')}${who}</span>
      </li>`;
    }).join('') + `</ul>`;
  } catch (e) {
    logError('race control', e);
    body.innerHTML = stateBox('Unavailable', 'Race control feed unavailable — retrying on next refresh.', 'error');
  }
}

/* ============================================================
   3. PIT STOPS
   ============================================================ */
async function renderPit(){
  const body = $('pitBody');
  try {
    const arr = await of1('pit');
    const rows = (Array.isArray(arr)?arr:[]).map(p => ({
      n: p.driver_number, lap: p.lap_number,
      dur: num(p.pit_duration) ?? num(p.stop_duration),
      lane: num(p.lane_duration) ?? num(p.pit_lane_duration),
    })).filter(p => p.dur != null).sort((a,b)=> a.dur - b.dur);
    if (!rows.length){ body.innerHTML = stateBox('Quiet', 'No pit stops recorded yet this session.'); return; }
    const fastest = rows[0].dur;
    body.innerHTML = `<table class="tbl">
      <thead><tr><th scope="col">Driver</th><th scope="col" class="tar">Lap</th><th scope="col" class="tar">Stop (s)</th><th scope="col" class="tar">Lane (s)</th></tr></thead>
      <tbody>${rows.map(p => {
        const d = drv(p.n);
        const fast = p.dur === fastest;
        return `<tr class="${fast?'fastest':''}" style="--team:${d.colour||'var(--ink-4)'}">
          <td class="accent-cell"><span class="code">${esc(d.acr)}</span>${fast?'<span class="fastest-badge">Fastest</span>':''}</td>
          <td class="num tar muted">${p.lap!=null?esc(p.lap):'—'}</td>
          <td class="num tar"><b>${p.dur.toFixed(1)}</b></td>
          <td class="num tar muted">${p.lane!=null?p.lane.toFixed(1):'—'}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch (e) {
    logError('pit stops', e);
    body.innerHTML = stateBox('Unavailable', 'Pit data unavailable — retrying on next refresh.', 'error');
  }
}

/* ============================================================
   4. OVERTAKES
   ============================================================ */
async function renderOvertakes(){
  const body = $('otBody');
  try {
    const arr = await of1('overtakes');
    const list = (Array.isArray(arr)?arr:[]).slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
    if (!list.length){
      destroyChart('ot');
      body.innerHTML = stateBox('Quiet', 'No overtakes recorded yet this session.');
      return;
    }
    const counts = {};
    list.forEach(o => { const n = num(o.overtaking_driver_number); if (n!=null) counts[n] = (counts[n]||0)+1; });
    const ranked = Object.entries(counts).map(([n,c])=>({ n:Number(n), c })).sort((a,b)=> b.c-a.c).slice(0,12);

    body.innerHTML = `<div class="two-col">
      <div class="pane"><div class="pane-head">Passes by driver</div><div class="chart-box"><canvas id="otChart"></canvas></div></div>
      <div class="pane"><div class="pane-head">Chronological</div><ul class="ot-list" aria-label="Overtakes, most recent first">${
        list.slice().reverse().map(o => {
          const a = drv(o.overtaking_driver_number), b = drv(o.overtaken_driver_number);
          return `<li class="ot-row"><span class="t">${oslo(o.date)}</span>
            <span class="ot-move"><span class="gain">${esc(a.acr)}</span><span class="arrow">›</span><span class="lost">${esc(b.acr)}</span></span></li>`;
        }).join('')
      }</ul></div>
    </div>`;

    drawOvertakeChart(ranked);
  } catch (e) {
    logError('overtakes', e);
    destroyChart('ot');
    body.innerHTML = stateBox('Unavailable', 'Overtake data unavailable — retrying on next refresh.', 'error');
  }
}
function drawOvertakeChart(ranked){
  if (!window.Chart) return;
  destroyChart('ot');
  const ctx = $('otChart'); if (!ctx) return;
  state.charts.ot = new Chart(ctx, {
    type:'bar',
    data:{
      labels: ranked.map(r => drv(r.n).acr),
      datasets:[{
        data: ranked.map(r => r.c),
        backgroundColor: ranked.map(r => drv(r.n).colour || '#8C8475'),
        borderRadius:3, barThickness:'flex', maxBarThickness:22,
      }]
    },
    options: chartBase({ indexAxis:'y', xTitle:'passes', integerX:true })
  });
}

/* ============================================================
   5. TYRE STRATEGY
   ============================================================ */
const COMPOUND = { SOFT:'SOFT', MEDIUM:'MEDIUM', HARD:'HARD', DRY:'HARD', INTERMEDIATE:'INTERMEDIATE', INTERMEDIATES:'INTERMEDIATE', INTER:'INTERMEDIATE', WET:'WET' };
async function renderStints(){
  const body = $('stintsBody');
  try {
    const arr = await of1('stints');
    const list = Array.isArray(arr)?arr:[];
    if (!list.length){ body.innerHTML = stateBox('Quiet', 'No tyre stint data yet this session.'); return; }
    const byDrv = {};
    list.forEach(s => {
      const n = num(s.driver_number); if (n==null) return;
      (byDrv[n] = byDrv[n] || []).push(s);
    });
    const drivers = Object.keys(byDrv).map(Number).sort((a,b)=>a-b);
    const rows = drivers.map(n => {
      const stints = byDrv[n].slice().sort((a,b)=> (num(a.stint_number)||0)-(num(b.stint_number)||0));
      const segs = stints.map(s => {
        const start = num(s.lap_start) ?? 0, end = num(s.lap_end) ?? start;
        const laps = Math.max(1, (end - start) + 1);
        const cmp = COMPOUND[(s.compound||'').toUpperCase()] || 'UNKNOWN';
        return { laps, cmp };
      });
      const total = segs.reduce((a,s)=> a+s.laps, 0) || 1;
      const d = drv(n);
      const bars = segs.map(s => `<span class="bar cmp-${s.cmp}" style="width:${(s.laps/total*100).toFixed(2)}%" title="${s.cmp} · ${s.laps} laps">${s.laps>=3?s.laps:''}</span>`).join('');
      return `<div class="stint-row" style="--team:${d.colour||'var(--ink-4)'}">
        <span class="drv"><span class="chip"></span>${esc(d.acr)}</span>
        <span class="bars">${bars}</span></div>`;
    }).join('');
    body.innerHTML = `<div class="stints">${rows}</div>
      <div class="legend">
        <span><i style="background:#E8443B"></i>Soft</span>
        <span><i style="background:#F2C14E"></i>Medium</span>
        <span><i style="background:#E6E1D4"></i>Hard</span>
        <span><i style="background:#3FBF6F"></i>Inter</span>
        <span><i style="background:#3E82F7"></i>Wet</span>
      </div>`;
  } catch (e) {
    logError('tyre strategy', e);
    body.innerHTML = stateBox('Unavailable', 'Tyre strategy unavailable — retrying on next refresh.', 'error');
  }
}

/* ============================================================
   6. WEATHER
   ============================================================ */
const WIND_DIR = (deg) => { const d = num(deg); if (d==null) return ''; const dirs=['N','NE','E','SE','S','SW','W','NW']; return dirs[Math.round(d/45)%8]; };
async function renderWeather(){
  const body = $('wxBody');
  try {
    const arr = await of1('weather');
    const list = (Array.isArray(arr)?arr:[]).slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
    if (!list.length){ destroyChart('wx'); body.innerHTML = stateBox('Quiet', 'No weather samples yet this session.'); return; }
    const w = list[list.length-1];
    const rain = num(w.rainfall);
    const cell = (k,v,sub,extra='') => `<div class="wx-cell"><div class="k">${k}</div><div class="v ${extra}">${v}${sub?`<small> ${sub}</small>`:''}</div></div>`;
    body.innerHTML = `<div class="wx">
      <div class="wx-grid">
        ${cell('Air', fmtN(w.air_temperature), '°C')}
        ${cell('Track', fmtN(w.track_temperature), '°C')}
        ${cell('Humidity', fmtN(w.humidity), '%')}
        ${cell('Wind', fmtN(w.wind_speed), 'm/s ' + WIND_DIR(w.wind_direction))}
        ${cell('Pressure', fmtN(w.pressure), 'mbar')}
        ${cell('Rain', rain>0?'Yes':'Dry', '', rain>0?'rain-on':'')}
      </div>
      <div class="wx-chart"><div class="pane-head">Track temp · this session</div><div class="wx-canvas"><canvas id="wxChart"></canvas></div></div>
    </div>`;
    const pts = list.map(s => ({ x: oslo(s.date), y: num(s.track_temperature) })).filter(p => p.y!=null);
    if (pts.length > 1) drawWeatherChart(pts); else destroyChart('wx');
  } catch (e) {
    logError('weather', e);
    destroyChart('wx');
    body.innerHTML = stateBox('Unavailable', 'Weather data unavailable — retrying on next refresh.', 'error');
  }
}
function fmtN(x){ const n = num(x); return n==null ? '—' : (Math.round(n*10)/10).toString(); }
function drawWeatherChart(pts){
  if (!window.Chart) return;
  destroyChart('wx');
  const ctx = $('wxChart'); if (!ctx) return;
  state.charts.wx = new Chart(ctx, {
    type:'line',
    data:{ labels: pts.map(p=>p.x), datasets:[{
      data: pts.map(p=>p.y), borderColor:'#B4471F', backgroundColor:'rgba(180,71,31,0.14)',
      borderWidth:2, pointRadius:0, tension:0.3, fill:true,
    }]},
    options: chartBase({ yTitle:'°C', sparseX:true })
  });
}

/* ---------- Chart.js shared theme ---------- */
function chartBase(opts){
  opts = opts || {};
  const grid = '#C9C0AE', tick = '#8C8475';
  return {
    indexAxis: opts.indexAxis || 'x',
    responsive:true, maintainAspectRatio:false,
    animation: REDUCED ? false : { duration: 300 },
    plugins:{ legend:{ display:false },
      tooltip:{ backgroundColor:'#F7F3EA', borderColor:'#211D17', borderWidth:1, titleColor:'#211D17', bodyColor:'#5C554A', bodyFont:{family:"'IBM Plex Mono',monospace"} } },
    scales:{
      x:{ grid:{ color: opts.indexAxis==='y'?grid:'transparent', drawBorder:false },
          ticks:{ color:tick, font:{family:"'IBM Plex Mono',monospace",size:10},
                  precision: opts.integerX?0:undefined,
                  maxRotation:0, autoSkip:true, maxTicksLimit: opts.sparseX?6:12 },
          title: opts.xTitle?{display:true,text:opts.xTitle,color:tick,font:{size:10}}:{display:false} },
      y:{ grid:{ color: opts.indexAxis==='y'?'transparent':grid, drawBorder:false },
          ticks:{ color:tick, font:{family:"'IBM Plex Mono',monospace",size:10} },
          title: opts.yTitle?{display:true,text:opts.yTitle,color:tick,font:{size:10}}:{display:false} }
    }
  };
}
function destroyChart(key){ if (state.charts[key]){ try{ state.charts[key].destroy(); }catch{} state.charts[key]=null; } }

/* ============================================================
   PREVIOUS SESSION (spoiler-gated final classification + summary)
   ============================================================ */
const prevState = { loaded:false, revealed:false, sessionKey:null };
function showPrevSection(session){
  const sec = $('sec-prev');
  if (!session){ sec.style.display = 'none'; return; }
  sec.style.display = '';
  if (prevState.sessionKey !== session.session_key){
    // a different session than last time — reset the spoiler gate
    prevState.sessionKey = session.session_key;
    prevState.loaded = false;
    prevState.revealed = false;
    $('prevBody').style.display = 'none';
    $('prevBody').innerHTML = '';
    $('prevToggleBox').style.display = '';
    $('prevToggleBtn').style.display = '';
    $('prevToggleBtn').textContent = 'Reveal results';
  }
  const where = [session.circuit_short_name || session.location, session.session_name].filter(Boolean).join(' · ');
  $('prevNote').textContent = where;
  $('prevMsg').textContent = `Results from the previous session (${where}) are hidden.`;
}
async function loadPrevious(session){
  const body = $('prevBody');
  body.innerHTML = stateBox('Loading', 'Fetching previous session results…');
  try {
    const key = session.session_key;
    const [pos, drivers, rc] = await Promise.all([
      getJSON(OPENF1 + 'position?session_key=' + key),
      getJSON(OPENF1 + 'drivers?session_key=' + key),
      getJSON(OPENF1 + 'race_control?session_key=' + key),
    ]);
    const dmap = {};
    (Array.isArray(drivers)?drivers:[]).forEach(d => {
      const n = num(d.driver_number); if (n==null) return;
      dmap[n] = {
        acr: d.name_acronym || ('#'+n),
        name: d.full_name || d.broadcast_name || ('#'+n),
        team: d.team_name || '',
        colour: d.team_colour ? ('#'+String(d.team_colour).replace('#','')) : null,
      };
    });
    const latest = {};
    (Array.isArray(pos)?pos:[]).forEach(p => {
      const n = num(p.driver_number); if (n==null) return;
      const cur = latest[n];
      if (!cur || new Date(p.date) > new Date(cur.date)) latest[n] = p;
    });
    const rows = Object.values(latest).filter(p => p.position != null)
      .sort((a,b) => a.position - b.position);
    if (!rows.length){ body.innerHTML = stateBox('No data', 'Final classification unavailable for this session.'); return; }

    let summary = '';
    if (/race/i.test(session.session_name||'')){
      const w = dmap[rows[0]?.driver_number] || {};
      const p2 = dmap[rows[1]?.driver_number] || {};
      const p3 = dmap[rows[2]?.driver_number] || {};
      const rcArr = Array.isArray(rc) ? rc : [];
      const red = rcArr.some(m => /red flag/i.test(m.message||''));
      const sc = rcArr.some(m => /safety car/i.test(m.message||'') && !/virtual/i.test(m.message||''));
      const vsc = rcArr.some(m => /virtual safety/i.test(m.message||''));
      let extra = '';
      if (red) extra = ' The race was interrupted by a red flag.';
      else if (sc) extra = ' A safety car was deployed during the race.';
      else if (vsc) extra = ' A virtual safety car was deployed during the race.';
      summary = `<p class="lede prev-summary">${esc(w.name||'—')} won the ${esc(session.session_name||'race')} at ${esc(session.circuit_short_name || session.location || '')}, ahead of ${esc(p2.name||'—')} in second and ${esc(p3.name||'—')} in third.${extra}</p>`;
    }

    const tbl = `<table class="tbl">
      <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col">Team</th></tr></thead>
      <tbody>${rows.map(p => {
        const d = dmap[p.driver_number] || drv(p.driver_number);
        return `<tr style="--team:${d.colour||'var(--ink-4)'}">
          <td class="pos">${esc(p.position)}</td>
          <td class="accent-cell"><span class="code">${esc(d.acr)}</span> <span class="muted">${esc(d.name)}</span></td>
          <td class="muted">${esc(d.team)}</td>
        </tr>`;
      }).join('')}</tbody></table>`;

    body.innerHTML = summary + tbl;
  } catch (e) {
    logError('previous session', e);
    body.innerHTML = stateBox('Unavailable', 'Could not load previous session results — tap reveal to retry.', 'error');
    prevState.loaded = false;
  }
}
$('prevToggleBtn').addEventListener('click', async () => {
  $('prevToggleBox').style.display = 'none';
  $('prevToggleBtn').style.display = 'none';
  $('prevBody').style.display = '';
  if (!prevState.loaded){
    prevState.loaded = true;
    await loadPrevious(state.session);
  }
});

/* ============================================================
   SCHEDULE (Jolpica) — next-race countdown + live-lock cross-check
   ============================================================ */
/* Session durations aren't in the Ergast/Jolpica feed, so we estimate generous
   windows. These only gate the "is a session live right now?" check used when
   OpenF1 is unreachable — overshooting is safe (we re-trust OpenF1 the moment
   it answers again), undershooting is the bug we're fixing, so we err long. */
const SESSION_EST_MS = {
  race: 3.5 * 3600e3, sprint: 1.5 * 3600e3, sprintQualifying: 1.5 * 3600e3,
  qualifying: 2 * 3600e3, practice: 2 * 3600e3,
};
const SCHEDULE_FRESH_MS = 60 * 1000;        // don't re-hit volunteer-run Jolpica more than once a minute
async function loadSchedule(force){
  // Jolpica is rate-limited; skip the round-trip if we loaded recently
  if (!force && state.schedule.length && state.scheduleLoadedAt && (Date.now() - state.scheduleLoadedAt) < SCHEDULE_FRESH_MS) return;
  try {
    const data = await getJSON(JOLPI + 'current.json');
    const races = data?.MRData?.RaceTable?.Races || [];
    const sessions = [];
    const add = (gp, label, slot, kind) => {
      if (!slot || !slot.date) return;
      const start = Date.parse(`${slot.date}T${slot.time || '00:00:00Z'}`);
      if (!Number.isFinite(start)) return;
      sessions.push({ name: `${gp} · ${label}`, start, end: start + (SESSION_EST_MS[kind] || 2 * 3600e3) });
    };
    races.forEach(r => {
      const gp = r.raceName || 'Grand Prix';
      add(gp, 'Practice 1', r.FirstPractice, 'practice');
      add(gp, 'Practice 2', r.SecondPractice, 'practice');
      add(gp, 'Practice 3', r.ThirdPractice, 'practice');
      add(gp, 'Sprint Qualifying', r.SprintQualifying || r.SprintShootout, 'sprintQualifying');
      add(gp, 'Sprint', r.Sprint, 'sprint');
      add(gp, 'Qualifying', r.Qualifying, 'qualifying');
      add(gp, 'Race', { date: r.date, time: r.time }, 'race');
    });
    state.schedule = sessions;
    state.scheduleLoadedAt = Date.now();

    // next upcoming race for the idle countdown
    const now = Date.now();
    const upcoming = races
      .map(r => ({ r, t: Date.parse(`${r.date}T${r.time || '00:00:00Z'}`) }))
      .filter(x => Number.isFinite(x.t) && x.t > now)
      .sort((a,b)=> a.t - b.t);
    state.nextRace = upcoming.length ? upcoming[0] : null;
  } catch (e) { logError('schedule', e); }
}
/* whichever scheduled session contains `now`, if any — used to recognise OpenF1's
   live lock (or any OpenF1 outage during a session) without OpenF1 itself */
function scheduledLiveSession(now = Date.now()){
  return state.schedule.find(s => now >= s.start && now <= s.end) || null;
}
function showCountdown(){
  const box = $('countdown');
  const nr = state.nextRace;
  if (!nr){ box.classList.remove('show'); return; }
  box.classList.add('show');
  $('cdRace').textContent = nr.r.raceName || 'Next Grand Prix';
  $('cdCircuit').textContent = nr.r.Circuit?.circuitName || nr.r.Circuit?.Location?.locality || '';
  $('cdWhen').textContent = osloFull(nr.t) + ' · Oslo time';
  tickCountdown();
  if (state.cdTimer) clearInterval(state.cdTimer);
  state.cdTimer = setInterval(tickCountdown, 1000);
}
function tickCountdown(){
  const nr = state.nextRace; if (!nr) return;
  let diff = Math.max(0, nr.t - Date.now());
  const d = Math.floor(diff/86400000); diff -= d*86400000;
  const h = Math.floor(diff/3600000); diff -= h*3600000;
  const m = Math.floor(diff/60000); diff -= m*60000;
  const s = Math.floor(diff/1000);
  const p = (x)=> String(x).padStart(2,'0');
  $('cdD').textContent = p(d); $('cdH').textContent = p(h); $('cdM').textContent = p(m); $('cdS').textContent = p(s);
}
function hideCountdown(){ $('countdown').classList.remove('show'); if (state.cdTimer){ clearInterval(state.cdTimer); state.cdTimer=null; } }
function showLocked(){
  const ls = state.lockedSession;
  // name the live session in the notice when we know it from the schedule
  if (ls){ const h = $('lockedNotice').querySelector('.cd-race'); if (h) h.textContent = ls.name + ' is live right now.'; }
  $('lockedNotice').classList.add('show');
}
function hideLocked(){ $('lockedNotice').classList.remove('show'); }

/* the five live-only sections — shown only while a session is live */
const LIVE_SECTIONS = ['sec-rc','sec-pit','sec-ot','sec-stints','sec-wx'];
function showLiveSections(show){
  LIVE_SECTIONS.forEach(id => { const n = $(id); if (n) n.style.display = show ? '' : 'none'; });
  if (!show){ destroyChart('ot'); destroyChart('wx'); }
}

/* ============================================================
   POLLING / ORCHESTRATION
   ============================================================ */
function stopPolling(){
  if (state.pollTimer){ clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.standingsTimer){ clearInterval(state.standingsTimer); state.standingsTimer = null; }
}

async function pollLive(){
  // sections fail independently; one rejection must not blank the others
  await Promise.allSettled([
    renderRaceControl(), renderPit(), renderOvertakes(), renderStints(), renderWeather(),
  ]);
  setUpdated();
}

async function cycle(){
  stopPolling();
  let mode;
  state.detectError = false;
  state.lockedSession = null;
  let detectFailed = false;
  try { mode = await detect(); }
  catch (e) {
    logError('session detect', e);
    detectFailed = true;
    // OpenF1 returned a readable 403 → its live lock. The browser often can't
    // read that 403 cross-origin though, surfacing it as an opaque network
    // error instead — so a failure here doesn't yet tell IDLE from LOCKED.
    mode = (e && e.liveLocked) ? 'LOCKED' : 'IDLE';
  }
  // When OpenF1 is unreachable we can't see sessions at all, and the most common
  // reason during a race weekend is OpenF1's live lock. Cross-check the public
  // Jolpica schedule: if a session is scheduled to be running now, treat it as
  // the lock and show the LOCKED notice — never fall through to a countdown that
  // would point at *next* week's race mid-session. We only do this when OpenF1
  // actually failed, so once the lock lifts and OpenF1 answers we trust it again.
  if (detectFailed){
    await loadSchedule();
    const liveNow = scheduledLiveSession();
    if (liveNow){ mode = 'LOCKED'; state.lockedSession = liveNow; state.detectError = false; }
    else if (mode === 'LOCKED'){ /* trust OpenF1's explicit 403 lock even with no schedule match */ }
    else { mode = 'IDLE'; state.detectError = true; }
  }
  state.mode = mode;
  renderStatusBar();

  if (mode === 'LIVE'){
    hideCountdown();
    hideLocked();
    showLiveSections(true);
    await loadDrivers();
    setFlag([]);                 // reset, race control will set it
    await pollLive();
    // slow down once the session has finished and we're just riding out the grace window
    state.pollTimer = setInterval(pollLive, state.ended ? POLL_ENDED_MS : POLL_MS);
    // standings can shift after a race (penalties, etc.) — re-check occasionally while live
    state.standingsTimer = setInterval(loadStandings, STANDINGS_POLL_MS);
  } else if (mode === 'LOCKED'){
    setFlag([]);
    showLiveSections(false);     // hide live-only sections — OpenF1 won't serve them right now
    hideCountdown();
    showLocked();
    setUpdated();
    state.pollTimer = setInterval(cycle, POLL_MS * 4); // re-check until the lock lifts
  } else {
    setFlag([]);
    showLiveSections(false);     // hide live-only sections entirely when nothing is live
    hideLocked();
    showPrevSection(state.session);
    await loadSchedule();
    showCountdown();
    setUpdated();
  }

  if (mode !== 'IDLE') $('sec-prev').style.display = 'none';
}

async function refresh(btn){
  if (btn && !REDUCED){ btn.classList.add('spin'); setTimeout(()=> btn.classList.remove('spin'), 600); }
  await Promise.allSettled([ loadStandings(), cycle() ]);
}

/* ---------- boot ---------- */
$('refreshBtn').addEventListener('click', () => refresh($('refreshBtn')));
loadStandings();
cycle();

// pause polling when tab hidden; resume (and re-detect) when visible — courteous to APIs
document.addEventListener('visibilitychange', () => {
  if (document.hidden){ stopPolling(); }
  else if (state.mode === 'LIVE' || state.mode === 'LOCKED'){ cycle(); }
});
