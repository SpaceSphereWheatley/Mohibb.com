import {
  type Compound,
  type DriverInfo,
  type LapRecord,
  type NeutralisationZone,
  type PitRecord,
  type SessionData,
  type SessionKind,
  type SessionSummary,
  type StintRecord,
} from "@/types/session";
import type { RawSample } from "@/types/telemetry";
import { DEFAULT_FUEL_BETA } from "@/utils/fuelCorrection";
import { estimateLapDistance } from "@/utils/distanceInterpolation";

/**
 * OpenF1 client.
 *
 * Everything here runs in the browser against https://api.openf1.org, which
 * serves permissive CORS headers — there is no server side to this app. The
 * module's job is to turn OpenF1's flat, per-endpoint rows into the single
 * `SessionData` shape the rest of the dashboard understands, so that an
 * imported file and a live fetch are indistinguishable downstream.
 */

const BASE = "https://api.openf1.org/v1";

async function get<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`${BASE}/${path}`, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`OpenF1 ${path} responded ${response.status}`);
  }
  const body = (await response.json()) as T[];
  return Array.isArray(body) ? body : [];
}

interface Rf1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  circuit_short_name: string | null;
  country_name: string | null;
  location: string | null;
  year: number;
}

interface Rf1Driver {
  driver_number: number;
  name_acronym: string | null;
  full_name: string | null;
  broadcast_name: string | null;
  team_name: string | null;
  team_colour: string | null;
}

interface Rf1Lap {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean | null;
  date_start: string | null;
}

interface Rf1Stint {
  driver_number: number;
  stint_number: number;
  compound: string | null;
  lap_start: number | null;
  lap_end: number | null;
  tyre_age_at_start: number | null;
}

interface Rf1Pit {
  driver_number: number;
  lap_number: number;
  pit_duration: number | null;
  date: string;
}

interface Rf1Interval {
  driver_number: number;
  date: string;
  interval: number | string | null;
  gap_to_leader: number | string | null;
}

interface Rf1Position {
  driver_number: number;
  date: string;
  position: number;
}

interface Rf1RaceControl {
  category: string | null;
  flag: string | null;
  message: string | null;
  lap_number: number | null;
  date: string;
}

interface Rf1CarData {
  date: string;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  n_gear: number | null;
  rpm: number | null;
}

function sessionKind(type: string, name: string): SessionKind {
  const haystack = `${type} ${name}`.toLowerCase();
  if (haystack.includes("race") || haystack.includes("sprint")) return "race";
  if (haystack.includes("qualifying") || haystack.includes("shootout")) return "qualifying";
  if (haystack.includes("practice")) return "practice";
  return "unknown";
}

function compound(value: string | null): Compound {
  switch ((value ?? "").toUpperCase()) {
    case "SOFT":
      return "SOFT";
    case "MEDIUM":
      return "MEDIUM";
    case "HARD":
      return "HARD";
    case "INTERMEDIATE":
      return "INTERMEDIATE";
    case "WET":
      return "WET";
    default:
      return "UNKNOWN";
  }
}

function teamColour(value: string | null): string {
  if (!value) return "#7C8496";
  return value.startsWith("#") ? value : `#${value}`;
}

