/** Number formatting. Everything here is fixed-width so nothing jitters. */

export function lapTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const minutes = Math.floor(abs / 60);
  const rest = abs - minutes * 60;
  return `${sign}${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

export function signed(value: number | null | undefined, decimals = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(decimals);
  if (Number(fixed) === 0) return `+${fixed}`;
  return `${value < 0 ? "-" : "+"}${fixed}`;
}

export function fixed(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

export function metres(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} m`;
}

export function seconds(value: number | null | undefined, decimals = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)} s`;
}

/** Distance readouts along a lap, e.g. "2 480 m". */
export function distance(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("en-GB").replace(/,/g, " ")} m`;
}
