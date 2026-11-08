import { Flame, Minus, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import type { Insight } from "../../lib/statsTypes";
import { Panel } from "./StatsUi";

const toneStyles: Record<Insight["tone"], { box: string; icon: string }> = {
  positive: { box: "border-[#34412a] bg-[#182017]", icon: "text-lime" },
  negative: { box: "border-rose-900/50 bg-rose-950/20", icon: "text-rose-400" },
  neutral: { box: "border-line bg-[#0e1416]", icon: "text-sky-300" },
};

function InsightIcon({ insight }: { insight: Insight }) {
  if (insight.id.endsWith("-streak") || insight.id === "team-streak") return <Flame size={15} />;
  if (insight.tone === "positive") return <TrendingUp size={15} />;
  if (insight.tone === "negative") return <TrendingDown size={15} />;
  return <Minus size={15} />;
}

/** Plain-language notes generated on the server from game logs and splits. */
export function BettingInsightsPanel({ insights, subtitle = "Generated from game logs, hit rates and splits" }: { insights: Insight[]; subtitle?: string }) {
  return (
    <Panel
      title="Betting insights"
      subtitle={subtitle}
      action={<span className="rounded-lg bg-lime/10 p-2 text-lime"><Sparkles size={15} /></span>}
    >
      {insights.length ? (
        <ul className="space-y-2.5">
          {insights.map((insight) => (
            <li key={insight.id} className={`flex gap-3 rounded-xl border p-3 ${toneStyles[insight.tone].box}`}>
              <span className={`mt-0.5 ${toneStyles[insight.tone].icon}`}><InsightIcon insight={insight} /></span>
              <div>
                <p className="text-xs font-semibold leading-relaxed text-white">{insight.headline}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">{insight.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted">Not enough games logged yet to surface patterns.</p>}
      <p className="mt-4 text-[10px] leading-relaxed text-[#69757a]">Insights describe past results only. They are not predictions; verify lines with your sportsbook.</p>
    </Panel>
  );
}
