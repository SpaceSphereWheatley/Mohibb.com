"use client";

import { useMemo } from "react";
import { WidgetShell } from "@/components/dashboard/WidgetShell";
import { DriverFilter } from "@/components/common/DriverFilter";
import { useDriverSelection } from "@/hooks/useDriverSelection";
import { useSessionStore, selectDrivers } from "@/store/useSessionStore";
import { COMPOUND_COLOUR, type Compound, type LapRecord } from "@/types/session";
import * as fmt from "@/utils/format";

interface StopAudit {
  driverId: string;
  lap: number;
  from: Compound;
  to: Compound;
  inLapDelta: number | null;
  stationary: number | null;
  pitLane: number | null;
  outLapDelta: number | null;
  positionDelta: number | null;
}

/** Median of a driver's clean laps — the yardstick every delta below is measured against. */
function clearAirBaseline(laps: LapRecord[]): number | null {
  const times = laps
    .filter((lap) => lap.lapTime != null && !lap.isPitIn && !lap.isPitOut && lap.lap > 1)
    .map((lap) => lap.lapTime as number)
    .sort((a, b) => a - b);
  if (times.length < 3) return null;
  return times[Math.floor(times.length / 2)];
}

/**
 * Pit execution audit.
 *
 * A stop is four separate pieces of work — the in-lap, the stationary time, the
 * rest of the pit lane, and the out-lap — and a team can lose a place in any one
 * of them while the other three look fine. Splitting them out is the only way to
 * tell a slow crew from a slow driver.
 */
export function StrategyExecutionAudit() {
  const data = useSessionStore((state) => state.data);
  const drivers = useSessionStore(selectDrivers);
  const { selected, toggle, reset, isCustom } = useDriverSelection(8);

  const audits = useMemo<StopAudit[]>(() => {
    if (!data) return [];
    const chosen = new Set(selected);
    const rows: StopAudit[] = [];

    for (const driverId of chosen) {
      const laps = data.laps
        .filter((lap) => lap.driverId === driverId)
        .sort((a, b) => a.lap - b.lap);
      const baseline = clearAirBaseline(laps);
      const lapAt = new Map(laps.map((lap) => [lap.lap, lap]));

      for (const pit of data.pits.filter((entry) => entry.driverId === driverId)) {
        const inLap = lapAt.get(pit.lap);
        const outLap = lapAt.get(pit.lap + 1);
        const beforeLap = lapAt.get(pit.lap - 1);
        const afterLap = lapAt.get(pit.lap + 2);

        const stintBefore = data.stints.find(
          (stint) => stint.driverId === driverId && stint.lapEnd === pit.lap,
        );
        const stintAfter = data.stints.find(
          (stint) => stint.driverId === driverId && stint.lapStart === pit.lap + 1,
        );

        rows.push({
          driverId,
          lap: pit.lap,
          from: stintBefore?.compound ?? inLap?.compound ?? "UNKNOWN",
          to: stintAfter?.compound ?? outLap?.compound ?? "UNKNOWN",
          inLapDelta:
            baseline != null && inLap?.lapTime != null ? inLap.lapTime - baseline : null,
          stationary: pit.stationary,
          pitLane: pit.pitLaneDuration,
          outLapDelta:
            baseline != null && outLap?.lapTime != null ? outLap.lapTime - baseline : null,
          positionDelta:
            beforeLap?.position != null && afterLap?.position != null
              ? afterLap.position - beforeLap.position
              : null,
        });
      }
    }

    return rows.sort((a, b) => a.lap - b.lap || a.driverId.localeCompare(b.driverId));
  }, [data, selected]);

  const fastestStop = useMemo(() => {
    const times = audits.map((audit) => audit.pitLane).filter((value): value is number => value != null);
    return times.length ? Math.min(...times) : null;
  }, [audits]);

  const byId = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);

  return (
    <WidgetShell
      id="pitAudit"
      title="Strategy & pit execution audit"
      subtitle={
        audits.length
          ? `${audits.length} stops · deltas against each driver's own median clean lap`
          : "In-lap, stop, out-lap and net position"
      }
      toolbar={
        <DriverFilter selected={selected} onToggle={toggle} onReset={reset} isCustom={isCustom} />
      }
    >
      {!data ? (
        <p className="p-3 text-[11px] text-ink-3">Load a race to audit its stops.</p>
      ) : !audits.length ? (
        <p className="p-3 text-[11px] text-ink-3">
          No pit stops recorded for the selected drivers.
        </p>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[10px]">
              <thead className="sticky top-0 bg-panel text-ink-3">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Driver</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Lap</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Change</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">In-lap</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Stationary</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Pit lane</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Out-lap</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Pos</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => {
                  const driver = byId.get(audit.driverId);
                  return (
                    <tr
                      key={`${audit.driverId}:${audit.lap}`}
                      className="border-t border-edge-soft"
                    >
                      <th scope="row" className="px-2 py-1 text-left font-normal">
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="h-2.5 w-1 rounded-sm"
                            style={{ background: driver?.colour ?? "#7c8496" }}
                          />
                          <span className="font-mono text-ink">
                            {driver?.code ?? audit.driverId}
                          </span>
                        </span>
                      </th>
                      <td className="px-2 py-1 text-right font-mono text-ink-2">{audit.lap}</td>
                      <td className="px-2 py-1 font-mono">
                        <span style={{ color: COMPOUND_COLOUR[audit.from] }}>{audit.from[0]}</span>
                        <span className="text-ink-3"> → </span>
                        <span style={{ color: COMPOUND_COLOUR[audit.to] }}>{audit.to[0]}</span>
                      </td>
                      <Delta value={audit.inLapDelta} />
                      <td className="px-2 py-1 text-right font-mono text-ink-2">
                        {audit.stationary == null ? (
                          <span className="text-ink-3" title="Not published by this data source">
                            n/p
                          </span>
                        ) : (
                          audit.stationary.toFixed(2)
                        )}
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-mono ${
                          audit.pitLane != null && audit.pitLane === fastestStop
                            ? "text-good"
                            : "text-ink"
                        }`}
                      >
                        {fmt.fixed(audit.pitLane, 2)}
                      </td>
                      <Delta value={audit.outLapDelta} />
                      <td className="px-2 py-1 text-right font-mono">
                        {audit.positionDelta == null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <span
                            className={
                              audit.positionDelta < 0
                                ? "text-good"
                                : audit.positionDelta > 0
                                  ? "text-bad"
                                  : "text-ink-2"
                            }
                          >
                            {audit.positionDelta > 0 ? `+${audit.positionDelta}` : audit.positionDelta}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="shrink-0 border-t border-edge-soft px-3 py-1.5 text-[9px] leading-snug text-ink-3">
            “n/p” means the source does not publish a stationary time — OpenF1 reports total pit-lane
            duration only. Position change compares the lap before entry with the lap after the
            out-lap.
          </p>
        </div>
      )}
    </WidgetShell>
  );
}

function Delta({ value }: { value: number | null }) {
  return (
    <td className="px-2 py-1 text-right font-mono">
      <span
        className={
          value == null
            ? "text-ink-3"
            : value > 0.4
              ? "text-bad"
              : value < -0.1
                ? "text-good"
                : "text-ink-2"
        }
      >
        {value == null ? "—" : fmt.signed(value, 2)}
      </span>
    </td>
  );
}
