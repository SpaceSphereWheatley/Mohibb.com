import type {
  Compound,
  LapRecord,
  NeutralisationZone,
} from "@/types/session";
import type { CornerComparison, LapTelemetry, RawSample } from "@/types/telemetry";
import type { ExclusionReason, FuelOptions, StintFilterOptions } from "@/utils/fuelCorrection";
import type { CornerOptions } from "@/utils/cornerDetection";

/** Request/response contract between the UI thread and the data worker. */

export interface ResampleRequest {
  kind: "resample";
  samples: RawSample[];
  driverId: string;
  lap: number;
  lapDistance?: number;
  step?: number;
}

export interface ResampleResponse {
  kind: "resample";
  telemetry: LapTelemetry | null;
}

export interface CornersRequest {
  kind: "corners";
  reference: LapTelemetry;
  comparison: LapTelemetry | null;
  options?: Partial<CornerOptions>;
}

export interface CornersResponse {
  kind: "corners";
  corners: CornerComparison[];
}

export interface DegradationRequest {
  kind: "degradation";
  laps: LapRecord[];
  zones: NeutralisationZone[];
  filter: StintFilterOptions;
  fuel: FuelOptions;
  fuelCorrectionEnabled: boolean;
  driverIds: string[];
  compounds: Compound[];
}

export interface DegradationPoint {
  driverId: string;
  lap: number;
  stint: number;
  compound: Compound;
  tyreAge: number;
  rawTime: number;
  correctedTime: number;
  excluded: ExclusionReason | null;
}

export interface DegradationFit {
  driverId: string;
  stint: number;
  compound: Compound;
  lapStart: number;
  lapEnd: number;
  /** Seconds of lap time lost per lap of tyre age. */
  slope: number;
  /** Corrected lap time at zero tyre age. */
  intercept: number;
  r2: number;
  n: number;
  /** Tyre age at which the fit predicts a full second of fall-off. */
  cliffAge: number | null;
}

export interface DegradationResponse {
  kind: "degradation";
  points: DegradationPoint[];
  fits: DegradationFit[];
}

export interface RaceTraceRequest {
  kind: "raceTrace";
  laps: LapRecord[];
  driverIds: string[];
}

export interface RaceTraceSeries {
  driverId: string;
  /** [lap, cumulative delta to the winner in seconds] */
  points: [number, number][];
  /** Laps on which this driver pitted. */
  pitLaps: number[];
}

export interface RaceTraceResponse {
  kind: "raceTrace";
  baselineDriverId: string | null;
  series: RaceTraceSeries[];
}

export type WorkerRequest =
  | ResampleRequest
  | CornersRequest
  | DegradationRequest
  | RaceTraceRequest;

export type WorkerResponse =
  | ResampleResponse
  | CornersResponse
  | DegradationResponse
  | RaceTraceResponse;

export interface WorkerEnvelope<T> {
  id: number;
  payload: T;
}

export interface WorkerErrorEnvelope {
  id: number;
  error: string;
}

/** Maps a request to the response it produces. */
export type ResponseFor<T extends WorkerRequest> = T extends ResampleRequest
  ? ResampleResponse
  : T extends CornersRequest
    ? CornersResponse
    : T extends DegradationRequest
      ? DegradationResponse
      : T extends RaceTraceRequest
        ? RaceTraceResponse
        : never;
