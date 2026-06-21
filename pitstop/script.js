import * as THREE from 'three';

/* ============================================================
   Perfect Stop — an F1 pit-stop sequencing puzzle.
   Single ES module. three.js is the only external dependency
   (loaded via importmap from CDN). Everything runs in-browser;
   progress is saved to localStorage, nothing is uploaded.
   ============================================================ */

/* ---------- constants ---------- */
const UNIT_MS = 360;              // ms of animation per scheduling unit
const SEC_PER_UNIT = 0.45;        // flavour: turn abstract units into "seconds"
const STORE_KEY = 'perfectstop.v1';

const COLORS = {
  jack: '#5C554A',
  go:   '#C0392B',
  FL:   '#B4471F', FR: '#B07A12', RL: '#2E5FA3', RR: '#2E6F4F',
};

const CORNERS = [
  { id: 'FL', label: 'Front-left',  axle: 'front', fx:  1.6, fz:  1.0, hex: COLORS.FL },
  { id: 'FR', label: 'Front-right', axle: 'front', fx:  1.6, fz: -1.0, hex: COLORS.FR },
  { id: 'RL', label: 'Rear-left',   axle: 'rear',  fx: -1.6, fz:  1.0, hex: COLORS.RL },
  { id: 'RR', label: 'Rear-right',  axle: 'rear',  fx: -1.6, fz: -1.0, hex: COLORS.RR },
];
const CORNER_BY_ID = Object.fromEntries(CORNERS.map(c => [c.id, c]));

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (units) => (units * SEC_PER_UNIT).toFixed(1) + 's';

/* ============================================================
   Levels
   ============================================================ */
function buildJobs(cfg) {
  const D = Object.assign({ jackUp: 1, off: 2, on: 2, jackDown: 1, release: 1 }, cfg.dur || {});
  const corners = cfg.corners;
  const hasFront = corners.some(c => c[0] === 'F');
  const hasRear  = corners.some(c => c[0] === 'R');
  const jobs = [];
  const add = (o) => jobs.push(Object.assign({ prereqs: [], lane: null }, o));

  if (cfg.jacks) {
    if (hasFront) add({ id: 'jack_front_up', label: 'Front jack up', short: 'Front jack ↑', type: 'jack', color: COLORS.jack, duration: D.jackUp });
    if (hasRear)  add({ id: 'jack_rear_up',  label: 'Rear jack up',  short: 'Rear jack ↑',  type: 'jack', color: COLORS.jack, duration: D.jackUp });
  }
  corners.forEach(cid => {
    const c = CORNER_BY_ID[cid];
    const axleUp = c.axle === 'front' ? 'jack_front_up' : 'jack_rear_up';
    const offDur = (cfg.sticky && cfg.sticky[cid]) ? D.off + cfg.sticky[cid] : D.off;
    add({ id: 'off_' + cid, label: c.label + ' tyre off', short: cid + ' off', type: 'corner', corner: cid, color: c.hex, duration: offDur, prereqs: cfg.jacks ? [axleUp] : [] });
    add({ id: 'on_' + cid,  label: c.label + ' tyre on',  short: cid + ' on',  type: 'corner', corner: cid, color: c.hex, duration: D.on, prereqs: ['off_' + cid] });
  });
  let releasePre = [];
  if (cfg.jacks) {
    if (hasFront) { add({ id: 'jack_front_down', label: 'Front jack down', short: 'Front jack ↓', type: 'jack', color: COLORS.jack, duration: D.jackDown, prereqs: corners.filter(c => c[0] === 'F').map(c => 'on_' + c) }); releasePre.push('jack_front_down'); }
    if (hasRear)  { add({ id: 'jack_rear_down',  label: 'Rear jack down',  short: 'Rear jack ↓',  type: 'jack', color: COLORS.jack, duration: D.jackDown, prereqs: corners.filter(c => c[0] === 'R').map(c => 'on_' + c) }); releasePre.push('jack_rear_down'); }
  } else {
    releasePre = corners.map(c => 'on_' + c);
  }
  add({ id: 'release', label: 'Release the car', short: 'GO', type: 'release', color: COLORS.go, duration: D.release, prereqs: releasePre });

  if (cfg.pins) jobs.forEach(j => { if (cfg.pins[j.id] != null) j.lane = cfg.pins[j.id]; });
  return jobs;
}

