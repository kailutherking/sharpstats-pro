# SharpStats Pro vs. Real Sports: competitive analysis and engagement plan

*November 9, 2026 · version 1.6.0*

SharpStats is a betting research and bankroll tool. Real (Real Vault, LLC; realapp.com) is a live-sports fan app built around community. This document compares the two and records what we built in 1.6.0 and what comes next.

The aim is to borrow what Real does well (real-time reactions, community, progression, retention) and keep SharpStats focused on analytics, odds, props, EV and bankroll.

Sources: [realapp.com](https://www.realapp.com/), [App Store listing](https://apps.apple.com/us/app/-/id1514546162), [ScreensDesign teardown](https://screensdesign.com/showcase/real-sports), [Pear VC profile](https://pear.vc/companies/real-sport/). Real's in-app details come from these public sources, not hands-on testing.

## 1. Competitive analysis

### What Real does well

| Area | What Real does | Why it works |
|---|---|---|
| User experience | Built around a play-by-play feed instead of score summaries. Tapping a play opens its stats. Light/dark themes and accent colors. | Every play is a reason to look and react. Short, frequent sessions. |
| Navigation | Dense top bar plus a side menu covering 12 sports. Reviewers say it can overwhelm new users. | Lots of coverage, but complex. A lesson for us to keep navigation simple. |
| Live experience | Live scores and box scores, with comments and reactions on each play. | The "watch party" feeling is the core of the product. |
| Social | Comments and reactions on plays, group chats, direct messages, profiles. | Conversation sits next to the data it's about. |
| Community | Create or join groups, organize them in folders. | Small circles keep people coming back. |
| Gamification | Rax currency, collectible cards that level up, an auction house, predictions, polls, a daily streak. | Collection and ownership, plus a daily habit loop. |
| Notifications | Single-game alerts, Live Activities and widgets (some are Pro features). | Brings users back at the moments that matter. |
| Profiles | Player and team stats, career data, venue "passport". | Identity and a sense of progress. |
| Engagement and retention | Reaction counters on plays, a marketplace trade feed, the daily streak, predictions without real money. | Several reasons to return every day, game or no game. |
| Sports tracking | Follow players and teams, standings, rankings of play excitement. | Personalization. |

### Where SharpStats was already ahead

| Area | SharpStats | Real |
|---|---|---|
| Odds and markets | Multi-book odds board, line shopping, opening/current/closing prices, steam, sharp and reverse line moves, +EV and arbitrage scanners, CLV tracking. | Prediction markets only. No sportsbook comparison. |
| Props research | Prop hit rates (L5, L10, season, splits) and a live prop tracker with projected finish and hit probability. | None. |
| Bankroll | Bet tracker, profit/loss, ROI, Kelly sizing, imports and exports, automatic grading. | None. |
| Injury intelligence | Feeds for four leagues, betting impact model, team health, spread movement since each report. | News only. |
| Stats depth | League leaders, splits, game logs, comparisons and betting insights. | Strong, but not tied to betting. |

## 2. Feature gap audit (before 1.6.0)

**Missing:** Real has it and SharpStats had nothing.
**Partially built:** some groundwork existed.
**Needs improvement:** existed but was weak.
**Already better:** SharpStats beat Real here.

| Feature | Status before 1.6.0 | 1.6.0 outcome |
|---|---|---|
| Public user profiles | MISSING | Built: handle, bio, favorite sports, record from shared picks, ROI, win %, units, followers, badges, performance chart, recent picks |
| Follow users | MISSING | Built |
| Follow teams and players | PARTIALLY BUILT (Stats favorites) | Reused favorites. They now drive injury notifications and feed items |
| Follow sportsbooks | PARTIALLY BUILT (favorite books in Settings) | Reused. Shown on profiles |
| Activity feed | MISSING | Built: picks, big wins, badges, injury news, sharp line moves, ESPN headlines |
| Reactions and comments | MISSING | Built: like, fire, lock, tail, fade, comments, share |
| Social picks | MISSING | Built: share pending bets as picks. Lists for popular, most tailed, trending props, sharp bettors, top winners |
| Verified records | MISSING | Built: "locked" (shared before start) and "verified" (locked plus auto-graded). Only pending bets can be shared |
| Tail/fade analytics | MISSING | Built: tail and fade counts and how tailers/faders did, per bettor |
| Leaderboards | MISSING | Built: global and friends; ROI, win rate, units, props, sportsbooks; 7d, 30d and all time; rank change |
| Badges, XP, levels, ranks | MISSING | Built: 10 badges, XP, levels, five ranks, milestones, daily streak |
| Notification center | NEEDS IMPROVEMENT (placeholder bell) | Built: 14 types, live push, unread count, preferences |
| Live game chat | MISSING | Built: chat, game reactions, reactions on single plays, viewer count |
| Live bet tracker | MISSING | Built: your pending bets on a game with live status; prop-hit notifications |
| Live scoreboards, box scores, play-by-play | ALREADY BETTER (1.5.0) | Kept |
| Live props tracking | ALREADY BETTER (1.5.0) | Linked to your bets |
| Live EV and arbitrage | PARTIALLY BUILT (pregame-only signals, credit-paced) | Unchanged on purpose: in-play signals are noise (1.4.0 decision) |
| News hub | MISSING | Partly built: ESPN headlines and trade/signing tags in the feed. Dedicated hub is on the roadmap |
| Trade feed and trade alerts | MISSING | Roadmap (needs a transactions feed) |
| Groups and communities | MISSING | Roadmap |
| Private betting circles | MISSING | Partly built: "followers only" picks. Circles are on the roadmap |
| Copy-betting style tracking | MISSING | Roadmap |
| Polls and predictions | MISSING | Roadmap (low) |
| Cards, currency, marketplace | MISSING | Won't build: off-mission, and virtual currency next to real betting is a responsible-gambling risk |
| Mobile navigation | NEEDS IMPROVEMENT (hamburger only) | Built: bottom tab bar, larger touch targets, safe-area padding |
| Onboarding | MISSING | Built: setup checklist |

## 3. Priority roadmap

Impact is 1–10. Complexity is S (under 1 day), M (1–3 days) or L (a week or more).

### High priority (built in 1.6.0)

| Feature | User value | Complexity | Impact | How it was built |
|---|---|---|---|---|
| Notification center | Brings users back for prop hits, injuries, line moves and activity on their picks | M | 10 | `notification.service.ts` and SSE push. Hooks in alerts, bets, grading and social actions |
| Social picks and verified records | Turns the bet tracker into a shareable, trusted record | M | 9 | `posts` snapshot at share time. Locked and verified flags. Pending bets only |
| Activity feed | One daily destination | M | 9 | `feed.service.ts` merges posts, `feed_events` and ESPN news |
| Leaderboards | Competition, and a way to find good bettors | M | 8 | SQL over public settled picks, minimum sample size, snapshots for rank change |
| Live game chat and reactions | Real's core loop, inside our game view | M | 8 | `live_game_events` plus SSE topics. Play reactions on recent plays |
| Gamification | Habit loop and progress | M | 7 | Badges calculated from tracked bets and activity, XP formula, daily streak |
| Profiles and follows | Identity and personalization | M | 8 | `user_profiles`, `follows`. Reuses existing favorites |
| Live bet tracker | "Am I winning?" in real time | M | 8 | Matches bets to ESPN games via `games.odds_game_id`, then box-score checks |
| Mobile bottom navigation and onboarding | First-session success on phones | S | 7 | Bottom tab bar and checklist |

### Medium priority (next)

| Feature | User value | Complexity | Impact | Recommended implementation |
|---|---|---|---|---|
| Groups and betting circles | Private, friend-sized communities | L | 8 | `communities`, `community_members`, `community_posts`; reuse posts with a `community_id`; invite links |
| News hub and trade feed | One place for news with betting impact | M | 7 | ESPN news and transactions endpoints. Tag trades and signings. Link players to injury and prop impact |
| Web push and email digests | Reach users outside the app | M | 8 | Service worker with VAPID keys; daily digest; quiet hours in `user_preferences` |
| Copy-betting style tracking | See if tailing someone actually works | M | 6 | Record tails as linked bets (`bets.tailed_post_id`); tail ROI per bettor |
| Rich profile media | Avatars | S | 4 | Image upload to object storage. Today it's an HTTPS URL only |
| Moderation tools | Safety once the community grows | M | 6 | Report/block, a word filter, an admin queue |

### Low priority

| Feature | Notes |
|---|---|
| Polls and free predictions | Fun, but it duplicates picks |
| Venue passport, season awards | Real-style collectibles; low value for bettors |
| Direct messages | Moderation burden; groups cover most of the need |
| Cards, currency, marketplace | Not planned (see the gap audit) |

## 4. UI improvements (1.6.0)

- **Navigation:**
  - New **Community** item in the Workspace section.
  - A **bottom tab bar** on phones (Home, Odds, Stats, Community, Bets), with 56px touch targets and safe-area padding.
- **Header:**
  - The bell is now a real **notification center** with unread count, live toasts and deep links.
  - The avatar opens your profile.
- **Dashboard:**
  - A **setup checklist**.
  - An **Activity** card with the latest feed items.
  - A **Your progress** card with level, XP, streak and handle.
- **Bet tracker:** a **Share pick** button on pending bets and a **SHARED** tag on shared ones.
- **Live game view:**
  - **Game chat** with reactions and a viewer count.
  - Reactions on each recent play.
  - **Your bets on this game**, tracked live.
- **Settings:**
  - Community profile: handle, bio, favorite sports, public/private.
  - Per-type notification switches.
- **Touch and feedback:**
  - Reaction and setting controls are at least 32–44px tall.
  - Toasts sit above the bottom bar on phones.
  - No horizontal scrolling at 390px (checked).

## 5. Social feature plan

- **Profiles:**
  - Public by default, private with one switch.
  - The record comes only from **shared picks**. The private bet tracker, dollar stakes and bankroll are never shown; sizes are in units.
- **Follows:**
  - Users can follow users.
  - Following teams, players and sportsbooks reuses the existing favorites, so there's one source of truth. Favorites now drive injury notifications and the injury feed.
- **Picks:**
  - Only **pending** bets can be shared, so nobody can post wins after the fact.
  - The pick saves odds, line and units when shared. It's **locked** if shared before the start time on the odds board, and **verified** when it's locked and graded from the final score.
  - Visibility: public, followers or private.
- **Reactions:**
  - Like, fire, lock, tail and fade. Tail and fade cancel each other.
  - **Tail** opens the bet slip pre-filled with the pick.
- **Comments:** on picks and posts. Rate limited to 30 actions a minute per user.
- **Pick lists:** popular (3 days), most tailed (7 days), trending props (pending props), sharp bettors (pending picks from users with 10+ settled picks and positive units), top winners (7 days), latest.

## 6. Gamification plan

- **XP:**
  - 5 per bet tracked
  - 5 per settled bet
  - +10 per win
  - 10 per pick shared
  - 2 per reaction or comment received
  - 5 per day visited
  - plus badge bonuses

  XP is recalculated from data, so it can't drift.
- **Levels:** level *n* needs 50·n·(n−1) XP: 100, 300, 600…
- **Ranks:** Rookie (1–4), Contender (5–9), Pro (10–14), Sharp (15–24), Legend (25+).
- **Badges:**

  | Badge | Requirement |
  |---|---|
  | First Pick | Share a pick |
  | Hot Streak | 5 wins in a row |
  | ROI King | 10%+ ROI on 30+ settled bets |
  | Sharp Bettor | Beat the close on 60%+ of 20+ bets |
  | Prop Hunter | 55%+ on 25+ settled props |
  | Line Shopper | 5+ sportsbooks |
  | Arbitrage Expert | 3 two-sided markets at different books |
  | Grinder | 100 bets tracked |
  | Crowd Favorite | 25 tails received |
  | On a Roll | 7-day visit streak |

  Each badge shows progress toward its target.
- **Milestones:** streak notifications at 3, 7, 14, 30, 60 and 100 days. Every badge sends a notification and a feed event.
- **Guardrails:** XP rewards research and tracking habits (logging, shopping lines, beating the close), not bet volume or bet size.

## 7. Real-time experience plan

- **Transport:**
  - Server-Sent Events over the existing authenticated fetch streams.
  - Personal stream: `/api/realtime/stream` for notifications.
  - Game topics: `?topic=game:<league>:<id>` for chat, reactions and presence.
  - Sending uses normal POST requests.
  - We chose SSE over WebSockets because the browser only needs push, SSE works through Railway's proxy and the existing auth, and the odds screen already uses it.
  - Moving to WebSockets later would only change `realtime.service.ts`.
- **Live game room:**
  - Chat (280 characters, 10 messages a minute).
  - Six game reactions, at most one per user per 15 minutes.
  - Reactions on individual plays and a live viewer count.
- **Live bet tracker:**
  - Bets logged from the Odds screen carry the odds event ID. The live tracker links it to the ESPN game (`games.odds_game_id`).
  - Props are checked against the box score. Game lines are checked against the score and spread.
  - A background scan every 60 seconds sends "Prop cashed live" notifications.
- **Live EV and arbitrage:** pregame-only on purpose (see 1.4.0). In-play prices update seconds apart between books, so "edges" are mostly lag.

## 8. Database changes

Migration `003_social_engagement.sql` (applied automatically on startup, with matching Prisma models):

| Table | Purpose |
|---|---|
| `user_profiles` | Handle, bio, avatar URL, favorite sports, public flag, XP, level, streaks, onboarding state. Extends `users` |
| `user_preferences` | Notification switches (JSON) |
| `follows` | User → user. Covers both "Followers" and "Following" |
| `posts` | Picks (snapshotted bets) and text posts, with locked/verified/result fields |
| `comments`, `reactions` | Comments; like/fire/lock/tail/fade |
| `badges`, `achievements` | Badge catalog (seeded) and earned badges |
| `notifications` | Per-user notifications with dedupe keys |
| `feed_events` | Big wins, badges, injury news, sharp market moves |
| `leaderboard_snapshots` | Saved ranks for "rank change" |
| `live_game_events` | Live chat and reactions (game or play) |

Not created yet: `communities` and `community_posts` (groups are medium priority, and we don't ship unused tables). Following teams, players and sportsbooks uses the existing `favorite_stats` and `favorite_sportsbooks` tables.

## 9. API changes

| Method | Path | Purpose |
|---|---|---|
| GET / PUT | `/api/social/me` | Your profile, onboarding and unread count (GET also records the daily visit) / update profile |
| GET | `/api/social/achievements` | XP, level, streak, badge progress |
| GET | `/api/social/profiles/search?q=` | Find bettors |
| GET | `/api/social/profiles/:handle` | Public profile |
| GET | `/api/social/profiles/:handle/followers`, `/following` | Follow lists |
| PUT | `/api/social/follows/:handle` | `{ following: boolean }` |
| GET | `/api/social/feed?scope=all\|following&filter=all\|picks\|wins\|injuries\|market\|news` | Activity feed |
| GET | `/api/social/picks?sort=popular\|tailed\|props\|sharp\|winners\|recent` | Pick lists |
| GET | `/api/social/picks/shared-bets` | Which of your bets are shared |
| POST | `/api/social/picks` | Share a pending bet `{ betId, body, visibility }` |
| POST / GET / DELETE | `/api/social/posts[/:id]` | Text posts; one post; delete your own |
| PUT | `/api/social/posts/:id/reactions` | `{ reaction, enabled }` |
| GET / POST | `/api/social/posts/:id/comments`; DELETE `/api/social/comments/:id` | Comments |
| GET | `/api/social/leaderboards?metric=roi\|winrate\|units\|props&period=7d\|30d\|all&scope=global\|following` | Leaderboards |
| GET | `/api/social/leaderboards/sportsbooks?period=` | Sportsbook leaderboard |
| GET | `/api/notifications`; POST `/api/notifications/read`; GET / PUT `/api/notifications/preferences` | Notification center |
| GET | `/api/realtime/stream[?topic=game:nba:<id>]` | Server-Sent Events |
| GET / POST | `/api/live-games/:id/chat`; POST `/api/live-games/:id/reactions`; DELETE `/api/live-games/chat/:messageId` | Live chat and reactions |
| GET | `/api/live-games/:id/my-bets?league=` | Your bets on a game, tracked live |

## 10. Code changes

- **New backend files** (`backend/src/services/social/`):
  - Real-time and notifications: `realtime.service.ts`, `notification.service.ts`
  - Social: `profile.service.ts`, `pick.service.ts`, `feed.service.ts`, `leaderboard.service.ts`
  - Gamification: `gamification.service.ts`
  - Live: `liveChat.service.ts`, `liveBetTracker.service.ts`
  - Glue: `alertFanout.service.ts`, `maintenance.ts`, `social.test.ts`
  - Routes: `routes/social.routes.ts`, `notifications.routes.ts`, `realtime.routes.ts`
- **Backend hooks:**
  - Stored odds and injury alerts fan out to feed events and notifications.
  - Bet create, update and grading update shared picks, badges and result notifications.
  - Live game routes gained chat, reactions and my-bets.
- **New frontend files:**
  - Page: `pages/CommunityPage.tsx`
  - Social components (`components/social/`): `ActivityFeed`, `PickCard`, `Leaderboards`, `ProfileView`, `AchievementsPanel`, `NotificationCenter`, `SharePickModal`, `OnboardingChecklist`, `SocialSettings`, `socialUi`
  - Live component: `components/live/LiveGameChat.tsx`
  - Shared code: `lib/socialTypes.ts`, `lib/useRealtime.ts`, `lib/navStore.ts`
- **Frontend changes:**
  - App shell: navigation, bell, dashboard cards, bet tracker sharing, settings, bottom navigation.
  - Stats and Live Games: deep links.
  - Odds screen: toast position on phones.
