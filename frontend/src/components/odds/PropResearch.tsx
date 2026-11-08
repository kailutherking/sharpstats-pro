import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Star } from "lucide-react";
import type { BookInfo, HitRateWindow, OddsFavorite, PropRow, PropsData } from "../../lib/oddsTypes";
import { american, bookShort, signedPct, startTime } from "../../lib/oddsFormat";
import { Avatar, EmptyState, inputClass, LoadingBlock, Panel, thClass } from "../stats/StatsUi";
import { BookTag, LiveDot, Notice, SignalBadges, TierBadge } from "./OddsUi";

export interface PropFilterState { gameId: string; market: string; player: string; team: string; book: string; date: string; type: "" | "ou" | "yes"; favoritesOnly: boolean }
export const EMPTY_PROP_FILTERS: PropFilterState = { gameId: "", market: "", player: "", team: "", book: "", date: "", type: "", favoritesOnly: false };

function Rate({ window: value }: { window: HitRateWindow | undefined }) {
  if (!value || value.rate === null) return <span className="text-[#4d595e]">—</span>;
  const tone = value.rate >= 0.7 ? "text-lime" : value.rate >= 0.5 ? "text-[#d9e0dc]" : value.rate >= 0.3 ? "text-amber-300" : "text-rose-400";
  return <span className={`tabular-nums ${tone}`} title={`${value.hits}/${value.games} games over the line`}>{Math.round(value.rate * 100)}%<span className="ml-1 text-[9px] text-muted">{value.hits}/{value.games}</span></span>;
}

function Side({ side, books }: { side: PropRow["over"]; books: BookInfo[] }) {
  if (!side) return <span className="text-[#4d595e]">—</span>;
  const best = side.best;
  const dfs = side.books.filter((price) => !price.priced);
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-semibold tabular-nums text-lime">{best ? american(best.american) : "—"}{best && <span className="ml-1 text-[9px] font-normal text-muted">{bookShort(best.book)}</span>}</span>
      {side.ev !== null && <span className={`text-[10px] tabular-nums ${side.ev > 0 ? "text-lime" : "text-muted"}`}>EV {signedPct(side.ev)}</span>}
      {dfs.length > 0 && <span className="text-[9px] text-sky-300" title={dfs.map((price) => books.find((book) => book.key === price.book)?.name).join(", ")}>{dfs.map((price) => `${bookShort(price.book)} ${price.point ?? ""}`).join(" · ")}</span>}
    </span>
  );
}

