import { create } from "zustand";
import type { League } from "./statsTypes";

/** Cross-page deep links (notifications, feed items) without a router. */
interface NavState {
  page: string | null;
  community: { handle?: string; postId?: number; tab?: "feed" | "picks" | "leaderboards" | "profile" } | null;
  live: { league: League; gameId: string } | null;
  go: (page: string, target?: { community?: NavState["community"]; live?: NavState["live"] }) => void;
  consumePage: () => void;
  consumeCommunity: () => void;
  consumeLive: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  page: null,
  community: null,
  live: null,
  go: (page, target) => set({ page, community: target?.community ?? null, live: target?.live ?? null }),
  consumePage: () => set({ page: null }),
  consumeCommunity: () => set({ community: null }),
  consumeLive: () => set({ live: null }),
}));
