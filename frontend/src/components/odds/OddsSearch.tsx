import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "../../lib/api";
import type { SearchResult } from "../../lib/oddsTypes";

const KIND_LABELS: Record<SearchResult["kind"], string> = { game: "Game", team: "Team", player: "Player", prop: "Prop", market: "Market", sportsbook: "Sportsbook" };

/** Global search across games, teams, players, props, markets and sportsbooks in every loaded league. */
export function OddsSearch({ value, onChange, onPick }: { value: string; onChange: (value: string) => void; onPick: (result: SearchResult) => void }) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.oddsSearch(q).then((data) => { if (!cancelled) { setResults(data.results); setActive(0); } }).catch(() => { if (!cancelled) setResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (result: SearchResult) => {
    setOpen(false);
    onPick(result);
  };

  return (
    <div ref={box} className="relative w-full sm:w-80">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="odds-search-results"
        aria-label="Search games, players, teams, markets, sportsbooks and props"
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Enter" && open && results[active]) { event.preventDefault(); pick(results[active]!); }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Search game, player, team, market, book…"
        className="w-full rounded-lg border border-line bg-[#0c1114] py-2 pl-9 pr-8 text-xs text-white outline-none placeholder:text-[#5f6b70] focus:border-lime"
      />
      {value && <button type="button" aria-label="Clear search" onClick={() => { onChange(""); setResults([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-white"><X size={13} /></button>}
      {open && results.length > 0 && (
        <ul id="odds-search-results" role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-[#11171b] p-1 shadow-2xl">
          {results.map((result, index) => (
            <li key={`${result.kind}-${result.label}-${result.gameId ?? ""}-${result.market ?? ""}-${index}`} role="option" aria-selected={index === active}>
              <button type="button" onMouseEnter={() => setActive(index)} onClick={() => pick(result)} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left ${index === active ? "bg-white/[0.05]" : ""}`}>
                <span className="min-w-0">
                  <span className="block truncate text-xs text-white">{result.label}</span>
                  <span className="block truncate text-[10px] text-muted">{result.detail}</span>
                </span>
                <span className="shrink-0 rounded-md bg-[#1b2428] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#a9b5b4]">{KIND_LABELS[result.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
