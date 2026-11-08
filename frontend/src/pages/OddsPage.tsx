import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Clock3, Download, RefreshCw, Star, Wifi, WifiOff, X } from "lucide-react";
import { api } from "../lib/api";
import type { Bet } from "../lib/types";
import type { AlertRule, AlertRuleInput, BookPrice, OddsAlert, OddsFavorite, OddsGame, OddsSport, PropRow, SearchResult, Selection, SportsbookRow } from "../lib/oddsTypes";
import { useOddsStream, type StreamState } from "../lib/useOddsStream";
import { american, pct, recommendedStake } from "../lib/oddsFormat";
import { downloadCsv, formatUpdated } from "../lib/statsFormat";
import { LoadingBlock, Segmented } from "../components/stats/StatsUi";
import { OddsDashboard } from "../components/odds/OddsDashboard";
import { EMPTY_ODDS_FILTERS, OddsFilters, type OddsFilterState } from "../components/odds/OddsFilters";
import { OddsSearch } from "../components/odds/OddsSearch";
import { boardRows, MarketBoard } from "../components/odds/MarketBoard";
import { BookComparison } from "../components/odds/BookComparison";
import { LineHistoryDrawer, MovementView } from "../components/odds/LineMovement";
import { ArbitrageScanner, EvScanner } from "../components/odds/Scanners";
import { EMPTY_PROP_FILTERS, PropResearch, type PropFilterState } from "../components/odds/PropResearch";
import { ALERT_LABELS, AlertsPanel } from "../components/odds/AlertsPanel";
import { ClvTracker } from "../components/odds/ClvTracker";
import { GameDrawer } from "../components/odds/GameDrawer";
import { bookName, Notice } from "../components/odds/OddsUi";

type Tab = "board" | "shop" | "ev" | "arbitrage" | "props" | "movement" | "alerts" | "clv";
const TABS: Array<{ value: Tab; label: string }> = [
  { value: "board", label: "Market board" }, { value: "shop", label: "Line shopping" }, { value: "ev", label: "+EV scanner" },
  { value: "arbitrage", label: "Arbitrage" }, { value: "props", label: "Player props" }, { value: "movement", label: "Line movement" },
  { value: "alerts", label: "Alerts" }, { value: "clv", label: "CLV tracker" },
];
const SPORTS: Array<{ value: OddsSport; label: string }> = [{ value: "nba", label: "NBA" }, { value: "nfl", label: "NFL" }, { value: "mlb", label: "MLB" }, { value: "nhl", label: "NHL" }];
const SPORT_KEY = "sharpstats_odds_sport";
const POLL_MS = 30_000;

function storedSport(): OddsSport {
  try {
    const value = localStorage.getItem(SPORT_KEY);
    return value === "nba" || value === "nfl" || value === "mlb" || value === "nhl" ? value : "nba";
  } catch {
    return "nba";
  }
}

function betType(selection: Selection): Bet["bet_type"] {
  if (selection.category === "prop") return "Player Props";
  if (selection.type === "spread") return "Spread";
  if (selection.type === "total" || selection.type === "team_total") return "Over/Under";
  if (selection.type === "moneyline") return "Moneyline";
  return "Other";
}

function matchesRule(rule: AlertRule, alert: OddsAlert): boolean {
  if (!rule.active || rule.type !== alert.type) return false;
  if (rule.sport && rule.sport !== alert.sport) return false;
  if (rule.market && rule.market !== alert.market) return false;
  if (rule.book && alert.book && rule.book !== alert.book) return false;
  if (rule.query && !`${alert.title} ${alert.message} ${alert.game}`.toLowerCase().includes(rule.query.toLowerCase())) return false;
  if (rule.minValue !== null && (alert.value === null || Math.abs(alert.value) < rule.minValue)) return false;
  return true;
}

