"use strict";
/* ============================================================
   Shared vocabulary for the `sections` query param on
   GET /api/race-report — the same 5 names gate both which
   <h2> sections render in HTML mode and which top-level keys
   appear in JSON mode (see _lib/report.js / _lib/json.js).
   ============================================================ */

export const SECTION_KEYS = ['classification', 'fastest_lap', 'race_history', 'tyre_strategy', 'safety_car'];

// null/absent param => full set (backward-compatible default). If every
// comma-separated token is unrecognized (or the param is present but
// empty), also falls back to the full set rather than yield an empty report.
export function parseSections(param) {
  if (param == null) return new Set(SECTION_KEYS);
  const tokens = param.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = tokens.filter(t => SECTION_KEYS.includes(t));
  return new Set(valid.length ? valid : SECTION_KEYS);
}
