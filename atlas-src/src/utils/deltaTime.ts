import type { LapTelemetry } from "@/types/telemetry";

/**
 * Delta-time trace between a comparison car and a reference car, as a function
 * of track distance.
 *
 *   t(d) = ∫₀ᵈ ds / v(s)          Δt(d) = t_C(d) - t_R(d)
 *
 * Both laps are already resampled onto the same distance grid with their
 * elapsed time carried along, so the integral is already done: the delta is a
 * pointwise subtraction. A rising trace means the comparison car is losing
 * time; a falling one means it is gaining.
 */
export function deltaTimeTrace(
  reference: LapTelemetry,
  comparison: LapTelemetry,
): Float32Array {
  const count = Math.min(reference.elapsed.length, comparison.elapsed.length);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = comparison.elapsed[i] - reference.elapsed[i];
  }
  return out;
}

/** Δt accumulated between two distances, in seconds. */
export function deltaOverSegment(
  delta: Float32Array,
  step: number,
  fromMetres: number,
  toMetres: number,
): number | null {
  const a = Math.round(fromMetres / step);
  const b = Math.round(toMetres / step);
  if (a < 0 || b >= delta.length || b <= a) return null;
  return delta[b] - delta[a];
}

/** Nearest grid index for a distance in metres. */
export function indexForDistance(telemetry: LapTelemetry, metres: number): number {
  const index = Math.round(metres / telemetry.step);
  return Math.max(0, Math.min(telemetry.distance.length - 1, index));
}
