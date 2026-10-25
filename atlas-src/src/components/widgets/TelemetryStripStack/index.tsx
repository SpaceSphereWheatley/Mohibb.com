"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomOut } from "lucide-react";
import { WidgetShell } from "@/components/dashboard/WidgetShell";
import { ResizeObserverWrapper } from "@/components/common/ResizeObserverWrapper";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import { useTelemetryCursorStore } from "@/store/useTelemetryCursorStore";
import { deltaTimeTrace } from "@/utils/deltaTime";
import * as fmt from "@/utils/format";
import { UPlotStrip, type StripSpec } from "./UPlotStrip";

const SYNC_KEY = "atlas-telemetry";

const REF_COLOUR = "#38bdf8";
const CMP_COLOUR = "#f87171";

/** Does this channel actually carry data, or is the source silent on it? */
function hasData(values: Float32Array | undefined): boolean {
  if (!values) return false;
  for (let i = 0; i < values.length; i += 37) {
    if (Number.isFinite(values[i]) && values[i] !== 0) return true;
  }
  return false;
}

export function TelemetryStripStack() {
  const referenceDriver = useSessionStore((state) => state.referenceDriver);
  const comparisonDriver = useSessionStore((state) => state.comparisonDriver);
  const referenceLap = useSessionStore((state) => state.referenceLap);
  const comparisonLap = useSessionStore((state) => state.comparisonLap);
  const ensureTelemetry = useSessionStore((state) => state.ensureTelemetry);
  const telemetry = useSessionStore((state) => state.telemetry);
  const pending = useSessionStore((state) => state.telemetryPending);
  const errors = useSessionStore((state) => state.telemetryError);
  const drivers = useSessionStore(selectDrivers);

  const setCursorDistance = useTelemetryCursorStore((state) => state.setDistance);

  const [xRange, setXRange] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (referenceDriver && referenceLap != null) void ensureTelemetry(referenceDriver, referenceLap);
  }, [ensureTelemetry, referenceDriver, referenceLap]);

  useEffect(() => {
    if (comparisonDriver && comparisonLap != null) {
      void ensureTelemetry(comparisonDriver, comparisonLap);
    }
  }, [ensureTelemetry, comparisonDriver, comparisonLap]);

  const reference =
    referenceDriver && referenceLap != null
      ? telemetry[`${referenceDriver}:${referenceLap}`] ?? null
      : null;
  const comparison =
    comparisonDriver && comparisonLap != null
      ? telemetry[`${comparisonDriver}:${comparisonLap}`] ?? null
      : null;

  const referenceKey = `${referenceDriver}:${referenceLap}`;
  const comparisonKey = `${comparisonDriver}:${comparisonLap}`;
  const loading = pending[referenceKey] || pending[comparisonKey];
  const error = errors[referenceKey] ?? errors[comparisonKey] ?? null;

  const delta = useMemo(
    () => (reference && comparison ? deltaTimeTrace(reference, comparison) : null),
    [reference, comparison],
  );

  const refCode = drivers.find((driver) => driver.id === referenceDriver)?.code ?? "REF";
  const cmpCode = drivers.find((driver) => driver.id === comparisonDriver)?.code ?? "CMP";

  // Readouts are written straight to the DOM. Routing a pointer-rate value
  // through React state would re-render the whole panel on every mouse move and
  // is the one thing that reliably breaks 60 fps scrubbing.
  const readouts = useRef<Record<string, HTMLSpanElement | null>>({});
  const cursorIndex = useRef<number | null>(null);
  const frame = useRef(0);
  const lastPublish = useRef(0);

  const write = useCallback(
    (key: string, value: string) => {
      const element = readouts.current[key];
      if (element && element.textContent !== value) element.textContent = value;
    },
    [],
  );

  const paint = useCallback(() => {
    frame.current = 0;
    const index = cursorIndex.current;
    if (!reference) return;

    if (index == null) {
      write("distance", "—");
      write("delta", "—");
      for (const channel of ["speed", "throttle", "brake", "gear", "rpm", "steering"]) {
        write(`ref-${channel}`, "—");
        write(`cmp-${channel}`, "—");
      }
      return;
    }

    const clamped = Math.max(0, Math.min(reference.distance.length - 1, index));
    write("distance", fmt.distance(reference.distance[clamped]));
    write("delta", delta ? fmt.signed(delta[clamped], 3) : "—");

    for (const channel of ["speed", "throttle", "brake", "gear", "rpm", "steering"] as const) {
      const refValue = reference.channels[channel]?.[clamped];
      write("ref-" + channel, Number.isFinite(refValue) ? refValue.toFixed(0) : "—");
      const cmpValue = comparison?.channels[channel]?.[clamped];
      write("cmp-" + channel, cmpValue != null && Number.isFinite(cmpValue) ? cmpValue.toFixed(0) : "—");
    }

    // Other widgets (the corner table) want the position too, but at a human
    // cadence rather than a pointer one.
    const now = performance.now();
    if (now - lastPublish.current > 90) {
      lastPublish.current = now;
      setCursorDistance(reference.distance[clamped]);
    }
  }, [reference, comparison, delta, setCursorDistance, write]);

  const handleCursor = useCallback(
    (index: number | null) => {
      cursorIndex.current = index;
      if (frame.current) return;
      frame.current = requestAnimationFrame(paint);
    },
    [paint],
  );

  useEffect(() => {
    paint();
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [paint]);

  const handleScale = useCallback((range: [number, number] | null) => {
    setXRange(range);
  }, []);

  const specs = useMemo<Omit<StripSpec, "height">[]>(() => {
    if (!reference) return [];
    const list: Omit<StripSpec, "height">[] = [];

    if (delta) {
      list.push({
        id: "delta",
        title: `Δt · ${cmpCode} to ${refCode}`,
        unit: "s",
        range: null,
        series: [{ label: "Δt", values: delta, colour: "#a78bfa", width: 1.5 }],
      });
    }

    list.push({
      id: "speed",
      title: "Speed",
      unit: "km/h",
      range: [0, 360],
      series: [
        { label: refCode, values: reference.channels.speed, colour: REF_COLOUR },
        ...(comparison
          ? [{ label: cmpCode, values: comparison.channels.speed, colour: CMP_COLOUR }]
          : []),
      ],
    });

    list.push({
      id: "pedals",
      title: "Throttle / Brake",
      unit: "%",
      range: [0, 105],
      series: [
        { label: `${refCode} thr`, values: reference.channels.throttle, colour: REF_COLOUR },
        {
          label: `${refCode} brk`,
          values: reference.channels.brake,
          colour: REF_COLOUR,
          dash: [3, 3],
        },
        ...(comparison
          ? [
              { label: `${cmpCode} thr`, values: comparison.channels.throttle, colour: CMP_COLOUR },
              {
                label: `${cmpCode} brk`,
                values: comparison.channels.brake,
                colour: CMP_COLOUR,
                dash: [3, 3],
              },
            ]
          : []),
      ],
    });

    list.push({
      id: "driveline",
      title: "Gear / RPM",
      unit: "",
      range: [0, 9],
      secondary: { key: "rpm", unit: "rpm", range: [0, 15000] },
      series: [
        { label: `${refCode} gear`, values: reference.channels.gear, colour: REF_COLOUR, step: true },
        {
          label: `${refCode} rpm`,
          values: reference.channels.rpm,
          colour: "#94a3b8",
          scale: "rpm",
          width: 1,
        },
        ...(comparison
          ? [
              {
                label: `${cmpCode} gear`,
                values: comparison.channels.gear,
                colour: CMP_COLOUR,
                step: true,
              },
            ]
          : []),
      ],
    });

    if (hasData(reference.channels.steering)) {
      list.push({
        id: "steering",
        title: "Steering",
        unit: "°",
        range: [-180, 180],
        series: [
          { label: refCode, values: reference.channels.steering, colour: REF_COLOUR },
          ...(comparison && hasData(comparison.channels.steering)
            ? [{ label: cmpCode, values: comparison.channels.steering, colour: CMP_COLOUR }]
            : []),
        ],
      });
    }

    return list;
  }, [reference, comparison, delta, refCode, cmpCode]);

  return (
    <WidgetShell
      id="telemetry"
      title="Telemetry strip stack"
      subtitle={
        reference
          ? `${refCode} L${reference.lap}${comparison ? ` vs ${cmpCode} L${comparison.lap}` : ""} · ${Math.round(reference.lapDistance)} m at ${reference.step} m steps`
          : "Distance-synchronised channels"
      }
      toolbar={
        xRange ? (
          <button
            type="button"
            onClick={() => setXRange(null)}
            className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink"
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            <ZoomOut size={13} />
          </button>
        ) : null
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-edge-soft px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
            <Readout label="Distance" refs={readouts} name="distance" wide />
            <Readout label="Δt" refs={readouts} name="delta" wide accent="#a78bfa" />
            <ChannelReadout label="Speed" refs={readouts} channel="speed" />
            <ChannelReadout label="Thr" refs={readouts} channel="throttle" />
            <ChannelReadout label="Brk" refs={readouts} channel="brake" />
            <ChannelReadout label="Gear" refs={readouts} channel="gear" />
            <ChannelReadout label="RPM" refs={readouts} channel="rpm" />
          </div>
        </div>

        <ResizeObserverWrapper
          className="min-h-0 flex-1 overflow-hidden"
          placeholder={<div className="h-full" />}
        >
          {({ width, height }) => {
            if (error) {
              return <p className="p-3 text-[11px] text-bad">{error}</p>;
            }
            if (!reference) {
              return (
                <p className="p-3 text-[11px] text-ink-3">
                  {loading ? "Fetching car data…" : "Pick a reference driver and lap."}
                </p>
              );
            }

            const available = Math.max(120, height - 4);
            const weights = specs.map((spec) =>
              spec.id === "speed" ? 1.35 : spec.id === "delta" ? 0.95 : 1,
            );
            const total = weights.reduce((sum, weight) => sum + weight, 0);

            return (
              <div className="h-full overflow-y-auto px-2 py-1">
                {specs.map((spec, index) => (
                  <div key={spec.id} className="relative">
                    {/* Sits clear of uPlot's 42px y-axis gutter. */}
                    <span className="pointer-events-none absolute left-[52px] top-0.5 z-10 font-mono text-[9px] uppercase tracking-wider text-ink-3">
                      {spec.title}
                      {spec.unit ? ` · ${spec.unit}` : ""}
                    </span>
                    <UPlotStrip
                      spec={{
                        ...spec,
                        height: Math.max(
                          70,
                          Math.floor((available * weights[index]) / total) - 2,
                        ),
                      }}
                      distance={reference.distance}
                      width={Math.max(120, width - 8)}
                      syncKey={SYNC_KEY}
                      onCursor={handleCursor}
                      onScale={handleScale}
                      xRange={xRange}
                    />
                  </div>
                ))}
              </div>
            );
          }}
        </ResizeObserverWrapper>
      </div>
    </WidgetShell>
  );
}

function Readout({
  label,
  refs,
  name,
  wide = false,
  accent,
}: {
  label: string;
  refs: React.RefObject<Record<string, HTMLSpanElement | null>>;
  name: string;
  wide?: boolean;
  accent?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <span
        ref={(element) => {
          refs.current[name] = element;
        }}
        className={`font-mono tabular-nums ${wide ? "min-w-[7ch]" : "min-w-[4ch]"} text-right`}
        style={accent ? { color: accent } : undefined}
      >
        —
      </span>
    </span>
  );
}

function ChannelReadout({
  label,
  refs,
  channel,
}: {
  label: string;
  refs: React.RefObject<Record<string, HTMLSpanElement | null>>;
  channel: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <span
        ref={(element) => {
          refs.current[`ref-${channel}`] = element;
        }}
        className="min-w-[4ch] text-right font-mono tabular-nums text-ref"
      >
        —
      </span>
      <span className="text-ink-3">/</span>
      <span
        ref={(element) => {
          refs.current[`cmp-${channel}`] = element;
        }}
        className="min-w-[4ch] text-right font-mono tabular-nums text-cmp"
      >
        —
      </span>
    </span>
  );
}
