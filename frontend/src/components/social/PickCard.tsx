import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, Flame, Heart, Lock, MessageCircle, Share2, ThumbsDown, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { PostView, Reaction } from "../../lib/socialTypes";
import { inputClass } from "../stats/StatsUi";
import { ago, UserChip, units } from "./socialUi";

const REACTIONS: Array<{ key: Reaction; label: string; icon: typeof Heart; active: string }> = [
  { key: "like", label: "Like", icon: Heart, active: "text-rose-300" },
  { key: "fire", label: "Fire", icon: Flame, active: "text-orange-300" },
  { key: "lock", label: "Lock", icon: Lock, active: "text-lime" },
  { key: "tail", label: "Tail", icon: Copy, active: "text-sky-300" },
  { key: "fade", label: "Fade", icon: ThumbsDown, active: "text-violet-300" },
];

const RESULT_STYLE = { pending: "bg-amber-400/10 text-amber-300", win: "bg-lime/10 text-lime", loss: "bg-rose-400/10 text-rose-400", push: "bg-slate-400/10 text-slate-300" } as const;

function Comments({ postId }: { postId: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["comments", postId], queryFn: () => api.comments(postId) });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    try {
      await api.addComment(postId, draft.trim());
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not comment");
    }
  }
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {(query.data?.comments ?? []).map((comment) => (
        <div key={comment.id} className="flex items-start justify-between gap-2 text-[11px]">
          <p><span className="font-semibold text-white">{comment.author.name}</span> <span className="text-[#c9d2cf]">{comment.body}</span> <span className="text-[10px] text-[#69757a]">{ago(comment.createdAt)}</span></p>
          {comment.isMine && <button type="button" aria-label="Delete comment" onClick={() => void api.deleteComment(comment.id).then(() => queryClient.invalidateQueries({ queryKey: ["comments", postId] }))} className="text-[#4d595e] hover:text-rose-400"><Trash2 size={12} /></button>}
        </div>
      ))}
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder="Add a comment" aria-label="Add a comment" className={`${inputClass} min-w-0 flex-1`} />
        <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-lime px-3 text-[11px] font-bold text-[#11170c] disabled:opacity-50">Post</button>
      </form>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

/** A shared pick or post with reactions (like, fire, lock, tail, fade), comments and share. */
export function PickCard({ post, onProfile, onTail, onChanged }: { post: PostView; onProfile?: (handle: string) => void; onTail?: (post: PostView) => void; onChanged?: (post: PostView | null) => void }) {
  const [current, setCurrent] = useState(post);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const pick = current.pick;
  async function toggle(reaction: Reaction) {
    const enabled = !current.mine.includes(reaction);
    try {
      const { post: next } = await api.react(current.id, reaction, enabled);
      setCurrent(next);
      onChanged?.(next);
      if (reaction === "tail" && enabled && onTail && pick?.result === "pending") onTail(next);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not react");
    }
  }
  async function share() {
    const text = pick ? `${current.author.name} on SharpStats: ${pick.selection ?? ""}${pick.line !== null ? ` ${pick.line}` : ""} @ ${pick.odds?.toFixed(2)} (${pick.event ?? ""})` : `${current.author.name} on SharpStats: ${current.body}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setNote("Copied to clipboard."); }
    } catch { /* share sheet dismissed */ }
  }
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <UserChip name={current.author.name} handle={current.author.handle} avatarUrl={current.author.avatarUrl} onOpen={onProfile} sub={ago(current.createdAt)} />
        <div className="flex items-center gap-1.5">
          {current.visibility !== "public" && <span className="rounded-md bg-[#1b2428] px-1.5 py-0.5 text-[9px] text-muted">{current.visibility === "followers" ? "Followers" : "Private"}</span>}
          {current.isMine && <button type="button" aria-label="Delete" onClick={() => void api.deletePost(current.id).then(() => onChanged?.(null))} className="rounded-md p-1 text-[#4d595e] hover:text-rose-400"><Trash2 size={13} /></button>}
        </div>
      </div>
      {pick && (
        <div className="mt-3 rounded-xl border border-line bg-[#0e1416] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">{[pick.league || pick.sport, pick.betType].filter(Boolean).join(" · ")}</p>
            <div className="flex items-center gap-1.5">
              {pick.locked && pick.autoGraded && <span title="Shared before the game started and graded from the final score" className="inline-flex items-center gap-0.5 rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300"><BadgeCheck size={10} />VERIFIED</span>}
              {pick.locked && !pick.autoGraded && <span title="Shared before the game started" className="rounded-md bg-[#1b2428] px-1.5 py-0.5 text-[9px] font-bold text-[#c9d2cf]">LOCKED PRE-GAME</span>}
              <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${RESULT_STYLE[pick.result]}`}>{pick.result}{pick.resultUnits !== null ? ` ${units(pick.resultUnits)}` : ""}</span>
            </div>
          </div>
          <p className="mt-1.5 text-sm font-bold text-white">{pick.selection}{pick.line !== null ? ` ${pick.line > 0 ? "+" : ""}${pick.line}` : ""} <span className="text-lime">@ {pick.odds?.toFixed(2)}</span></p>
          <p className="mt-0.5 text-[11px] text-muted">{pick.event} · {pick.units}u · {pick.sportsbook}{pick.eventStart ? ` · ${new Date(pick.eventStart).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</p>
        </div>
      )}
      {current.body && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#d9e0dc]">{current.body}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {REACTIONS.filter((item) => pick || (item.key !== "tail" && item.key !== "fade")).map((item) => {
          const active = current.mine.includes(item.key);
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" onClick={() => void toggle(item.key)} aria-pressed={active} title={item.key === "tail" ? "Tail: bet the same side (opens the bet slip)" : item.key === "fade" ? "Fade: bet against it" : item.label}
              className={`flex min-h-[32px] items-center gap-1 rounded-lg px-2.5 text-[11px] transition hover:bg-white/[0.04] ${active ? item.active : "text-muted"}`}>
              <Icon size={13} className={active && item.key !== "tail" && item.key !== "fade" ? "fill-current" : ""} />{item.label}{current.reactions[item.key] ? <span className="tabular-nums">{current.reactions[item.key]}</span> : null}
            </button>
          );
        })}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-[32px] items-center gap-1 rounded-lg px-2.5 text-[11px] text-muted hover:bg-white/[0.04]"><MessageCircle size={13} />{current.comments || ""} Comment</button>
        <button type="button" onClick={() => void share()} className="ml-auto flex min-h-[32px] items-center gap-1 rounded-lg px-2.5 text-[11px] text-muted hover:bg-white/[0.04]"><Share2 size={13} />Share</button>
      </div>
      {note && <p className="mt-1 text-[10px] text-muted">{note}</p>}
      {open && <Comments postId={current.id} />}
    </article>
  );
}
