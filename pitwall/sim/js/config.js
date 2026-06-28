// config.js — every tunable the sim reads, in one place.
// Tweakpane (tuning.js, gated behind ?debug) binds directly to this object,
// and the sim reads it live each tick, so a slider change takes effect on the
// next step. Keep ALL magic numbers here — nothing tunable should be inlined
// in the sim modules.

export const config = {
  // ---- simulation clock ----
  dt: 0.1,                 // seconds of sim time per fixed step
  raceLaps: 30,            // laps in a full grand prix (scaled down for watchability)

  // ---- track generation ----
  track: {
    controlPoints: 11,     // number of spline control points (turns-ish)
    baseRadius: 360,       // metres, mean radius of the loop
    noiseAmp: 0.42,        // 0..1 fraction of baseRadius the noise can push a point
    noiseFreq: 2.3,        // how wavy the loop is
    width: 13,             // racing-surface half-width is width/2 (metres)
    cornerWidthFactor: 0.7,// corners are narrower than straights
    // curvature thresholds (1/m) used to classify segments
    slowCorner: 0.014,     // above this curvature -> slow corner / apex
    fastCorner: 0.006,     // between fast and slow -> sweeper
  },

  // ---- pit lane ----
  pit: {
    offset: 26,            // metres the pit lane sits outside the racing line
    speed: 22,             // pit-lane speed limit (m/s ~ 80 km/h)
    boxDwellBase: 2.4,     // seconds stationary at the box (best case)
    boxDwellSpread: 1.4,   // extra seconds a slow crew / poor efficiency adds
  },

  // ---- car performance mapping ----
  perf: {
    spanStraight: 0.055,   // perf spread best->worst on power-limited segments
    spanCorner: 0.075,     // perf spread on grip-limited segments (bigger)
    // weighting of team stats into a "straight" and "corner" quality score
    straight: { engine: 0.6, aero: 0.25, chassis: 0.15 },
    corner:   { aero: 0.45, chassis: 0.4, engine: 0.15 },
    driverWeight: 0.4,     // blend of driver pace vs car in the quality score
  },

  // ---- tyres ---- (wear is 0 = fresh, grows past 1 into the cliff)
  tyres: {
    SOFT:   { paceMult: 1.009, wearRate: 0.150, degCoeff: 0.045, curve: 1.7, color: 0xE8443B, label: 'S' },
    MEDIUM: { paceMult: 1.000, wearRate: 0.095, degCoeff: 0.030, curve: 1.4, color: 0xF2C14E, label: 'M' },
    HARD:   { paceMult: 0.993, wearRate: 0.065, degCoeff: 0.020, curve: 1.2, color: 0xE6E1D4, label: 'H' },
    // driver tyre_management (0..100) scales wear rate across this band:
    // mgmt 100 -> wear * (1 - mgmtBand/2); mgmt 0 -> wear * (1 + mgmtBand/2)
    mgmtBand: 0.5,
  },

  // ---- fuel ----
  fuel: {
    startKg: 100,                 // tank at lights-out
    sPerKgPerLap: 0.03,           // each kg costs this many seconds per lap
    nominalLapTime: 80,           // reference lap (s) used to turn s/kg into a speed multiplier
  },

  // ---- racing: gaps, dirty air, overtaking ----
  race: {
    carLength: 5.5,               // metres; minimum following gap is a touch more
    followGap: 9,                 // metres at which a car is "in the train" behind
    dirtyAirGap: 22,              // metres within which the follower loses downforce
    dirtyAirPenalty: 0.018,       // corner pace lost when in dirty air
    // overtaking probability (evaluated per second of being in range)
    overtakeBase: 0.20,           // scales the whole attempt rate
    paceDeltaGain: 14,            // how strongly a pace edge raises pass odds
    racecraftGain: 0.045,         // per racecraft point of attacker-vs-defender edge
    drsGap: 18,                   // metres within which DRS-on-straight bonus applies
    drsBonus: 0.012,              // extra pace multiplier on a straight when in DRS range
    failCooldown: 3.0,            // seconds a failed attacker is held before retrying
  },

  // ---- strategy AI ----
  strategy: {
    pitWearTrigger: 1.0,          // pit when wear reaches roughly this (tyre worn out)
    undercutWear: 0.7,            // if stuck in traffic and this worn, consider an undercut
    undercutGap: 1.6,             // seconds behind a rival to trigger an undercut
    cleanAirGap: 4.0,             // seconds of clear track needed to call it "clean air"
    minStintLaps: 5,              // never pit before this many laps on a set
    pitWindowEnd: 4,              // never make a routine stop inside the last N laps
  },

  // ---- presentation ----
  view: {
    carRadius: 5.2,               // px (in track-space) of a car dot
    leaderboardHz: 5,             // leaderboard refresh rate
  },
};

// Per-car randomness amplitude derived from a driver's consistency (0..100):
// low consistency -> more lap-to-lap scatter.
export function noiseAmpFor(consistency) {
  return 0.010 * (1 - consistency / 100) + 0.001;
}
