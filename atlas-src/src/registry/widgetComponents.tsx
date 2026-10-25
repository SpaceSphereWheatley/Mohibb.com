"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { WidgetId } from "@/types/dashboard";

/**
 * Lazy component map.
 *
 * Every widget is loaded on demand and never server-rendered: uPlot and ECharts
 * both reach for `window` at construction time, and a preset that does not
 * include a chart should not pay to download it.
 */

const loading = () => (
  <div className="flex h-full items-center justify-center text-[11px] text-ink-3">
    Loading widget…
  </div>
);

export const WIDGET_COMPONENTS: Record<WidgetId, ComponentType> = {
  telemetry: dynamic(
    () => import("@/components/widgets/TelemetryStripStack").then((m) => m.TelemetryStripStack),
    { ssr: false, loading },
  ),
  corners: dynamic(
    () => import("@/components/widgets/CornerDecomposition").then((m) => m.CornerDecomposition),
    { ssr: false, loading },
  ),
  raceTrace: dynamic(
    () => import("@/components/widgets/CumulativeRaceTrace").then((m) => m.CumulativeRaceTrace),
    { ssr: false, loading },
  ),
  degradation: dynamic(
    () =>
      import("@/components/widgets/StintDegradationMatrix").then(
        (m) => m.StintDegradationMatrix,
      ),
    { ssr: false, loading },
  ),
  pitAudit: dynamic(
    () =>
      import("@/components/widgets/StrategyExecutionAudit").then(
        (m) => m.StrategyExecutionAudit,
      ),
    { ssr: false, loading },
  ),
  miniSectors: dynamic(
    () => import("@/components/widgets/MiniSectorHeatmap").then((m) => m.MiniSectorHeatmap),
    { ssr: false, loading },
  ),
};
