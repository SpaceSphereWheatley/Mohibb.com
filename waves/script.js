// Ocean Waves — a linear wave group (dispersion + superposition) animated
// live, alongside a single wave's height/period/depth re-evaluated under
// three different theories: Linear (Airy), Stokes 2nd-order, and cnoidal.
// Plain 2D canvas, no dependencies.

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

function groupVelocity(omega, k, h) {
  const c = omega / k;
  const kh = k * h;
  if (!isFinite(h) || kh > 20) return c / 2;
  const n = 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
  return n * c;
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
// used to re-center the cnoidal profile around zero mean elevation.
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
const params = { N: 5, T0: 8, spreadFrac: 0.18, H: 1, depth: 40 };
const carrier = { omega0: 0, k0: 0, lambda0: 0, c: 0, cg: 0 };
const cnoidalState = { m: 0, Km: 0, mean: 0 };
let components = [];

function updateCarrier() {
  carrier.omega0 = (2 * Math.PI) / params.T0;
  carrier.k0 = solveK(carrier.omega0, params.depth);
  carrier.lambda0 = (2 * Math.PI) / carrier.k0;
  carrier.c = carrier.omega0 / carrier.k0;
  carrier.cg = groupVelocity(carrier.omega0, carrier.k0, params.depth);

  buildComponents();

  // Cnoidal: Ursell number drives a simplified, documented approximation
  // of the elliptic parameter m (see the in-page primer's caveats) —
  // not the full cnoidal/KdV dispersion closure.
  const Ur = (params.H * carrier.lambda0 * carrier.lambda0) / Math.pow(params.depth, 3);
  cnoidalState.m = Math.min(Math.max(Math.tanh(Ur / 20), 0), 0.999);
  cnoidalState.Km = ellipticK(cnoidalState.m);
  cnoidalState.mean = meanCn2(cnoidalState.m, cnoidalState.Km);

  updateReadouts();
}

function buildComponents() {
  const N = params.N;
  const omega0 = carrier.omega0;
  const domega = params.spreadFrac * omega0;
  const sigma = 0.5 / Math.sqrt(2 * Math.log(1 / 0.15));
  const A0 = params.H / 2;
  const next = [];
  for (let i = 0; i < N; i++) {
    const frac = N > 1 ? i / (N - 1) - 0.5 : 0;
    const omega = omega0 + frac * domega;
    const k = solveK(omega, params.depth);
    const w = Math.exp(-(frac * frac) / (2 * sigma * sigma));
    next.push({ omega, k, amplitude: A0 * w });
  }
  components = next;
}

function evalGroup(x, t) {
  let eta = 0, re = 0, im = 0;
  for (const c of components) {
    const phase = c.k * x - c.omega * t;
    eta += c.amplitude * Math.cos(phase);
    im += c.amplitude * Math.sin(phase);
  }
  re = eta;
  return { eta, env: Math.sqrt(re * re + im * im) };
}

function linearProfile(x, t) {
  return (params.H / 2) * Math.cos(carrier.k0 * x - carrier.omega0 * t);
}

function stokesProfile(x, t) {
  const { H, depth } = params;
  const k = carrier.k0, omega = carrier.omega0;
  const theta = k * x - omega * t;
  const lambda = carrier.lambda0;
  const kh = Math.max(k * depth, 0.05); // avoid coth blow-up in very shallow water
  const cothKh = 1 / Math.tanh(kh);
  let correction = (Math.PI * H / 8) * (H / lambda) * cothKh * (3 * cothKh * cothKh - 1);
  const cap = 0.6 * H; // display-only clamp: Stokes 2nd-order isn't valid this shallow anyway
  correction = Math.max(-cap, Math.min(cap, correction));
  return (H / 2) * Math.cos(theta) + correction * Math.cos(2 * theta);
}

function cnoidalProfile(x, t) {
  const { H } = params;
  const { m, Km, mean } = cnoidalState;
  const lambda = carrier.lambda0;
  const u = ((2 * Km) / lambda) * (x - carrier.c * t);
  const { cn } = sncndn(u, m);
  return H * (cn * cn - mean);
}

/* ============================================================
   Canvas setup
   ============================================================ */
const stage = document.querySelector('.stage');
const surfaceCv = document.getElementById('surface');
const compareCv = document.getElementById('compare');
const surfaceSub = document.querySelector('.substage-surface');
const compareSub = document.querySelector('.substage-compare');
const surfaceCtx = surfaceCv.getContext('2d');
const compareCtx = compareCv.getContext('2d');
const DEEP = '#04141C';

let dpr = 1;
let surfaceW = 1, surfaceH = 1, compareW = 1, compareH = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  surfaceW = surfaceSub.clientWidth || 1;
  surfaceH = surfaceSub.clientHeight || 1;
  compareW = compareSub.clientWidth || 1;
  compareH = compareSub.clientHeight || 1;

  surfaceCv.width = Math.round(surfaceW * dpr);
  surfaceCv.height = Math.round(surfaceH * dpr);
  surfaceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  compareCv.width = Math.round(compareW * dpr);
  compareCv.height = Math.round(compareH * dpr);
  compareCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) {
  new ResizeObserver(resize).observe(surfaceSub);
  new ResizeObserver(resize).observe(compareSub);
}

/* ============================================================
   Crest tracers — positions where the carrier component's own
   phase crosses a crest (k0*x - omega0*t = 2*pi*n), recomputed
   analytically each frame rather than integrated.
   ============================================================ */
