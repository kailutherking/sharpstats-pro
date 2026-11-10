import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "../../lib/api";
import type { AppNotification, NotificationLink } from "../../lib/socialTypes";
import { useRealtime } from "../../lib/useRealtime";
import { ago } from "./socialUi";

const TYPE_DOT: Record<string, string> = {
  prop_hit: "bg-lime", bet_result: "bg-lime", injury: "bg-rose-400", line_move: "bg-sky-300", odds_change: "bg-sky-300", positive_ev: "bg-emerald-300", arbitrage: "bg-emerald-300",
  follower: "bg-violet-300", following_pick: "bg-violet-300", reaction: "bg-orange-300", comment: "bg-orange-300", streak: "bg-amber-300", achievement: "bg-amber-300", news: "bg-slate-300",
};

/** Header bell: live notifications (prop hits, injuries, line moves, EV, follows, reactions, badges) with unread count. */
export function NotificationCenter({ onNavigate }: { onNavigate: (link: NotificationLink) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications(30), refetchInterval: 120_000 });
  useRealtime(null, {
    notification: (data) => {
      const item = data as AppNotification;
      queryClient.setQueryData<{ notifications: AppNotification[]; unread: number }>(["notifications"], (current) => current
        ? { notifications: [item, ...current.notifications.filter((existing) => existing.id !== item.id)].slice(0, 30), unread: current.unread + 1 }
        : current);
      setToast(item);
      if (item.type === "achievement") void queryClient.invalidateQueries({ queryKey: ["achievements"] });
    },
  });
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const unread = query.data?.unread ?? 0;
  async function markAll() {
    await api.markNotificationsRead("all");
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }
  async function openItem(item: AppNotification) {
    if (!item.readAt) {
      await api.markNotificationsRead([item.id]).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    setOpen(false);
    setToast(null);
    onNavigate(item.link);
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} aria-expanded={open}>
        <Bell size={17} />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-lime px-1 text-[9px] font-bold text-[#11170c]">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-16 z-40 max-h-[70vh] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[380px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && <button type="button" onClick={() => void markAll()} className="flex items-center gap-1 text-[11px] text-lime"><CheckCheck size={13} />Mark all read</button>}
          </div>
          <div className="max-h-[calc(70vh-52px)] overflow-y-auto">
            {(query.data?.notifications ?? []).length ? query.data!.notifications.map((item) => (
              <button key={item.id} type="button" onClick={() => void openItem(item)} className={`flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left last:border-0 hover:bg-white/[0.03] ${item.readAt ? "" : "bg-lime/[0.03]"}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-[#27312a]" : TYPE_DOT[item.type] ?? "bg-lime"}`} />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-white">{item.title}</span>
                  {item.body && <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted">{item.body}</span>}
                  <span className="mt-0.5 block text-[10px] text-[#69757a]">{ago(item.createdAt)} ago</span>
                </span>
              </button>
            )) : <div className="px-4 py-8 text-center"><p className="text-sm font-semibold">You're all caught up</p><p className="mt-1 text-xs text-muted">Prop hits, injury news, line moves and activity on your picks show up here.</p></div>}
          </div>
        </div>
      )}
      {toast && !open && (
        <button type="button" onClick={() => void openItem(toast)} className="fixed bottom-20 right-4 z-[60] w-[min(340px,calc(100vw-2rem))] rounded-xl border border-lime/40 bg-panel p-3 text-left shadow-2xl lg:bottom-4" aria-live="polite">
          <p className="text-xs font-semibold text-white">{toast.title}</p>
          {toast.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{toast.body}</p>}
        </button>
      )}
    </div>
  );
}
