import * as THREE from 'three';

/* ============================================================
   Perfect Stop — an F1 pit-stop puzzle.

   You schedule a pit stop under real constraints: a specialised
   crew (each mechanic can only do certain jobs and reach certain
   corners), a limited number of air-lines (only N wheel-guns can
   run at once), and procedural complications. Beat the target to
   keep the position; miss the gap to the chasing car and you lose
   it. Single ES module; three.js (vendored locally) is the only
   dependency. Everything runs in-browser; nothing is uploaded.
   ============================================================ */

/* ---------- constants ---------- */
const UNIT_MS = 360;          // ms of animation per scheduling unit
const SEC_PER_UNIT = 0.45;    // flavour: turn abstract units into "seconds"
const STORE_KEY = 'perfectstop.v2';

const COLORS = { jack: '#5C554A', go: '#C0392B', wing: '#7A5BB0' };

// Puzzle locations: four corners (with end + tyre-compound colour) plus the
// jack ends and the nose (for the front wing).
const LOC = {
  FL: { label: 'Front-left',  end: 'front', hex: '#B4471F' },
  FR: { label: 'Front-right', end: 'front', hex: '#B07A12' },
  RL: { label: 'Rear-left',   end: 'rear',  hex: '#2E5FA3' },
  RR: { label: 'Rear-right',  end: 'rear',  hex: '#2E6F4F' },
  front: { label: 'Front' }, rear: { label: 'Rear' }, nose: { label: 'Nose' },
};
const CORNER_IDS = ['FL', 'FR', 'RL', 'RR'];

// 3D wheel anchor positions (separate from the puzzle's LOC table).
const CORNERS = [
  { id: 'FL', fx: 1.6, fz: 1.0 }, { id: 'FR', fx: 1.6, fz: -1.0 },
  { id: 'RL', fx: -1.6, fz: 1.0 }, { id: 'RR', fx: -1.6, fz: -1.0 },
];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (u) => (u * SEC_PER_UNIT).toFixed(1) + 's';
const isGunType = (t) => t === 'off' || t === 'on';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ============================================================
   Jobs + crew + level generation
   ============================================================ */
function buildJobs(cfg) {
  const D = { jackUp: 1, off: 2, on: 2, jackDown: 1, release: 1, wing: 2, swap: 1 };
  const jobs = [];
  const add = (o) => jobs.push(Object.assign({ prereqs: [] }, o));

  add({ id: 'jack_front_up', label: 'Front jack up', short: 'Jack F ↑', type: 'jack', loc: 'front', color: COLORS.jack, duration: D.jackUp });
  add({ id: 'jack_rear_up',  label: 'Rear jack up',  short: 'Jack R ↑', type: 'jack', loc: 'rear',  color: COLORS.jack, duration: D.jackUp });
  if (cfg.wing) add({ id: 'wing', label: 'Front-wing change', short: 'Wing', type: 'wing', loc: 'nose', color: COLORS.wing, duration: D.wing, prereqs: ['jack_front_up'] });

  cfg.corners.forEach(C => {
    const c = LOC[C];
    const up = c.end === 'front' ? 'jack_front_up' : 'jack_rear_up';
    const offDur = D.off + (cfg.sticky[C] || 0);
    add({ id: 'off_' + C, label: c.label + ' tyre off', short: C + ' off', type: 'off', loc: C, color: c.hex, duration: offDur, prereqs: [up] });
    const onPre = ['off_' + C];
    if (cfg.wrong.has(C)) { add({ id: 'swap_' + C, label: c.label + ' fetch right tyre', short: C + ' swap', type: 'on', loc: C, color: c.hex, duration: D.swap }); onPre.push('swap_' + C); }
    add({ id: 'on_' + C, label: c.label + ' tyre on', short: C + ' on', type: 'on', loc: C, color: c.hex, duration: D.on, prereqs: onPre });
  });

  const downPre = (end) => cfg.corners.filter(C => LOC[C].end === end).map(C => 'on_' + C);
  add({ id: 'jack_front_down', label: 'Front jack down', short: 'Jack F ↓', type: 'jack', loc: 'front', color: COLORS.jack, duration: D.jackDown, prereqs: downPre('front') });
  add({ id: 'jack_rear_down',  label: 'Rear jack down',  short: 'Jack R ↓', type: 'jack', loc: 'rear',  color: COLORS.jack, duration: D.jackDown, prereqs: downPre('rear') });
  const relPre = ['jack_front_down', 'jack_rear_down']; if (cfg.wing) relPre.push('wing');
  add({ id: 'release', label: 'Release the car', short: 'GO', type: 'release', loc: 'front', color: COLORS.go, duration: D.release, prereqs: relPre });
  return jobs;
}

function canDo(crew, job) {
  if (job.type === 'release') return true;     // anyone can drop the lollipop
  return crew.can.has(job.type) && crew.locs.has(job.loc);
}

