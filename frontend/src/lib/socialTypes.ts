import type { League } from "./statsTypes";

export type Reaction = "like" | "fire" | "lock" | "tail" | "fade";
export type Visibility = "public" | "followers" | "private";
export type LiveReaction = "fire" | "money" | "shock" | "clap" | "cold" | "lock";
export type NotificationType = "prop_hit" | "bet_result" | "injury" | "line_move" | "odds_change" | "positive_ev" | "arbitrage" | "follower" | "following_pick" | "reaction" | "comment" | "streak" | "achievement" | "news";

export interface ProfileSummary { userId: number; handle: string; name: string; avatarUrl: string | null; level: number; rank: string }

export interface PickRecord { picks: number; settled: number; wins: number; losses: number; pushes: number; pending: number; units: number; risked: number; roi: number | null; winRate: number | null; verified: number }

export interface PostView {
  id: number; kind: "pick" | "post";
  author: { userId: number; handle: string; name: string; avatarUrl: string | null; xp: number };
  body: string; visibility: Visibility; createdAt: string;
  pick: null | {
    sport: string | null; league: string | null; event: string | null; eventId: string | null; market: string | null; betType: string | null; selection: string | null;
    line: number | null; odds: number | null; units: number | null; sportsbook: string | null; eventStart: string | null; locked: boolean;
    result: "pending" | "win" | "loss" | "push"; resultUnits: number | null; autoGraded: boolean; settledAt: string | null;
  };
  reactions: Record<Reaction, number>; mine: Reaction[]; comments: number; isMine: boolean;
}

export interface CommentView { id: number; postId: number; author: { userId: number; handle: string; name: string; avatarUrl: string | null }; body: string; createdAt: string; isMine: boolean }

export interface MyProfile extends ProfileSummary {
  bio: string; favoriteSports: League[]; isPublic: boolean; streak: { days: number; best: number }; xp: { total: number; current: number; next: number };
  unreadNotifications: number; onboarding: { dismissed: boolean; steps: Array<{ key: string; label: string; done: boolean }> };
}

export interface PublicProfile extends ProfileSummary {
  bio: string; favoriteSports: string[]; isPublic: boolean; joinedAt: string; streak: { days: number; best: number }; xp: { total: number; current: number; next: number };
  followers: number; following: number; isFollowing: boolean; isMe: boolean; record: PickRecord; bySport: Array<{ sport: string; record: PickRecord }>;
  performance: Array<{ date: string; units: number }>; badges: Array<{ key: string; name: string; icon: string; earnedAt: string }>;
  favorites: { teams: Array<{ id: string; league: string; name: string; imageUrl: string | null }>; players: Array<{ id: string; league: string; name: string; imageUrl: string | null }>; sportsbooks: string[] };
  tailFade: { tails: number; fades: number; tailNetUnits: number; fadeNetUnits: number }; recentPicks: PostView[];
}

export interface BadgeProgress { key: string; name: string; description: string; icon: string; xp: number; earned: boolean; earnedAt: string | null; progress: number; target: number; detail: string }
export interface Achievements { xp: number; level: { level: number; rank: string; current: number; next: number }; badges: BadgeProgress[]; streak: { days: number; best: number } }

export interface NewsItem { id: string; league: League; headline: string; description: string | null; published: string; link: string | null; image: string | null; category: "news" | "trade" }
export interface FeedEventView { id: number; type: string; league: string | null; title: string; body: string; ref: Record<string, unknown>; actor: { handle: string; name: string; avatarUrl: string | null } | null; createdAt: string }
export type FeedItem = { kind: "post"; at: string; post: PostView } | { kind: "event"; at: string; event: FeedEventView } | { kind: "news"; at: string; news: NewsItem };
export type FeedFilter = "all" | "picks" | "wins" | "news" | "injuries" | "market";

export type LeaderMetric = "roi" | "winrate" | "units" | "props";
export type LeaderPeriod = "7d" | "30d" | "all";
export interface LeaderRow { rank: number; previousRank: number | null; userId: number; handle: string; name: string; avatarUrl: string | null; level: number; picks: number; wins: number; losses: number; pushes: number; units: number; roi: number | null; winRate: number | null; verified: number; value: number }
export interface LeaderboardData { metric: LeaderMetric; period: LeaderPeriod; scope: "global" | "following"; rows: LeaderRow[]; minPicks: number; me: LeaderRow | null }
export interface BookRow { sportsbook: string; picks: number; wins: number; losses: number; units: number; roi: number | null; bettors: number }

export interface NotificationLink { page?: string; league?: string; gameId?: string; handle?: string; postId?: number; athleteId?: string }
export interface AppNotification { id: number; type: NotificationType; title: string; body: string; link: NotificationLink; readAt: string | null; createdAt: string }

export interface ChatMessage { id: number; author: { userId: number; handle: string; name: string; avatarUrl: string | null }; body: string; createdAt: string; isMine: boolean }
export interface GameChat { messages: ChatMessage[]; reactions: Partial<Record<LiveReaction, number>>; playReactions: Record<string, Partial<Record<LiveReaction, number>>>; mine: Array<{ playId: string | null; reaction: LiveReaction }>; viewers: number }
export interface LiveBet { betId: number; event: string; selection: string; market: string; betType: string; line: number | null; odds: number; sportsbook: string; player: string | null; current: number | null; status: "winning" | "losing" | "hit" | "busted" | "unknown"; detail: string }
