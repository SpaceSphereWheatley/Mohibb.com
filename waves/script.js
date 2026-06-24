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
   Bessel functions J0, J1, Y0, Y1 (Numerical Recipes rational-
   approximation form, valid for all real x — needed by the
   MacCamy-Fuchs diffraction correction below). Two branches: a
   rational-polynomial fit for |x|<8, an asymptotic cosine/sine
   expansion above that.
   ============================================================ */
function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const ans1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7
      + y * (-11214424.18 + y * (77392.33017 + y * (-184.9052456)))));
    const ans2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718
      + y * (59272.64853 + y * (267.8532712 + y * 1.0))));
    return ans1 / ans2;
  }
  const z = 8.0 / ax, y = z * z, xx = ax - 0.785398164;
  const ans1 = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4
    + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const ans2 = -0.1562499995e-1 + y * (0.1430488765e-3
    + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);
}

function besselJ1(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const ans1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1
      + y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
    const ans2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74
      + y * (99447.43394 + y * (376.9991397 + y * 1.0))));
    return ans1 / ans2;
  }
  const z = 8.0 / ax, y = z * z, xx = ax - 2.356194491;
  const ans1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4
    + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
  const ans2 = 0.04687499995 + y * (-0.2002690873e-3
    + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  let ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);
  if (x < 0) ans = -ans;
  return ans;
}

function besselY0(x) {
  if (x < 8) {
    const y = x * x;
    const ans1 = -2957821389.0 + y * (7062834065.0 + y * (-512359803.6
      + y * (10879881.29 + y * (-86327.92757 + y * 228.4622733))));
    const ans2 = 40076544269.0 + y * (745249964.8 + y * (7189466.438
      + y * (47447.26470 + y * (226.1030244 + y * 1.0))));
    return (ans1 / ans2) + 0.636619772 * besselJ0(x) * Math.log(x);
  }
  const z = 8.0 / x, y = z * z, xx = x - 0.785398164;
  const ans1 = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4
    + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const ans2 = -0.1562499995e-1 + y * (0.1430488765e-3
    + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * (-0.934945152e-7))));
  return Math.sqrt(0.636619772 / x) * (Math.sin(xx) * ans1 + z * Math.cos(xx) * ans2);
}

