"use client";

import { LayoutGrid, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { PRESETS, WIDGETS, WIDGET_ORDER } from "@/registry/widgetRegistry";
import { useDashboardStore } from "@/store/useDashboardStore";
import { Popover } from "./Popover";

/** Preset switcher plus the add-panel menu. */
export function PresetManager() {
  const widgets = useDashboardStore((state) => state.widgets);
  const activePreset = useDashboardStore((state) => state.activePreset);
  const applyPreset = useDashboardStore((state) => state.applyPreset);
  const addWidget = useDashboardStore((state) => state.addWidget);
  const resetLayout = useDashboardStore((state) => state.resetLayout);
  const [open, setOpen] = useState<"presets" | "panels" | null>(null);

  const missing = WIDGET_ORDER.filter((id) => !widgets.includes(id));

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open === "presets"}
        onOpenChange={(next) => setOpen(next ? "presets" : null)}
        label="Layout presets"
        trigger={
          <>
            <LayoutGrid size={13} />
            <span className="hidden sm:inline">
              {PRESETS.find((preset) => preset.id === activePreset)?.label ?? "Custom layout"}
            </span>
          </>
        }
      >
        <ul className="w-64">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => {
                  applyPreset(preset.id);
                  setOpen(null);
                }}
                className={`block w-full px-3 py-2 text-left hover:bg-panel-2 ${
                  activePreset === preset.id ? "text-ref" : "text-ink"
                }`}
              >
                <span className="block text-[12px]">{preset.label}</span>
                <span className="block text-[10px] text-ink-3">{preset.description}</span>
              </button>
            </li>
          ))}
          <li className="border-t border-edge-soft">
            <button
              type="button"
              onClick={() => {
                resetLayout();
                setOpen(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink-2 hover:bg-panel-2 hover:text-ink"
            >
              <RotateCcw size={12} /> Reset to default
            </button>
          </li>
        </ul>
      </Popover>

      <Popover
        open={open === "panels"}
        onOpenChange={(next) => setOpen(next ? "panels" : null)}
        label="Add panel"
        disabled={missing.length === 0}
        trigger={
          <>
            <Plus size={13} />
            <span className="hidden sm:inline">Panel</span>
          </>
        }
      >
        <ul className="w-64">
          {missing.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  addWidget(id);
                  setOpen(null);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-panel-2"
              >
                <span className="block text-[12px] text-ink">{WIDGETS[id].title}</span>
                <span className="block text-[10px] text-ink-3">{WIDGETS[id].subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}