function buildCrew(diff, cfg) {
  const crew = [];
  const add = (label, can, locs) => crew.push({ label, can: new Set(can), locs: new Set(locs) });
  const ALL = ['FL', 'FR', 'RL', 'RR', 'front', 'rear', 'nose'];

  if (diff.spec <= 1) {
    const n = diff.crewN || 4;
    for (let i = 0; i < n; i++) add('Crew ' + (i + 1), ['jack', 'off', 'on', 'wing'], ALL);
  } else if (diff.spec === 2) {
    add('Jack crew', ['jack'], ['front', 'rear']);
    add('Wheels · left', ['off', 'on'], ['FL', 'RL']);
    add('Wheels · right', ['off', 'on'], cfg.wing ? ['FR', 'RR', 'nose'] : ['FR', 'RR']);
    if (cfg.wing) crew[crew.length - 1].can.add('wing');
    add('Wheels · roamer', ['off', 'on'], ['FL', 'FR', 'RL', 'RR']);
  } else {
    add('Jack · front', ['jack'], ['front']);
    add('Jack · rear', ['jack'], ['rear']);
    add('Gun off · L', ['off'], ['FL', 'RL']);
    add('Gun off · R', ['off'], ['FR', 'RR']);
    add('Gun on · L', ['on'], ['FL', 'RL']);
    add('Gun on · R', ['on'], cfg.wing ? ['FR', 'RR', 'nose'] : ['FR', 'RR']);
    if (cfg.wing) crew[crew.length - 1].can.add('wing');
  }

  // Guarantee feasibility: every required (type, loc) must be coverable.
  const need = [['jack', 'front'], ['jack', 'rear']];
  cfg.corners.forEach(C => { need.push(['off', C]); need.push(['on', C]); });
  if (cfg.wing) need.push(['wing', 'nose']);
  const covered = (t, l) => crew.some(c => c.can.has(t) && c.locs.has(l));
  if (need.some(([t, l]) => !covered(t, l))) {
    crew.push({ label: 'Spare', can: new Set(['jack', 'off', 'on', 'wing']), locs: new Set(ALL) });
  }
  return crew;
}

function makeTips(lvl) {
  const t = [];
  if (lvl.guns < 4) t.push(`Only ${lvl.guns} air-lines — no more than ${lvl.guns} wheel-guns can run at the same time, so don't queue every tyre at once.`);
  if (lvl._spec >= 3) t.push('Crews are fully split: "off" and "on" are different people and left/right never cross. Match each job to who can reach it.');
  else if (lvl._spec === 2) t.push('Your jack operators can’t touch the wheels, and the left/right wheel crews are separate — the roamer is your flex.');
  if (lvl._kinds.includes('wing')) t.push('A front-wing change is needed and it must finish before the car can be released — get it started under the front jack.');
  if (lvl._kinds.includes('sticky')) t.push('A sticky nut makes one corner’s tyre-off longer — put it on the critical path early.');
  if (lvl._kinds.includes('wrong')) t.push('Wrong compound was delivered to a corner — someone must fetch the right tyre before it can go on.');
  t.push(`Hit ${fmt(lvl._par)} for a perfect stop. Past ${fmt(lvl._limit)} and the chasing car gets by — you lose the position.`);
  return t;
}

function genLevel(seedKey, diff, name, kind) {
  const rnd = mulberry32(hashStr('ps|' + seedKey));
  const cfg = { corners: CORNER_IDS.slice(), sticky: {}, wrong: new Set(), wing: false };
  let comps = diff.comp || 0;
  const kinds = [];
  if (comps > 0 && rnd() < 0.5) { cfg.wing = true; kinds.push('wing'); comps--; }
  let guard = 0;
  const pool = CORNER_IDS.slice();
  while (comps > 0 && guard++ < 12) {
    const C = pool[Math.floor(rnd() * pool.length)];
    if (rnd() < 0.6) { if (!cfg.sticky[C]) { cfg.sticky[C] = diff.spec >= 3 ? 2 : 1; kinds.push('sticky'); comps--; } }
    else { if (!cfg.wrong.has(C)) { cfg.wrong.add(C); kinds.push('wrong'); comps--; } }
  }

  const lvl = { name, kind, guns: diff.guns, _spec: diff.spec, _kinds: kinds, _cfg: cfg };
  lvl.jobs = buildJobs(cfg);
  lvl._byId = Object.fromEntries(lvl.jobs.map(j => [j.id, j]));
  lvl.crew = buildCrew(diff, cfg);

  let sol = autoSolve(lvl);
  if (!sol.feasible) { lvl.crew.push({ label: 'Spare', can: new Set(['jack', 'off', 'on', 'wing']), locs: new Set(['FL', 'FR', 'RL', 'RR', 'front', 'rear', 'nose']) }); sol = autoSolve(lvl); }
  lvl._sol = sol.lanes;
  lvl._par = schedule(sol.lanes, lvl).total ?? sol.time;
  lvl._limit = lvl._par + Math.max(1, diff.slack);
  lvl.tips = makeTips(lvl);
  return lvl;
}

function careerDiff(i) {
  const tiers = [
    { spec: 1, guns: 4, comp: 0, slack: 3, crewN: 4 },
    { spec: 1, guns: 3, comp: 0, slack: 3, crewN: 4 },
    { spec: 2, guns: 3, comp: 0, slack: 2 },
    { spec: 2, guns: 3, comp: 1, slack: 2 },
    { spec: 2, guns: 2, comp: 1, slack: 2 },
    { spec: 3, guns: 3, comp: 1, slack: 1 },
    { spec: 3, guns: 2, comp: 2, slack: 1 },
    { spec: 3, guns: 2, comp: 3, slack: 1 },
  ];
  return tiers[Math.min(i, tiers.length - 1)];
}
function endlessDiff(n) {
  return { spec: n < 2 ? 2 : 3, guns: n < 1 ? 3 : 2, comp: Math.min(3, 1 + Math.floor(n / 2)), slack: 1 };
}
function buildLevels() {
  const L = [];
  L.push(genLevel('tut1', { spec: 1, guns: 4, comp: 0, slack: 4, crewN: 4 }, 'Tutorial · Basics', 'tutorial'));
  L.push(genLevel('tut2', { spec: 1, guns: 2, comp: 0, slack: 3, crewN: 4 }, 'Tutorial · Air-lines', 'tutorial'));
  L.push(genLevel('tut3', { spec: 2, guns: 3, comp: 0, slack: 3 }, 'Tutorial · Crew roles', 'tutorial'));
  for (let i = 0; i < 8; i++) L.push(genLevel('career-' + i, careerDiff(i), 'Stage ' + (i + 1), 'career'));
  return L;
}

