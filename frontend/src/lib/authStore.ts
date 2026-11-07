import { create } from "zustand";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearSession: () => {
    localStorage.removeItem("sharpstats_token");
    set({ user: null });
  },
}));
