"use client";

import { useMemo, useState } from "react";
import { WidgetShell } from "@/components/dashboard/WidgetShell";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import { useTelemetryCursorStore } from "@/store/useTelemetryCursorStore";
import { deltaTimeTrace } from "@/utils/deltaTime";
import * as fmt from "@/utils/format";

const BUCKET_CHOICES = [100, 200, 400];

/**
 * Mini-sector heatmap.
 *
 * The delta trace already says where time went; this chops it into equal
 * lengths of track so the answer reads at a glance rather than by eye-balling a
 * gradient. Each cell is the time the comparison car gained or lost over that
 * stretch, coloured on a diverging scale.
 */
export function MiniSectorHeatmap() {
  const referenceDriver = useSessionStore((state) => state.referenceDriver);
  const comparisonDriver = useSessionStore((state) => state.comparisonDriver);
  const referenceLap = useSessionStore((state) => state.referenceLap);
  const comparisonLap = useSessionStore((state) => state.comparisonLap);
  const telemetry = useSessionStore((state) => state.telemetry);
  const drivers = useSessionStore(selectDrivers);
  const cursor = useTelemetryCursorStore((state) => state.distance);

  const [bucket, setBucket] = useState(200);

  const reference =
    referenceDriver && referenceLap != null
      ? telemetry[`${referenceDriver}:${referenceLap}`] ?? null
      : null;
  const comparison =
    comparisonDriver && comparisonLap != null
      ? telemetry[`${comparisonDriver}:${comparisonLap}`] ?? null
      : null;

  const sectors = useMemo(() => {
    if (!reference || !comparison) return [];
    const delta = deltaTimeTrace(reference, comparison);
    const perBucket = Math.max(2, Math.round(bucket / reference.step));
    const out: { from: number; to: number; delta: number }[] = [];

    for (let start = 0; start < delta.length - 1; start += perBucket) {
      const end = Math.min(delta.length - 1, start + perBucket);
      if (end <= start) break;
      out.push({
        from: start * reference.step,
        to: end * reference.step,
        delta: delta[end] - delta[start],
      });
    }
    return out;
  }, [reference, comparison, bucket]);

  const scale = useMemo(() => {
    let max = 0;
    for (const sector of sectors) max = Math.max(max, Math.abs(sector.delta));
    return max || 1;
  }, [sectors]);

  const refCode = drivers.find((driver) => driver.id === referenceDriver)?.code ?? "REF";
  const cmpCode = drivers.find((driver) => driver.id === comparisonDriver)?.code ?? "CMP";

  const total = sectors.reduce((sum, sector) => sum + sector.delta, 0);

  return (
    <WidgetShell
      id="miniSectors"
      title="Mini-sector heatmap"
      subtitle={
        sectors.length
          ? `${sectors.length} sectors of ${bucket} m · ${cmpCode} against ${refCode}`
          : "Where the lap time actually went"
      }
      toolbar={
        <div className="flex items-center gap-0.5">
          {BUCKET_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={bucket === choice}
              onClick={() => setBucket(choice)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                bucket === choice ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
      }
    >
      {!reference || !comparison ? (
        <p className="p-3 text-[11px] text-ink-3">
          Pick a reference and a comparison lap to split the delta up.
        </p>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-2 p-3">
          <div className="flex flex-wrap gap-[3px]">
            {sectors.map((sector) => {
              const intensity = Math.abs(sector.delta) / scale;
              const losing = sector.delta > 0;
              const active =
                cursor != null && cursor >= sector.from && cursor < sector.to;
              return (
                <div
                  key={sector.from}
                  title={`${fmt.distance(sector.from)} – ${fmt.distance(sector.to)} · ${fmt.signed(sector.delta, 3)} s`}
                  className={`h-9 min-w-[18px] flex-1 rounded-[2px] ${
                    active ? "ring-1 ring-ink" : ""
                  }`}
                  style={{
                    background: losing
                      ? `rgba(248, 113, 113, ${0.12 + intensity * 0.78})`
                      : `rgba(56, 189, 248, ${0.12 + intensity * 0.78})`,
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[10px] text-ink-3">
            <span>start line</span>
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="h-2 w-4 rounded-[2px]"
                  style={{ background: "rgba(56, 189, 248, 0.75)" }}
                />
                {cmpCode} faster
              </span>
              <span className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="h-2 w-4 rounded-[2px]"
                  style={{ background: "rgba(248, 113, 113, 0.75)" }}
                />
                {cmpCode} slower
              </span>
            </span>
            <span>{fmt.distance(reference.lapDistance)}</span>
          </div>

          <p className="mt-auto text-[11px] text-ink-2">
            Lap total:{" "}
            <span
              className={`font-mono tabular-nums ${total > 0 ? "text-bad" : "text-good"}`}
            >
              {fmt.signed(total, 3)} s
            </span>
            <span className="text-ink-3">
              {" "}
              · worst sector {fmt.signed(Math.max(...sectors.map((s) => s.delta)), 3)} s
            </span>
          </p>
        </div>
      )}
    </WidgetShell>
  );
}
