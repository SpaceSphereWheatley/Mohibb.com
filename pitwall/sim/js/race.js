// race.js — the orchestrator. Owns the fixed-step tick loop that moves every
// car along the racing line, resolves traffic (dirty air, DRS, overtakes),
// drives the pit-stop state machine, and keeps the running order, gaps and
// per-lap history that the leaderboard and post-race analysis read.

import { config } from './config.js';
import { Track, SEG } from './track.js';
import { createCars } from './car.js';
import { Rng } from './rng.js';
import { wearPerLap } from './tyres.js';
import { evaluatePit } from './strategy.js';
import { tryOvertake } from './overtake.js';

const TAU = Math.PI * 2;

// did a forward move from `prev` to `next` (wrapped) cross `point`?
function crossed(prev, next, point, L) {
  const fwd = ((next - prev) % L + L) % L;
  const toPt = ((point - prev) % L + L) % L;
  return fwd > 0 && toPt > 0 && toPt <= fwd;
}

export class Race {
  constructor(grid, seed) {
    this.grid = grid;
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.track = new Track(this.rng);
    this.cars = createCars(grid, this.track, this.rng);
    this.time = 0;
    this.over = false;
    this.raceLaps = config.raceLaps;
    this._order = [...this.cars];
    this._reorder();
  }

  prog(car) { return car.lap * this.track.length + car.dist; }

  step() {
    if (this.over) return;
    const dt = config.dt;
    const L = this.track.length;
    this.time += dt;

    // 1. base target speed for every car (no traffic yet)
    for (const car of this.cars) {
      if (car.finished) { car.speed = 0; continue; }
      if (car.pit) continue;                       // pit handled separately
      const meta = this.track.metaAt(car.dist);
      car._meta = meta;
      const noise = 1 + car.noiseAmp * this.rng.gauss();
      car._target = meta.baseSpeed * car.paceMultiplier(meta) * noise;
      car.dirtyAir = false;
      car._drs = false;
    }

    // 2. running order (leader first) of cars that are on track
    const order = this.cars
      .filter((c) => !c.finished && !c.pit)
      .sort((a, b) => this.prog(b) - this.prog(a));

    // 3. dirty air + DRS from the gap to the car directly ahead
    const r = config.race;
    for (let i = 1; i < order.length; i++) {
      const car = order[i], ahead = order[i - 1];
      const gap = this.prog(ahead) - this.prog(car);
      if (gap < r.dirtyAirGap) {
        car.dirtyAir = true;
        if (car._meta && (car._meta.type === SEG.APEX || car._meta.type === SEG.SWEEPER)) {
          car._target *= 1 - r.dirtyAirPenalty;
        }
        if (car._meta && car._meta.drs && gap < r.drsGap) {
          car._drs = true;
          car._target *= 1 + r.drsBonus;
        }
      }
    }

    // 4. integrate, clamp to the car ahead, resolve overtakes — leader first
    const committed = new Map();                   // car -> new prog
    for (let i = 0; i < order.length; i++) {
      const car = order[i];
      car.speed = car._target;
      let newProg = this.prog(car) + car.speed * dt;

      if (i > 0) {
        const ahead = order[i - 1];
        const aheadProg = committed.get(ahead);
        const limit = aheadProg - r.carLength;
        if (newProg > limit) {
          // caught the car ahead — try to pass, else hold station
          if (car.cooldown <= 0 && this._tryPass(car, ahead)) {
            newProg = aheadProg + r.carLength * 1.15;
            committed.set(ahead, aheadProg - r.carLength * 0.4);  // defender yields
            car.targetLateral = this._passSide(car, ahead);
            ahead.targetLateral = -car.targetLateral;
            ahead.cooldown = 0.6;
          } else {
            newProg = Math.max(this.prog(car), limit);
            car.speed = ahead.speed;               // tucked up behind
            car.targetLateral = this._passSide(car, ahead) * 0.6;
          }
        } else if (!car.dirtyAir) {
          car.targetLateral = 0;                   // clear air -> racing line
        }
      } else {
        car.targetLateral = 0;
      }
      committed.set(car, newProg);
    }

    // 5. apply committed positions (handles lap & pit-entry crossings)
    for (const car of order) {
      this._advanceTo(car, committed.get(car), dt);
    }

    // 6. progress cars that are in the pit lane
    for (const car of this.cars) {
      if (car.pit) this._pitStep(car, dt);
    }

    // 7. ease lateral offsets toward target, decay cooldowns
    for (const car of this.cars) {
      car.lateral += (car.targetLateral - car.lateral) * Math.min(1, dt * 4);
      if (car.cooldown > 0) car.cooldown -= dt;
    }

    this._reorder();
  }

  // commit a new progress value, firing lap- and pit-entry-crossing logic
  _advanceTo(car, newProg, dt) {
    const L = this.track.length;
    const prevDist = car.dist;
    let newDist = ((newProg % L) + L) % L;

    // pit entry: only if this car has called for a stop
    if (car.pitRequest && crossed(prevDist, newDist, this.track.pit.entryDist, L)) {
      this._enterPit(car);
      return;
    }
    // lap line
    if (crossed(prevDist, newDist, this.track.sfDist, L)) {
      this._completeLap(car);
    }
    car.dist = newDist;
  }

