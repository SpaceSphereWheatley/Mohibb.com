import type { LayoutItem } from "react-grid-layout";

export type WidgetId =
  | "telemetry"
  | "raceTrace"
  | "degradation"
  | "corners"
  | "pitAudit"
  | "miniSectors";

export interface WidgetDefinition {
  id: WidgetId;
  title: string;
  subtitle: string;
  /** Grid constraints, in 12-column units / ROW_HEIGHT rows. */
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
  /** Session kinds this widget is meaningful for. */
  kinds: ("practice" | "qualifying" | "race")[];
}

/**
 * Layouts keyed by breakpoint.
 *
 * react-grid-layout v2 types a layout as `readonly LayoutItem[]`; the store owns
 * these and needs to build new ones, so the mutable form is kept here and
 * widens on the way into the grid.
 */
export type Layouts = Record<string, LayoutItem[]>;

export interface DashboardPreset {
  id: string;
  label: string;
  description: string;
  widgets: WidgetId[];
  layouts: Layouts;
}

export type { LayoutItem };
