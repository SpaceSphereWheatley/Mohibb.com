"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";

export interface StripSeries {
  label: string;
  values: Float32Array;
  colour: string;
  dash?: number[];
  width?: number;
  /** "step" draws a sample-and-hold trace, which is what a gear really does. */
  step?: boolean;
  scale?: string;
}

export interface StripSpec {
  id: string;
  title: string;
  unit: string;
  /** null auto-scales. */
  range: [number, number] | null;
  /** Optional right-hand scale, for a second quantity in the same strip. */
  secondary?: { key: string; unit: string; range: [number, number] | null };
  series: StripSeries[];
  height: number;
}

const AXIS_STROKE = "#5f6880";
const GRID_STROKE = "#1b2030";

/**
 * One synchronised strip.
 *
 * The plot is built imperatively and never re-created for a size change — uPlot
 * has a `setSize` for exactly that, and tearing down a canvas on every drag of a
 * resize handle is what makes charts feel slow.
 */
export function UPlotStrip({
  spec,
  distance,
  width,
  syncKey,
  onCursor,
  onScale,
  xRange,
}: {
  spec: StripSpec;
  distance: Float32Array;
  width: number;
  syncKey: string;
  onCursor: (index: number | null) => void;
  onScale: (range: [number, number] | null, source: string) => void;
  xRange: [number, number] | null;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const plot = useRef<uPlot | null>(null);
  const cursorCallback = useRef(onCursor);
  const scaleCallback = useRef(onScale);

  cursorCallback.current = onCursor;
  scaleCallback.current = onScale;

  // Rebuilt only when the *shape* of the strip changes: a different lap, a
  // different channel set, a different series count.
  const signature = `${spec.id}:${spec.series.length}:${distance.length}:${spec.series
    .map((series) => series.label)
    .join(",")}`;

  useEffect(() => {
    const element = host.current;
    if (!element || !distance.length) return;

    const data = [distance, ...spec.series.map((series) => series.values)] as unknown as uPlot.AlignedData;

    const options: uPlot.Options = {
      width: Math.max(80, width),
      height: spec.height,
      padding: [8, 10, 0, 0],
      legend: { show: false },
      cursor: {
        sync: { key: syncKey, setSeries: true },
        x: true,
        y: false,
        points: { show: false },
        drag: { x: true, y: false, setScale: true },
      },
      scales: {
        x: { time: false },
        y: spec.range
          ? { range: [spec.range[0], spec.range[1]] as [number, number] }
          : { auto: true },
        ...(spec.secondary
          ? {
              [spec.secondary.key]: spec.secondary.range
                ? { range: spec.secondary.range as [number, number] }
                : { auto: true },
            }
          : {}),
      },
      axes: [
        {
          stroke: AXIS_STROKE,
          grid: { stroke: GRID_STROKE, width: 1 },
          ticks: { stroke: GRID_STROKE },
          font: "10px var(--font-mono)",
          size: 22,
          values: (_u, splits) => splits.map((value) => `${Math.round(value)}`),
        },
        {
          scale: "y",
          stroke: AXIS_STROKE,
          grid: { stroke: GRID_STROKE, width: 1 },
          ticks: { show: false },
          font: "10px var(--font-mono)",
          size: 42,
          space: 26,
        },
        ...(spec.secondary
          ? [
              {
                scale: spec.secondary.key,
                side: 1 as const,
                stroke: AXIS_STROKE,
                grid: { show: false },
                ticks: { show: false },
                font: "10px var(--font-mono)",
                size: 42,
                space: 26,
              },
            ]
          : []),
      ],
      series: [
        {},
        ...spec.series.map((series) => ({
          label: series.label,
          stroke: series.colour,
          width: series.width ?? 1.25,
          dash: series.dash,
          scale: series.scale ?? "y",
          points: { show: false },
          paths: series.step
            ? uPlot.paths.stepped?.({ align: 1 })
            : undefined,
          spanGaps: false,
        })),
      ],
      hooks: {
        setCursor: [
          (instance) => {
            cursorCallback.current(instance.cursor.idx ?? null);
          },
        ],
        setScale: [
          (instance, key) => {
            if (key !== "x") return;
            const scale = instance.scales.x;
            if (scale.min == null || scale.max == null) return;
            scaleCallback.current([scale.min, scale.max], spec.id);
          },
        ],
      },
    };

    const instance = new uPlot(options, data, element);
    plot.current = instance;
    return () => {
      instance.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, syncKey, spec.height]);

  // Size and data updates go through the existing instance.
  useEffect(() => {
    plot.current?.setSize({ width: Math.max(80, width), height: spec.height });
  }, [width, spec.height]);

  useEffect(() => {
    const instance = plot.current;
    if (!instance || !distance.length) return;
    instance.setData(
      [distance, ...spec.series.map((series) => series.values)] as unknown as uPlot.AlignedData,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.series]);

  useEffect(() => {
    const instance = plot.current;
    if (!instance || !distance.length) return;
    const [min, max] = xRange ?? [distance[0], distance[distance.length - 1]];
    // The strip that originated the zoom is already at this range; re-applying
    // it would bounce the change back out through the setScale hook forever.
    if (instance.scales.x.min === min && instance.scales.x.max === max) return;
    instance.setScale("x", { min, max });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xRange]);

  return <div ref={host} className="w-full" />;
}
