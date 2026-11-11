import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../../lib/api";
import { useBetSlip } from "../../lib/betSlipStore";
import { american } from "../../lib/oddsFormat";
import type { FutureMarket, Poll, PollKey } from "../../lib/simTypes";

const POLL_LABEL: Record<PollKey, string> = { ap: "AP Top 25", coaches: "Coaches", net: "NET", kenpom: "KenPom" };
const card = "overflow-hidden rounded-2xl border border-line bg-panel";

function PollTable({ poll, onTeam }: { poll: Poll; onTeam?: (teamId: string) => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? poll.teams : poll.teams.slice(0, 25);
  const extra = poll.key === "net" ? [["Q1", "quad1"], ["Q2", "quad2"]] : poll.key === "kenpom" ? [["AdjO", "adjO"], ["AdjD", "adjD"], ["Tempo", "adjTempo"]] : [];
  return <div>
    <p className="px-5 pb-3 text-[11px] text-muted">{poll.release} · {poll.source}{poll.key === "net" && /20\d\d/.test(poll.release) ? " · the NCAA publishes the first NET of a season in early December" : ""}</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs">
      <thead><tr className="text-[9px] font-semibold tracking-wider text-[#738087]"><th className="px-5 py-2">RK</th><th className="px-3 py-2">TEAM</th><th className="px-3 py-2 text-right">RECORD</th>
        {poll.key === "ap" || poll.key === "coaches" ? <><th className="px-3 py-2 text-right">PTS</th><th className="px-5 py-2 text-right">PREV</th></> : <>{extra.map(([label]) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}{poll.key === "kenpom" && <th className="px-5 py-2 text-right">AdjEM</th>}{poll.key === "net" && <th className="px-5 py-2 text-right">PREV</th>}</>}
      </tr></thead>
      <tbody>{rows.map((team) => <tr key={`${team.rank}-${team.team}`} className="border-t border-line">
        <td className="px-5 py-2 font-display font-bold">{team.rank}</td>
        <td className="px-3 py-2"><button type="button" disabled={!team.teamId || !onTeam} onClick={() => team.teamId && onTeam?.(team.teamId)} className="flex items-center gap-2 text-left font-medium enabled:hover:text-lime">{team.logo && <img src={team.logo} alt="" className="h-5 w-5 object-contain" loading="lazy" />}{team.team}{team.firstPlaceVotes ? <span className="text-[10px] text-muted">({team.firstPlaceVotes})</span> : null}</button></td>
        <td className="px-3 py-2 text-right text-muted">{team.record || "—"}</td>
        {poll.key === "ap" || poll.key === "coaches" ? <><td className="px-3 py-2 text-right text-muted">{team.points ?? "—"}</td><td className="px-5 py-2 text-right text-muted">{team.previousRank ?? "NR"}</td></>
          : <>{extra.map(([label, key]) => <td key={label} className="px-3 py-2 text-right text-muted">{team.extra[key!] ?? "—"}</td>)}{poll.key === "kenpom" && <td className="px-5 py-2 text-right">{team.points?.toFixed(1) ?? "—"}</td>}{poll.key === "net" && <td className="px-5 py-2 text-right text-muted">{team.previousRank ?? "—"}</td>}</>}
      </tr>)}</tbody>
    </table></div>
    {poll.others.length > 0 && <p className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-muted">Others receiving votes: {poll.others.slice(0, 20).map((team) => `${team.team} ${team.points ?? ""}`.trim()).join(", ")}</p>}
    {poll.teams.length > 25 && <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-line py-2.5 text-[11px] text-muted hover:text-lime">{all ? "Show top 25" : `Show all ${poll.teams.length} teams`}</button>}
  </div>;
}

/** NCAA rankings (AP, Coaches, NET, KenPom) and conference standings for all Division I conferences. */
export function NcaaHub({ onTeam }: { onTeam?: (teamId: string) => void }) {
  const rankings = useQuery({ queryKey: ["ncaa-rankings"], queryFn: api.ncaaRankings, staleTime: 10 * 60_000 });
  const [pollKey, setPollKey] = useState<PollKey>("ap");
  const [conference, setConference] = useState("");
  const standings = useQuery({ queryKey: ["ncaa-conferences"], queryFn: () => api.ncaaConferences(), staleTime: 5 * 60_000 });
  const polls = rankings.data?.polls ?? [];
  const poll = polls.find((item) => item.key === pollKey) ?? polls[0];
  const missing = rankings.data?.unavailable.find((item) => item.key === pollKey);
  const conferences = standings.data?.conferences ?? [];
  const selected = conferences.find((item) => item.conference === conference) ?? conferences[0];
  return <div className="mb-4 grid gap-4 xl:grid-cols-2">
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4"><p className="text-sm font-semibold">Rankings</p>
        <div className="flex rounded-lg border border-line p-0.5 text-[11px]">{(Object.keys(POLL_LABEL) as PollKey[]).map((key) => <button key={key} type="button" onClick={() => setPollKey(key)} aria-pressed={pollKey === key} className={`rounded-md px-2.5 py-1.5 ${pollKey === key ? "bg-[#202b24] font-semibold text-lime" : "text-muted hover:text-white"}`}>{POLL_LABEL[key]}</button>)}</div></div>
      {rankings.isLoading ? <p className="px-5 pb-6 text-xs text-muted">Loading rankings…</p>
        : missing || !poll || poll.key !== pollKey ? <p className="px-5 pb-6 text-xs leading-relaxed text-muted">{missing?.reason ?? (rankings.error instanceof Error ? rankings.error.message : "This ranking is not available right now.")}</p>
        : <PollTable poll={poll} onTeam={onTeam} />}
    </div>
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4"><p className="text-sm font-semibold">Conference standings</p>
        <select value={selected?.conference ?? ""} onChange={(event) => setConference(event.target.value)} aria-label="Conference" className="max-w-[230px] rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs outline-none focus:border-lime">{conferences.map((item) => <option key={item.conference} value={item.conference}>{item.conference}</option>)}</select></div>
      {!selected ? <p className="px-5 pb-6 text-xs text-muted">{standings.isLoading ? "Loading standings…" : "Standings are not available right now."}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[440px] text-left text-xs">
        <thead><tr className="text-[9px] font-semibold tracking-wider text-[#738087]"><th className="px-5 py-2">TEAM</th><th className="px-3 py-2 text-right">CONF</th><th className="px-3 py-2 text-right">OVERALL</th><th className="px-3 py-2 text-right">HOME</th><th className="px-3 py-2 text-right">AWAY</th><th className="px-5 py-2 text-right">STRK</th></tr></thead>
        <tbody>{selected.teams.map((team) => <tr key={team.id} className="border-t border-line">
          <td className="px-5 py-2"><button type="button" onClick={() => onTeam?.(team.id)} className="flex items-center gap-2 text-left font-medium hover:text-lime">{team.logo && <img src={team.logo} alt="" className="h-5 w-5 object-contain" loading="lazy" />}{team.ranks.ap ? <span className="text-[10px] text-lime">#{team.ranks.ap}</span> : null}{team.shortName || team.name}</button></td>
          <td className="px-3 py-2 text-right">{team.conferenceRecord || "0-0"}</td><td className="px-3 py-2 text-right text-muted">{team.record}</td><td className="px-3 py-2 text-right text-muted">{team.home || "—"}</td><td className="px-3 py-2 text-right text-muted">{team.away || "—"}</td><td className="px-5 py-2 text-right text-muted">{team.streak || "—"}</td>
        </tr>)}</tbody></table></div>}
      <p className="border-t border-line px-5 py-3 text-[10px] text-muted">{conferences.length} conferences · {conferences.reduce((total, item) => total + item.teams.length, 0)} Division I programs, refreshed from the provider each season.</p>
    </div>
  </div>;
}

const CATEGORY_LABEL: Record<FutureMarket["category"], string> = { championship: "National championship", tournament: "NCAA tournament", conference: "Conference", award: "Awards" };

/** NCAA futures (national title, Final Four, conference winners) with one-tap add to the simulated bet slip. */
export function NcaaFutures() {
  const futures = useQuery({ queryKey: ["ncaa-futures"], queryFn: api.ncaaFutures, staleTime: 5 * 60_000 });
  const add = useBetSlip((state) => state.add);
  const markets = useMemo(() => futures.data?.markets ?? [], [futures.data]);
  const [marketId, setMarketId] = useState("");
  const [all, setAll] = useState(false);
  const market = markets.find((item) => item.id === marketId) ?? markets[0];
  if (futures.isLoading) return <div className={`${card} p-6 text-xs text-muted`}>Loading futures…</div>;
  if (!market) return <div className={`${card} p-6 text-xs text-muted`}>{futures.error instanceof Error ? futures.error.message : "No NCAA futures are posted right now."}</div>;
  const outcomes = all ? market.outcomes : market.outcomes.slice(0, 16);
  return <div className={card}>
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
      <div><p className="text-sm font-semibold">NCAA futures</p><p className="mt-1 text-[11px] text-muted">{futures.data?.season.displayName} · {futures.data?.source}</p></div>
      <select value={market.id} onChange={(event) => { setMarketId(event.target.value); setAll(false); }} aria-label="Futures market" className="max-w-[280px] rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs outline-none focus:border-lime">
        {(Object.keys(CATEGORY_LABEL) as FutureMarket["category"][]).map((category) => { const items = markets.filter((item) => item.category === category); return items.length ? <optgroup key={category} label={CATEGORY_LABEL[category]}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup> : null; })}
      </select>
    </div>
    <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-4">{outcomes.map((outcome) => <button key={outcome.name} type="button" title="Add to bet slip"
      onClick={() => add({ key: `future|${market.id}|${outcome.name}`, kind: "future", sport: "ncaab", book: market.book, marketId: market.id, outcome: outcome.name, american: outcome.american, label: `${outcome.name} · ${market.name}`, event: `${futures.data?.season.displayName ?? ""} futures`, bookName: market.bookName })}
      className="group flex items-center justify-between gap-3 bg-panel px-5 py-3 text-left text-xs hover:bg-[#151d20]"><span className="truncate font-medium">{outcome.name}</span><span className="flex items-center gap-2 font-display font-bold">{american(outcome.american)}<Plus size={12} className="text-muted group-hover:text-lime" /></span></button>)}</div>
    {market.outcomes.length > 16 && <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-line py-2.5 text-[11px] text-muted hover:text-lime">{all ? "Show fewer" : `Show all ${market.outcomes.length} teams`}</button>}
  </div>;
}
