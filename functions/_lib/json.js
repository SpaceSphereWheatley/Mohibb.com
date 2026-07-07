"use strict";
/* ============================================================
   JSON serialization for the Race Report API (?format=json) —
   the same computed data _lib/report.js renders into HTML,
   reused as-is since it's already plain-JSON-serializable.
   ============================================================ */

import { SECTION_KEYS } from './sections.js';

export function buildJsonReport({ session, meeting, classification, fastestLap, history, strategy, safetyPeriods, partialFailures, sections }) {
  const out = {
    session,
    meeting,
    partial_failures: partialFailures,
    sections_included: SECTION_KEYS.filter(k => sections.has(k)),
  };
  if (sections.has('classification')) out.classification = classification;
  if (sections.has('fastest_lap')) out.fastest_lap = fastestLap;
  if (sections.has('race_history')) out.race_history = history;
  if (sections.has('tyre_strategy')) out.tyre_strategy = strategy;
  if (sections.has('safety_car')) out.safety_car = safetyPeriods;
  return out;
}

export function buildJsonError(status, title, message) {
  return { error: { status, title, message } };
}
