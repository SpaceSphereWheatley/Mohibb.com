"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Fuel, Wind } from "lucide-react";
import { WidgetShell } from "@/components/dashboard/WidgetShell";
import { ResizeObserverWrapper } from "@/components/common/ResizeObserverWrapper";
import { DriverFilter } from "@/components/common/DriverFilter";
import { CHART_GRID_LINE, CHART_TEXT, EChart } from "@/components/common/EChart";
import { useDataWorker } from "@/hooks/useDataWorker";
import { useDriverSelection } from "@/hooks/useDriverSelection";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import type { DegradationFit, DegradationPoint } from "@/lib/computeTypes";
import { COMPOUND_COLOUR, type Compound } from "@/types/session";
import { DEFAULT_STINT_FILTER } from "@/utils/fuelCorrection";
import * as fmt from "@/utils/format";

const SELECTABLE: Compound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

const SYMBOL: Record<Compound, string> = {
  SOFT: "circle",
  MEDIUM: "diamond",
  HARD: "rect",
  INTERMEDIATE: "triangle",
  WET: "pin",
  UNKNOWN: "emptyCircle",
};

/**
 * Stint degradation.
 *
 * Raw lap times are corrected for fuel burn and then regressed against tyre age
 * within each stint. What comes out is the number strategists actually argue
 * about: seconds of lap time lost per lap of tyre life, and how far a set can
 * be pushed before it has given up a second.
 */
