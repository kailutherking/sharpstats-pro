import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Flame, UserCheck, UserPlus } from "lucide-react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "../../lib/api";
import type { PostView } from "../../lib/socialTypes";
import { Avatar, EmptyState, LoadingBlock, Panel, StatTile } from "../stats/StatsUi";
import { Notice } from "../odds/OddsUi";
import { PickCard } from "./PickCard";
import { BadgeIcon, LevelPill, ratio, units, XpBar } from "./socialUi";

/** Public profile: record from shared picks, followers, badges, favorites, tail/fade results and recent picks. */
export function ProfileView({ handle, onBack, onProfile, onTail }: { handle: string; onBack?: () => void; onProfile: (handle: string) => void; onTail?: (post: PostView) => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["profile", handle], queryFn: () => api.publicProfile(handle) });
  const profile = query.data;
  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    try {
      await api.follow(profile.handle, !profile.isFollowing);
      await queryClient.invalidateQueries({ queryKey: ["profile", handle] });
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(false);
    }
  }
  if (query.isLoading) return <LoadingBlock label="Loading profile…" />;
  if (query.error || !profile) return <Notice tone="error">{query.error instanceof Error ? query.error.message : "Profile not found."}</Notice>;
  const r = profile.record;
  return (
    <div className="space-y-4">
      {onBack && <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted hover:text-white"><ArrowLeft size={14} />Back</button>}
      <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar src={profile.avatarUrl} name={profile.name} size={64} />
            <div>
              <h3 className="font-display text-xl font-extrabold">{profile.name}</h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">@{profile.handle} <LevelPill level={profile.level} rank={profile.rank} />{profile.streak.days > 1 && <span className="inline-flex items-center gap-0.5 text-orange-300"><Flame size={12} />{profile.streak.days}d</span>}</p>
              <p className="mt-1.5 text-[11px] text-muted"><span className="font-semibold text-white">{profile.followers}</span> followers · <span className="font-semibold text-white">{profile.following}</span> following · joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</p>
            </div>
          </div>
          {!profile.isMe && (
            <button type="button" onClick={() => void toggleFollow()} disabled={busy} className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-60 ${profile.isFollowing ? "border border-line text-white" : "bg-lime text-[#11170c]"}`}>
              {profile.isFollowing ? <><UserCheck size={14} />Following</> : <><UserPlus size={14} />Follow</>}
            </button>
          )}
        </div>
        {profile.bio && <p className="mt-3 text-[13px] leading-relaxed text-[#d9e0dc]">{profile.bio}</p>}
        {profile.favoriteSports.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{profile.favoriteSports.map((sport) => <span key={sport} className="rounded-md bg-[#1b2428] px-2 py-0.5 text-[10px] font-bold text-[#c9d2cf]">{sport.toUpperCase()}</span>)}</div>}
        {profile.isMe && <div className="mt-4"><XpBar current={profile.xp.current} next={profile.xp.next} level={profile.level} /></div>}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Record (W-L-P)" value={`${r.wins}-${r.losses}-${r.pushes}`} sub={`${r.pending} pending · ${r.verified} verified`} />
        <StatTile label="Units won" value={units(r.units)} highlight={r.units > 0} sub={`${r.risked}u risked`} />
        <StatTile label="ROI" value={ratio(r.roi)} />
        <StatTile label="Win %" value={ratio(r.winRate)} sub={`${r.settled} settled picks`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Performance" subtitle="Cumulative units from shared picks">
          {profile.performance.length > 1 ? (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profile.performance} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#849198", fontSize: 10 }} />
                  <ReferenceLine y={0} stroke="#3a464c" strokeDasharray="4 4" />
                  <Tooltip contentStyle={{ background: "#11171b", border: "1px solid #29343a", borderRadius: 12, color: "#eef2ed", fontSize: 12 }} formatter={(value: number) => [units(value), "Units"]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? new Date(payload[0].payload.date as string).toLocaleDateString() : ""} />
                  <Line type="monotone" dataKey="units" stroke="#c5f467" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState>The chart starts after two settled picks.</EmptyState>}
          {profile.bySport.length > 1 && <div className="mt-3 flex flex-wrap gap-2">{profile.bySport.map((item) => <span key={item.sport} className="rounded-lg border border-line px-2 py-1 text-[10px] text-muted">{item.sport}: <span className="text-white">{item.record.wins}-{item.record.losses}</span> · {units(item.record.units)}</span>)}</div>}
        </Panel>
        <Panel title="Badges & tail/fade">
          {profile.badges.length ? <div className="flex flex-wrap gap-1.5">{profile.badges.map((badge) => <span key={badge.key} title={`Earned ${new Date(badge.earnedAt).toLocaleDateString()}`} className="inline-flex items-center gap-1 rounded-lg bg-lime/10 px-2 py-1 text-[10px] font-semibold text-lime"><BadgeIcon icon={badge.icon} size={11} />{badge.name}</span>)}</div> : <p className="text-[11px] text-muted">No badges yet.</p>}
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-line p-2.5"><p className="text-[9px] uppercase tracking-wider text-muted">Tailed</p><p className="text-sm font-bold text-white">{profile.tailFade.tails}×</p><p className={`text-[10px] ${profile.tailFade.tailNetUnits >= 0 ? "text-lime" : "text-rose-400"}`}>Tailers {units(profile.tailFade.tailNetUnits)}</p></div>
            <div className="rounded-xl border border-line p-2.5"><p className="text-[9px] uppercase tracking-wider text-muted">Faded</p><p className="text-sm font-bold text-white">{profile.tailFade.fades}×</p><p className={`text-[10px] ${profile.tailFade.fadeNetUnits >= 0 ? "text-lime" : "text-rose-400"}`}>Faders {units(profile.tailFade.fadeNetUnits)}</p></div>
          </div>
          {(profile.favorites.teams.length > 0 || profile.favorites.players.length > 0 || profile.favorites.sportsbooks.length > 0) && (
            <div className="mt-4 space-y-2">
              <p className="text-[9px] font-bold tracking-wider text-muted">FOLLOWS</p>
              <div className="flex flex-wrap gap-1.5">{[...profile.favorites.teams, ...profile.favorites.players].slice(0, 12).map((item) => <span key={`${item.league}-${item.id}`} className="flex items-center gap-1 rounded-lg border border-line py-0.5 pl-0.5 pr-2 text-[10px] text-[#d9e0dc]"><Avatar src={item.imageUrl} name={item.name} size={18} />{item.name}</span>)}{profile.favorites.sportsbooks.map((book) => <span key={book} className="rounded-lg border border-line px-2 py-0.5 text-[10px] text-[#d9e0dc]">{book}</span>)}</div>
            </div>
          )}
        </Panel>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold">Recent picks</p>
        {profile.recentPicks.length ? profile.recentPicks.map((post) => <PickCard key={post.id} post={post} onProfile={onProfile} onTail={onTail} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["profile", handle] })} />) : <div className="rounded-2xl border border-line bg-panel"><EmptyState>No shared picks yet.</EmptyState></div>}
      </div>
    </div>
  );
}