/* ============================================================
   Scheduler — resource-constrained (air-line / gun cap)
   ============================================================ */
function schedule(lanesArg, lvl) {
  const byId = lvl._byId, gunCap = lvl.guns || 99;
  const start = {}, finish = {}, started = {};
  const placed = new Set(); lanesArg.forEach(l => l.forEach(id => placed.add(id)));
  const ptr = lanesArg.map(() => 0), laneFree = lanesArg.map(() => 0);
  const gunsAt = (t) => { let c = 0; for (const id in started) { if (isGunType(byId[id].type) && start[id] <= t && finish[id] > t) c++; } return c; };

  let remaining = lanesArg.reduce((s, l) => s + l.length, 0), t = 0, guard = 0;
  while (remaining > 0 && guard++ < 20000) {
    let any = true;
    while (any) {
      any = false;
      for (let L = 0; L < lanesArg.length; L++) {
        if (ptr[L] >= lanesArg[L].length) continue;
        const id = lanesArg[L][ptr[L]];
        if (started[id]) continue;
        if (laneFree[L] > t) continue;
        const j = byId[id];
        if (!j.prereqs.every(p => placed.has(p) && finish[p] != null && finish[p] <= t)) continue;
        if (isGunType(j.type) && gunsAt(t) >= gunCap) continue;
        started[id] = true; start[id] = t; finish[id] = t + j.duration; laneFree[L] = finish[id]; ptr[L]++; remaining--; any = true;
      }
    }
    let nextT = Infinity;
    for (const id in finish) if (finish[id] > t) nextT = Math.min(nextT, finish[id]);
    if (nextT === Infinity) break;     // nothing left running -> stuck (unplaced prereqs)
    t = nextT;
  }
  lanesArg.forEach(l => l.forEach(id => { if (!started[id]) { start[id] = Infinity; finish[id] = Infinity; } }));
  const allPlaced = lvl.jobs.every(j => placed.has(j.id));
  const total = (allPlaced && isFinite(finish.release)) ? finish.release : null;
  return { start, finish, total, allPlaced, placed };
}
function computeSchedule() { return schedule(lanes, level); }

function autoSolve(lvl) {
  const jobs = lvl.jobs, byId = lvl._byId, gunCap = lvl.guns || 99;
  const succ = {}; jobs.forEach(j => succ[j.id] = []);
  jobs.forEach(j => j.prereqs.forEach(p => { if (succ[p]) succ[p].push(j.id); }));
  const cp = {}; const calc = (id) => { if (cp[id] != null) return cp[id]; cp[id] = 0; let m = 0; for (const s of succ[id]) m = Math.max(m, calc(s)); return cp[id] = byId[id].duration + m; };
  jobs.forEach(j => calc(j.id));

  const nl = lvl.crew.length;
  const laneFree = Array(nl).fill(0), seq = Array.from({ length: nl }, () => []);
  const finish = {}, done = new Set(), gunIv = [];
  const earliestGun = (base, dur) => {
    const cands = [base, ...gunIv.map(iv => iv.f).filter(f => f >= base)].sort((a, b) => a - b);
    for (const c of cands) {
      const pts = [c, ...gunIv.map(iv => iv.s).filter(s => s > c && s < c + dur)];
      if (pts.every(p => gunIv.filter(iv => iv.s <= p && iv.f > p).length < gunCap)) return c;
    }
    return cands[cands.length - 1];
  };
  let guard = 0;
  while (done.size < jobs.length && guard++ < 9999) {
    const ready = jobs.filter(j => !done.has(j.id) && j.prereqs.every(p => done.has(p)));
    if (!ready.length) break;
    ready.sort((a, b) => (cp[b.id] - cp[a.id]) || (b.duration - a.duration));
    const j = ready[0];
    const pf = j.prereqs.length ? Math.max(...j.prereqs.map(p => finish[p])) : 0;
    const allowed = lvl.crew.map((c, i) => canDo(c, j) ? i : -1).filter(i => i >= 0);
    if (!allowed.length) return { lanes: seq, time: Infinity, feasible: false };
    let best = allowed[0], bestStart = Infinity;
    for (const L of allowed) {
      let s = Math.max(laneFree[L], pf);
      if (isGunType(j.type)) s = Math.max(s, earliestGun(Math.max(laneFree[L], pf), j.duration));
      if (s < bestStart || (s === bestStart && laneFree[L] < laneFree[best])) { best = L; bestStart = s; }
    }
    let s = Math.max(laneFree[best], pf);
    if (isGunType(j.type)) s = earliestGun(s, j.duration);
    finish[j.id] = s + j.duration; laneFree[best] = finish[j.id];
    if (isGunType(j.type)) gunIv.push({ s, f: finish[j.id] });
    seq[best].push(j.id); done.add(j.id);
  }
  return { lanes: seq, time: done.size < jobs.length ? Infinity : Math.max(0, ...Object.values(finish)), feasible: done.size === jobs.length };
}

