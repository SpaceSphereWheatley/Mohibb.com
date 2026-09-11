import type { ReactNode } from "react";

export type MetricTone = "neutral" | "good" | "bad" | "warn";

const TONE: Record<MetricTone, string> = {
  neutral: "text-ink",
  good: "text-good",
  bad: "text-bad",
  warn: "text-warn",
};

/**
 * One read-out: a label, a value and an optional delta. Values are rendered in
 * the tabular face so a metric that updates under the cursor does not reflow.
 */
export function MetricCard({
  label,
  value,
  unit,
  delta,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: ReactNode;
  tone?: MetricTone;
  hint?: string;
}) {
  return (
    <div
      className="min-w-0 rounded border border-edge bg-panel-2/60 px-2.5 py-2"
      title={hint}
    >
      <div className="truncate text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-lg leading-none tabular-nums ${TONE[tone]}`}>
          {value}
        </span>
        {unit ? <span className="text-[11px] text-ink-3">{unit}</span> : null}
      </div>
      {delta != null ? (
        <div className="mt-1 font-mono text-[11px] tabular-nums text-ink-2">{delta}</div>
      ) : null}
    </div>
  );
}
