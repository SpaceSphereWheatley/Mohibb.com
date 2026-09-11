import {
  COMPOUNDS,
  type Compound,
  type DriverInfo,
  type LapRecord,
  type NeutralisationZone,
  type PitRecord,
  type SessionData,
  type SessionKind,
  type StintRecord,
} from "@/types/session";
import type { RawSample } from "@/types/telemetry";
import { DEFAULT_FUEL_BETA } from "@/utils/fuelCorrection";

/**
 * File import.
 *
 * Two shapes are accepted:
 *
 *   .json  a full session in the interchange format below, optionally carrying
 *          raw telemetry for any number of laps.
 *   .csv   one lap of raw telemetry, as a flat table. Headers are matched
 *          loosely so an export from another tool usually drops straight in.
 *
 * Nothing is trusted: every field goes through a normaliser, so a partial or
 * older file can never throw at render time — it just loses the fields it is
 * missing.
 */

export interface TelemetryBundle {
  driverId: string;
  lap: number;
  samples: RawSample[];
}

export interface ImportResult {
  session: SessionData | null;
  telemetry: TelemetryBundle[];
  warnings: string[];
}

const KIND_VALUES: SessionKind[] = ["practice", "qualifying", "race", "unknown"];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "y"].includes(value.toLowerCase());
  return value === 1;
}

function compound(value: unknown): Compound {
  const upper = str(value).toUpperCase() as Compound;
  return COMPOUNDS.includes(upper) ? upper : "UNKNOWN";
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normaliseDriver(raw: unknown, index: number): DriverInfo {
  const row = (raw ?? {}) as Record<string, unknown>;
  const id = str(row.id ?? row.driverId ?? row.driver_number ?? row.number, String(index + 1));
  return {
    id,
    code: str(row.code ?? row.abbreviation ?? row.name_acronym, id).toUpperCase().slice(0, 4),
    name: str(row.name ?? row.full_name ?? row.driver, id),
    team: str(row.team ?? row.team_name, "—"),
    colour: str(row.colour ?? row.color ?? row.team_colour, "#7C8496").replace(/^(?!#)/, "#"),
    number: num(row.number ?? row.driver_number ?? id),
  };
}

function normaliseLap(raw: unknown): LapRecord | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const driverId = str(row.driverId ?? row.driver ?? row.driver_number);
  const lap = num(row.lap ?? row.lap_number ?? row.lapNumber);
  if (!driverId || lap == null) return null;

  return {
    driverId,
    lap,
    lapTime: num(row.lapTime ?? row.lap_duration ?? row.time),
    sector1: num(row.sector1 ?? row.duration_sector_1),
    sector2: num(row.sector2 ?? row.duration_sector_2),
    sector3: num(row.sector3 ?? row.duration_sector_3),
    isPitIn: bool(row.isPitIn ?? row.pit_in ?? row.is_pit_in_lap),
    isPitOut: bool(row.isPitOut ?? row.pit_out ?? row.is_pit_out_lap),
    compound: compound(row.compound ?? row.tyre),
    tyreAge: num(row.tyreAge ?? row.tyre_age ?? row.tyre_life),
    stint: num(row.stint ?? row.stint_number),
    intervalAhead: num(row.intervalAhead ?? row.interval ?? row.gap_ahead),
    position: num(row.position),
    startTime:
      num(row.startTime) ??
      (typeof row.date_start === "string" ? Date.parse(row.date_start) || null : null),
  };
}

function normaliseStint(raw: unknown): StintRecord | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const driverId = str(row.driverId ?? row.driver_number);
  const lapStart = num(row.lapStart ?? row.lap_start);
  const lapEnd = num(row.lapEnd ?? row.lap_end);
  if (!driverId || lapStart == null || lapEnd == null) return null;
  return {
    driverId,
    stint: num(row.stint ?? row.stint_number, 1) as number,
    compound: compound(row.compound),
    lapStart,
    lapEnd,
    startAge: num(row.startAge ?? row.tyre_age_at_start, 0) as number,
  };
}

function normalisePit(raw: unknown): PitRecord | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const driverId = str(row.driverId ?? row.driver_number);
  const lap = num(row.lap ?? row.lap_number);
  if (!driverId || lap == null) return null;
  return {
    driverId,
    lap,
    stationary: num(row.stationary ?? row.stationary_time ?? row.wheel_change),
    pitLaneDuration: num(row.pitLaneDuration ?? row.pit_duration ?? row.duration),
  };
}

