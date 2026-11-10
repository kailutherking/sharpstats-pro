import { pool } from "../db/pool";
import { fetchAthleteNews, fetchLeagueInjuries, INJURY_STATUSES, type AthleteNews, type InjuryStatus, type ProviderInjury } from "../providers/espnInjuries";
import type { League } from "../providers/espnStats";
import { cached } from "./statsCache";
import { getLeagueStats, NotFoundError, type PlayerRow } from "./stats.service";
import {
  computeImpact, fantasyPerGame, healthLabel, lineImpact, STATUS_WEIGHT, teamHealthScore,
  type InjuryImpact, type LineImpact, type TeamHealth,
} from "./injuryImpact.service";
import { storeAlerts, type AlertDraft } from "./oddsAlerts.service";
import { broadcast } from "./oddsStream";

export const INJURY_REFRESH_MINUTES = Math.max(2, Number(process.env.INJURY_REFRESH_MINUTES ?? 5) || 5);
const REFRESH_MS = INJURY_REFRESH_MINUTES * 60_000;
export const INJURY_SOURCE = "ESPN injury reports (team reports, Rotowire notes) · SharpStats impact model";
const UNAVAILABLE: InjuryStatus[] = ["Out", "Injured Reserve", "Suspended", "Inactive", "Doubtful"];

export interface InjuryRow extends ProviderInjury {
  injury: string;
  firstReportedAt: string;
  impact: InjuryImpact;
}

interface LeagueInjuries {
  injuries: InjuryRow[];
  teams: TeamHealth[];
}

/* ---------- Text extraction ---------- */

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((sentence) => sentence.trim()).filter(Boolean);

export type PracticeLevel = "Full" | "Limited" | "Did not practice";

/** Practice participation from report notes ("was a limited participant", "did not practice"). */
export function practiceNotes(texts: Array<{ text: string; at: string }>): Array<{ level: PracticeLevel; note: string; at: string }> {
  const seen = new Set<string>();
  const notes: Array<{ level: PracticeLevel; note: string; at: string }> = [];
  for (const { text, at } of texts) {
    for (const sentence of sentences(text)) {
      if (!/practic/i.test(sentence) || seen.has(sentence)) continue;
      seen.add(sentence);
      const level: PracticeLevel = /did not practice|didn't practice|\bDNP\b|not practicing|missed practice|sat out practice|no practice/i.test(sentence)
        ? "Did not practice"
        : /limited/i.test(sentence) ? "Limited" : /full|fully|without limitation|no limitations/i.test(sentence) ? "Full" : "Limited";
      notes.push({ level, note: sentence, at });
    }
  }
  return notes.slice(0, 6);
}

/** Workload limits mentioned in notes: minutes restrictions, pitch or snap counts, load management. */
export function workloadNotes(texts: string[]): string[] {
  const pattern = /minutes? (restriction|limit|cap)|restricted minutes|pitch count|snap count|snap share|load management|limited (role|workload|snaps|minutes)|on a (minutes|pitch|snap) (limit|count)|workload/i;
  return [...new Set(texts.flatMap((text) => sentences(text).filter((sentence) => pattern.test(sentence))))].slice(0, 4);
}

export function injuryLabel(injury: Pick<ProviderInjury, "injuryType" | "location" | "detail" | "side" | "status">): string {
  const parts = [injury.side && !/^(left|right)$/i.test(injury.side) ? null : injury.side, injury.injuryType ?? injury.location, injury.detail && injury.detail !== injury.injuryType ? `(${injury.detail})` : null].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return injury.status === "Suspended" ? "Suspension" : injury.status === "Active" ? "Cleared" : "Undisclosed";
}

/* ---------- Sync, history and alerts ---------- */

interface StoredInjury { athlete_id: string; status: InjuryStatus; injury_type: string | null; short_comment: string; first_reported_at: Date; team_name: string; player_name: string; position: string; importance: number | null }

const SEVERITY: Record<InjuryStatus, number> = { Active: 0, Probable: 1, "Day-to-Day": 2, Questionable: 3, "Game Time Decision": 3, Doubtful: 4, Out: 5, Inactive: 5, Suspended: 5, "Injured Reserve": 6 };

