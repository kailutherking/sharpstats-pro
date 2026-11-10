import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowDownToLine, ArrowUpRight, BarChart3, Bell, Bookmark, BrainCircuit, Calculator, CircleHelp,
  Compass, FileSpreadsheet, Gauge, HeartPulse, LayoutDashboard, LogOut, Menu, Moon, Plus, Search, Settings2,
  ShieldAlert, Sparkles, Sun, Target, Trophy, Wallet, X, Zap,
} from "lucide-react";
import { api, tokenStore } from "./lib/api";
import type { Bet, Performance, Summary, User } from "./lib/types";
import { PerformanceChart } from "./components/Charts";
import { StatCard } from "./components/StatCard";
import { BetModal } from "./components/BetModal";
import { MarketLab } from "./components/MarketLab";
import { useAuthStore } from "./lib/authStore";

const StatsPage = lazy(() => import("./pages/StatsPage").then((module) => ({ default: module.StatsPage })));
const OddsPage = lazy(() => import("./pages/OddsPage").then((module) => ({ default: module.OddsPage })));
const InjuryReportPage = lazy(() => import("./pages/InjuryReportPage").then((module) => ({ default: module.InjuryReportPage })));

type Page = "Overview" | "Bet tracker" | "Analytics" | "Odds screen" | "Stats" | "Injury report" | "Market lab" | "Parlay builder" | "Bankroll" | "Pick analysis" | "Settings";
const navigation: { name: Page; icon: typeof LayoutDashboard; section: string }[] = [
  { name: "Overview", icon: LayoutDashboard, section: "WORKSPACE" },
  { name: "Bet tracker", icon: FileSpreadsheet, section: "WORKSPACE" },
  { name: "Analytics", icon: BarChart3, section: "WORKSPACE" },
  { name: "Odds screen", icon: Compass, section: "RESEARCH" },
  { name: "Stats", icon: Trophy, section: "RESEARCH" },
  { name: "Injury report", icon: HeartPulse, section: "RESEARCH" },
  { name: "Market lab", icon: BrainCircuit, section: "RESEARCH" },
  { name: "Parlay builder", icon: Zap, section: "RESEARCH" },
  { name: "Pick analysis", icon: Target, section: "RESEARCH" },
  { name: "Bankroll", icon: Wallet, section: "TOOLS" },
  { name: "Settings", icon: Settings2, section: "TOOLS" },
];
const currency = (value: number | string) => `${Number(value) < 0 ? "-" : ""}$${Math.abs(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

function Login({ onLogin }: { onLogin: (user: User, token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = mode === "login"
        ? await api.login(String(data.get("email")), String(data.get("password")))
        : await api.register(String(data.get("username")), String(data.get("email")), String(data.get("password")));
      onLogin(response.user, response.token);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Unable to sign in"); }
    finally { setBusy(false); }
  }
  return <div className="flex min-h-screen items-center justify-center bg-canvas p-4"><div className="w-full max-w-md rounded-3xl border border-line bg-panel p-8 shadow-2xl">
    <Brand large /><div className="mt-9"><h1 className="font-display text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h1><p className="mt-2 text-sm text-muted">Your edge starts with better data.</p></div>
    <form onSubmit={submit} className="mt-7 space-y-4">
      {mode === "register" && <label className="block text-xs text-muted">Username<input name="username" required minLength={2} maxLength={40} className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-white outline-none focus:border-lime" /></label>}
      <label className="block text-xs text-muted">Email<input name="email" type="email" required defaultValue={mode === "login" ? "demo@sharpstats.pro" : ""} className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-white outline-none focus:border-lime" /></label>
      <label className="block text-xs text-muted">Password<input name="password" type="password" required minLength={8} defaultValue={mode === "login" ? "SharpStats123!" : ""} className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-white outline-none focus:border-lime" /></label>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-lime py-3 text-sm font-bold text-[#11170c] disabled:opacity-60">{busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    <p className="mt-5 text-center text-sm text-muted">{mode === "login" ? "New to SharpStats?" : "Already have an account?"} <button className="font-semibold text-lime" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create account" : "Sign in"}</button></p>
    <p className="mt-7 border-t border-line pt-5 text-center text-[11px] leading-relaxed text-muted">Analytics only. Betting involves risk. Please play responsibly.</p>
  </div></div>;
}

function Brand({ large = false }: { large?: boolean }) {
  return <div className="flex items-center gap-2.5"><div className={`flex items-center justify-center rounded-xl bg-lime text-[#10160c] ${large ? "h-11 w-11" : "h-9 w-9"}`}><Activity size={large ? 24 : 20} strokeWidth={2.8} /></div><div><p className="font-display text-[15px] font-extrabold tracking-tight text-white">sharpstats<span className="text-lime">.</span></p>{large && <p className="text-[9px] font-bold tracking-[0.2em] text-muted">PRO ANALYTICS</p>}</div></div>;
}

