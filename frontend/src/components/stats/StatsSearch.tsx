import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { PlayerRow, TeamRow } from "../../lib/statsTypes";
import { Avatar } from "./StatsUi";

export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/** Searches players and teams in the selected league; picking a result opens its profile. */
export function StatsSearch({ value, onChange, players, teams, onPlayer, onTeam }: {
  value: string;
  onChange: (value: string) => void;
  players: PlayerRow[];
  teams: TeamRow[];
  onPlayer: (id: string) => void;
  onTeam: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    if (value.trim().length < 2) return [];
    const needle = value.trim().toLowerCase();
    const teamHits = teams
      .filter((team) => matchesQuery(value, team.name, team.abbr, team.shortName))
      .slice(0, 4)
      .map((team) => ({ kind: "team" as const, id: team.id, title: team.name, sub: `${team.record} · ${team.division || team.conference}`, image: team.logo }));
    const playerHits = players
      .filter((player) => matchesQuery(value, player.name, player.teamName, player.teamAbbr))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)))
      .slice(0, 8)
      .map((player) => ({ kind: "player" as const, id: player.id, title: player.name, sub: `${player.teamAbbr || "FA"} · ${player.position}`, image: player.headshot }));
    return [...teamHits, ...playerHits];
  }, [players, teams, value]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => setActive(0), [value]);

  function choose(index: number) {
    const result = results[index];
    if (!result) return;
    setOpen(false);
    onChange("");
    if (result.kind === "player") onPlayer(result.id); else onTeam(result.id);
  }

  return (
    <div ref={container} className="relative w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-2.5 text-muted" size={15} />
      <input
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => Math.min(current + 1, results.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
          if (event.key === "Enter" && open && results.length) { event.preventDefault(); choose(active); }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Search players or teams…"
        aria-label="Search players or teams"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="stats-search-results"
        className="w-full rounded-lg border border-line bg-[#0c1114] py-2 pl-9 pr-8 text-xs text-white outline-none focus:border-lime"
      />
      {value && <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 top-2 rounded p-0.5 text-muted hover:text-white"><X size={14} /></button>}
      {open && results.length > 0 && (
        <ul id="stats-search-results" role="listbox" className="absolute left-0 right-0 top-11 z-30 max-h-80 overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-2xl">
          {results.map((result, index) => (
            <li key={`${result.kind}-${result.id}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${index === active ? "bg-[#202b24]" : ""}`}
              >
                <Avatar src={result.image} name={result.title} size={28} square={result.kind === "team"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-white">{result.title}</span>
                  <span className="block truncate text-[10px] text-muted">{result.sub}</span>
                </span>
                <span className="rounded bg-[#20292e] px-1.5 py-0.5 text-[9px] uppercase text-muted">{result.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