function starsFor(total, par) {
  if (total == null) return 0;
  if (total <= par) return 3;
  if (total <= par + Math.max(1, Math.round(par * 0.1))) return 2;
  return 1;
}

/* ============================================================
   State + progress
   ============================================================ */
let level, jobById, lanes, selected = null, mode = 'level', levelIndex = 0, running = false;
let LEVELS, dailyKey, dailyLevel, endlessN = 0, endlessLevel;
let progress = loadProgress();

function loadProgress() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
function saveProgress() { try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ } }

function loadLevel(lvl) {
  level = lvl; jobById = lvl._byId;
  lanes = Array.from({ length: lvl.crew.length }, () => []);
  selected = null;
  resetScene();
  renderAll();
}
function goLevel(i) {
  mode = 'level'; levelIndex = (i + LEVELS.length) % LEVELS.length;
  $('dailyBtn').setAttribute('aria-pressed', 'false');
  $('endlessBtn').setAttribute('aria-pressed', 'false');
  loadLevel(LEVELS[levelIndex]);
}
function goDaily() {
  mode = 'daily';
  $('dailyBtn').setAttribute('aria-pressed', 'true');
  $('endlessBtn').setAttribute('aria-pressed', 'false');
  loadLevel(dailyLevel);
}
function goEndless(reset) {
  mode = 'endless';
  if (reset) endlessN = 0;
  endlessLevel = genLevel('endless-' + endlessN + '-' + Date.now(), endlessDiff(endlessN), 'Endless · run ' + (endlessN + 1), 'endless');
  $('dailyBtn').setAttribute('aria-pressed', 'false');
  $('endlessBtn').setAttribute('aria-pressed', 'true');
  loadLevel(endlessLevel);
}

/* ============================================================
   Rendering
   ============================================================ */
function scaleMax() { const s = computeSchedule(); return Math.max(level._limit, s.total || 0, 5) + 1; }

function renderAll() { renderHud(); renderTray(); renderLanes(); renderTimeaxis(); renderSchedule(); renderBarActions(); renderTips(); }

function renderHud() {
  const s = computeSchedule();
  $('hudMode').textContent = level.name;
  $('hudPar').textContent = fmt(level._par);
  $('hudLimit').textContent = fmt(level._limit);
  const over = s.total != null && s.total > level._limit;
  $('hudTime').textContent = s.total != null ? `Planned ${fmt(s.total)}` : 'Planned —';
  $('hudTime').classList.toggle('over', over);
  const st = (s.total != null && !over) ? starsFor(s.total, level._par) : 0;
  $('hudStars').textContent = '★'.repeat(st) + '☆'.repeat(3 - st);
  $('runBtn').disabled = running || !s.allPlaced;
}

function typeTag(j) {
  if (j.id.startsWith('swap_')) return 'SWAP';
  return ({ off: 'OFF', on: 'ON', jack: 'JACK', wing: 'WING', release: 'GO' })[j.type] || j.type.toUpperCase();
}
function chipEl(j) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip' + (selected === j.id ? ' selected' : ''); b.dataset.id = j.id;
  b.setAttribute('draggable', 'true');
  b.setAttribute('aria-label', `${j.label}, ${typeTag(j)}, takes ${fmt(j.duration)}. Select, then add to a crew member who can do it.`);
  b.innerHTML = `<span class="dot" style="background:${j.color || '#888'}"></span><span class="ctag">${typeTag(j)}</span><span>${j.label}</span><span class="dur">${fmt(j.duration)}</span>`;
  b.addEventListener('click', () => { selected = (selected === j.id) ? null : j.id; renderAll(); });
  b.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ id: j.id, from: 'tray' })));
  return b;
}
function renderTray() {
  const tray = $('tray'); tray.innerHTML = '';
  const placed = new Set(); lanes.forEach(l => l.forEach(id => placed.add(id)));
  const unplaced = level.jobs.filter(j => !placed.has(j.id));
  unplaced.forEach(j => tray.appendChild(chipEl(j)));
  $('trayEmpty').classList.toggle('show', unplaced.length === 0);
}