function App() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearSession = useAuthStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState<Page>("Overview");
  const [search, setSearch] = useState("");
  const [betModal, setBetModal] = useState(false);
  const [betDraft, setBetDraft] = useState<Partial<Bet> | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const [range, setRange] = useState<"weekly" | "monthly">("monthly");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const summaryQuery = useQuery({ queryKey: ["summary"], queryFn: api.summary, enabled: Boolean(user) });
  const performanceQuery = useQuery({ queryKey: ["performance"], queryFn: api.performance, enabled: Boolean(user) });
  const betsQuery = useQuery({ queryKey: ["bets", search], queryFn: () => api.bets(search), enabled: Boolean(user) });
  const summary = summaryQuery.data ?? null;
  const performance = performanceQuery.data ?? null;
  const bets = useMemo(() => betsQuery.data?.bets ?? [], [betsQuery.data]);
  const error = [summaryQuery.error, performanceQuery.error, betsQuery.error]
    .find((issue) => issue instanceof Error)?.message ?? "";
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["performance"] }),
      queryClient.invalidateQueries({ queryKey: ["bets"] }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) { setBooting(false); return; }
    api.me().then(({ user: current }) => setUser(current)).catch(() => tokenStore.clear()).finally(() => setBooting(false));
  }, [setUser]);
  useEffect(() => {
    const expireSession = () => clearSession();
    window.addEventListener("sharpstats:unauthorized", expireSession);
    return () => window.removeEventListener("sharpstats:unauthorized", expireSession);
  }, [clearSession]);

  const latestBets = useMemo(() => bets.slice(0, 5), [bets]);
  function loggedIn(nextUser: User, token: string) { tokenStore.set(token); setUser(nextUser); }
  function logout() {
    void api.logout().catch(() => undefined).finally(() => {
      clearSession();
      queryClient.clear();
      setPage("Overview");
    });
  }
  if (booting) return <div className="flex min-h-screen items-center justify-center bg-canvas text-lime"><Activity className="animate-pulse" /></div>;
  if (!user) return <Login onLogin={loggedIn} />;

  const nav = (items: typeof navigation) => items.map((item, index) => {
    const previous = items[index - 1];
    const Icon = item.icon;
    return <div key={item.name}>{item.section !== previous?.section && <p className="mb-2 mt-7 px-3 text-[9px] font-bold tracking-[0.18em] text-[#657177]">{item.section}</p>}
      <button onClick={() => { setPage(item.name); setMenuOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition ${page === item.name ? "bg-[#202b24] font-semibold text-lime" : "text-[#a2abad] hover:bg-white/[0.04] hover:text-white"}`}><Icon size={17} strokeWidth={1.8} />{item.name}{item.name === "Odds screen" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_#c5f467]" />}</button>
    </div>;
  });

  return <div className={dark ? "min-h-screen bg-canvas text-white" : "light-mode min-h-screen bg-[#f3f5f2] text-[#16201a]"}>
    {menuOpen && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-[#0e1316] px-4 py-5 transition-transform lg:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-1"><Brand /><button className="text-muted lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close"><X size={18} /></button></div>
      <div className="mt-8 rounded-xl border border-line bg-[#131a1d] p-3"><div className="flex items-center justify-between"><div><p className="text-[10px] text-muted">YOUR BANKROLL</p><p className="mt-1.5 font-display text-xl font-bold">{currency(summary?.bankroll.current_bankroll ?? 0)}</p></div><div className="rounded-lg bg-lime/10 p-2 text-lime"><Wallet size={17} /></div></div><div className="mt-3 flex items-center gap-1 text-[10px] text-lime"><ArrowUpRight size={13} />{currency(summary?.total_pl ?? 0)} all-time profit</div></div>
      <nav className="scrollbar-hide mt-2 min-h-0 flex-1 overflow-y-auto">{nav(navigation)}</nav>
      <div className="mt-4 rounded-xl border border-[#34412a] bg-[#1a2118] p-3.5"><div className="flex items-center gap-2 text-lime"><Sparkles size={15} /><span className="text-xs font-semibold">Sharp Insights</span></div><p className="mt-2 text-[11px] leading-relaxed text-[#a2ad9b]">{performance?.bySport[0] ? `${performance.bySport[0].name} currently leads your settled bets by net profit (${currency(performance.bySport[0].profit_loss)}).` : "Settle more bets to surface performance patterns from your history."}</p><button onClick={() => setPage("Analytics")} className="mt-2 text-[10px] font-semibold text-lime">View analysis <span aria-hidden>→</span></button></div>
      <button onClick={logout} className="mt-4 flex items-center gap-2 px-2 py-2 text-xs text-muted hover:text-white"><LogOut size={15} />Sign out</button>
    </aside>
    <main className="min-h-screen lg:ml-[248px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-line bg-[#0b0f12]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
        <div className="flex items-center gap-3"><button onClick={() => setMenuOpen(true)} className="text-muted lg:hidden" aria-label="Open menu"><Menu size={20} /></button><div className="hidden items-center gap-2 text-xs text-muted sm:flex"><span>Workspace</span><span className="text-[#4d595e]">/</span><span className="font-medium text-white">{page}</span></div><h1 className="font-display text-sm font-bold sm:hidden">{page}</h1></div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative hidden w-52 md:block"><Search className="absolute left-3 top-2.5 text-muted" size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bets..." className="w-full rounded-lg border border-line bg-[#11171b] py-2 pl-9 pr-12 text-xs outline-none focus:border-[#536048]" /><kbd className="absolute right-2 top-2 rounded border border-line px-1 text-[9px] text-muted">⌘ K</kbd></div>
          <button onClick={() => setDark(!dark)} className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <div className="relative"><button onClick={() => setNotificationOpen(!notificationOpen)} className="relative rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" aria-label="Notifications"><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-lime" /></button>{notificationOpen && <div className="absolute right-0 top-12 z-30 w-64 rounded-xl border border-line bg-panel p-4 shadow-xl"><p className="text-sm font-semibold">You’re all caught up</p><p className="mt-1 text-xs text-muted">New performance alerts will show here.</p></div>}</div>
          <div className="ml-1 hidden h-8 w-8 items-center justify-center rounded-full bg-[#31402c] text-xs font-bold text-lime sm:flex">{user.username.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>
      {error && <div className="mx-4 mt-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300 sm:mx-8">{error} <button onClick={() => void refresh()} className="ml-2 underline">Retry</button></div>}
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8 lg:px-9">
        {page === "Overview" && <section>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#36412d] bg-[#192017] px-2.5 py-1 text-[10px] font-semibold text-lime"><span className="h-1.5 w-1.5 rounded-full bg-lime" />LIVE DASHBOARD</div><h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-[30px]">Good morning, {user.username.split(" ")[0]} <span>👋</span></h2><p className="mt-1.5 text-sm text-muted">Here’s your betting performance at a glance.</p></div><button onClick={() => setBetModal(true)} className="flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-xs font-bold text-[#11170c] transition hover:bg-[#d4ff85]"><Plus size={16} />Log a bet</button></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <StatCard title="Net profit" value={currency(summary?.total_pl ?? 0)} note="All-time settled bets" icon={<ArrowUpRight size={18} />} positive={Number(summary?.total_pl ?? 0) >= 0} />
            <StatCard title="Return on investment" value={percent(summary?.roi ?? 0)} note="Yield on settled stake" icon={<Activity size={18} />} positive={(summary?.roi ?? 0) >= 0} />
            <StatCard title="Win rate" value={`${(summary?.win_rate ?? 0).toFixed(1)}%`} note={`${summary?.wins ?? 0} wins · ${summary?.decisions ?? 0} decisions`} icon={<Target size={18} />} />
            <StatCard title="Units won" value={`${(Number(summary?.total_pl ?? 0) / Math.max(1, Number(summary?.bankroll.unit_size ?? 25))).toFixed(1)}u`} note={`$${summary?.bankroll.unit_size ?? 25} per unit`} icon={<Gauge size={18} />} positive={Number(summary?.total_pl ?? 0) >= 0} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
            <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Performance</p><p className="mt-1 text-[11px] text-muted">Your cumulative profit over time</p></div><div className="flex rounded-lg border border-line bg-[#0c1114] p-1">{(["weekly", "monthly"] as const).map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-md px-3 py-1.5 text-[10px] capitalize ${range === item ? "bg-[#27312a] text-lime" : "text-muted"}`}>{item}</button>)}</div></div><div className="mt-5"><PerformanceChart performance={performance} period={range} /></div></div>
            <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Quick stats</p><p className="mt-1 text-[11px] text-muted">This month at a glance</p></div><div className="rounded-lg bg-[#18201a] p-2 text-lime"><BarChart3 size={16} /></div></div><div className="mt-6 space-y-5"><QuickStat label="Today’s P/L" value={currency(summary?.daily_pl ?? 0)} amount={Number(summary?.daily_pl ?? 0)} /><QuickStat label="This week" value={currency(summary?.weekly_pl ?? 0)} amount={Number(summary?.weekly_pl ?? 0)} /><QuickStat label="This month" value={currency(summary?.monthly_pl ?? 0)} amount={Number(summary?.monthly_pl ?? 0)} /><QuickStat label="Open bets" value={`${summary?.active_bets ?? 0} · ${currency(summary?.risk_exposure ?? 0)} at risk`} amount={Number(summary?.active_bets ?? 0)} /><div className="border-t border-line pt-4"><div className="mb-2 flex justify-between text-xs"><span className="text-muted">Bankroll growth</span><span className="text-lime">{summary?.bankroll.starting_bankroll ? percent((Number(summary.bankroll.current_bankroll) / Number(summary.bankroll.starting_bankroll) - 1) * 100) : "0.0%"}</span></div><div className="h-1.5 rounded-full bg-[#252e31]"><div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, Math.max(3, (Number(summary?.bankroll.current_bankroll ?? 0) / Math.max(Number(summary?.bankroll.starting_bankroll ?? 1), 1)) * 60))}%` }} /></div></div></div></div>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
            <div className="overflow-hidden rounded-2xl border border-line bg-panel"><div className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-5"><div><p className="text-sm font-semibold">Recent bets</p><p className="mt-1 text-[11px] text-muted">Your latest tracked wagers</p></div><button onClick={() => setPage("Bet tracker")} className="text-[11px] font-semibold text-lime">View all <span>→</span></button></div><BetTable bets={latestBets} onResult={async (bet, result) => { await api.updateBet(bet.id, { result }); await refresh(); }} /></div>
            <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5"><div className="flex items-center gap-2"><Sparkles size={16} className="text-lime" /><p className="text-sm font-semibold">Sharp insights</p></div><p className="mt-1 text-[11px] text-muted">Patterns from your results</p><div className="mt-5 space-y-3"><Insight icon={<Zap size={15} />} title="Best sport" body={performance?.bySport[0] ? `${performance.bySport[0].name} leads your settled betting record.` : "Settle more bets to see sport-level trends."} /><Insight icon={<ShieldAlert size={15} />} title="Risk check" body={Number(summary?.risk_exposure ?? 0) > Number(summary?.bankroll.current_bankroll ?? 0) * 0.2 ? "Open stakes are above 20% of your bankroll." : "Your open exposure is within a conservative range."} warning={Number(summary?.risk_exposure ?? 0) > Number(summary?.bankroll.current_bankroll ?? 0) * 0.2} /><Insight icon={<Target size={15} />} title="Stay consistent" body={`Your average price is ${Number(summary?.average_odds ?? 0).toFixed(2)} decimal odds.`} /></div><button onClick={() => setPage("Analytics")} className="mt-5 w-full rounded-lg border border-line py-2.5 text-xs font-semibold text-[#c5f467] hover:bg-white/[0.03]">Explore analytics</button></div>
          </div>
        </section>}
        {page === "Bet tracker" && <BetTracker bets={bets} search={search} setSearch={setSearch} onAdd={() => setBetModal(true)} onChanged={refresh} />}
        {page === "Analytics" && <Analytics performance={performance} summary={summary} />}
        {page === "Odds screen" && <Suspense fallback={<div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-line bg-panel text-sm text-muted">Loading odds screen…</div>}><OddsPage onLog={(draft) => { setBetDraft(draft); setBetModal(true); }} /></Suspense>}
        {page === "Stats" && <Suspense fallback={<div className="flex min-h-[240px] items-center justify-center text-lime"><Activity className="animate-pulse" /></div>}><StatsPage /></Suspense>}
        {page === "Injury report" && <Suspense fallback={<div className="flex min-h-[240px] items-center justify-center text-lime"><Activity className="animate-pulse" /></div>}><InjuryReportPage /></Suspense>}
        {page === "Market lab" && <MarketLab onTrack={(draft) => { setBetDraft(draft); setBetModal(true); }} onGraded={() => void refresh()} />}
        {page === "Parlay builder" && <ParlayBuilder />}
        {page === "Pick analysis" && <PickAnalysis bankroll={Number(summary?.bankroll.current_bankroll ?? 1000)} />}
        {page === "Bankroll" && <BankrollPage summary={summary} performance={performance} refresh={refresh} />}
        {page === "Settings" && <SettingsPage user={user} onUpdated={setUser} />}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line py-5 text-[10px] text-[#69757a]"><span>© 2025 SharpStats Pro · For research and informational purposes only.</span><span className="flex items-center gap-3"><button className="hover:text-white"><CircleHelp size={13} className="inline" /> Help center</button><button onClick={() => setPage("Settings")} className="hover:text-white">Preferences</button></span></footer>
      </div>
    </main>
    {betModal && <BetModal key={JSON.stringify(betDraft ?? {})} initialBet={betDraft} onClose={() => { setBetModal(false); setBetDraft(undefined); }} onSaved={() => void refresh()} />}
  </div>;
}

function QuickStat({ label, value, amount }: { label: string; value: string; amount: number }) {
  return <div className="flex items-center justify-between"><span className="text-xs text-muted">{label}</span><span className={`text-sm font-semibold ${amount >= 0 ? "text-white" : "text-rose-400"}`}>{amount > 0 ? "+" : ""}{value}</span></div>;
}
function Insight({ icon, title, body, warning = false }: { icon: ReactNode; title: string; body: string; warning?: boolean }) {
  return <div className={`flex gap-3 rounded-xl border p-3 ${warning ? "border-amber-900/50 bg-amber-950/20" : "border-line bg-[#0e1416]"}`}><div className={`mt-0.5 ${warning ? "text-amber-400" : "text-lime"}`}>{icon}</div><div><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-muted">{body}</p></div></div>;
}

function BetTable({ bets, onResult }: { bets: Bet[]; onResult?: (bet: Bet, result: Bet["result"]) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left"><thead><tr className="text-[9px] font-semibold tracking-wider text-[#738087]"><th className="px-5 py-3">MATCHUP</th><th className="px-3 py-3">ODDS</th><th className="px-3 py-3">STAKE</th><th className="px-3 py-3">RESULT</th><th className="px-5 py-3 text-right">P/L</th></tr></thead><tbody>{bets.length ? bets.map((bet) => <tr key={bet.id} className="border-t border-line/80 text-xs"><td className="px-5 py-3.5"><p className="font-medium text-white">{bet.event}</p><p className="mt-1 text-[10px] text-muted">{bet.sport} · {bet.sportsbook}</p></td><td className="px-3 py-3.5 text-[#d9e0dc]">{Number(bet.odds).toFixed(2)}</td><td className="px-3 py-3.5 text-[#d9e0dc]">{currency(bet.stake)}</td><td className="px-3 py-3.5">{onResult && bet.result === "pending" ? <select aria-label={`Set result for ${bet.event}`} value={bet.result} onChange={(e) => onResult(bet, e.target.value as Bet["result"])} className="rounded-md border border-line bg-[#0c1114] px-2 py-1 text-[10px] text-amber-300"><option value="pending">Pending</option><option value="win">Win</option><option value="loss">Loss</option><option value="push">Push</option></select> : <ResultBadge result={bet.result} />}</td><td className={`px-5 py-3.5 text-right font-semibold ${Number(bet.profit_loss) >= 0 ? "text-lime" : "text-rose-400"}`}>{Number(bet.profit_loss) > 0 ? "+" : ""}{currency(bet.profit_loss)}</td></tr>) : <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-muted">No bets yet. Add your first bet to get started.</td></tr>}</tbody></table></div>;
}
function ResultBadge({ result }: { result: string }) {
  const color = result === "win" ? "bg-lime/10 text-lime" : result === "loss" ? "bg-rose-400/10 text-rose-400" : result === "push" ? "bg-slate-400/10 text-slate-300" : "bg-amber-400/10 text-amber-300";
  return <span className={`rounded-md px-2 py-1 text-[9px] font-semibold capitalize ${color}`}>{result}</span>;
}

function BetTracker({ bets, search, setSearch, onAdd, onChanged }: { bets: Bet[]; search: string; setSearch: (value: string) => void; onAdd: () => void; onChanged: () => void }) {
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const visible = bets.filter((bet) => filter === "all" || bet.result === filter);
  async function exportCsv() {
    try {
      const blob = await api.download("/bets/export");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "sharpstats-bets.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); }
  }
  async function exportReport(format: "xlsx" | "pdf") {
    try {
      const url = URL.createObjectURL(await api.download(`/bets/report/${format}`));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sharpstats-report.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); }
  }
  async function importCsv(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const [headerLine, ...lines] = text.trim().split(/\r?\n/);
      const headers = parseCsvLine(headerLine ?? "");
      const rows = lines.filter(Boolean).map((line) => Object.fromEntries(parseCsvLine(line).map((value, i) => [headers[i] ?? "", value])));
      const result = await api.importBets(rows);
      setMessage(`Imported ${result.imported}; skipped ${result.skipped}.`);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
  }
  return <section><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">WORKSPACE</p><h2 className="font-display text-2xl font-extrabold">Bet tracker</h2><p className="mt-1.5 text-sm text-muted">Every wager, one clear view.</p></div><div className="flex flex-wrap gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white"><ArrowDownToLine size={15} />Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void importCsv(e.target.files?.[0])} /></label><button onClick={() => void exportCsv()} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white"><ArrowUpRight size={15} />CSV</button><button onClick={() => void exportReport("xlsx")} className="rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white">Excel</button><button onClick={() => void exportReport("pdf")} className="rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white">PDF</button><button onClick={onAdd} className="flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-xs font-bold text-[#11170c]"><Plus size={15} />Log bet</button></div></div>
    {message && <div className="mb-4 flex justify-between rounded-lg border border-line bg-panel px-4 py-3 text-xs text-muted">{message}<button onClick={() => setMessage("")} aria-label="Dismiss"><X size={14} /></button></div>}
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-3"><div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-2.5 text-muted" size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search event, sport, sportsbook..." className="w-full rounded-lg border border-line bg-[#0c1114] py-2 pl-9 pr-3 text-xs outline-none focus:border-lime" /></div>{["all", "pending", "win", "loss", "push"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-[10px] capitalize ${filter === item ? "bg-[#27312a] text-lime" : "text-muted hover:text-white"}`}>{item === "all" ? "All bets" : item}</button>)}</div>
    <div className="overflow-hidden rounded-2xl border border-line bg-panel"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-sm font-semibold">All bets <span className="ml-1 rounded bg-[#20292e] px-1.5 py-0.5 text-[10px] text-muted">{visible.length}</span></p><p className="mt-1 text-[11px] text-muted">Manage and settle your wagers</p></div></div><BetTable bets={visible} onResult={async (bet, result) => { await api.updateBet(bet.id, { result }); onChanged(); }} /></div>
  </section>;
}
function parseCsvLine(line: string): string[] {
  const values: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values;
}

