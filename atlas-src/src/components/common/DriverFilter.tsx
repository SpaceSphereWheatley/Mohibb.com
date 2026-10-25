"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { Popover } from "@/components/dashboard/Popover";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";

/** Checkbox list of the session's drivers, in the widget header. */
export function DriverFilter({
  selected,
  onToggle,
  onReset,
  isCustom,
}: {
  selected: string[];
  onToggle: (driverId: string) => void;
  onReset: () => void;
  isCustom: boolean;
}) {
  const drivers = useSessionStore(selectDrivers);
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="right"
      label="Choose drivers"
      disabled={drivers.length === 0}
      trigger={
        <>
          <Users size={12} />
          <span className="font-mono">{selected.length}</span>
        </>
      }
    >
      <div className="max-h-72 w-52 overflow-y-auto">
        <ul>
          {drivers.map((driver) => (
            <li key={driver.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-panel-2">
                <input
                  type="checkbox"
                  checked={selected.includes(driver.id)}
                  onChange={() => onToggle(driver.id)}
                  className="accent-[#38bdf8]"
                />
                <span
                  aria-hidden
                  className="h-3 w-1 rounded-sm"
                  style={{ background: driver.colour }}
                />
                <span className="font-mono text-ink">{driver.code}</span>
                <span className="truncate text-ink-3">{driver.team}</span>
              </label>
            </li>
          ))}
        </ul>
        {isCustom ? (
          <button
            type="button"
            onClick={onReset}
            className="w-full border-t border-edge-soft px-3 py-2 text-left text-[11px] text-ink-2 hover:bg-panel-2 hover:text-ink"
          >
            Back to the default set
          </button>
        ) : null}
      </div>
    </Popover>
  );
}
