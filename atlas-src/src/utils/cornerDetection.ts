import type { CornerMetric, LapTelemetry } from "@/types/telemetry";

/**
 * Corners are found from the speed trace rather than from a track map, so the
 * same code works for any circuit and for imported data that carries no
 * geometry. An apex is a local minimum in smoothed speed with enough
 * prominence either side to be a corner rather than a lift.
 */

export interface CornerOptions {
  /** Moving-average half-window in metres. */
  smoothing: number;
  /** Speed the trace must recover by, either side of the minimum, in km/h. */
  prominence: number;
  /** Minimum distance between two apexes, in metres. */
  separation: number;
  /** Brake channel value counted as "on the brakes", in percent. */
  brakeThreshold: number;
  /** Throttle channel value counted as "full throttle", in percent. */
  throttleThreshold: number;
}

export const DEFAULT_CORNER_OPTIONS: CornerOptions = {
  smoothing: 15,
  prominence: 25,
  separation: 120,
  brakeThreshold: 5,
  throttleThreshold: 98,
};

function movingAverage(values: Float32Array, halfWindow: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

/**
 * Prominence test: walk outwards from a candidate minimum. The candidate is a
 * corner if the trace climbs at least `prominence` above it on both sides
 * before dropping below it again.
 */
function hasProminence(speed: Float32Array, index: number, prominence: number): boolean {
  const base = speed[index];
  let rose = false;
  for (let i = index - 1; i >= 0; i--) {
    if (speed[i] < base) return false;
    if (speed[i] - base >= prominence) {
      rose = true;
      break;
    }
  }
  if (!rose) return false;

  for (let i = index + 1; i < speed.length; i++) {
    if (speed[i] < base) return false;
    if (speed[i] - base >= prominence) return true;
  }
  return false;
}

/** Walks back from the apex to the last point before the speed started falling. */
function entryIndex(speed: Float32Array, apex: number): number {
  let i = apex;
  while (i > 0 && speed[i - 1] >= speed[i]) i--;
  return i;
}

/** Walks forward from the apex to the point where the speed stops climbing. */
function exitIndex(speed: Float32Array, apex: number): number {
  let i = apex;
  const n = speed.length;
  while (i < n - 1 && speed[i + 1] >= speed[i]) i++;
  return i;
}

export function detectCorners(
  telemetry: LapTelemetry,
  options: CornerOptions = DEFAULT_CORNER_OPTIONS,
): CornerMetric[] {
  const { step } = telemetry;
  const raw = telemetry.channels.speed;
  const smoothed = movingAverage(raw, Math.max(1, Math.round(options.smoothing / step)));
  const separation = Math.max(1, Math.round(options.separation / step));

  const candidates: number[] = [];
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] <= smoothed[i - 1] && smoothed[i] < smoothed[i + 1]) {
      if (hasProminence(smoothed, i, options.prominence)) candidates.push(i);
    }
  }

  // Keep the slowest apex inside any cluster tighter than `separation`.
  const apexes: number[] = [];
  for (const candidate of candidates) {
    const last = apexes[apexes.length - 1];
    if (last != null && candidate - last < separation) {
      if (smoothed[candidate] < smoothed[last]) apexes[apexes.length - 1] = candidate;
    } else {
      apexes.push(candidate);
    }
  }

  const brake = telemetry.channels.brake;
  const throttle = telemetry.channels.throttle;

  return apexes.map((apex, order) => {
    const entry = entryIndex(smoothed, apex);
    const exit = exitIndex(smoothed, apex);

    let brakeIndex: number | null = null;
    for (let i = entry; i <= apex; i++) {
      if (brake[i] > options.brakeThreshold) {
        brakeIndex = i;
        break;
      }
    }

    let throttleIndex: number | null = null;
    for (let i = apex; i <= exit; i++) {
      if (throttle[i] >= options.throttleThreshold) {
        throttleIndex = i;
        break;
      }
    }

    return {
      index: order + 1,
      apexDistance: apex * step,
      vMin: raw[apex],
      brakeDistance: brakeIndex == null ? null : brakeIndex * step,
      throttleDistance: throttleIndex == null ? null : throttleIndex * step,
      entry: entry * step,
      exit: exit * step,
    } satisfies CornerMetric;
  });
}

/**
 * Re-measures a reference car's corners on the comparison car's trace. The apex
 * list stays anchored to the reference lap so the two cars are always compared
 * at the same piece of tarmac, even when the comparison car's own minimum sits
 * a few metres away.
 */
export function measureAgainst(
  corners: CornerMetric[],
  telemetry: LapTelemetry,
  options: CornerOptions = DEFAULT_CORNER_OPTIONS,
): (CornerMetric | null)[] {
  const { step } = telemetry;
  const speed = telemetry.channels.speed;
  const brake = telemetry.channels.brake;
  const throttle = telemetry.channels.throttle;
  const n = speed.length;

  return corners.map((corner) => {
    const entry = Math.max(0, Math.min(n - 1, Math.round(corner.entry / step)));
    const exit = Math.max(0, Math.min(n - 1, Math.round(corner.exit / step)));
    if (exit <= entry) return null;

    let apex = entry;
    for (let i = entry; i <= exit; i++) {
      if (speed[i] < speed[apex]) apex = i;
    }

    let brakeIndex: number | null = null;
    for (let i = entry; i <= apex; i++) {
      if (brake[i] > options.brakeThreshold) {
        brakeIndex = i;
        break;
      }
    }

    let throttleIndex: number | null = null;
    for (let i = apex; i <= exit; i++) {
      if (throttle[i] >= options.throttleThreshold) {
        throttleIndex = i;
        break;
      }
    }

    return {
      index: corner.index,
      apexDistance: apex * step,
      vMin: speed[apex],
      brakeDistance: brakeIndex == null ? null : brakeIndex * step,
      throttleDistance: throttleIndex == null ? null : throttleIndex * step,
      entry: corner.entry,
      exit: corner.exit,
    } satisfies CornerMetric;
  });
}
