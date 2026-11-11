import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBetSlip } from "../../lib/betSlipStore";
import type { SlipQuote } from "../../lib/simTypes";
import { BetSlip } from "./BetSlip";

const quoteSlip = jest.fn();
const placeSlip = jest.fn();
jest.mock("../../lib/api", () => ({ api: { quoteSlip: (...args: unknown[]) => quoteSlip(...args), placeSlip: (...args: unknown[]) => placeSlip(...args) } }));

const bankroll = { startingBankroll: 1000, currentBankroll: 1000, unitSize: 25, exposure: 0, available: 1000, pendingBets: 0, potentialPayout: 0, riskPct: 0, exposureUnits: 0 };
const leg = { key: "g1|spreads||Duke Blue Devils", kind: "market" as const, sport: "ncaab" as const, gameId: "g1", selectionId: "g1|spreads||Duke Blue Devils", book: "draftkings", american: -110, label: "Duke Blue Devils -4.5 · Spread", event: "Kansas Jayhawks @ Duke Blue Devils", bookName: "DraftKings" };
const quote = (american: number, stake: number): SlipQuote => ({
  mode: "single", slipType: "single", totalStake: stake, totalPayout: stake ? 47.73 : 0, bankroll, availableAfter: 1000 - stake, oddsChanged: american !== -110, problems: stake ? [] : ["Enter a stake for Duke Blue Devils -4.5 · Spread."], notes: [],
  wagers: [{ betType: "spread", description: leg.label, bookName: "DraftKings", stake, decimal: 1.909, american, payout: 47.73, profit: 22.73, fairProbability: 0.5, evPct: -4.5, units: 1, riskPct: 2.5,
    legs: [{ index: 0, sport: "ncaab", gameId: "g1", event: leg.event, commenceTime: null, marketLabel: "Spread", label: leg.label, conference: "", book: "draftkings", bookName: "DraftKings", american, decimal: 1.909, fairProbability: 0.5, requestedAmerican: -110, changed: american !== -110, live: false }] }],
});

function renderSlip() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BetSlip /></QueryClientProvider>);
}

describe("BetSlip", () => {
  beforeEach(() => {
    quoteSlip.mockReset();
    placeSlip.mockReset();
    useBetSlip.setState({ legs: [], mode: "single", parlayStake: "", open: false });
  });

  it("keeps one entry per selection and remembers its stake", () => {
    useBetSlip.getState().add(leg);
    useBetSlip.getState().setStake(leg.key, "25");
    useBetSlip.getState().add({ ...leg, book: "fanduel", bookName: "FanDuel", american: -105 });
    expect(useBetSlip.getState().legs).toHaveLength(1);
    expect(useBetSlip.getState().legs[0]).toMatchObject({ book: "fanduel", american: -105, stake: "25" });
    expect(useBetSlip.getState().open).toBe(true);
  });

  it("reviews the payout and places a simulated wager", async () => {
    quoteSlip.mockImplementation((slip: { legs: Array<{ stake?: number }> }) => Promise.resolve(quote(-110, slip.legs[0]?.stake ?? 0)));
    placeSlip.mockResolvedValue({ slipId: "1", wagerIds: ["1"], quote: quote(-110, 25), bankroll: { ...bankroll, available: 975, exposure: 25 } });
    useBetSlip.getState().add(leg);
    renderSlip();
    expect(screen.getByText("SIMULATED · NO REAL MONEY")).toBeInTheDocument();
    expect(screen.getByText("Enter a stake")).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`Stake for ${leg.label}`), { target: { value: "25" } });
    const submit = await screen.findByRole("button", { name: /Place simulated bet · \$25\.00/ }, { timeout: 3000 });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByText("$47.73")).toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() => expect(placeSlip).toHaveBeenCalledWith(expect.objectContaining({ mode: "single", legs: [expect.objectContaining({ selectionId: leg.selectionId, book: "draftkings", american: -110, stake: 25 })] })));
    expect(await screen.findByText(/Wager placed/)).toBeInTheDocument();
    expect(useBetSlip.getState().legs).toHaveLength(0);
  });

  it("blocks placement until a moved price is accepted", async () => {
    quoteSlip.mockResolvedValue(quote(-120, 25));
    useBetSlip.getState().add(leg);
    useBetSlip.getState().setStake(leg.key, "25");
    renderSlip();
    expect(await screen.findByText("Price moved to -120.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Place simulated bet/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept new odds" }));
    expect(useBetSlip.getState().legs[0]!.american).toBe(-120);
  });
});