function Analytics({ performance, summary }: { performance: Performance | null; summary: Summary | null }) {
  const groups = [{ title: "By sport", data: performance?.bySport ?? [] }, { title: "By sportsbook", data: performance?.byBook ?? [] }, { title: "By bet type", data: performance?.byType ?? [] }, { title: "By league", data: performance?.byLeague ?? [] }];
  const sharpe = (() => {
    const values = (performance?.daily ?? []).map((x) => Number(x.profit_loss));
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1));
    return deviation ? mean / deviation * Math.sqrt(252) : 0;
  })();
  return <section><PageHeading eyebrow="PERFORMANCE" title="Analytics" subtitle="Find the patterns behind your results." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><MetricTile label="Yield" value={percent(summary?.roi ?? 0)} icon={<Activity size={17} />} /><MetricTile label="Average odds" value={Number(summary?.average_odds ?? 0).toFixed(2)} icon={<Target size={17} />} /><MetricTile label="Closing line value" value={percent(Number(summary?.clv_pct ?? 0))} icon={<Compass size={17} />} /><MetricTile label="Sharpe ratio" value={sharpe.toFixed(2)} icon={<BarChart3 size={17} />} /><MetricTile label="Active risk" value={currency(summary?.risk_exposure ?? 0)} icon={<ShieldAlert size={17} />} /></div><div className="mt-4 rounded-2xl border border-line bg-panel p-5"><h3 className="text-sm font-semibold">Profit trajectory</h3><div className="mt-5"><PerformanceChart performance={performance} period="monthly" /></div></div><div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">{groups.map((group) => <div key={group.title} className="rounded-2xl border border-line bg-panel p-5"><h3 className="text-sm font-semibold">{group.title}</h3><div className="mt-4 space-y-4">{group.data.length ? group.data.map((item) => <div key={item.name}><div className="flex justify-between text-xs"><span>{item.name}</span><span className={Number(item.profit_loss) >= 0 ? "text-lime" : "text-rose-400"}>{currency(item.profit_loss)}</span></div><div className="mt-1.5 flex justify-between text-[10px] text-muted"><span>{item.decisions} decisions</span><span>{Number(item.decisions) ? `${(Number(item.wins) / Number(item.decisions) * 100).toFixed(0)}% win rate` : "—"}</span></div></div>) : <p className="text-xs text-muted">No settled bets yet.</p>}</div></div>)}</div></section>;
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-panel p-5"><div className="flex justify-between text-muted"><span className="text-xs">{label}</span><span className="text-lime">{icon}</span></div><p className="mt-4 font-display text-2xl font-bold">{value}</p></div>;
}
function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">{eyebrow}</p><h2 className="font-display text-2xl font-extrabold">{title}</h2><p className="mt-1.5 text-sm text-muted">{subtitle}</p></div>{action}</div>;
}

