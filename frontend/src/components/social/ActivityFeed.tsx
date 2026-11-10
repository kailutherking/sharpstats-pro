import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, HeartPulse, Newspaper, Trophy, TrendingUp } from "lucide-react";
import { api } from "../../lib/api";
import type { FeedEventView, FeedFilter, FeedItem, NewsItem, PostView, Visibility } from "../../lib/socialTypes";
import { EmptyState, inputClass, LoadingBlock, Segmented } from "../stats/StatsUi";
import { PickCard } from "./PickCard";
import { ago, UserChip } from "./socialUi";

const FILTERS: Array<{ value: FeedFilter; label: string }> = [
  { value: "all", label: "All" }, { value: "picks", label: "Picks" }, { value: "wins", label: "Big wins" },
  { value: "injuries", label: "Injury news" }, { value: "market", label: "Line moves" }, { value: "news", label: "Headlines" },
];

const EVENT_META: Record<string, { icon: typeof Activity; tone: string; label: string }> = {
  big_win: { icon: Trophy, tone: "text-lime", label: "BIG WIN" },
  achievement: { icon: Trophy, tone: "text-amber-300", label: "BADGE" },
  injury: { icon: HeartPulse, tone: "text-rose-300", label: "INJURY" },
  market: { icon: TrendingUp, tone: "text-sky-300", label: "LINE MOVE" },
};

function EventCard({ event, onProfile }: { event: FeedEventView; onProfile?: (handle: string) => void }) {
  const meta = EVENT_META[event.type] ?? { icon: Activity, tone: "text-muted", label: event.type.toUpperCase() };
  const Icon = meta.icon;
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-panel p-4">
      <span className={`mt-0.5 shrink-0 ${meta.tone}`}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold tracking-wider text-[#69757a]">{meta.label}{event.league ? ` · ${event.league.toUpperCase()}` : ""} · {ago(event.createdAt)}</p>
        {event.actor ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"><UserChip name={event.actor.name} handle={event.actor.handle} avatarUrl={event.actor.avatarUrl} onOpen={onProfile} size={22} /><span className="text-[#d9e0dc]">{event.title}</span></div>
        ) : <p className="mt-1 text-xs font-semibold text-white">{event.title}</p>}
        {event.body && <p className="mt-1 text-[11px] leading-relaxed text-muted">{event.body}</p>}
      </div>
    </div>
  );
}

function NewsCard({ news }: { news: NewsItem }) {
  return (
    <a href={news.link ?? undefined} target="_blank" rel="noreferrer" className="flex gap-3 rounded-2xl border border-line bg-panel p-4 hover:border-[#536048]">
      <span className="mt-0.5 shrink-0 text-[#c9d2cf]"><Newspaper size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold tracking-wider text-[#69757a]">{news.category === "trade" ? "TRADE / SIGNING" : "NEWS"} · {news.league.toUpperCase()} · {ago(news.published)}</p>
        <p className="mt-1 text-xs font-semibold text-white">{news.headline}</p>
        {news.description && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{news.description}</p>}
      </div>
      {news.image && <img src={news.image} alt="" loading="lazy" className="hidden h-16 w-24 shrink-0 rounded-lg object-cover sm:block" />}
    </a>
  );
}

export function FeedItemView({ item, onProfile, onTail }: { item: FeedItem; onProfile?: (handle: string) => void; onTail?: (post: PostView) => void }) {
  if (item.kind === "post") return <PickCard post={item.post} onProfile={onProfile} onTail={onTail} />;
  if (item.kind === "event") return <EventCard event={item.event} onProfile={onProfile} />;
  return <NewsCard news={item.news} />;
}

/** Home feed: picks from people you follow (or everyone), big wins, injury news, line moves and headlines. */
export function ActivityFeed({ compact = false, onProfile, onTail, onMore }: { compact?: boolean; onProfile?: (handle: string) => void; onTail?: (post: PostView) => void; onMore?: () => void }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"following" | "all">("all");
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [error, setError] = useState("");
  const feed = useQuery({ queryKey: ["feed", scope, filter], queryFn: () => api.feed(scope, filter), refetchInterval: 60_000 });
  const items = feed.data?.items ?? [];
  async function post(event: FormEvent) {
    event.preventDefault();
    try {
      await api.createPost(draft.trim(), visibility);
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not post");
    }
  }
  if (compact) {
    return (
      <div className="space-y-2.5">
        {feed.isLoading ? <LoadingBlock label="Loading activity…" /> : items.length ? items.slice(0, 5).map((item) => <FeedItemView key={`${item.kind}-${item.kind === "post" ? item.post.id : item.kind === "event" ? item.event.id : item.news.id}`} item={item} onProfile={onProfile} onTail={onTail} />) : <EmptyState>No activity yet.</EmptyState>}
        {onMore && <button type="button" onClick={onMore} className="w-full rounded-lg border border-line py-2.5 text-xs font-semibold text-lime hover:bg-white/[0.03]">Open community feed</button>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Feed scope" value={scope} onChange={setScope} options={[{ value: "all", label: "Everyone" }, { value: "following", label: "Following" }]} />
        <div className="scrollbar-hide flex gap-1 overflow-x-auto">{FILTERS.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} aria-pressed={filter === item.value} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] ${filter === item.value ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>{item.label}</button>)}</div>
      </div>
      <form onSubmit={(event) => void post(event)} className="rounded-2xl border border-line bg-panel p-3">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} rows={2} placeholder="Share a read, a lean or a question. Share picks from the Bet tracker." aria-label="New post" className={`${inputClass} w-full resize-none`} />
        <div className="mt-2 flex items-center justify-between gap-2">
          <select aria-label="Visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)} className={inputClass}><option value="public">Public</option><option value="followers">Followers</option><option value="private">Only me</option></select>
          <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-lime px-4 py-2 text-xs font-bold text-[#11170c] disabled:opacity-50">Post</button>
        </div>
        {error && <p className="mt-1 text-[10px] text-rose-300">{error}</p>}
      </form>
      {feed.isLoading ? <LoadingBlock label="Loading feed…" /> : items.length ? items.map((item) => <FeedItemView key={`${item.kind}-${item.kind === "post" ? item.post.id : item.kind === "event" ? item.event.id : item.news.id}`} item={item} onProfile={onProfile} onTail={onTail} />)
        : <div className="rounded-2xl border border-line bg-panel"><EmptyState>{scope === "following" ? "Follow bettors, teams and players to fill this feed." : "Nothing here yet."}</EmptyState></div>}
    </div>
  );
}
