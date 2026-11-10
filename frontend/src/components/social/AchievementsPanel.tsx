import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { api } from "../../lib/api";
import { LoadingBlock, Panel } from "../stats/StatsUi";
import { BadgeIcon, XpBar } from "./socialUi";

/** Level, XP, daily streak and every badge with progress toward it. */
export function AchievementsPanel({ compact = false }: { compact?: boolean }) {
  const query = useQuery({ queryKey: ["achievements"], queryFn: api.achievements });
  const data = query.data;
  if (!data) return <LoadingBlock label="Loading achievements…" />;
  return (
    <Panel title="Achievements" subtitle={`${data.level.rank} · ${data.xp.toLocaleString()} XP total · ${data.badges.filter((badge) => badge.earned).length}/${data.badges.length} badges`}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <XpBar current={data.level.current} next={data.level.next} level={data.level.level} />
        <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[11px] text-muted"><Flame size={13} className="text-orange-300" />{data.streak.days}-day streak · best {data.streak.best}</span>
      </div>
      <div className={`mt-4 grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {(compact
          // Sidebar: earned badges, then the four closest to being earned.
          ? [...data.badges.filter((badge) => badge.earned), ...data.badges.filter((badge) => !badge.earned).sort((a, b) => b.progress / b.target - a.progress / a.target).slice(0, 4)]
          : data.badges).map((badge) => (
          <div key={badge.key} className={`rounded-xl border p-3 ${badge.earned ? "border-[#34412a] bg-[#182017]" : "border-line bg-[#0e1416]"}`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${badge.earned ? "bg-lime text-[#11170c]" : "bg-[#1b2428] text-muted"}`}><BadgeIcon icon={badge.icon} /></span>
              <div className="min-w-0"><p className={`text-xs font-semibold ${badge.earned ? "text-lime" : "text-white"}`}>{badge.name}</p><p className="text-[10px] text-muted">+{badge.xp} XP{badge.earnedAt ? ` · ${new Date(badge.earnedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</p></div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[#a2abad]">{badge.description}</p>
            {!badge.earned && <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1b2428]"><div className="h-full bg-lime/70" style={{ width: `${(badge.progress / badge.target) * 100}%` }} /></div>}
            <p className="mt-1 text-[10px] text-[#69757a]">{badge.detail}</p>
          </div>
        ))}
      </div>
      {!compact && <p className="mt-3 text-[10px] text-[#69757a]">XP: 5 per bet tracked, 5 per settled bet, +10 per win, 10 per pick shared, 2 per reaction or comment received, 5 per day visited, plus badge bonuses. Levels need 100, 300, 600… XP.</p>}
    </Panel>
  );
}