function ParlayBuilder() {
  const [picks, setPicks] = useState([{ event: "", odds: "" }, { event: "", odds: "" }]);
  const [stake, setStake] = useState("25");
  const validOdds = picks.map((pick) => Number(pick.odds)).filter((odds) => odds > 1);
  const combined = validOdds.reduce((total, odds) => total * odds, 1);
  const implied = combined > 1 ? 1 / combined * 100 : 0;
  return <section><PageHeading eyebrow="RESEARCH" title="Parlay builder" subtitle="Combine legs and understand the math before you play." /><div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]"><div className="rounded-2xl border border-line bg-panel p-5"><div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-semibold">Your picks</p><p className="mt-1 text-[11px] text-muted">Enter decimal odds for each leg.</p></div><button onClick={() => setPicks([...picks, { event: "", odds: "" }])} className="flex items-center gap-1 text-xs text-lime"><Plus size={14} />Add leg</button></div><div className="space-y-3">{picks.map((pick, index) => <div key={index} className="grid grid-cols-[1fr_110px_32px] gap-2"><input value={pick.event} onChange={(e) => setPicks(picks.map((p, i) => i === index ? { ...p, event: e.target.value } : p))} placeholder={`Pick ${index + 1} · event / selection`} className="rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-xs outline-none focus:border-lime" /><input value={pick.odds} onChange={(e) => setPicks(picks.map((p, i) => i === index ? { ...p, odds: e.target.value } : p))} placeholder="Odds" type="number" min="1.01" step="0.01" className="rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-xs outline-none focus:border-lime" /><button onClick={() => setPicks(picks.filter((_, i) => i !== index))} className="flex items-center justify-center text-muted hover:text-rose-400" aria-label="Remove pick"><X size={15} /></button></div>)}</div><button onClick={() => setPicks([...picks, { event: "", odds: "" }])} className="mt-4 w-full rounded-lg border border-dashed border-line py-2.5 text-xs text-muted hover:border-[#536048] hover:text-white">+ Add another pick</button></div><div className="rounded-2xl border border-line bg-panel p-5"><p className="text-sm font-semibold">Parlay summary</p><label className="mt-5 block text-xs text-muted">Stake amount<input value={stake} onChange={(e) => setStake(e.target.value)} type="number" min="0" className="mt-2 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" /></label><div className="my-5 space-y-4 border-y border-line py-5"><SummaryRow label="Combined odds" value={combined > 1 ? combined.toFixed(2) : "—"} /><SummaryRow label="Implied probability" value={implied ? `${implied.toFixed(1)}%` : "—"} /><SummaryRow label="Potential payout" value={combined > 1 ? currency(Number(stake) * combined) : "—"} /><SummaryRow label="Potential profit" value={combined > 1 ? currency(Number(stake) * (combined - 1)) : "—"} /></div><p className="text-[10px] leading-relaxed text-muted">Assumes independent legs and decimal odds; actual sportsbook pricing and parlay rules may differ.</p></div></div></section>;
}
function SummaryRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><span className="font-semibold">{value}</span></div>; }