function besselY1(x) {
  if (x < 8) {
    const y = x * x;
    const ans1 = x * (-0.4900604943e13 + y * (0.1275274390e13
      + y * (-0.5153438139e11 + y * (0.7349264551e9
      + y * (-0.4237922726e7 + y * 0.8511937935e4)))));
    const ans2 = 0.2499580570e14 + y * (0.4244419664e12
      + y * (0.3733650367e10 + y * (0.2245904002e8
      + y * (0.1020426050e6 + y * (0.3549632885e3 + y)))));
    return (ans1 / ans2) + 0.636619772 * (besselJ1(x) * Math.log(x) - 1.0 / x);
  }
  const z = 8.0 / x, y = z * z, xx = x - 2.356194491;
  const ans1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4
    + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
  const ans2 = 0.04687499995 + y * (-0.2002690873e-3
    + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  return Math.sqrt(0.636619772 / x) * (Math.sin(xx) * ans1 + z * Math.cos(xx) * ans2);
}

// Derivatives of J1/Y1 via the standard recurrence J0(x)-J1(x)/x (same
// recurrence for Y).
function besselJ1p(x) { return besselJ0(x) - besselJ1(x) / x; }
function besselY1p(x) { return besselY0(x) - besselY1(x) / x; }

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

  updateIrregular();
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

// Horizontal particle acceleration, du/dt of harmonicVelocity above —
// same depth-attenuation shape, coefficient amp*(n*omega)^2, cos -> sin.
function harmonicAcceleration(harmonics, x, z, t) {
  const { depth: h } = params;
  const k = carrier.k0, omega = carrier.omega0;
  let ax = 0;
  for (const { n, amp } of harmonics) {
    const theta = n * (k * x - omega * t);
    const nkh = Math.max(n * k * h, 1e-6);
    const sh = Math.sinh(nkh) || 1e-6;
    const coeff = amp * n * omega * (n * omega);
    ax += coeff * (Math.cosh(n * k * (z + h)) / sh) * Math.sin(theta);
  }
  return ax;
}

/* ============================================================
   Monopile wave forces — Morison's equation (drag + inertia),
   the MacCamy-Fuchs (1954) diffraction correction, and the same
   loads estimated for the irregular sea above. z is measured
   from still water level (z=0) down to the seabed (z=-h), same
   convention as harmonicVelocity/harmonicAcceleration.
   ============================================================ */
const pile = { D: 6, Cd: 1.0, Cm: 2.0, rho: 1025, wheelerOn: true };

// Wheeler (1970) stretching: remaps the physical depth z (which can sit
// above z=0 up to the instantaneous surface eta) into z', the coordinate
// the cosh/sinh attenuation above is actually valid on, [-h,0]. With
// stretching off, z is simply clamped at the still-water line instead.
function wheelerZ(z, eta, h, on) {
  if (on) return (h * (z - eta)) / (h + eta);
  return Math.min(z, 0);
}

// Per-unit-length Morison force, drag + inertia, at depth z and time t.
function morisonLineForce(harmonics, x, z, eta, t, opts) {
  const { depth: h } = params;
  const zp = wheelerZ(z, eta, h, opts.wheelerOn);
  const { u } = harmonicVelocity(harmonics, x, zp, t);
  const ax = harmonicAcceleration(harmonics, x, zp, t);
  return 0.5 * opts.rho * opts.Cd * opts.D * Math.abs(u) * u
    + opts.rho * opts.Cm * (Math.PI * opts.D * opts.D / 4) * ax;
}

// Total base shear F(t) and overturning moment M(t) (about the seabed),
// via trapezoidal integration from the seabed up to the instantaneous
// surface — no closed form once Wheeler stretching + drag are involved.
function morisonForceAndMoment(harmonics, t, opts) {
  const h = params.depth;
  const eta = profileFromHarmonics(harmonics, 0, t);
  const N = 80, dz = (h + eta) / N;
  let F = 0, M = 0;
  for (let i = 0; i <= N; i++) {
    const z = -h + i * dz;
    const f = morisonLineForce(harmonics, 0, z, eta, t, opts);
    const w = (i === 0 || i === N) ? 0.5 : 1;
    F += f * w * dz;
    M += f * (z + h) * w * dz;
  }
  return { F, M, eta };
}

// MacCamy-Fuchs (1954) linear diffraction correction — accounts for the
// pile's finite diameter scattering the incident wave, which Morison's
// equation (a slender-body approximation) ignores. Closed form in terms
// of Bessel functions of the first/second kind, order 1.
function maccamyFuchs(harmonics, t, opts) {
  const k = carrier.k0, h = params.depth, omega = carrier.omega0;
  const H = harmonics.length ? harmonics[0].amp * 2 : 0; // linear/Stokes-2 fundamental height
  const ka = k * opts.D / 2;
  if (ka < 1e-6) return { F: 0, M: 0 };
  const J1p = besselJ1p(ka), Y1p = besselY1p(ka);
  const A = 1 / Math.sqrt(J1p * J1p + Y1p * Y1p);
  const alpha = Math.atan2(J1p, Y1p);
  const F = opts.rho * G * H * Math.tanh(k * h) * (2 / (k * k)) * A * Math.cos(omega * t - alpha);
  const sh = Math.sinh(k * h) || 1e-9;
  const lever = h / Math.tanh(k * h) - (Math.cosh(k * h) - 1) / (k * sh);
  return { F, M: F * lever };
}

// Keulegan-Carpenter number and the D/lambda diffraction parameter —
// engineering regime guidance for when MacCamy-Fuchs matters (DNV-RP-C205
// rule of thumb: D/lambda >= 0.2 is where diffraction becomes significant).
function pileRegime(D) {
  const k = carrier.k0, h = params.depth, omega = carrier.omega0, T = params.T0, H = params.H;
  const uMax = (H / 2) * omega / Math.tanh(k * h);
  const KC = D > 0 ? (uMax * T) / D : 0;
  const ka = k * D / 2;
  const DL = (D * k) / (2 * Math.PI);
  return { KC, ka, DL };
}

// Irregular-sea kinematics: each JONSWAP component behaves like a tiny
// linear wave, so velocity/acceleration sum the same way evalIrregular
// sums elevation.
function evalIrregularKinematics(x, z, t) {
  let u = 0, ax = 0;
  for (let i = 0; i < irregularComponents.length; i++) {
    const { omega, k, amp } = irregularComponents[i];
    const theta = k * x - omega * t + irregularPhases[i];
    const kh = Math.max(k * params.depth, 1e-6);
    const att = Math.cosh(k * (z + params.depth)) / (Math.sinh(kh) || 1e-6);
    u += amp * omega * att * Math.cos(theta);
    ax += amp * omega * omega * att * Math.sin(theta);
  }
  return { u, ax };
}

function irregularForceAndMoment(t, opts) {
  const h = params.depth;
  const eta = evalIrregular(0, t);
  const N = 80, dz = (h + eta) / N;
  let F = 0, M = 0;
  for (let i = 0; i <= N; i++) {
    const z = -h + i * dz;
    const zp = wheelerZ(z, eta, h, opts.wheelerOn);
    const { u, ax } = evalIrregularKinematics(0, zp, t);
    const f = 0.5 * opts.rho * opts.Cd * opts.D * Math.abs(u) * u
      + opts.rho * opts.Cm * (Math.PI * opts.D * opts.D / 4) * ax;
    const w = (i === 0 || i === N) ? 0.5 : 1;
    F += f * w * dz;
    M += f * (z + h) * w * dz;
  }
  return { F, M };
}

// Samples irregular-sea base shear/moment over a window of several peak
// periods and returns RMS + observed max — an empirical, sampling-based
// statistic (not a distributional extreme-value estimate).
function irregularForceStats(opts) {
  const Tp = irregular.Tp;
  const dur = Math.max(Tp * 25, 200);
  const N = 300;
  let sumF2 = 0, sumM2 = 0, maxF = 0, maxM = 0;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * dur;
    const { F, M } = irregularForceAndMoment(t, opts);
    sumF2 += F * F; sumM2 += M * M;
    if (Math.abs(F) > maxF) maxF = Math.abs(F);
    if (Math.abs(M) > maxM) maxM = Math.abs(M);
  }
  return { rmsF: Math.sqrt(sumF2 / N), rmsM: Math.sqrt(sumM2 / N), maxF, maxM };
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
   Irregular sea — JONSWAP spectrum, random-phase superposition.
   ============================================================ */
const irregular = { Hs: 1.5, Tp: 8, gamma: 3.3 };
let irregularComponents = []; // [{ omega, k, amp }], rebuilt on Hs/Tp/gamma/depth change
let irregularPhases = [];     // fixed per component, only reseeded on demand
const IRREGULAR_N = 56;

// Raw (unnormalized) JONSWAP spectral density at frequency f (Hz).
function jonswapSpectrum(f, fp, gamma) {
  if (f <= 0) return 0;
  const sigma = f <= fp ? 0.07 : 0.09;
  const r = Math.exp(-((f - fp) * (f - fp)) / (2 * sigma * sigma * fp * fp));
  const peak = Math.exp(-1.25 * Math.pow(fp / f, 4));
  return ((G * G) / (Math.pow(2 * Math.PI, 4) * Math.pow(f, 5))) * peak * Math.pow(gamma, r);
}

// Builds N frequency-bin components spanning the energetic part of the
// spectrum, then rescales every bin so the resulting significant height
// (4*sqrt(m0)) equals Hs exactly — sidesteps transcribing the usual
// approximate alpha(Hs,Tp) closed form (see the primer).
function buildIrregularComponents(Hs, Tp, gamma, depth) {
  const fp = 1 / Tp;
  const fMin = 0.4 * fp, fMax = 3 * fp;
  const df = (fMax - fMin) / IRREGULAR_N;
  const raw = [];
  let m0raw = 0;
  for (let i = 0; i < IRREGULAR_N; i++) {
    const f = fMin + (i + 0.5) * df;
    const S0 = jonswapSpectrum(f, fp, gamma);
    raw.push({ f, S0 });
    m0raw += S0 * df;
  }
  const targetM0 = (Hs / 4) * (Hs / 4);
  const scale = m0raw > 0 ? targetM0 / m0raw : 0;
  const next = [];
  for (const { f, S0 } of raw) {
    const S = S0 * scale;
    const omega = 2 * Math.PI * f;
    const k = solveK(omega, depth);
    const amp = Math.sqrt(2 * S * df);
    next.push({ omega, k, amp });
  }
  return next;
}

function randomizeIrregularPhases() {
  irregularPhases = irregularComponents.map(() => Math.random() * 2 * Math.PI);
}

function updateIrregular() {
  irregularComponents = buildIrregularComponents(irregular.Hs, irregular.Tp, irregular.gamma, params.depth);
  if (irregularPhases.length !== irregularComponents.length) randomizeIrregularPhases();
}

function evalIrregular(x, t) {
  let eta = 0;
  for (let i = 0; i < irregularComponents.length; i++) {
    const { omega, k, amp } = irregularComponents[i];
    eta += amp * Math.cos(k * x - omega * t + irregularPhases[i]);
  }
  return eta;
}

/* ============================================================
   Canvas setup
   ============================================================ */
const waveCv = document.getElementById('wave');
const compareCv = document.getElementById('compare');
const irregularCv = document.getElementById('irregular');
const pileCv = document.getElementById('pile');
const forceChartCv = document.getElementById('forceChart');
const waveSub = document.querySelector('.substage-wave');
const compareSub = document.querySelector('.substage-compare');
const irregularSub = document.querySelector('.substage-irregular');
const pileSub = document.querySelector('.substage-pile-section');
const forceSub = document.querySelector('.substage-force');
const waveCtx = waveCv.getContext('2d');
const compareCtx = compareCv.getContext('2d');
const irregularCtx = irregularCv.getContext('2d');
const pileCtx = pileCv.getContext('2d');
const forceChartCtx = forceChartCv.getContext('2d');
const DEEP = '#04141C';

let dpr = 1;
let waveW = 1, waveH = 1, compareW = 1, compareH = 1, irregularW = 1, irregularH = 1;
let pileW = 1, pileH = 1, forceW = 1, forceH = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  waveW = waveSub.clientWidth || 1;
  waveH = waveSub.clientHeight || 1;
  compareW = compareSub.clientWidth || 1;
  compareH = compareSub.clientHeight || 1;
  irregularW = irregularSub.clientWidth || 1;
  irregularH = irregularSub.clientHeight || 1;
  pileW = pileSub.clientWidth || 1;
  pileH = pileSub.clientHeight || 1;
  forceW = forceSub.clientWidth || 1;
  forceH = forceSub.clientHeight || 1;

  waveCv.width = Math.round(waveW * dpr);
  waveCv.height = Math.round(waveH * dpr);
  waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  compareCv.width = Math.round(compareW * dpr);
  compareCv.height = Math.round(compareH * dpr);
  compareCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  irregularCv.width = Math.round(irregularW * dpr);
  irregularCv.height = Math.round(irregularH * dpr);
  irregularCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  pileCv.width = Math.round(pileW * dpr);
  pileCv.height = Math.round(pileH * dpr);
  pileCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  forceChartCv.width = Math.round(forceW * dpr);
  forceChartCv.height = Math.round(forceH * dpr);
  forceChartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) {
  new ResizeObserver(resize).observe(waveSub);
  new ResizeObserver(resize).observe(compareSub);
  new ResizeObserver(resize).observe(irregularSub);
  new ResizeObserver(resize).observe(pileSub);
  new ResizeObserver(resize).observe(forceSub);
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
const irregularHintEl = document.getElementById('irregularHint');
const pileHintEl = document.getElementById('pileHint');

// Force-calculator state
let forceTheory = 'linear', showMorison = true, showMF = true;
let forceSeries = []; // [{ t, F, M, Fmf, Mmf }] over one wave period, rebuilt on input change
let forcePeaks = { F: 0, M: 0 };

function rebuildForceSeries() {
  const harmonics = stokesHarmonics(forceTheory === 'stokes2' ? 2 : 1);
  const T = params.T0;
  const N = 100;
  const series = [];
  let peakF = 0, peakM = 0;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T;
    const { F, M } = morisonForceAndMoment(harmonics, t, pile);
    const mf = maccamyFuchs(harmonics, t, pile);
    const Fmf = F + mf.F, Mmf = M + mf.M;
    series.push({ t, F, M, Fmf, Mmf });
    const fCompare = showMF ? Math.abs(Fmf) : Math.abs(F);
    const mCompare = showMF ? Math.abs(Mmf) : Math.abs(M);
    if (fCompare > peakF) peakF = fCompare;
    if (mCompare > peakM) peakM = mCompare;
  }
  forceSeries = series;
  forcePeaks = { F: peakF, M: peakM };
}

