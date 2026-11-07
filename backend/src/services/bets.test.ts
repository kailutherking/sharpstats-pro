import { calculateProfitLoss } from "./bets";

describe("calculateProfitLoss", () => {
  it("calculates decimal-odds winnings to cents", () => {
    expect(calculateProfitLoss("win", 1.91, 25)).toBe(22.75);
  });

  it("records losses and leaves pushes and pending bets at zero", () => {
    expect(calculateProfitLoss("loss", 1.91, 25)).toBe(-25);
    expect(calculateProfitLoss("push", 1.91, 25)).toBe(0);
    expect(calculateProfitLoss("pending", 1.91, 25)).toBe(0);
  });
});
