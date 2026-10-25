"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { DriverInfo, LapRecord, SessionData } from "@/types/session";
import type { LapTelemetry, RawSample } from "@/types/telemetry";
import { runOffThread } from "@/hooks/useDataWorker";
import type { ImportResult } from "@/lib/importSession";
import { fetchLapTelemetry, loadSession, type LoadProgress } from "@/lib/openf1";
import { readLap, writeLap } from "@/lib/telemetryCache";

export type SessionStatus = "empty" | "loading" | "ready" | "error";

type TelemetryKey = string;

const lapKey = (driverId: string, lap: number): TelemetryKey => `${driverId}:${lap}`;

/**
 * Shared empty array.
 *
 * A selector that builds `?? []` inline returns a new reference on every call,
 * which useSyncExternalStore reads as "the store changed" and re-renders
 * forever. One frozen instance keeps the identity stable while no session is
 * loaded.
 */
const NO_DRIVERS: DriverInfo[] = [];

export const selectDrivers = (state: SessionState): DriverInfo[] =>
  state.data?.drivers ?? NO_DRIVERS;

interface PersistedSlice {
  lastSessionKey: string | null;
  referenceDriver: string | null;
  comparisonDriver: string | null;
}

interface SessionState extends PersistedSlice {
  status: SessionStatus;
  progress: LoadProgress | null;
  error: string | null;
  warnings: string[];
  data: SessionData | null;

  referenceLap: number | null;
  comparisonLap: number | null;

  telemetry: Record<TelemetryKey, LapTelemetry>;
  telemetryPending: Record<TelemetryKey, true>;
  telemetryError: Record<TelemetryKey, string>;

  loadFromOpenF1: (sessionKey: string) => Promise<void>;
  loadSample: (basePath?: string) => Promise<void>;
  applyImport: (result: ImportResult) => Promise<void>;
  reset: () => void;

  setReferenceDriver: (driverId: string | null) => void;
  setComparisonDriver: (driverId: string | null) => void;
  setReferenceLap: (lap: number | null) => void;
  setComparisonLap: (lap: number | null) => void;

  ensureTelemetry: (driverId: string, lap: number) => Promise<void>;
  getTelemetry: (driverId: string | null, lap: number | null) => LapTelemetry | null;
  fastestLapFor: (driverId: string) => LapRecord | null;
  lapsFor: (driverId: string) => LapRecord[];
}

/** The fastest lap that is neither an in-lap nor an out-lap. */
function pickFastest(laps: LapRecord[], driverId: string): LapRecord | null {
  let best: LapRecord | null = null;
  for (const lap of laps) {
    if (lap.driverId !== driverId) continue;
    if (lap.lapTime == null || lap.isPitIn || lap.isPitOut) continue;
    if (!best || lap.lapTime < (best.lapTime as number)) best = lap;
  }
  return best;
}

