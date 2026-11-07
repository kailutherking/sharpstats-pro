import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function StatCard({ title, value, note, icon, positive }: { title: string; value: string; note: string; icon: ReactNode; positive?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div><p className="text-xs font-medium text-muted">{title}</p><p className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-[27px]">{value}</p></div>
        <div className="rounded-xl border border-line bg-[#161e21] p-2.5 text-lime">{icon}</div>
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted">
        {positive !== undefined && <span className={positive ? "text-lime" : "text-rose-400"}>{positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}</span>}
        <span>{note}</span>
      </div>
    </div>
  );
}
