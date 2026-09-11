import type { LapRecord, NeutralisationZone } from "@/types/session";

/**
 * Fuel correction and stint filtering.
 *
 * A car burns roughly 1.6–1.8 kg of fuel per lap, and every kilogram costs
 * about 0.03 s of lap time, so a raw lap-time trace across a stint is dominated
 * by the tank emptying rather than by the tyre going off. Removing the fuel
 * term is what makes the remaining gradient readable as degradation.
 *
 * Fuel still on board at the end of lap `i` of `N` is proportional to the laps
 * left to run, `N - i`, so the time it is costing on that lap is
 * `(N - i) * beta`. Correcting to an empty-tank reference therefore
 * *subtracts* that term:
 *
 *   T_corrected(i) = T_raw(i) - (N - i) * beta
 *
 * (The reference can be flipped to a full tank with `reference: "full"`, which
 * adds the term instead. Same gradient, shifted intercept — it only changes
 * which end of the race the corrected times are quoted at.)
 */

export type FuelReference = "empty" | "full";

export interface FuelOptions {
  totalLaps: number;
  /** Seconds of lap time per lap of fuel remaining. */
  beta: number;
  reference?: FuelReference;
}

export function fuelCorrect(lapTime: number, lap: number, options: FuelOptions): number {
  const remaining = Math.max(0, options.totalLaps - lap);
  const term = remaining * options.beta;
  return options.reference === "full" ? lapTime + term : lapTime - term;
}

/** Default circuit fuel factor when nothing better is known. */
export const DEFAULT_FUEL_BETA = 0.035;

export interface StintFilterOptions {
  /** Drop lap 1 — a standing start is not a representative lap. */
  excludeFirstLap: boolean;
  /** Drop in-laps and out-laps — pit entry/exit deltas swamp tyre pace. */
  excludePitLaps: boolean;
  /** Drop laps run under SC / VSC / red flag. */
  excludeNeutralised: boolean;
  /** Drop laps spent within `dirtyAirThreshold` seconds of the car ahead. */
  excludeDirtyAir: boolean;
  /** Seconds. 1.2 s is roughly where the wake starts costing real lap time. */
  dirtyAirThreshold: number;
  /** Drop laps slower than `outlierFactor` times the driver's best. */
  outlierFactor: number;
}

export const DEFAULT_STINT_FILTER: StintFilterOptions = {
  excludeFirstLap: true,
  excludePitLaps: true,
  excludeNeutralised: true,
  excludeDirtyAir: true,
  dirtyAirThreshold: 1.2,
  outlierFactor: 1.07,
};

export type ExclusionReason =
  | "no-time"
  | "first-lap"
  | "pit-lap"
  | "neutralised"
  | "dirty-air"
  | "outlier";

export interface ClassifiedLap {
  record: LapRecord;
  /** null when the lap is valid for regression. */
  excluded: ExclusionReason | null;
}

function isNeutralised(lap: number, zones: NeutralisationZone[]): boolean {
  return zones.some((zone) => lap >= zone.lapStart && lap <= zone.lapEnd);
}

/**
 * Labels every lap with the reason it is (or is not) admissible as a clear-air
 * degradation sample. Returning the reason rather than a filtered list lets the
 * scatter plot still draw the rejected laps, greyed out — an engineer wants to
 * see what the model threw away.
 */
export function classifyLaps(
  laps: LapRecord[],
  zones: NeutralisationZone[],
  options: StintFilterOptions,
): ClassifiedLap[] {
  const bestByDriver = new Map<string, number>();
  for (const lap of laps) {
    if (lap.lapTime == null) continue;
    const current = bestByDriver.get(lap.driverId);
    if (current == null || lap.lapTime < current) bestByDriver.set(lap.driverId, lap.lapTime);
  }

  return laps.map((record) => ({ record, excluded: classify(record) }));

  function classify(record: LapRecord): ExclusionReason | null {
    if (record.lapTime == null || record.lapTime <= 0) return "no-time";
    if (options.excludeFirstLap && record.lap <= 1) return "first-lap";
    if (options.excludePitLaps && (record.isPitIn || record.isPitOut)) return "pit-lap";
    if (options.excludeNeutralised && isNeutralised(record.lap, zones)) return "neutralised";
    if (
      options.excludeDirtyAir &&
      record.intervalAhead != null &&
      record.intervalAhead < options.dirtyAirThreshold
    ) {
      return "dirty-air";
    }
    const best = bestByDriver.get(record.driverId);
    if (best != null && record.lapTime > best * options.outlierFactor) return "outlier";
    return null;
  }
}
