import { create } from "zustand";
import type { SlipLeg, SlipMode } from "./simTypes";

/** The simulated bet slip: selections picked on the odds screen, waiting for a stake. */
interface BetSlipState {
  legs: SlipLeg[];
  mode: SlipMode;
  parlayStake: string;
  open: boolean;
  add: (leg: Omit<SlipLeg, "stake">) => void;
  remove: (key: string) => void;
  setStake: (key: string, stake: string) => void;
  setPrices: (prices: Array<{ key: string; american: number }>) => void;
  setParlayStake: (stake: string) => void;
  setMode: (mode: SlipMode) => void;
  setOpen: (open: boolean) => void;
  clear: () => void;
}

export const useBetSlip = create<BetSlipState>((set) => ({
  legs: [],
  mode: "single",
  parlayStake: "",
  open: false,
  // Adding a selection that is already on the slip updates it (e.g. a different sportsbook).
  add: (leg) => set((state) => ({
    open: true,
    legs: state.legs.some((item) => item.key === leg.key)
      ? state.legs.map((item) => item.key === leg.key ? { ...leg, stake: item.stake } : item)
      : [...state.legs, { ...leg, stake: "" }],
  })),
  remove: (key) => set((state) => ({ legs: state.legs.filter((leg) => leg.key !== key) })),
  setStake: (key, stake) => set((state) => ({ legs: state.legs.map((leg) => leg.key === key ? { ...leg, stake } : leg) })),
  setPrices: (prices) => set((state) => ({ legs: state.legs.map((leg) => { const next = prices.find((price) => price.key === leg.key); return next ? { ...leg, american: next.american } : leg; }) })),
  setParlayStake: (parlayStake) => set({ parlayStake }),
  setMode: (mode) => set({ mode }),
  setOpen: (open) => set({ open }),
  clear: () => set({ legs: [], parlayStake: "" }),
}));
