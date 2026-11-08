import type { BookPrice, Selection, Sizing } from "./oddsTypes";

export function american(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function signedPoint(point: number | null | undefined): string {
  if (point === null || point === undefined) return "";
  if (point === 0) return "PK";
  return point > 0 ? `+${point}` : String(point);
}

export function money(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/** Mirrors the server's sizing: fractional Kelly capped at the bankroll page's 5% limit. */
export function recommendedStake(kelly: number | null | undefined, sizing: Sizing | undefined): number | null {
  if (!sizing || kelly === null || kelly === undefined || !(kelly > 0) || !(sizing.bankroll > 0)) return null;
  return Math.round(sizing.bankroll * Math.min(sizing.maxStakeFraction, kelly * sizing.kellyMultiplier) * 100) / 100;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function startTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

const SHORT_BOOKS: Record<string, string> = {
  draftkings: "DK", fanduel: "FD", betmgm: "MGM", caesars: "CZR", espnbet: "ESPN", fanatics: "FAN", prizepicks: "PP",
  underdog: "UD", betrivers: "BR", pointsbet: "PB", pinnacle: "PIN",
};

export function bookShort(key: string): string {
  return SHORT_BOOKS[key] ?? key.slice(0, 4).toUpperCase();
}

/** The line part of a price, e.g. "-4.5" for spreads or "o221.5" for totals. */
export function priceLine(selection: Pick<Selection, "type" | "selection">, price: Pick<BookPrice, "point">): string {
  if (price.point === null) return "";
  if (selection.type === "spread") return signedPoint(price.point);
  if (/^over$/i.test(selection.selection)) return `o${price.point}`;
  if (/^under$/i.test(selection.selection)) return `u${price.point}`;
  return String(price.point);
}

export function lineMoveText(selection: Pick<Selection, "type" | "selection">, price: BookPrice): string {
  if (!price.open) return "—";
  if (price.open.point !== null && price.point !== null && price.open.point !== price.point) {
    return `${priceLine(selection, { point: price.open.point })} → ${priceLine(selection, price)}`;
  }
  if (price.open.american === price.american) return "No move";
  return `${american(price.open.american)} → ${american(price.american)}`;
}

export const TIER_LABELS = { positive: "Positive EV", strong: "Strong EV", elite: "Elite EV" } as const;
