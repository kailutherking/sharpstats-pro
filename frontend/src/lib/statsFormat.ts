import type { StatFormat, StatsWindow } from "./statsTypes";

export function formatStat(value: number | null | undefined, format: StatFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (format) {
    case "int": return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
    case "dec1": return value.toFixed(1);
    case "dec2": return value.toFixed(2);
    case "pct1": return `${value.toFixed(1)}%`;
    case "rate3": return value.toFixed(3).replace(/^0(?=\.)/, "");
    case "signed": return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)}`;
    case "minutes": { const whole = Math.floor(value); return `${whole}:${String(Math.round((value - whole) * 60)).padStart(2, "0")}`; }
    case "innings": { const whole = Math.floor(value + 1e-9); return `${whole}.${Math.round((value - whole) * 3)}`; }
    default: return String(value);
  }
}

/** Averages of whole-number stats read better with a decimal. */
export const averageFormat = (format: StatFormat): StatFormat => format === "int" ? "dec1" : format;

/** "MM/DD/YYYY HH:MM" in the viewer's local time. */
export function formatUpdated(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const WINDOW_LABELS: Record<StatsWindow, string> = {
  season: "Current season",
  last10: "Last 10 games",
  last30: "Last 30 days",
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Leading formula characters are escaped so spreadsheets do not evaluate them.
  const safe = /^[=+\-@]/.test(text) && !/^[+-]?\d/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
