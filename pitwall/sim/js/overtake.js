// overtake.js — resolves an attacker pressing a defender. The chance of a pass
// blends pace delta (tyres + car + DRS), the segment's overtaking character
// (high on straights, ~nil at an apex) and racecraft (attacker's aggression vs
// the defender's racecraft tempered by consistency).

import { config } from './config.js';

// per-second probability the attacker completes a pass right now
export function passProbability(attacker, defender, meta, drs) {
  const r = config.race;
  const pa = attacker.paceMultiplier(meta) + (drs ? r.drsBonus : 0);
  const pd = defender.paceMultiplier(meta);
  const paceEdge = pa - pd;                       // >0 => attacker quicker

  let p = r.overtakeBase * meta.overtake;
  p *= 1 + r.paceDeltaGain * Math.max(0, paceEdge);

  const aRace = attacker.driver.stats.racecraft ?? 80;
  const dRace = defender.driver.stats.racecraft ?? 80;
  const dCons = defender.driver.stats.consistency ?? 80;
  const defend = dRace * (0.85 + 0.3 * (dCons / 100));
  p += r.racecraftGain * (aRace - defend) / 10;

  return Math.max(0, Math.min(0.9, p));
}

// Roll for a pass this tick. Returns true on success.
export function tryOvertake(attacker, defender, meta, drs, dtSec, rng) {
  const perSec = passProbability(attacker, defender, meta, drs);
  const perTick = 1 - Math.pow(1 - perSec, dtSec);
  return rng.bool(perTick);
}
