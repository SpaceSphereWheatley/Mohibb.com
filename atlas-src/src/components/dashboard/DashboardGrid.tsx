"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { BREAKPOINTS, COLUMNS, ROW_HEIGHT, WIDGETS } from "@/registry/widgetRegistry";
import { WIDGET_COMPONENTS } from "@/registry/widgetComponents";
import { useDashboardStore } from "@/store/useDashboardStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { Layouts } from "@/types/dashboard";
import { DRAG_HANDLE } from "./WidgetShell";

/**
 * The 12-column grid.
 *
 * Layout coordinates are owned by the dashboard store rather than by the grid,
 * so a reload restores every panel exactly where it was left. When a widget is
 * maximised the grid is replaced outright instead of resized — animating a
 * panel to full screen and back drops frames on every chart underneath it.
 */
export function DashboardGrid() {
  const widgets = useDashboardStore((state) => state.widgets);
  const layouts = useDashboardStore((state) => state.layouts);
  const locked = useDashboardStore((state) => state.locked);
  const maximised = useDashboardStore((state) => state.maximised);
  const setLayouts = useDashboardStore((state) => state.setLayouts);

  const kind = useSessionStore((state) => state.data?.meta.kind ?? null);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1280 });

  const visible = useMemo(() => widgets.filter((id) => WIDGETS[id] != null), [widgets]);

  // The grid calls back on every layout prop change, including the one caused
  // by storing its own last callback. Writing a fresh object each time would
  // loop forever, so the shape is compared before anything is committed.
  const lastCommitted = useRef<string | null>(null);
  const interacting = useRef(false);

  const handleLayoutChange = useCallback(
    (_layout: readonly LayoutItem[], all: ResponsiveLayouts<string>) => {
      const next: Layouts = {};
      for (const [breakpoint, rows] of Object.entries(all)) {
        if (rows) next[breakpoint] = rows.map((row) => ({ ...row }));
      }
      const signature = JSON.stringify(next);
      if (signature === lastCommitted.current) return;
      lastCommitted.current = signature;

      const byUser = interacting.current;
      interacting.current = false;
      setLayouts(next, byUser);
    },
    [setLayouts],
  );

  const markInteraction = useCallback(() => {
    interacting.current = true;
  }, []);

  if (maximised && visible.includes(maximised)) {
    const Component = WIDGET_COMPONENTS[maximised];
    return (
      <div className="h-[calc(100vh-58px)] min-h-[420px] p-2">
        <Component />
      </div>
    );
  }

  if (!visible.length) {
    return (
      <div className="flex h-64 items-center justify-center text-[12px] text-ink-3">
        No panels. Add one from the toolbar.
      </div>
    );
  }

  return (
    <div ref={containerRef} className={locked ? "grid-locked" : undefined}>
      <ResponsiveGridLayout
        width={width}
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLUMNS}
        rowHeight={ROW_HEIGHT}
        margin={[8, 8]}
        containerPadding={[8, 8]}
        compactor={verticalCompactor}
        dragConfig={{
          enabled: !locked,
          handle: `.${DRAG_HANDLE}`,
          bounded: false,
          threshold: 4,
        }}
        resizeConfig={{ enabled: !locked, handles: ["se"] }}
        onDragStart={markInteraction}
        onResizeStart={markInteraction}
        onLayoutChange={handleLayoutChange}
      >
        {visible.map((id) => {
          const Component = WIDGET_COMPONENTS[id];
          const definition = WIDGETS[id];
          // A race trace on a practice session is not an error, just empty —
          // dim it rather than hiding a panel the user deliberately added.
          const irrelevant =
            kind != null &&
            kind !== "unknown" &&
            !definition.kinds.includes(kind as "practice" | "qualifying" | "race");

          return (
            <div key={id} className={irrelevant ? "opacity-55" : undefined}>
              <Component />
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
