// car.js — per-car state plus the stat-derived performance model. Team
// engine/aero/chassis and driver pace are blended into two quality scores
// (power-limited vs grip-limited), normalised across the field so the fastest
// car sits at a 1.0 multiplier and the rest spread below it by config.perf.

import { config, noiseAmpFor } from './config.js';
import { SEG } from './track.js';
import { tyrePace } from './tyres.js';

// raw 0..1 quality for a (team, driver) pair, split by segment character
function rawQuality(team, driver) {
  const w = config.perf;
  const t = {
    aero: team.base_aero, chassis: team.base_chassis, engine: team.base_engine,
  };
  const carStraight = w.straight.engine * t.engine + w.straight.aero * t.aero + w.straight.chassis * t.chassis;
  const carCorner = w.corner.aero * t.aero + w.corner.chassis * t.chassis + w.corner.engine * t.engine;
  const drv = (driver.stats.pace || 0) / 100;
  return {
    straight: (1 - w.driverWeight) * carStraight + w.driverWeight * drv,
    corner: (1 - w.driverWeight) * carCorner + w.driverWeight * drv,
  };
}

export class Car {
  constructor(driver, team, idx) {
    this.driver = driver;
    this.team = team;
    this.idx = idx;
    this.name = driver.name;
    this.code = driver.code || driver.name.slice(0, 3).toUpperCase();
    this.color = team.colour || team.color || '#888888';

    // performance multipliers (filled in by normalisation below)
    this.perfStraight = 1;
    this.perfCorner = 1;

    // race state
    this.dist = 0;
    this.lap = 0;
    this.speed = 0;
    this.lateral = 0;          // current offset across the track (metres)
    this.targetLateral = 0;
    this.compound = 'MEDIUM';
    this.wear = 0;
    this.stintLap = 0;
    this.compoundsUsed = new Set();
    this.fuel = config.fuel.startKg;
    this.noiseAmp = noiseAmpFor(driver.stats.consistency ?? 80);

    // pit state machine
    this.pit = null;           // { u, dwell, served, nextCompound }
    this.pitRequest = null;    // compound the strategist wants next
    this.stops = 0;

    // racing state
    this.cooldown = 0;         // seconds before this car may attempt a pass again
    this.dirtyAir = false;
    this.finished = false;
    this.finishTime = null;

    // ordering / display
    this.position = idx + 1;
    this.gapToLeader = 0;
    this.interval = 0;
    this.lastLapTime = null;
    this.lapStartT = 0;
    this.history = [];         // per-lap {lap, time, pos, compound, wear}
  }

  // pace multiplier for the current segment, including tyres and fuel
  paceMultiplier(meta) {
    const grip = meta.type === SEG.STRAIGHT || meta.type === SEG.ACCEL ? this.perfStraight : this.perfCorner;
    const fuel = fuelFactor(this.fuel);
    return grip * tyrePace(this.compound, this.wear) * fuel;
  }
}

// fuel turns s/kg/lap into a speed multiplier relative to the nominal lap
function fuelFactor(kg) {
  const f = config.fuel;
  const lostFrac = (kg * f.sPerKgPerLap) / f.nominalLapTime;
  return 1 - lostFrac;
}

// Build the grid: instantiate cars, normalise performance, set the starting
// order from qualifying potential, and line them up behind the start-finish.
export function createCars(grid, track, rng) {
  const teamByName = new Map(grid.teams.map((t) => [t.name, t]));
  const cars = grid.drivers.map((d, i) => {
    const team = teamByName.get(d.team) || grid.teams[0];
    const car = new Car(d, team, i);
    car._raw = rawQuality(team, d);
    return car;
  });

  // normalise raw quality across the field into perf multipliers
  normalise(cars, 'straight', 'perfStraight', config.perf.spanStraight);
  normalise(cars, 'corner', 'perfCorner', config.perf.spanCorner);

  // qualifying order: corner+straight quality nudged by qualifying_pace and a
  // little randomness, so the grid isn't a perfect mirror of race pace.
  const ranked = [...cars].sort((a, b) => qScore(b, rng) - qScore(a, rng));
  ranked.forEach((car, pos) => {
    car.position = pos + 1;
    // line up behind the start-finish line, ~8 m apart, alternating sides
    car.dist = track.line.wrap(track.sfDist - 6 - pos * 8);
    car.targetLateral = (pos % 2 === 0 ? 1 : -1) * track.halfWidth * 0.4;
    car.lateral = car.targetLateral;
    // opening tyres: front-runners on softer rubber, midfield split
    car.compound = pos < 8 ? 'MEDIUM' : pos < 16 ? 'SOFT' : 'HARD';
    car.compoundsUsed.add(car.compound);
  });
  return ranked.sort((a, b) => a.idx - b.idx);
}

function qScore(car, rng) {
  const q = (car.driver.stats.qualifying_pace ?? 80) / 100;
  return 0.5 * (car._raw.straight + car._raw.corner) + 0.25 * q + 0.04 * rng.next();
}

function normalise(cars, rawKey, outKey, span) {
  let min = Infinity, max = -Infinity;
  for (const c of cars) {
    const v = c._raw[rawKey];
    if (v < min) min = v; if (v > max) max = v;
  }
  const range = max - min || 1;
  for (const c of cars) {
    const n = (c._raw[rawKey] - min) / range;   // 0 worst .. 1 best
    c[outKey] = 1 - span * (1 - n);
  }
}