function centerCrestXs(t, width) {
  const lambda0 = carrier.lambda0;
  if (!isFinite(lambda0) || lambda0 <= 0) return [];
  const shift = (carrier.omega0 * t) / carrier.k0;
  const n0 = Math.ceil((0 - shift) / lambda0 - 1);
  const xs = [];
  for (let n = n0, guard = 0; guard < 200; n++, guard++) {
    const x = shift + n * lambda0;
    if (x > width) break;
    if (x >= 0) xs.push(x);
  }
  return xs;
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
let speedMul = 1, paused = false, showEnvelope = true, showTracers = true;
let showLinear = true, showStokes = true, showCnoidal = true;
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
      simTime += FIXED_DT;
      acc -= FIXED_DT;
      steps++;
    }
  }

  drawSurface(simTime);
  drawCompare(simTime);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5 && fpsEl) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc) + ' fps'; fpsAcc = 0; fpsFrames = 0; }
}

function drawSurface(t) {
  surfaceCtx.fillStyle = DEEP;
  surfaceCtx.fillRect(0, 0, surfaceW, surfaceH);

  const width = 6 * carrier.lambda0; // ~6 wavelengths of the carrier, always
  if (!isFinite(width) || width <= 0) return;
  const midY = surfaceH * 0.55;
  const ampScale = (surfaceH * 0.32) / Math.max(params.H * 0.7, 0.05);
  const xToPx = (x) => (x / width) * surfaceW;

  const cols = Math.max(2, Math.min(surfaceW, 480));
  const etas = new Array(cols + 1), envs = new Array(cols + 1);
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * width;
    const { eta, env } = evalGroup(x, t);
    etas[i] = eta; envs[i] = env;
  }

  if (showEnvelope) {
    surfaceCtx.strokeStyle = 'rgba(94,200,224,0.45)';
    surfaceCtx.lineWidth = 1.4;
    surfaceCtx.beginPath();
    for (let i = 0; i <= cols; i++) {
      const px = (i / cols) * surfaceW, py = midY - envs[i] * ampScale;
      if (i === 0) surfaceCtx.moveTo(px, py); else surfaceCtx.lineTo(px, py);
    }
    for (let i = cols; i >= 0; i--) {
      const px = (i / cols) * surfaceW, py = midY + envs[i] * ampScale;
      surfaceCtx.lineTo(px, py);
    }
    surfaceCtx.closePath();
    surfaceCtx.stroke();
  }

  surfaceCtx.strokeStyle = 'rgba(237,232,221,0.85)';
  surfaceCtx.lineWidth = 2;
  surfaceCtx.beginPath();
  for (let i = 0; i <= cols; i++) {
    const px = (i / cols) * surfaceW, py = midY - etas[i] * ampScale;
    if (i === 0) surfaceCtx.moveTo(px, py); else surfaceCtx.lineTo(px, py);
  }
  surfaceCtx.stroke();

  if (showTracers) {
    const xs = centerCrestXs(t, width);
    surfaceCtx.fillStyle = '#5EC8E0';
    for (const x of xs) {
      const { eta } = evalGroup(x, t);
      const px = xToPx(x), py = midY - eta * ampScale;
      surfaceCtx.beginPath();
      surfaceCtx.arc(px, py, 3.5, 0, Math.PI * 2);
      surfaceCtx.fill();
    }
  }
}

function drawCompare(t) {
  compareCtx.fillStyle = DEEP;
  compareCtx.fillRect(0, 0, compareW, compareH);

  const width = carrier.lambda0; // one wavelength of the carrier
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
    { on: showLinear, fn: linearProfile, color: '#5EC8E0' },
    { on: showStokes, fn: stokesProfile, color: '#E0A23D' },
    { on: showCnoidal, fn: cnoidalProfile, color: '#E0708A' }
  ];

  for (const th of theories) {
    if (!th.on) continue;
    compareCtx.strokeStyle = th.color;
    compareCtx.lineWidth = 2.2;
    compareCtx.beginPath();
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * width;
      const eta = th.fn(x, t);
      const px = (i / cols) * compareW, py = midY - eta * ampScale;
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
const two = (v) => v.toFixed(2);
const intFmt = (v) => String(Math.round(v));

function updateReadouts() {
  const kh = carrier.k0 * params.depth;
  const regimeEl = $('regimeOut');
  const cEl = $('cOut');
  const cgEl = $('cgOut');
  const lambdaEl = $('lambdaOut');
  if (regimeEl) regimeEl.textContent = khRegime(kh);
  if (cEl) cEl.textContent = carrier.c.toFixed(2) + ' m/s';
  if (cgEl) cgEl.textContent = carrier.cg.toFixed(2) + ' m/s';
  if (lambdaEl) lambdaEl.textContent = carrier.lambda0.toFixed(1) + ' m';
}

bindRange('numComponents', intFmt, (v) => { params.N = Math.round(v); updateCarrier(); });
bindRange('period0', one, (v) => { params.T0 = v; updateCarrier(); });
bindRange('spreadFrac', two, (v) => { params.spreadFrac = v; updateCarrier(); });
bindRange('waveHeight', one, (v) => { params.H = v; updateCarrier(); });
bindRange('depth', intFmt, (v) => { params.depth = v; updateCarrier(); });

bindRange('speed', one, (v) => { speedMul = v; });
bindCheck('showEnvelope', (v) => { showEnvelope = v; });
bindCheck('showTracers', (v) => { showTracers = v; });
bindCheck('showLinear', (v) => { showLinear = v; });
bindCheck('showStokes', (v) => { showStokes = v; });
bindCheck('showCnoidal', (v) => { showCnoidal = v; });

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
