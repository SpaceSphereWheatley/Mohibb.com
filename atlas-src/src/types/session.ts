/** Session-level (lap resolution) data model. */

export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | "UNKNOWN";

export const COMPOUNDS: Compound[] = [
  "SOFT",
  "MEDIUM",
  "HARD",
  "INTERMEDIATE",
  "WET",
  "UNKNOWN",
];

export const COMPOUND_COLOUR: Record<Compound, string> = {
  SOFT: "#EF4444",
  MEDIUM: "#EAB308",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#10B981",
  WET: "#3B82F6",
  UNKNOWN: "#64748B",
};

export type SessionKind = "practice" | "qualifying" | "race" | "unknown";

export interface DriverInfo {
  /** Stable key used everywhere else (OpenF1 driver_number as a string). */
  id: string;
  /** Three-letter broadcast code, e.g. "VER". */
  code: string;
  name: string;
  team: string;
  /** Team colour as #rrggbb. */
  colour: string;
  number: number | null;
}

/** One timed lap for one driver. */
export interface LapRecord {
  driverId: string;
  lap: number;
  /** Seconds, or null when the lap was not timed. */
  lapTime: number | null;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  /** Lap that ends in the pit lane. */
  isPitIn: boolean;
  /** Lap that starts from the pit lane. */
  isPitOut: boolean;
  compound: Compound;
  /** Tyre age in laps at the *start* of this lap. */
  tyreAge: number | null;
  stint: number | null;
  /** Gap in seconds to the car ahead on track, or null when unknown/leading. */
  intervalAhead: number | null;
  position: number | null;
  /** Epoch milliseconds at which the lap started. */
  startTime: number | null;
}

export interface StintRecord {
  driverId: string;
  stint: number;
  compound: Compound;
  lapStart: number;
  lapEnd: number;
  /** Tyre age in laps when the stint started (>0 for scrubbed sets). */
  startAge: number;
}

export interface PitRecord {
  driverId: string;
  /** Lap on which the car entered the pit lane. */
  lap: number;
  /** Wheel-change / stationary time in seconds, when reported. */
  stationary: number | null;
  /** Pit entry to pit exit, in seconds, when derivable. */
  pitLaneDuration: number | null;
}

export type NeutralisationKind = "SC" | "VSC" | "RED";

export interface NeutralisationZone {
  kind: NeutralisationKind;
  lapStart: number;
  lapEnd: number;
}

export interface SessionMeta {
  key: string;
  name: string;
  kind: SessionKind;
  circuit: string;
  country: string;
  year: number;
  /** ISO date of the session start. */
  date: string;
  totalLaps: number;
  /** Lap distance in metres. Derived from telemetry when not supplied. */
  lapDistance: number;
  /**
   * Fuel penalty factor, seconds of lap time per lap of fuel still on board.
   * Circuit dependent; 0.030–0.060 s is the usual range.
   */
  fuelBeta: number;
  /** Where this session came from, for provenance in the UI. */
  source: "openf1" | "import" | "sample";
}

export interface SessionData {
  meta: SessionMeta;
  drivers: DriverInfo[];
  laps: LapRecord[];
  stints: StintRecord[];
  pits: PitRecord[];
  zones: NeutralisationZone[];
}

/** Shape of an OpenF1 session as shown in the session picker. */
export interface SessionSummary {
  key: string;
  name: string;
  kind: SessionKind;
  circuit: string;
  country: string;
  year: number;
  date: string;
}