function updatePileReadouts() {
  const { KC, DL } = pileRegime(pile.D);
  const kcEl = $('kcOut'), dlEl = $('dlOut'), dlItemEl = $('dlItem');
  const peakFEl = $('peakFOut'), peakMEl = $('peakMOut');
  if (kcEl) kcEl.textContent = KC.toFixed(2);
  if (dlEl) dlEl.textContent = DL.toFixed(3);
  if (dlItemEl) {
    dlItemEl.classList.toggle('near-breaking', DL >= 0.12 && DL < 0.2);
    dlItemEl.classList.toggle('breaking', DL >= 0.2);
  }
  if (peakFEl) peakFEl.textContent = (forcePeaks.F / 1e3).toFixed(1) + ' kN';
  if (peakMEl) peakMEl.textContent = (forcePeaks.M / 1e6).toFixed(2) + ' MN·m';
}

function updateIrregularForceReadouts() {
  const stats = irregularForceStats(pile);
  const rmsFEl = $('rmsFOut'), rmsMEl = $('rmsMOut'), maxFEl = $('maxFOut'), maxMEl = $('maxMOut');
  if (rmsFEl) rmsFEl.textContent = (stats.rmsF / 1e3).toFixed(1) + ' kN';
  if (rmsMEl) rmsMEl.textContent = (stats.rmsM / 1e6).toFixed(2) + ' MN·m';
  if (maxFEl) maxFEl.textContent = (stats.maxF / 1e3).toFixed(1) + ' kN';
  if (maxMEl) maxMEl.textContent = (stats.maxM / 1e6).toFixed(2) + ' MN·m';
}