function capCaption(crew) {
  const types = [...crew.can].filter(c => c !== 'release').map(t => ({ jack: 'jacks', off: 'off', on: 'on', wing: 'wing' }[t] || t)).join('/');
  const corners = [...crew.locs].filter(l => CORNER_IDS.includes(l));
  const ends = [...crew.locs].filter(l => l === 'front' || l === 'rear');
  let reach = corners.length === 4 ? 'all corners' : corners.join(' ');
  if (crew.can.has('jack') && ends.length) reach = ends.join('/');
  return `${types}${reach ? ' · ' + reach : ''}`;
}
function renderLanes() {
  const sched = computeSchedule(), sm = scaleMax(), wrap = $('lanes');
  wrap.innerHTML = '';
  const selJob = selected ? jobById[selected] : null;
  lanes.forEach((laneArr, li) => {
    const crew = level.crew[li];
    const row = document.createElement('div'); row.className = 'lane';
    const lbl = document.createElement('div'); lbl.className = 'lane-label';
    lbl.innerHTML = `<span class="lane-name">${crew.label}</span><span class="lane-cap">${capCaption(crew)}</span>`;
    const canAdd = selJob && canDo(crew, selJob);
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'lane-add'; addBtn.textContent = 'Add here'; addBtn.disabled = !canAdd;
    addBtn.setAttribute('aria-label', `Add selected job to ${crew.label}`);
    addBtn.addEventListener('click', () => placeSelected(li));
    lbl.appendChild(addBtn); row.appendChild(lbl);

    const track = document.createElement('div');
    track.className = 'lane-track' + (selJob && !canDo(crew, selJob) ? ' forbidden' : '');
    track.dataset.lane = li;
    track.addEventListener('dragover', (e) => { e.preventDefault(); track.classList.add('drop-ok'); });
    track.addEventListener('dragleave', () => track.classList.remove('drop-ok'));
    track.addEventListener('drop', (e) => { e.preventDefault(); track.classList.remove('drop-ok'); try { dropOnLane(JSON.parse(e.dataTransfer.getData('text/plain')), li); } catch (err) { /* ignore */ } });
    track.addEventListener('click', (e) => { if (e.target === track && selected) placeSelected(li); });

    laneArr.forEach((id, pos) => {
      const j = jobById[id], s = sched.start[id], f = sched.finish[id], blocked = !isFinite(s);
      const bar = document.createElement('button');
      bar.type = 'button'; bar.className = 'bar' + (blocked ? ' blocked' : '') + (selected === id ? ' selected' : '');
      bar.dataset.id = id; bar.style.background = j.color;
      bar.style.left = (blocked ? 0 : clamp(s / sm * 100, 0, 99)) + '%';
      bar.style.width = clamp(j.duration / sm * 100, 5, 100) + '%';
      bar.setAttribute('draggable', 'true');
      bar.setAttribute('aria-label', `${j.label}, ${level.crew[li].label}, ${blocked ? 'waiting on a prerequisite' : fmt(s) + ' to ' + fmt(f)}. Arrow keys move it, Delete removes it.`);
      bar.innerHTML = `<span class="bar-name">${j.short}</span>`;
      bar.addEventListener('click', () => { selected = (selected === id) ? null : id; renderAll(); });
      bar.addEventListener('keydown', (e) => onBarKey(e, id));
      bar.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ id, from: 'lane' })));
      track.appendChild(bar);
    });
    row.appendChild(track); wrap.appendChild(row);
  });
}

function renderTimeaxis() {
  const sm = scaleMax(), ax = $('timeaxis'); ax.innerHTML = '';
  for (let u = 0; u <= sm; u++) { const t = document.createElement('div'); t.className = 'tick'; t.style.left = (u / sm * 100) + '%'; ax.appendChild(t); }
  const par = document.createElement('div'); par.className = 'parline'; par.style.left = (level._par / sm * 100) + '%';
  par.innerHTML = `<span>TARGET ${fmt(level._par)}</span>`; ax.appendChild(par);
  const lim = document.createElement('div'); lim.className = 'limitline'; lim.style.left = (level._limit / sm * 100) + '%';
  lim.innerHTML = `<span>GAP ${fmt(level._limit)}</span>`; ax.appendChild(lim);
}

function renderSchedule() {
  const sched = computeSchedule(), ol = $('scheduleText'); ol.innerHTML = '';
  const rows = [];
  lanes.forEach((laneArr, li) => laneArr.forEach(id => rows.push({ s: sched.start[id], f: sched.finish[id], li, label: jobById[id].label })));
  rows.sort((a, b) => (a.s - b.s) || (a.li - b.li));
  rows.forEach(r => { const el = document.createElement('li'); el.textContent = `${isFinite(r.s) ? fmt(r.s) + '–' + fmt(r.f) : 'blocked'} · ${level.crew[r.li].label} · ${r.label}`; ol.appendChild(el); });
  if (sched.total != null) { const el = document.createElement('li'); el.textContent = `Stop complete at ${fmt(sched.total)} (target ${fmt(level._par)}, gap ${fmt(level._limit)}).`; ol.appendChild(el); }
}

function renderTips() {
  const box = $('tips');
  if (box.hidden) return;
  box.innerHTML = '<h3 class="block-label">Race engineer</h3>' + level.tips.map(t => `<p>${t}</p>`).join('');
}

let barActionsEl = null;
function renderBarActions() {
  if (!barActionsEl) {
    barActionsEl = document.createElement('div'); barActionsEl.className = 'toolbar bar-actions';
    barActionsEl.setAttribute('role', 'toolbar'); barActionsEl.setAttribute('aria-label', 'Move the selected job');
    $('lanes').after(barActionsEl);
  }
  const j = selected ? jobById[selected] : null;
  const inLane = j && lanes.some(l => l.includes(selected));
  if (!j || !inLane) { barActionsEl.innerHTML = ''; barActionsEl.style.display = 'none'; return; }
  barActionsEl.style.display = 'flex'; barActionsEl.innerHTML = '';
  const note = document.createElement('span'); note.className = 'bar-actions-note'; note.textContent = `Move: ${j.label}`; barActionsEl.appendChild(note);
  const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.addEventListener('click', fn); barActionsEl.appendChild(b); };
  mk('◀ Earlier', () => moveOrder(selected, -1));
  mk('Later ▶', () => moveOrder(selected, +1));
  mk('▲ Crew up', () => moveLane(selected, -1));
  mk('Crew down ▼', () => moveLane(selected, +1));
  mk('Remove', () => removeJob(selected));
}