export type InjuryChange = "ruled_out" | "upgraded" | "downgraded" | "returned" | null;

/** Classifies a status change for alerts. */
export function classifyChange(previous: InjuryStatus | null, next: InjuryStatus | null): InjuryChange {
  if (previous === next) return null;
  if (next === null) return previous && SEVERITY[previous] >= 4 ? "returned" : null;
  if (next === "Active") return previous && SEVERITY[previous] >= 3 ? "returned" : null;
  if ((next === "Out" || next === "Inactive") && (previous === null || SEVERITY[previous] < 5)) return "ruled_out";
  if (previous === null) return null;
  if (SEVERITY[next] < SEVERITY[previous]) return "upgraded";
  if (SEVERITY[next] > SEVERITY[previous]) return "downgraded";
  return null;
}

const ALERT_FOR: Record<Exclude<InjuryChange, null>, { type: AlertDraft["type"]; title: (name: string) => string; severity: AlertDraft["severity"] }> = {
  ruled_out: { type: "injury_out", title: (name) => `${name} ruled out`, severity: "high" },
  upgraded: { type: "injury_upgrade", title: (name) => `${name} upgraded`, severity: "notice" },
  downgraded: { type: "injury_downgrade", title: (name) => `${name} downgraded`, severity: "notice" },
  returned: { type: "injury_return", title: (name) => `${name} returning`, severity: "notice" },
};

