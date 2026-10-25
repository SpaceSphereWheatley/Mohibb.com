"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { LayoutItem, Layouts, WidgetId } from "@/types/dashboard";
import { DEFAULT_PRESET, PRESETS, WIDGETS } from "@/registry/widgetRegistry";

/**
 * Grid layout, active widgets and the lock. Persisted wholesale: reopening the
 * dashboard should put every panel back exactly where it was left, which is the
 * single thing people notice when it is missing.
 */
interface DashboardState {
  widgets: WidgetId[];
  layouts: Layouts;
  /** Locked grids ignore drag and resize, so a scrub cannot move a panel. */
  locked: boolean;
  activePreset: string | null;
  /** Widget currently expanded to fill the viewport, if any. */
  maximised: WidgetId | null;

  /**
   * `userInitiated` separates a drag or resize from the grid simply echoing a
   * layout back after compaction — only the former means the layout has stopped
   * being the preset it came from.
   */
  setLayouts: (layouts: Layouts, userInitiated?: boolean) => void;
  addWidget: (id: WidgetId) => void;
  removeWidget: (id: WidgetId) => void;
  toggleLocked: () => void;
  setMaximised: (id: WidgetId | null) => void;
  applyPreset: (presetId: string) => void;
  resetLayout: () => void;
}

/** Appends a widget at the bottom of every breakpoint's layout. */
function appendToLayouts(layouts: Layouts, id: WidgetId): Layouts {
  const definition = WIDGETS[id];
  const next: Layouts = { ...layouts };
  for (const breakpoint of Object.keys(next)) {
    const rows: LayoutItem[] = next[breakpoint] ?? [];
    if (rows.some((row) => row.i === id)) continue;
    const bottom = rows.reduce((max: number, row: LayoutItem) => Math.max(max, row.y + row.h), 0);
    const narrow = breakpoint === "sm" || breakpoint === "xs" || breakpoint === "xxs";
    next[breakpoint] = [
      ...rows,
      {
        i: id,
        x: 0,
        y: bottom,
        w: narrow ? 12 : definition.defaultW,
        h: definition.defaultH,
        minW: narrow ? 1 : definition.minW,
        minH: definition.minH,
      },
    ];
  }
  return next;
}

function stripFromLayouts(layouts: Layouts, id: WidgetId): Layouts {
  const next: Layouts = {};
  for (const [breakpoint, rows] of Object.entries(layouts) as [string, LayoutItem[]][]) {
    next[breakpoint] = (rows ?? []).filter((row) => row.i !== id);
  }
  return next;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      widgets: [...DEFAULT_PRESET.widgets],
      layouts: DEFAULT_PRESET.layouts,
      locked: false,
      activePreset: DEFAULT_PRESET.id,
      maximised: null,

      setLayouts(layouts, userInitiated = false) {
        set(userInitiated ? { layouts, activePreset: null } : { layouts });
      },

      addWidget(id) {
        const state = get();
        if (state.widgets.includes(id)) return;
        set({
          widgets: [...state.widgets, id],
          layouts: appendToLayouts(state.layouts, id),
          activePreset: null,
        });
      },

      removeWidget(id) {
        const state = get();
        set({
          widgets: state.widgets.filter((widget) => widget !== id),
          layouts: stripFromLayouts(state.layouts, id),
          activePreset: null,
          maximised: state.maximised === id ? null : state.maximised,
        });
      },

      toggleLocked() {
        set((state) => ({ locked: !state.locked }));
      },

      setMaximised(id) {
        set({ maximised: id });
      },

      applyPreset(presetId) {
        const preset = PRESETS.find((candidate) => candidate.id === presetId);
        if (!preset) return;
        set({
          widgets: [...preset.widgets],
          layouts: preset.layouts,
          activePreset: preset.id,
          maximised: null,
        });
      },

      resetLayout() {
        set({
          widgets: [...DEFAULT_PRESET.widgets],
          layouts: DEFAULT_PRESET.layouts,
          activePreset: DEFAULT_PRESET.id,
          maximised: null,
          locked: false,
        });
      },
    }),
    {
      name: "atlas-dashboard-v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        widgets: state.widgets,
        layouts: state.layouts,
        locked: state.locked,
        activePreset: state.activePreset,
      }),
    },
  ),
);