function PickAnalysis({ bankroll }: { bankroll: number }) {
  const [odds, setOdds] = useState("1.91");
  const [probability, setProbability] = useState("55");
  const [kellyFraction, setKellyFraction] = useState("0.25");
  const decimalOdds = Number(odds);
  const winProb = Math.max(0, Math.min(1, Number(probability) / 100 || 0));
  const implied = decimalOdds > 1 ? 1 / decimalOdds * 100 : 0;
  const edge = winProb * 100 - implied;
  const ev = decimalOdds > 1 ? winProb * (decimalOdds - 1) - (1 - winProb) : 0;
  const fullKelly = decimalOdds > 1 ? Math.max(0, (winProb * decimalOdds - 1) / (decimalOdds - 1)) : 0;
  const stakePercent = fullKelly * Number(kellyFraction);
  return <section><PageHeading eyebrow="RESEARCH" title="Pick analysis" subtitle="Estimate value and size a wager using your probability." /><div className="grid gap-4 lg:grid-cols-[1fr_1fr]"><div className="rounded-2xl border border-line bg-panel p-5 sm:p-6"><h3 className="text-sm font-semibold">Your estimate</h3><div className="mt-5 space-y-5"><label className="block text-xs text-muted">Decimal odds<div className="mt-2 flex items-center gap-3"><input type="number" min="1.01" step="0.01" value={odds} onChange={(e) => setOdds(e.target.value)} className="w-full rounded-lg border border-line bg-[#0c1114] px-3 py-3 text-sm text-white outline-none focus:border-lime" /><span className="text-[10px]">e.g. 1.91</span></div></label><label className="block text-xs text-muted">Estimated win probability<div className="mt-2 flex items-center gap-3"><input type="number" min="0" max="100" step="0.1" value={probability} onChange={(e) => setProbability(e.target.value)} className="w-full rounded-lg border border-line bg-[#0c1114] px-3 py-3 text-sm text-white outline-none focus:border-lime" /><span className="text-xs">%</span></div></label><label className="block text-xs text-muted">Kelly sizing<div className="mt-2 grid grid-cols-3 gap-2">{[["0.25", "Quarter Kelly"], ["0.5", "Half Kelly"], ["1", "Full Kelly"]].map(([value, label]) => <button key={value} onClick={() => setKellyFraction(value)} className={`rounded-lg border p-2.5 text-[10px] ${kellyFraction === value ? "border-lime bg-lime/10 text-lime" : "border-line text-muted"}`}>{label}</button>)}</div></label></div></div><div className="rounded-2xl border border-line bg-panel p-5 sm:p-6"><div className="flex items-center gap-2"><Calculator size={16} className="text-lime" /><h3 className="text-sm font-semibold">Analysis results</h3></div><div className="mt-6 grid grid-cols-2 gap-3"><MetricTile label="Implied probability" value={`${implied.toFixed(1)}%`} icon={<Compass size={16} />} /><MetricTile label="Your edge" value={percent(edge)} icon={<Target size={16} />} /><MetricTile label="Expected value / $1" value={currency(ev)} icon={<Activity size={16} />} /><MetricTile label="Kelly stake" value={currency(bankroll * stakePercent)} icon={<Wallet size={16} />} /></div><div className="mt-4 rounded-xl border border-line bg-[#0c1114] p-4"><div className="flex justify-between text-xs"><span className="text-muted">Recommended stake ({(stakePercent * 100).toFixed(1)}% bankroll)</span><span className="font-semibold">{currency(bankroll * stakePercent)}</span></div><div className="mt-3 h-1.5 rounded-full bg-[#252e31]"><div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, stakePercent * 100 * 5)}%` }} /></div></div><p className="mt-4 text-[10px] leading-relaxed text-muted">Kelly sizing is highly sensitive to probability estimates. Fractional Kelly can reduce volatility; no model guarantees profit.</p></div></div></section>;
}

function BankrollPage({ summary, performance, refresh }: { summary: Summary | null; performance: Performance | null; refresh: () => void }) {
  const [starting, setStarting] = useState(String(summary?.bankroll.starting_bankroll ?? 1000));
  const [unit, setUnit] = useState(String(summary?.bankroll.unit_size ?? 25));
  const [model, setModel] = useState("Flat");
  const [winProbability, setWinProbability] = useState("55");
  const [odds, setOdds] = useState("1.91");
  const [message, setMessage] = useState("");
  const current = Number(summary?.bankroll.current_bankroll ?? 0);
  const probability = Math.max(0, Math.min(1, Number(winProbability) / 100 || 0));
  const decimalOdds = Number(odds);
  const kellyRate = decimalOdds > 1 ? Math.max(0, (probability * decimalOdds - 1) / (decimalOdds - 1)) * 0.25 : 0;
  const recommended = model === "Flat" ? Number(unit) : Math.min(current * kellyRate, current * 0.05);
  async function save() {
    try { await api.saveBankroll({ starting_bankroll: starting, unit_size: unit }); setMessage("Bankroll settings saved."); refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save settings"); }
  }
  return <section><PageHeading eyebrow="MONEY MANAGEMENT" title="Bankroll" subtitle="Set your baseline and keep risk in perspective." /><div className="grid gap-4 sm:grid-cols-3"><MetricTile label="Current bankroll" value={currency(current)} icon={<Wallet size={17} />} /><MetricTile label="Starting bankroll" value={currency(summary?.bankroll.starting_bankroll ?? 0)} icon={<ArrowUpRight size={17} />} /><MetricTile label="Risk exposure" value={currency(summary?.risk_exposure ?? 0)} icon={<ShieldAlert size={17} />} /></div><div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]"><div className="rounded-2xl border border-line bg-panel p-5"><h3 className="text-sm font-semibold">Bankroll settings</h3><p className="mt-1 text-xs text-muted">Your current balance is calculated from settled bets.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs text-muted">Starting bankroll ($)<input value={starting} onChange={(e) => setStarting(e.target.value)} type="number" min="0" className="mt-2 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" /></label><label className="text-xs text-muted">Unit size ($)<input value={unit} onChange={(e) => setUnit(e.target.value)} type="number" min="0.01" step="0.01" className="mt-2 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" /></label></div><div className="mt-4 flex gap-2">{["Flat", "Kelly"].map((item) => <button key={item} onClick={() => setModel(item)} className={`rounded-lg border px-3 py-2 text-xs ${model === item ? "border-lime text-lime" : "border-line text-muted"}`}>{item} betting</button>)}</div>{model === "Kelly" && <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs text-muted">Estimated win probability (%)<input value={winProbability} onChange={(e) => setWinProbability(e.target.value)} type="number" min="0" max="100" step="0.1" className="mt-2 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" /></label><label className="text-xs text-muted">Decimal odds<input value={odds} onChange={(e) => setOdds(e.target.value)} type="number" min="1.01" step="0.01" className="mt-2 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" /></label></div>}<div className="mt-5 rounded-xl border border-[#34412a] bg-[#182017] p-4"><p className="text-[10px] text-muted">SUGGESTED STAKE · {model.toUpperCase()}</p><p className="mt-1 font-display text-2xl font-bold text-lime">{currency(recommended)}</p><p className="mt-1 text-[10px] text-muted">{model === "Flat" ? "1 unit per wager" : "Quarter Kelly, capped at 5% of bankroll"}</p></div><div className="mt-4 flex items-center justify-between"><span className="text-xs text-muted">{message}</span><button onClick={() => void save()} className="rounded-lg bg-lime px-4 py-2 text-xs font-bold text-[#11170c]">Save settings</button></div></div><div className="rounded-2xl border border-line bg-panel p-5"><h3 className="text-sm font-semibold">Growth & risk</h3><div className="mt-5"><PerformanceChart performance={performance} period="monthly" /></div><div className="mt-4 rounded-xl border border-line bg-[#0c1114] p-4"><p className="text-xs font-semibold">Risk guidelines</p><ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted"><li>• Keep individual wagers to a small share of your bankroll.</li><li>• Avoid chasing losses or increasing stakes impulsively.</li><li>• Size positions with uncertainty in your estimates in mind.</li></ul></div></div></div></section>;
}

function SettingsPage({ user, onUpdated }: { user: User; onUpdated: (user: User) => void }) {
  const [name, setName] = useState(user.username);
  const [books, setBooks] = useState<{ id: number; name: string; favorite: boolean }[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => { api.sportsbooks().then((data) => setBooks(data.sportsbooks)).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load sportsbooks")); }, []);
  async function saveName() {
    try { const result = await api.saveProfile(name); onUpdated(result.user); setMessage("Profile updated."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update profile"); }
  }
  async function toggle(book: typeof books[number]) {
    try { const result = await api.favorite(book.id, !book.favorite); setBooks(books.map((item) => item.id === book.id ? { ...item, favorite: result.favorite } : item)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update favorite"); }
  }
  return <section><PageHeading eyebrow="PREFERENCES" title="Settings" subtitle="Manage your profile and favorite sportsbooks." /><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-line bg-panel p-5"><h3 className="text-sm font-semibold">Profile</h3><p className="mt-1 text-xs text-muted">Account details and display name.</p><label className="mt-5 block text-xs text-muted">Username<input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" /></label><p className="mt-3 text-xs text-muted">Email <span className="ml-2 text-white">{user.email}</span></p><button onClick={() => void saveName()} className="mt-5 rounded-lg bg-lime px-4 py-2 text-xs font-bold text-[#11170c]">Save profile</button>{message && <p className="mt-3 text-xs text-muted">{message}</p>}</div><div className="rounded-2xl border border-line bg-panel p-5"><h3 className="text-sm font-semibold">Favorite sportsbooks</h3><p className="mt-1 text-xs text-muted">Choose books to prioritize in your research.</p><div className="mt-4 space-y-2">{books.map((book) => <button key={book.id} onClick={() => void toggle(book)} className="flex w-full items-center justify-between rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-xs"><span>{book.name}</span><Bookmark size={15} className={book.favorite ? "fill-lime text-lime" : "text-muted"} /></button>)}</div></div></div></section>;
}

export default App;