async function syncLeague(league: League, rows: InjuryRow[]): Promise<void> {
  try {
    const existing = await pool.query<StoredInjury>(
      "SELECT athlete_id, status, injury_type, short_comment, first_reported_at, team_name, player_name, position, importance FROM injuries WHERE league=$1 AND active",
      [league],
    );
    const before = new Map(existing.rows.map((row) => [row.athlete_id, row]));
    const firstRun = existing.rows.length === 0;
    const now = new Date();
    for (const row of rows) {
      const prior = before.get(row.athleteId);
      const keepFirst = prior && (prior.injury_type ?? "") === (row.injuryType ?? "");
      row.firstReportedAt = keepFirst ? prior.first_reported_at.toISOString() : (prior ? now.toISOString() : row.reportedAt);
    }
    await pool.query(
      `INSERT INTO injuries(league, athlete_id, player_name, team_id, team_name, team_abbr, position, status, provider_status, injury_type, body_location, injury_detail, side,
         return_date, short_comment, long_comment, reported_at, first_reported_at, source, headshot, importance, active, updated_at)
       SELECT *, TRUE, NOW() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
         $12::text[], $13::text[], $14::date[], $15::text[], $16::text[], $17::timestamptz[], $18::timestamptz[], $19::text[], $20::text[], $21::int[])
       ON CONFLICT (league, athlete_id) DO UPDATE SET player_name=EXCLUDED.player_name, team_id=EXCLUDED.team_id, team_name=EXCLUDED.team_name, team_abbr=EXCLUDED.team_abbr,
         position=EXCLUDED.position, status=EXCLUDED.status, provider_status=EXCLUDED.provider_status, injury_type=EXCLUDED.injury_type, body_location=EXCLUDED.body_location,
         injury_detail=EXCLUDED.injury_detail, side=EXCLUDED.side, return_date=EXCLUDED.return_date, short_comment=EXCLUDED.short_comment, long_comment=EXCLUDED.long_comment,
         reported_at=EXCLUDED.reported_at, first_reported_at=EXCLUDED.first_reported_at, headshot=EXCLUDED.headshot, importance=EXCLUDED.importance, active=TRUE, cleared_at=NULL, updated_at=NOW()`,
      [rows.map(() => league), rows.map((r) => r.athleteId), rows.map((r) => r.name), rows.map((r) => r.teamId), rows.map((r) => r.teamName), rows.map((r) => r.teamAbbr),
        rows.map((r) => r.position), rows.map((r) => r.status), rows.map((r) => r.providerStatus), rows.map((r) => r.injuryType), rows.map((r) => r.location), rows.map((r) => r.detail),
        rows.map((r) => r.side), rows.map((r) => r.returnDate), rows.map((r) => r.shortComment), rows.map((r) => r.longComment), rows.map((r) => r.reportedAt),
        rows.map((r) => r.firstReportedAt), rows.map((r) => r.source), rows.map((r) => r.headshot), rows.map((r) => r.impact.importance)],
    );
    const changed = rows.filter((row) => {
      const prior = before.get(row.athleteId);
      return !prior || prior.status !== row.status || (prior.injury_type ?? "") !== (row.injuryType ?? "") || prior.short_comment !== row.shortComment;
    });
    if (changed.length) {
      await pool.query(
        `INSERT INTO injury_history(league, athlete_id, player_name, team_id, status, previous_status, injury_type, body_location, return_date, comment, reported_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::date[], $10::text[], $11::timestamptz[])`,
        [changed.map(() => league), changed.map((r) => r.athleteId), changed.map((r) => r.name), changed.map((r) => r.teamId), changed.map((r) => r.status),
          changed.map((r) => before.get(r.athleteId)?.status ?? null), changed.map((r) => r.injuryType), changed.map((r) => r.location), changed.map((r) => r.returnDate),
          changed.map((r) => r.longComment || r.shortComment), changed.map((r) => r.reportedAt)],
      );
    }
    const current = new Set(rows.map((row) => row.athleteId));
    const cleared = existing.rows.filter((row) => !current.has(row.athlete_id));
    if (cleared.length) {
      await pool.query("UPDATE injuries SET active=FALSE, cleared_at=NOW() WHERE league=$1 AND athlete_id = ANY($2::text[])", [league, cleared.map((row) => row.athlete_id)]);
      await pool.query(
        `INSERT INTO injury_history(league, athlete_id, player_name, team_id, status, previous_status, injury_type, comment, reported_at)
         SELECT $1, athlete_id, player_name, team_id, 'Cleared', status, injury_type, 'Removed from the team injury report', NOW() FROM injuries WHERE league=$1 AND athlete_id = ANY($2::text[])`,
        [league, cleared.map((row) => row.athlete_id)],
      );
    }
    await pool.query(
      `INSERT INTO injury_impact(league, athlete_id, status, importance, tier, projected_impact, rating_change, rating_unit, win_impact, offensive_change, defensive_change,
         fantasy_per_game, prop_level, basis, updated_at)
       SELECT *, NOW() FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::int[], $7::numeric[], $8::text[], $9::numeric[], $10::numeric[], $11::numeric[],
         $12::numeric[], $13::text[], $14::text[])
       ON CONFLICT (league, athlete_id) DO UPDATE SET status=EXCLUDED.status, importance=EXCLUDED.importance, tier=EXCLUDED.tier, projected_impact=EXCLUDED.projected_impact,
         rating_change=EXCLUDED.rating_change, rating_unit=EXCLUDED.rating_unit, win_impact=EXCLUDED.win_impact, offensive_change=EXCLUDED.offensive_change,
         defensive_change=EXCLUDED.defensive_change, fantasy_per_game=EXCLUDED.fantasy_per_game, prop_level=EXCLUDED.prop_level, basis=EXCLUDED.basis, updated_at=NOW()`,
      [rows.map(() => league), rows.map((r) => r.athleteId), rows.map((r) => r.status), rows.map((r) => r.impact.importance), rows.map((r) => r.impact.tier),
        rows.map((r) => r.impact.projectedImpact), rows.map((r) => r.impact.ratingChange), rows.map((r) => r.impact.ratingUnit), rows.map((r) => r.impact.winImpact),
        rows.map((r) => r.impact.offensive.change), rows.map((r) => r.impact.defensive.change), rows.map((r) => r.impact.fantasy.perGame), rows.map((r) => r.impact.prop.level),
        rows.map((r) => r.impact.basis)],
    );
    if (firstRun) return;
    await raiseAlerts(league, rows, before, cleared);
  } catch (error) {
    console.warn("Injury sync failed", league, error instanceof Error ? error.message : error);
  }
}

