import { onBetSettled } from "./social/pick.service";
import { getOddsApiScores, type ScoredEvent } from "../providers/oddsApi";
import { pool } from "../db/pool";
import { syncBankroll } from "./bets";

interface PendingBet {
  id: number;
  user_id: number;
  sport: string;
  event: string;
  event_id: string | null;
  market_key: string;
  selection: string;
  team_player: string;
  line_value: string | null;
  result: "pending" | "win" | "loss" | "push";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function eventMatches(bet: PendingBet, event: ScoredEvent): boolean {
  if (bet.event_id) return bet.event_id === event.id;
  const text = normalize(bet.event);
  return text.includes(normalize(event.home_team)) && text.includes(normalize(event.away_team));
}

function grade(bet: PendingBet, event: ScoredEvent): PendingBet["result"] | null {
  if (!event.completed || !event.scores || event.scores.length < 2) return null;
  const scores = new Map(event.scores.map((entry) => [normalize(entry.name), Number(entry.score)]));
  const home = scores.get(normalize(event.home_team));
  const away = scores.get(normalize(event.away_team));
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const market = bet.market_key.toLowerCase();
  if (market === "h2h" || market === "moneyline" || !market) {
    const selected = normalize(bet.selection || bet.team_player);
    if (!selected) return null;
    const pickedTeam = [event.home_team, event.away_team].find((team) => {
      const normalizedTeam = normalize(team);
      return selected === normalizedTeam || selected.includes(normalizedTeam) || normalizedTeam.includes(selected);
    });
    if (!pickedTeam) return null;
    const chosen = scores.get(normalize(pickedTeam))!;
    const other = pickedTeam === event.home_team ? away! : home!;
    return chosen === other ? "push" : chosen > other ? "win" : "loss";
  }
  if (market === "spreads") {
    const selected = normalize(bet.selection || bet.team_player);
    const team = [event.home_team, event.away_team].find((candidate) => {
      const name = normalize(candidate);
      return selected === name || selected.startsWith(name);
    });
    const line = Number(bet.line_value ?? (bet.selection || bet.team_player).match(/[+-]?\d+(?:\.\d+)?/)?.[0]);
    if (!team || !Number.isFinite(line)) return null;
    const margin = (scores.get(normalize(team))! - scores.get(normalize(team === event.home_team ? event.away_team : event.home_team))!) + line;
    return margin === 0 ? "push" : margin > 0 ? "win" : "loss";
  }
  if (market === "totals") {
    const line = Number(bet.line_value ?? (bet.selection || bet.team_player).match(/\d+(?:\.\d+)?/)?.[0]);
    const selection = (bet.selection || bet.team_player).toLowerCase();
    if (!Number.isFinite(line) || (!selection.includes("over") && !selection.includes("under"))) return null;
    const total = home! + away!;
    return total === line ? "push" : (selection.includes("over") === (total > line)) ? "win" : "loss";
  }
  return null;
}

export async function gradePendingBets(userId: number) {
  const pending = await pool.query<PendingBet>(
    `SELECT id, user_id, sport, event, event_id, market_key, selection, team_player, line_value, result
     FROM bets WHERE user_id=$1 AND result='pending' AND source <> 'simulated' ORDER BY bet_date LIMIT 500`,
    [userId],
  );
  const sports = [...new Set(pending.rows.map((bet) => bet.sport.toLowerCase()))];
  if (!process.env.ODDS_API_KEY) {
    return { graded: 0, pending: pending.rowCount ?? 0, skipped: pending.rowCount ?? 0, message: "Add ODDS_API_KEY to enable automatic grading." };
  }
  const scores = new Map<string, ScoredEvent>();
  const failures: string[] = [];
  for (const sport of sports) {
    const key = sport === "nba" || sport.includes("basketball") ? "basketball_nba"
      : sport === "nfl" || sport.includes("football") ? "americanfootball_nfl"
      : sport === "mlb" || sport.includes("baseball") ? "baseball_mlb"
      : sport === "nhl" || sport.includes("hockey") ? "icehockey_nhl" : null;
    // College basketball is matched before the generic "basketball" (NBA) rule.
    const resolved = /ncaa|college/.test(sport) ? "basketball_ncaab" : key;
    if (!resolved) continue;
    try {
      for (const event of await getOddsApiScores(resolved)) scores.set(event.id, event);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `Could not fetch ${sport} scores`);
    }
  }
  let graded = 0;
  const gradedIds: number[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const bet of pending.rows) {
      const event = [...scores.values()].find((candidate) => eventMatches(bet, candidate));
      const result = event ? grade(bet, event) : null;
      if (!result) continue;
      const update = await client.query(
        `UPDATE bets SET result=$1, profit_loss=CASE
          WHEN $1='win' THEN ROUND(stake * (odds - 1), 2)
          WHEN $1='loss' THEN -stake ELSE 0 END,
          graded_at=NOW()
         WHERE id=$2 AND user_id=$3 AND result='pending'`,
        [result, bet.id, userId],
      );
      if (update.rowCount) { graded += 1; gradedIds.push(bet.id); }
    }
    await syncBankroll(client, userId);
    await client.query("COMMIT");
    for (const id of gradedIds) void onBetSettled(userId, id, "grader");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return {
    graded,
    pending: (pending.rowCount ?? 0) - graded,
    skipped: (pending.rowCount ?? 0) - graded,
    ...(failures.length ? { providerErrors: failures } : {}),
  };
}