const LEVEL_DEFS = [
  { name: 'Warm-up',        lanes: 2, cfg: { corners: ['FL', 'FR'], jacks: true } },
  { name: 'All four',       lanes: 4, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true } },
  { name: 'Three hands',    lanes: 3, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true } },
  { name: 'Sticky nut',     lanes: 3, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, sticky: { FR: 1 } } },
  { name: 'Two-man crew',   lanes: 2, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true } },
  { name: 'Pinned jacks',   lanes: 3, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, pins: { jack_front_up: 0, jack_rear_up: 0, jack_front_down: 0, jack_rear_down: 0 } } },
  { name: 'Heavy guns',     lanes: 3, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, dur: { off: 3, on: 3 } } },
  { name: 'Crunch',         lanes: 2, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, sticky: { RL: 1 } } },
  { name: 'Double trouble', lanes: 3, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, sticky: { FL: 1, RR: 1 } } },
  { name: 'Masterclass',    lanes: 2, cfg: { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, pins: { jack_front_up: 0, jack_rear_up: 0, jack_front_down: 0, jack_rear_down: 0 } } },
];

function makeLevel(def) {
  const lvl = { name: def.name, lanes: def.lanes, jobs: buildJobs(def.cfg) };
  const sol = autoSolve(lvl);
  lvl._par = sol.time;
  lvl._sol = sol.lanes;
  return lvl;
}

/* ---------- daily puzzle (date-seeded) ---------- */
function osloDateKey() {
  // Stable per-calendar-day in Europe/Oslo, matching the rest of the site.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // YYYY-MM-DD
}
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

function makeDailyLevel(dateKey) {
  const rnd = mulberry32(hashStr('perfectstop|' + dateKey));
  const lanes = rnd() < 0.5 ? 2 : 3;
  const cfg = { corners: ['FL', 'FR', 'RL', 'RR'], jacks: true, dur: {}, sticky: {} };
  if (rnd() < 0.5) cfg.dur.off = 3;                       // heavier guns some days
  const nSticky = rnd() < 0.55 ? (rnd() < 0.5 ? 1 : 2) : 0;
  const pool = ['FL', 'FR', 'RL', 'RR'];
  for (let i = 0; i < nSticky; i++) { const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; cfg.sticky[c] = 1; }
  const lvl = { name: 'Daily · ' + dateKey, lanes, jobs: buildJobs(cfg) };
  const sol = autoSolve(lvl);
  lvl._par = sol.time; lvl._sol = sol.lanes;
  return lvl;
}

/* ============================================================
   Scheduler
   ============================================================ */
function computeSchedule() {
  const start = {}, finish = {};
  const placed = new Set();
  lanes.forEach(l => l.forEach(id => placed.add(id)));
  level.jobs.forEach(j => { start[j.id] = 0; finish[j.id] = 0; });

  for (let it = 0; it < level.jobs.length + 3; it++) {
    let changed = false;
    lanes.forEach(laneArr => {
      let prev = 0;
      laneArr.forEach(id => {
        const j = jobById[id];
        let s = prev;
        for (const p of j.prereqs) {
          const pf = placed.has(p) ? finish[p] : Infinity;
          if (pf > s) s = pf;
        }
        if (s !== start[id]) { start[id] = s; changed = true; }
        finish[id] = s + j.duration;
        prev = finish[id];
      });
    });
    if (!changed) break;
  }
  const allPlaced = level.jobs.every(j => placed.has(j.id));
  const total = (allPlaced && isFinite(finish.release)) ? finish.release : null;
  return { start, finish, total, allPlaced, placed };
}