/** Status-change alerts for players who matter to a line (Moderate importance or higher). */
async function raiseAlerts(league: League, rows: InjuryRow[], before: Map<string, StoredInjury>, cleared: StoredInjury[]): Promise<void> {
  const drafts: AlertDraft[] = [];
  const bucket = new Date().toISOString().slice(0, 13);
  for (const row of rows) {
    const change = classifyChange(before.get(row.athleteId)?.status ?? null, row.status);
    if (!change || row.impact.importance < 30) continue;
    const spec = ALERT_FOR[change];
    const prior = before.get(row.athleteId)?.status;
    drafts.push({
      signature: `injury:${league}:${row.athleteId}:${row.status}:${bucket}`, type: spec.type, sport: league, gameId: `team:${row.teamId}`, game: row.teamName, market: "injury",
      sideId: row.athleteId, book: null, title: spec.title(row.name),
      message: `${row.name} (${row.teamAbbr} ${row.position}) ${prior ? `${prior} → ` : ""}${row.status}. ${row.shortComment || row.injury} Impact: ${row.impact.tier} (${row.impact.ratingChange} ${row.impact.ratingUnit}/game).`.slice(0, 900),
      severity: row.impact.importance >= 55 ? "high" : spec.severity, value: row.impact.importance,
    });
  }
  for (const row of cleared) {
    if (classifyChange(row.status, null) !== "returned" || (row.importance ?? 0) < 30) continue;
    drafts.push({
      signature: `injury:${league}:${row.athlete_id}:cleared:${bucket}`, type: "injury_return", sport: league, gameId: `team:${row.team_name}`, game: row.team_name, market: "injury",
      sideId: row.athlete_id, book: null, title: `${row.player_name} off the injury report`, message: `${row.player_name} (${row.position}) was removed from the ${row.team_name} injury report (was ${row.status}).`,
      severity: "notice", value: row.importance,
    });
  }
  const stored = await storeAlerts(drafts);
  if (stored.length) broadcast(league, "alerts", stored);
}

/** Line-movement correlation alerts: key players out and the spread has moved a point or more since the report. */
async function raiseLineAlerts(league: League, impacts: Array<{ row: InjuryRow; line: LineImpact }>): Promise<void> {
  const drafts: AlertDraft[] = impacts.filter(({ line }) => line.baseline === "report" && line.move !== null && Math.abs(line.move) >= 1 && line.direction === "against").map(({ row, line }) => ({
    signature: `injury_line:${league}:${row.athleteId}:${line.gameId}:${line.current?.point}`, type: "injury_line", sport: league, gameId: line.gameId, game: line.game, market: "spreads",
    sideId: row.athleteId, book: null, title: `${row.name} injury · ${line.team} spread moved ${Math.abs(line.move!)}`, message: line.message, severity: Math.abs(line.move!) >= 2 ? "high" : "notice",
    value: line.move,
  }));
  const stored = await storeAlerts(drafts);
  if (stored.length) broadcast(league, "alerts", stored);
}

/* ---------- Report ---------- */

async function seasonRows(league: League): Promise<PlayerRow[]> {
  return getLeagueStats(league, "season").then((stats) => stats.players).catch(() => []);
}

async function buildLeague(league: League): Promise<LeagueInjuries> {
  const [raw, players] = await Promise.all([fetchLeagueInjuries(league), seasonRows(league)]);
  const byId = new Map(players.map((row) => [row.id, row]));
  const byTeam = new Map<string, PlayerRow[]>();
  for (const row of players) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), row]);
  const fantasyPool = players.map((row) => fantasyPerGame(league, row, row.position)).filter((value): value is number => value !== null && value > 0);
  const unavailable = new Set(raw.filter((injury) => UNAVAILABLE.includes(injury.status)).map((injury) => injury.athleteId));
  const injuries: InjuryRow[] = raw.map((injury) => ({
    ...injury,
    injury: injuryLabel(injury),
    firstReportedAt: injury.reportedAt,
    impact: computeImpact({ league, status: injury.status, position: injury.position, row: byId.get(injury.athleteId) ?? null, teammates: byTeam.get(injury.teamId) ?? [], fantasyPool, unavailable }),
  }));
  await syncLeague(league, injuries);
  return { injuries, teams: teamHealth(injuries) };
}