  _completeLap(car) {
    car.lap += 1;
    car.stintLap += 1;
    car.lastLapTime = this.time - car.lapStartT;
    car.lapStartT = this.time;
    car.wear += wearPerLap(car.compound, car.driver.stats.tyre_management ?? 80);
    car.fuel = Math.max(0, car.fuel - config.fuel.startKg / this.raceLaps);
    car.history.push({
      lap: car.lap, time: car.lastLapTime, pos: car.position,
      compound: car.compound, wear: car.wear,
    });

    if (car.lap >= this.raceLaps) { this._finish(car); return; }

    // strategy: decide whether to pit at the end of this new lap
    const want = evaluatePit(car, {
      lapsLeft: this.raceLaps - car.lap,
      gapAhead: car.interval,
      gapBehind: car.gapBehind,
    }, this.rng);
    if (want) car.pitRequest = want;
  }

  _finish(car) {
    car.finished = true;
    car.finishTime = this.time;
    car.dist = this.track.sfDist;
    car.speed = 0;
    // once the leader is home, freeze the rest in their current order
    if (!this.over) {
      this.over = true;
      let n = 0;
      for (const c of [...this.cars].sort((a, b) => this.prog(b) - this.prog(a))) {
        if (!c.finished) { c.finished = true; c.finishTime = this.time + (++n) * 0.001; }
      }
    }
  }

  _enterPit(car) {
    const p = config.pit;
    const eff = car.team.pit_stop_efficiency ?? 0.92;
    const dwell = p.boxDwellBase + p.boxDwellSpread * (1 - eff) * 6 + this.rng.range(0, 0.6);
    car.pit = { u: 0, dwell, served: false, next: car.pitRequest };
    car.pitRequest = null;
    car.dist = this.track.pit.entryDist;
    car.targetLateral = 0;
    car.lateral = 0;
  }

  _pitStep(car, dt) {
    const pit = this.track.pit;
    const p = car.pit;
    const uBox = pit.samples[pit.boxIndex].dist / pit.length;
    const prevDist = car.dist;

    if (!p.served && p.u < uBox) {
      p.u = Math.min(uBox, p.u + (pit.speed * dt) / pit.length);
      car.speed = pit.speed;
    } else if (!p.served) {
      p.dwell -= dt;                               // stationary at the box
      car.speed = 0;
      if (p.dwell <= 0) {
        p.served = true;
        car.compound = p.next;
        car.compoundsUsed.add(p.next);
        car.wear = 0;
        car.stintLap = 0;
        car.stops += 1;
      }
    } else {
      p.u = Math.min(1, p.u + (pit.speed * dt) / pit.length);
      car.speed = pit.speed;
    }

    // map pit progress back onto a main-line distance so ordering & laps work
    const span = ((pit.exitDist - pit.entryDist) % this.track.length + this.track.length) % this.track.length;
    const newDist = this.track.line.wrap(pit.entryDist + span * p.u);
    if (crossed(prevDist, newDist, this.track.sfDist, this.track.length)) {
      this._completeLap(car);
      if (car.finished) return;
    }
    car.dist = newDist;

    if (p.u >= 1) {                                // rejoin the circuit
      car.dist = pit.exitDist;
      car.pit = null;
    }
  }

  _tryPass(car, ahead) {
    const meta = car._meta || this.track.metaAt(car.dist);
    if (meta.overtake < 0.03) { car.cooldown = config.race.failCooldown; return false; }
    const ok = tryOvertake(car, ahead, meta, car._drs, config.dt, this.rng);
    if (!ok) car.cooldown = config.race.failCooldown;
    return ok;
  }

  // which side to move toward when passing — alternate by car index for variety
  _passSide(car) {
    return (car.idx % 2 === 0 ? 1 : -1) * this.track.halfWidth * 0.6;
  }

  _reorder() {
    const order = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return this.prog(b) - this.prog(a);
    });
    const leaderProg = this.prog(order[0]);
    for (let i = 0; i < order.length; i++) {
      const car = order[i];
      car.position = i + 1;
      if (i === 0) { car.interval = 0; car.gapToLeader = 0; car.gapBehind = null; }
      else {
        const ahead = order[i - 1];
        const gapM = this.prog(ahead) - this.prog(car);
        const spd = Math.max(car.speed, 12);
        car.interval = gapM / spd;
        car.gapToLeader = (leaderProg - this.prog(car)) / spd;
        car.lapsDown = Math.floor((leaderProg - this.prog(car)) / this.track.length);
      }
      if (i < order.length - 1) {
        const behind = order[i + 1];
        car.gapBehind = (this.prog(car) - this.prog(behind)) / Math.max(behind.speed, 12);
      }
    }
    this._order = order;
  }

  order() { return this._order; }
}

export { TAU };