function autoSolve(lvl) {
  const jobs = lvl.jobs;
  const byId = Object.fromEntries(jobs.map(j => [j.id, j]));
  const succ = {}; jobs.forEach(j => succ[j.id] = []);
  jobs.forEach(j => j.prereqs.forEach(p => { if (succ[p]) succ[p].push(j.id); }));
  const cp = {};
  const calcCP = (id) => {
    if (cp[id] != null) return cp[id];
    cp[id] = 0; // guard
    let m = 0;
    for (const s of succ[id]) m = Math.max(m, calcCP(s));
    return cp[id] = byId[id].duration + m;
  };
  jobs.forEach(j => calcCP(j.id));

  const laneFree = Array(lvl.lanes).fill(0);
  const seq = Array.from({ length: lvl.lanes }, () => []);
  const finish = {}, done = new Set();
  let guard = 0;
  while (done.size < jobs.length && guard++ < 999) {
    const ready = jobs.filter(j => !done.has(j.id) && j.prereqs.every(p => done.has(p)));
    if (!ready.length) break;
    ready.sort((a, b) => (cp[b.id] - cp[a.id]) || (b.duration - a.duration));
    const j = ready[0];
    const pf = j.prereqs.length ? Math.max(...j.prereqs.map(p => finish[p])) : 0;
    const allowed = (j.lane != null) ? [j.lane] : laneFree.map((_, i) => i);
    let best = allowed[0], bestStart = Infinity;
    for (const l of allowed) {
      const s = Math.max(laneFree[l], pf);
      if (s < bestStart || (s === bestStart && laneFree[l] < laneFree[best])) { best = l; bestStart = s; }
    }
    const st = Math.max(laneFree[best], pf);
    finish[j.id] = st + j.duration; laneFree[best] = finish[j.id];
    seq[best].push(j.id); done.add(j.id);
  }
  return { lanes: seq, time: Math.max(0, ...Object.values(finish)) };
}

function starsFor(total, par) {
  if (total == null) return 0;
  if (total <= par) return 3;
  if (total <= par + Math.max(1, Math.round(par * 0.15))) return 2;
  return 1;
}

/* ============================================================
   State
   ============================================================ */
let level, jobById, lanes, selected = null, mode = 'level', levelIndex = 0, running = false;
let progress = loadProgress();

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}
function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* private mode: ignore */ }
}

function loadLevel(lvl, idx) {
  level = lvl;
  jobById = Object.fromEntries(level.jobs.map(j => [j.id, j]));
  lanes = Array.from({ length: level.lanes }, () => []);
  selected = null;
  if (idx != null) levelIndex = idx;
  resetScene();
  renderAll();
}

function currentBest() {
  if (mode === 'daily') return (progress.daily && progress.daily[dailyKey]) || null;
  return (progress.levels && progress.levels[levelIndex]) || null;
}

/* ============================================================
   Rendering
   ============================================================ */
function scaleMax() {
  const sched = computeSchedule();
  return Math.max(level._par, sched.total || 0, 5) + 1;
}

function renderAll() {
  renderHud();
  renderTray();
  renderLanes();
  renderTimeaxis();
  renderSchedule();
  renderBarActions();
}

function renderHud() {
  const sched = computeSchedule();
  $('hudMode').textContent = mode === 'daily' ? level.name : `Level ${levelIndex + 1} · ${level.name}`;
  $('hudPar').textContent = fmt(level._par);
  $('hudTime').textContent = sched.total != null ? `Planned: ${fmt(sched.total)}` : 'Planned: —';
  const st = starsFor(sched.total, level._par);
  $('hudStars').textContent = '★'.repeat(st) + '☆'.repeat(3 - st);
  $('runBtn').disabled = running || !sched.allPlaced;
}

function chipEl(j) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (selected === j.id ? ' selected' : '');
  b.dataset.id = j.id;
  b.setAttribute('draggable', 'true');
  const lock = j.lane != null ? ` (lane ${j.lane + 1} only)` : '';
  b.setAttribute('aria-label', `${j.label}, takes ${fmt(j.duration)}${lock}. Select, then add to a lane.`);
  b.innerHTML = `<span class="dot" style="background:${j.color}"></span><span>${j.label}</span><span class="dur">${fmt(j.duration)}</span>`;
  b.addEventListener('click', () => { selected = (selected === j.id) ? null : j.id; renderAll(); });
  b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ id: j.id, from: 'tray' })); });
  return b;
}

function renderTray() {
  const tray = $('tray');
  tray.innerHTML = '';
  const placed = new Set(); lanes.forEach(l => l.forEach(id => placed.add(id)));
  const unplaced = level.jobs.filter(j => !placed.has(j.id));
  unplaced.forEach(j => tray.appendChild(chipEl(j)));
  $('trayEmpty').classList.toggle('show', unplaced.length === 0);
}