/* ============================================================
   Interaction
   ============================================================ */
function laneOf(id) { for (let i = 0; i < lanes.length; i++) if (lanes[i].includes(id)) return i; return -1; }
function removeFromLanes(id) { lanes.forEach(l => { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); }); }
function removeJob(id) { removeFromLanes(id); if (selected === id) selected = null; renderAll(); }

function placeSelected(li) {
  if (!selected) return;
  if (!canDo(level.crew[li], jobById[selected])) return;
  removeFromLanes(selected); lanes[li].push(selected); renderAll();
}
function dropOnLane(d, li) {
  if (!canDo(level.crew[li], jobById[d.id])) return;
  selected = d.id; removeFromLanes(d.id); lanes[li].push(d.id); renderAll();
}
function moveOrder(id, dir) {
  const li = laneOf(id); if (li < 0) return;
  const arr = lanes[li], i = arr.indexOf(id), ni = i + dir;
  if (ni < 0 || ni >= arr.length) return;
  arr.splice(i, 1); arr.splice(ni, 0, id); renderAll(); focusBar(id);
}
function moveLane(id, dir) {
  const li = laneOf(id); if (li < 0) return;
  const j = jobById[id]; let nl = li + dir;
  while (nl >= 0 && nl < lanes.length && !canDo(level.crew[nl], j)) nl += dir;
  if (nl < 0 || nl >= lanes.length) return;
  removeFromLanes(id); lanes[nl].push(id); renderAll(); focusBar(id);
}
function focusBar(id) { const b = document.querySelector(`.bar[data-id="${id}"]`); if (b) b.focus(); }
function onBarKey(e, id) {
  let h = true;
  if (e.key === 'ArrowLeft') moveOrder(id, -1);
  else if (e.key === 'ArrowRight') moveOrder(id, +1);
  else if (e.key === 'ArrowUp') moveLane(id, -1);
  else if (e.key === 'ArrowDown') moveLane(id, +1);
  else if (e.key === 'Delete' || e.key === 'Backspace') removeJob(id);
  else h = false;
  if (h) e.preventDefault();
}

/* ============================================================
   three.js scene
   ============================================================ */
let renderer, scene, camera, carGroup, wheelMeshes = {}, jackFront, jackRear, startLights = [];
let wheelBase = {}, sceneReady = false, driveX = 0;
const LIFT = 0.55, WHEEL_R = 0.42, GROUND = WHEEL_R;