function ConnectionPill({ state, polling }: { state: StreamState; polling: boolean }) {
  const live = state === "live";
  const label = live ? "Live stream" : state === "connecting" ? "Connecting…" : state === "reconnecting" ? "Reconnecting…" : polling ? "Polling" : "Offline";
  return (
    <span className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[11px] ${live ? "border-[#34412a] text-lime" : "border-line text-amber-300"}`} title="Connection status">
      {live ? <Wifi size={13} /> : <WifiOff size={13} />}{label}
    </span>
  );
}

export function OddsPage({ onLog }: { onLog: (draft: Partial<Bet>) => void }) {
  const queryClient = useQueryClient();
  const [sport, setSportState] = useState<OddsSport>(storedSport);
  const [tab, setTab] = useState<Tab>("board");
  const [filters, setFilters] = useState<OddsFilterState>(EMPTY_ODDS_FILTERS);
  const [search, setSearch] = useState("");
  const [historyFor, setHistoryFor] = useState<Selection | null>(null);
  const [gameFor, setGameFor] = useState<string | null>(null);
  const [propFilters, setPropFilters] = useState<PropFilterState>(EMPTY_PROP_FILTERS);
  const [arbTotal, setArbTotal] = useState(100);
  const [alertsMine, setAlertsMine] = useState(false);
  const [toasts, setToasts] = useState<OddsAlert[]>([]);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSport = (next: OddsSport) => {
    setSportState(next);
    setFilters(EMPTY_ODDS_FILTERS);
    setPropFilters(EMPTY_PROP_FILTERS);
    setSearch("");
    try { localStorage.setItem(SPORT_KEY, next); } catch { /* storage unavailable */ }
  };

  const boardParams = useMemo(() => ({
    sport, category: filters.market ? undefined : filters.category, market: filters.market || undefined, book: filters.book || undefined,
    date: filters.date || undefined, q: search.trim().length >= 2 ? search.trim() : undefined,
    evOnly: filters.evOnly, arbOnly: filters.arbOnly, live: filters.live, pregame: filters.pregame,
  }), [filters, search, sport]);

  const board = useQuery({
    queryKey: ["odds-board", boardParams],
    queryFn: () => api.oddsBoard(boardParams),
    refetchInterval: POLL_MS,
    placeholderData: (previous) => previous?.sport === sport ? previous : undefined,
  });
  const data = board.data?.sport === sport ? board.data : undefined;
  const keyless = data?.status.mode === "espn";

  const sportsbooks = useQuery({ queryKey: ["odds-sportsbooks"], queryFn: api.oddsSportsbooks, staleTime: 60_000 });
  const favorites = useQuery({ queryKey: ["odds-favorites"], queryFn: api.oddsFavorites });
  const movement = useQuery({ queryKey: ["odds-movement", sport], queryFn: () => api.oddsMovement(sport), enabled: tab === "movement", refetchInterval: POLL_MS });
  const ev = useQuery({ queryKey: ["odds-ev", sport], queryFn: () => api.oddsEv(sport), enabled: tab === "ev", refetchInterval: POLL_MS });
  const arbitrage = useQuery({ queryKey: ["odds-arbitrage", sport, arbTotal], queryFn: () => api.oddsArbitrage(sport, arbTotal), enabled: tab === "arbitrage", refetchInterval: POLL_MS, placeholderData: keepPreviousData });
  const propParams = useMemo(() => ({
    sport, gameId: propFilters.gameId || undefined, market: propFilters.market || undefined, player: propFilters.player.trim() || undefined,
    team: propFilters.team.trim() || undefined, book: propFilters.book || undefined, date: propFilters.date || undefined, type: propFilters.type || undefined,
  }), [propFilters, sport]);
  const props = useQuery({ queryKey: ["odds-props", propParams], queryFn: () => api.oddsProps(propParams), enabled: tab === "props", refetchInterval: POLL_MS * 2, placeholderData: keepPreviousData });
  const alerts = useQuery({ queryKey: ["odds-alerts", sport, alertsMine], queryFn: () => api.oddsAlerts({ sport, mine: alertsMine }), refetchInterval: 60_000 });
  const clv = useQuery({ queryKey: ["odds-clv"], queryFn: api.oddsClv, enabled: tab === "clv", refetchInterval: 60_000 });

  const games = useMemo(() => new Map<string, OddsGame>((data?.games ?? []).map((game) => [game.id, game])), [data]);
  const books = data?.books ?? [];
  const rules = alerts.data?.rules ?? [];
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const stream = useOddsStream(sport, {
    onUpdate: () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
      invalidateTimer.current = setTimeout(() => {
        for (const key of ["odds-board", "odds-movement", "odds-ev", "odds-arbitrage", "odds-props", "odds-history", "odds-game"]) void queryClient.invalidateQueries({ queryKey: [key] });
      }, 800);
    },
    onAlerts: (incoming) => {
      void queryClient.invalidateQueries({ queryKey: ["odds-alerts"] });
      const notify = incoming.filter((alert) => alert.severity === "high" || rulesRef.current.some((rule) => matchesRule(rule, alert)));
      if (notify.length) setToasts((current) => [...notify.slice(0, 3), ...current].slice(0, 3));
    },
  });

  useEffect(() => { if (!toasts.length) return; const timer = setTimeout(() => setToasts((current) => current.slice(0, -1)), 9000); return () => clearTimeout(timer); }, [toasts]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 5000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => () => { if (invalidateTimer.current) clearTimeout(invalidateTimer.current); }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await api.oddsRefresh(sport);
      for (const key of ["odds-board", "odds-movement", "odds-ev", "odds-arbitrage", "odds-props", "odds-alerts"]) await queryClient.invalidateQueries({ queryKey: [key] });
      setMessage("Odds refreshed from the provider.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const openSelection = useCallback((selectionId: string) => {
    const selection = data?.selections.find((item) => item.id === selectionId);
    if (selection) { setHistoryFor(selection); return; }
    // Not in the current board filter (e.g. a prop): open with minimal info; the drawer loads live data.
    const [gameId = "", market = "", participant = "", side = ""] = selectionId.split("|");
    setHistoryFor({
      id: selectionId, pairId: "", gameId, sport, market, marketLabel: data?.markets.find((item) => item.key === market)?.label ?? market,
      category: "game", type: "moneyline", period: "game", selection: side, participant, point: null,
      label: participant ? `${participant} ${side}` : side, books: [], best: null, worst: null, average: null, fair: null, ev: null, edge: null, kelly: null,
      tier: null, risk: null, confidence: null, arbitrage: null, signals: { steam: false, sharp: false, reverse: false, moves: 0, lastMoveAt: null }, updatedAt: "",
    });
  }, [data, sport]);

  function track(selection: Selection, price: BookPrice) {
    const game = games.get(selection.gameId);
    onLog({
      sport: sport.toUpperCase(), league: sport.toUpperCase(), event: game?.label ?? "", bet_type: betType(selection),
      team_player: selection.participant || selection.selection, selection: selection.selection, odds: Math.round(price.decimal * 1000) / 1000,
      sportsbook: bookName(books, price.book), market_key: selection.market, line_value: price.point, event_id: selection.gameId,
    });
  }

  function pickSearch(result: SearchResult) {
    if (result.sport && result.sport !== sport) setSport(result.sport);
    setSearch("");
    if (result.kind === "game" || result.kind === "team") { if (result.gameId) setGameFor(result.gameId); return; }
    if (result.kind === "player" || result.kind === "prop") {
      setTab("props");
      setPropFilters({ ...EMPTY_PROP_FILTERS, player: result.kind === "player" ? result.label : result.label.split(" ").slice(0, 2).join(" "), market: result.market ?? "", gameId: result.gameId ?? "" });
      return;
    }
    if (result.kind === "market" && result.market) {
      const market = data?.markets.find((item) => item.key === result.market);
      if (market?.category === "prop") { setTab("props"); setPropFilters({ ...EMPTY_PROP_FILTERS, market: market.key }); return; }
      setFilters({ ...EMPTY_ODDS_FILTERS, category: market?.category ?? "all", market: result.market });
      setTab("board");
      return;
    }
    if (result.kind === "sportsbook" && result.book) { setFilters({ ...filters, book: result.book }); setTab("shop"); }
  }

  async function toggleFavoriteBook(book: SportsbookRow) {
    if (book.id === null) return;
    queryClient.setQueryData(["odds-sportsbooks"], (current: { mode: string; sportsbooks: SportsbookRow[] } | undefined) => current ? { ...current, sportsbooks: current.sportsbooks.map((item) => item.key === book.key ? { ...item, favorite: !book.favorite } : item) } : current);
    try { await api.favorite(book.id, !book.favorite); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update favorite"); }
    void queryClient.invalidateQueries({ queryKey: ["odds-sportsbooks"] });
  }

  async function toggleFavorite(favorite: OddsFavorite, enabled: boolean) {
    queryClient.setQueryData(["odds-favorites"], (current: { favorites: OddsFavorite[] } | undefined) => ({
      favorites: enabled ? [favorite, ...(current?.favorites ?? [])] : (current?.favorites ?? []).filter((item) => !(item.kind === favorite.kind && item.itemKey === favorite.itemKey)),
    }));
    try { await api.setOddsFavorite(favorite, enabled); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update favorite"); }
    void queryClient.invalidateQueries({ queryKey: ["odds-favorites"] });
  }

  const favoriteMarkets = (favorites.data?.favorites ?? []).filter((item) => item.kind === "market" && item.sport === sport);
  const currentMarketFavorite = filters.market ? favoriteMarkets.some((item) => item.itemKey === `${sport}:${filters.market}`) : false;

  function exportCsv() {
    const stamp = `${sport}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`;
    if (tab === "ev" && ev.data) {
      downloadCsv(`sharpstats-ev-${stamp}.csv`, ["Game", "Market", "Selection", "Sportsbook", "Odds", "Implied", "No-vig", "Fair odds", "EV %", "Edge %", "Kelly %", "Stake", "Risk", "Rating"],
        ev.data.rows.map((row) => [row.game, row.marketLabel, row.label, bookName(books, row.book), american(row.american), pct(row.implied), pct(row.noVigProbability), american(row.fairAmerican), pct(row.ev, 2), pct(row.edge), pct(Math.min(ev.data!.sizing.maxStakeFraction, row.kelly * ev.data!.sizing.kellyMultiplier), 2), recommendedStake(row.kelly, ev.data!.sizing) ?? "", row.risk ?? "", row.tier]));
      return;
    }
    if (tab === "arbitrage" && arbitrage.data) {
      downloadCsv(`sharpstats-arbitrage-${stamp}.csv`, ["Game", "Market", "Profit %", "Leg", "Sportsbook", "Odds", "Stake", "Payout"],
        arbitrage.data.opportunities.flatMap((item) => item.legs.map((leg, index) => [item.game, item.marketLabel, pct(item.profitPct, 2), leg.label, bookName(books, leg.book), american(leg.american), item.stakes[index]?.stake ?? "", item.stakes[index]?.payout ?? ""])));
      return;
    }
    if (tab === "props" && props.data) {
      const rate = (value: { rate: number | null } | undefined) => value?.rate === null || value?.rate === undefined ? "" : pct(value.rate, 0);
      downloadCsv(`sharpstats-props-${stamp}.csv`, ["Player", "Game", "Market", "Line", "Best over", "Over book", "Best under", "Under book", "Open line", "L5", "L10", "Season", "Home", "Away", "Vs opponent", "Avg L10"],
        props.data.rows.map((row) => [row.player, row.game, row.marketLabel, row.line ?? "", american(row.over?.best?.american), row.over?.best ? bookName(books, row.over.best.book) : "", american(row.under?.best?.american), row.under?.best ? bookName(books, row.under.best.book) : "", row.openLine ?? "", rate(row.research?.l5), rate(row.research?.l10), rate(row.research?.season), rate(row.research?.home), rate(row.research?.away), rate(row.research?.vsOpponent), row.research?.averageL10 ?? ""]));
      return;
    }
    if (!data) return;
    const rows = boardRows(data.selections, games, "all", filters.book);
    downloadCsv(`sharpstats-odds-${stamp}.csv`, ["Game", "Start", "Market", "Selection", "Sportsbook", "Line", "Current odds", "Opening odds", "Best odds", "Market average", "Implied", "Model", "EV %", "Arbitrage %", "Kelly", "Stake", "Last updated"],
      rows.map(({ selection, price, game }) => [game?.label ?? "", game?.commenceTime ?? "", selection.marketLabel, selection.label, bookName(books, price.book), price.point ?? "", american(price.american), american(price.open?.american), american(selection.best?.american), american(selection.average?.american), pct(price.implied), selection.fair ? pct(selection.fair.probability) : "", price.ev === null ? "" : pct(price.ev, 2), selection.arbitrage === null ? "" : pct(selection.arbitrage, 2), price.kelly ?? "", recommendedStake(price.kelly, data.sizing) ?? "", price.lastChangeAt ?? price.lastSeenAt]));
  }

  const status = data?.status;
  const credits = status?.credits?.remaining;

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">RESEARCH</p>
          <h2 className="font-display text-2xl font-extrabold">Odds screen</h2>
          <p className="mt-1.5 text-sm text-muted">Real-time prices, line movement, +EV and arbitrage across every connected sportsbook.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionPill state={stream.state} polling />
          <span className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[11px] ${status?.connected ? "border-line text-muted" : "border-rose-500/40 text-rose-300"}`} title={status?.lastError ?? status?.label}>
            <span className={`h-1.5 w-1.5 rounded-full ${status?.connected ? "bg-lime shadow-[0_0_8px_#c5f467]" : "bg-rose-400"}`} />
            API: <span className="text-white">{status ? status.label : "—"}</span>{credits !== null && credits !== undefined ? <span className="text-muted">· {credits.toLocaleString()} credits</span> : null}
          </span>
          <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-[11px] text-muted">
            <Clock3 size={13} className="text-lime" />Last Updated: <span className="text-white">{formatUpdated(data?.metrics.lastUpdate ?? undefined)}</span>
          </span>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white disabled:opacity-60">
            <RefreshCw size={14} className={refreshing ? "animate-spin text-lime" : ""} />Refresh
          </button>
          <button type="button" onClick={exportCsv} disabled={!data} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white disabled:opacity-60">
            <Download size={14} />Export CSV
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="League" value={sport} onChange={setSport} options={SPORTS} />
        <OddsSearch value={search} onChange={setSearch} onPick={pickSearch} />
      </div>
      {tab !== "props" && tab !== "alerts" && tab !== "clv" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <OddsFilters value={filters} onChange={setFilters} markets={data?.markets ?? []} books={books} keyless={keyless} />
          {filters.market && (
            <button type="button" onClick={() => void toggleFavorite({ kind: "market", itemKey: `${sport}:${filters.market}`, label: data?.markets.find((item) => item.key === filters.market)?.label ?? filters.market, sport }, !currentMarketFavorite)}
              aria-pressed={currentMarketFavorite} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-[11px] ${currentMarketFavorite ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
              <Star size={11} className={currentMarketFavorite ? "fill-lime" : ""} />{currentMarketFavorite ? "Favorite market" : "Save market"}
            </button>
          )}
        </div>
      )}
      {favoriteMarkets.length > 0 && tab !== "props" && tab !== "alerts" && tab !== "clv" && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold tracking-wider text-[#738087]">FAVORITE MARKETS</span>
          {favoriteMarkets.map((item) => {
            const key = item.itemKey.split(":")[1] ?? "";
            const market = data?.markets.find((entry) => entry.key === key);
            return (
              <span key={item.itemKey} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] ${filters.market === key ? "border-lime text-lime" : "border-line text-[#d9e0dc]"}`}>
                <button type="button" onClick={() => setFilters({ ...EMPTY_ODDS_FILTERS, category: market?.category ?? "all", market: key })}>{item.label}</button>
                <button type="button" aria-label={`Remove ${item.label} from favorites`} onClick={() => void toggleFavorite(item, false)} className="text-muted hover:text-white"><X size={10} /></button>
              </span>
            );
          })}
        </div>
      )}

      {message && <div className="mb-4"><Notice>{message}</Notice></div>}
      {status?.warning && <div className="mb-4"><Notice tone="warn">{status.warning}</Notice></div>}
      {status && keyless && !status.warning && status.notes.some((note) => note.startsWith("Keyless")) && <div className="mb-4"><Notice tone="warn">{status.notes.find((note) => note.startsWith("Keyless"))}</Notice></div>}
      {status?.lastError && <div className="mb-4"><Notice tone="error">Provider issue: {status.lastError}. Showing the last good snapshot.</Notice></div>}
      {status?.pacing ? <div className="mb-4"><Notice tone="info">{status.notes.find((note) => note.startsWith("Credit pacing"))}</Notice></div>
        : status?.throttled && <div className="mb-4"><Notice tone="warn">{status.notes.find((note) => note.includes("credits"))}</Notice></div>}

      {board.isLoading && !data ? <LoadingBlock label="Loading live sportsbook odds…" /> : board.error && !data ? (
        <Notice tone="error">{board.error instanceof Error ? board.error.message : "Could not load odds."}</Notice>
      ) : data ? (
        <>
          <OddsDashboard metrics={data.metrics} books={books} onOpen={(next) => setTab(next)} />
          <div className="mb-4 overflow-x-auto"><Segmented label="Odds views" value={tab} onChange={setTab} options={TABS.map((item) => item.value === "alerts" && alerts.data?.alerts.length ? { ...item, label: `Alerts (${alerts.data.alerts.length})` } : item)} /></div>
          {tab === "board" && <MarketBoard selections={data.selections} games={games} books={books} sizing={data.sizing} bookFilter={filters.book} onHistory={setHistoryFor} onTrack={track} onGame={setGameFor} />}
          {tab === "shop" && <BookComparison selections={data.selections} games={games} books={books} sportsbooks={sportsbooks.data?.sportsbooks} onToggleFavoriteBook={(book) => void toggleFavoriteBook(book)} onHistory={setHistoryFor} onGame={setGameFor} />}
          {tab === "ev" && <EvScanner data={ev.data?.sport === sport ? ev.data : undefined} books={books} loading={ev.isLoading} keyless={keyless} onOpen={openSelection} />}
          {tab === "arbitrage" && <ArbitrageScanner data={arbitrage.data?.sport === sport ? arbitrage.data : undefined} books={books} loading={arbitrage.isLoading} keyless={keyless} total={arbTotal} onTotal={setArbTotal} onOpen={openSelection} />}
          {tab === "props" && (
            <PropResearch data={props.data?.sport === sport ? props.data : undefined} loading={props.isLoading || props.isFetching && !props.data} filters={propFilters} onFilters={setPropFilters} books={books}
              favorites={favorites.data?.favorites ?? []}
              onFavorite={(row: PropRow, enabled) => void toggleFavorite({ kind: "prop", itemKey: row.id, label: `${row.player} · ${row.marketLabel}`, sport }, enabled)}
              onOpen={openSelection} />
          )}
          {tab === "movement" && <MovementView data={movement.data?.sport === sport ? movement.data : undefined} books={books} loading={movement.isLoading} onOpen={openSelection} />}
          {tab === "alerts" && (
            <AlertsPanel alerts={alerts.data?.alerts ?? []} rules={rules} sport={sport} markets={data.markets} books={books} mine={alertsMine} onMine={setAlertsMine}
              onCreate={async (rule: AlertRuleInput) => { await api.createAlertRule(rule); await queryClient.invalidateQueries({ queryKey: ["odds-alerts"] }); setMessage("Alert rule created."); }}
              onToggle={(rule) => void api.updateAlertRule(rule.id, !rule.active).then(() => queryClient.invalidateQueries({ queryKey: ["odds-alerts"] })).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not update rule"))}
              onDelete={(rule) => void api.deleteAlertRule(rule.id).then(() => queryClient.invalidateQueries({ queryKey: ["odds-alerts"] })).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not delete rule"))}
              onOpen={(alert) => { if (alert.sideId) openSelection(alert.sideId); else setGameFor(alert.gameId); }} />
          )}
          {tab === "clv" && <ClvTracker data={clv.data} loading={clv.isLoading} />}
          <p className="mt-4 text-[10px] text-muted">Source: {data.status.label}. {data.status.notes.filter((note) => !note.startsWith("Keyless") && !note.startsWith("Credit pacing") && note !== data.status.warning).join(" ")} Odds are informational; confirm prices with the sportsbook before wagering.</p>
        </>
      ) : null}

      {historyFor && <LineHistoryDrawer sport={sport} selection={historyFor} books={books} onClose={() => setHistoryFor(null)} />}
      {gameFor && <GameDrawer sport={sport} gameId={gameFor} books={books} keyless={keyless} onClose={() => setGameFor(null)} onHistory={(selection) => { setHistoryFor(selection); }} />}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
          {toasts.map((alert) => (
            <div key={alert.id} className="rounded-xl border border-lime/40 bg-panel p-3 shadow-2xl">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => { setTab("alerts"); setToasts((current) => current.filter((item) => item.id !== alert.id)); }} className="min-w-0 text-left">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-lime"><Bell size={11} />{ALERT_LABELS[alert.type]}</p>
                  <p className="mt-1 truncate text-xs font-semibold text-white">{alert.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{alert.message}</p>
                </button>
                <button type="button" aria-label="Dismiss alert" onClick={() => setToasts((current) => current.filter((item) => item.id !== alert.id))} className="text-muted hover:text-white"><X size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
