"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { WidgetShell } from "@/components/dashboard/WidgetShell";
import { ResizeObserverWrapper } from "@/components/common/ResizeObserverWrapper";
import { DriverFilter } from "@/components/common/DriverFilter";
import { CHART_GRID_LINE, CHART_TEXT, EChart } from "@/components/common/EChart";
import { useDataWorker } from "@/hooks/useDataWorker";
import { useDriverSelection } from "@/hooks/useDriverSelection";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import type { RaceTraceSeries } from "@/lib/computeTypes";

const ZONE_FILL: Record<string, string> = {
  SC: "rgba(251, 191, 36, 0.10)",
  VSC: "rgba(251, 191, 36, 0.06)",
  RED: "rgba(239, 68, 68, 0.12)",
};

/**
 * Cumulative race trace.
 *
 * The y axis is time lost to the race winner, accumulated lap by lap, which
 * turns the whole grand prix into one readable shape: a pit stop is a cliff, a
 * safety car is a plateau where everyone's slope goes flat together, and a
 * degrading tyre is a steady climb.
 */
export function CumulativeRaceTrace() {
  const data = useSessionStore((state) => state.data);
  const drivers = useSessionStore(selectDrivers);
  const { selected, toggle, reset, isCustom } = useDriverSelection(6);
  const { run, busy } = useDataWorker();
  const [series, setSeries] = useState<RaceTraceSeries[]>([]);
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (!data || !selected.length) {
      setSeries([]);
      return;
    }
    let cancelled = false;
    void run({ kind: "raceTrace", laps: data.laps, driverIds: selected }).then((result) => {
      if (cancelled || !result) return;
      setSeries(result.series);
      setBaseline(result.baselineDriverId);
    });
    return () => {
      cancelled = true;
    };
  }, [run, data, selected]);

  const option = useMemo<EChartsOption>(() => {
    const byId = new Map(drivers.map((driver) => [driver.id, driver]));

    const markAreas = (data?.zones ?? []).map((zone) => [
      { xAxis: zone.lapStart, itemStyle: { color: ZONE_FILL[zone.kind] ?? ZONE_FILL.SC } },
      { xAxis: zone.lapEnd },
    ]);

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 44, right: 16, top: 14, bottom: 40, containLabel: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#12151e",
        borderColor: "#1f2433",
        textStyle: { ...CHART_TEXT, color: "#e6eaf2" },
        axisPointer: { type: "line", lineStyle: { color: "#3a4256" } },
        valueFormatter: (value) =>
          typeof value === "number" ? `${value >= 0 ? "+" : ""}${value.toFixed(1)} s` : "—",
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: CHART_TEXT,
        itemWidth: 10,
        itemHeight: 2,
        icon: "rect",
      },
      xAxis: {
        type: "value",
        min: 1,
        max: data?.meta.totalLaps || undefined,
        name: "lap",
        nameLocation: "end",
        nameTextStyle: { ...CHART_TEXT, padding: [0, 0, 0, 4] },
        axisLine: { lineStyle: { color: CHART_GRID_LINE } },
        axisLabel: CHART_TEXT,
        splitLine: { lineStyle: { color: CHART_GRID_LINE } },
      },
      yAxis: {
        type: "value",
        inverse: true,
        name: "s to leader",
        nameLocation: "start",
        nameGap: 12,
        nameTextStyle: { ...CHART_TEXT, align: "left" },
        axisLine: { show: false },
        axisLabel: { ...CHART_TEXT, formatter: (value: number) => `${value}` },
        splitLine: { lineStyle: { color: CHART_GRID_LINE } },
      },
      series: series.map((entry, index) => {
        const driver = byId.get(entry.driverId);
        const pitSet = new Set(entry.pitLaps);
        return {
          type: "line" as const,
          name: driver?.code ?? entry.driverId,
          showSymbol: true,
          symbolSize: (value: unknown) =>
            Array.isArray(value) && pitSet.has(value[0] as number) ? 7 : 0,
          symbol: "diamond",
          lineStyle: { width: entry.driverId === baseline ? 2 : 1.3 },
          itemStyle: { color: driver?.colour ?? "#7c8496" },
          emphasis: { focus: "series" as const },
          data: entry.points,
          markArea:
            index === 0 && markAreas.length
              ? { silent: true, data: markAreas as never }
              : undefined,
        };
      }),
    };
  }, [series, drivers, data, baseline]);

  const leaderCode = drivers.find((driver) => driver.id === baseline)?.code ?? null;

  return (
    <WidgetShell
      id="raceTrace"
      title="Cumulative race trace"
      subtitle={
        leaderCode
          ? `Δ to ${leaderCode} · diamonds mark pit entries · shaded bands are SC / VSC`
          : "Time to the leader across the full distance"
      }
      toolbar={
        <DriverFilter selected={selected} onToggle={toggle} onReset={reset} isCustom={isCustom} />
      }
    >
      {!data ? (
        <p className="p-3 text-[11px] text-ink-3">Load a race to draw its trace.</p>
      ) : data.meta.kind !== "race" ? (
        <p className="p-3 text-[11px] text-ink-3">
          This is a {data.meta.kind} session — a cumulative trace only means something over a race
          distance.
        </p>
      ) : !series.length ? (
        <p className="p-3 text-[11px] text-ink-3">{busy ? "Building the trace…" : "No lap data."}</p>
      ) : (
        <ResizeObserverWrapper className="h-full">
          {({ width, height }) => <EChart option={option} width={width} height={height} />}
        </ResizeObserverWrapper>
      )}
    </WidgetShell>
  );
}