let irregularForceTimer = null;
function scheduleIrregularForceUpdate() {
  if (irregularForceTimer) clearTimeout(irregularForceTimer);
  irregularForceTimer = setTimeout(updateIrregularForceReadouts, 150);
}

function refreshForceCalc() {
  rebuildForceSeries();
  updatePileReadouts();
  scheduleIrregularForceUpdate();
}

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
  drawIrregular(simTime);
  drawPileSection(simTime);
  drawForceChart(simTime);

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

function drawIrregular(t) {
  irregularCtx.fillStyle = DEEP;
  irregularCtx.fillRect(0, 0, irregularW, irregularH);

  const fp = 1 / irregular.Tp;
  const kp = solveK(2 * Math.PI * fp, params.depth);
  const lambdaP = kp > 0 ? (2 * Math.PI) / kp : irregular.Tp * irregular.Tp; // fallback if kp ~ 0
  const width = Math.max(lambdaP * 4, 1e-3); // a few peak wavelengths visible at once

  const midY = irregularH * 0.5;
  const ampScale = (irregularH * 0.3) / Math.max(irregular.Hs, 0.1);
  const cols = Math.max(2, Math.min(irregularW, 420));

  // still-water line
  irregularCtx.setLineDash([5, 5]);
  irregularCtx.strokeStyle = 'rgba(237,232,221,0.55)';
  irregularCtx.lineWidth = 1.4;
  irregularCtx.beginPath();
  irregularCtx.moveTo(0, midY);
  irregularCtx.lineTo(irregularW, midY);
  irregularCtx.stroke();
  irregularCtx.setLineDash([]);

  // irregular surface, filled below the curve for a "water" look
  const pts = [];
  let sumSq = 0;
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * width;
    const eta = evalIrregular(x, t);
    sumSq += eta * eta;
    const px = (i / cols) * irregularW;
    const py = midY - eta * ampScale;
    pts.push({ px, py });
  }

  irregularCtx.beginPath();
  irregularCtx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) irregularCtx.lineTo(pts[i].px, pts[i].py);
  irregularCtx.lineTo(irregularW, irregularH);
  irregularCtx.lineTo(0, irregularH);
  irregularCtx.closePath();
  irregularCtx.fillStyle = 'rgba(127,217,196,0.16)';
  irregularCtx.fill();

  irregularCtx.strokeStyle = 'rgba(127,217,196,0.9)';
  irregularCtx.lineWidth = 2.2;
  irregularCtx.beginPath();
  irregularCtx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) irregularCtx.lineTo(pts[i].px, pts[i].py);
  irregularCtx.stroke();

  if (irregularHintEl) {
    const computedHs = 4 * Math.sqrt(sumSq / (cols + 1));
    irregularHintEl.textContent = 'Hs ≈ ' + computedHs.toFixed(2) + ' m (target ' + irregular.Hs.toFixed(2) + ' m)';
  }
}