export function PropResearch({ data, loading, filters, onFilters, books, favorites, onFavorite, onOpen }: {
  data: PropsData | undefined;
  loading: boolean;
  filters: PropFilterState;
  onFilters: (value: PropFilterState) => void;
  books: BookInfo[];
  favorites: OddsFavorite[];
  onFavorite: (row: PropRow, enabled: boolean) => void;
  onOpen: (selectionId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(80);
  const favoriteKeys = useMemo(() => new Set(favorites.filter((item) => item.kind === "prop").map((item) => item.itemKey)), [favorites]);
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => !filters.favoritesOnly || favoriteKeys.has(row.id)), [data, favoriteKeys, filters.favoritesOnly]);
  const set = (patch: Partial<PropFilterState>) => onFilters({ ...filters, ...patch });

  return (
    <div className="space-y-4">
      {data?.requiresApiKey && <Notice tone="warn">Player props come from The Odds API (DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, PrizePicks and Underdog). Add <code className="text-white">ODDS_API_KEY</code> to the server environment to load prop lines; hit rates use the same game logs as the Stats section.</Notice>}
      {data?.status.lastError && !data.requiresApiKey && <Notice tone="error">Prop provider error: {data.status.lastError}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Prop market" value={filters.market || data?.market || ""} onChange={(event) => set({ market: event.target.value })} className={inputClass}>
          {(data?.markets ?? []).map((market) => <option key={market.key} value={market.key} disabled={!market.available}>{market.label}{market.available ? "" : " — not offered"}</option>)}
        </select>
        <select aria-label="Game" value={filters.gameId} onChange={(event) => set({ gameId: event.target.value })} className={inputClass}>
          <option value="">All games (next 36h)</option>
          {(data?.games ?? []).map((game) => <option key={game.id} value={game.id}>{game.label}</option>)}
        </select>
        <input aria-label="Player" value={filters.player} onChange={(event) => set({ player: event.target.value })} placeholder="Player" className={`${inputClass} w-32`} />
        <input aria-label="Team" value={filters.team} onChange={(event) => set({ team: event.target.value })} placeholder="Team" className={`${inputClass} w-28`} />
        <select aria-label="Sportsbook" value={filters.book} onChange={(event) => set({ book: event.target.value })} className={inputClass}>
          <option value="">All sportsbooks</option>
          {books.filter((book) => !book.retired && book.kind !== "reference").map((book) => <option key={book.key} value={book.key}>{book.name}</option>)}
        </select>
        <input aria-label="Date" type="date" value={filters.date} onChange={(event) => set({ date: event.target.value })} className={`${inputClass} text-muted`} />
        <select aria-label="Prop type" value={filters.type} onChange={(event) => set({ type: event.target.value as PropFilterState["type"] })} className={inputClass}>
          <option value="">All prop types</option><option value="ou">Over / Under</option><option value="yes">Yes / No (TD, double-double…)</option>
        </select>
        <button type="button" aria-pressed={filters.favoritesOnly} onClick={() => set({ favoritesOnly: !filters.favoritesOnly })} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-[11px] ${filters.favoritesOnly ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}><Star size={11} className={filters.favoritesOnly ? "fill-lime" : ""} />Favorite props</button>
      </div>
      {loading && !data ? <LoadingBlock label="Loading prop lines and hit rates…" /> : (
        <Panel title="Player prop screener" subtitle={data ? `${rows.length} props · hit rates vs the current line for the first ${data.research.limit} rows (${data.research.researched} matched to game logs)` : undefined} flush>
          {!rows.length ? <EmptyState>{data?.requiresApiKey ? "Prop lines load once ODDS_API_KEY is configured." : "No props posted for these filters yet."}</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1360px] text-left">
                <thead><tr className={thClass}>
                  <th className="w-8 px-3 py-3" /><th className="px-3 py-3">PLAYER</th><th className="px-3 py-3">MARKET</th><th className="px-3 py-3 text-right">LINE</th>
                  <th className="px-3 py-3 text-right">OVER</th><th className="px-3 py-3 text-right">UNDER</th><th className="px-3 py-3 text-right">LINE MOVE</th>
                  <th className="px-3 py-3 text-right">L5</th><th className="px-3 py-3 text-right">L10</th><th className="px-3 py-3 text-right">SEASON</th>
                  <th className="px-3 py-3 text-right">HOME</th><th className="px-3 py-3 text-right">AWAY</th><th className="px-3 py-3 text-right">VS OPP</th><th className="px-3 py-3 text-right">AVG L10</th><th className="px-4 py-3" />
                </tr></thead>
                <tbody>
                  {rows.slice(0, limit).map((row) => {
                    const isOpen = expanded === row.id;
                    const favorite = favoriteKeys.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-t border-line text-xs hover:bg-white/[0.015]">
                          <td className="px-3 py-2.5"><button type="button" aria-label={isOpen ? "Collapse" : "Expand"} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : row.id)} className="text-muted hover:text-white">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                          <td className="px-3 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <Avatar src={row.research?.headshot} name={row.player} size={28} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-white">{row.player}</span>
                                <span className="flex items-center gap-1.5 truncate text-[10px] text-muted">{row.research ? `${row.research.team}${row.research.opponent ? ` vs ${row.research.opponent}` : ""} · ` : ""}{row.commenceTime ? startTime(row.commenceTime) : row.game}<LiveDot live={row.status === "live"} /></span>
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[#d9e0dc]"><span className="flex items-center gap-1.5">{row.marketLabel}<TierBadge tier={row.over?.tier ?? row.under?.tier ?? null} /><SignalBadges signals={row.over?.signals ?? row.under?.signals ?? { steam: false, sharp: false, reverse: false, moves: 0, lastMoveAt: null }} /></span></td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-white">{row.type === "prop_yes" ? "Yes" : row.line ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right"><Side side={row.over} books={books} /></td>
                          <td className="px-3 py-2.5 text-right"><Side side={row.under} books={books} /></td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{row.openLine !== null && row.lineMove ? <span className={row.lineMove > 0 ? "text-lime" : "text-rose-400"}>{row.openLine} → {row.line}</span> : <span className="text-muted">{row.openLine !== null ? "No move" : "—"}</span>}</td>
                          <td className="px-3 py-2.5 text-right"><Rate window={row.research?.l5} /></td>
                          <td className="px-3 py-2.5 text-right"><Rate window={row.research?.l10} /></td>
                          <td className="px-3 py-2.5 text-right"><Rate window={row.research?.season} /></td>
                          <td className="px-3 py-2.5 text-right"><Rate window={row.research?.home} /></td>
                          <td className="px-3 py-2.5 text-right"><Rate window={row.research?.away} /></td>
                          <td className="px-3 py-2.5 text-right"><Rate window={row.research?.vsOpponent} /></td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{row.research?.averageL10 ?? "—"}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button type="button" onClick={() => onFavorite(row, !favorite)} aria-pressed={favorite} aria-label={favorite ? `Remove ${row.player} ${row.marketLabel} from favorites` : `Add ${row.player} ${row.marketLabel} to favorites`} className={`rounded-md p-1 ${favorite ? "text-lime" : "text-[#4d595e] hover:text-white"}`}><Star size={14} className={favorite ? "fill-lime" : ""} /></button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-[#0e1416] text-xs">
                            <td />
                            <td colSpan={14} className="px-3 py-3">
                              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                                <div>
                                  <p className="mb-2 text-[10px] font-semibold tracking-wider text-[#738087]">PRICES BY SPORTSBOOK</p>
                                  <div className="flex flex-wrap gap-2">
                                    {[...new Set([...(row.over?.books ?? []), ...(row.under?.books ?? [])].map((price) => price.book))].map((book) => {
                                      const over = row.over?.books.find((price) => price.book === book);
                                      const under = row.under?.books.find((price) => price.book === book);
                                      return (
                                        <div key={book} className="rounded-lg border border-line bg-panel px-3 py-2">
                                          <BookTag book={book} books={books} />
                                          <p className="mt-1 tabular-nums text-[11px] text-[#d9e0dc]">{(over ?? under)?.point ?? ""} · <span className={over?.isBest ? "text-lime" : ""}>O {american(over?.american)}</span> / <span className={under?.isBest ? "text-lime" : ""}>U {american(under?.american)}</span></p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="mt-3 flex gap-2">
                                    {row.over && <button type="button" onClick={() => onOpen(row.over!.selectionId)} className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted hover:border-lime hover:text-lime">Over line history</button>}
                                    {row.under && <button type="button" onClick={() => onOpen(row.under!.selectionId)} className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted hover:border-lime hover:text-lime">Under line history</button>}
                                  </div>
                                </div>
                                <div>
                                  <p className="mb-2 text-[10px] font-semibold tracking-wider text-[#738087]">LAST {row.research?.recent.length ?? 0} GAMES (NEWEST FIRST) VS LINE {row.line ?? ""}</p>
                                  {row.research?.recent.length ? (
                                    <div className="flex h-24 items-end gap-1.5">
                                      {row.research.recent.map((value, index) => {
                                        const max = Math.max(...row.research!.recent, row.line ?? 0, 1);
                                        const hit = row.line !== null && value > row.line;
                                        return (
                                          <div key={index} className="flex flex-1 flex-col items-center justify-end gap-1" title={String(value)}>
                                            <span className="text-[9px] tabular-nums text-muted">{value}</span>
                                            <div className={`w-full rounded-t ${hit ? "bg-lime/80" : "bg-rose-400/50"}`} style={{ height: `${Math.max(4, (value / max) * 64)}px` }} />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : <p className="text-[11px] text-muted">No matching game log for this player.</p>}
                                  {row.research && <p className="mt-2 text-[10px] text-muted">Season average {row.research.averageSeason ?? "—"} · L10 average {row.research.averageL10 ?? "—"}</p>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > limit && <div className="border-t border-line p-3 text-center"><button type="button" onClick={() => setLimit((value) => value + 80)} className="text-[11px] font-semibold text-lime">Show more ({rows.length - limit} remaining)</button></div>}
        </Panel>
      )}
    </div>
  );
}
