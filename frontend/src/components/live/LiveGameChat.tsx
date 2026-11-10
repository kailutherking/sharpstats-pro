import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Users } from "lucide-react";
import { api } from "../../lib/api";
import type { League } from "../../lib/statsTypes";
import type { ChatMessage, GameChat, LiveBet, LiveReaction } from "../../lib/socialTypes";
import { useRealtime } from "../../lib/useRealtime";
import { EmptyState, inputClass, Panel } from "../stats/StatsUi";

export const LIVE_EMOJI: Record<LiveReaction, string> = { fire: "🔥", money: "💰", shock: "😱", clap: "👏", cold: "🥶", lock: "🔒" };
const REACTIONS = Object.keys(LIVE_EMOJI) as LiveReaction[];
const chatKey = (league: League, gameId: string) => ["game-chat", league, gameId];

const BET_STYLE: Record<LiveBet["status"], string> = { hit: "text-lime", winning: "text-lime", losing: "text-rose-400", busted: "text-rose-400", unknown: "text-muted" };
const BET_LABEL: Record<LiveBet["status"], string> = { hit: "CASHED", winning: "WINNING", losing: "TRAILING", busted: "BUSTED", unknown: "PENDING" };

/** Reaction buttons on a single play, sharing the chat query's counts. */
export function PlayReactions({ league, gameId, playId }: { league: League; gameId: string; playId: string }) {
  const queryClient = useQueryClient();
  // Subscribes to the chat query that LiveGameChat keeps fresh, so counts update live.
  const { data } = useQuery({ queryKey: chatKey(league, gameId), queryFn: () => api.gameChat(league, gameId), enabled: false });
  const counts = data?.playReactions[playId] ?? {};
  const mine = new Set((data?.mine ?? []).filter((item) => item.playId === playId).map((item) => item.reaction));
  return (
    <span className="ml-2 inline-flex gap-0.5">
      {(["fire", "shock", "clap"] as LiveReaction[]).map((reaction) => (
        <button key={reaction} type="button" disabled={mine.has(reaction)} onClick={() => void api.reactLive(league, gameId, reaction, playId).then(() => queryClient.invalidateQueries({ queryKey: chatKey(league, gameId) }))}
          className={`rounded px-1 text-[10px] ${mine.has(reaction) ? "bg-lime/10" : "opacity-60 hover:opacity-100"}`} aria-label={`React ${reaction} to this play`}>
          {LIVE_EMOJI[reaction]}{counts[reaction] ? <span className="ml-0.5 tabular-nums text-muted">{counts[reaction]}</span> : null}
        </button>
      ))}
    </span>
  );
}

