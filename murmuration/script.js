// Murmuration — a 2D flocking simulation after Craig Reynolds' 1986 Boids
// model. Plain 2D canvas, no dependencies: three local steering rules
// (separation, alignment, cohesion) plus wall avoidance and a click-to-pull
// interaction, all evaluated over a spatial grid so it stays fast at up to
// 1500 boids. See the in-page primer for the vectors behind every rule.

/* ============================================================
   Seeded RNG — mulberry32, so a given seed always reproduces the
   same flock (same starting positions and headings).
   ============================================================ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(1);
const randRange = (lo, hi) => lo + rng() * (hi - lo);

/* ============================================================
   Params
   ============================================================ */
const params = {
  seed: 1,
  boidCount: 150,
  perception: 55,
  separation: 1.5,
  alignment: 1.0,
  cohesion: 1.0,
  maxSpeed: 4,
  trailFade: 0.08,
  wallAvoidanceEnabled: true,
  wallAvoidance: 2,
  attraction: 1.5,
  boidColor: '#b4471f',
  bgColor: '#0b0d12'
};
const defaultParams = { ...params };

const MAX_FORCE = 0.15;

/* Hyperbolic proximity: ~0 until a boid is genuinely close to a wall, then
   rises steeply toward 1 right at the boundary — a late, sharp correction
   rather than a gradual linear one. */
function hyperbolicFalloff(d, margin) {
  if (d >= margin) return 0;
  d = Math.max(d, 1);
  const f = (1 / d - 1 / margin) / (1 - 1 / margin);
  return Math.min(Math.max(f, 0), 1);
}

