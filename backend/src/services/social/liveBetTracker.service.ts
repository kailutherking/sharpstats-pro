import { pool } from "../../db/pool";
import { isInProgress } from "../../providers/espnLive";
import type { League } from "../../providers/espnStats";
import { detailCached, normalizeName, PROP_DEFS } from "../liveGame.service";
import { notify } from "./notification.service";

export interface LiveBet {
  betId: number; event: string; selection: string; market: string; betType: string; line: number | null; odds: number; sportsbook: string;
  player: string | null; current: number | null; status: "winning" | "losing" | "hit" | "busted" | "unknown"; detail: string;
}

interface BetRow { id: number; user_id: number; event: string; selection: string; team_player: string; market_key: string; bet_type: string; line_value: string | null; odds: string; sportsbook: string }

/** Evaluates a tracked bet against the live game: prop progress (over/under) or the current score. */
function evaluate(league: League, bet: BetRow, detail: Awaited<ReturnType<typeof detailCached>>["data"]): LiveBet {
  const line = bet.line_value === null ? null : Number(bet.line_value);
  const base = { betId: bet.id, event: bet.event, selection: bet.selection || bet.team_player, market: bet.market_key, betType: bet.bet_type, line, odds: Number(bet.odds), sportsbook: bet.sportsbook };
  const def = PROP_DEFS[league].find((item) => item.market === bet.market_key);
  const game = detail.game;
  if (def) {
    const target = normalizeName(bet.team_player || bet.selection.replace(/\b(over|under)\b.*$/i, ""));
    const values: Record<string, number | null> = {};
    let name: string | null = null;
    for (const team of detail.box) for (const group of team.groups) for (const player of group.players) {
      if (normalizeName(player.name) === target) { Object.assign(values, player.values); name = player.name; }
    }
    const current = name ? def.current(values) : null;
    const under = /under/i.test(bet.selection);
    if (current === null || line === null) return { ...base, player: name, current, status: "unknown", detail: name ? "Waiting for stats" : "Player not in the box score yet" };
    const over = current > line;
    const final = game.status === "final";
    const status: LiveBet["status"] = under ? (over ? "busted" : final ? "hit" : "winning") : over ? "hit" : final ? "busted" : "losing";
    const need = Math.floor(line - current) + 1;
    return { ...base, player: name, current, status, detail: under ? (over ? `Busted at ${current}` : `${current} of ${line} · ${Math.max(0, Math.ceil(line - current))} to spare`) : over ? `Cashed at ${current}` : `${current} of ${line} · needs ${need} more` };
  }
  // Game lines: compare the pick's team with the score (spread applied when a line is set).
  const pickTeam = [game.home, game.away].find((team) => [team.name, team.shortName, team.abbr].some((label) => label && (bet.selection || bet.team_player).toLowerCase().includes(label.toLowerCase())));
  if (!pickTeam || game.home.score === null || game.away.score === null) return { ...base, player: null, current: null, status: "unknown", detail: (game.statusDetail || game.status) };
  const other = pickTeam === game.home ? game.away : game.home;
  const margin = (pickTeam.score ?? 0) - (other.score ?? 0) + (bet.market_key === "spreads" && line !== null ? line : 0);
  const status: LiveBet["status"] = game.status === "final" ? (margin > 0 ? "hit" : "busted") : margin > 0 ? "winning" : "losing";
  return { ...base, player: null, current: margin, status, detail: `${pickTeam.abbr} ${pickTeam.score}-${other.score}${bet.market_key === "spreads" && line !== null ? ` (${line > 0 ? "+" : ""}${line})` : ""} · ${(game.statusDetail || game.status)}` };
}

async function pendingBetsFor(where: string, params: unknown[]): Promise<Array<BetRow & { league: string; espn_event_id: string }>> {
  const rows = await pool.query<BetRow & { league: string; espn_event_id: string }>(
    `SELECT b.id, b.user_id, b.event, b.selection, b.team_player, b.market_key, b.bet_type, b.line_value::text, b.odds::text, b.sportsbook, g.league, g.event_id AS espn_event_id
     FROM bets b JOIN games g ON g.odds_game_id=b.event_id
     WHERE b.result='pending' AND ${where}`, params);
  return rows.rows;
}

/** The signed-in user's pending bets on one live game, with live status. */
export async function myLiveBets(userId: number, league: League, eventId: string): Promise<LiveBet[]> {
  const bets = await pendingBetsFor("b.user_id=$1 AND g.league=$2 AND g.event_id=$3", [userId, league, eventId]);
  if (!bets.length) return [];
  const detail = await detailCached(league, eventId);
  return bets.map((bet) => evaluate(league, bet, detail.data));
}

/** Background check: notify when a tracked prop cashes during a game (once per bet). */
export async function scanLiveBets(): Promise<void> {
  const bets = await pendingBetsFor("g.status IN ('live','halftime','end_period','final') AND g.updated_at > NOW() - INTERVAL '6 hours'", []);
  const byGame = new Map<string, typeof bets>();
  for (const bet of bets) byGame.set(`${bet.league}:${bet.espn_event_id}`, [...(byGame.get(`${bet.league}:${bet.espn_event_id}`) ?? []), bet]);
  for (const [key, list] of byGame) {
    const [league, eventId] = key.split(":") as [League, string];
    const detail = await detailCached(league, eventId).catch(() => null);
    if (!detail || (!isInProgress(detail.data.game.status) && detail.data.game.status !== "final")) continue;
    const drafts = list.map((bet) => ({ bet, live: evaluate(league, bet, detail.data) }))
      .filter(({ bet, live }) => live.status === "hit" && PROP_DEFS[league].some((def) => def.market === bet.market_key))
      .map(({ bet, live }) => ({ userId: bet.user_id, type: "prop_hit" as const, title: `Prop cashed live: ${live.player ?? live.selection}`, body: `${live.selection} ${live.line ?? ""} · ${live.detail} (${detail.data.game.shortName})`, link: { page: "Stats", league, gameId: eventId }, dedupeKey: `liveprop:${bet.id}` }));
    if (drafts.length) await notify(drafts);
  }
}

export function startLiveBetScanner(): () => void {
  const timer = setInterval(() => void scanLiveBets().catch((error: unknown) => console.warn("Live bet scan failed", error instanceof Error ? error.message : error)), 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