function normaliseZone(raw: unknown): NeutralisationZone | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const kind = str(row.kind ?? row.type).toUpperCase();
  const lapStart = num(row.lapStart ?? row.lap_start);
  const lapEnd = num(row.lapEnd ?? row.lap_end);
  if (lapStart == null || lapEnd == null) return null;
  if (kind !== "SC" && kind !== "VSC" && kind !== "RED") return null;
  return { kind, lapStart, lapEnd };
}

function normaliseSamples(raw: unknown[]): RawSample[] {
  const out: RawSample[] = [];
  for (const entry of raw) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const t = num(row.t ?? row.time ?? row.timestamp ?? row.ms);
    if (t == null) continue;
    out.push({
      t: t < 10000 && Number.isFinite(t) && String(row.unit ?? "") === "s" ? t * 1000 : t,
      speed: num(row.speed, 0) as number,
      throttle: num(row.throttle, 0) as number,
      brake: num(row.brake, 0) as number,
      gear: num(row.gear ?? row.n_gear, 0) as number,
      rpm: num(row.rpm, 0) as number,
      steering: num(row.steering ?? row.steer, Number.NaN) as number,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

function normaliseSession(raw: Record<string, unknown>, warnings: string[]): SessionData | null {
  const metaRaw = (raw.meta ?? raw.session ?? {}) as Record<string, unknown>;
  const drivers = array(raw.drivers).map(normaliseDriver);
  const laps = array(raw.laps).map(normaliseLap).filter((lap): lap is LapRecord => lap != null);

  if (!drivers.length && !laps.length) return null;
  if (!drivers.length) warnings.push("No drivers in file — deriving them from lap records.");

  const derived = drivers.length
    ? drivers
    : [...new Set(laps.map((lap) => lap.driverId))].map((id, index) =>
        normaliseDriver({ id, code: id, name: `Car ${id}` }, index),
      );

  const kindRaw = str(metaRaw.kind ?? metaRaw.session_type).toLowerCase() as SessionKind;
  const totalLaps =
    num(metaRaw.totalLaps ?? metaRaw.total_laps) ??
    laps.reduce((max, lap) => Math.max(max, lap.lap), 0);

  return {
    meta: {
      key: str(metaRaw.key ?? metaRaw.session_key, "imported"),
      name: str(metaRaw.name ?? metaRaw.session_name, "Imported session"),
      kind: KIND_VALUES.includes(kindRaw) ? kindRaw : "race",
      circuit: str(metaRaw.circuit ?? metaRaw.circuit_short_name, "—"),
      country: str(metaRaw.country ?? metaRaw.country_name),
      year: num(metaRaw.year, new Date().getUTCFullYear()) as number,
      date: str(metaRaw.date ?? metaRaw.date_start, new Date().toISOString()),
      totalLaps,
      lapDistance: num(metaRaw.lapDistance ?? metaRaw.lap_distance, 0) as number,
      fuelBeta: num(metaRaw.fuelBeta ?? metaRaw.fuel_beta, DEFAULT_FUEL_BETA) as number,
      source: "import",
    },
    drivers: derived,
    laps,
    stints: array(raw.stints)
      .map(normaliseStint)
      .filter((stint): stint is StintRecord => stint != null),
    pits: array(raw.pits ?? raw.pitStops)
      .map(normalisePit)
      .filter((pit): pit is PitRecord => pit != null),
    zones: array(raw.zones ?? raw.neutralisations)
      .map(normaliseZone)
      .filter((zone): zone is NeutralisationZone => zone != null),
  };
}

/** Minimal RFC-4180-ish splitter — enough for exports with quoted headers. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === ";" || char === "\t") {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out.map((value) => value.trim());
}

const CSV_ALIASES: Record<keyof RawSample | "driver" | "lap", string[]> = {
  t: ["t", "time", "timestamp", "ms", "session_time", "elapsed"],
  speed: ["speed", "v", "vcar", "speed_kph"],
  throttle: ["throttle", "tps", "pedal"],
  brake: ["brake", "brake_pressure", "brakes"],
  gear: ["gear", "n_gear", "ngear"],
  rpm: ["rpm", "engine_rpm", "nmot"],
  steering: ["steering", "steer", "steering_angle", "swa"],
  driver: ["driver", "driverid", "driver_number", "car"],
  lap: ["lap", "lap_number", "lapnumber"],
};

function headerIndex(headers: string[], aliases: string[]): number {
  const normalised = headers.map((header) => header.toLowerCase().replace(/[\s_-]/g, ""));
  for (const alias of aliases) {
    const index = normalised.indexOf(alias.replace(/[\s_-]/g, ""));
    if (index !== -1) return index;
  }
  return -1;
}

function parseCsv(text: string, warnings: string[]): TelemetryBundle[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const columns = {
    t: headerIndex(headers, CSV_ALIASES.t),
    speed: headerIndex(headers, CSV_ALIASES.speed),
    throttle: headerIndex(headers, CSV_ALIASES.throttle),
    brake: headerIndex(headers, CSV_ALIASES.brake),
    gear: headerIndex(headers, CSV_ALIASES.gear),
    rpm: headerIndex(headers, CSV_ALIASES.rpm),
    steering: headerIndex(headers, CSV_ALIASES.steering),
    driver: headerIndex(headers, CSV_ALIASES.driver),
    lap: headerIndex(headers, CSV_ALIASES.lap),
  };

  if (columns.t === -1 || columns.speed === -1) {
    warnings.push("CSV needs at least a time column and a speed column.");
    return [];
  }

  const grouped = new Map<string, RawSample[]>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const pick = (index: number) => (index === -1 ? null : num(cells[index]));
    const t = pick(columns.t);
    if (t == null) continue;

    const driverId = columns.driver === -1 ? "IMPORT" : str(cells[columns.driver], "IMPORT");
    const lap = columns.lap === -1 ? 1 : (num(cells[columns.lap], 1) as number);
    const key = `${driverId}:${lap}`;

    const bucket = grouped.get(key) ?? [];
    bucket.push({
      t,
      speed: pick(columns.speed) ?? 0,
      throttle: pick(columns.throttle) ?? 0,
      brake: pick(columns.brake) ?? 0,
      gear: pick(columns.gear) ?? 0,
      rpm: pick(columns.rpm) ?? 0,
      steering: pick(columns.steering) ?? Number.NaN,
    });
    grouped.set(key, bucket);
  }

  return [...grouped.entries()].map(([key, samples]) => {
    const [driverId, lap] = key.split(":");
    // Seconds-based exports are common; anything under ~600 for a full lap is
    // far too small to be milliseconds.
    const span = samples[samples.length - 1].t - samples[0].t;
    const scale = span > 0 && span < 600 ? 1000 : 1;
    const origin = samples[0].t;
    return {
      driverId,
      lap: Number(lap),
      samples: samples
        .map((sample) => ({ ...sample, t: (sample.t - origin) * scale }))
        .sort((a, b) => a.t - b.t),
    };
  });
}

export async function parseSessionFile(file: File): Promise<ImportResult> {
  const warnings: string[] = [];
  const text = await file.text();
  const isCsv = /\.csv$|\.tsv$/i.test(file.name) || !text.trimStart().startsWith("{");

  if (isCsv) {
    const telemetry = parseCsv(text, warnings);
    if (!telemetry.length) warnings.push("No telemetry rows found in the file.");
    return { session: null, telemetry, warnings };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${file.name} is not valid JSON — ${(error as Error).message}`);
  }

  const session = normaliseSession(raw, warnings);
  const telemetry = array(raw.telemetry)
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const driverId = str(row.driverId ?? row.driver ?? row.driver_number);
      const lap = num(row.lap ?? row.lap_number);
      const samples = normaliseSamples(array(row.samples ?? row.data));
      if (!driverId || lap == null || samples.length < 8) return null;
      return { driverId, lap, samples } satisfies TelemetryBundle;
    })
    .filter((bundle): bundle is TelemetryBundle => bundle != null);

  if (!session && !telemetry.length) {
    throw new Error(`${file.name} contained neither a session nor telemetry.`);
  }

  return { session, telemetry, warnings };
}
