import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, GitCompare, Star } from "lucide-react";

export function Panel({ title, subtitle, action, children, className = "", flush = false }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-line bg-panel ${className}`}>
      {(title || action) && (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${flush ? "border-b border-line px-4 py-4 sm:px-5" : "px-4 pt-4 sm:px-5 sm:pt-5"}`}>
          <div>
            {title && <p className="text-sm font-semibold">{title}</p>}
            {subtitle && <p className="mt-1 text-[11px] text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** Headshot or logo with an initials fallback when the image is missing or fails to load. */
export function Avatar({ src, name, size = 32, square = false }: { src: string | null | undefined; name: string; size?: number; square?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const shape = square ? "rounded-lg" : "rounded-full";
  if (!src || failed) {
    return <div style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center ${shape} bg-[#20292e] text-[10px] font-bold text-lime`}>{initials}</div>;
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size }} className={`shrink-0 ${shape} bg-[#131a1d] object-cover`} />;
}

export function FavoriteButton({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      aria-pressed={active}
      aria-label={active ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      className={`rounded-md p-1 transition hover:bg-white/5 ${active ? "text-lime" : "text-[#4d595e] hover:text-white"}`}
    >
      <Star size={14} className={active ? "fill-lime" : ""} />
    </button>
  );
}

export function CompareToggle({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      aria-pressed={active}
      aria-label={active ? `Remove ${label} from compare` : `Add ${label} to compare`}
      title={active ? "Remove from compare" : "Add to compare"}
      className={`rounded-md p-1 transition hover:bg-white/5 ${active ? "bg-lime/10 text-lime" : "text-[#4d595e] hover:text-white"}`}
    >
      <GitCompare size={14} />
    </button>
  );
}

export function SortHeader({ label, title, active, direction, onClick, align = "right" }: { label: string; title?: string; active: boolean; direction: "asc" | "desc"; onClick: () => void; align?: "left" | "right" }) {
  return (
    <th className={`whitespace-nowrap px-3 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={onClick} title={title} className={`inline-flex items-center gap-1 tracking-wider ${active ? "text-lime" : "hover:text-white"}`}>
        {label}
        {active && (direction === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </button>
    </th>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[120px] items-center justify-center px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function LoadingBlock({ label = "Loading statistics…" }: { label?: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-panel text-sm text-muted">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#27312a] border-t-lime" />
      {label}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap rounded-lg border border-line bg-[#0c1114] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${value === option.value ? "bg-[#27312a] text-lime" : "text-muted hover:text-white"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label, value, sub, highlight = false }: { label: string; value: string; sub?: ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 ${highlight ? "border-[#34412a] bg-[#182017]" : "border-line bg-[#0e1416]"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1.5 font-display text-lg font-bold ${highlight ? "text-lime" : "text-white"}`}>{value}</p>
      {sub && <div className="mt-1 text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

export const inputClass = "rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs text-white outline-none focus:border-lime";
export const thClass = "text-[9px] font-semibold tracking-wider text-[#738087]";
