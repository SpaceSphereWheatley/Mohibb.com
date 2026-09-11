"use client";

import { useEffect, useRef } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, CustomChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

// Only the pieces actually used — the full ECharts bundle is several times the
// size of everything else on the page put together.
echarts.use([
  LineChart,
  ScatterChart,
  BarChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export const CHART_TEXT = {
  color: "#9aa4bb",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
};

export const CHART_GRID_LINE = "#1b2030";

/**
 * ECharts with an explicit size.
 *
 * The library only listens for window resizes, which is useless inside a
 * draggable grid — the panel changes size constantly while the window does not.
 */
export function EChart({
  option,
  width,
  height,
  onReady,
}: {
  option: EChartsOption;
  width: number;
  height: number;
  onReady?: (instance: echarts.ECharts) => void;
}) {
  const chart = useRef<ReactECharts | null>(null);

  useEffect(() => {
    const instance = chart.current?.getEchartsInstance();
    if (!instance) return;
    instance.resize({ width, height });
  }, [width, height]);

  return (
    <ReactECharts
      ref={chart}
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      style={{ width, height }}
      opts={{ renderer: "canvas" }}
      onChartReady={onReady}
    />
  );
}