// Pile cross-section: vertical pile from seabed to instantaneous surface,
// with arrows showing the local Morison line force f(z,t) at the current
// animation time, plus a dashed overlay of MacCamy-Fuchs's depth profile
// (linear theory's cosh shape, rescaled to the diffraction-corrected total).
function drawPileSection(t) {
  pileCtx.fillStyle = DEEP;
  pileCtx.fillRect(0, 0, pileW, pileH);

  const harmonics = stokesHarmonics(forceTheory === 'stokes2' ? 2 : 1);
  const h = params.depth;
  const eta = profileFromHarmonics(harmonics, 0, t);
  const midY = pileH * 0.12;
  const usableHeight = pileH * 0.78;
  const depthScale = usableHeight / Math.max(h, 1e-3);
  const px = pileW * 0.32;

  pileCtx.setLineDash([5, 5]);
  pileCtx.strokeStyle = 'rgba(237,232,221,0.55)';
  pileCtx.lineWidth = 1.4;
  pileCtx.beginPath();
  pileCtx.moveTo(0, midY);
  pileCtx.lineTo(pileW, midY);
  pileCtx.stroke();
  pileCtx.setLineDash([]);

  const seabedY = midY + h * depthScale;
  pileCtx.strokeStyle = 'rgba(184,174,156,0.7)';
  pileCtx.lineWidth = 2;
  pileCtx.beginPath();
  pileCtx.moveTo(0, seabedY);
  pileCtx.lineTo(pileW, seabedY);
  pileCtx.stroke();

  // pile itself
  const etaY = midY - eta * depthScale;
  pileCtx.strokeStyle = 'rgba(237,232,221,0.85)';
  pileCtx.lineWidth = 6;
  pileCtx.beginPath();
  pileCtx.moveTo(px, etaY);
  pileCtx.lineTo(px, seabedY);
  pileCtx.stroke();

  // local Morison force arrows, sampled down the pile
  const N = 14;
  let maxF = 1e-6;
  const samples = [];
  for (let i = 0; i <= N; i++) {
    const z = -h + (i / N) * (h + eta);
    const f = morisonLineForce(harmonics, 0, z, eta, t, pile);
    samples.push({ z, f });
    if (Math.abs(f) > maxF) maxF = Math.abs(f);
  }
  const arrowScale = (pileW * 0.22) / maxF;
  for (const { z, f } of samples) {
    const y = midY - z * depthScale;
    drawArrow(pileCtx, px, y, px + f * arrowScale, y, 'rgba(94,200,224,0.9)');
  }

  // MacCamy-Fuchs overlay — linear theory's depth shape, rescaled to match
  // F_MF's amplitude/phase (a visualization convenience, not an
  // independently derived local force density; see the primer).
  if (showMF) {
    const mf = maccamyFuchs(harmonics, t, pile);
    const k = carrier.k0;
    const sh = Math.sinh(k * h) || 1e-9;
    let shapeIntegral = 0;
    const M = 40, dz = h / M;
    for (let i = 0; i <= M; i++) {
      const z = -h + i * dz;
      const w = (i === 0 || i === M) ? 0.5 : 1;
      shapeIntegral += (Math.cosh(k * (z + h)) / sh) * w * dz;
    }
    const norm = shapeIntegral > 1e-9 ? mf.F / shapeIntegral : 0;
    pileCtx.setLineDash([3, 3]);
    pileCtx.strokeStyle = 'rgba(155,126,224,0.85)';
    pileCtx.lineWidth = 1.6;
    pileCtx.beginPath();
    let started = false;
    for (let i = 0; i <= M; i++) {
      const z = -h + i * dz;
      const f = norm * (Math.cosh(k * (z + h)) / sh);
      const y = midY - z * depthScale;
      const xEnd = px + f * arrowScale;
      if (!started) { pileCtx.moveTo(xEnd, y); started = true; } else pileCtx.lineTo(xEnd, y);
    }
    pileCtx.stroke();
    pileCtx.setLineDash([]);
  }

  if (pileHintEl) {
    pileHintEl.textContent = 'D=' + pile.D.toFixed(1) + ' m, force arrows scaled for visibility';
  }
}

