// track.js — procedural circuit. A seeded, noise-perturbed ring of control
// points becomes a smooth closed loop; curvature classifies each metre into a
// segment type (straight / sweeper / braking / apex / accel / start-finish /
// pit). A parallel pit lane branches before the line and rejoins after it.

import { createNoise2D } from 'simplex-noise';
import { buildClosedSpline, segmentsIntersect } from './geometry.js';
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

// Generate a non-self-intersecting set of control points around a ring.
function makeControlPoints(rng) {
  const t = config.track;
  const noise2d = createNoise2D(() => rng.next());
  for (let attempt = 0; attempt < 40; attempt++) {
    const pts = [];
    const n = t.controlPoints;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const nx = Math.cos(ang * t.noiseFreq);
      const ny = Math.sin(ang * t.noiseFreq);
      const wobble = noise2d(nx + attempt * 3.1, ny - attempt * 1.7); // -1..1
      const r = t.baseRadius * (1 + wobble * t.noiseAmp);
      pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
    }
    if (!selfIntersects(pts)) return pts;
  }
  // fallback: a clean ellipse (should basically never happen)
  return Array.from({ length: t.controlPoints }, (_, i) => {
    const a = (i / t.controlPoints) * Math.PI * 2;
    return { x: Math.cos(a) * t.baseRadius, y: Math.sin(a) * t.baseRadius * 0.8 };
  });
}

function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// Map curvature -> a target speed (m/s). Tight apex = slow, straight = fast.
function speedFor(curv) {
  const t = config.track;
  if (curv >= t.slowCorner) return 24 + (t.slowCorner / Math.max(curv, 1e-4)) * 30;
  if (curv >= t.fastCorner) {
    const f = (curv - t.fastCorner) / (t.slowCorner - t.fastCorner);
    return 78 - f * 30;          // sweeper: 78 -> 48 m/s
  }
  return 95;                      // straight / DRS
}

function classify(curv, prevCurv) {
  const t = config.track;
  if (curv >= t.slowCorner) return SEG.APEX;
  if (curv >= t.fastCorner) {
    if (curv > prevCurv) return SEG.BRAKING;     // curvature rising into a corner
    return curv < prevCurv ? SEG.ACCEL : SEG.SWEEPER;
  }
  return SEG.STRAIGHT;
}

export class Track {
  constructor(rng) {
    const t = config.track;
    this.line = buildClosedSpline(makeControlPoints(rng));
    this.length = this.line.length;
    this.halfWidth = t.width / 2;

    // per-sample segment metadata, aligned to the spline samples
    const pts = this.line.pts;
    this.segMeta = pts.map((p, i) => {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const type = classify(p.curv, prev.curv);
      const narrow = (type === SEG.APEX || type === SEG.BRAKING);
      return {
        dist: p.dist,
        type,
        baseSpeed: speedFor(p.curv),
        width: t.width * (narrow ? t.cornerWidthFactor : 1),
        // straights/braking zones are where passing happens
        overtake: type === SEG.STRAIGHT ? 1 : type === SEG.BRAKING ? 0.7
          : type === SEG.ACCEL ? 0.35 : type === SEG.SWEEPER ? 0.18 : 0.04,
        drs: type === SEG.STRAIGHT,
      };
    });

    // start-finish: place on the longest straight run
    this.sfDist = this._longestStraightCentre();
    this._tagStartFinish();
    this._buildPitLane(rng);
  }

  // metadata for the metre at distance d
  metaAt(d) {
    const i = this.line.indexAt(this.line.wrap(d));
    return this.segMeta[i];
  }

  _longestStraightCentre() {
    const meta = this.segMeta;
    let best = { len: -1, mid: 0 };
    let runStart = null;
    const wrapPts = [...meta, ...meta];   // tolerate a run across the seam
    for (let i = 0; i < wrapPts.length; i++) {
      const isStraight = wrapPts[i].type === SEG.STRAIGHT;
      if (isStraight && runStart === null) runStart = i;
      if ((!isStraight || i === wrapPts.length - 1) && runStart !== null) {
        const a = wrapPts[runStart].dist;
        let b = wrapPts[i].dist;
        if (b < a) b += this.length;
        if (b - a > best.len) best = { len: b - a, mid: (a + b) / 2 };
        runStart = null;
      }
    }
    return this.line.wrap(best.mid);
  }

  _tagStartFinish() {
    // tag a short window around sfDist as the start-finish segment
    const win = 18; // metres
    for (let i = 0; i < this.segMeta.length; i++) {
      let d = this.segMeta[i].dist - this.sfDist;
      d = ((d % this.length) + this.length) % this.length;
      if (d < win || d > this.length - win) {
        this.segMeta[i] = { ...this.segMeta[i], type: SEG.START_FINISH };
      }
    }
  }

  // The pit lane is a separate, offset path that leaves the racing line a bit
  // before the start-finish line and rejoins a bit after it. Cars in the pits
  // travel this longer, speed-limited path — that geometry *is* the time loss.
  _buildPitLane(rng) {
    const off = config.pit.offset;
    const entry = this.line.wrap(this.sfDist - 120);  // branch before the line
    const exit = this.line.wrap(this.sfDist + 120);   // rejoin after the line
    this.pit = { entryDist: entry, exitDist: exit, speed: config.pit.speed };

    // sample the offset path from entry..exit, easing the offset in/out so the
    // pit lane peels away and merges smoothly instead of stepping sideways.
    const span = this.line.wrap(exit - entry);
    const steps = Math.max(30, Math.floor(span / 4));
    const samples = [];
    let acc = 0;
    let prev = null;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const ease = Math.sin(Math.min(f, 1 - f) * Math.PI);   // 0 at ends, 1 mid
      const d = this.line.wrap(entry + span * f);
      const p = this.line.offsetAt(d, off * ease);
      if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
      p.dist = acc;
      // the box sits in the flat middle third of the lane
      p.isBox = f > 0.42 && f < 0.58;
      samples.push(p);
      prev = p;
    }
    this.pit.samples = samples;
    this.pit.length = acc;
    this.pit.boxIndex = samples.findIndex((p) => p.isBox);

    // tag the on-line metres that straddle entry/exit so the UI/segments know
    this._tagRange(entry, this.line.wrap(entry + 24), SEG.PIT_ENTRY);
    this._tagRange(this.line.wrap(exit - 24), exit, SEG.PIT_EXIT);
  }

  _tagRange(from, to, type) {
    for (let i = 0; i < this.segMeta.length; i++) {
      const d = this.segMeta[i].dist;
      const within = from < to ? (d >= from && d <= to)
        : (d >= from || d <= to);
      if (within) this.segMeta[i] = { ...this.segMeta[i], type };
    }
  }

  // position along the pit path, parameter u in [0,1]; returns world point.
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
