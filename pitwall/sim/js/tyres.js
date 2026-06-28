// tyres.js — compound definitions and the wear -> pace model. `wear` runs from
// 0 (fresh) and is allowed to climb past 1 so an over-extended stint falls off
// a cliff naturally via the curve. A driver's tyre_management scales how fast
// wear accumulates, not the pace penalty itself.

import { config } from './config.js';

export const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD'];

export function compoundSpec(c) {
  return config.tyres[c];
}

// wear accumulated per lap for this compound and driver
export function wearPerLap(compound, tyreManagement) {
  const spec = config.tyres[compound];
  const band = config.tyres.mgmtBand;
  // mgmt 100 -> (1 - band/2) slower wear; mgmt 0 -> (1 + band/2) faster wear
  const mgmtFactor = 1 + band * (0.5 - tyreManagement / 100);
  return spec.wearRate * mgmtFactor;
}

// pace multiplier from compound + current wear (1.0 ~= neutral medium, fresh).
// Above 1 = faster than reference; the deg term always subtracts.
export function tyrePace(compound, wear) {
  const spec = config.tyres[compound];
  const w = Math.max(0, wear);
  return spec.paceMult - spec.degCoeff * Math.pow(w, spec.curve);
}

// life shown to the user (100% fresh -> 0% at wear 1, clamped)
export function tyreLifePct(wear) {
  return Math.max(0, Math.round((1 - wear) * 100));
}

// Strategy helper: how many laps until this set reaches a target wear.
export function lapsUntilWear(compound, tyreManagement, fromWear, targetWear) {
  const per = wearPerLap(compound, tyreManagement);
  return Math.max(0, (targetWear - fromWear) / per);
}