// Force/moment time-history chart over one wave period: Morison alone vs.
// Morison + MacCamy-Fuchs, with a marker tracking the current animation
// time (mod period) so it stays in sync with the pile cross-section.
function drawForceChart(t) {
  forceChartCtx.fillStyle = DEEP;
  forceChartCtx.fillRect(0, 0, forceW, forceH);
  if (!forceSeries.length) return;

  const T = params.T0;
  const midY = forceH * 0.5;
  const maxAbs = Math.max(forcePeaks.F, 1e-6);
  const ampScale = (forceH * 0.42) / maxAbs;
  const xScale = forceW / T;

  forceChartCtx.strokeStyle = 'rgba(237,232,221,0.18)';
  forceChartCtx.lineWidth = 1;
  forceChartCtx.beginPath();
  forceChartCtx.moveTo(0, midY);
  forceChartCtx.lineTo(forceW, midY);
  forceChartCtx.stroke();

  function plot(key, color) {
    forceChartCtx.strokeStyle = color;
    forceChartCtx.lineWidth = 2.2;
    forceChartCtx.beginPath();
    forceSeries.forEach((p, i) => {
      const x = p.t * xScale;
      const y = midY - p[key] * ampScale;
      if (i === 0) forceChartCtx.moveTo(x, y); else forceChartCtx.lineTo(x, y);
    });
    forceChartCtx.stroke();
  }
  if (showMorison) plot('F', 'rgba(94,200,224,0.9)');
  if (showMF) plot('Fmf', 'rgba(155,126,224,0.9)');

  const tMod = ((t % T) + T) % T;
  const markerX = tMod * xScale;
  forceChartCtx.strokeStyle = 'rgba(237,232,221,0.55)';
  forceChartCtx.lineWidth = 1.4;
  forceChartCtx.beginPath();
  forceChartCtx.moveTo(markerX, 0);
  forceChartCtx.lineTo(markerX, forceH);
  forceChartCtx.stroke();
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

// Miche (1944) breaking-height criterion: smoothly spans the deep-water
// limit Hb/lambda=0.142 (kh -> large) and the shallow-water limit
// Hb/depth ~ 0.89 (kh -> small, tanh(kh) ~ kh) in a single formula.
function micheBreakingHeight(lambda, kh) {
  return 0.142 * lambda * Math.tanh(kh);
}

function updateReadouts() {
  const kh = carrier.k0 * params.depth;
  const regimeEl = $('regimeOut');
  const cEl = $('cOut');
  const lambdaEl = $('lambdaOut');
  const breakingEl = $('breakingOut');
  const breakingItemEl = $('breakingItem');
  if (regimeEl) regimeEl.textContent = khRegime(kh);
  if (cEl) cEl.textContent = carrier.c.toFixed(2) + ' m/s';
  if (lambdaEl) lambdaEl.textContent = carrier.lambda0.toFixed(1) + ' m';
  if (breakingEl || breakingItemEl) {
    const Hb = micheBreakingHeight(carrier.lambda0, kh);
    const pct = Hb > 0 ? (params.H / Hb) * 100 : 0;
    if (breakingEl) breakingEl.textContent = pct.toFixed(0) + '% of Hb (' + Hb.toFixed(2) + ' m)';
    if (breakingItemEl) {
      breakingItemEl.classList.toggle('breaking', pct >= 100);
      breakingItemEl.classList.toggle('near-breaking', pct >= 80 && pct < 100);
    }
  }
}

bindRange('period0', one, (v) => { params.T0 = v; updateCarrier(); refreshForceCalc(); });
bindRange('waveHeight', one, (v) => { params.H = v; updateCarrier(); refreshForceCalc(); });
bindRange('depth', intFmt, (v) => { params.depth = v; updateCarrier(); refreshForceCalc(); });

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

bindRange('sigHeight', one, (v) => { irregular.Hs = v; updateIrregular(); scheduleIrregularForceUpdate(); });
bindRange('peakPeriod', one, (v) => { irregular.Tp = v; updateIrregular(); scheduleIrregularForceUpdate(); });
bindRange('peakedness', one, (v) => { irregular.gamma = v; updateIrregular(); scheduleIrregularForceUpdate(); });

const randomizeSeaBtn = $('randomizeSeaBtn');
if (randomizeSeaBtn) randomizeSeaBtn.addEventListener('click', () => { randomizeIrregularPhases(); scheduleIrregularForceUpdate(); });

const decimal2 = (v) => v.toFixed(2);
bindRange('pileDiameter', one, (v) => { pile.D = v; refreshForceCalc(); });
bindRange('pileCd', decimal2, (v) => { pile.Cd = v; refreshForceCalc(); });
bindRange('pileCm', decimal2, (v) => { pile.Cm = v; refreshForceCalc(); });

document.querySelectorAll('input[name="forceTheory"]').forEach((el) => {
  el.addEventListener('change', () => { if (el.checked) { forceTheory = el.value; refreshForceCalc(); } });
});
bindCheck('wheelerOn', (v) => { pile.wheelerOn = v; refreshForceCalc(); });
bindCheck('showMorison', (v) => { showMorison = v; });
bindCheck('showMF', (v) => { showMF = v; refreshForceCalc(); });

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
