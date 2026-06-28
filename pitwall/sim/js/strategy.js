// strategy.js — the per-car pit brain, evaluated once each time a car completes
// a lap. It balances tyre wear against track position: a routine stop when the
// rubber is gone, an opportunistic undercut when stuck in a train on worn
// tyres, and it always satisfies the "use two compounds" rule before the flag.

import { config } from './config.js';
import { COMPOUNDS } from './tyres.js';

// ctx: { lapsLeft, gapAhead, gapBehind }
// returns the compound to fit, or null to stay out.
export function evaluatePit(car, ctx, rng) {
  if (car.pit) return null;                       // already stopping
  const s = config.strategy;
  const { lapsLeft, gapAhead, gapBehind } = ctx;
  if (lapsLeft <= 0) return null;

  const needsSecondCompound = car.compoundsUsed.size < 2;

  // Hard requirement: must run a second compound. If we're near the end and
  // still on a single compound, stop now while there's time to use another.
  if (needsSecondCompound && lapsLeft <= s.pitWindowEnd + 3) {
    return chooseCompound(car, lapsLeft, true);
  }

  if (car.stintLap < s.minStintLaps) return null;
  if (lapsLeft <= s.pitWindowEnd && !needsSecondCompound) return null;

  // Routine stop: tyres are spent.
  if (car.wear >= s.pitWearTrigger) {
    return chooseCompound(car, lapsLeft, needsSecondCompound);
  }

  // Undercut: stuck in a DRS train on tyres past their best, with clean-ish
  // air to rejoin into behind. Fresh rubber should leapfrog the rival.
  const stuck = gapAhead != null && gapAhead < s.undercutGap;
  const cleanBehind = gapBehind == null || gapBehind > s.cleanAirGap;
  if (stuck && cleanBehind && car.wear >= s.undercutWear) {
    return chooseCompound(car, lapsLeft, needsSecondCompound);
  }

  return null;
}

// Pick the next compound from how many laps remain, honouring the variety rule.
function chooseCompound(car, lapsLeft, forceDifferent) {
  let pick = lapsLeft > 18 ? 'HARD' : lapsLeft > 9 ? 'MEDIUM' : 'SOFT';
  if (forceDifferent && car.compoundsUsed.has(pick)) {
    const alt = COMPOUNDS.find((c) => !car.compoundsUsed.has(c));
    if (alt) pick = alt;
  }
  return pick;
}
