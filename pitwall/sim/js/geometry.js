// geometry.js — spline maths. Turns a ring of control points into a smooth,
// closed Catmull-Rom curve, then bakes an arc-length table so the rest of the
// sim can work in a single scalar `distance` and ask for (x, y, heading) back.

// Catmull-Rom interpolation of one segment p1->p2 (p0/p3 are neighbours).
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

// Densely sample a closed Catmull-Rom loop through `pts`, returning an
// arc-length-indexed polyline with headings and per-point curvature.
export function buildClosedSpline(pts, samplesPerSeg = 24) {
  const n = pts.length;
  const raw = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < samplesPerSeg; s++) {
      raw.push(catmull(p0, p1, p2, p3, s / samplesPerSeg));
    }
  }
  return finishPolyline(raw);
}

// Build a Polyline directly from an already-sampled closed ring of points
// (no Catmull-Rom smoothing) — used by the rounded-polygon track generator,
// whose fillet arcs + straights are the final racing line and must not be
// re-rounded.
export function closedPolyline(raw) {
  return finishPolyline(raw);
}

// Shared post-processing: cumulative arc length, headings, curvature.
function finishPolyline(raw) {
  const m = raw.length;
  const pts = raw.map((p) => ({ x: p.x, y: p.y, dist: 0, heading: 0, curv: 0 }));
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    const dx = b.x - a.x, dy = b.y - a.y;
    a.heading = Math.atan2(dy, dx);
    a.segLen = Math.hypot(dx, dy);
    a.dist = acc;
    acc += a.segLen;
  }
  const length = acc;
  // curvature from heading change between neighbours
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m], next = pts[(i + 1) % m];
    let dh = next.heading - prev.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = prev.segLen + pts[i].segLen || 1;
    pts[i].curv = Math.abs(dh) / ds;
  }
  return new Polyline(pts, length);
}

// Test two segments (a1-a2) and (b1-b2) for intersection — used to reject
// self-crossing track layouts.
export function segmentsIntersect(a1, a2, b1, b2) {
  const d = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(b1, b2, a1), d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1), d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export class Polyline {
  constructor(pts, length) {
    this.pts = pts;
    this.length = length;
  }

  // wrap a distance into [0, length)
  wrap(d) {
    d %= this.length;
    return d < 0 ? d + this.length : d;
  }

  // binary-search the sample index whose cumulative dist is <= d
  indexAt(d) {
    const pts = this.pts;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].dist <= d) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // (x, y, heading, curv) at an arc-length distance, linearly interpolated
  at(d) {
    d = this.wrap(d);
    const i = this.indexAt(d);
    const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length];
    const f = a.segLen ? (d - a.dist) / a.segLen : 0;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      heading: a.heading,
      curv: a.curv + (b.curv - a.curv) * f,
    };
  }

  // a point offset perpendicular to the racing line (left/right of travel).
  // positive `off` is to the car's right.
  offsetAt(d, off) {
    const p = this.at(d);
    const nx = Math.sin(p.heading);   // right-hand normal of heading
    const ny = -Math.cos(p.heading);
    return { x: p.x + nx * off, y: p.y + ny * off, heading: p.heading };
  }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
}