export function StintDegradationMatrix() {
  const data = useSessionStore((state) => state.data);
  const drivers = useSessionStore(selectDrivers);
  const { selected, toggle, reset, isCustom } = useDriverSelection(6);

  const [fuelEnabled, setFuelEnabled] = useState(true);
  const [dirtyAir, setDirtyAir] = useState(true);
  const [compounds, setCompounds] = useState<Compound[]>([...SELECTABLE, "UNKNOWN"]);
  const [showExcluded, setShowExcluded] = useState(false);

  const { run, busy } = useDataWorker();
  const [points, setPoints] = useState<DegradationPoint[]>([]);
  const [fits, setFits] = useState<DegradationFit[]>([]);

  useEffect(() => {
    if (!data || !selected.length) {
      setPoints([]);
      setFits([]);
      return;
    }
    let cancelled = false;
    void run({
      kind: "degradation",
      laps: data.laps,
      zones: data.zones,
      filter: { ...DEFAULT_STINT_FILTER, excludeDirtyAir: dirtyAir },
      fuel: { totalLaps: data.meta.totalLaps, beta: data.meta.fuelBeta },
      fuelCorrectionEnabled: fuelEnabled,
      driverIds: selected,
      compounds,
    }).then((result) => {
      if (cancelled || !result) return;
      setPoints(result.points);
      setFits(result.fits);
    });
    return () => {
      cancelled = true;
    };
  }, [run, data, selected, compounds, fuelEnabled, dirtyAir]);

  const byId = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);

  const option = useMemo<EChartsOption>(() => {
    const groups = new Map<string, DegradationPoint[]>();
    for (const point of points) {
      if (point.excluded && !showExcluded) continue;
      const key = `${point.driverId}:${point.stint}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(point);
      else groups.set(key, [point]);
    }

    const scatter = [...groups.entries()].map(([key, bucket]) => {
      const driver = byId.get(bucket[0].driverId);
      return {
        type: "scatter" as const,
        name: `${driver?.code ?? bucket[0].driverId} S${bucket[0].stint}`,
        symbol: SYMBOL[bucket[0].compound],
        symbolSize: 5,
        itemStyle: {
          color: driver?.colour ?? "#7c8496",
          borderColor: COMPOUND_COLOUR[bucket[0].compound],
          borderWidth: 0.8,
        },
        data: bucket.map((point) => ({
          value: [point.tyreAge, point.correctedTime],
          itemStyle: point.excluded ? { opacity: 0.22 } : undefined,
        })),
        id: `scatter:${key}`,
      };
    });

    const lines = fits.map((fit) => {
      const driver = byId.get(fit.driverId);
      const span = Math.max(1, fit.lapEnd - fit.lapStart);
      const x0 = 0;
      const x1 = span + 2;
      return {
        type: "line" as const,
        name: `${driver?.code ?? fit.driverId} S${fit.stint} fit`,
        showSymbol: false,
        silent: true,
        lineStyle: { width: 1.4, color: driver?.colour ?? "#7c8496", type: "solid" as const },
        data: [
          [x0, fit.intercept + fit.slope * x0],
          [x1, fit.intercept + fit.slope * x1],
        ],
        id: `fit:${fit.driverId}:${fit.stint}`,
      };
    });

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 52, right: 12, top: 12, bottom: 28 },
      tooltip: {
        trigger: "item",
        backgroundColor: "#12151e",
        borderColor: "#1f2433",
        textStyle: { ...CHART_TEXT, color: "#e6eaf2" },
        formatter: (params: unknown) => {
          const point = params as { seriesName: string; value: [number, number] };
          return `${point.seriesName}<br/>age ${point.value[0]} laps · ${fmt.lapTime(point.value[1])}`;
        },
      },
      legend: { show: false },
      xAxis: {
        type: "value",
        name: "tyre age (laps)",
        nameLocation: "middle",
        nameGap: 18,
        nameTextStyle: CHART_TEXT,
        min: 0,
        axisLine: { lineStyle: { color: CHART_GRID_LINE } },
        axisLabel: CHART_TEXT,
        splitLine: { lineStyle: { color: CHART_GRID_LINE } },
      },
      yAxis: {
        type: "value",
        scale: true,
        name: fuelEnabled ? "corrected lap (s)" : "lap time (s)",
        nameTextStyle: { ...CHART_TEXT, align: "left" },
        axisLine: { show: false },
        axisLabel: { ...CHART_TEXT, formatter: (value: number) => value.toFixed(1) },
        splitLine: { lineStyle: { color: CHART_GRID_LINE } },
      },
      series: [...scatter, ...lines],
    };
  }, [points, fits, byId, fuelEnabled, showExcluded]);

  const excludedCount = points.filter((point) => point.excluded).length;

  return (
    <WidgetShell
      id="degradation"
      title="Stint degradation matrix"
      subtitle={
        fits.length
          ? `${fits.length} stints fitted · β = ${data?.meta.fuelBeta.toFixed(3)} s/lap of fuel`
          : "Fuel-corrected pace and wear rate per stint"
      }
      toolbar={
        <DriverFilter selected={selected} onToggle={toggle} onReset={reset} isCustom={isCustom} />
      }
    >
      {!data ? (
        <p className="p-3 text-[11px] text-ink-3">Load a race to model its stints.</p>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge-soft px-2 py-1.5">
            <Toggle active={fuelEnabled} onClick={() => setFuelEnabled((value) => !value)}>
              <Fuel size={11} /> Fuel correction
            </Toggle>
            <Toggle active={dirtyAir} onClick={() => setDirtyAir((value) => !value)}>
              <Wind size={11} /> Exclude &lt; {DEFAULT_STINT_FILTER.dirtyAirThreshold} s
            </Toggle>
            <Toggle active={showExcluded} onClick={() => setShowExcluded((value) => !value)}>
              Show rejected ({excludedCount})
            </Toggle>
            <span className="mx-1 h-4 w-px bg-edge" />
            {SELECTABLE.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={compounds.includes(option)}
                onClick={() =>
                  setCompounds((previous) =>
                    previous.includes(option)
                      ? previous.filter((value) => value !== option)
                      : [...previous, option],
                  )
                }
                className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                  compounds.includes(option)
                    ? "border-transparent text-surface"
                    : "border-edge text-ink-3"
                }`}
                style={
                  compounds.includes(option)
                    ? { background: COMPOUND_COLOUR[option] }
                    : undefined
                }
              >
                {option[0]}
              </button>
            ))}
          </div>

          <ResizeObserverWrapper className="min-h-0 flex-[3]">
            {({ width, height }) =>
              points.length ? (
                <EChart option={option} width={width} height={height} />
              ) : (
                <p className="p-3 text-[11px] text-ink-3">
                  {busy ? "Fitting stints…" : "No laps survive the current filters."}
                </p>
              )
            }
          </ResizeObserverWrapper>

          <div className="min-h-[96px] flex-[2] overflow-auto border-t border-edge-soft">
            <table className="w-full border-collapse text-[10px]">
              <thead className="sticky top-0 bg-panel text-ink-3">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Driver</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Stint</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Laps</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Base</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Deg</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">1 s at</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">r²</th>
                </tr>
              </thead>
              <tbody>
                {fits.map((fit) => {
                  const driver = byId.get(fit.driverId);
                  return (
                    <tr key={`${fit.driverId}:${fit.stint}`} className="border-t border-edge-soft">
                      <th scope="row" className="px-2 py-1 text-left font-normal">
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="h-2.5 w-1 rounded-sm"
                            style={{ background: driver?.colour ?? "#7c8496" }}
                          />
                          <span className="font-mono text-ink">{driver?.code ?? fit.driverId}</span>
                        </span>
                      </th>
                      <td className="px-2 py-1">
                        <span
                          className="font-mono"
                          style={{ color: COMPOUND_COLOUR[fit.compound] }}
                        >
                          S{fit.stint} {fit.compound[0]}
                        </span>
                        <span className="ml-1 text-ink-3">
                          L{fit.lapStart}–{fit.lapEnd}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-ink-2">{fit.n}</td>
                      <td className="px-2 py-1 text-right font-mono text-ink-2">
                        {fmt.lapTime(fit.intercept)}
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-mono ${
                          fit.slope > 0.08 ? "text-bad" : fit.slope > 0.03 ? "text-warn" : "text-good"
                        }`}
                      >
                        {fit.slope >= 0 ? "+" : ""}
                        {fit.slope.toFixed(3)} s/lap
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-ink-2">
                        {fit.cliffAge == null ? "—" : `${fit.cliffAge.toFixed(0)} laps`}
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-mono ${
                          fit.r2 < 0.3 ? "text-ink-3" : "text-ink-2"
                        }`}
                      >
                        {fit.r2.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
                {!fits.length ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-center text-ink-3">
                      No stint has four clean laps under these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </WidgetShell>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
        active
          ? "border-ref/50 bg-ref/10 text-ref"
          : "border-edge text-ink-3 hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}
