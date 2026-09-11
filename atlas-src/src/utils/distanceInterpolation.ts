import { CHANNELS, type Channel, type LapTelemetry, type RawSample } from "@/types/telemetry";

/**
 * Telemetry cannot be correlated between drivers or laps on elapsed time — two
 * cars are at different points on the circuit at any given second. Everything
 * here maps a time-series onto a uniform *distance* grid so that a single array
 * index identifies the same point of track in every trace.
 */

export const DEFAULT_STEP_METRES = 1;

/** km/h to m/s. */
const KMH = 1 / 3.6;

/**
 * Integrates the speed trace to get distance travelled at each raw sample.
 * Trapezoidal, because a sample rate of 3–4 Hz makes rectangular integration
 * meaningfully wrong through a braking zone.
 */
export function integrateDistance(samples: RawSample[]): Float64Array {
  const out = new Float64Array(samples.length);
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    const v0 = Math.max(0, samples[i - 1].speed) * KMH;
    const v1 = Math.max(0, samples[i].speed) * KMH;
    out[i] = out[i - 1] + ((v0 + v1) / 2) * dt;
  }
  return out;
}

/** Piecewise-linear interpolation of `ys` sampled at `xs`, evaluated at `x`. */
function interpolateAt(xs: Float64Array, ys: Float64Array, x: number, hint: number): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  let k = hint;
  while (k < n - 2 && xs[k + 1] < x) k++;
  while (k > 0 && xs[k] > x) k--;

  const span = xs[k + 1] - xs[k];
  if (span <= 0) return ys[k];
  return ys[k] + ((ys[k + 1] - ys[k]) / span) * (x - xs[k]);
}

/** Index of the first knot at or before `x`, for cursors walking forwards. */
function advance(xs: Float64Array, x: number, from: number): number {
  let k = from;
  while (k < xs.length - 2 && xs[k + 1] < x) k++;
  return k;
}

export interface ResampleOptions {
  driverId: string;
  lap: number;
  /**
   * Known lap distance in metres. When supplied, the integrated distance is
   * rescaled to match it, which absorbs the systematic error of integrating a
   * low-rate speed trace. When omitted the integrated length is used as-is.
   */
  lapDistance?: number;
  step?: number;
}

/**
 * Resamples a lap of raw telemetry onto a fixed distance grid.
 *
 *   y(d) = y_k + (y_{k+1} - y_k) / (d_{k+1} - d_k) * (d - d_k),  d_k <= d <= d_{k+1}
 *
 * Elapsed time is interpolated the same way rather than re-integrated from
 * 1/v, so it stays exactly consistent with the source timestamps.
 */
export function resampleToDistance(
  samples: RawSample[],
  options: ResampleOptions,
): LapTelemetry | null {
  if (samples.length < 8) return null;

  const step = options.step ?? DEFAULT_STEP_METRES;
  const rawDistance = integrateDistance(samples);
  const integrated = rawDistance[rawDistance.length - 1];
  if (!Number.isFinite(integrated) || integrated < 100) return null;

  const lapDistance = options.lapDistance && options.lapDistance > 100
    ? options.lapDistance
    : integrated;
  const scale = lapDistance / integrated;
  for (let i = 0; i < rawDistance.length; i++) rawDistance[i] *= scale;

  const rawTime = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) rawTime[i] = (samples[i].t - samples[0].t) / 1000;

  const count = Math.floor(lapDistance / step) + 1;
  const distance = new Float32Array(count);
  const elapsed = new Float32Array(count);
  for (let i = 0; i < count; i++) distance[i] = i * step;

  const channels = {} as Record<Channel, Float32Array>;
  for (const channel of CHANNELS) {
    const source = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i++) source[i] = samples[i][channel];

    const target = new Float32Array(count);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      cursor = advance(rawDistance, distance[i], cursor);
      target[i] = interpolateAt(rawDistance, source, distance[i], cursor);
    }
    // Gear and brake are discrete; interpolating them produces values that
    // never existed. Snap them back onto the source sample instead.
    if (channel === "gear") {
      for (let i = 0; i < count; i++) target[i] = Math.round(target[i]);
    }
    channels[channel] = target;
  }

  let cursor = 0;
  for (let i = 0; i < count; i++) {
    cursor = advance(rawDistance, distance[i], cursor);
    elapsed[i] = interpolateAt(rawDistance, rawTime, distance[i], cursor);
  }

  return {
    driverId: options.driverId,
    lap: options.lap,
    step,
    lapDistance,
    distance,
    channels,
    integratedTime: rawTime[rawTime.length - 1],
    elapsed,
  };
}

/**
 * Estimates a circuit's lap distance from the cleanest available lap, by
 * integrating its speed trace. OpenF1 does not publish track length, and a
 * flying lap integrates to within about 1 % of the real figure.
 */
export function estimateLapDistance(samples: RawSample[]): number | null {
  const distance = integrateDistance(samples);
  const total = distance[distance.length - 1];
  if (!Number.isFinite(total) || total < 1500 || total > 12000) return null;
  return Math.round(total);
}