function initScene() {
  const canvas = $('scene');
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { canvas.style.display = 'none'; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene(); scene.background = new THREE.Color('#EDE8DD');
  camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  camera.position.set(6.4, 4.2, 7.2); camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.HemisphereLight('#FBF6EC', '#CFC4AC', 0.9));
  const sun = new THREE.DirectionalLight('#FFE9CC', 1.15);
  sun.position.set(5, 9, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30; scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#E2DBCB', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const box = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.6), new THREE.MeshStandardMaterial({ color: '#D8CFBC', roughness: 1 }));
  box.rotation.x = -Math.PI / 2; box.position.y = 0.01; box.receiveShadow = true; scene.add(box);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 4.6), new THREE.MeshStandardMaterial({ color: '#F2ECDF' }));
  line.rotation.x = -Math.PI / 2; line.position.set(3.6, 0.02, 0); scene.add(line);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 0.4), new THREE.MeshStandardMaterial({ color: '#CDBF6A', roughness: 0.8 }));
  wall.position.set(-1, 2.5, -4.5); wall.receiveShadow = true; scene.add(wall);

  buildCar(); buildWheels(); buildJacks(); buildLights();
  window.addEventListener('resize', () => { resizeRenderer(); renderOnce(); });
  resizeRenderer(); sceneReady = true; renderOnce();
}
function mat(color, opts = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.1 }, opts)); }
function buildCar() {
  carGroup = new THREE.Group(); scene.add(carGroup);
  const bodyMat = mat('#B4471F', { roughness: 0.4 }), darkMat = mat('#211D17', { roughness: 0.6 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.25, 1.5), bodyMat); floor.position.y = 0.55; addMesh(floor);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.32, 0.7), bodyMat); nose.position.set(2.1, 0.6, 0); addMesh(nose);
  const sidepodL = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.5), bodyMat); sidepodL.position.set(-0.2, 0.7, 0.65); addMesh(sidepodL);
  const sidepodR = sidepodL.clone(); sidepodR.position.z = -0.65; addMesh(sidepodR);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.7), bodyMat); engine.position.set(-0.9, 0.78, 0); addMesh(engine);
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.7), darkMat); cockpit.position.set(0.7, 0.92, 0); addMesh(cockpit);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 16, Math.PI), darkMat); halo.position.set(0.7, 1.15, 0); halo.rotation.y = Math.PI / 2; addMesh(halo);
  const fWing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.8), darkMat); fWing.position.set(2.85, 0.36, 0); addMesh(fWing);
  const rWingPlate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.5), bodyMat); rWingPlate.position.set(-2.2, 1.0, 0); addMesh(rWingPlate);
  const rWing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.7), darkMat); rWing.position.set(-2.25, 1.25, 0); addMesh(rWing);
}
function addMesh(m) { m.castShadow = true; m.receiveShadow = true; carGroup.add(m); }
function buildWheels() {
  const tyreMat = mat('#1A1713', { roughness: 0.8, metalness: 0 });
  CORNERS.forEach(c => {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 22), tyreMat); tyre.rotation.x = Math.PI / 2; tyre.castShadow = true; g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 12), mat('#C9C0AE', { metalness: 0.5, roughness: 0.3 })); hub.rotation.x = Math.PI / 2; g.add(hub);
    g.position.set(c.fx, GROUND, c.fz);
    wheelBase[c.id] = { x: c.fx, z: c.fz, side: Math.sign(c.fz) || 1 }; wheelMeshes[c.id] = g; scene.add(g);
  });
}
function buildJacks() {
  const jm = mat('#3A352C', { metalness: 0.4, roughness: 0.5 });
  jackFront = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), jm); jackFront.geometry.translate(0, 0.5, 0);
  jackFront.position.set(3.1, 0, 0); jackFront.scale.y = 0.001; jackFront.castShadow = true; scene.add(jackFront);
  jackRear = jackFront.clone(); jackRear.position.set(-3.0, 0, 0); scene.add(jackRear);
}
function buildLights() {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.6), mat('#211D17')); bar.position.set(3.2, 3.0, 0); scene.add(bar);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshStandardMaterial({ color: '#3a0c08', emissive: '#000000' }));
    s.position.set(3.2, 2.78, -1.0 + i * 0.5); startLights.push(s); scene.add(s);
  }
}
function resizeRenderer() {
  if (!renderer) return;
  const canvas = $('scene'), w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function resetScene() { driveX = 0; if (!sceneReady) return; applyState(0, null); renderOnce(); }

function applyState(t, sched) {
  if (!sceneReady) return;
  const prog = (id) => { if (!sched || !jobById || !jobById[id]) return 0; const s = sched.start[id], f = sched.finish[id]; if (!isFinite(s)) return 0; return clamp((t - s) / Math.max(0.0001, f - s), 0, 1); };
  const lift = (axle) => clamp(prog('jack_' + axle + '_up') - prog('jack_' + axle + '_down'), 0, 1);
  const fL = lift('front'), rL = lift('rear'), carLift = LIFT * Math.max(fL, rL);
  carGroup.position.y = carLift; carGroup.position.x = driveX; carGroup.rotation.z = (fL - rL) * 0.03;
  jackFront.scale.y = Math.max(0.001, LIFT * fL); jackRear.scale.y = Math.max(0.001, LIFT * rL);
  jackFront.visible = fL > 0.02; jackRear.visible = rL > 0.02;
  CORNERS.forEach(c => {
    const b = wheelBase[c.id], g = wheelMeshes[c.id];
    const hasJobs = jobById && jobById['off_' + c.id];
    const out = hasJobs ? clamp(prog('off_' + c.id) - prog('on_' + c.id), 0, 1) : 0;
    const attachedY = GROUND + (hasJobs ? carLift : 0);
    g.position.x = b.x + driveX; g.position.z = b.z + b.side * out * 0.95; g.position.y = attachedY * (1 - out) + GROUND * out;
    if (out > 0.001 && out < 0.999) g.rotation.x += 0.35;
  });
  if (sched && jobById && jobById.release) {
    const relF = sched.finish.release, lit = isFinite(relF) ? clamp((t - (relF - 2)) / 2, 0, 1) * 5 : 0, out = t >= relF;
    startLights.forEach((s, i) => { const on = !out && i < Math.floor(lit); s.material.emissive.set(on ? '#E10600' : '#000000'); s.material.color.set(on ? '#ff5a4d' : '#3a0c08'); });
  } else startLights.forEach(s => { s.material.emissive.set('#000000'); s.material.color.set('#3a0c08'); });
}

// Render on demand only — a static puzzle should not run a 60fps loop forever
// (it pegs software-WebGL renderers in headless/no-GPU environments). The rAF
// loop runs solely during the "Run stop" animation (see stepRun).
function renderOnce() { if (sceneReady && renderer) renderer.render(scene, camera); }

/* ============================================================
   Run the stop
   ============================================================ */
let runStart = 0, runSched = null;
function runStop() {
  const sched = computeSchedule();
  if (!sched.allPlaced || sched.total == null) return;
  running = true; selected = null; runSched = sched; runStart = performance.now(); driveX = 0;
  $('runBtn').disabled = true; markRunningBars(true);
  camera.position.set(6.4, 4.2, 7.2); camera.lookAt(0, 0.5, 0);
  requestAnimationFrame(stepRun);
}
function markRunningBars(on) { document.querySelectorAll('.bar').forEach(b => b.classList.toggle('running', on)); }
function stepRun(now) {
  if (!running) return;
  const t = (now - runStart) / UNIT_MS, relF = runSched.finish.release;
  if (t >= relF) driveX = (t - relF) * 3.4;
  applyState(t, runSched);
  if (sceneReady) renderer.render(scene, camera);
  if (driveX > 13) { finishRun(); return; }
  requestAnimationFrame(stepRun);
}
function finishRun() {
  running = false; markRunningBars(false);
  const total = runSched.total, kept = total <= level._limit, stars = kept ? starsFor(total, level._par) : 0;
  recordResult(total, stars, kept);
  resetScene(); showResult(total, stars, kept); renderHud();
}

function recordResult(total, stars, kept) {
  if (mode === 'daily') {
    progress.daily = progress.daily || {};
    const prev = progress.daily[dailyKey];
    if (!prev || stars > prev.stars || (stars === prev.stars && total < prev.time)) progress.daily[dailyKey] = { stars, time: total, kept };
    if (kept) updateStreak();
  } else if (mode === 'endless') {
    if (kept) { progress.endlessBest = Math.max(progress.endlessBest || 0, endlessN + 1); }
  } else {
    progress.levels = progress.levels || {};
    const prev = progress.levels[levelIndex];
    if (kept && (!prev || stars > prev.stars || (stars === prev.stars && total < prev.time))) progress.levels[levelIndex] = { stars, time: total };
  }
  saveProgress();
}
function updateStreak() {
  progress.streak = progress.streak || { count: 0, last: null };
  const s = progress.streak; if (s.last === dailyKey) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(y);
  s.count = (s.last === yKey) ? s.count + 1 : 1; s.last = dailyKey; saveProgress();
}

/* ============================================================
   Overlays + wiring
   ============================================================ */
function showResult(total, stars, kept) {
  $('winStars').innerHTML = [0, 1, 2].map(i => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  if (kept) {
    const msgs = { 3: 'Perfect stop — the crew nailed it.', 2: 'Strong stop. There’s still a tenth or two to find.', 1: 'Job done, position held. Now chase the target.' };
    $('win-title').textContent = 'Position held';
    $('winTime').textContent = fmt(total) + (total <= level._par ? ' · target beaten' : '');
    let msg = msgs[stars] || msgs[1];
    if (mode === 'daily' && progress.streak && progress.streak.count > 1) msg += ` 🔥 ${progress.streak.count}-day streak.`;
    if (mode === 'endless') msg += ` Run ${endlessN + 1} cleared.`;
    $('winMsg').textContent = msg;
    $('winNext').style.display = '';
    $('winNext').textContent = mode === 'daily' ? 'Back to levels' : (mode === 'endless' ? 'Next run' : (levelIndex < LEVELS.length - 1 ? 'Next level' : 'Replay'));
  } else {
    $('win-title').textContent = 'Lost the position';
    $('winTime').textContent = fmt(total) + ' · over the gap';
    $('winMsg').textContent = `The chasing car got through — you needed ${fmt(level._limit)} or better. Re-plan and try again.`;
    $('winNext').style.display = 'none';
  }
  openOverlay('winOverlay');
}
function openOverlay(id) { $(id).hidden = false; const b = $(id).querySelector('button'); if (b) b.focus(); }
function closeOverlay(id) { $(id).hidden = true; }

function toggleTips() { const box = $('tips'); box.hidden = !box.hidden; $('hintBtn').setAttribute('aria-pressed', String(!box.hidden)); renderTips(); }
function resetBoard() { lanes = Array.from({ length: level.crew.length }, () => []); selected = null; resetScene(); renderAll(); }

function boot() {
  $('year').textContent = new Date().getFullYear();
  LEVELS = buildLevels();
  dailyKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  dailyLevel = genLevel('daily-' + dailyKey, { spec: 2, guns: 2, comp: 2, slack: 1 }, 'Daily · ' + dailyKey, 'daily');

  let startIdx = 0;
  if (progress.levels) for (let i = 0; i < LEVELS.length; i++) { if (!progress.levels[i] || progress.levels[i].stars < 3) { startIdx = i; break; } }

  initScene();

  $('runBtn').addEventListener('click', runStop);
  $('resetBtn').addEventListener('click', resetBoard);
  $('hintBtn').addEventListener('click', toggleTips);
  $('prevBtn').addEventListener('click', () => goLevel(levelIndex - 1));
  $('nextBtn').addEventListener('click', () => goLevel(levelIndex + 1));
  $('dailyBtn').addEventListener('click', () => (mode === 'daily' ? goLevel(levelIndex) : goDaily()));
  $('endlessBtn').addEventListener('click', () => (mode === 'endless' ? goLevel(levelIndex) : goEndless(true)));
  $('helpBtn').addEventListener('click', () => openOverlay('helpOverlay'));
  $('helpClose').addEventListener('click', () => closeOverlay('helpOverlay'));
  $('winRetry').addEventListener('click', () => { closeOverlay('winOverlay'); resetBoard(); });
  $('winNext').addEventListener('click', () => {
    closeOverlay('winOverlay');
    if (mode === 'daily') goLevel(0);
    else if (mode === 'endless') { endlessN++; goEndless(false); }
    else goLevel(levelIndex + 1);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeOverlay('helpOverlay'); closeOverlay('winOverlay'); } });

  goLevel(startIdx);
  if (!progress.seen) { openOverlay('helpOverlay'); progress.seen = true; saveProgress(); }

  // Inert test hook (only active with ?pstest) for headless verification.
  if (location.search.includes('pstest')) {
    window.__PS = {
      levels: () => LEVELS, daily: () => dailyLevel,
      load: (i) => goLevel(i), loadDaily: () => goDaily(),
      name: () => level.name, par: () => level._par, limit: () => level._limit,
      solveWithSol: () => { lanes = level._sol.map(l => l.slice()); renderAll(); return computeSchedule().total; },
      autofill: () => { const p = new Set(); lanes.forEach(l => l.forEach(id => p.add(id))); level.jobs.filter(j => !p.has(j.id)).forEach(j => { const li = level.crew.findIndex(c => canDo(c, j)); if (li >= 0) lanes[li].push(j.id); }); renderAll(); return computeSchedule(); },
      run: () => runStop(),
    };
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
