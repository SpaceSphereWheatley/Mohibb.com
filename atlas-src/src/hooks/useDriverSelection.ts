"use client";

import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "@/store/useSessionStore";

/**
 * Which drivers a race-level widget is showing.
 *
 * Defaults to the classified front of the field plus whichever two cars the
 * toolbar is comparing — a race trace of twenty cars is a hairball, and the two
 * cars under the telemetry cursor are always the ones you want in it.
 */
export function useDriverSelection(defaultCount = 6) {
  const data = useSessionStore((state) => state.data);
  const referenceDriver = useSessionStore((state) => state.referenceDriver);
  const comparisonDriver = useSessionStore((state) => state.comparisonDriver);

  const ranking = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, { laps: number; time: number }>();
    for (const lap of data.laps) {
      if (lap.lapTime == null) continue;
      const entry = totals.get(lap.driverId) ?? { laps: 0, time: 0 };
      entry.laps++;
      entry.time += lap.lapTime;
      totals.set(lap.driverId, entry);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1].laps - a[1].laps || a[1].time - b[1].time)
      .map(([driverId]) => driverId);
  }, [data]);

  const defaults = useMemo(() => {
    const picked = new Set(ranking.slice(0, defaultCount));
    if (referenceDriver) picked.add(referenceDriver);
    if (comparisonDriver) picked.add(comparisonDriver);
    return [...picked];
  }, [ranking, defaultCount, referenceDriver, comparisonDriver]);

  const [selected, setSelected] = useState<string[]>(defaults);
  const [touched, setTouched] = useState(false);

  // A new session invalidates any manual selection — the driver ids may not
  // even exist in it.
  const sessionKey = data?.meta.key ?? null;
  useEffect(() => {
    setTouched(false);
  }, [sessionKey]);

  useEffect(() => {
    if (!touched) setSelected(defaults);
  }, [defaults, touched]);

  const toggle = (driverId: string) => {
    setTouched(true);
    setSelected((previous) =>
      previous.includes(driverId)
        ? previous.filter((id) => id !== driverId)
        : [...previous, driverId],
    );
  };

  return {
    selected,
    toggle,
    reset: () => setTouched(false),
    isCustom: touched,
    ranking,
  };
}
