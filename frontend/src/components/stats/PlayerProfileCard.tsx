import type { ReactNode } from "react";
import type { PlayerProfile } from "../../lib/statsTypes";
import { Avatar } from "./StatsUi";

export function PlayerProfileCard({ profile, actions }: { profile: PlayerProfile; actions?: ReactNode }) {
  const { player } = profile;
  const facts = [
    { label: "Team", value: player.teamName || "Free agent" },
    { label: "Position", value: player.positionName || player.position || "—" },
    { label: "Height", value: player.height || "—" },
    { label: "Weight", value: player.weight || "—" },
    { label: "Age", value: player.age !== null ? String(player.age) : "—" },
    { label: "Experience", value: player.experience || "—" },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="absolute inset-x-0 top-0 h-24 opacity-30" style={{ background: `linear-gradient(120deg, ${player.teamColor ?? "#27312a"} 0%, transparent 75%)` }} aria-hidden />
      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:p-6">
        <div className="relative">
          <Avatar src={player.headshot} name={player.name} size={112} />
          {player.teamLogo && <img src={player.teamLogo} alt="" className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full border border-line bg-panel p-1" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {player.jersey && <span className="rounded-md bg-[#20292e] px-2 py-0.5 text-[10px] font-bold text-muted">#{player.jersey}</span>}
            <span className="rounded-md bg-lime/10 px-2 py-0.5 text-[10px] font-bold text-lime">{player.position}</span>
            {player.status && player.status !== "Active" && <span className="rounded-md bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">{player.status}</span>}
          </div>
          <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-[30px]">{player.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {player.teamName}{player.teamRecord ? ` · ${player.teamRecord}` : ""}{player.division ? ` · ${player.division}` : ""}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <dl className="relative grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6">
        {facts.map((fact) => (
          <div key={fact.label} className="border-b border-r border-line px-5 py-3 last:border-r-0 lg:border-b-0">
            <dt className="text-[10px] uppercase tracking-wider text-muted">{fact.label}</dt>
            <dd className="mt-1 truncate text-xs font-semibold text-white">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