function renderLanes() {
  const sched = computeSchedule();
  const sm = scaleMax();
  const wrap = $('lanes');
  wrap.innerHTML = '';
  lanes.forEach((laneArr, li) => {
    const row = document.createElement('div');
    row.className = 'lane';

    const lbl = document.createElement('div');
    lbl.className = 'lane-label';
    const selJob = selected ? jobById[selected] : null;
    const canAdd = selJob && (selJob.lane == null || selJob.lane === li);
    lbl.innerHTML = `<span>Lane ${li + 1}</span>`;
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'lane-add';
    addBtn.textContent = 'Add here';
    addBtn.disabled = !canAdd;
    addBtn.setAttribute('aria-label', `Add selected job to lane ${li + 1}`);
    addBtn.addEventListener('click', () => placeSelected(li));
    lbl.appendChild(addBtn);
    row.appendChild(lbl);

    const track = document.createElement('div');
    track.className = 'lane-track';
    track.dataset.lane = li;
    track.addEventListener('dragover', (e) => { e.preventDefault(); track.classList.add('drop-ok'); });
    track.addEventListener('dragleave', () => track.classList.remove('drop-ok'));
    track.addEventListener('drop', (e) => {
      e.preventDefault(); track.classList.remove('drop-ok');
      try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); dropOnLane(d, li); } catch (err) { /* ignore */ }
    });
    track.addEventListener('click', (e) => { if (e.target === track && selected) placeSelected(li); });

    laneArr.forEach((id, pos) => {
      const j = jobById[id];
      const s = sched.start[id], f = sched.finish[id];
      const blocked = !isFinite(s);
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'bar' + (blocked ? ' blocked' : '') + (selected === id ? ' selected' : '');
      bar.dataset.id = id;
      bar.style.background = j.color;
      bar.style.left = (blocked ? 0 : clamp(s / sm * 100, 0, 99)) + '%';
      bar.style.width = clamp(j.duration / sm * 100, 4, 100) + '%';
      bar.setAttribute('draggable', 'true');
      const whenTxt = blocked ? 'waiting on a prerequisite' : `${fmt(s)} to ${fmt(f)}`;
      bar.setAttribute('aria-label', `${j.label}, lane ${li + 1}, ${whenTxt}. Selected: use arrow keys to move, Delete to remove.`);
      bar.innerHTML = `<span class="bar-name">${j.short}</span>`;
      bar.addEventListener('click', () => { selected = (selected === id) ? null : id; renderAll(); });
      bar.addEventListener('keydown', (e) => onBarKey(e, id, li, pos));
      bar.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', JSON.stringify({ id, from: 'lane' })); });
      track.appendChild(bar);
    });
    row.appendChild(track);
    wrap.appendChild(row);
  });
}

function renderTimeaxis() {
  const sm = scaleMax();
  const ax = $('timeaxis');
  ax.innerHTML = '';
  for (let u = 0; u <= sm; u++) {
    const t = document.createElement('div');
    t.className = 'tick';
    t.style.left = (u / sm * 100) + '%';
    ax.appendChild(t);
  }
  const par = document.createElement('div');
  par.className = 'parline';
  par.style.left = (level._par / sm * 100) + '%';
  par.innerHTML = `<span>PAR ${fmt(level._par)}</span>`;
  ax.appendChild(par);
}

function renderSchedule() {
  const sched = computeSchedule();
  const ol = $('scheduleText');
  ol.innerHTML = '';
  const rows = [];
  lanes.forEach((laneArr, li) => laneArr.forEach(id => {
    const j = jobById[id];
    rows.push({ s: sched.start[id], f: sched.finish[id], li, label: j.label });
  }));
  rows.sort((a, b) => (a.s - b.s) || (a.li - b.li));
  rows.forEach(r => {
    const li_ = document.createElement('li');
    const when = isFinite(r.s) ? `${fmt(r.s)}–${fmt(r.f)}` : 'blocked';
    li_.textContent = `${when} · Lane ${r.li + 1} · ${r.label}`;
    ol.appendChild(li_);
  });
  if (sched.total != null) {
    const li_ = document.createElement('li');
    li_.textContent = `Stop complete at ${fmt(sched.total)} (par ${fmt(level._par)}).`;
    ol.appendChild(li_);
  }
}