/* ============================================================
   Vec2 — minimal 2D vector helper (mirrors the p5.Vector calls this
   simulation needs, nothing more)
   ============================================================ */
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  copy() { return new Vec2(this.x, this.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  mult(s) { this.x *= s; this.y *= s; return this; }
  div(s) { this.x /= s; this.y /= s; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(s) { const m = this.mag() || 1; return this.mult(s / m); }
  limit(max) { const m = this.mag(); if (m > max) this.setMag(max); return this; }
  static sub(a, b) { return new Vec2(a.x - b.x, a.y - b.y); }
}

/* ============================================================
   Canvas setup
   ============================================================ */
const stage = document.querySelector('.stage');
const canvas = document.getElementById('flock');
const ctx = canvas.getContext('2d');

let dpr = 1, viewW = 1, viewH = 1, wallMargin = 90, cellSize = 60;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = stage.clientWidth || 1;
  viewH = stage.clientHeight || 1;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wallMargin = Math.max(50, Math.min(viewW, viewH) * 0.11);
  ctx.fillStyle = params.bgColor;
  ctx.fillRect(0, 0, viewW, viewH);
  for (const b of boids) {
    b.pos.x = Math.min(Math.max(b.pos.x, 1), viewW - 1);
    b.pos.y = Math.min(Math.max(b.pos.y, 1), viewH - 1);
  }
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

/* ============================================================
   Boid class
   ============================================================ */
class Boid {
  constructor() {
    this.pos = new Vec2(randRange(0, viewW), randRange(0, viewH));
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(2, 4);
    this.vel = new Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this.acc = new Vec2();
  }

  flock(others) {
    const sep = new Vec2(), align = new Vec2(), coh = new Vec2();
    let sepCount = 0, alignCount = 0, cohCount = 0;

    for (const other of others) {
      if (other === this) continue;
      const d = Math.hypot(this.pos.x - other.pos.x, this.pos.y - other.pos.y);
      if (d < params.perception && d > 0) {
        const diff = Vec2.sub(this.pos, other.pos).div(d * d);
        sep.add(diff);
        sepCount++;

        align.add(other.vel);
        alignCount++;

        coh.add(other.pos);
        cohCount++;
      }
    }

    if (sepCount > 0) {
      sep.div(sepCount).setMag(params.maxSpeed).sub(this.vel).limit(MAX_FORCE);
    }
    if (alignCount > 0) {
      align.div(alignCount).setMag(params.maxSpeed).sub(this.vel).limit(MAX_FORCE);
    }
    if (cohCount > 0) {
      coh.div(cohCount).sub(this.pos).setMag(params.maxSpeed).sub(this.vel).limit(MAX_FORCE);
    }

    this.acc.add(sep.mult(params.separation));
    this.acc.add(align.mult(params.alignment));
    this.acc.add(coh.mult(params.cohesion));
  }

  attract(target) {
    const desired = Vec2.sub(target, this.pos);
    const d = desired.mag();
    desired.setMag(params.maxSpeed);
    const steer = Vec2.sub(desired, this.vel);
    steer.limit(MAX_FORCE * params.attraction * (d > 8 ? 3 : 0.5));
    this.acc.add(steer);
  }

  avoidWalls() {
    const fLeft = hyperbolicFalloff(this.pos.x, wallMargin);
    const fRight = hyperbolicFalloff(viewW - this.pos.x, wallMargin);
    const fTop = hyperbolicFalloff(this.pos.y, wallMargin);
    const fBottom = hyperbolicFalloff(viewH - this.pos.y, wallMargin);

    const force = new Vec2(fLeft - fRight, fTop - fBottom);
    const closeness = Math.max(fLeft, fRight, fTop, fBottom); // 0 (at margin) .. 1 (at wall)

    if (closeness > 0.001) {
      const desired = force.copy().setMag(params.maxSpeed);
      const steer = Vec2.sub(desired, this.vel);
      steer.limit(MAX_FORCE * params.wallAvoidance * 4 * closeness);
      this.acc.add(steer);

      // flare: braking scales with closeness too, so it's barely noticeable
      // until the boid is genuinely near the edge
      this.vel.mult(1 - closeness * 0.05);
    }
  }

  update() {
    this.vel.add(this.acc);
    this.vel.limit(params.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
  }

  edges() {
    if (params.wallAvoidanceEnabled) {
      // safety net only — avoidWalls() should turn boids away before they
      // ever get here; this just prevents escape
      const margin = 2;
      if (this.pos.x < margin) { this.pos.x = margin; if (this.vel.x < 0) this.vel.x = 0; }
      if (this.pos.x > viewW - margin) { this.pos.x = viewW - margin; if (this.vel.x > 0) this.vel.x = 0; }
      if (this.pos.y < margin) { this.pos.y = margin; if (this.vel.y < 0) this.vel.y = 0; }
      if (this.pos.y > viewH - margin) { this.pos.y = viewH - margin; if (this.vel.y > 0) this.vel.y = 0; }
    } else {
      // wall avoidance off — teleport across (toroidal space)
      if (this.pos.x > viewW) this.pos.x = 0;
      if (this.pos.x < 0) this.pos.x = viewW;
      if (this.pos.y > viewH) this.pos.y = 0;
      if (this.pos.y < 0) this.pos.y = viewH;
    }
  }

  show() {
    const angle = Math.atan2(this.vel.y, this.vel.x) + Math.PI / 2;
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(angle);
    ctx.fillStyle = params.boidColor;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-3.5, 5);
    ctx.lineTo(3.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
   Spatial grid — bucket boids by cell so neighbor lookups only scan
   nearby cells instead of the whole flock (~O(n) vs O(n^2))
   ============================================================ */
let grid = new Map();

function buildGrid() {
  grid = new Map();
  cellSize = Math.max(20, params.perception);
  for (const b of boids) {
    const cx = Math.floor(b.pos.x / cellSize);
    const cy = Math.floor(b.pos.y / cellSize);
    const key = cx + ',' + cy;
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(b);
  }
}

function getNeighbors(b) {
  const cx = Math.floor(b.pos.x / cellSize);
  const cy = Math.floor(b.pos.y / cellSize);
  const neighbors = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cell = grid.get((cx + dx) + ',' + (cy + dy));
      if (cell) neighbors.push(...cell);
    }
  }
  return neighbors;
}

/* ============================================================
   Flock management
   ============================================================ */
let boids = [];

function initializeSystem() {
  rng = mulberry32(params.seed);
  boids = [];
  for (let i = 0; i < params.boidCount; i++) boids.push(new Boid());
  ctx.fillStyle = params.bgColor;
  ctx.fillRect(0, 0, viewW, viewH);
}

function adjustBoidCount(newCount) {
  newCount = Math.round(newCount);
  if (newCount > boids.length) {
    for (let i = boids.length; i < newCount; i++) boids.push(new Boid());
  } else {
    boids.length = newCount;
  }
}

/* ============================================================
   Click / touch interaction — pull the flock toward the pointer
   ============================================================ */
let isAttracting = false;
const pointer = new Vec2();

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return new Vec2(
    ((e.clientX - rect.left) / rect.width) * viewW,
    ((e.clientY - rect.top) / rect.height) * viewH
  );
}
canvas.addEventListener('pointerdown', (e) => {
  isAttracting = true;
  pointer.x = pointerPos(e).x; pointer.y = pointerPos(e).y;
  canvas.setPointerCapture(e.pointerId);
  stageHint.classList.add('fade');
});
canvas.addEventListener('pointermove', (e) => {
  if (!isAttracting) return;
  const p = pointerPos(e);
  pointer.x = p.x; pointer.y = p.y;
});
canvas.addEventListener('pointerup', () => { isAttracting = false; });
canvas.addEventListener('pointercancel', () => { isAttracting = false; });

const stageHint = document.getElementById('stageHint');

/* ============================================================
   Render loop
   ============================================================ */
let fpsAcc = 0, fpsFrames = 0, lastT = 0;
const fpsEl = document.getElementById('fpsReadout');

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastT) lastT = now;
  const dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;

  const bg = params.bgColor;
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  ctx.fillStyle = `rgba(${r},${g},${b},${params.trailFade})`;
  ctx.fillRect(0, 0, viewW, viewH);

  buildGrid();
  for (const boid of boids) {
    boid.flock(getNeighbors(boid));
    if (params.wallAvoidanceEnabled) boid.avoidWalls();
    if (isAttracting) boid.attract(pointer);
    boid.update();
    boid.edges();
    boid.show();
  }

  if (isAttracting) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5 && fpsEl) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc) + ' fps'; fpsAcc = 0; fpsFrames = 0; }
}

