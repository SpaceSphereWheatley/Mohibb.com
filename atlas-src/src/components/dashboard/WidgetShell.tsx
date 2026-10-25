"use client";

import type { ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useDashboardStore } from "@/store/useDashboardStore";
import type { WidgetId } from "@/types/dashboard";

/** Class the grid uses as its drag handle — only the header grabs. */
export const DRAG_HANDLE = "widget-drag-handle";

export function WidgetShell({
  id,
  title,
  subtitle,
  toolbar,
  children,
}: {
  id: WidgetId;
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const locked = useDashboardStore((state) => state.locked);
  const maximised = useDashboardStore((state) => state.maximised);
  const setMaximised = useDashboardStore((state) => state.setMaximised);
  const removeWidget = useDashboardStore((state) => state.removeWidget);
  const isMaximised = maximised === id;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded border border-edge bg-panel">
      <header
        className={`flex shrink-0 items-start gap-2 border-b border-edge-soft px-3 py-2 ${
          locked || isMaximised ? "" : `${DRAG_HANDLE} cursor-grab active:cursor-grabbing`
        }`}
      >
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[12px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? (
            <p className="truncate text-[10px] leading-tight text-ink-3">{subtitle}</p>
          ) : null}
        </div>

        {/* Controls sit outside the drag handle's pointer path so a click here
            never starts a drag. */}
        <div
          className="flex shrink-0 items-center gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {toolbar}
          <button
            type="button"
            onClick={() => setMaximised(isMaximised ? null : id)}
            className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink"
            aria-label={isMaximised ? `Restore ${title}` : `Expand ${title}`}
          >
            {isMaximised ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            onClick={() => removeWidget(id)}
            className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-bad"
            aria-label={`Remove ${title}`}
          >
            <X size={13} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