let barActionsEl = null;
function renderBarActions() {
  if (!barActionsEl) {
    barActionsEl = document.createElement('div');
    barActionsEl.className = 'toolbar';
    barActionsEl.style.marginTop = '12px';
    barActionsEl.setAttribute('role', 'toolbar');
    barActionsEl.setAttribute('aria-label', 'Move the selected job');
    $('lanes').after(barActionsEl);
  }
  const j = selected ? jobById[selected] : null;
  const inLane = j && lanes.some(l => l.includes(selected));
  if (!j || !inLane) { barActionsEl.innerHTML = ''; barActionsEl.style.display = 'none'; return; }
  barActionsEl.style.display = 'flex';
  const pinned = j.lane != null;
  barActionsEl.innerHTML = '';
  const mk = (label, fn, disabled) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = label; b.disabled = !!disabled;
    b.addEventListener('click', fn);
    barActionsEl.appendChild(b);
  };
  const note = document.createElement('span');
  note.style.cssText = 'font-size:12px;color:var(--ink-3);align-self:center;margin-right:4px;';
  note.textContent = `Move: ${j.label}`;
  barActionsEl.appendChild(note);
  mk('◀ Earlier', () => moveOrder(selected, -1));
  mk('Later ▶', () => moveOrder(selected, +1));
  mk('▲ Lane up', () => moveLane(selected, -1), pinned);
  mk('Lane down ▼', () => moveLane(selected, +1), pinned);
  mk('Remove', () => removeJob(selected));
}

/* ============================================================
   Interaction
   ============================================================ */
function laneOf(id) { for (let i = 0; i < lanes.length; i++) if (lanes[i].includes(id)) return i; return -1; }

function placeSelected(li) {
  if (!selected) return;
  const j = jobById[selected];
  const target = (j.lane != null) ? j.lane : li;
  // if already placed, remove first
  removeFromLanes(selected);
  lanes[target].push(selected);
  renderAll();
}
function dropOnLane(d, li) {
  selected = d.id;
  const j = jobById[d.id];
  const target = (j.lane != null) ? j.lane : li;
  removeFromLanes(d.id);
  lanes[target].push(d.id);
  renderAll();
}
function removeFromLanes(id) { lanes.forEach(l => { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); }); }
function removeJob(id) { removeFromLanes(id); if (selected === id) selected = null; renderAll(); }

function moveOrder(id, dir) {
  const li = laneOf(id); if (li < 0) return;
  const arr = lanes[li]; const i = arr.indexOf(id); const ni = i + dir;
  if (ni < 0 || ni >= arr.length) return;
  arr.splice(i, 1); arr.splice(ni, 0, id);
  renderAll(); focusBar(id);
}
function moveLane(id, dir) {
  const j = jobById[id]; if (j.lane != null) return;
  const li = laneOf(id); if (li < 0) return;
  const nl = li + dir; if (nl < 0 || nl >= lanes.length) return;
  removeFromLanes(id); lanes[nl].push(id);
  renderAll(); focusBar(id);
}
function focusBar(id) { const b = document.querySelector(`.bar[data-id="${id}"]`); if (b) b.focus(); }

function onBarKey(e, id, li, pos) {
  let handled = true;
  if (e.key === 'ArrowLeft') moveOrder(id, -1);
  else if (e.key === 'ArrowRight') moveOrder(id, +1);
  else if (e.key === 'ArrowUp') moveLane(id, -1);
  else if (e.key === 'ArrowDown') moveLane(id, +1);
  else if (e.key === 'Delete' || e.key === 'Backspace') removeJob(id);
  else handled = false;
  if (handled) e.preventDefault();
}

/* ============================================================
   three.js scene
   ============================================================ */
let renderer, scene, camera, carGroup, wheelMeshes = {}, jackFront, jackRear, startLights = [];
let wheelBase = {}, sceneReady = false, driveX = 0;
const LIFT = 0.55, WHEEL_R = 0.42, GROUND = WHEEL_R;

