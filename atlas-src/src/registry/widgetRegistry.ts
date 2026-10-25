import type { DashboardPreset, WidgetDefinition, WidgetId } from "@/types/dashboard";

/**
 * Widget metadata and the stock layouts.
 *
 * Kept free of React on purpose: the dashboard store needs the defaults, and
 * importing lazily-loaded components into a store would pull every chart
 * library into the first bundle. The components themselves are resolved in
 * `widgetComponents.tsx`.
 */

export const WIDGETS: Record<WidgetId, WidgetDefinition> = {
  telemetry: {
    id: "telemetry",
    title: "Telemetry strip stack",
    subtitle: "Distance-synchronised channels, reference vs comparison",
    minW: 4,
    minH: 10,
    defaultW: 8,
    defaultH: 16,
    kinds: ["practice", "qualifying", "race"],
  },
  corners: {
    id: "corners",
    title: "Corner decomposition",
    subtitle: "Brake point, apex minimum, throttle pick-up",
    minW: 3,
    minH: 8,
    defaultW: 4,
    defaultH: 16,
    kinds: ["practice", "qualifying", "race"],
  },
  raceTrace: {
    id: "raceTrace",
    title: "Cumulative race trace",
    subtitle: "Time to the leader across the full distance",
    minW: 4,
    minH: 8,
    defaultW: 12,
    defaultH: 11,
    kinds: ["race"],
  },
  degradation: {
    id: "degradation",
    title: "Stint degradation matrix",
    subtitle: "Fuel-corrected pace and wear rate per stint",
    minW: 4,
    minH: 8,
    defaultW: 6,
    defaultH: 12,
    kinds: ["race"],
  },
  pitAudit: {
    id: "pitAudit",
    title: "Strategy & pit execution audit",
    subtitle: "In-lap, stop, out-lap and net position",
    minW: 4,
    minH: 7,
    defaultW: 6,
    defaultH: 12,
    kinds: ["race"],
  },
  miniSectors: {
    id: "miniSectors",
    title: "Mini-sector heatmap",
    subtitle: "Where the lap time actually went, sector by sector",
    minW: 4,
    minH: 6,
    defaultW: 12,
    defaultH: 8,
    kinds: ["practice", "qualifying", "race"],
  },
};

export const WIDGET_ORDER: WidgetId[] = [
  "telemetry",
  "corners",
  "miniSectors",
  "raceTrace",
  "degradation",
  "pitAudit",
];

/** Builds lg/md/sm layouts from a single 12-column description. */
function spread(
  entries: { i: WidgetId; x: number; y: number; w: number; h: number }[],
): DashboardPreset["layouts"] {
  const lg = entries.map((entry) => ({
    ...entry,
    minW: WIDGETS[entry.i].minW,
    minH: WIDGETS[entry.i].minH,
  }));

  // Below 996px everything goes full width and stacks in reading order, which
  // is the only thing that stays legible for a chart on a narrow screen.
  let cursor = 0;
  const stacked = entries.map((entry) => {
    const row = { ...entry, x: 0, y: cursor, w: 12, h: entry.h, minW: 1, minH: WIDGETS[entry.i].minH };
    cursor += entry.h;
    return row;
  });

  return { lg, md: lg, sm: stacked, xs: stacked, xxs: stacked };
}

export const PRESETS: DashboardPreset[] = [
  {
    id: "telemetry-deep-dive",
    label: "Telemetry deep-dive",
    description: "One lap, two cars, every channel.",
    widgets: ["telemetry", "corners", "miniSectors"],
    layouts: spread([
      { i: "telemetry", x: 0, y: 0, w: 8, h: 18 },
      { i: "corners", x: 8, y: 0, w: 4, h: 18 },
      { i: "miniSectors", x: 0, y: 18, w: 12, h: 8 },
    ]),
  },
  {
    id: "race-strategy",
    label: "Race strategy & degradation",
    description: "How the race was won on tyres and stops.",
    widgets: ["raceTrace", "degradation", "pitAudit"],
    layouts: spread([
      { i: "raceTrace", x: 0, y: 0, w: 12, h: 11 },
      { i: "degradation", x: 0, y: 11, w: 6, h: 13 },
      { i: "pitAudit", x: 6, y: 11, w: 6, h: 13 },
    ]),
  },
  {
    id: "full-overview",
    label: "Full overview",
    description: "Everything at once, for a first pass over a session.",
    widgets: ["telemetry", "raceTrace", "degradation", "pitAudit"],
    layouts: spread([
      { i: "telemetry", x: 0, y: 0, w: 6, h: 14 },
      { i: "raceTrace", x: 6, y: 0, w: 6, h: 14 },
      { i: "degradation", x: 0, y: 14, w: 6, h: 12 },
      { i: "pitAudit", x: 6, y: 14, w: 6, h: 12 },
    ]),
  },
];

export const DEFAULT_PRESET = PRESETS[0];

export const BREAKPOINTS = { lg: 1400, md: 996, sm: 768, xs: 480, xxs: 0 };
export const COLUMNS = { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 };
export const ROW_HEIGHT = 26;
