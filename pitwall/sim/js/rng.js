// rng.js — small, fast, seedable PRNG so a given seed reproduces an identical
// track and race. mulberry32 is plenty for a game sim.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A tiny wrapper exposing the helpers the sim actually wants.
export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._r = mulberry32(this.seed);
  }
  next() { return this._r(); }                      // [0,1)
  range(lo, hi) { return lo + (hi - lo) * this._r(); }
  int(lo, hi) { return Math.floor(this.range(lo, hi + 1)); }
  bool(p) { return this._r() < p; }                 // true with probability p
  // standard-normal-ish via averaging (cheap, bounded)
  gauss() { return (this._r() + this._r() + this._r() - 1.5) / 1.5; }
}

// Turn an arbitrary string seed into a uint32 (for the seed input box).
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