/* ============================================================
   Control wiring
   ============================================================ */
const $ = (id) => document.getElementById(id);
const out = (id, v) => { const el = $(id); if (el) el.value = v; };

function bindRange(id, fmt, after) {
  const el = $(id);
  const apply = () => {
    const v = parseFloat(el.value);
    out(id + 'Out', fmt ? fmt(v) : String(v));
    if (after) after(v);
  };
  el.addEventListener('input', apply);
  apply();
}
function bindCheck(id, after) {
  const el = $(id);
  const apply = () => { if (after) after(el.checked); };
  el.addEventListener('change', apply);
  apply();
}

const one = (v) => v.toFixed(1);
const intFmt = (v) => String(Math.round(v));

bindRange('boidCount', intFmt, (v) => { params.boidCount = Math.round(v); adjustBoidCount(v); });
bindRange('perception', intFmt, (v) => { params.perception = v; });
bindRange('separation', one, (v) => { params.separation = v; });
bindRange('alignment', one, (v) => { params.alignment = v; });
bindRange('cohesion', one, (v) => { params.cohesion = v; });
bindRange('maxSpeed', one, (v) => { params.maxSpeed = v; });
bindRange('trailFade', (v) => v.toFixed(2), (v) => { params.trailFade = v; });
bindRange('wallAvoidance', one, (v) => { params.wallAvoidance = v; });
bindRange('attraction', one, (v) => { params.attraction = v; });

const wallGroup = $('wallAvoidanceGroup');
bindCheck('wallToggle', (v) => {
  params.wallAvoidanceEnabled = v;
  wallGroup.style.opacity = v ? '1' : '0.4';
});