function teamHealth(injuries: InjuryRow[]): TeamHealth[] {
  const teams = new Map<string, InjuryRow[]>();
  for (const injury of injuries) teams.set(injury.teamId, [...(teams.get(injury.teamId) ?? []), injury]);
  return [...teams.values()].map((rows) => {
    const first = rows[0]!;
    const score = teamHealthScore(rows.map((row) => ({ importance: row.impact.importance, weight: STATUS_WEIGHT[row.status] })));
    return {
      teamId: first.teamId, teamName: first.teamName, teamAbbr: first.teamAbbr, logo: first.teamLogo, score, label: healthLabel(score),
      active: rows.filter((row) => row.status !== "Active").length,
      out: rows.filter((row) => ["Out", "Injured Reserve", "Inactive"].includes(row.status)).length,
      questionable: rows.filter((row) => ["Questionable", "Doubtful", "Game Time Decision", "Day-to-Day"].includes(row.status)).length,
      returning: rows.filter((row) => row.status === "Active" || row.status === "Probable" || (row.returnDate !== null && Date.parse(row.returnDate) - Date.now() < 3 * 86_400_000 && row.status !== "Injured Reserve")).length,
      suspended: rows.filter((row) => row.status === "Suspended").length,
      keyOut: rows.filter((row) => UNAVAILABLE.includes(row.status) && row.impact.importance >= 30).sort((a, b) => b.impact.importance - a.impact.importance).slice(0, 3).map((row) => row.name),
    };
  }).sort((a, b) => a.score - b.score);
}

async function leagueData(league: League, force = false) {
  return cached(`injuries:${league}`, REFRESH_MS, () => buildLeague(league), { force });
}

let lastTeamHealthWrite = new Map<string, string>();

async function persistTeamHealth(league: League, teams: TeamHealth[]): Promise<void> {
  const changed = teams.filter((team) => {
    const key = `${league}:${team.teamId}`;
    const signature = `${team.score}|${team.out}|${team.questionable}|${team.suspended}`;
    if (lastTeamHealthWrite.get(key) === signature) return false;
    lastTeamHealthWrite.set(key, signature);
    return true;
  });
  if (!changed.length) return;
  try {
    await pool.query(
      `INSERT INTO team_health(league, team_id, team_name, health_score, label, active_injuries, out_count, questionable_count, returning_count, suspended_count)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[])`,
      [changed.map(() => league), changed.map((t) => t.teamId), changed.map((t) => t.teamName), changed.map((t) => t.score), changed.map((t) => t.label), changed.map((t) => t.active),
        changed.map((t) => t.out), changed.map((t) => t.questionable), changed.map((t) => t.returning), changed.map((t) => t.suspended)],
    );
  } catch (error) {
    console.warn("Team health write failed", error instanceof Error ? error.message : error);
  }
}

export function resetInjuryState(): void {
  lastTeamHealthWrite = new Map();
}

export interface InjuryFilters { team?: string; position?: string; status?: InjuryStatus[]; updated?: "24h" | "3d" | "7d" | "all"; q?: string; includeActive?: boolean }

const UPDATED_MS = { "24h": 86_400_000, "3d": 3 * 86_400_000, "7d": 7 * 86_400_000 } as const;

export function filterInjuries(rows: InjuryRow[], filters: InjuryFilters, now = Date.now()): InjuryRow[] {
  const q = filters.q?.trim().toLowerCase();
  return rows.filter((row) => (filters.includeActive || filters.status?.includes("Active") || row.status !== "Active")
    && (!filters.team || row.teamId === filters.team)
    && (!filters.position || row.position === filters.position)
    && (!filters.status?.length || filters.status.includes(row.status))
    && (!filters.updated || filters.updated === "all" || now - Date.parse(row.reportedAt) <= UPDATED_MS[filters.updated])
    && (!q || `${row.name} ${row.teamName} ${row.teamAbbr} ${row.injury}`.toLowerCase().includes(q)));
}