/** Live game room: chat, reactions, who's watching, and your own bets on this game tracked live. */
export function LiveGameChat({ league, gameId, live }: { league: League; gameId: string; live: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [bursts, setBursts] = useState<Array<{ id: number; emoji: string }>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const chat = useQuery({ queryKey: chatKey(league, gameId), queryFn: () => api.gameChat(league, gameId), refetchInterval: 60_000 });
  const bets = useQuery({ queryKey: ["my-live-bets", league, gameId], queryFn: () => api.myLiveBets(league, gameId), refetchInterval: live ? 15_000 : false });
  const update = (fn: (current: GameChat) => GameChat) => queryClient.setQueryData<GameChat>(chatKey(league, gameId), (current) => (current ? fn(current) : current));
  useRealtime(`game:${league}:${gameId}`, {
    chat: (data) => update((current) => ({ ...current, messages: [...current.messages.filter((item) => item.id !== (data as ChatMessage).id), data as ChatMessage].slice(-120) })),
    presence: (data) => update((current) => ({ ...current, viewers: (data as { viewers: number }).viewers })),
    chat_deleted: (data) => update((current) => ({ ...current, messages: current.messages.filter((item) => item.id !== (data as { id: number }).id) })),
    reaction: (data) => {
      const { reaction, playId } = data as { reaction: LiveReaction; playId: string | null };
      update((current) => playId
        ? { ...current, playReactions: { ...current.playReactions, [playId]: { ...current.playReactions[playId], [reaction]: (current.playReactions[playId]?.[reaction] ?? 0) + 1 } } }
        : { ...current, reactions: { ...current.reactions, [reaction]: (current.reactions[reaction] ?? 0) + 1 } });
      if (!playId) {
        const id = Date.now() + Math.random();
        setBursts((current) => [...current.slice(-8), { id, emoji: LIVE_EMOJI[reaction] }]);
        setTimeout(() => setBursts((current) => current.filter((item) => item.id !== id)), 1600);
      }
    },
  });
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat.data?.messages.length]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    try {
      const { message } = await api.sendChat(league, gameId, draft.trim());
      setDraft("");
      setError("");
      update((current) => ({ ...current, messages: [...current.messages.filter((item) => item.id !== message.id), message] }));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not send");
    }
  }
  async function react(reaction: LiveReaction) {
    try {
      const result = await api.reactLive(league, gameId, reaction);
      if (result.added) update((current) => ({ ...current, mine: [...current.mine, { playId: null, reaction }] }));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not react");
    }
  }
  const data = chat.data;
  const mine = new Set((data?.mine ?? []).filter((item) => item.playId === null).map((item) => item.reaction));
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Panel title="Game chat" subtitle={live ? "Talk through the game in real time" : "Chat stays open after the game"} action={<span className="flex items-center gap-1 text-[11px] text-muted"><Users size={12} />{data?.viewers ?? 0} watching</span>} flush>
        <div className="relative">
          <div className="pointer-events-none absolute bottom-2 right-4 z-10 flex flex-col items-end">{bursts.map((burst) => <span key={burst.id} className="animate-bounce text-xl">{burst.emoji}</span>)}</div>
          <div ref={listRef} className="h-[280px] space-y-2 overflow-y-auto px-4 py-3">
            {data?.messages.length ? data.messages.map((message) => (
              <div key={message.id} className="group flex items-start gap-2 text-[12px]">
                <p className="min-w-0 flex-1"><span className={`font-semibold ${message.isMine ? "text-lime" : "text-white"}`}>{message.author.name}</span> <span className="text-[#d9e0dc]">{message.body}</span></p>
                {message.isMine && <button type="button" aria-label="Delete message" onClick={() => void api.deleteChat(message.id).then(() => update((current) => ({ ...current, messages: current.messages.filter((item) => item.id !== message.id) })))} className="text-[#4d595e] opacity-0 hover:text-rose-400 group-hover:opacity-100"><Trash2 size={12} /></button>}
              </div>
            )) : <EmptyState>{live ? "No messages yet. Start the conversation." : "No messages for this game."}</EmptyState>}
          </div>
          <div className="flex flex-wrap gap-1 border-t border-line px-3 py-2">
            {REACTIONS.map((reaction) => (
              <button key={reaction} type="button" onClick={() => void react(reaction)} disabled={mine.has(reaction)} className={`flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-sm ${mine.has(reaction) ? "bg-lime/10" : "hover:bg-white/[0.04]"}`} aria-label={`React ${reaction}`}>
                {LIVE_EMOJI[reaction]}<span className="text-[10px] tabular-nums text-muted">{data?.reactions[reaction] ?? 0}</span>
              </button>
            ))}
          </div>
          <form onSubmit={(event) => void send(event)} className="flex gap-2 border-t border-line p-3">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={280} placeholder="Say something about the game" aria-label="Chat message" className={`${inputClass} min-w-0 flex-1 py-2.5`} />
            <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-lime px-4 text-xs font-bold text-[#11170c] disabled:opacity-50">Send</button>
          </form>
          {error && <p className="px-3 pb-2 text-[10px] text-rose-300">{error}</p>}
        </div>
      </Panel>
      <Panel title="Your bets on this game" subtitle="Pending bets from your Bet tracker, tracked live">
        {bets.data?.bets.length ? (
          <ul className="space-y-2">
            {bets.data.bets.map((bet) => (
              <li key={bet.betId} className="rounded-xl border border-line bg-[#0e1416] p-3">
                <div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold text-white">{bet.selection}{bet.line !== null && !/over|under/i.test(bet.selection) ? ` ${bet.line}` : bet.line !== null ? ` ${bet.line}` : ""}</p><span className={`text-[9px] font-bold ${BET_STYLE[bet.status]}`}>{BET_LABEL[bet.status]}</span></div>
                <p className="mt-0.5 text-[10px] text-muted">{bet.detail} · {bet.odds.toFixed(2)} at {bet.sportsbook}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyState>No pending bets linked to this game. Bets logged from the Odds screen are linked automatically.</EmptyState>}
      </Panel>
    </div>
  );
}
