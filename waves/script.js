// Ocean Waves — a single propagating wave (any of six theories) with a
// particle-velocity arrow grid showing orbital decay with depth, plus a
// static six-theory comparison overlay. Plain 2D canvas, no dependencies.

const G = 9.80665;

/* ============================================================
   Dispersion relation: omega^2 = g*k*tanh(k*h), solved for k
   given omega and depth h, via Newton-Raphson warm-started from
   the deep-water limit. Shared by every theory on this page.
   ============================================================ */
function solveK(omega, h) {
  if (omega <= 0) return 0;
  const k0 = (omega * omega) / G;
  if (!isFinite(h) || h <= 0) return k0;
  let k = k0 / Math.sqrt(Math.tanh(k0 * h) || 1e-9);
  for (let i = 0; i < 8; i++) {
    const kh = k * h, t = Math.tanh(kh);
    const f = G * k * t - omega * omega;
    const fp = G * t + G * k * h * (1 - t * t);
    if (Math.abs(fp) < 1e-12) break;
    const dk = f / fp;
    k -= dk;
    if (k <= 0) k = k0 * 0.5;
    if (Math.abs(dk) < 1e-10 * k0) break;
  }
  return k;
}

function khRegime(kh) {
  if (kh < 0.3) return 'Shallow';
  if (kh > Math.PI) return 'Deep';
  return 'Intermediate';
}

/* ============================================================
   Jacobi elliptic cn(u,m) and the complete elliptic integral
   K(m), both via the arithmetic-geometric mean (AGM) descending
   Landen transform (Numerical Recipes "sncndn" / Abramowitz &
   Stegun 16.4) — self-contained, no library needed.
   ============================================================ */
function sncndn(u, m) {
  m = Math.min(Math.max(m, 0), 0.999999);
  const a = [1], b = [Math.sqrt(1 - m)], c = [Math.sqrt(m)];
  let n = 0;
  while (Math.abs(c[n]) > 1e-9 && n < 30) {
    a.push((a[n] + b[n]) / 2);
    b.push(Math.sqrt(a[n] * b[n]));
    c.push((a[n] - b[n]) / 2);
    n++;
  }
  let phi = Math.pow(2, n) * a[n] * u;
  for (let i = n; i > 0; i--) {
    const s = (c[i] / a[i]) * Math.sin(phi);
    phi = (Math.asin(s) + phi) / 2;
  }
  return { sn: Math.sin(phi), cn: Math.cos(phi) };
}

function ellipticK(m) {
  m = Math.min(Math.max(m, 0), 0.999999);
  let a = 1, b = Math.sqrt(1 - m);
  for (let i = 0; i < 30; i++) {
    const an = (a + b) / 2, bn = Math.sqrt(a * b);
    a = an; b = bn;
    if (Math.abs(a - b) < 1e-12) break;
  }
  return Math.PI / (2 * a);
}

// mean of cn^2(u,m) over one full period (4K(m)), sampled numerically —
// used to re-center the cnoidal/solitary profile around zero mean elevation.
function meanCn2(m, Km) {
  const N = 40;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const { cn } = sncndn((4 * Km * i) / N, m);
    s += cn * cn;
  }
  return s / N;
}

/* ============================================================
   Wave parameters and per-theory surface elevation
   ============================================================ */
const params = { T0: 8, H: 1, depth: 40 };
const carrier = { omega0: 0, k0: 0, lambda0: 0, c: 0 };
const cnoidalState = { m: 0, Km: 0, mean: 0 };

// Solitary wave: the cnoidal family's m -> 1 limit, fixed once — the
// elliptic machinery here is identical, only m is pinned rather than
// driven by the Ursell number.
const SOLITARY_M = 0.999;
const solitaryKm = ellipticK(SOLITARY_M);
const solitaryMean = meanCn2(SOLITARY_M, solitaryKm);

function updateCarrier() {
  carrier.omega0 = (2 * Math.PI) / params.T0;
  carrier.k0 = solveK(carrier.omega0, params.depth);
  carrier.lambda0 = (2 * Math.PI) / carrier.k0;
  carrier.c = carrier.omega0 / carrier.k0;

  // Cnoidal: Ursell number drives a simplified, documented approximation
  // of the elliptic parameter m (see the in-page primer's caveats) —
  // not the full cnoidal/KdV dispersion closure.
  const Ur = (params.H * carrier.lambda0 * carrier.lambda0) / Math.pow(params.depth, 3);
  cnoidalState.m = Math.min(Math.max(Math.tanh(Ur / 20), 0), 0.999);
  cnoidalState.Km = ellipticK(cnoidalState.m);
  cnoidalState.mean = meanCn2(cnoidalState.m, cnoidalState.Km);

  updateReadouts();
}

