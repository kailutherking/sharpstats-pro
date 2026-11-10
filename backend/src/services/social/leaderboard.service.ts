import { pool } from "../../db/pool";
import { cached } from "../statsCache";
import { levelFor } from "./gamification.service";

export type LeaderMetric = "roi" | "winrate" | "units" | "props";
export type LeaderPeriod = "7d" | "30d" | "all";

export interface LeaderRow {
  rank: number; previousRank: number | null; userId: number; handle: string; name: string; avatarUrl: string | null; level: number;
  picks: number; wins: number; losses: number; pushes: number; units: number; roi: number | null; winRate: number | null; verified: number; value: number;
}

const PERIOD_SQL: Record<LeaderPeriod, string> = { "7d": "AND p.settled_at > NOW() - INTERVAL '7 days'", "30d": "AND p.settled_at > NOW() - INTERVAL '30 days'", all: "" };
/** Minimum settled picks to rank on rate metrics, so a 2-0 start doesn't top the board. */
export const MIN_PICKS: Record<LeaderPeriod, number> = { "7d": 5, "30d": 10, all: 10 };

/**
 * Leaderboards from shared, settled picks only (private bet tracker records never appear).
 * Units are at the odds and size each pick was shared with.
 */
export async function leaderboard(viewerId: number, options: { metric: LeaderMetric; period: LeaderPeriod; scope: "global" | "following"; limit?: number }): Promise<{ rows: LeaderRow[]; minPicks: number; me: LeaderRow | null }> {
  const minPicks = options.metric === "units" ? 3 : MIN_PICKS[options.period];
  const propFilter = options.metric === "props" ? "AND (p.market_key ~ '^(player_|batter_|pitcher_)' OR p.bet_type ILIKE '%prop%')" : "";
  const order = options.metric === "winrate" ? "win_rate DESC NULLS LAST, units DESC" : options.metric === "units" ? "units DESC" : "roi DESC NULLS LAST, units DESC";
  const result = await pool.query<{ user_id: number; handle: string; username: string; avatar_url: string | null; xp: number; picks: string; wins: string; losses: string; pushes: string; units: string; risked: string; verified: string; roi: string | null; win_rate: string | null }>(
    `WITH agg AS (
       SELECT p.user_id, COUNT(*) AS picks, COUNT(*) FILTER (WHERE p.result='win') AS wins, COUNT(*) FILTER (WHERE p.result='loss') AS losses,
         COUNT(*) FILTER (WHERE p.result='push') AS pushes, COALESCE(SUM(p.result_units), 0) AS units,
         COALESCE(SUM(p.units) FILTER (WHERE p.result <> 'push'), 0) AS risked,
         COUNT(*) FILTER (WHERE p.locked AND p.auto_graded) AS verified
       FROM posts p WHERE p.kind='pick' AND p.visibility='public' AND p.result IN ('win','loss','push') ${PERIOD_SQL[options.period]} ${propFilter}
       GROUP BY p.user_id)
     SELECT a.*, pr.handle, u.username, pr.avatar_url, pr.xp,
       CASE WHEN a.risked > 0 THEN a.units / a.risked END AS roi,
       CASE WHEN a.wins + a.losses > 0 THEN a.wins::numeric / (a.wins + a.losses) END AS win_rate
     FROM agg a JOIN user_profiles pr ON pr.user_id=a.user_id JOIN users u ON u.id=a.user_id
     WHERE pr.is_public AND a.picks >= $1
       AND ($2 = 'global' OR a.user_id=$3 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$3 AND f.following_id=a.user_id))
     ORDER BY ${order} LIMIT 200`,
    [minPicks, options.scope, viewerId],
  );
  const key = `${options.metric}:${options.period}`;
  const previous = await previousRanks(options.metric, options.period);
  const rows: LeaderRow[] = result.rows.map((row, index) => {
    const roi = row.roi === null ? null : Math.round(Number(row.roi) * 10000) / 10000;
    const winRate = row.win_rate === null ? null : Math.round(Number(row.win_rate) * 10000) / 10000;
    const units = Math.round(Number(row.units) * 100) / 100;
    return {
      rank: index + 1, previousRank: options.scope === "global" ? previous.get(row.user_id) ?? null : null,
      userId: row.user_id, handle: row.handle, name: row.username, avatarUrl: row.avatar_url, level: levelFor(row.xp).level,
      picks: Number(row.picks), wins: Number(row.wins), losses: Number(row.losses), pushes: Number(row.pushes), units, roi, winRate, verified: Number(row.verified),
      value: options.metric === "winrate" ? winRate ?? 0 : options.metric === "units" ? units : roi ?? 0,
    };
  });
  if (options.scope === "global") void snapshot(key, options.metric, options.period, rows);
  return { rows: rows.slice(0, options.limit ?? 50), minPicks, me: rows.find((row) => row.userId === viewerId) ?? null };
}

