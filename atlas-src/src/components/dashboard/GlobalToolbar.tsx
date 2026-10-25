"use client";

import { useState } from "react";
import { Lock, Unlock, Pin, PinOff, FolderOpen, Loader2 } from "lucide-react";
import { useDashboardStore } from "@/store/useDashboardStore";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import { useTelemetryCursorStore } from "@/store/useTelemetryCursorStore";
import type { LapRecord } from "@/types/session";
import { PresetManager } from "./PresetManager";
import { SessionLoader } from "./SessionLoader";
import * as fmt from "@/utils/format";

/**
 * The one bar that owns session-wide state: which two cars are being compared,
 * which lap of each, and whether the grid can be moved.
 */
export function GlobalToolbar() {
  const [loaderOpen, setLoaderOpen] = useState(false);

  const status = useSessionStore((state) => state.status);
  const progress = useSessionStore((state) => state.progress);
  const data = useSessionStore((state) => state.data);
  const referenceDriver = useSessionStore((state) => state.referenceDriver);
  const comparisonDriver = useSessionStore((state) => state.comparisonDriver);
  const referenceLap = useSessionStore((state) => state.referenceLap);
  const comparisonLap = useSessionStore((state) => state.comparisonLap);
  const setReferenceDriver = useSessionStore((state) => state.setReferenceDriver);
  const setComparisonDriver = useSessionStore((state) => state.setComparisonDriver);
  const setReferenceLap = useSessionStore((state) => state.setReferenceLap);
  const setComparisonLap = useSessionStore((state) => state.setComparisonLap);
  const lapsFor = useSessionStore((state) => state.lapsFor);

  const locked = useDashboardStore((state) => state.locked);
  const toggleLocked = useDashboardStore((state) => state.toggleLocked);
  const pinned = useTelemetryCursorStore((state) => state.pinned);
  const togglePinned = useTelemetryCursorStore((state) => state.togglePinned);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-edge bg-surface/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-[13px] font-bold tracking-[0.2em] text-ink">
              ATLAS
            </span>
            <span className="hidden truncate text-[10px] text-ink-3 md:inline">
              post-race engineering
            </span>
          </div>

          <span className="hidden h-5 w-px bg-edge sm:block" />

          <button
            type="button"
            onClick={() => setLoaderOpen(true)}
            className="flex min-w-0 items-center gap-2 rounded border border-edge bg-panel px-2 py-1.5 text-[11px] text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            {status === "loading" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <FolderOpen size={13} />
            )}
            <span className="max-w-[30ch] truncate">
              {status === "loading"
                ? `Loading ${progress?.step ?? ""}…`
                : data
                  ? `${data.meta.year} ${data.meta.circuit} · ${data.meta.name}`
                  : "Load a session"}
            </span>
          </button>

          <DriverPicker
            label="Reference"
            colour="var(--color-ref)"
            driverId={referenceDriver}
            lap={referenceLap}
            onDriver={setReferenceDriver}
            onLap={setReferenceLap}
            laps={referenceDriver ? lapsFor(referenceDriver) : []}
          />
          <DriverPicker
            label="Comparison"
            colour="var(--color-cmp)"
            driverId={comparisonDriver}
            lap={comparisonLap}
            onDriver={setComparisonDriver}
            onLap={setComparisonLap}
            laps={comparisonDriver ? lapsFor(comparisonDriver) : []}
            allowNone
          />

          <div className="ml-auto flex items-center gap-1">
            <PresetManager />
            <button
              type="button"
              onClick={togglePinned}
              aria-pressed={pinned}
              className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] ${
                pinned
                  ? "border-ref/60 bg-ref/10 text-ref"
                  : "border-edge bg-panel text-ink-2 hover:border-ink-3 hover:text-ink"
              }`}
              title="Freeze the telemetry cursor where it is"
            >
              {pinned ? <Pin size={13} /> : <PinOff size={13} />}
              <span className="hidden lg:inline">{pinned ? "Cursor pinned" : "Pin cursor"}</span>
            </button>
            <button
              type="button"
              onClick={toggleLocked}
              aria-pressed={locked}
              className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] ${
                locked
                  ? "border-warn/60 bg-warn/10 text-warn"
                  : "border-edge bg-panel text-ink-2 hover:border-ink-3 hover:text-ink"
              }`}
              title="Stop panels being dragged or resized by accident"
            >
              {locked ? <Lock size={13} /> : <Unlock size={13} />}
              <span className="hidden lg:inline">{locked ? "Locked" : "Lock"}</span>
            </button>
          </div>
        </div>
      </header>

      {loaderOpen ? <SessionLoader onClose={() => setLoaderOpen(false)} /> : null}
    </>
  );
}

function DriverPicker({
  label,
  colour,
  driverId,
  lap,
  laps,
  onDriver,
  onLap,
  allowNone = false,
}: {
  label: string;
  colour: string;
  driverId: string | null;
  lap: number | null;
  laps: LapRecord[];
  onDriver: (id: string | null) => void;
  onLap: (lap: number | null) => void;
  allowNone?: boolean;
}) {
  const drivers = useSessionStore(selectDrivers);

  const timed = laps.filter((row) => row.lapTime != null);
  const fastest = timed.reduce<number | null>(
    (best, row) => (best == null || (row.lapTime as number) < best ? (row.lapTime as number) : best),
    null,
  );

  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-4 w-1 shrink-0 rounded-sm"
        style={{ background: colour }}
      />
      <div className="flex flex-col">
        <span className="text-[9px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
        <div className="flex items-center gap-1">
          <select
            value={driverId ?? ""}
            aria-label={`${label} driver`}
            onChange={(event) => onDriver(event.target.value || null)}
            className="rounded border border-edge bg-panel px-1.5 py-1 font-mono text-[11px] text-ink"
          >
            {allowNone ? <option value="">none</option> : null}
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.code} · {driver.team}
              </option>
            ))}
          </select>
          <select
            value={lap ?? ""}
            aria-label={`${label} lap`}
            disabled={!driverId || timed.length === 0}
            onChange={(event) => onLap(event.target.value ? Number(event.target.value) : null)}
            className="rounded border border-edge bg-panel px-1.5 py-1 font-mono text-[11px] text-ink disabled:opacity-40"
          >
            <option value="">lap…</option>
            {timed.map((row) => (
              <option key={row.lap} value={row.lap}>
                L{row.lap} · {fmt.lapTime(row.lapTime)}
                {row.lapTime === fastest ? " ★" : ""}
                {row.isPitIn ? " (in)" : row.isPitOut ? " (out)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