// Harmonic sets driving Linear / Stokes-2nd / Stokes-5th elevation and
// velocity alike: order 1 is linear-only, order 2 adds the Stokes 2nd-order
// correction at 2*theta, order 5 extends that pattern with a simplified,
// documented harmonic-truncation approximation at 3*theta..5*theta (see
// the primer's caveats — not the full Fenton 1985 coefficient set).
function stokesHarmonics(order) {
  const { H, depth } = params;
  const harmonics = [{ n: 1, amp: H / 2 }];
  if (order >= 2) {
    const k = carrier.k0, lambda = carrier.lambda0;
    const kh = Math.max(k * depth, 0.05); // avoid coth blow-up in very shallow water
    const cothKh = 1 / Math.tanh(kh);
    let c2 = (Math.PI * H / 8) * (H / lambda) * cothKh * (3 * cothKh * cothKh - 1);
    const cap = 0.6 * H; // display-only clamp: Stokes 2nd-order isn't valid this shallow anyway
    c2 = Math.max(-cap, Math.min(cap, c2));
    harmonics.push({ n: 2, amp: c2 });
    if (order >= 5) {
      const FALLOFF = 0.45;
      harmonics.push({ n: 3, amp: c2 * FALLOFF });
      harmonics.push({ n: 4, amp: c2 * FALLOFF * FALLOFF });
      harmonics.push({ n: 5, amp: c2 * FALLOFF * FALLOFF * FALLOFF });
    }
  }
  return harmonics;
}

function profileFromHarmonics(harmonics, x, t) {
  const k = carrier.k0, omega = carrier.omega0;
  let eta = 0;
  for (const { n, amp } of harmonics) {
    eta += amp * Math.cos(n * (k * x - omega * t));
  }
  return eta;
}

function linearProfile(x, t) { return profileFromHarmonics(stokesHarmonics(1), x, t); }
function stokesProfile(x, t) { return profileFromHarmonics(stokesHarmonics(2), x, t); }
function stokes5Profile(x, t) { return profileFromHarmonics(stokesHarmonics(5), x, t); }

function cnoidalProfile(x, t) {
  const { H } = params;
  const { m, Km, mean } = cnoidalState;
  const lambda = carrier.lambda0;
  const u = ((2 * Km) / lambda) * (x - carrier.c * t);
  const { cn } = sncndn(u, m);
  return H * (cn * cn - mean);
}

function solitaryProfile(x, t) {
  const { H } = params;
  const lambda = carrier.lambda0;
  const u = ((2 * solitaryKm) / lambda) * (x - carrier.c * t);
  const { cn } = sncndn(u, SOLITARY_M);
  return H * (cn * cn - solitaryMean);
}

// Gerstner (trochoidal) surface — exact deep-water nonlinear solution.
// Particles labeled by mean position x0 trace circles; for z0=0 this
// parametrically traces the surface trochoid (not a function eta(x)).
function gerstnerPosition(x0, t) {
  const a = params.H / 2, k = carrier.k0, omega = carrier.omega0;
  const phi = k * x0 - omega * t;
  return { x: x0 - a * Math.sin(phi), z: a * Math.cos(phi) };
}

const PROFILE_FNS = {
  linear: linearProfile,
  stokes2: stokesProfile,
  stokes5: stokes5Profile,
  cnoidal: cnoidalProfile,
  solitary: solitaryProfile
};
const THEORY_COLORS = {
  linear: '#5EC8E0',
  stokes2: '#E0A23D',
  stokes5: '#E0653D',
  cnoidal: '#E0708A',
  solitary: '#4FB286',
  trochoidal: '#9B7EE0'
};
const THEORY_NAMES = {
  linear: 'Linear (Airy)',
  stokes2: 'Stokes 2nd-order',
  stokes5: 'Stokes 5th-order',
  cnoidal: 'Cnoidal',
  solitary: 'Solitary',
  trochoidal: 'Trochoidal (Gerstner)'
};