function numeric(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function listSessions(year: number, signal?: AbortSignal): Promise<SessionSummary[]> {
  const rows = await get<Rf1Session>(`sessions?year=${year}`, signal);
  return rows
    .map((row) => ({
      key: String(row.session_key),
      name: row.session_name,
      kind: sessionKind(row.session_type, row.session_name),
      circuit: row.circuit_short_name ?? row.location ?? "Unknown circuit",
      country: row.country_name ?? "",
      year: row.year,
      date: row.date_start,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Picks the interval to the car ahead at the moment a lap began. OpenF1
 * publishes intervals as a dense time series, so this is a per-driver binary
 * search rather than a join.
 */
function intervalIndex(rows: Rf1Interval[]): Map<string, { t: number[]; v: (number | null)[] }> {
  const byDriver = new Map<string, { t: number[]; v: (number | null)[] }>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sorted) {
    const id = String(row.driver_number);
    let entry = byDriver.get(id);
    if (!entry) {
      entry = { t: [], v: [] };
      byDriver.set(id, entry);
    }
    entry.t.push(Date.parse(row.date));
    entry.v.push(numeric(row.interval));
  }
  return byDriver;
}

function lookupAt(
  index: Map<string, { t: number[]; v: (number | null)[] }>,
  driverId: string,
  at: number,
): number | null {
  const entry = index.get(driverId);
  if (!entry || entry.t.length === 0) return null;
  let lo = 0;
  let hi = entry.t.length - 1;
  if (at <= entry.t[0]) return entry.v[0];
  if (at >= entry.t[hi]) return entry.v[hi];
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (entry.t[mid] <= at) lo = mid;
    else hi = mid;
  }
  return entry.v[lo];
}

function positionIndex(rows: Rf1Position[]) {
  const byDriver = new Map<string, { t: number[]; v: (number | null)[] }>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sorted) {
    const id = String(row.driver_number);
    let entry = byDriver.get(id);
    if (!entry) {
      entry = { t: [], v: [] };
      byDriver.set(id, entry);
    }
    entry.t.push(Date.parse(row.date));
    entry.v.push(row.position);
  }
  return byDriver;
}

/**
 * Turns race-control messages into lap ranges. OpenF1 has no "the safety car
 * was out between these laps" field, so deployment and withdrawal messages are
 * paired up in order; an unterminated zone runs to the end of the session.
 */
function neutralisations(rows: Rf1RaceControl[], totalLaps: number): NeutralisationZone[] {
  const zones: NeutralisationZone[] = [];
  const open = new Map<NeutralisationZone["kind"], number>();
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  for (const row of ordered) {
    const message = (row.message ?? "").toUpperCase();
    const lap = row.lap_number ?? 0;

    if (message.includes("VIRTUAL SAFETY CAR")) {
      toggle("VSC", message, lap);
    } else if (message.includes("SAFETY CAR")) {
      toggle("SC", message, lap);
    } else if (row.flag === "RED") {
      open.set("RED", lap);
    } else if (row.flag === "GREEN" && open.has("RED")) {
      close("RED", lap);
    }
  }

  for (const [kind, start] of open) {
    zones.push({ kind, lapStart: start, lapEnd: totalLaps });
  }
  return zones.filter((zone) => zone.lapEnd >= zone.lapStart);

  function toggle(kind: NeutralisationZone["kind"], message: string, lap: number) {
    const ending = message.includes("ENDING") || message.includes("IN THIS LAP");
    if (ending) close(kind, lap);
    else if (!open.has(kind)) open.set(kind, lap);
  }

  function close(kind: NeutralisationZone["kind"], lap: number) {
    const start = open.get(kind);
    if (start == null) return;
    open.delete(kind);
    zones.push({ kind, lapStart: start, lapEnd: Math.max(start, lap) });
  }
}

export interface LoadProgress {
  step: string;
  done: number;
  total: number;
}

export interface LoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
  /** Intervals are the biggest payload of the lot; skipping them disables the dirty-air filter. */
  includeIntervals?: boolean;
}

export async function loadSession(
  sessionKey: string,
  options: LoadOptions = {},
): Promise<SessionData> {
  const { signal, onProgress } = options;
  const includeIntervals = options.includeIntervals ?? true;
  const steps = includeIntervals ? 7 : 6;
  let done = 0;
  const tick = (step: string) => {
    onProgress?.({ step, done: done++, total: steps });
  };

  tick("session");
  const [session] = await get<Rf1Session>(`sessions?session_key=${sessionKey}`, signal);
  if (!session) throw new Error(`No OpenF1 session for key ${sessionKey}`);
  const kind = sessionKind(session.session_type, session.session_name);

  tick("drivers");
  const driverRows = await get<Rf1Driver>(`drivers?session_key=${sessionKey}`, signal);

  tick("laps");
  const lapRows = await get<Rf1Lap>(`laps?session_key=${sessionKey}`, signal);

  tick("stints");
  const stintRows = await get<Rf1Stint>(`stints?session_key=${sessionKey}`, signal);

  tick("pit stops");
  const pitRows = await get<Rf1Pit>(`pit?session_key=${sessionKey}`, signal);

  tick("race control");
  const controlRows = await get<Rf1RaceControl>(`race_control?session_key=${sessionKey}`, signal)
    .catch(() => [] as Rf1RaceControl[]);

  let intervalRows: Rf1Interval[] = [];
  let positionRows: Rf1Position[] = [];
  if (includeIntervals && kind === "race") {
    tick("intervals");
    intervalRows = await get<Rf1Interval>(`intervals?session_key=${sessionKey}`, signal)
      .catch(() => [] as Rf1Interval[]);
    positionRows = await get<Rf1Position>(`position?session_key=${sessionKey}`, signal)
      .catch(() => [] as Rf1Position[]);
  }

  const drivers: DriverInfo[] = driverRows
    .map((row) => ({
      id: String(row.driver_number),
      code: row.name_acronym ?? String(row.driver_number),
      name: row.full_name ?? row.broadcast_name ?? String(row.driver_number),
      team: row.team_name ?? "—",
      colour: teamColour(row.team_colour),
      number: row.driver_number,
    }))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  const stints: StintRecord[] = stintRows
    .filter((row) => row.lap_start != null && row.lap_end != null)
    .map((row) => ({
      driverId: String(row.driver_number),
      stint: row.stint_number,
      compound: compound(row.compound),
      lapStart: row.lap_start as number,
      lapEnd: row.lap_end as number,
      startAge: row.tyre_age_at_start ?? 0,
    }));

  const stintFor = (driverId: string, lap: number) =>
    stints.find((s) => s.driverId === driverId && lap >= s.lapStart && lap <= s.lapEnd) ?? null;

  const pits: PitRecord[] = pitRows.map((row) => ({
    driverId: String(row.driver_number),
    lap: row.lap_number,
    // OpenF1 publishes total pit-lane time only; a stationary time would have
    // to be guessed, and a guessed number in a pit-execution audit is worse
    // than an honest blank.
    stationary: null,
    pitLaneDuration: row.pit_duration,
  }));
  const pitInLaps = new Set(pits.map((pit) => `${pit.driverId}:${pit.lap}`));

  const intervals = intervalRows.length ? intervalIndex(intervalRows) : null;
  const positions = positionRows.length ? positionIndex(positionRows) : null;

  const totalLaps = lapRows.reduce((max, row) => Math.max(max, row.lap_number ?? 0), 0);

  const laps: LapRecord[] = lapRows.map((row) => {
    const driverId = String(row.driver_number);
    const stint = stintFor(driverId, row.lap_number);
    const startTime = row.date_start ? Date.parse(row.date_start) : null;
    return {
      driverId,
      lap: row.lap_number,
      lapTime: row.lap_duration,
      sector1: row.duration_sector_1,
      sector2: row.duration_sector_2,
      sector3: row.duration_sector_3,
      isPitIn: pitInLaps.has(`${driverId}:${row.lap_number}`),
      isPitOut: Boolean(row.is_pit_out_lap),
      compound: stint?.compound ?? "UNKNOWN",
      tyreAge: stint ? stint.startAge + (row.lap_number - stint.lapStart) : null,
      stint: stint?.stint ?? null,
      intervalAhead:
        intervals && startTime != null ? lookupAt(intervals, driverId, startTime) : null,
      position:
        positions && startTime != null ? lookupAt(positions, driverId, startTime) : null,
      startTime,
    };
  });

  laps.sort((a, b) => a.driverId.localeCompare(b.driverId) || a.lap - b.lap);

  const lapDistance = await estimateDistance(sessionKey, laps, signal).catch(() => 0);

  return {
    meta: {
      key: String(session.session_key),
      name: session.session_name,
      kind,
      circuit: session.circuit_short_name ?? session.location ?? "Unknown circuit",
      country: session.country_name ?? "",
      year: session.year,
      date: session.date_start,
      totalLaps,
      lapDistance,
      fuelBeta: DEFAULT_FUEL_BETA,
      source: "openf1",
    },
    drivers,
    laps,
    stints,
    pits,
    zones: neutralisations(controlRows, totalLaps),
  };
}

/** Integrates the session's fastest lap to recover the circuit length. */
async function estimateDistance(
  sessionKey: string,
  laps: LapRecord[],
  signal?: AbortSignal,
): Promise<number> {
  const fastest = laps
    .filter((lap) => lap.lapTime != null && lap.startTime != null && !lap.isPitIn && !lap.isPitOut)
    .sort((a, b) => (a.lapTime as number) - (b.lapTime as number))[0];
  if (!fastest) return 0;

  const samples = await fetchLapTelemetry(sessionKey, fastest, signal);
  if (!samples.length) return 0;
  return estimateLapDistance(samples) ?? 0;
}

/**
 * Raw car telemetry for one lap. OpenF1 samples at roughly 3.7 Hz, which is
 * why everything downstream interpolates rather than reads values directly.
 */
export async function fetchLapTelemetry(
  sessionKey: string,
  lap: LapRecord,
  signal?: AbortSignal,
): Promise<RawSample[]> {
  if (lap.startTime == null || lap.lapTime == null) return [];

  // A little padding either side, so the interpolator has a knot outside the
  // range at both ends rather than extrapolating.
  const from = new Date(lap.startTime - 500).toISOString();
  const to = new Date(lap.startTime + lap.lapTime * 1000 + 500).toISOString();
  const query =
    `car_data?session_key=${sessionKey}` +
    `&driver_number=${encodeURIComponent(lap.driverId)}` +
    `&date%3E=${encodeURIComponent(from)}` +
    `&date%3C=${encodeURIComponent(to)}`;

  const rows = await get<Rf1CarData>(query, signal);
  if (!rows.length) return [];

  const sorted = rows
    .map((row) => ({ ...row, ms: Date.parse(row.date) }))
    .filter((row) => Number.isFinite(row.ms))
    .sort((a, b) => a.ms - b.ms);

  const origin = sorted[0].ms;
  return sorted.map((row) => ({
    t: row.ms - origin,
    speed: row.speed ?? 0,
    throttle: row.throttle ?? 0,
    brake: row.brake ?? 0,
    gear: row.n_gear ?? 0,
    rpm: row.rpm ?? 0,
    // OpenF1's car_data has no steering channel. NaN rather than 0 so the
    // strip stack can tell "wheel straight" from "not published".
    steering: Number.NaN,
  }));
}

export const AVAILABLE_YEARS = (() => {
  const current = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let year = current; year >= 2023; year--) years.push(year);
  return years;
})();
