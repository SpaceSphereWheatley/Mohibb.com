// track.js — procedural circuit via a rounded-polygon generator. A convex hull
// of random points is given concave pockets (midpoint displacement) and tuned
// to a target corner count, then every vertex is replaced by a fillet arc whose
// radius is set by how sharply it turns (sharp = hairpin, shallow = sweeper),
// leaving genuine straights between corners. One long edge is forced to be the
// start-finish straight; a tight chicane is dropped onto another straight.

import { closedPolyline, segmentsIntersect } from './geometry.js';
import { config } from './config.js';

export const SEG = {
  STRAIGHT: 'straight',
  SWEEPER: 'sweeper',
  BRAKING: 'braking',
  APEX: 'apex',
  ACCEL: 'accel',
  START_FINISH: 'start_finish',
  PIT_ENTRY: 'pit_entry',
  PIT_EXIT: 'pit_exit',
};

// ---- small vector helpers ----
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const vlen = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = vlen(a) || 1; return { x: a.x / l, y: a.y / l }; };
const perp = (a) => ({ x: -a.y, y: a.x });

// Andrew's monotone-chain convex hull (returns CCW ring).
function convexHull(P) {
  P = P.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

const centroid = (P) => {
  let x = 0, y = 0;
  for (const p of P) { x += p.x; y += p.y; }
  return { x: x / P.length, y: y / P.length };
};

// interior angle (radians) between the two edges meeting at vertex i
function turnAngle(P, i) {
  const N = P.length, B = P[i], A = P[(i - 1 + N) % N], C = P[(i + 1) % N];
  const u1 = norm(sub(A, B)), u2 = norm(sub(C, B));
  return Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
}

function ringSelfIntersects(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a1 = P[i], a2 = P[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(a1, a2, P[j], P[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Build the waypoint polygon: hull -> displacement -> chicane -> target count.
function generateWaypoints(rng) {
  const t = config.track;
  const cloud = [];
  const k = t.pointCloud + Math.floor(rng.next() * 9);
  for (let i = 0; i < k; i++) cloud.push({ x: (rng.next() - 0.5) * t.spreadX, y: (rng.next() - 0.5) * t.spreadY });
  let P = convexHull(cloud);
  if (P.length < 5) {                       // pathological cloud -> jittered ring
    P = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; P.push({ x: Math.cos(a) * 300, y: Math.sin(a) * 220 }); }
  }

  // concave pockets: displace some long-edge midpoints, mostly inward
  const C = centroid(P);
  let out = [];
  for (let i = 0; i < P.length; i++) {
    const A = P[i], B = P[(i + 1) % P.length];
    out.push(A);
    const l = vlen(sub(B, A));
    if (l > 150 && rng.next() < 0.6) {
      const M = mul(add(A, B), 0.5);
      const inward = norm(sub(C, M));
      const sign = rng.next() < 0.72 ? 1 : -1;
      out.push(add(M, mul(inward, l * (0.12 + rng.next() * 0.26) * sign)));
    }
  }
  // drop degenerate short edges
  P = out.filter((p, i) => vlen(sub(p, out[(i - 1 + out.length) % out.length])) > 48);
  if (P.length < 7) P = out;

  // chicane: a tight S on the longest edge (+2 corners)
  P = addChicane(P, rng);

  // tune to a target corner count
  const target = t.cornersMin + Math.floor(rng.next() * (t.cornersMax - t.cornersMin + 1));
  let guard = 0;
  while (P.length < target && guard++ < 80) {
    let li = -1, ll = 0;
    for (let i = 0; i < P.length; i++) {
      if (P[i].chic || P[(i + 1) % P.length].chic) continue;
      const l = vlen(sub(P[(i + 1) % P.length], P[i]));
      if (l > ll) { ll = l; li = i; }
    }
    if (li < 0) break;
    const a = P[li], b = P[(li + 1) % P.length], M = mul(add(a, b), 0.5);
    const inward = norm(sub(centroid(P), M));
    P.splice(li + 1, 0, add(M, mul(inward, ll * (0.1 + rng.next() * 0.22) * (rng.next() < 0.6 ? 1 : -1))));
  }
  guard = 0;
  while (P.length > target && guard++ < 80) {
    let si = -1, sa = -1;                    // remove the shallowest (straightest) corner
    for (let i = 0; i < P.length; i++) { if (P[i].chic) continue; const a = turnAngle(P, i); if (a > sa) { sa = a; si = i; } }
    if (si < 0) break;
    P.splice(si, 1);
  }

  // per-corner radius jitter
  for (const p of P) if (p.rj === undefined) p.rj = 0.7 + rng.next() * 0.6;

  // start-finish = longest non-chicane edge
  let sfIndex = 0, sfLen = 0;
  for (let i = 0; i < P.length; i++) {
    if (P[i].chic || P[(i + 1) % P.length].chic) continue;
    const l = vlen(sub(P[(i + 1) % P.length], P[i]));
    if (l > sfLen) { sfLen = l; sfIndex = i; }
  }
  return { pts: P, sfIndex, sfLen };
}

function addChicane(P, rng) {
  let bi = -1, bl = 0;
  for (let i = 0; i < P.length; i++) { const l = vlen(sub(P[(i + 1) % P.length], P[i])); if (l > bl) { bl = l; bi = i; } }
  if (bl < 170) return P;
  const a = P[bi], b = P[(bi + 1) % P.length], dir = norm(sub(b, a)), n = perp(dir), w = 30;
  const c1 = { ...add(add(a, mul(dir, bl * 0.40)), mul(n, w)), rj: 0.5, chic: true };
  const c2 = { ...add(add(a, mul(dir, bl * 0.60)), mul(n, -w)), rj: 0.5, chic: true };
  const out = [...P];
  out.splice(bi + 1, 0, c1, c2);
  return out;
}

// speed (m/s) a corner of fillet radius r supports
function cornerSpeed(r) {
  const t = config.track;
  return Math.min(t.straightSpeed - 4, t.cornerSpeedBase + t.cornerSpeedK * r);
}

function metaForType(type, baseSpeed) {
  const t = config.track;
  const narrow = type === SEG.APEX || type === SEG.BRAKING;
  return {
    type,
    baseSpeed,
    width: t.width * (narrow ? t.cornerWidthFactor : 1),
    overtake: type === SEG.STRAIGHT ? 1 : type === SEG.BRAKING ? 0.7
      : type === SEG.ACCEL ? 0.35 : type === SEG.SWEEPER ? 0.18 : 0.04,
    drs: type === SEG.STRAIGHT,
  };
}

// Fillet every vertex; emit a dense centre-line of arc points + straight points,
// each tagged with segment metadata. Returns points, aligned meta, and the
// world coordinate of the start-finish line.
function buildCenterline(P, sfIndex) {
  const t = config.track;
  const N = P.length;
  const corner = [];                         // per vertex: { Pin, Pout, arc:[{x,y,meta}] }
  for (let i = 0; i < N; i++) {
    const B = P[i], A = P[(i - 1 + N) % N], Cn = P[(i + 1) % N];
    const u1 = norm(sub(A, B)), u2 = norm(sub(Cn, B));
    const l1 = vlen(sub(A, B)), l2 = vlen(sub(Cn, B));
    const ang = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    const half = ang / 2;
    const sharp = 1 - ang / Math.PI;         // 0 straight .. 1 hairpin
    let r = (t.fastRadius - sharp * (t.fastRadius - t.hairpinRadius)) * (B.rj || 1);
    if (B.chic) r = t.hairpinRadius;
    let tan = r / Math.tan(half);
    const tmax = 0.45 * Math.min(l1, l2);
    if (tan > tmax) { tan = tmax; r = tan * Math.tan(half); }
    const Pin = add(B, mul(u1, tan)), Pout = add(B, mul(u2, tan));
    const center = add(B, mul(norm(add(u1, u2)), r / Math.sin(half)));
    let a0 = Math.atan2(Pin.y - center.y, Pin.x - center.x);
    let a1 = Math.atan2(Pout.y - center.y, Pout.x - center.x);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const steps = Math.max(4, Math.round(Math.abs(d) / 0.16));
    const slow = r < t.hairpinRadius * 2.3;
    const spd = cornerSpeed(r);
    const arc = [];
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const a = a0 + d * f;
      const type = f < 0.3 ? SEG.BRAKING : f > 0.7 ? SEG.ACCEL : (slow ? SEG.APEX : SEG.SWEEPER);
      const bs = type === SEG.BRAKING ? Math.min(t.straightSpeed - 4, spd * 1.15)
        : type === SEG.ACCEL ? Math.min(t.straightSpeed - 4, spd * 1.22) : spd;
      arc.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r, meta: metaForType(type, bs) });
    }
    corner.push({ Pin, Pout, arc });
  }

  // assemble ring: arc_i, then straight from Pout_i to Pin_{i+1}
  const pts = [], meta = [];
  let sfPoint = null;
  for (let i = 0; i < N; i++) {
    for (const a of corner[i].arc) { pts.push({ x: a.x, y: a.y }); meta.push(a.meta); }
    const from = corner[i].Pout, to = corner[(i + 1) % N].Pin;
    const segLen = vlen(sub(to, from));
    const steps = Math.max(1, Math.floor(segLen / 12));
    for (let s = 1; s < steps; s++) {        // interior straight points only
      const f = s / steps;
      pts.push({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f });
      meta.push(metaForType(SEG.STRAIGHT, config.track.straightSpeed));
    }
    if (i === sfIndex) sfPoint = mul(add(from, to), 0.5);
  }
  if (!sfPoint) sfPoint = pts[0];
  return { pts, meta, sfPoint };
}

export class Track {
  constructor(rng) {
    const t = config.track;
    this.halfWidth = t.width / 2;

    // generate until we get a clean (non-self-intersecting) layout
    let wp, cl;
    for (let attempt = 0; attempt < 24; attempt++) {
      wp = generateWaypoints(rng);
      if (!ringSelfIntersects(wp.pts) || attempt === 23) break;
    }
    cl = buildCenterline(wp.pts, wp.sfIndex);

    this.line = closedPolyline(cl.pts);
    this.length = this.line.length;
    this.segMeta = cl.meta.map((m, i) => ({ ...m, dist: this.line.pts[i].dist }));
    this.sfLen = wp.sfLen;

    // start-finish distance = sample nearest the S/F midpoint
    this.sfDist = this._distOfPoint(cl.sfPoint);

    this._tagStartFinish();
    this._buildPitLane(rng);
  }

  _distOfPoint(p) {
    let best = 0, bd = Infinity;
    for (const q of this.line.pts) {
      const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d2 < bd) { bd = d2; best = q.dist; }
    }
    return best;
  }

  // metadata for the metre at distance d
  metaAt(d) {
    const i = this.line.indexAt(this.line.wrap(d));
    return this.segMeta[i];
  }

  _tagStartFinish() {
    const win = 18; // metres
    for (let i = 0; i < this.segMeta.length; i++) {
      let d = this.segMeta[i].dist - this.sfDist;
      d = ((d % this.length) + this.length) % this.length;
      if (d < win || d > this.length - win) {
        this.segMeta[i] = { ...this.segMeta[i], type: SEG.START_FINISH };
      }
    }
  }

  // A separate, offset path leaving the racing line before the start-finish
  // line and rejoining after it. The longer, speed-limited path *is* the time
  // loss. Spans are sized to the S/F straight so entry/exit stay on it.
  _buildPitLane() {
    const off = config.pit.offset;
    const half = Math.min(150, Math.max(90, this.sfLen * 0.45));
    const entry = this.line.wrap(this.sfDist - half);
    const exit = this.line.wrap(this.sfDist + half);
    this.pit = { entryDist: entry, exitDist: exit, speed: config.pit.speed };

    const span = this.line.wrap(exit - entry);
    const steps = Math.max(30, Math.floor(span / 4));
    const samples = [];
    let acc = 0, prev = null;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const ease = Math.sin(Math.min(f, 1 - f) * Math.PI);
      const d = this.line.wrap(entry + span * f);
      const p = this.line.offsetAt(d, off * ease);
      if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
      p.dist = acc;
      p.isBox = f > 0.42 && f < 0.58;
      samples.push(p);
      prev = p;
    }
    this.pit.samples = samples;
    this.pit.length = acc;
    this.pit.boxIndex = samples.findIndex((p) => p.isBox);

    this._tagRange(entry, this.line.wrap(entry + 24), SEG.PIT_ENTRY);
    this._tagRange(this.line.wrap(exit - 24), exit, SEG.PIT_EXIT);
  }

  _tagRange(from, to, type) {
    for (let i = 0; i < this.segMeta.length; i++) {
      const d = this.segMeta[i].dist;
      const within = from < to ? (d >= from && d <= to) : (d >= from || d <= to);
      if (within) this.segMeta[i] = { ...this.segMeta[i], type };
    }
  }

  // world point at pit-path parameter u in [0,1]
  pitAt(u) {
    const s = this.pit;
    const target = Math.max(0, Math.min(1, u)) * s.length;
    let lo = 0, hi = s.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s.samples[mid].dist <= target) lo = mid; else hi = mid - 1;
    }
    const a = s.samples[lo], b = s.samples[Math.min(lo + 1, s.samples.length - 1)];
    const segLen = (b.dist - a.dist) || 1;
    const f = (target - a.dist) / segLen;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      heading: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
}
