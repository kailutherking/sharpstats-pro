import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { League } from "../../lib/statsTypes";
import type { MyProfile, NotificationType } from "../../lib/socialTypes";
import { inputClass } from "../stats/StatsUi";

const NOTIFICATION_LABELS: Array<[NotificationType, string, string]> = [
  ["prop_hit", "Player prop hits", "A tracked prop cashes, live or at the final"],
  ["bet_result", "Bet results", "Your tracked bets settle"],
  ["injury", "Injury updates", "Players and teams you follow; injury alert rules"],
  ["line_move", "Line movement", "Matches for your line-move, steam and sharp rules"],
  ["odds_change", "Odds changes", "Best-price and CLV rule matches"],
  ["positive_ev", "Positive EV", "Matches for your +EV rules"],
  ["arbitrage", "Arbitrage", "Matches for your arbitrage rules"],
  ["following_pick", "Following activity", "People you follow share a pick"],
  ["follower", "New followers", ""],
  ["reaction", "Reactions on your picks", "Likes, tails, fades"],
  ["comment", "Comments on your picks", ""],
  ["streak", "Streaks", "Daily streak milestones"],
  ["achievement", "Badges", "New badges and level-ups"],
];
const SPORTS: League[] = ["nba", "nfl", "mlb", "nhl"];

/** Public profile (handle, bio, favorite sports, visibility) and notification switches. */
export function SocialSettings() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["social-me"], queryFn: api.socialMe });
  const prefs = useQuery({ queryKey: ["notification-preferences"], queryFn: api.notificationPreferences });
  const [form, setForm] = useState({ handle: "", bio: "", favoriteSports: [] as League[], isPublic: true });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (me.data) setForm({ handle: me.data.handle, bio: me.data.bio, favoriteSports: me.data.favoriteSports, isPublic: me.data.isPublic });
  }, [me.data]);
  async function save() {
    try {
      const next = await api.updateSocialMe(form);
      queryClient.setQueryData<MyProfile>(["social-me"], next);
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    }
  }
  async function toggle(type: NotificationType, value: boolean) {
    const result = await api.setNotificationPreferences({ [type]: value });
    queryClient.setQueryData(["notification-preferences"], result);
  }
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-line bg-panel p-5">
        <h3 className="text-sm font-semibold">Community profile</h3>
        <p className="mt-1 text-xs text-muted">How you appear on picks, leaderboards and your public profile. Your bet tracker and dollar amounts are never shown.</p>
        <label className="mt-4 block text-xs text-muted">Handle<div className="mt-2 flex items-center rounded-lg border border-line bg-[#0c1114] px-3"><span className="text-sm text-muted">@</span><input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value.toLowerCase() })} maxLength={30} className="w-full bg-transparent px-1 py-2.5 text-sm text-white outline-none" /></div></label>
        <label className="mt-3 block text-xs text-muted">Bio<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} maxLength={280} rows={2} className={`${inputClass} mt-2 w-full resize-none`} /></label>
        <p className="mt-3 text-xs text-muted">Favorite sports</p>
        <div className="mt-2 flex gap-1.5">{SPORTS.map((sport) => {
          const on = form.favoriteSports.includes(sport);
          return <button key={sport} type="button" aria-pressed={on} onClick={() => setForm({ ...form, favoriteSports: on ? form.favoriteSports.filter((item) => item !== sport) : [...form.favoriteSports, sport] })} className={`min-h-[36px] rounded-lg border px-3 text-xs font-bold ${on ? "border-lime bg-lime/10 text-lime" : "border-line text-muted"}`}>{sport.toUpperCase()}</button>;
        })}</div>
        <label className="mt-4 flex items-center justify-between gap-3 text-xs"><span><span className="block text-white">Public profile</span><span className="text-muted">Off hides your profile and picks from everyone else and leaderboards.</span></span><input type="checkbox" checked={form.isPublic} onChange={(event) => setForm({ ...form, isPublic: event.target.checked })} className="h-4 w-4 accent-[#c5f467]" /></label>
        <button type="button" onClick={() => void save()} className="mt-4 rounded-lg bg-lime px-4 py-2.5 text-xs font-bold text-[#11170c]">Save profile</button>
        {message && <p className="mt-2 text-[11px] text-muted">{message}</p>}
      </div>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <h3 className="text-sm font-semibold">Notifications</h3>
        <p className="mt-1 text-xs text-muted">Choose what reaches your notification center. Odds alerts follow your rules on the Odds screen.</p>
        <div className="mt-4 divide-y divide-line">
          {NOTIFICATION_LABELS.map(([type, label, hint]) => (
            <label key={type} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-xs">
              <span><span className="block text-white">{label}</span>{hint && <span className="text-[11px] text-muted">{hint}</span>}</span>
              <input type="checkbox" checked={prefs.data?.preferences[type] ?? true} onChange={(event) => void toggle(type, event.target.checked)} className="h-4 w-4 accent-[#c5f467]" />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
