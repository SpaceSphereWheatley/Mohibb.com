/**
 * Generates public/data/sample-session.json.
 *
 * The sample is *synthetic* — a plausible 57-lap race on a fictional 5 040 m
 * circuit — so the dashboard has something to draw before anyone picks a real
 * session, and so the widgets can be eyeballed without a network round trip.
 * It is clearly labelled as such in the UI. Deterministic: same seed, same file.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "data",
  "sample-session.json",
);

/* mulberry32 — small, fast, and reproducible across runs. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260911);

const LAP_DISTANCE = 5040;
const TOTAL_LAPS = 57;

const TEAMS = [
  ["Vermillion", "#e1463c"],
  ["Northstar", "#3d7dd8"],
  ["Kestrel", "#25a37a"],
  ["Aurora", "#d38b2a"],
  ["Brackwell", "#8d5fd3"],
  ["Halcyon", "#4fb0c6"],
  ["Ironsmith", "#96a0b4"],
  ["Sundown", "#d2557f"],
  ["Meridian", "#6c8f3a"],
  ["Caldera", "#c5622c"],
];

const NAMES = [
  ["ROS", "A. Rosenqvist"], ["MAR", "L. Marchetti"],
  ["OKO", "K. Okonkwo"], ["DVR", "S. de Vries"],
  ["TAN", "H. Tanaka"], ["BRN", "E. Bernard"],
  ["KOV", "M. Kovac"], ["SIL", "R. Silveira"],
  ["HAA", "J. Haaland"], ["PET", "N. Petrov"],
  ["ALM", "Y. Almasi"], ["WHI", "C. Whitlock"],
  ["DUB", "P. Dubois"], ["NAK", "T. Nakamura"],
  ["OBR", "F. O'Brien"], ["ZAN", "G. Zanetti"],
  ["MOR", "D. Moreau"], ["LIN", "W. Lindqvist"],
  ["ABE", "I. Abara"], ["COS", "V. Costa"],
];

const drivers = NAMES.map(([code, name], index) => {
  const [team, colour] = TEAMS[Math.floor(index / 2)];
  return { id: String(index + 1), code, name, team, colour, number: index + 1 };
});

/* Per-driver intrinsic pace, in seconds off the quickest car. */
const pace = drivers.map((_, index) => index * 0.085 + random() * 0.09);

const COMPOUND_BASE = { SOFT: -0.45, MEDIUM: 0, HARD: 0.4 };
const COMPOUND_DEG = { SOFT: 0.085, MEDIUM: 0.048, HARD: 0.028 };

const BASE_LAP = 82.4;
const FUEL_BETA = 0.034;

/* One safety car, in the middle of the race. */
const zones = [{ kind: "SC", lapStart: 27, lapEnd: 31 }];
const underSc = (lap) => zones.some((z) => lap >= z.lapStart && lap <= z.lapEnd);

/* Two- and one-stop strategies, alternating down the grid. */
const strategies = drivers.map((_, index) => {
  if (index % 3 === 0) return [
    { compound: "MEDIUM", lapStart: 1, lapEnd: 18 },
    { compound: "HARD", lapStart: 19, lapEnd: 38 },
    { compound: "MEDIUM", lapStart: 39, lapEnd: TOTAL_LAPS },
  ];
  if (index % 3 === 1) return [
    { compound: "SOFT", lapStart: 1, lapEnd: 14 },
    { compound: "HARD", lapStart: 15, lapEnd: TOTAL_LAPS },
  ];
  return [
    { compound: "MEDIUM", lapStart: 1, lapEnd: 26 },
    { compound: "HARD", lapStart: 27, lapEnd: TOTAL_LAPS },
  ];
});

const stints = [];
const pits = [];
const laps = [];

const START = Date.parse("2026-05-24T13:00:00Z");

drivers.forEach((driver, index) => {
  let clock = START + index * 0.9 * 1000;
  let cumulativeToLeader = 0;

  strategies[index].forEach((stint, stintIndex) => {
    stints.push({
      driverId: driver.id,
      stint: stintIndex + 1,
      compound: stint.compound,
      lapStart: stint.lapStart,
      lapEnd: stint.lapEnd,
      startAge: 0,
    });

    if (stintIndex > 0) {
      pits.push({
        driverId: driver.id,
        lap: stint.lapStart - 1,
        stationary: 2.1 + random() * 1.3,
        pitLaneDuration: 20.4 + random() * 2.2,
      });
    }
  });

  for (let lap = 1; lap <= TOTAL_LAPS; lap++) {
    const stint = strategies[index].find((entry) => lap >= entry.lapStart && lap <= entry.lapEnd);
    const stintIndex = strategies[index].indexOf(stint);
    const age = lap - stint.lapStart;
    const isPitIn = lap === stint.lapEnd && stintIndex < strategies[index].length - 1;
    const isPitOut = lap === stint.lapStart && stintIndex > 0;

    let time =
      BASE_LAP +
      pace[index] +
      COMPOUND_BASE[stint.compound] +
      COMPOUND_DEG[stint.compound] * age +
      (TOTAL_LAPS - lap) * FUEL_BETA +
      (random() - 0.5) * 0.22;

    if (lap === 1) time += 2.6;
    if (isPitIn) time += 19.5;
    if (isPitOut) time += 3.1;
    if (underSc(lap)) time *= 1.34;

    clock += time * 1000;
    cumulativeToLeader += pace[index] * 0.02;

    laps.push({
      driverId: driver.id,
      lap,
      lapTime: Number(time.toFixed(3)),
      sector1: Number((time * 0.31).toFixed(3)),
      sector2: Number((time * 0.38).toFixed(3)),
      sector3: Number((time * 0.31).toFixed(3)),
      isPitIn,
      isPitOut,
      compound: stint.compound,
      tyreAge: age,
      stint: stintIndex + 1,
      // A plausible traffic pattern: the midfield spends real time in the wake.
      intervalAhead:
        index === 0 ? null : Number((0.4 + Math.abs(Math.sin(lap * 0.7 + index)) * 2.6).toFixed(2)),
      position: index + 1,
      startTime: Math.round(clock - time * 1000),
    });
  }
  void cumulativeToLeader;
});