export async function getInjuryReport(league: League, filters: InjuryFilters, options: { force?: boolean } = {}) {
  const data = await leagueData(league, options.force);
  void persistTeamHealth(league, data.data.teams);
  const rows = filterInjuries(data.data.injuries, filters).sort((a, b) => b.impact.projectedImpact - a.impact.projectedImpact || Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
  const all = data.data.injuries;
  return {
    league,
    injuries: rows,
    total: all.filter((row) => row.status !== "Active").length,
    counts: Object.fromEntries(INJURY_STATUSES.map((status) => [status, all.filter((row) => row.status === status).length])) as Record<InjuryStatus, number>,
    teams: data.data.teams,
    filters: {
      teams: [...new Map(all.map((row) => [row.teamId, { id: row.teamId, name: row.teamName, abbr: row.teamAbbr }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
      positions: [...new Set(all.map((row) => row.position).filter(Boolean))].sort(),
      statuses: INJURY_STATUSES.filter((status) => all.some((row) => row.status === status)),
    },
    fetchedAt: data.fetchedAt.toISOString(),
    refreshMinutes: INJURY_REFRESH_MINUTES,
    source: INJURY_SOURCE,
    stale: data.stale,
  };
}

interface HistoryRow { status: string; previous_status: string | null; injury_type: string | null; body_location: string | null; return_date: Date | null; comment: string | null; reported_at: Date; recorded_at: Date }

export async function getPlayerInjury(league: League, athleteId: string) {
  const data = await leagueData(league);
  let row = data.data.injuries.find((injury) => injury.athleteId === athleteId) ?? null;
  const history = await pool.query<HistoryRow>(
    `SELECT status, previous_status, injury_type, body_location, return_date, comment, reported_at, recorded_at FROM injury_history
     WHERE league=$1 AND athlete_id=$2 ORDER BY recorded_at DESC LIMIT 60`,
    [league, athleteId],
  ).then((result) => result.rows).catch(() => [] as HistoryRow[]);
  if (!row) {
    const stored = await pool.query<{ player_name: string; team_name: string }>("SELECT player_name, team_name FROM injuries WHERE league=$1 AND athlete_id=$2", [league, athleteId]).catch(() => null);
    if (!stored?.rows[0]) throw new NotFoundError("This player is not on the current injury report.");
  }
  const news = await cached(`injuries:news:${league}:${athleteId}`, 10 * 60_000, () => fetchAthleteNews(league, athleteId)).then((result) => result.data).catch(() => [] as AthleteNews[]);
  if (row) row = { ...row };
  const texts = [
    ...(row ? [{ text: `${row.shortComment} ${row.longComment}`, at: row.reportedAt }] : []),
    ...history.map((item) => ({ text: item.comment ?? "", at: item.reported_at.toISOString() })),
    ...news.map((item) => ({ text: `${item.headline} ${item.story ?? ""}`, at: item.published ?? "" })),
  ];
  // Past injuries: distinct injury types seen before the current one.
  const pastMap = new Map<string, { injury: string; firstSeen: string; lastSeen: string; statuses: string[] }>();
  for (const item of [...history].reverse()) {
    const key = item.injury_type ?? item.body_location ?? "Undisclosed";
    const entry = pastMap.get(key) ?? { injury: key, firstSeen: item.reported_at.toISOString(), lastSeen: item.reported_at.toISOString(), statuses: [] };
    entry.lastSeen = item.recorded_at.toISOString();
    if (!entry.statuses.includes(item.status)) entry.statuses.push(item.status);
    pastMap.set(key, entry);
  }
  const line = row && STATUS_WEIGHT[row.status] > 0 ? await lineImpact(league, { name: row.teamName, nickname: row.teamNickname }, row.reportedAt).catch(() => null) : null;
  return {
    league,
    injury: row,
    dateInjured: row?.firstReportedAt ?? history[history.length - 1]?.reported_at.toISOString() ?? null,
    timeline: history.map((item) => ({
      status: item.status, previousStatus: item.previous_status, injury: item.injury_type ?? item.body_location, returnDate: item.return_date ? item.return_date.toISOString().slice(0, 10) : null,
      comment: item.comment, reportedAt: item.reported_at.toISOString(), recordedAt: item.recorded_at.toISOString(),
    })),
    pastInjuries: [...pastMap.values()].filter((entry) => !row || entry.injury !== (row.injuryType ?? row.location ?? "Undisclosed")),
    news,
    practice: practiceNotes(texts),
    workload: workloadNotes(texts.map((item) => item.text)),
    line,
    historyNote: "History shows every status change SharpStats has recorded from the injury feed. It starts when tracking began for this player.",
    fetchedAt: data.fetchedAt.toISOString(),
    source: INJURY_SOURCE,
  };
}

export async function getTeamInjuries(league: League, teamId: string) {
  const data = await leagueData(league);
  const injuries = data.data.injuries.filter((row) => row.teamId === teamId);
  const health = data.data.teams.find((team) => team.teamId === teamId);
  if (!health) {
    const players = await seasonRows(league);
    const team = players.find((row) => row.teamId === teamId);
    if (!team) throw new NotFoundError("Team not found");
    return { league, team: { teamId, teamName: team.teamName, teamAbbr: team.teamAbbr, logo: null, score: 100, label: "Healthy" as const, active: 0, out: 0, questionable: 0, returning: 0, suspended: 0, keyOut: [] }, injuries: [], line: null, trend: [], fetchedAt: data.fetchedAt.toISOString() };
  }
  const key = injuries.filter((row) => UNAVAILABLE.includes(row.status)).sort((a, b) => b.impact.importance - a.impact.importance)[0];
  const line = key ? await lineImpact(league, { name: key.teamName, nickname: key.teamNickname }, key.reportedAt).catch(() => null) : null;
  const trend = await pool.query<{ health_score: number; recorded_at: Date }>(
    "SELECT health_score, recorded_at FROM team_health WHERE league=$1 AND team_id=$2 ORDER BY recorded_at DESC LIMIT 30", [league, teamId],
  ).then((result) => result.rows.reverse().map((row) => ({ score: row.health_score, at: row.recorded_at.toISOString() }))).catch(() => []);
  return {
    league,
    team: health,
    injuries: injuries.sort((a, b) => b.impact.projectedImpact - a.impact.projectedImpact),
    line,
    trend,
    fetchedAt: data.fetchedAt.toISOString(),
  };
}

/**
 * Key injuries for betting: unavailable or uncertain players with at least Moderate importance,
 * plus the spread movement on their team's next game since each report.
 */
export async function getInjuryImpact(league: League, options: { minImportance?: number; limit?: number } = {}) {
  const data = await leagueData(league);
  const min = options.minImportance ?? 30;
  const key = data.data.injuries
    .filter((row) => row.impact.importance >= min && STATUS_WEIGHT[row.status] >= 0.3)
    .sort((a, b) => b.impact.projectedImpact - a.impact.projectedImpact)
    .slice(0, options.limit ?? 25);
  const withLines = await Promise.all(key.map(async (row) => ({
    row,
    line: await cached(`injuries:line:${league}:${row.athleteId}:${row.reportedAt}`, 2 * 60_000, () => lineImpact(league, { name: row.teamName, nickname: row.teamNickname }, row.reportedAt))
      .then((result) => result.data).catch(() => null),
  })));
  void raiseLineAlerts(league, withLines.filter((item): item is { row: InjuryRow; line: LineImpact } => Boolean(item.line)));
  return {
    league,
    impacts: withLines.map(({ row, line }) => ({ injury: row, line })),
    fetchedAt: data.fetchedAt.toISOString(),
    source: INJURY_SOURCE,
  };
}

/** Keeps injury reports (and their status-change alerts) current even when nobody has the page open. */
export function startInjuryScheduler(): () => void {
  const leagues: League[] = ["nba", "nfl", "mlb", "nhl"];
  const run = () => {
    for (const league of leagues) void leagueData(league, true).catch((error: unknown) => console.warn("Injury refresh failed", league, error instanceof Error ? error.message : error));
  };
  const initial = setTimeout(run, 20_000);
  const interval = setInterval(run, REFRESH_MS);
  initial.unref?.();
  interval.unref?.();
  console.info(`Injury reports refresh every ${INJURY_REFRESH_MINUTES} minutes`);
  return () => { clearTimeout(initial); clearInterval(interval); };
}
