"use client";

import { useEffect, useMemo, useState } from "react";
import { WidgetShell } from "@/components/dashboard/WidgetShell";
import { useDataWorker } from "@/hooks/useDataWorker";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import { useTelemetryCursorStore } from "@/store/useTelemetryCursorStore";
import type { CornerComparison, LapTelemetry } from "@/types/telemetry";
import * as fmt from "@/utils/format";

/**
 * Corner-by-corner decomposition.
 *
 * Apexes are found on the reference lap and then re-measured on the comparison
 * lap over the same stretch of track, so every row answers one question: at
 * this corner, who braked later, who carried more speed through the middle, who
 * got back to full throttle first — and what did it cost in time.
 */
export function CornerDecomposition() {
  const referenceDriver = useSessionStore((state) => state.referenceDriver);
  const comparisonDriver = useSessionStore((state) => state.comparisonDriver);
  const referenceLap = useSessionStore((state) => state.referenceLap);
  const comparisonLap = useSessionStore((state) => state.comparisonLap);
  const telemetry = useSessionStore((state) => state.telemetry);
  const drivers = useSessionStore(selectDrivers);
  const cursor = useTelemetryCursorStore((state) => state.distance);

  const reference =
    referenceDriver && referenceLap != null
      ? telemetry[`${referenceDriver}:${referenceLap}`] ?? null
      : null;
  const comparison =
    comparisonDriver && comparisonLap != null
      ? telemetry[`${comparisonDriver}:${comparisonLap}`] ?? null
      : null;

  const { run, busy } = useDataWorker();
  const [corners, setCorners] = useState<CornerComparison[]>([]);

  useEffect(() => {
    if (!reference) {
      setCorners([]);
      return;
    }
    let cancelled = false;
    void run({ kind: "corners", reference, comparison }).then((result) => {
      if (!cancelled && result) setCorners(result.corners);
    });
    return () => {
      cancelled = true;
    };
  }, [run, reference, comparison]);

  const refCode = drivers.find((driver) => driver.id === referenceDriver)?.code ?? "REF";
  const cmpCode = drivers.find((driver) => driver.id === comparisonDriver)?.code ?? "CMP";

  const activeCorner = useMemo(() => {
    if (cursor == null) return null;
    return corners.find((corner) => cursor >= corner.reference.entry && cursor <= corner.reference.exit)
      ?.index ?? null;
  }, [cursor, corners]);

  const worst = useMemo(() => {
    let value: CornerComparison | null = null;
    for (const corner of corners) {
      if (corner.timeDelta == null) continue;
      if (!value || corner.timeDelta > (value.timeDelta as number)) value = corner;
    }
    return value;
  }, [corners]);

  return (
    <WidgetShell
      id="corners"
      title="Corner decomposition"
      subtitle={
        corners.length
          ? `${corners.length} corners detected · ${refCode}${comparison ? ` vs ${cmpCode}` : ""}`
          : "Brake point, apex minimum, throttle pick-up"
      }
    >
      {!reference ? (
        <p className="p-3 text-[11px] text-ink-3">Load a lap to decompose it.</p>
      ) : busy && !corners.length ? (
        <p className="p-3 text-[11px] text-ink-3">Finding apexes…</p>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {worst && worst.timeDelta != null ? (
            <p className="shrink-0 border-b border-edge-soft px-3 py-1.5 text-[10px] text-ink-2">
              Biggest loss for {cmpCode}: <span className="text-ink">T{worst.index}</span>,{" "}
              <span className="font-mono text-bad">{fmt.signed(worst.timeDelta, 3)} s</span>
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[10px]">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="text-ink-3">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Turn
                  </th>
                  <th scope="col" className="px-1 py-1.5 text-left font-medium">
                    Trace
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Brake
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    V<sub>min</sub>
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Throttle
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Δt
                  </th>
                </tr>
              </thead>
              <tbody>
                {corners.map((corner) => (
                  <tr
                    key={corner.index}
                    className={`border-t border-edge-soft ${
                      activeCorner === corner.index ? "bg-ref/10" : ""
                    }`}
                  >
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      <span className="font-mono text-ink">T{corner.index}</span>
                      <span className="block text-[9px] text-ink-3">
                        {fmt.distance(corner.apexDistance)}
                      </span>
                    </th>
                    <td className="px-1 py-1">
                      <CornerTrace corner={corner} reference={reference} comparison={comparison} />
                    </td>
                    <Cell
                      value={fmt.metres(corner.reference.brakeDistance)}
                      delta={corner.brakeDelta}
                      unit="m"
                      /* Braking later is a positive distance and a good thing. */
                      goodWhenPositive
                    />
                    <Cell
                      value={`${corner.reference.vMin.toFixed(0)}`}
                      delta={corner.vMinDelta}
                      unit="km/h"
                      decimals={1}
                      goodWhenPositive
                    />
                    <Cell
                      value={fmt.metres(corner.reference.throttleDistance)}
                      delta={corner.throttleDelta}
                      unit="m"
                    />
                    <td className="px-2 py-1 text-right">
                      <span
                        className={`font-mono tabular-nums ${
                          corner.timeDelta == null
                            ? "text-ink-3"
                            : corner.timeDelta > 0.005
                              ? "text-bad"
                              : corner.timeDelta < -0.005
                                ? "text-good"
                                : "text-ink-2"
                        }`}
                      >
                        {corner.timeDelta == null ? "—" : fmt.signed(corner.timeDelta, 3)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="shrink-0 border-t border-edge-soft px-3 py-1.5 text-[9px] leading-snug text-ink-3">
            Deltas are {comparison ? cmpCode : "comparison"} minus {refCode}. Brake and throttle
            distances are measured from the start line, so a larger brake figure means a later
            brake point.
          </p>
        </div>
      )}
    </WidgetShell>
  );
}

function Cell({
  value,
  delta,
  unit,
  decimals = 0,
  goodWhenPositive = false,
}: {
  value: string;
  delta: number | null;
  unit: string;
  decimals?: number;
  goodWhenPositive?: boolean;
}) {
  const tone =
    delta == null || Math.abs(delta) < (decimals ? 0.05 : 0.5)
      ? "text-ink-3"
      : delta > 0 === goodWhenPositive
        ? "text-good"
        : "text-bad";

  return (
    <td className="px-2 py-1 text-right">
      <span className="block font-mono tabular-nums text-ink">{value}</span>
      <span className={`block font-mono text-[9px] tabular-nums ${tone}`}>
        {delta == null ? "—" : `${fmt.signed(delta, decimals)} ${unit}`}
      </span>
    </td>
  );
}

/** A 64×20 speed profile through the corner, drawn straight from the trace. */
function CornerTrace({
  corner,
  reference,
  comparison,
}: {
  corner: CornerComparison;
  reference: LapTelemetry;
  comparison: LapTelemetry | null;
}) {
  const width = 64;
  const height = 20;
  const from = Math.round(corner.reference.entry / reference.step);
  const to = Math.round(corner.reference.exit / reference.step);
  if (to <= from) return null;

  const path = (telemetry: LapTelemetry) => {
    const speeds = telemetry.channels.speed;
    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i <= to && i < speeds.length; i++) {
      if (speeds[i] < min) min = speeds[i];
      if (speeds[i] > max) max = speeds[i];
    }
    if (!Number.isFinite(min) || max === min) return "";

    const points: string[] = [];
    const stride = Math.max(1, Math.floor((to - from) / width));
    for (let i = from; i <= to && i < speeds.length; i += stride) {
      const x = ((i - from) / (to - from)) * width;
      const y = height - ((speeds[i] - min) / (max - min)) * (height - 2) - 1;
      points.push(`${points.length ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return points.join(" ");
  };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
      <path d={path(reference)} fill="none" stroke="#38bdf8" strokeWidth="1" />
      {comparison ? (
        <path d={path(comparison)} fill="none" stroke="#f87171" strokeWidth="1" />
      ) : null}
    </svg>
  );
}
