/** High-frequency (sub-lap) data model. */

export const CHANNELS = ["speed", "throttle", "brake", "gear", "rpm", "steering"] as const;

export type Channel = (typeof CHANNELS)[number];

export interface ChannelMeta {
  key: Channel;
  label: string;
  unit: string;
  /** Fixed y-range, or null to auto-scale. */
  range: [number, number] | null;
  decimals: number;
}

export const CHANNEL_META: Record<Channel, ChannelMeta> = {
  speed: { key: "speed", label: "Speed", unit: "km/h", range: [0, 360], decimals: 0 },
  throttle: { key: "throttle", label: "Throttle", unit: "%", range: [0, 100], decimals: 0 },
  brake: { key: "brake", label: "Brake", unit: "%", range: [0, 100], decimals: 0 },
  gear: { key: "gear", label: "Gear", unit: "", range: [0, 8], decimals: 0 },
  rpm: { key: "rpm", label: "RPM", unit: "rpm", range: [0, 15000], decimals: 0 },
  steering: { key: "steering", label: "Steering", unit: "°", range: [-180, 180], decimals: 0 },
};

/**
 * One raw telemetry sample as delivered by the source, timestamped relative to
 * the start of the lap. Distance is derived, never trusted from the source.
 */
export interface RawSample {
  /** Milliseconds since the start of the lap. */
  t: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  steering: number;
}

/**
 * A lap resampled onto a uniform distance grid. `distance[i]` is
 * `i * step` metres, so the index alone is enough to correlate any two laps.
 */
export interface LapTelemetry {
  driverId: string;
  lap: number;
  /** Metres between samples (1.0 by default). */
  step: number;
  /** Total lap distance in metres. */
  lapDistance: number;
  distance: Float32Array;
  channels: Record<Channel, Float32Array>;
  /** Lap time in seconds as integrated from the speed trace. */
  integratedTime: number;
  /** Cumulative elapsed time in seconds at each distance step. */
  elapsed: Float32Array;
}

export interface CornerMetric {
  index: number;
  /** Distance of the apex in metres. */
  apexDistance: number;
  /** Minimum speed through the corner, km/h. */
  vMin: number;
  /** Distance at which brake pressure first exceeded the threshold, metres. */
  brakeDistance: number | null;
  /** Distance at which throttle first reached 100 %, metres. */
  throttleDistance: number | null;
  /** Entry/exit bounds used for the search, metres. */
  entry: number;
  exit: number;
}

export interface CornerComparison {
  index: number;
  apexDistance: number;
  reference: CornerMetric;
  comparison: CornerMetric | null;
  /** Comparison minus reference. Negative brake delta = braking later. */
  vMinDelta: number | null;
  brakeDelta: number | null;
  throttleDelta: number | null;
  /** Time gained (negative) or lost (positive) across the corner, seconds. */
  timeDelta: number | null;
}
