"use client";

import dynamic from "next/dynamic";

/**
 * The whole dashboard is client-only.
 *
 * Layout state rehydrates from localStorage and both chart libraries construct
 * against the DOM, so there is nothing meaningful to server-render — the export
 * ships a shell and the app takes over on hydration.
 */
const DashboardShell = dynamic(
  () => import("@/components/dashboard/DashboardShell").then((m) => m.DashboardShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-mono text-[11px] tracking-[0.2em] text-ink-3">ATLAS · LOADING</p>
      </div>
    ),
  },
);

export default function Page() {
  return <DashboardShell />;
}
