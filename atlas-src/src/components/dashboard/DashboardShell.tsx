"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DashboardGrid } from "./DashboardGrid";
import { GlobalToolbar } from "./GlobalToolbar";
import { SessionLoader } from "./SessionLoader";
import { useSessionStore } from "@/store/useSessionStore";

export function DashboardShell() {
  const status = useSessionStore((state) => state.status);
  const error = useSessionStore((state) => state.error);
  const warnings = useSessionStore((state) => state.warnings);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Offer the picker on a cold start rather than showing an empty grid with no
  // hint about where data comes from.
  useEffect(() => {
    if (status === "empty") setPickerOpen(true);
  }, [status]);

  return (
    <main className="min-h-screen">
      <GlobalToolbar />

      {error ? (
        <p className="flex items-center gap-2 border-b border-bad/30 bg-bad/10 px-3 py-2 text-[11px] text-bad">
          <AlertTriangle size={13} /> {error}
        </p>
      ) : null}

      {warnings.length ? (
        <ul className="border-b border-warn/25 bg-warn/5 px-3 py-1.5 text-[10px] text-warn">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <DashboardGrid />

      {pickerOpen ? <SessionLoader onClose={() => setPickerOpen(false)} /> : null}
    </main>
  );
}