$('boidColor').addEventListener('input', (e) => {
  params.boidColor = e.target.value;
  out('boidColorOut', e.target.value);
});
$('bgColor').addEventListener('input', (e) => {
  params.bgColor = e.target.value;
  out('bgColorOut', e.target.value);
  ctx.fillStyle = params.bgColor;
  ctx.fillRect(0, 0, viewW, viewH);
});

/* ---------- seed controls ---------- */
const seedInput = $('seedInput');
function setSeed(seed) {
  params.seed = Math.max(1, Math.round(seed));
  seedInput.value = params.seed;
  initializeSystem();
}
seedInput.addEventListener('change', () => {
  const v = parseInt(seedInput.value, 10);
  setSeed(Number.isFinite(v) && v > 0 ? v : params.seed);
});
$('prevSeedBtn').addEventListener('click', () => setSeed(params.seed - 1));
$('nextSeedBtn').addEventListener('click', () => setSeed(params.seed + 1));
$('randomSeedBtn').addEventListener('click', () => setSeed(Math.floor(Math.random() * 999999) + 1));

/* ---------- actions ---------- */
$('regenBtn').addEventListener('click', () => initializeSystem());

$('resetBtn').addEventListener('click', () => {
  Object.assign(params, defaultParams);

  out('boidCountOut', intFmt(params.boidCount)); $('boidCount').value = params.boidCount;
  out('perceptionOut', intFmt(params.perception)); $('perception').value = params.perception;
  out('separationOut', one(params.separation)); $('separation').value = params.separation;
  out('alignmentOut', one(params.alignment)); $('alignment').value = params.alignment;
  out('cohesionOut', one(params.cohesion)); $('cohesion').value = params.cohesion;
  out('maxSpeedOut', one(params.maxSpeed)); $('maxSpeed').value = params.maxSpeed;
  out('trailFadeOut', params.trailFade.toFixed(2)); $('trailFade').value = params.trailFade;
  out('wallAvoidanceOut', one(params.wallAvoidance)); $('wallAvoidance').value = params.wallAvoidance;
  out('attractionOut', one(params.attraction)); $('attraction').value = params.attraction;

  $('wallToggle').checked = params.wallAvoidanceEnabled;
  wallGroup.style.opacity = params.wallAvoidanceEnabled ? '1' : '0.4';

  $('boidColor').value = params.boidColor; out('boidColorOut', params.boidColor);
  $('bgColor').value = params.bgColor; out('bgColorOut', params.bgColor);

  setSeed(defaultParams.seed);
});

$('downloadBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = 'murmuration_' + params.seed + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
});

/* ============================================================
   Learn / algorithm primer overlay (identical pattern to /pendulum/)
   ============================================================ */
(function setupLearn() {
  const overlay = document.getElementById('learnOverlay');
  const panel = document.getElementById('learnPanel');
  const openers = [document.getElementById('learnBtn'), document.getElementById('learnBtn2')];
  const closeBtn = document.getElementById('learnClose');
  const trigger = document.getElementById('learnBtn');
  let mathRendered = false, lastFocus = null;

  function renderMath() {
    if (mathRendered) return;
    if (typeof window.renderMathInElement === 'function') {
      window.renderMathInElement(document.getElementById('learnBody'), {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
      mathRendered = true;
    }
  }
  function renderMathWhenReady() {
    if (mathRendered) return;
    renderMath();
    if (!mathRendered) { let n = 0; const t = setInterval(() => { renderMath(); if (mathRendered || ++n > 40) clearInterval(t); }, 100); }
  }

  function open() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    renderMathWhenReady();
    panel.focus();
    document.addEventListener('keydown', onKey);
  }
  function close() {
    overlay.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      const f = panel.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  openers.forEach((b) => b && b.addEventListener('click', open));
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  renderMathWhenReady();
})();

/* ============================================================
   Kick-off
   ============================================================ */
params.seed = Math.floor(Math.random() * 999999) + 1;
defaultParams.seed = params.seed;
seedInput.value = params.seed;
resize();
initializeSystem();
requestAnimationFrame(frame);
