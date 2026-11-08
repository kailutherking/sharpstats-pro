import { american, lineMoveText, recommendedStake, signedPct } from "./oddsFormat";
import { parseSse } from "./sse";

describe("odds formatting", () => {
  it("formats American odds and percentages", () => {
    expect(american(150)).toBe("+150");
    expect(american(-110)).toBe("-110");
    expect(american(null)).toBe("—");
    expect(signedPct(0.0234)).toBe("+2.3%");
  });

  it("sizes stakes with fractional Kelly and the bankroll cap", () => {
    const sizing = { bankroll: 1000, kellyMultiplier: 0.25, maxStakeFraction: 0.05 };
    expect(recommendedStake(0.08, sizing)).toBe(20);
    expect(recommendedStake(0.5, sizing)).toBe(50);
    expect(recommendedStake(0, sizing)).toBeNull();
  });

  it("describes point and price moves since the open", () => {
    const base = { book: "draftkings", decimal: 1.9, implied: 0.52, atLine: true, priced: true, bookUpdatedAt: null, lastSeenAt: "", previous: null, high: null, low: null, highPoint: null, lowPoint: null, lastChangeAt: null, probabilityMove: null, pointMove: null, isBest: true, ev: null, kelly: null };
    expect(lineMoveText({ type: "spread", selection: "Bills" }, { ...base, american: -110, point: -4.5, open: { american: -110, point: -3.5, at: "" } })).toBe("-3.5 → -4.5");
    expect(lineMoveText({ type: "total", selection: "Over" }, { ...base, american: -120, point: 47.5, open: { american: -110, point: 47.5, at: "" } })).toBe("-110 → -120");
  });
});

describe("server-sent event parsing", () => {
  it("splits complete frames and keeps partial data", () => {
    const { events, rest } = parseSse('event: update\ndata: {"moves":2}\n\nevent: heartbeat\ndata: {}\n\nevent: alerts\ndata: [');
    expect(events).toEqual([{ event: "update", data: '{"moves":2}' }, { event: "heartbeat", data: "{}" }]);
    expect(rest).toBe("event: alerts\ndata: [");
  });
});
