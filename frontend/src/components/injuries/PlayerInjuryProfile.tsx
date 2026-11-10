import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import type { InjuryRow } from "../../lib/injuryTypes";
import type { League } from "../../lib/statsTypes";
import { Avatar, EmptyState, LoadingBlock, Panel } from "../stats/StatsUi";
import { Notice } from "../odds/OddsUi";
import { ImpactBreakdown, LineImpactCard } from "./InjuryImpactPanel";
import { shortDate, StatusPill } from "./injuryUi";

const PRACTICE_TONE = { Full: "text-lime", Limited: "text-amber-300", "Did not practice": "text-rose-400" } as const;

/** Full injury details, timeline, news, practice participation, workload notes and betting impact for one player. */
export function PlayerInjuryProfile({ league, row, onClose }: { league: League; row: InjuryRow; onClose: () => void }) {
  const query = useQuery({ queryKey: ["injury-player", league, row.athleteId], queryFn: () => api.injuryPlayer(league, row.athleteId) });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const data = query.data;
  const injury = data?.injury ?? row;
  const facts: Array<[string, string]> = [
    ["Status", injury.status === "Active" ? "Returning (listed active)" : injury.status],
    ["Type of injury", [injury.injuryType, injury.detail && injury.detail !== injury.injuryType ? injury.detail : null].filter(Boolean).join(" · ") || "Undisclosed"],
    ["Body part", [injury.side, injury.location].filter(Boolean).join(" ") || "—"],
    ["Date injured", data?.dateInjured ? `${shortDate(data.dateInjured)} (first reported)` : shortDate(injury.firstReportedAt)],
    ["Expected return", injury.returnDate ? shortDate(injury.returnDate) : "TBD"],
    ["Last updated", new Date(injury.reportedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })],
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`${row.name} injury details`} onClick={onClose}>
      <div className="h-full w-full max-w-[860px] overflow-y-auto border-l border-line bg-canvas p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar src={row.headshot} name={row.name} size={56} />
            <div>
              <p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-lime">INJURY REPORT</p>
              <h3 className="font-display text-lg font-bold">{row.name}</h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">{row.teamName} · {row.positionName || row.position} <StatusPill status={injury.status} /></p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-line p-2 text-muted hover:text-white"><X size={15} /></button>
        </div>
        <div className="space-y-4">
          <Panel title="Injury details">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {facts.map(([label, value]) => <div key={label}><p className="text-[9px] uppercase tracking-wider text-[#69757a]">{label}</p><p className="mt-0.5 text-xs font-semibold text-white">{value}</p></div>)}
            </div>
            {(injury.shortComment || injury.longComment) && (
              <div className="mt-4 space-y-1.5 rounded-xl bg-[#0e1416] p-3 text-[11px] leading-relaxed">
                {injury.shortComment && <p className="font-semibold text-white">{injury.shortComment}</p>}
                {injury.longComment && injury.longComment !== injury.shortComment && <p className="text-[#c9d2cf]">{injury.longComment}</p>}
                <p className="text-[10px] text-[#69757a]">Source: {injury.source}</p>
              </div>
            )}
          </Panel>
          <Panel title="Betting impact"><ImpactBreakdown impact={injury.impact} status={injury.status} /></Panel>
          {query.isLoading ? <LoadingBlock label="Loading history and news…" /> : query.error ? <Notice tone="error">{query.error instanceof Error ? query.error.message : "Could not load details."}</Notice> : data ? (
            <>
              <Panel title="Odds impact" subtitle="Spread on this team's next game, before vs. now"><LineImpactCard line={data.line} /></Panel>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Practice participation">
                  {data.practice.length ? <ul className="space-y-2">{data.practice.map((note) => <li key={note.note} className="text-[11px] leading-relaxed"><span className={`mr-1.5 font-bold ${PRACTICE_TONE[note.level]}`}>{note.level}</span><span className="text-[#c9d2cf]">{note.note}</span></li>)}</ul>
                    : <EmptyState>No practice report in the latest notes{league === "nfl" ? "" : " (practice reports are mainly an NFL feature)"}.</EmptyState>}
                </Panel>
                <Panel title="Workload restrictions">
                  {data.workload.length ? <ul className="space-y-2">{data.workload.map((note) => <li key={note} className="text-[11px] leading-relaxed text-[#c9d2cf]">{note}</li>)}</ul> : <EmptyState>No minutes, snap or pitch-count limits mentioned.</EmptyState>}
                </Panel>
              </div>
              <Panel title="Recent news">
                {data.news.length ? <ul className="space-y-3">{data.news.map((item) => <li key={`${item.headline}-${item.published}`}><p className="text-xs font-semibold text-white">{item.headline}</p>{item.story && <p className="mt-0.5 text-[11px] leading-relaxed text-[#c9d2cf]">{item.story}</p>}<p className="mt-0.5 text-[10px] text-[#69757a]">{item.source}{item.published ? ` · ${shortDate(item.published)}` : ""}</p></li>)}</ul> : <EmptyState>No recent news for this player.</EmptyState>}
              </Panel>
              <Panel title="Injury history" subtitle={data.historyNote}>
                {data.pastInjuries.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{data.pastInjuries.map((past) => <span key={past.injury} className="rounded-md border border-line px-2 py-1 text-[10px] text-[#d9e0dc]">{past.injury} · {shortDate(past.firstSeen)}–{shortDate(past.lastSeen)}</span>)}</div>}
                {data.timeline.length ? (
                  <ol className="space-y-2 border-l border-line pl-4">
                    {data.timeline.map((item) => (
                      <li key={`${item.recordedAt}-${item.status}`} className="text-[11px]">
                        <p className="font-semibold text-white">{item.previousStatus ? `${item.previousStatus} → ` : ""}{item.status}{item.injury ? ` · ${item.injury}` : ""} <span className="font-normal text-[#69757a]">{shortDate(item.recordedAt)}</span></p>
                        {item.comment && <p className="mt-0.5 leading-relaxed text-muted">{item.comment}</p>}
                      </li>
                    ))}
                  </ol>
                ) : <EmptyState>No earlier status changes recorded yet.</EmptyState>}
              </Panel>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
