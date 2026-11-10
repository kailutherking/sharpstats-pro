import { CheckCircle2, Circle, X } from "lucide-react";
import type { MyProfile } from "../../lib/socialTypes";

const TARGET: Record<string, string> = { profile: "Settings", follow: "Stats", alert: "Odds screen", pick: "Bet tracker" };

/** First-run checklist on the dashboard; hides itself once done or dismissed. */
export function OnboardingChecklist({ me, onGo, onDismiss }: { me: MyProfile; onGo: (page: string) => void; onDismiss: () => void }) {
  const steps = me.onboarding.steps;
  const done = steps.filter((step) => step.done).length;
  if (me.onboarding.dismissed || done === steps.length) return null;
  return (
    <div className="mb-4 rounded-2xl border border-[#34412a] bg-[#182017] p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-semibold text-white">Get set up</p><p className="mt-0.5 text-[11px] text-[#a2ad9b]">{done} of {steps.length} done · each step earns XP and makes your feed and alerts useful</p></div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss setup checklist" className="rounded-md p-1 text-[#a2ad9b] hover:text-white"><X size={14} /></button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <button key={step.key} type="button" disabled={step.done} onClick={() => onGo(TARGET[step.key] ?? "Overview")} className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${step.done ? "border-lime/30 text-lime" : "border-line bg-panel text-white hover:border-[#536048]"}`}>
            {step.done ? <CheckCircle2 size={15} /> : <Circle size={15} className="text-muted" />}{step.label}
          </button>
        ))}
      </div>
    </div>
  );
}
