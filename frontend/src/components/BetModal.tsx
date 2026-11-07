import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { Bet } from "../lib/types";

const fieldClass = "mt-1.5 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none transition focus:border-lime";
const currency = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BetModal({ onClose, onSaved, initialBet }: { onClose: () => void; onSaved: () => void; initialBet?: Partial<Bet> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [odds, setOdds] = useState(String(initialBet?.odds ?? ""));
  const [stake, setStake] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries()) as Partial<Bet>;
    try {
      await api.createBet(body);
      onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save bet");
    } finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-panel p-5 sm:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between"><div><p className="text-xs text-lime">BET TRACKER</p><h2 className="mt-1 font-display text-xl font-bold">Log a bet</h2></div><button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" aria-label="Close"><X size={18} /></button></div>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-muted">Sport<input name="sport" required placeholder="NBA" defaultValue={initialBet?.sport} className={fieldClass} /></label>
          <label className="text-xs text-muted">League<input name="league" placeholder="NBA" defaultValue={initialBet?.league} className={fieldClass} /></label>
          <label className="text-xs text-muted sm:col-span-2">Event<input name="event" required placeholder="Celtics vs. Knicks" defaultValue={initialBet?.event} className={fieldClass} /></label>
          <label className="text-xs text-muted">Bet type<select name="bet_type" defaultValue={initialBet?.bet_type ?? "Moneyline"} className={fieldClass}><option>Moneyline</option><option>Spread</option><option>Over/Under</option><option>Player Props</option><option>Parlay</option><option>Other</option></select></label>
          <label className="text-xs text-muted">Team / player<input name="team_player" placeholder="Pick" defaultValue={initialBet?.team_player} className={fieldClass} /></label>
          <label className="text-xs text-muted">Decimal odds<input name="odds" type="number" step="0.01" min="1.01" required placeholder="1.91" value={odds} onChange={(event) => setOdds(event.target.value)} className={fieldClass} /></label>
          <label className="text-xs text-muted">Stake ($)<input name="stake" type="number" step="0.01" min="0.01" required placeholder="50" value={stake} onChange={(event) => setStake(event.target.value)} className={fieldClass} /></label>
          <div className="rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-xs text-muted sm:col-span-2">Potential payout <span className="ml-2 font-semibold text-lime">{Number(odds) > 1 && Number(stake) > 0 ? currency(Number(odds) * Number(stake)) : "Enter odds and stake"}</span><span className="ml-3 text-muted">· Profit if won: {Number(odds) > 1 && Number(stake) > 0 ? currency((Number(odds) - 1) * Number(stake)) : "—"}</span></div>
          <label className="text-xs text-muted">Closing odds (optional)<input name="closing_odds" type="number" step="0.01" min="1.01" placeholder="For CLV tracking" className={fieldClass} /></label>
          <label className="text-xs text-muted">Sportsbook<input name="sportsbook" required placeholder="DraftKings" defaultValue={initialBet?.sportsbook} className={fieldClass} /></label>
          <label className="text-xs text-muted">Result<select name="result" className={fieldClass}><option value="pending">Pending</option><option value="win">Win</option><option value="loss">Loss</option><option value="push">Push</option></select></label>
          <label className="text-xs text-muted">Date<input name="bet_date" type="datetime-local" defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} className={fieldClass} /></label>
          <label className="text-xs text-muted">Market key<select name="market_key" defaultValue={initialBet?.market_key ?? (initialBet?.bet_type === "Spread" ? "spreads" : initialBet?.bet_type === "Over/Under" ? "totals" : "h2h")} className={fieldClass}><option value="h2h">Moneyline (h2h)</option><option value="spreads">Spread</option><option value="totals">Total</option><option value="player_points">Player points</option><option value="player_rebounds">Player rebounds</option><option value="player_assists">Player assists</option><option value="player_threes">Player threes</option><option value="player_points_rebounds_assists">Player P+R+A</option></select></label>
          <label className="text-xs text-muted">Selection / side<input name="selection" placeholder="Team, Over, Under..." defaultValue={initialBet?.selection ?? initialBet?.team_player} className={fieldClass} /></label>
          <label className="text-xs text-muted">Line / prop threshold<input name="line_value" type="number" step="0.01" placeholder="e.g. -3.5 or 24.5" defaultValue={initialBet?.line_value ?? ""} className={fieldClass} /></label>
          <label className="text-xs text-muted">Provider event ID (optional)<input name="event_id" placeholder="Used for exact score matching" defaultValue={initialBet?.event_id ?? ""} className={fieldClass} /></label>
          <label className="text-xs text-muted sm:col-span-2">Notes<textarea name="notes" rows={2} placeholder="Optional notes..." className={fieldClass} /></label>
          {error && <p className="text-sm text-rose-400 sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2.5 text-sm text-muted hover:text-white">Cancel</button><button disabled={saving} className="rounded-lg bg-lime px-5 py-2.5 text-sm font-bold text-[#11170c] disabled:opacity-60">{saving ? "Saving..." : "Save bet"}</button></div>
        </form>
      </div>
    </div>
  );
}