/* ============================================================
   Per-theory particle velocity field (u, w), z measured from
   still water level (z=0) down to the seabed (z=-h).
   ============================================================ */
function harmonicVelocity(harmonics, x, z, t) {
  const { depth: h } = params;
  const k = carrier.k0, omega = carrier.omega0;
  let u = 0, w = 0;
  for (const { n, amp } of harmonics) {
    const theta = n * (k * x - omega * t);
    const nkh = Math.max(n * k * h, 1e-6);
    const sh = Math.sinh(nkh) || 1e-6;
    const coeff = amp * n * omega;
    u += coeff * (Math.cosh(n * k * (z + h)) / sh) * Math.cos(theta);
    w += coeff * (Math.sinh(n * k * (z + h)) / sh) * Math.sin(theta);
  }
  return { u, w };
}

// Shallow-water (Boussinesq) long-wave approximation for cnoidal/solitary:
// horizontal velocity nearly depth-uniform, vertical recovered from
// continuity — the direct contrast to the deep-water theories' e^{kz} decay.
function shallowVelocity(etaFn, x, z, t) {
  const { depth: h } = params;
  const dx = Math.max(carrier.lambda0 * 0.005, 1e-4);
  const eL = etaFn(x - dx, t), eR = etaFn(x + dx, t);
  const detadx = (eR - eL) / (2 * dx);
  const eta = etaFn(x, t);
  const c = carrier.c;
  const u = (c * eta) / h;
  const dudx = (c * detadx) / h;
  const w = -(z + h) * dudx;
  return { u, w };
}

function gerstnerVelocity(x, z, t) {
  const { H } = params;
  const a = H / 2;
  const k = carrier.k0, omega = carrier.omega0;
  const phi = k * x - omega * t;
  const decay = Math.exp(Math.min(k * z, 0));
  return { u: a * omega * decay * Math.cos(phi), w: a * omega * decay * Math.sin(phi) };
}

function velocityField(theory, x, z, t) {
  switch (theory) {
    case 'linear': return harmonicVelocity(stokesHarmonics(1), x, z, t);
    case 'stokes2': return harmonicVelocity(stokesHarmonics(2), x, z, t);
    case 'stokes5': return harmonicVelocity(stokesHarmonics(5), x, z, t);
    case 'cnoidal': return shallowVelocity(cnoidalProfile, x, z, t);
    case 'solitary': return shallowVelocity(solitaryProfile, x, z, t);
    case 'trochoidal': return gerstnerVelocity(x, z, t);
    default: return { u: 0, w: 0 };
  }
}

/* ============================================================
   Canvas setup
   ============================================================ */
const waveCv = document.getElementById('wave');
const compareCv = document.getElementById('compare');
const waveSub = document.querySelector('.substage-wave');
const compareSub = document.querySelector('.substage-compare');
const waveCtx = waveCv.getContext('2d');
const compareCtx = compareCv.getContext('2d');
const DEEP = '#04141C';

let dpr = 1;
let waveW = 1, waveH = 1, compareW = 1, compareH = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  waveW = waveSub.clientWidth || 1;
  waveH = waveSub.clientHeight || 1;
  compareW = compareSub.clientWidth || 1;
  compareH = compareSub.clientHeight || 1;

  waveCv.width = Math.round(waveW * dpr);
  waveCv.height = Math.round(waveH * dpr);
  waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  compareCv.width = Math.round(compareW * dpr);
  compareCv.height = Math.round(compareH * dpr);
  compareCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) {
  new ResizeObserver(resize).observe(waveSub);
  new ResizeObserver(resize).observe(compareSub);
}

/* ============================================================
   Render loop — simTime advances at wall-clock rate scaled by
   speed; no integration is needed (every theory here is a
   closed-form function of x and t), but the fixed-step
   accumulator keeps the convention consistent with /pendulum/.
   ============================================================ */