function initScene() {
  const canvas = $('scene');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) { canvas.style.display = 'none'; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#EDE8DD');

  camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  camera.position.set(6.4, 4.2, 7.2);
  camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.HemisphereLight('#FBF6EC', '#CFC4AC', 0.9));
  const sun = new THREE.DirectionalLight('#FFE9CC', 1.15);
  sun.position.set(5, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30;
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: '#E2DBCB', roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // pit box markings
  const box = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 4.6),
    new THREE.MeshStandardMaterial({ color: '#D8CFBC', roughness: 1 })
  );
  box.rotation.x = -Math.PI / 2; box.position.y = 0.01; box.receiveShadow = true; scene.add(box);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 4.6),
    new THREE.MeshStandardMaterial({ color: '#F2ECDF' })
  );
  line.rotation.x = -Math.PI / 2; line.position.set(3.6, 0.02, 0); scene.add(line);

  // garage wall behind
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(14, 5, 0.4),
    new THREE.MeshStandardMaterial({ color: '#CDBF6A', roughness: 0.8 })
  );
  wall.position.set(-1, 2.5, -4.5); wall.receiveShadow = true; scene.add(wall);

  buildCar();
  buildWheels();
  buildJacks();
  buildLights();

  window.addEventListener('resize', () => { resizeRenderer(); renderOnce(); });
  resizeRenderer();
  sceneReady = true;
  renderOnce(); // draw the rest scene; per-level posing happens once a level loads
}

function mat(color, opts = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.1 }, opts)); }

function buildCar() {
  carGroup = new THREE.Group();
  scene.add(carGroup);

  const bodyMat = mat('#B4471F', { roughness: 0.4 });
  const darkMat = mat('#211D17', { roughness: 0.6 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.25, 1.5), bodyMat);
  floor.position.y = 0.55; addMesh(floor);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.32, 0.7), bodyMat);
  nose.position.set(2.1, 0.6, 0); addMesh(nose);

  const sidepodL = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.5), bodyMat);
  sidepodL.position.set(-0.2, 0.7, 0.65); addMesh(sidepodL);
  const sidepodR = sidepodL.clone(); sidepodR.position.z = -0.65; addMesh(sidepodR);

  const engine = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.7), bodyMat);
  engine.position.set(-0.9, 0.78, 0); addMesh(engine);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.7), darkMat);
  cockpit.position.set(0.7, 0.92, 0); addMesh(cockpit);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 16, Math.PI), darkMat);
  halo.position.set(0.7, 1.15, 0); halo.rotation.y = Math.PI / 2; addMesh(halo);

  // front wing
  const fWing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.8), darkMat);
  fWing.position.set(2.85, 0.36, 0); addMesh(fWing);
  // rear wing
  const rWingPlate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.5), bodyMat);
  rWingPlate.position.set(-2.2, 1.0, 0); addMesh(rWingPlate);
  const rWing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.7), darkMat);
  rWing.position.set(-2.25, 1.25, 0); addMesh(rWing);
}
function addMesh(m) { m.castShadow = true; m.receiveShadow = true; carGroup.add(m); }

function buildWheels() {
  const tyreMat = mat('#1A1713', { roughness: 0.8, metalness: 0 });
  CORNERS.forEach(c => {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 22), tyreMat);
    tyre.rotation.x = Math.PI / 2; tyre.castShadow = true; g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 12), mat('#C9C0AE', { metalness: 0.5, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2; g.add(hub);
    g.position.set(c.fx, GROUND, c.fz);
    wheelBase[c.id] = { x: c.fx, z: c.fz, side: Math.sign(c.fz) || 1 };
    wheelMeshes[c.id] = g;
    scene.add(g);
  });
}

function buildJacks() {
  const jm = mat('#3A352C', { metalness: 0.4, roughness: 0.5 });
  jackFront = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), jm);
  jackFront.geometry.translate(0, 0.5, 0); // grow upward from base
  jackFront.position.set(3.1, 0, 0); jackFront.scale.y = 0.001; jackFront.castShadow = true; scene.add(jackFront);
  jackRear = jackFront.clone(); jackRear.position.set(-3.0, 0, 0); scene.add(jackRear);
}

function buildLights() {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.6), mat('#211D17'));
  bar.position.set(3.2, 3.0, 0); scene.add(bar);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshStandardMaterial({ color: '#3a0c08', emissive: '#000000' }));
    s.position.set(3.2, 2.78, -1.0 + i * 0.5);
    startLights.push(s); scene.add(s);
  }
}

