// Double Pendulum — a swarm of double pendulums released from nearly
// identical starting angles, each tracing a colored fading trail. Plain 2D
// canvas, no dependencies: a fixed-timestep RK4 integrator drives the physics,
// decoupled from the requestAnimationFrame display loop.

/* ============================================================
   Physics: closed-form double-pendulum equations of motion,
   derived from the Lagrangian L = T - V (see the in-page primer).
   State per pendulum: [th1, w1, th2, w2].
   ============================================================ */
function derivative(y, p) {
  const [th1, w1, th2, w2] = y;
  const d = th1 - th2;
  const cosD = Math.cos(d), sinD = Math.sin(d);
  const cos2D = Math.cos(2 * d);
  const { g, L1, L2, m1, m2 } = p;

  const den1 = L1 * (2 * m1 + m2 - m2 * cos2D);
  let a1 = (
    -g * (2 * m1 + m2) * Math.sin(th1)
    - m2 * g * Math.sin(th1 - 2 * th2)
    - 2 * sinD * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cosD)
  ) / den1;

  const den2 = L2 * (2 * m1 + m2 - m2 * cos2D);
  let a2 = (
    2 * sinD * (w1 * w1 * L1 * (m1 + m2) + g * (m1 + m2) * Math.cos(th1) + w2 * w2 * L2 * m2 * cosD)
  ) / den2;

  // Pragmatic linear viscous damping per joint (engineering damping, not
  // first-principles air resistance) — at damping=0 this is exactly the
  // energy-conserving chaotic system.
  if (p.damping > 0) {
    a1 += -(p.damping * w1) / (L1 * L1 * (m1 + m2));
    a2 += -(p.damping * w2) / (L2 * L2 * m2);
  }

  return [w1, a1, w2, a2];
}

function rk4Step(y, dt, p) {
  const k1 = derivative(y, p);
  const y2 = y.map((v, i) => v + k1[i] * dt / 2);
  const k2 = derivative(y2, p);
  const y3 = y.map((v, i) => v + k2[i] * dt / 2);
  const k3 = derivative(y3, p);
  const y4 = y.map((v, i) => v + k3[i] * dt);
  const k4 = derivative(y4, p);
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/* ============================================================
   Swarm management
   ============================================================ */
const params = { g: 9.8, L1: 1, L2: 1, m1: 1, m2: 1, damping: 0 };
const DEFAULT_TH1 = 120 * Math.PI / 180, DEFAULT_TH2 = -10 * Math.PI / 180;
let baseTh1 = DEFAULT_TH1, baseTh2 = DEFAULT_TH2;
let swarm = [];
let speedMul = 1, trailFadeAlpha = 0.052, paused = false, showRig = true;

function colorFor(i, n) {
  const hue = n > 1 ? (360 * i) / n : 200;
  return `hsl(${hue},75%,62%)`;
}

function buildSwarm() {
  const size = swarm._size || 12;
  const spreadRad = (swarm._spreadDeg || 0.05) * Math.PI / 180;
  const next = [];
  for (let i = 0; i < size; i++) {
    const offset = (i - (size - 1) / 2) * spreadRad;
    next.push({
      th1: baseTh1 + offset, w1: 0,
      th2: baseTh2, w2: 0,
      color: colorFor(i, size),
      hasLast: false, lastX: 0, lastY: 0
    });
  }
  next._size = size;
  next._spreadDeg = swarm._spreadDeg || 0.05;
  swarm = next;
}

/* ============================================================
   Canvas setup
   ============================================================ */
const stage = document.querySelector('.stage');
const trailsCv = document.getElementById('trails');
const rigCv = document.getElementById('rig');
const trailsCtx = trailsCv.getContext('2d');
const rigCtx = rigCv.getContext('2d');
const VOID = '#0b0d12';

let dpr = 1, viewW = 1, viewH = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = stage.clientWidth || 1;
  viewH = stage.clientHeight || 1;
  for (const [cv, ctx] of [[trailsCv, trailsCtx], [rigCv, rigCtx]]) {
    cv.width = Math.round(viewW * dpr);
    cv.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  trailsCtx.fillStyle = VOID;
  trailsCtx.fillRect(0, 0, viewW, viewH);
  for (const p of swarm) p.hasLast = false;
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

function pivotAndScale() {
  const span = params.L1 + params.L2;
  const scale = (viewH * 0.42) / Math.max(span, 0.1);
  return { px: viewW / 2, py: viewH * 0.16, scale };
}

/* ============================================================
   Render loop — fixed-dt physics substeps decoupled from rAF
   ============================================================ */
const FIXED_DT = 1 / 240;
const MAX_STEPS_PER_FRAME = 20;
let acc = 0, lastT = 0, fpsAcc = 0, fpsFrames = 0;
const fpsEl = document.getElementById('fpsReadout');

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastT) lastT = now;
  let dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;

  if (!paused) {
    acc += dt * speedMul;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      for (const p of swarm) {
        const y = rk4Step([p.th1, p.w1, p.th2, p.w2], FIXED_DT, params);
        p.th1 = y[0]; p.w1 = y[1]; p.th2 = y[2]; p.w2 = y[3];
      }
      acc -= FIXED_DT;
      steps++;
    }
  }

  draw();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5 && fpsEl) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc) + ' fps'; fpsAcc = 0; fpsFrames = 0; }
}

