// pressureIndex.js
// Calculates Pressure Index (0-100) for a penalty event.
// All inputs derived from StatsBomb event + match metadata.
// Laget av Mohibb Malik, 2025

/**
 * @param {object} p
 * @param {number} p.minute          - Match minute (e.g. 88, can be 90+5 = 95)
 * @param {string} p.scoreSituation  - 'winning2+' | 'winning1' | 'level' | 'losing1' | 'losing2+'
 * @param {string} p.stage           - See STAGE_WEIGHTS keys below
 * @param {boolean} p.isShootout     - true if penalty shootout
 * @param {number} p.shootoutKick    - Kick number in shootout (1-5+), 0 if not shootout
 * @param {number} p.shootoutDelta   - Goal difference within shootout at time of kick, 0 if not shootout
 * @param {string} p.leagueContext   - 'early' | 'title' | 'promotion' | 'relegation' | 'finalday' | 'na'
 * @returns {number} Pressure Index, integer 0-100
 */
// Base weights. Sum to 1.00 when every component applies.
const W = {
  scoreline:   0.20,
  minute:      0.12,
  competition: 0.16,
  shootout:    0.18,
  interaction: 0.16, // scoreline x minute
  league:      0.18,
};

export function pressureIndex(p) {
  const S = scoreline(p.scoreSituation);
  const M = minute(p.minute);
  const C = competition(p.stage);
  const P = shootout(p.isShootout, p.shootoutKick, p.shootoutDelta);
  const L = league(p.leagueContext);

  const isShootout = !!p.isShootout;
  const leagueApplies = p.leagueContext !== 'na' && p.leagueContext != null;

  // Build the set of active terms. A term is { weight, value }.
  // Inactive terms (shootout for in-play penalties, league for cups) are
  // dropped, and their weight is redistributed proportionally across the
  // active terms so the index always spans the full 0-100 scale.
  const terms = [
    { w: W.scoreline,   v: S },
    { w: W.minute,      v: M },
    { w: W.competition, v: C },
    { w: W.interaction, v: S * M },
  ];
  if (isShootout)    terms.push({ w: W.shootout, v: P });
  if (leagueApplies) terms.push({ w: W.league,   v: L });

  const activeWeight = terms.reduce((sum, t) => sum + t.w, 0);
  const raw = terms.reduce((sum, t) => sum + (t.w / activeWeight) * t.v, 0);

  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

// Returns the individual component values too, useful for the UI breakdown.
export function pressureBreakdown(p) {
  const S = scoreline(p.scoreSituation);
  const M = minute(p.minute);
  const C = competition(p.stage);
  const P = shootout(p.isShootout, p.shootoutKick, p.shootoutDelta);
  const L = league(p.leagueContext);
  return {
    scoreline: S, minute: M, competition: C, shootout: P, league: L,
    index: pressureIndex(p),
  };
}

// -- COMPONENTS --

function scoreline(situation) {
  const map = {
    'winning2+': 0.10,
    'winning1':  0.30,
    'level':     0.70,
    'losing1':   0.90,
    'losing2+':  0.40,
  };
  return map[situation] ?? 0.50;
}

function minute(t) {
  // Sigmoid: flat until ~60', accelerates toward 90'
  return 1 / (1 + Math.exp(-0.08 * (t - 75)));
}

function competition(stage) {
  const map = {
    'group':         0.30,
    'cup_early':     0.35,
    'league_run_in': 0.55,
    'round_of_16':   0.55,
    'quarter_final': 0.70,
    'semi_final':    0.80,
    'cup_final':     0.85,
    'major_final':   1.00,
  };
  return map[stage] ?? 0.30;
}

function shootout(isShootout, kickNumber, delta) {
  if (!isShootout) return 0;
  if (kickNumber > 5) return 0.90; // sudden death
  const base = kickNumber / 5;
  const pressure = Math.max(0, 1 - Math.abs(delta) * 0.2);
  return Math.min(1, base * pressure);
}

function league(context) {
  const map = {
    'early':      0.20,
    'title':      0.75,
    'promotion':  0.75,
    'relegation': 0.80,
    'finalday':   1.00,
    'na':         0.00,
  };
  return map[context] ?? 0.20;
}