function resizeRenderer() {
  if (!renderer) return;
  const canvas = $('scene');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

function resetScene() {
  driveX = 0;
  if (!sceneReady) return;
  applyState(0, null); // rest pose
  renderOnce();
}

/* Map a scheduling time t (units) + schedule to scene transforms. */
function applyState(t, sched) {
  if (!sceneReady) return;
  const prog = (id) => {
    if (!sched || !jobById || !jobById[id]) return 0;
    const s = sched.start[id], f = sched.finish[id];
    if (!isFinite(s)) return 0;
    return clamp((t - s) / Math.max(0.0001, f - s), 0, 1);
  };
  const lift = (axle) => {
    const up = prog('jack_' + axle + '_up');
    const down = prog('jack_' + axle + '_down');
    return clamp(up - down, 0, 1);
  };
  const fL = lift('front'), rL = lift('rear');
  const carLift = LIFT * Math.max(fL, rL);

  carGroup.position.y = carLift;
  carGroup.position.x = driveX;
  carGroup.rotation.z = (fL - rL) * 0.03;

  jackFront.scale.y = Math.max(0.001, LIFT * fL);
  jackRear.scale.y = Math.max(0.001, LIFT * rL);
  jackFront.visible = fL > 0.02; jackRear.visible = rL > 0.02;

  CORNERS.forEach(c => {
    const b = wheelBase[c.id], g = wheelMeshes[c.id];
    const pOff = prog('off_' + c.id), pOn = prog('on_' + c.id);
    const hasJobs = jobById && jobById['off_' + c.id];
    const out = hasJobs ? clamp(pOff - pOn, 0, 1) : 0;
    const attachedY = GROUND + (hasJobs ? carLift : 0);
    g.position.x = b.x + driveX;
    g.position.z = b.z + b.side * out * 0.95;
    g.position.y = attachedY * (1 - out) + GROUND * out;
    if (out > 0.001 && out < 0.999) g.rotation.x += 0.35;
  });

  // start lights -> release flourish
  if (sched && jobById && jobById.release) {
    const relF = sched.finish.release;
    const lit = isFinite(relF) ? clamp((t - (relF - 2)) / 2, 0, 1) * 5 : 0;
    const out = t >= relF; // lights out, GO
    startLights.forEach((s, i) => {
      const on = !out && i < Math.floor(lit);
      s.material.emissive.set(on ? '#E10600' : '#000000');
      s.material.color.set(on ? '#ff5a4d' : '#3a0c08');
    });
  } else {
    startLights.forEach(s => { s.material.emissive.set('#000000'); s.material.color.set('#3a0c08'); });
  }
}

// Render on demand only — a static puzzle should not run a 60fps loop forever
// (it pegs software-WebGL renderers in headless/no-GPU environments). The rAF
// loop runs solely during the "Run stop" animation (see stepRun).
function renderOnce() {
  if (sceneReady && renderer) renderer.render(scene, camera);
}

/* ============================================================
   Run the stop (animation)
   ============================================================ */
let runStart = 0, runSched = null;
function runStop() {
  const sched = computeSchedule();
  if (!sched.allPlaced || sched.total == null) return;
  running = true; selected = null;
  runSched = sched; runStart = performance.now(); driveX = 0;
  $('runBtn').disabled = true;
  markRunningBars(true);
  camera.position.set(6.4, 4.2, 7.2); camera.lookAt(0, 0.5, 0);
  requestAnimationFrame(stepRun);
}
function markRunningBars(on) {
  document.querySelectorAll('.bar').forEach(b => b.classList.toggle('running', on));
}
function stepRun(now) {
  if (!running) return;
  const t = (now - runStart) / UNIT_MS;
  const relF = runSched.finish.release;
  if (t >= relF) driveX = (t - relF) * 3.4;
  applyState(t, runSched);
  if (sceneReady) renderer.render(scene, camera);
  if (driveX > 13) { finishRun(); return; }
  requestAnimationFrame(stepRun);
}
function finishRun() {
  running = false;
  markRunningBars(false);
  const total = runSched.total;
  const stars = starsFor(total, level._par);
  recordResult(total, stars);
  resetScene();
  showWin(total, stars);
  renderHud();
}

function recordResult(total, stars) {
  if (mode === 'daily') {
    progress.daily = progress.daily || {};
    const prev = progress.daily[dailyKey];
    if (!prev || stars > prev.stars || (stars === prev.stars && total < prev.time)) {
      progress.daily[dailyKey] = { stars, time: total };
    }
    updateStreak();
  } else {
    progress.levels = progress.levels || {};
    const prev = progress.levels[levelIndex];
    if (!prev || stars > prev.stars || (stars === prev.stars && total < prev.time)) {
      progress.levels[levelIndex] = { stars, time: total };
    }
  }
  saveProgress();
}
function updateStreak() {
  progress.streak = progress.streak || { count: 0, last: null };
  const s = progress.streak;
  if (s.last === dailyKey) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(y);
  s.count = (s.last === yKey) ? s.count + 1 : 1;
  s.last = dailyKey;
  saveProgress();
}

/* ============================================================
   Overlays + UI wiring
   ============================================================ */
function showWin(total, stars) {
  const msgs = {
    3: 'Perfect stop. The crew could not have done it cleaner.',
    2: 'Tidy work — but there is still time to find on that stop.',
    1: 'Car’s away. Now tighten it up and chase par.',
  };
  $('winStars').innerHTML = [0, 1, 2].map(i => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('winTime').textContent = fmt(total) + (total <= level._par ? ' · par beaten' : '');
  let msg = msgs[stars] || msgs[1];
  if (mode === 'daily' && progress.streak && progress.streak.count > 1) msg += ` 🔥 ${progress.streak.count}-day streak.`;
  $('winMsg').textContent = msg;
  $('winNext').textContent = mode === 'daily' ? 'Back to levels' : (levelIndex < LEVELS.length - 1 ? 'Next level' : 'Replay');
  openOverlay('winOverlay');
}
function openOverlay(id) { $(id).hidden = false; const b = $(id).querySelector('button'); if (b) b.focus(); }
function closeOverlay(id) { $(id).hidden = true; }

function hint() {
  // Lay out the known-good (par) solution.
  lanes = level._sol.map(l => l.slice());
  selected = null;
  renderAll();
}

function goLevel(i) {
  mode = 'level';
  levelIndex = (i + LEVELS.length) % LEVELS.length;
  $('dailyBtn').setAttribute('aria-pressed', 'false');
  loadLevel(LEVELS[levelIndex], levelIndex);
}
function goDaily() {
  mode = 'daily';
  $('dailyBtn').setAttribute('aria-pressed', 'true');
  loadLevel(dailyLevel);
}

/* ============================================================
   Boot
   ============================================================ */
let LEVELS, dailyKey, dailyLevel;

function boot() {
  $('year').textContent = new Date().getFullYear();
  LEVELS = LEVEL_DEFS.map(makeLevel);
  dailyKey = osloDateKey();
  dailyLevel = makeDailyLevel(dailyKey);

  // start at first not-yet-3-starred level, else level 1
  let startIdx = 0;
  if (progress.levels) {
    for (let i = 0; i < LEVELS.length; i++) { if (!progress.levels[i] || progress.levels[i].stars < 3) { startIdx = i; break; } }
  }

  initScene();

  $('runBtn').addEventListener('click', runStop);
  $('resetBtn').addEventListener('click', () => { lanes = Array.from({ length: level.lanes }, () => []); selected = null; resetScene(); renderAll(); });
  $('hintBtn').addEventListener('click', hint);
  $('prevBtn').addEventListener('click', () => goLevel(levelIndex - 1));
  $('nextBtn').addEventListener('click', () => goLevel(levelIndex + 1));
  $('dailyBtn').addEventListener('click', () => { mode === 'daily' ? goLevel(levelIndex) : goDaily(); });
  $('helpBtn').addEventListener('click', () => openOverlay('helpOverlay'));
  $('helpClose').addEventListener('click', () => closeOverlay('helpOverlay'));
  $('winRetry').addEventListener('click', () => { closeOverlay('winOverlay'); lanes = Array.from({ length: level.lanes }, () => []); selected = null; resetScene(); renderAll(); });
  $('winNext').addEventListener('click', () => {
    closeOverlay('winOverlay');
    if (mode === 'daily') goLevel(0);
    else goLevel(levelIndex + 1);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeOverlay('helpOverlay'); closeOverlay('winOverlay'); } });

  goLevel(startIdx);

  // first-time hint to open the how-to
  if (!progress.seen) { openOverlay('helpOverlay'); progress.seen = true; saveProgress(); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
