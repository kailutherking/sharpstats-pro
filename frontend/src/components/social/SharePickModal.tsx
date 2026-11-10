import { useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import type { Bet } from "../../lib/types";
import type { Visibility } from "../../lib/socialTypes";
import { inputClass } from "../stats/StatsUi";

/** Shares a pending tracked bet as a pick. Size is shown in units; dollar stakes stay private. */
export function SharePickModal({ bet, onClose, onShared }: { bet: Bet; onClose: () => void; onShared: () => void }) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.sharePick(bet.id, body.trim(), visibility);
      onShared();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not share this pick");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Share pick" onClick={onClose}>
      <form onSubmit={(event) => void submit(event)} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-t-2xl border border-line bg-panel p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-lime">SHARE PICK</p><h3 className="font-display text-lg font-bold">{bet.selection || bet.team_player || bet.event}</h3><p className="mt-0.5 text-[11px] text-muted">{bet.event} · {Number(bet.odds).toFixed(2)} · {bet.sportsbook}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-line p-2 text-muted hover:text-white"><X size={14} /></button>
        </div>
        <label className="mt-4 block text-xs text-muted">Why you like it (optional)
          <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} rows={3} className={`${inputClass} mt-1.5 w-full resize-none`} placeholder="Matchup edge, injury angle, line value…" />
        </label>
        <label className="mt-3 block text-xs text-muted">Who can see it
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)} className={`${inputClass} mt-1.5 w-full`}>
            <option value="public">Public: feed, profile and leaderboards</option>
            <option value="followers">Followers only</option>
            <option value="private">Only me</option>
          </select>
        </label>
        <p className="mt-3 text-[10px] leading-relaxed text-[#69757a]">Picks show size in units, never dollars. A pick shared before the game starts is marked locked; it becomes verified when the result is graded from the final score. Only public picks count toward leaderboards.</p>
        {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
        <button type="submit" disabled={busy} className="mt-4 w-full rounded-xl bg-lime py-3 text-sm font-bold text-[#11170c] disabled:opacity-60">{busy ? "Sharing…" : "Share pick"}</button>
      </form>
    </div>
  );
}
