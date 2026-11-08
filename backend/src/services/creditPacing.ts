/**
 * Spreads The Odds API credits over the billing month. Each automatic refresh costs credits
 * (featured markets x one region), so the automatic refresh interval is stretched until the
 * remaining credits, less a reserve for manual refreshes, game drawers and props, last until
 * the quota resets. Plans with plenty of credits keep the normal 30-second cadence.
 */

/** Share of remaining credits kept back for user-initiated requests. */
export const CREDIT_RESERVE_SHARE = 0.2;
const MIN_WINDOW_MS = 3_600_000;

/** Next quota reset: 00:00 UTC on `resetDay` (1-28) of this month, or next month if already past. */
export function nextResetAt(now: number, resetDay: number): number {
  const day = Math.min(28, Math.max(1, Math.round(resetDay) || 1));
  const date = new Date(now);
  let reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day);
  if (reset <= now) reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, day);
  return reset;
}

/**
 * Shortest automatic refresh interval (ms) per sport that the remaining credits can sustain until
 * the reset. 0 = unknown (no quota reading yet); Infinity = only the reserve is left.
 */
export function pacedIntervalMs(input: { remaining: number | null; costPerRefresh: number; activeSports: number; now: number; resetAt: number }): number {
  if (input.remaining === null) return 0;
  const usable = input.remaining * (1 - CREDIT_RESERVE_SHARE);
  const costPerRound = Math.max(1, input.costPerRefresh) * Math.max(1, input.activeSports);
  if (usable < costPerRound) return Number.POSITIVE_INFINITY;
  const window = Math.max(MIN_WINDOW_MS, input.resetAt - input.now);
  return window / (usable / costPerRound);
}

export function formatInterval(ms: number): string {
  if (!Number.isFinite(ms)) return "paused";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = ms / 3_600_000;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`;
}
