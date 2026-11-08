import type { BookInfo, MarketCategory, MarketInfo } from "../../lib/oddsTypes";
import { inputClass } from "../stats/StatsUi";

export interface OddsFilterState {
  category: MarketCategory | "all";
  market: string;
  book: string;
  date: string;
  evOnly: boolean;
  arbOnly: boolean;
  live: boolean;
  pregame: boolean;
}

export const EMPTY_ODDS_FILTERS: OddsFilterState = { category: "game", market: "", book: "", date: "", evOnly: false, arbOnly: false, live: false, pregame: false };

const CATEGORY_LABELS: Record<MarketCategory | "all", string> = {
  all: "All market types",
  game: "Game lines",
  period: "Halves, quarters & periods",
  team: "Team totals",
  alternate: "Alternate lines",
  prop: "Player props",
};

function Toggle({ label, active, onChange }: { label: string; active: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={() => onChange(!active)}
      className={`rounded-lg border px-3 py-2 text-[11px] font-medium transition ${active ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
      {label}
    </button>
  );
}

export function OddsFilters({ value, onChange, markets, books, keyless }: { value: OddsFilterState; onChange: (value: OddsFilterState) => void; markets: MarketInfo[]; books: BookInfo[]; keyless: boolean }) {
  const set = (patch: Partial<OddsFilterState>) => onChange({ ...value, ...patch });
  const categoryMarkets = markets.filter((market) => value.category === "all" || market.category === value.category);
  const activeCount = [value.market, value.book, value.date, value.evOnly, value.arbOnly, value.live, value.pregame, value.category !== "game"].filter(Boolean).length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Market type" value={value.category} onChange={(event) => set({ category: event.target.value as OddsFilterState["category"], market: "" })} className={inputClass}>
        {(Object.keys(CATEGORY_LABELS) as Array<MarketCategory | "all">).map((key) => (
          <option key={key} value={key} disabled={keyless && key !== "game" && key !== "all"}>{CATEGORY_LABELS[key]}{keyless && key !== "game" && key !== "all" ? " (API key)" : ""}</option>
        ))}
      </select>
      <select aria-label="Market" value={value.market} onChange={(event) => set({ market: event.target.value })} className={inputClass}>
        <option value="">{value.category === "prop" ? "Choose a prop market" : "All markets"}</option>
        {categoryMarkets.map((market) => <option key={market.key} value={market.key} disabled={!market.available}>{market.label}{market.selections ? ` (${market.selections})` : ""}{market.available ? "" : " — not offered"}</option>)}
      </select>
      <select aria-label="Sportsbook" value={value.book} onChange={(event) => set({ book: event.target.value })} className={inputClass}>
        <option value="">All sportsbooks</option>
        {books.filter((book) => !book.retired).map((book) => <option key={book.key} value={book.key} disabled={!book.prices}>{book.name}{book.prices ? "" : book.status === "requires_api_key" ? " (API key)" : " (no prices)"}</option>)}
      </select>
      <input aria-label="Game date" type="date" value={value.date} onChange={(event) => set({ date: event.target.value })} className={`${inputClass} text-muted`} />
      <Toggle label="+EV only" active={value.evOnly} onChange={(evOnly) => set({ evOnly })} />
      <Toggle label="Arbitrage only" active={value.arbOnly} onChange={(arbOnly) => set({ arbOnly })} />
      <Toggle label="Live" active={value.live} onChange={(live) => set({ live })} />
      <Toggle label="Pregame" active={value.pregame} onChange={(pregame) => set({ pregame })} />
      {activeCount > 0 && <button type="button" onClick={() => onChange(EMPTY_ODDS_FILTERS)} className="px-2 text-[11px] font-semibold text-lime">Reset</button>}
    </div>
  );
}
