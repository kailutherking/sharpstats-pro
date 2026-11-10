import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import type { PostView } from "../lib/socialTypes";
import { useNavStore } from "../lib/navStore";
import { Avatar, EmptyState, inputClass, LoadingBlock, Segmented } from "../components/stats/StatsUi";
import { ActivityFeed } from "../components/social/ActivityFeed";
import { PickCard } from "../components/social/PickCard";
import { Leaderboards } from "../components/social/Leaderboards";
import { ProfileView } from "../components/social/ProfileView";
import { AchievementsPanel } from "../components/social/AchievementsPanel";

type Tab = "feed" | "picks" | "leaderboards" | "profile";
type PickSort = "popular" | "tailed" | "props" | "sharp" | "winners" | "recent";
const PICK_SORTS: Array<{ value: PickSort; label: string }> = [
  { value: "popular", label: "Popular" }, { value: "tailed", label: "Most tailed" }, { value: "props", label: "Trending props" },
  { value: "sharp", label: "Sharp bettors" }, { value: "winners", label: "Top winners" }, { value: "recent", label: "Latest" },
];

function PeopleSearch({ onProfile }: { onProfile: (handle: string) => void }) {
  const [q, setQ] = useState("");
  const results = useQuery({ queryKey: ["profile-search", q], queryFn: () => api.searchProfiles(q), enabled: q.trim().length >= 2 });
  return (
    <div className="relative w-full sm:w-64">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find bettors" aria-label="Find bettors" className={`${inputClass} w-full py-2.5 pl-9`} />
      {q.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-11 z-20 rounded-xl border border-line bg-panel p-1 shadow-xl">
          {results.data?.profiles.length ? results.data.profiles.map((profile) => (
            <button key={profile.userId} type="button" onClick={() => { onProfile(profile.handle); setQ(""); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]">
              <Avatar src={profile.avatarUrl} name={profile.name} size={26} /><span className="text-xs text-white">{profile.name}</span><span className="text-[10px] text-muted">@{profile.handle} · LV {profile.level}</span>
            </button>
          )) : <p className="px-2 py-2 text-[11px] text-muted">{results.isLoading ? "Searching…" : "No bettors found."}</p>}
        </div>
      )}
    </div>
  );
}

/** Workspace → Community: feed, social picks, leaderboards and profiles (yours and others'). */
export function CommunityPage({ myHandle, onTail }: { myHandle: string | null; onTail: (post: PostView) => void }) {
  const [tab, setTab] = useState<Tab>("feed");
  const [sort, setSort] = useState<PickSort>("popular");
  const [viewing, setViewing] = useState<string | null>(null);
  const [focusPost, setFocusPost] = useState<number | null>(null);
  const target = useNavStore((state) => state.community);
  const consume = useNavStore((state) => state.consumeCommunity);
  useEffect(() => {
    if (!target) return;
    if (target.handle) { setViewing(target.handle); setTab("profile"); }
    if (target.postId) { setFocusPost(target.postId); setViewing(null); setTab("feed"); }
    if (target.tab) setTab(target.tab);
    consume();
  }, [target, consume]);
  const picks = useQuery({ queryKey: ["social-picks", sort], queryFn: () => api.picks(sort), enabled: tab === "picks" });
  const focused = useQuery({ queryKey: ["post", focusPost], queryFn: () => api.post(focusPost!), enabled: focusPost !== null });
  const openProfile = (handle: string) => { setViewing(handle); setTab("profile"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const profileHandle = viewing ?? myHandle;
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">WORKSPACE</p>
          <h2 className="font-display text-2xl font-extrabold">Community</h2>
          <p className="mt-1.5 text-sm text-muted">Picks, leaderboards and activity from bettors you follow.</p>
        </div>
        <PeopleSearch onProfile={openProfile} />
      </div>
      <div className="mb-4 overflow-x-auto">
        <Segmented<Tab> label="Community view" value={tab} onChange={(next) => { setTab(next); if (next === "profile") setViewing(null); }} options={[
          { value: "feed", label: "Feed" }, { value: "picks", label: "Picks" }, { value: "leaderboards", label: "Leaderboards" }, { value: "profile", label: viewing && viewing !== myHandle ? `@${viewing}` : "My profile" },
        ]} />
      </div>
      {tab === "feed" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            {focusPost !== null && focused.data && (
              <div className="space-y-1"><p className="text-[10px] font-bold tracking-wider text-lime">FROM YOUR NOTIFICATION</p><PickCard post={focused.data.post} onProfile={openProfile} onTail={onTail} onChanged={(post) => { if (!post) setFocusPost(null); }} /></div>
            )}
            <ActivityFeed onProfile={openProfile} onTail={onTail} />
          </div>
          <div className="hidden xl:block"><AchievementsPanel compact /></div>
        </div>
      )}
      {tab === "picks" && (
        <div className="space-y-3">
          <div className="overflow-x-auto"><Segmented label="Pick lists" value={sort} onChange={setSort} options={PICK_SORTS} /></div>
          {picks.isLoading ? <LoadingBlock label="Loading picks…" /> : picks.data?.picks.length ? (
            <div className="grid gap-3 lg:grid-cols-2">{picks.data.picks.map((post) => <PickCard key={post.id} post={post} onProfile={openProfile} onTail={onTail} />)}</div>
          ) : <div className="rounded-2xl border border-line bg-panel"><EmptyState>{sort === "sharp" ? "No pending picks yet from bettors with 10+ settled picks and a winning record." : "No picks in this list yet."}</EmptyState></div>}
        </div>
      )}
      {tab === "leaderboards" && <Leaderboards onProfile={openProfile} />}
      {tab === "profile" && profileHandle && (
        <div className="space-y-4">
          <ProfileView key={profileHandle} handle={profileHandle} onBack={viewing && viewing !== myHandle ? () => setViewing(null) : undefined} onProfile={openProfile} onTail={onTail} />
          {(!viewing || viewing === myHandle) && <AchievementsPanel />}
        </div>
      )}
    </section>
  );
}