/** Two quickest cars in the session, as a sensible default comparison. */
function defaultDrivers(data: SessionData): [string | null, string | null] {
  const ranked = data.drivers
    .map((driver) => ({ driver, best: pickFastest(data.laps, driver.id) }))
    .filter((entry) => entry.best != null)
    .sort((a, b) => (a.best!.lapTime as number) - (b.best!.lapTime as number));
  return [ranked[0]?.driver.id ?? null, ranked[1]?.driver.id ?? null];
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      status: "empty",
      progress: null,
      error: null,
      warnings: [],
      data: null,
      lastSessionKey: null,
      referenceDriver: null,
      comparisonDriver: null,
      referenceLap: null,
      comparisonLap: null,
      telemetry: {},
      telemetryPending: {},
      telemetryError: {},

      async loadFromOpenF1(sessionKey) {
        set({ status: "loading", error: null, progress: null, warnings: [] });
        try {
          const data = await loadSession(sessionKey, {
            onProgress: (progress) => set({ progress }),
          });
          adopt(set, get, data);
        } catch (error) {
          set({
            status: "error",
            progress: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },

      async loadSample(basePath = "") {
        set({ status: "loading", error: null, progress: null, warnings: [] });
        try {
          const response = await fetch(`${basePath}/data/sample-session.json`);
          if (!response.ok) throw new Error(`Sample data responded ${response.status}`);
          const raw = (await response.json()) as {
            session: SessionData;
            telemetry?: { driverId: string; lap: number; samples: RawSample[] }[];
          };
          adopt(set, get, { ...raw.session, meta: { ...raw.session.meta, source: "sample" } });

          for (const bundle of raw.telemetry ?? []) {
            await resampleInto(set, get, bundle.driverId, bundle.lap, bundle.samples);
          }
          focusOn(set, raw.telemetry ?? []);
        } catch (error) {
          set({
            status: "error",
            progress: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },

      async applyImport(result) {
        if (result.session) {
          adopt(set, get, result.session);
        }
        set({ warnings: result.warnings });
        for (const bundle of result.telemetry) {
          await resampleInto(set, get, bundle.driverId, bundle.lap, bundle.samples);
        }
        // A file that carries telemetry carries it for a reason: point the
        // comparison at those laps rather than at a fastest lap with no trace.
        focusOn(set, result.telemetry);
        if (!result.session && result.telemetry.length) set({ status: "ready" });
      },

      reset() {
        set({
          status: "empty",
          data: null,
          error: null,
          warnings: [],
          progress: null,
          telemetry: {},
          telemetryPending: {},
          telemetryError: {},
          referenceLap: null,
          comparisonLap: null,
        });
      },

      setReferenceDriver(driverId) {
        const data = get().data;
        const lap = driverId && data ? pickFastest(data.laps, driverId)?.lap ?? null : null;
        set({ referenceDriver: driverId, referenceLap: lap });
      },

      setComparisonDriver(driverId) {
        const data = get().data;
        const lap = driverId && data ? pickFastest(data.laps, driverId)?.lap ?? null : null;
        set({ comparisonDriver: driverId, comparisonLap: lap });
      },

      setReferenceLap(lap) {
        set({ referenceLap: lap });
      },

      setComparisonLap(lap) {
        set({ comparisonLap: lap });
      },

      async ensureTelemetry(driverId, lap) {
        const key = lapKey(driverId, lap);
        const state = get();
        if (state.telemetry[key] || state.telemetryPending[key]) return;
        const data = state.data;
        if (!data) return;

        const record = data.laps.find((row) => row.driverId === driverId && row.lap === lap);
        if (!record) return;

        set((prev) => ({ telemetryPending: { ...prev.telemetryPending, [key]: true } }));

        try {
          const cached = await readLap(data.meta.key, driverId, lap);
          if (cached) {
            store(set, key, cached);
            return;
          }

          if (data.meta.source !== "openf1") {
            throw new Error("No telemetry for this lap in the loaded file.");
          }

          const samples = await fetchLapTelemetry(data.meta.key, record);
          if (!samples.length) throw new Error("OpenF1 returned no car data for this lap.");

          const { telemetry } = await runOffThread({
            kind: "resample",
            samples,
            driverId,
            lap,
            lapDistance: data.meta.lapDistance || undefined,
          });
          if (!telemetry) throw new Error("Could not resample this lap.");

          void writeLap(data.meta.key, telemetry);
          store(set, key, telemetry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set((prev) => {
            const pending = { ...prev.telemetryPending };
            delete pending[key];
            return { telemetryPending: pending, telemetryError: { ...prev.telemetryError, [key]: message } };
          });
        }
      },

      getTelemetry(driverId, lap) {
        if (!driverId || lap == null) return null;
        return get().telemetry[lapKey(driverId, lap)] ?? null;
      },

      fastestLapFor(driverId) {
        const data = get().data;
        return data ? pickFastest(data.laps, driverId) : null;
      },

      lapsFor(driverId) {
        const data = get().data;
        if (!data) return [];
        return data.laps.filter((lap) => lap.driverId === driverId).sort((a, b) => a.lap - b.lap);
      },
    }),
    {
      name: "atlas-session-v1",
      storage: createJSONStorage(() => localStorage),
      // Telemetry is far too big for localStorage and lives in IndexedDB; only
      // the selections worth restoring are persisted.
      partialize: (state): PersistedSlice => ({
        lastSessionKey: state.lastSessionKey,
        referenceDriver: state.referenceDriver,
        comparisonDriver: state.comparisonDriver,
      }),
    },
  ),
);

type Setter = (
  partial:
    | Partial<SessionState>
    | ((state: SessionState) => Partial<SessionState>),
) => void;

function store(set: Setter, key: TelemetryKey, telemetry: LapTelemetry) {
  set((prev) => {
    const pending = { ...prev.telemetryPending };
    delete pending[key];
    const errors = { ...prev.telemetryError };
    delete errors[key];
    return {
      telemetry: { ...prev.telemetry, [key]: telemetry },
      telemetryPending: pending,
      telemetryError: errors,
    };
  });
}

/** Points the reference/comparison selection at laps that actually have traces. */
function focusOn(set: Setter, bundles: { driverId: string; lap: number }[]) {
  if (!bundles.length) return;
  const [first, second] = bundles;
  set({
    referenceDriver: first.driverId,
    referenceLap: first.lap,
    ...(second ? { comparisonDriver: second.driverId, comparisonLap: second.lap } : {}),
  });
}

function adopt(set: Setter, get: () => SessionState, data: SessionData) {
  const previous = get();
  const [fallbackA, fallbackB] = defaultDrivers(data);

  const known = new Set(data.drivers.map((driver) => driver.id));
  const referenceDriver =
    previous.referenceDriver && known.has(previous.referenceDriver)
      ? previous.referenceDriver
      : fallbackA;
  const comparisonDriver =
    previous.comparisonDriver && known.has(previous.comparisonDriver)
      ? previous.comparisonDriver
      : fallbackB;

  set({
    status: "ready",
    progress: null,
    error: null,
    data,
    lastSessionKey: data.meta.key,
    referenceDriver,
    comparisonDriver,
    referenceLap: referenceDriver ? pickFastest(data.laps, referenceDriver)?.lap ?? null : null,
    comparisonLap: comparisonDriver ? pickFastest(data.laps, comparisonDriver)?.lap ?? null : null,
    telemetry: {},
    telemetryPending: {},
    telemetryError: {},
  });
}

async function resampleInto(
  set: Setter,
  get: () => SessionState,
  driverId: string,
  lap: number,
  samples: RawSample[],
) {
  const data = get().data;
  const { telemetry } = await runOffThread({
    kind: "resample",
    samples,
    driverId,
    lap,
    lapDistance: data?.meta.lapDistance || undefined,
  });
  if (telemetry) {
    if (data) void writeLap(data.meta.key, telemetry);
    store(set, lapKey(driverId, lap), telemetry);
  }
}
