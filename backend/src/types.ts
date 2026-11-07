import type { Request } from "express";

export interface AuthUser {
  id: number;
  email: string;
  username: string;
}

export type AuthRequest = Request & { user?: AuthUser };

export interface BetRow {
  id: number;
  user_id: number;
  sport: string;
  league: string;
  event: string;
  bet_type: string;
  team_player: string;
  odds: string;
  stake: string;
  result: "pending" | "win" | "loss" | "push";
  profit_loss: string;
  sportsbook: string;
  bet_date: string;
  closing_odds: string | null;
  market_key: string;
  selection: string;
  line_value: string | null;
  event_id: string | null;
  graded_at: string | null;
  notes: string;
  created_at: string;
}
