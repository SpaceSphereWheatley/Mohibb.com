"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A small dismissible menu.
 *
 * Hand-rolled rather than pulled from a component library: the dashboard needs
 * exactly one popover behaviour (click outside or Escape to close, focus
 * trapped nowhere), and a headless UI dependency would be several times the
 * size of this file for no extra behaviour.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  children,
  align = "left",
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-1.5 rounded border border-edge bg-panel px-2 py-1.5 text-[11px] text-ink-2 hover:border-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-50 mt-1 overflow-hidden rounded border border-edge bg-panel shadow-xl shadow-black/50 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
