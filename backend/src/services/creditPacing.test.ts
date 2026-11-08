import { confidenceRating } from "./evCalculator.service";
import { CREDIT_RESERVE_SHARE, formatInterval, nextResetAt, pacedIntervalMs } from "./creditPacing";

describe("credit pacing", () => {
  const now = Date.UTC(2026, 10, 8, 19, 0);

  it("finds the next monthly reset", () => {
    expect(new Date(nextResetAt(now, 1)).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(new Date(nextResetAt(now, 15)).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(new Date(nextResetAt(Date.UTC(2026, 11, 20), 1)).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("stretches refreshes so the free plan lasts until the reset", () => {
    const resetAt = nextResetAt(now, 1);
    const interval = pacedIntervalMs({ remaining: 491, costPerRefresh: 3, activeSports: 1, now, resetAt });
    const refreshes = (resetAt - now) / interval;
    expect(refreshes * 3).toBeCloseTo(491 * (1 - CREDIT_RESERVE_SHARE), 6);
    expect(interval).toBeGreaterThan(3 * 3_600_000);
  });

  it("keeps the normal cadence possible on large plans and pauses when only the reserve is left", () => {
    const resetAt = nextResetAt(now, 1);
    expect(pacedIntervalMs({ remaining: 5_000_000, costPerRefresh: 3, activeSports: 1, now, resetAt })).toBeLessThan(30_000);
    expect(pacedIntervalMs({ remaining: 3, costPerRefresh: 3, activeSports: 1, now, resetAt })).toBe(Number.POSITIVE_INFINITY);
    expect(pacedIntervalMs({ remaining: null, costPerRefresh: 3, activeSports: 1, now, resetAt })).toBe(0);
  });

  it("formats intervals", () => {
    expect(formatInterval(45_000)).toBe("45 seconds");
    expect(formatInterval(20 * 60_000)).toBe("20 minutes");
    expect(formatInterval(4.2 * 3_600_000)).toBe("4.2 hours");
    expect(formatInterval(Number.POSITIVE_INFINITY)).toBe("paused");
  });
});

describe("in-play confidence", () => {
  it("heavily discounts edges on live games", () => {
    const base = { ev: 0.1, decimal: 1.45, fairBooks: 6, sharpReference: true, isProp: false, booksAtLine: 6, priceAgeSeconds: 20 };
    const pregame = confidenceRating(base);
    const live = confidenceRating({ ...base, live: true });
    expect(pregame.score - live.score).toBe(30);
    expect(live.label).not.toBe("high");
  });
});
