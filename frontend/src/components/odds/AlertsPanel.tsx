import { useState } from "react";
import type { FormEvent } from "react";
import { Bell, Trash2 } from "lucide-react";
import type { AlertRule, AlertRuleInput, AlertType, BookInfo, MarketInfo, OddsAlert, OddsSport } from "../../lib/oddsTypes";
import { timeAgo } from "../../lib/oddsFormat";
import { EmptyState, inputClass, Panel, Segmented } from "../stats/StatsUi";

export const ALERT_LABELS: Record<AlertType, string> = {
  line_move: "Line movement",
  steam: "Steam move",
  sharp: "Sharp action",
  reverse_move: "Reverse line move",
  positive_ev: "Positive EV",
  arbitrage: "Arbitrage",
  best_price: "Best available price",
  clv: "CLV opportunity",
};

const SEVERITY = { info: "border-line", notice: "border-[#34412a]", high: "border-lime/60" } as const;
const VALUE_HINT: Partial<Record<AlertType, string>> = { positive_ev: "Min EV % (e.g. 3)", arbitrage: "Min profit % (e.g. 1)", line_move: "Min implied move % (e.g. 3)", best_price: "Min edge vs avg %" };

export function AlertsPanel({ alerts, rules, sport, markets, books, mine, onMine, onCreate, onToggle, onDelete, onOpen }: {
  alerts: OddsAlert[];
  rules: AlertRule[];
  sport: OddsSport;
  markets: MarketInfo[];
  books: BookInfo[];
  mine: boolean;
  onMine: (value: boolean) => void;
  onCreate: (rule: AlertRuleInput) => Promise<void>;
  onToggle: (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
  onOpen: (alert: OddsAlert) => void;
}) {
  const [type, setType] = useState<AlertType | "all">("all");
  const [draft, setDraft] = useState({ name: "", type: "positive_ev" as AlertType, market: "", book: "", query: "", minValue: "", allSports: false });
  const [error, setError] = useState("");
  const visible = alerts.filter((alert) => type === "all" || alert.type === type);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const percentTypes: AlertType[] = ["positive_ev", "arbitrage", "line_move", "best_price"];
    const raw = draft.minValue.trim() === "" ? null : Number(draft.minValue);
    if (raw !== null && !Number.isFinite(raw)) { setError("Enter a number for the threshold."); return; }
    try {
      await onCreate({
        name: draft.name.trim() || `${ALERT_LABELS[draft.type]}${draft.query ? ` · ${draft.query}` : ""}`,
        type: draft.type,
        sport: draft.allSports ? null : sport,
        market: draft.market || null,
        book: draft.book || null,
        query: draft.query.trim() || null,
        minValue: raw === null ? null : percentTypes.includes(draft.type) ? raw / 100 : raw,
      });
      setDraft({ ...draft, name: "", query: "", minValue: "" });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save the alert rule");
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <Panel title="Real-time alerts" subtitle="Line moves, steam, sharp action, +EV, arbitrage, best prices and CLV — pushed live as prices change"
        action={<Segmented label="Alert scope" value={mine ? "mine" : "all"} onChange={(value) => onMine(value === "mine")} options={[{ value: "all", label: "All alerts" }, { value: "mine", label: "Matching my rules" }]} />}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["all", ...Object.keys(ALERT_LABELS)] as Array<AlertType | "all">).map((key) => (
            <button key={key} type="button" onClick={() => setType(key)} className={`rounded-lg border px-2.5 py-1 text-[10px] ${type === key ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
              {key === "all" ? "All" : ALERT_LABELS[key]} {key !== "all" && <span className="text-muted">{alerts.filter((alert) => alert.type === key).length}</span>}
            </button>
          ))}
        </div>
        {!visible.length ? <EmptyState>{mine ? "No alerts matched your rules in the last 24 hours." : "No alerts in the last 24 hours. New alerts appear here instantly."}</EmptyState> : (
          <ul className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {visible.map((alert) => (
              <li key={alert.id}>
                <button type="button" onClick={() => onOpen(alert)} className={`w-full rounded-xl border bg-[#0e1416] px-3.5 py-3 text-left hover:bg-white/[0.02] ${SEVERITY[alert.severity]}`}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded-md bg-[#1b2428] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#c9d2cf]">{ALERT_LABELS[alert.type]}</span>
                      <span className="truncate text-xs font-semibold text-white">{alert.title}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">{timeAgo(alert.createdAt)}</span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-[#a9b5b4]">{alert.message}</span>
                  <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">{alert.game}{alert.matchedRules?.length ? <span className="flex items-center gap-1 text-lime"><Bell size={10} />Matches {alert.matchedRules.length} rule{alert.matchedRules.length === 1 ? "" : "s"}</span> : null}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="space-y-4">
        <Panel title="Custom alerts" subtitle="Get notified (in-app, live) when an alert matches">
          <form onSubmit={(event) => void submit(event)} className="grid gap-2.5">
            <input aria-label="Rule name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Rule name (optional)" maxLength={60} className={inputClass} />
            <div className="grid grid-cols-2 gap-2.5">
              <select aria-label="Alert type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as AlertType })} className={inputClass}>
                {(Object.keys(ALERT_LABELS) as AlertType[]).map((key) => <option key={key} value={key}>{ALERT_LABELS[key]}</option>)}
              </select>
              <select aria-label="Market" value={draft.market} onChange={(event) => setDraft({ ...draft, market: event.target.value })} className={inputClass}>
                <option value="">Any market</option>
                {markets.map((market) => <option key={market.key} value={market.key}>{market.label}</option>)}
              </select>
              <select aria-label="Sportsbook" value={draft.book} onChange={(event) => setDraft({ ...draft, book: event.target.value })} className={inputClass}>
                <option value="">Any sportsbook</option>
                {books.filter((book) => !book.retired).map((book) => <option key={book.key} value={book.key}>{book.name}</option>)}
              </select>
              <input aria-label="Threshold" value={draft.minValue} onChange={(event) => setDraft({ ...draft, minValue: event.target.value })} placeholder={VALUE_HINT[draft.type] ?? "Min value (optional)"} inputMode="decimal" className={inputClass} />
            </div>
            <input aria-label="Team, player or keyword" value={draft.query} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="Team, player or keyword (optional)" maxLength={60} className={inputClass} />
            <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={draft.allSports} onChange={(event) => setDraft({ ...draft, allSports: event.target.checked })} className="accent-[#c5f467]" />All sports (otherwise {sport.toUpperCase()} only)</label>
            {error && <p className="text-[11px] text-rose-300">{error}</p>}
            <button type="submit" className="rounded-lg bg-lime px-4 py-2 text-xs font-bold text-[#11170c]">Create alert</button>
          </form>
        </Panel>
        <Panel title="Your alert rules" flush>
          {!rules.length ? <EmptyState>No custom alerts yet.</EmptyState> : (
            <ul className="divide-y divide-line">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{rule.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted">{ALERT_LABELS[rule.type]} · {rule.sport?.toUpperCase() ?? "All sports"}{rule.market ? ` · ${markets.find((market) => market.key === rule.market)?.label ?? rule.market}` : ""}{rule.book ? ` · ${books.find((book) => book.key === rule.book)?.name ?? rule.book}` : ""}{rule.query ? ` · “${rule.query}”` : ""}{rule.minValue !== null ? ` · ≥ ${["positive_ev", "arbitrage", "line_move", "best_price"].includes(rule.type) ? `${(rule.minValue * 100).toFixed(1)}%` : rule.minValue}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" role="switch" aria-checked={rule.active} aria-label={`${rule.active ? "Pause" : "Resume"} ${rule.name}`} onClick={() => onToggle(rule)} className={`h-5 w-9 rounded-full p-0.5 transition ${rule.active ? "bg-lime" : "bg-[#27312a]"}`}><span className={`block h-4 w-4 rounded-full bg-[#0b0f12] transition ${rule.active ? "translate-x-4" : ""}`} /></button>
                    <button type="button" onClick={() => onDelete(rule)} aria-label={`Delete ${rule.name}`} className="rounded-md p-1.5 text-muted hover:text-rose-300"><Trash2 size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