/* ---------------------------------------------------------------- telemetry */

/** Corner apexes as [distance from the line, minimum speed in km/h]. */
const CORNERS = [
  [420, 118], [760, 205], [1180, 92], [1520, 168], [1880, 240],
  [2260, 105], [2610, 145], [2980, 82], [3320, 195], [3660, 130],
  [4010, 225], [4350, 98], [4680, 160], [4910, 210],
];

const V_MAX = 338;

/**
 * Speed at a point on the lap: the lowest of the straight-line maximum and each
 * corner's V-shaped approach and exit envelope. Crude compared with a real
 * vehicle model, but it produces a trace with honest braking zones, apexes and
 * pick-up points, which is all the widgets need to be exercised.
 */
function speedAt(metre, style) {
  let speed = V_MAX;
  for (const [apex, vMin] of CORNERS) {
    const adjusted = vMin * style.apex;
    const delta = metre - apex;
    const envelope =
      delta < 0
        ? adjusted + Math.abs(delta) ** 1.18 * 0.55 * style.brake
        : adjusted + delta ** 1.06 * 0.72 * style.traction;
    speed = Math.min(speed, envelope);
  }
  return Math.max(60, Math.min(V_MAX, speed));
}

function generateLap(driverId, lap, style) {
  const profile = new Float64Array(LAP_DISTANCE + 1);
  for (let metre = 0; metre <= LAP_DISTANCE; metre++) profile[metre] = speedAt(metre, style);

  // Time at each metre, from ds / v.
  const time = new Float64Array(LAP_DISTANCE + 1);
  for (let metre = 1; metre <= LAP_DISTANCE; metre++) {
    const v = ((profile[metre] + profile[metre - 1]) / 2) / 3.6;
    time[metre] = time[metre - 1] + 1 / v;
  }

  const totalTime = time[LAP_DISTANCE];
  const samples = [];
  const rate = 0.1; // 10 Hz

  let metre = 0;
  for (let t = 0; t <= totalTime; t += rate) {
    while (metre < LAP_DISTANCE && time[metre + 1] < t) metre++;
    const speed = profile[metre];
    const gradient = (profile[Math.min(LAP_DISTANCE, metre + 8)] - profile[Math.max(0, metre - 8)]) / 16;

    samples.push({
      t: Math.round(t * 1000),
      speed: Number(speed.toFixed(1)),
      throttle: Number(Math.max(0, Math.min(100, 55 + gradient * 45 + (speed > 300 ? 45 : 0))).toFixed(0)),
      brake: Number(Math.max(0, Math.min(100, -gradient * 90)).toFixed(0)),
      gear: Math.max(1, Math.min(8, Math.round(speed / 44) + 1)),
      rpm: Math.round(9200 + (speed / V_MAX) * 3300),
      steering: Number((Math.max(-1, Math.min(1, -gradient * 0.9)) * 110).toFixed(0)),
    });
  }

  return { driverId, lap, samples };
}

const telemetry = [
  generateLap("1", 12, { apex: 1.0, brake: 1.0, traction: 1.0 }),
  generateLap("2", 12, { apex: 0.982, brake: 1.06, traction: 0.94 }),
];

const document = {
  note:
    "Synthetic sample data for the Atlas dashboard. Not a real grand prix — drivers, " +
    "teams and circuit are invented, and the telemetry comes from a simple speed-envelope " +
    "model. Use the OpenF1 picker for real sessions.",
  session: {
    meta: {
      key: "sample",
      name: "Sample Grand Prix",
      kind: "race",
      circuit: "Fictional Circuit",
      country: "Nowhere",
      year: 2026,
      date: "2026-05-24T13:00:00Z",
      totalLaps: TOTAL_LAPS,
      lapDistance: LAP_DISTANCE,
      fuelBeta: FUEL_BETA,
      source: "sample",
    },
    drivers,
    laps,
    stints,
    pits,
    zones,
  },
  telemetry,
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(document));
console.log(
  `sample: ${laps.length} laps, ${telemetry.reduce((n, t) => n + t.samples.length, 0)} telemetry samples → ${OUT}`,
);