function draw() {
  const { px, py, scale } = pivotAndScale();

  // fade the persistent trail layer toward the void background, then stroke
  // each pendulum's newest trail segment in its own color
  trailsCtx.fillStyle = `rgba(11,13,18,${trailFadeAlpha})`;
  trailsCtx.fillRect(0, 0, viewW, viewH);

  for (const p of swarm) {
    const x1 = px + Math.sin(p.th1) * params.L1 * scale;
    const y1 = py + Math.cos(p.th1) * params.L1 * scale;
    const x2 = x1 + Math.sin(p.th2) * params.L2 * scale;
    const y2 = y1 + Math.cos(p.th2) * params.L2 * scale;

    if (p.hasLast) {
      trailsCtx.strokeStyle = p.color;
      trailsCtx.lineWidth = 1.6;
      trailsCtx.beginPath();
      trailsCtx.moveTo(p.lastX, p.lastY);
      trailsCtx.lineTo(x2, y2);
      trailsCtx.stroke();
    }
    p.lastX = x2; p.lastY = y2; p.hasLast = true;
    p._x1 = x1; p._y1 = y1; p._x2 = x2; p._y2 = y2;
  }

  rigCtx.clearRect(0, 0, viewW, viewH);
  if (showRig) {
    for (const p of swarm) {
      rigCtx.strokeStyle = 'rgba(237,232,221,0.55)';
      rigCtx.lineWidth = 2;
      rigCtx.beginPath();
      rigCtx.moveTo(px, py);
      rigCtx.lineTo(p._x1, p._y1);
      rigCtx.lineTo(p._x2, p._y2);
      rigCtx.stroke();

      rigCtx.fillStyle = p.color;
      rigCtx.beginPath(); rigCtx.arc(p._x1, p._y1, 3.5, 0, Math.PI * 2); rigCtx.fill();
      rigCtx.beginPath(); rigCtx.arc(p._x2, p._y2, 5, 0, Math.PI * 2); rigCtx.fill();
    }
    rigCtx.fillStyle = 'rgba(237,232,221,0.8)';
    rigCtx.beginPath(); rigCtx.arc(px, py, 3, 0, Math.PI * 2); rigCtx.fill();
  }
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
const two = (v) => v.toFixed(2);
const three = (v) => v.toFixed(3);
const intFmt = (v) => String(Math.round(v));

bindRange('swarmSize', intFmt, (v) => { swarm._size = Math.round(v); buildSwarm(); });
bindRange('spread', three, (v) => { swarm._spreadDeg = v; buildSwarm(); });

bindRange('gravity', one, (v) => { params.g = v; });
bindRange('length1', two, (v) => { params.L1 = v; });
bindRange('length2', two, (v) => { params.L2 = v; });
bindRange('mass1', one, (v) => { params.m1 = v; });
bindRange('mass2', one, (v) => { params.m2 = v; });
bindRange('damping', two, (v) => { params.damping = v; });

bindRange('trailLength', intFmt, (v) => {
  trailFadeAlpha = 0.12 + (0.005 - 0.12) * ((v - 1) / 99);
});
bindRange('speed', one, (v) => { speedMul = v; });
bindCheck('showRig', (v) => { showRig = v; });

$('randomizeBtn').addEventListener('click', () => {
  baseTh1 = (60 + Math.random() * 120) * Math.PI / 180;
  baseTh2 = (-60 + Math.random() * 120) * Math.PI / 180;
  buildSwarm();
});
$('resetBtn').addEventListener('click', () => {
  baseTh1 = DEFAULT_TH1; baseTh2 = DEFAULT_TH2;
  buildSwarm();
});

const pauseBtn = $('pauseBtn');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.setAttribute('aria-pressed', String(paused));
});

/* ============================================================
   Learn / physics primer overlay (identical pattern to /blackhole/)
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
swarm._size = 12;
swarm._spreadDeg = 0.05;
buildSwarm();
resize();
requestAnimationFrame(frame);