async function previousRanks(metric: LeaderMetric, period: LeaderPeriod): Promise<Map<number, number>> {
  const rows = await pool.query<{ user_id: number; rank: number }>(
    `SELECT user_id, rank FROM leaderboard_snapshots WHERE metric=$1 AND period=$2 AND computed_at = (
       SELECT MAX(computed_at) FROM leaderboard_snapshots WHERE metric=$1 AND period=$2 AND computed_at < NOW() - INTERVAL '20 hours')`, [metric, period]);
  return new Map(rows.rows.map((row) => [row.user_id, row.rank]));
}

/** Saves global ranks at most every 6 hours, so "rank change" compares against roughly a day ago. */
async function snapshot(key: string, metric: LeaderMetric, period: LeaderPeriod, rows: LeaderRow[]): Promise<void> {
  await cached(`leaderboard:snapshot:${key}`, 6 * 3_600_000, async () => {
    if (!rows.length) return true;
    await pool.query(
      `INSERT INTO leaderboard_snapshots(metric, period, user_id, rank, value, picks)
       SELECT $1, $2, * FROM unnest($3::int[], $4::int[], $5::numeric[], $6::int[])`,
      [metric, period, rows.map((row) => row.userId), rows.map((row) => row.rank), rows.map((row) => row.value), rows.map((row) => row.picks)],
    );
    await pool.query("DELETE FROM leaderboard_snapshots WHERE computed_at < NOW() - INTERVAL '30 days'");
    return true;
  }).catch(() => undefined);
}

export interface BookRow { sportsbook: string; picks: number; wins: number; losses: number; units: number; roi: number | null; bettors: number }

/** How shared picks have done by sportsbook (where the community's winners place bets). */
export async function sportsbookLeaderboard(period: LeaderPeriod): Promise<BookRow[]> {
  const rows = await pool.query<{ sportsbook: string; picks: string; wins: string; losses: string; units: string; risked: string; bettors: string }>(
    `SELECT p.sportsbook, COUNT(*) AS picks, COUNT(*) FILTER (WHERE p.result='win') AS wins, COUNT(*) FILTER (WHERE p.result='loss') AS losses,
       COALESCE(SUM(p.result_units), 0) AS units, COALESCE(SUM(p.units) FILTER (WHERE p.result <> 'push'), 0) AS risked, COUNT(DISTINCT p.user_id) AS bettors
     FROM posts p JOIN user_profiles pr ON pr.user_id=p.user_id
     WHERE p.kind='pick' AND p.visibility='public' AND pr.is_public AND p.result IN ('win','loss','push') AND p.sportsbook IS NOT NULL ${PERIOD_SQL[period]}
     GROUP BY p.sportsbook HAVING COUNT(*) >= 3 ORDER BY SUM(p.result_units) DESC`);
  return rows.rows.map((row) => ({
    sportsbook: row.sportsbook, picks: Number(row.picks), wins: Number(row.wins), losses: Number(row.losses), units: Math.round(Number(row.units) * 100) / 100,
    roi: Number(row.risked) > 0 ? Math.round((Number(row.units) / Number(row.risked)) * 10000) / 10000 : null, bettors: Number(row.bettors),
  }));
}