const FIXED_DT = 1 / 240;
const MAX_STEPS_PER_FRAME = 20;
let simTime = 0, acc = 0, lastT = 0, fpsAcc = 0, fpsFrames = 0;
let speedMul = 1, paused = false, activeTheory = 'linear', showArrows = true;
let compareLinear = true, compareStokes2 = true, compareStokes5 = false;
let compareCnoidal = true, compareSolitary = false, compareTrochoidal = false;
const fpsEl = document.getElementById('fpsReadout');
const exaggerationHintEl = document.getElementById('exaggerationHint');

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastT) lastT = now;
  let dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;

  if (!paused) {
    acc += dt * speedMul;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      simTime += FIXED_DT;
      acc -= FIXED_DT;
      steps++;
    }
  }

  drawWave(simTime);
  drawCompare(simTime);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5 && fpsEl) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc) + ' fps'; fpsAcc = 0; fpsFrames = 0; }
}

function sampleSurface(theory, x, t) {
  if (theory === 'trochoidal') return gerstnerPosition(x, t).z;
  const fn = PROFILE_FNS[theory];
  return fn ? fn(x, t) : 0;
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) {
    ctx.beginPath();
    ctx.arc(x1, y1, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const ang = Math.atan2(dy, dx);
  const headLen = Math.min(6, len * 0.5);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(ang - Math.PI / 6), y2 - headLen * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(ang + Math.PI / 6), y2 - headLen * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawWave(t) {
  waveCtx.fillStyle = DEEP;
  waveCtx.fillRect(0, 0, waveW, waveH);

  const lambda = carrier.lambda0;
  if (!isFinite(lambda) || lambda <= 0) return;
  const width = lambda; // one wavelength, scrolling
  const depth = params.depth;
  const visibleDepth = Math.max(Math.min(depth, 1.5 * lambda), 1e-3);
  const seabedVisible = depth <= visibleDepth + 1e-6;

  const midY = waveH * 0.32;
  const usableHeight = waveH * 0.6;
  const depthScale = usableHeight / visibleDepth; // px per metre, depth axis
  const exaggeration = Math.max(1, visibleDepth / (6 * Math.max(params.H, 0.05)));
  const ampScale = depthScale * exaggeration;

  // still-water line
  waveCtx.setLineDash([5, 5]);
  waveCtx.strokeStyle = 'rgba(237,232,221,0.55)';
  waveCtx.lineWidth = 1.4;
  waveCtx.beginPath();
  waveCtx.moveTo(0, midY);
  waveCtx.lineTo(waveW, midY);
  waveCtx.stroke();
  waveCtx.setLineDash([]);

  // seabed
  if (seabedVisible) {
    const seabedY = midY + depth * depthScale;
    waveCtx.strokeStyle = 'rgba(184,174,156,0.7)';
    waveCtx.lineWidth = 2;
    waveCtx.beginPath();
    waveCtx.moveTo(0, seabedY);
    waveCtx.lineTo(waveW, seabedY);
    waveCtx.stroke();
  } else {
    waveCtx.fillStyle = 'rgba(237,232,221,0.5)';
    waveCtx.font = '11px IBM Plex Mono, monospace';
    waveCtx.fillText('seabed below view (' + Math.round(depth) + ' m)', 12, waveH - 14);
  }

  // wave curve
  const color = THEORY_COLORS[activeTheory];
  const cols = Math.max(2, Math.min(waveW, 360));
  waveCtx.strokeStyle = color;
  waveCtx.lineWidth = 2.4;
  waveCtx.beginPath();
  for (let i = 0; i <= cols; i++) {
    let x, eta;
    if (activeTheory === 'trochoidal') {
      const x0 = (i / cols) * width;
      const p = gerstnerPosition(x0, t);
      x = p.x; eta = p.z;
    } else {
      x = (i / cols) * width;
      eta = sampleSurface(activeTheory, x, t);
    }
    const px = (((x % width) + width) % width) / width * waveW;
    const py = midY - eta * ampScale;
    if (i === 0) waveCtx.moveTo(px, py); else waveCtx.lineTo(px, py);
  }
  waveCtx.stroke();

  if (showArrows) {
    const COLS = 6, ROWS = 7;
    let maxSpeed = 1e-6;
    const pts = [];
    for (let j = 0; j < ROWS; j++) {
      const z = -(j / (ROWS - 1)) * visibleDepth;
      for (let i = 0; i < COLS; i++) {
        const x = ((i + 0.5) / COLS) * width;
        const { u, w } = velocityField(activeTheory, x, z, t);
        const speed = Math.hypot(u, w);
        if (speed > maxSpeed) maxSpeed = speed;
        pts.push({ x, z, u, w });
      }
    }
    const velScale = 30 / maxSpeed;
    for (const p of pts) {
      const px = (p.x / width) * waveW;
      const baseY = midY - p.z * depthScale;
      const px2 = px + p.u * velScale;
      const py2 = baseY - p.w * velScale;
      drawArrow(waveCtx, px, baseY, px2, py2, 'rgba(237,232,221,0.85)');
    }
  }

  if (exaggerationHintEl) {
    exaggerationHintEl.textContent = 'wave height ×' + exaggeration.toFixed(1) + ' for visibility';
  }
}

function drawCompare(t) {
  compareCtx.fillStyle = DEEP;
  compareCtx.fillRect(0, 0, compareW, compareH);

  const width = carrier.lambda0; // one wavelength
  if (!isFinite(width) || width <= 0) return;
  const midY = compareH * 0.55;
  const ampScale = (compareH * 0.36) / Math.max(params.H, 0.05);
  const cols = Math.max(2, Math.min(compareW, 360));

  compareCtx.strokeStyle = 'rgba(237,232,221,0.18)';
  compareCtx.lineWidth = 1;
  compareCtx.beginPath();
  compareCtx.moveTo(0, midY);
  compareCtx.lineTo(compareW, midY);
  compareCtx.stroke();

  const theories = [
    { on: compareLinear, theory: 'linear' },
    { on: compareStokes2, theory: 'stokes2' },
    { on: compareStokes5, theory: 'stokes5' },
    { on: compareCnoidal, theory: 'cnoidal' },
    { on: compareSolitary, theory: 'solitary' },
    { on: compareTrochoidal, theory: 'trochoidal' }
  ];

  for (const th of theories) {
    if (!th.on) continue;
    compareCtx.strokeStyle = THEORY_COLORS[th.theory];
    compareCtx.lineWidth = 2.2;
    compareCtx.beginPath();
    for (let i = 0; i <= cols; i++) {
      let x, eta;
      if (th.theory === 'trochoidal') {
        const x0 = (i / cols) * width;
        const p = gerstnerPosition(x0, t);
        x = p.x; eta = p.z;
      } else {
        x = (i / cols) * width;
        eta = sampleSurface(th.theory, x, t);
      }
      const px = (((x % width) + width) % width) / width * compareW;
      const py = midY - eta * ampScale;
      if (i === 0) compareCtx.moveTo(px, py); else compareCtx.lineTo(px, py);
    }
    compareCtx.stroke();
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
const intFmt = (v) => String(Math.round(v));

function updateReadouts() {
  const kh = carrier.k0 * params.depth;
  const regimeEl = $('regimeOut');
  const cEl = $('cOut');
  const lambdaEl = $('lambdaOut');
  if (regimeEl) regimeEl.textContent = khRegime(kh);
  if (cEl) cEl.textContent = carrier.c.toFixed(2) + ' m/s';
  if (lambdaEl) lambdaEl.textContent = carrier.lambda0.toFixed(1) + ' m';
}

bindRange('period0', one, (v) => { params.T0 = v; updateCarrier(); });
bindRange('waveHeight', one, (v) => { params.H = v; updateCarrier(); });
bindRange('depth', intFmt, (v) => { params.depth = v; updateCarrier(); });

bindRange('speed', one, (v) => { speedMul = v; });
bindCheck('showArrows', (v) => { showArrows = v; });

document.querySelectorAll('input[name="theory"]').forEach((el) => {
  el.addEventListener('change', () => { if (el.checked) activeTheory = el.value; });
});

bindCheck('compareLinear', (v) => { compareLinear = v; });
bindCheck('compareStokes2', (v) => { compareStokes2 = v; });
bindCheck('compareStokes5', (v) => { compareStokes5 = v; });
bindCheck('compareCnoidal', (v) => { compareCnoidal = v; });
bindCheck('compareSolitary', (v) => { compareSolitary = v; });
bindCheck('compareTrochoidal', (v) => { compareTrochoidal = v; });

const pauseBtn = $('pauseBtn');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.setAttribute('aria-pressed', String(paused));
});

/* ============================================================
   Learn / physics primer overlay (identical pattern to /blackhole/,
   /pendulum/)
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
updateCarrier();
resize();
requestAnimationFrame(frame);
