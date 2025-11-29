<!-- aa85d59b-077c-4840-8266-8c3eccace1fa e5deb131-d3bb-42ad-9332-cff506a2b84c -->
# Category Edge - Build Plan (League Sync First)

## Core Philosophy: Build → Use → Learn → Improve

Start with league sync (the foundation), then build recommendations on top. Each phase should be usable independently.

---

## Competitive Analysis: Hashtag Basketball Deep Dive & Category Edge Advantages

### What Hashtag Basketball Does Well

**League Integration**:

- ✅ Syncs Yahoo, ESPN, Fantrax, Sleeper leagues (proves our Phase 1 is feasible)
- ✅ Auto-imports rosters and matchup data
- ✅ Multiple league types (Category, Points, Dynasty)

**Analysis Tools**:

- ✅ **Waiver Machine**: Shows impact of adding waiver players (but doesn't suggest who to drop)
- ✅ **Trade Machine**: Simulates trades and impact on rankings
- ✅ **Beast Mode**: Compares your team vs all opponents
- ✅ **Smash Mode**: H2H team comparisons
- ✅ **Schedule Grid**: Weekly game counts for streaming planning

**Data Quality**:

- ✅ Accurate projections and rankings
- ✅ Good projections for season-long value

**Price**: $2.50/month via Patreon - validates market willingness to pay

### Critical Gaps Where Category Edge Wins

#### 1. **No AI Personalization** ❌

**Hashtag**: Uses general algorithms and projections for everyone

**Category Edge Advantage**:

- AI learns YOUR decision patterns
- "You've added similar players 5 times before - you prefer high-risk/high-reward guards"
- Adapts to your strategy, risk tolerance, and league context
- Gets smarter with every decision you make

#### 2. **Static Rankings, No Real-Time Updates** ❌

**Hashtag**: Rankings update daily/weekly, shows projections but not live game data

**Category Edge Advantage**:

- Live category standings during games (updates every 2-5 minutes)
- See exactly where you stand RIGHT NOW: "You're +3 in steals (was +2)"
- Make streaming decisions based on live data, not yesterday's stats
- Know if you need to stream before games end

#### 3. **Waiver Machine Doesn't Suggest Drops** ❌

**Hashtag**: Shows "if you add Player X, your team gets +2 steals" but YOU have to figure out who to drop

**Category Edge Advantage**:

- One-click "Add Player X, Drop Player Y" suggestions
- Analyzes your roster to find optimal drop candidates
- Explains reasoning: "Drop Jalen Suggs (no games left) for Terry Rozier (+2.3 steals)"
- Eliminates analysis paralysis

#### 4. **No Mid-Game Breakout Alerts** ❌

**Hashtag**: Shows stats after games end - too late for streaming decisions

**Category Edge Advantage**:

- Push notifications during games: "Terry Rozier has 3 steals in Q2 - adds +0.8 to your lead"
- Alerts you BEFORE player becomes hot waiver add
- Context-aware: Only alerts if relevant to YOUR matchup
- Gives you first-mover advantage

#### 5. **Not Streaming-Focused** ❌

**Hashtag**: General-purpose tool (trades, season-long, waivers, dynasty)

**Category Edge Advantage**:

- Built specifically for daily streaming decisions (6-month grind)
- Optimized for frequency: Quick decisions, minimal clicks
- Focuses on weekly category wins, not season-long value
- Tracks streaming success: "Your streaming picks won categories 68% of the time"

#### 6. **No Decision Learning/Feedback Loop** ❌

**Hashtag**: No tracking of whether recommendations worked

**Category Edge Advantage**:

- Tracks every add/drop decision you make
- Stores outcome: "Did this help you win categories?"
- AI learns from your successes and failures
- Improves recommendations over time based on YOUR results

#### 7. **Generic Category Analysis** ❌

**Hashtag**: Shows overall category rankings, but not matchup-specific needs

**Category Edge Advantage**:

- "You need 3 more steals to win this week" (not just "you're weak in steals")
- Real-time category standings during games
- Category-specific player recommendations
- Matchup-aware suggestions (what categories you're winning/losing)

#### 8. **No Proactive Recommendations** ❌

**Hashtag**: You have to manually check tools and figure out what to do

**Category Edge Advantage**:

- Dashboard shows "Optimal Add: Player X | Drop: Player Y" upfront
- Explains WHY: "Player X has 2 games remaining, gives you +2.3 steals vs opponent"
- One-click action (if Yahoo API supports transactions)
- Reduces time from 15 minutes of analysis to 30 seconds

### Competitive Differentiation Summary

| Feature | Hashtag Basketball | Category Edge |

|---------|-------------------|---------------|

| League Sync | ✅ Yahoo, ESPN, Fantrax, Sleeper | ✅ Yahoo, ESPN (free tools) |

| AI Personalization | ❌ General algorithms | ✅ Learns from YOUR decisions |

| Real-Time Updates | ❌ Static daily updates | ✅ Live category standings during games |

| Drop Suggestions | ❌ Manual drop decisions | ✅ Optimal add/drop pairs |

| Mid-Game Alerts | ❌ No alerts | ✅ Push notifications for breakouts |

| Streaming Focus | ❌ General-purpose | ✅ Built for daily streaming |

| Decision Tracking | ❌ None | ✅ Tracks your decisions & outcomes |

| Category-Specific | ⚠️ General rankings | ✅ Matchup-specific category needs |

| Proactive Recommendations | ❌ Manual tool checking | ✅ Dashboard shows optimal actions |

### Why Category Edge Wins for Streaming

**Hashtag Basketball** = "Here's data and tools, you figure it out"

**Category Edge** = "Here's exactly what to do, click here"

**For Daily Streaming Managers**:

- Hashtag requires: Check tools → Analyze matchup → Find players → Decide who to drop → Make decision (15+ min)
- Category Edge: See recommendation → Click add/drop → Done (30 seconds)

**The Daily Grind** (6 months, 20+ decisions/week):

- Hashtag: Time-consuming, manual analysis each day
- Category Edge: Fast decisions, AI gets smarter, learns your preferences

### Market Validation

✅ **Hashtag proves**: Users pay $2.50/month for league tools

✅ **Category Edge advantage**: AI personalization + real-time + streaming focus = premium value

✅ **Differentiation**: Not just better tools, but completely different approach (AI learning vs static data)

### Free Tools Strategy (Avoiding Paid Services)

**Free Data Sources**:

- ✅ **Yahoo Fantasy API** - Free, official API for league data
- ✅ **ESPN Scraping** - Free (Selenium/Playwright), no API needed
- ✅ **NBA Stats API** - Free, public API for player stats and live game data
- ✅ **Basketball Reference** - Free scraping for historical player data
- ❌ **Hashtag Basketball APIs** - Paid, avoid for now

**Build Our Own**:

- League sync (Yahoo API, ESPN scraping)
- Player stats (NBA Stats API)
- Live game data (NBA Stats API)
- No paid dependencies

### Other Competitors: Fantasy WZD

**Fantasy WZD**: Another fantasy basketball app with recommendations

- **Competitive Note**: Validates market demand for better streaming tools
- **Differentiation**: Category Edge's AI personalization and real-time features are unique

### Key Competitor: Hashtag Basketball Premium

**What They Offer** ([hashtagbasketball.com/premium](https://hashtagbasketball.com/premium/)):

- **League Sync**: Successfully syncs Yahoo, ESPN, Fantrax, and Sleeper leagues
- **Tools**: Schedule Grid, Waiver Wire Rankings, Trade Machine, Waiver Machine, H2H Matchup Planner, League Scouting Report
- **Price**: $2.50/month via Patreon
- **Proves**: League syncing is feasible and valuable - validates our Phase 1 approach

**Their Limitations (Our Opportunities)**:

- **No AI personalization**: General rankings/projections, not learned from your decisions
- **Static updates**: Rankings update daily, not real-time during games
- **No mid-game alerts**: Shows stats after games end, not during
- **Generic recommendations**: Waiver Machine suggests adds but not optimal drop candidates
- **General-purpose**: Built for all fantasy needs, not streaming-specific

**Category Edge Differentiation**:

1. **AI learns YOUR decisions** - Hashtag uses general algorithms, we personalize
2. **Live category updates** - Real-time standings during games (they show projections only)
3. **Optimal add/drop pairs** - They suggest adds, we suggest who to drop too
4. **Mid-game breakout alerts** - Proactive notifications vs reactive stats
5. **Streaming-first design** - Built for daily decisions, not general fantasy management

**Market Validation**: Hashtag's success proves:

- ✅ League syncing works (Yahoo, ESPN both feasible)
- ✅ Users pay for premium fantasy tools ($2.50/month)
- ✅ There's demand for better waiver/streaming tools
- ✅ Opportunity exists for AI-powered personalization

---

## Phase 1 (Weeks 1-3): "Auto-Sync Your League" - PRIORITY #1

> **Note on Hashtag Basketball APIs:** Their league-sync APIs are no longer free. We'll treat them as a potential paid integration. Phase 1 focuses on building our own sync pipeline (Yahoo first) so we are not blocked by 3rd-party pricing. If budget allows, we can optionally license Hashtag's API later for additional data sources.

**Goal**: Connect to Yahoo/ESPN so matchup data flows automatically. This is the foundation - without it, the tool isn't useful daily.

### What You're Actually Building:

#### 1. Basic Web Interface (Minimal)

- **Tech**: Next.js + TypeScript + TailwindCSS
- **Pages**: 
                                                                - Login page (email/password, simple auth)
                                                                - Dashboard: "Connect your Yahoo/ESPN league"
                                                                - League status page: Shows sync status, matchup data
- **Minimal UI**: Just enough to connect leagues and see data

#### 2. Yahoo Fantasy API Integration

- **Research first**: Yahoo Fantasy API documentation (1-2 days)
- **OAuth flow**: 
                                                                - User clicks "Connect Yahoo"
                                                                - Redirects to Yahoo, authorizes
                                                                - Store OAuth tokens securely
                                                                - Fetch league data (teams, rosters, matchups)
- **API calls**: 
                                                                - `GET /leagues/{league_id}/teams` - Get rosters
                                                                - `GET /leagues/{league_id}/matchups` - Get current matchup
                                                                - `GET /players/{player_id}/stats` - Get player stats
- **Rate limiting**: Yahoo limits to ~1000 calls/day - cache aggressively
- **Error handling**: Handle expired tokens, API errors, rate limits

#### 3. ESPN Integration (Alternative/Scraping)

- **Problem**: ESPN doesn't have public API
- **Solution**: Selenium/Playwright automation
                                                                - User provides ESPN login credentials (stored encrypted)
                                                                - Bot logs in, navigates to league page
                                                                - Scrapes HTML for matchup data
                                                                - Parse and normalize data
- **Complexity**: Higher - ESPN changes HTML frequently, need error handling
- **Alternative**: Start Yahoo-only, add ESPN later (can be Phase 1.5)

#### 4. League Sync Service

- **Tech**: Celery background tasks + FastAPI backend
- **What**: Every 6 hours (or on-demand), refresh league data
- **Store**: 
                                                                - League ID, team IDs
                                                                - Roster snapshots (who's on your team)
                                                                - Matchup data (current week standings)
                                                                - Category totals (your stats vs opponent)
- **Handle**: Multiple leagues per user, sync failures, rate limits
- **Database**: PostgreSQL for league/team/roster/matchup tables

#### 5. Player Stats Database (Free Sources)

- **Tech**: PostgreSQL
- **What**: Store player names, positions, season averages per category
- **Free Data Sources**:
                                - **NBA Stats API** (free, official) - Primary source for player stats
                                - **Basketball Reference** (free scraping) - Backup for historical data
- **Update**: Daily cron job fetches latest stats from NBA Stats API
- **Purpose**: Need player data to show recommendations later
- **Note**: All free - no paid data services needed

**Deliverable**: Click "Connect Yahoo", see your matchup auto-populated with current category standings, roster, and opponent data.

**Time**: 2-3 weeks (Yahoo API is straightforward, ESPN scraping is harder)

**Complexity**: Medium - OAuth + API integration + error handling + data normalization

**Why This First**: Without auto-sync, you have to manually enter data every day = tool isn't useful. This unlocks everything else.

---

## Phase 2 (Weeks 4-5): "Basic Recommendations" - Works With Synced Data

**Goal**: Once league data is syncing, add simple rule-based recommendations.

### What You're Actually Building:

#### 1. Basic Recommendation Engine (Rule-Based, Not AI)

- **Tech**: Python FastAPI backend
- **Logic** (simple heuristics):
  ```
  For each available player:
  1. Check if they have games in next 2 days
  2. Calculate their average per-game stats in categories you need
  3. Rank by: (category need × player strength) / games remaining
  4. Return top 5 suggestions
  ```

- **Data source**: Player database from Phase 1
- **No ML yet** - just math and rules

#### 2. Category Needs Calculator

- **Tech**: Python service
- **What**: Given synced matchup data, calculates "you need X more steals to win"
- **Logic**: Current standings + projected remaining games = category needs
- **Uses**: Synced matchup data from Phase 1

#### 3. Recommendations UI

- **Tech**: Next.js frontend
- **What**: Display recommended players with reasoning
- **Shows**: Player name, category impact, games remaining, why recommended

**Deliverable**: See your synced matchup, get 5 player suggestions ranked by category need, make your decision.

**Time**: 1-2 weeks

**Complexity**: Low - mostly calculations + UI

---

## Phase 3 (Weeks 6-9): "AI That Learns From You"

**Goal**: Personalize recommendations based on your past decisions.

### What You're Actually Building:

#### 1. Decision Tracking System

- **What**: Every time you add/drop a player, store:
                                                                - Player added
                                                                - Player dropped (if any)
                                                                - Categories you were targeting
                                                                - Matchup context (winning/losing, which categories)
                                                                - Outcome (did you win those categories?)
- **Tech**: PostgreSQL table `user_decisions`
- **UI**: After you make a decision, simple form: "Did this help you win?" (yes/no)

#### 2. Feature Engineering

- **What**: Convert decisions into ML features
- **Features**:
                                                                - Player stats (season avg, last 7 games, last 14 games)
                                                                - Category needs (how many steals/blocks/etc needed)
                                                                - Matchup context (winning by X, losing by Y)
                                                                - Player position, team schedule
                                                                - Your historical success rate with similar decisions
- **Tech**: Python pandas for feature extraction

#### 3. Simple ML Model (Start Simple!)

- **First version**: Logistic regression or XGBoost
- **Training data**: Need ~50-100 decisions before model is useful
- **What it learns**: "When user needs steals and player X is available, user adds them 80% of the time"
- **Prediction**: Given current context, predict probability you'll add each player
- **Tech**: scikit-learn or XGBoost (not deep learning - overkill)

#### 4. Recommendation Ranking

- **Combine**: Rule-based score + ML prediction score
- **Show**: "Recommended for you (85% match)" vs "Good option (60% match)"
- **Explain**: "We recommend this because you've added similar players 5 times before"

**Deliverable**: After using tool for 2-3 weeks, recommendations become personalized to your style.

**Time**: 3-4 weeks (but model improves over time as you use it)

**Complexity**: Medium - ML basics, but need data collection period first

---

## Phase 4 (Weeks 10-13): "Real-Time During Games"

**Goal**: See category standings update live during games.

### What You're Actually Building:

#### 1. Live Game Data Integration

- **Data source**: NBA Stats API (free, public)
- **What**: Fetch play-by-play or box scores every 2-5 minutes during games
- **API calls**: `GET /stats/boxscore` for active games
- **Update frequency**: Every 2-5 minutes (balance between real-time and API limits)

#### 2. Category Standings Calculator (Real-Time)

- **What**: Recalculate category standings as games progress
- **Logic**: 
                                                                - Current matchup totals + live game stats = updated standings
                                                                - Show: "You're now +3 in steals (was +2)"
- **Tech**: Redis for fast calculations, PostgreSQL for storage

#### 3. WebSocket Server

- **Tech**: FastAPI WebSockets or Socket.io
- **What**: Push updates to frontend when stats change
- **Client**: Frontend subscribes to "league-123" channel
- **Message**: `{ category: "steals", your_total: 45, opponent_total: 42, change: +1 }`

#### 4. Frontend Real-Time Updates

- **Tech**: React hooks + WebSocket client
- **UI**: Category standings update without page refresh
- **Visual**: Green/red indicators showing category changes

**Deliverable**: During active games, see your category standings update live.

**Time**: 3-4 weeks (WebSocket infrastructure + NBA API integration)

**Complexity**: Medium-High - Real-time systems require careful architecture

---

## Phase 5 (Weeks 14-16): "Drop Candidate Suggestions"

**Goal**: AI suggests who to drop, not just who to add.

### What You're Actually Building:

#### 1. Roster Analysis

- **What**: Analyze your current roster (from synced data)
- **Logic**:
                                                                - Players with no games remaining this week = drop candidates
                                                                - Players with low category contributions = drop candidates
                                                                - Players you've dropped before in similar situations = likely drops
- **Tech**: Rule-based first, then ML-enhanced

#### 2. Optimal Add/Drop Pairs

- **What**: "Add Player X, Drop Player Y" suggestions
- **Logic**: 
                                                                - Calculate net category impact: (Player X stats) - (Player Y stats)
                                                                - Rank by category need alignment
                                                                - Consider: Games remaining, matchup difficulty, injury risk
- **Output**: "Add Terry Rozier, Drop Jalen Suggs" with reasoning

#### 3. One-Click Actions

- **What**: Button that says "Add Rozier, Drop Suggs"
- **Implementation**: 
                                                                - For Yahoo: Use Yahoo API to make transaction (if available)
                                                                - Otherwise: Show instructions "Go to Yahoo and make this transaction"
- **Track**: Did user follow recommendation? Store outcome.

**Deliverable**: See "Optimal Add: Player X | Drop: Player Y" with one-click action.

**Time**: 2-3 weeks

**Complexity**: Medium - Requires roster analysis + transaction API integration

---

## Phase 6 (Weeks 17-19): "Breakout Alerts"

**Goal**: Push notifications when players exceed expectations mid-game.

### What You're Actually Building:

#### 1. Breakout Detection Service

- **What**: Monitor active games, detect breakout performances
- **Logic**:
                                                                - Player projected: 1.2 steals per game
                                                                - Player has: 3 steals in Q2
                                                                - Threshold: >150% of projection = breakout
                                                                - Check: Is player available? Relevant to user's matchup?
- **Tech**: Background Celery task runs every 2-5 minutes during games

#### 2. Notification Preferences

- **What**: User settings for alerts
                                                                - Categories to monitor (steals, blocks, etc.)
                                                                - Threshold sensitivity (aggressive vs conservative)
                                                                - Quiet hours (don't alert at 2am)
- **Tech**: PostgreSQL user_settings table

#### 3. Web Push Notifications

- **Tech**: Service Worker + Web Push API
- **What**: Browser notification: "Terry Rozier has 3 steals in Q2 - adds +0.8 to your lead"
- **Implementation**: 
                                                                - User grants notification permission
                                                                - Service worker receives push from server
                                                                - Show notification with action buttons

#### 4. Mobile Push (If Mobile App Exists)

- **Tech**: Firebase Cloud Messaging (FCM)
- **What**: Same alerts, but on mobile
- **Requires**: Mobile app from Phase 7

**Deliverable**: Get browser/mobile notifications when relevant players break out mid-game.

**Time**: 2-3 weeks

**Complexity**: Medium - Requires background monitoring + push infrastructure

---

## Phase 7 (Weeks 20-23): "Mobile App"

**Goal**: Use tool on phone for quick decisions.

### What You're Actually Building:

#### 1. React Native Setup

- **Tech**: Expo (easiest React Native setup)
- **Structure**: Shared API client with web app
- **Navigation**: React Navigation

#### 2. Core Mobile Screens

- **Dashboard**: See current matchup, category standings
- **Recommendations**: Swipeable cards with add/drop suggestions
- **Notifications**: List of recent alerts
- **Settings**: League connections, notification preferences

#### 3. Mobile-Specific Features

- **Quick actions**: Swipe to add/drop
- **Widgets**: iOS/Android home screen widget showing category standings
- **Offline mode**: Cache last recommendations for offline viewing

**Deliverable**: Mobile app with core features (recommendations, notifications, matchup view).

**Time**: 3-4 weeks

**Complexity**: Medium - React Native is straightforward if web app exists

---

## Updated Timeline Summary

**Weeks 1-3**: Auto-sync leagues (Yahoo API) - **START HERE**

**Weeks 4-5**: Basic recommendations (rule-based)

**Weeks 6-9**: AI personalization (after collecting decision data)

**Weeks 10-13**: Real-time updates during games

**Weeks 14-16**: Drop candidate suggestions

**Weeks 17-19**: Breakout alerts

**Weeks 20-23**: Mobile app

**Total**: ~6 months for full-featured product

**But**: You can start using it after Week 3 (league sync), and it gets better each phase.

---

## Key Technical Decisions Explained

### Why League Sync First?

- **Foundation**: Everything else depends on having matchup data
- **Daily utility**: Tool isn't useful if you have to manually enter data every day
- **Validates integration**: Proves Yahoo/ESPN connection works before building features

### Why Rule-Based Before AI?

- Need data before ML is useful
- Rule-based works immediately
- Can A/B test: "ML vs rules" to prove ML value

### Why Yahoo Before ESPN?

- Yahoo has official API (easier)
- ESPN requires scraping (harder, more fragile)
- Validate with one platform first

### Why Web Before Mobile?

- Faster to build
- Easier to iterate
- Mobile can reuse most backend code

### Why 5-Minute Updates, Not Real-Time?

- NBA API rate limits
- 5 minutes is "real-time enough" for streaming decisions
- Reduces infrastructure complexity

---

## Success Metrics Per Phase

**Phase 1 (League Sync)**: Does it sync reliably? Can you see your matchup data?

**Phase 2 (Recommendations)**: Do recommendations make sense? Do you use them?

**Phase 3 (AI)**: Are recommendations getting better? Do you follow them more?

**Phase 4 (Real-Time)**: Do you check during games? Does it change decisions?

**Phase 5 (Drop Suggestions)**: Do you use one-click actions?

**Phase 6 (Alerts)**: Do you act on notifications? Do they arrive in time?

**Phase 7 (Mobile)**: Do you use mobile more than web?

---

## Risk Mitigation

**Risk**: Yahoo/ESPN APIs change or break

**Mitigation**: Build scraping fallback, cache data aggressively

**Risk**: Not enough data for ML

**Mitigation**: Start rule-based, collect data, add ML when ready

**Risk**: Real-time updates too expensive

**Mitigation**: Charge for real-time features, or limit to premium users

**Risk**: Users don't trust AI recommendations

**Mitigation**: Show reasoning, allow manual override, A/B test

**Risk**: Mobile app too complex

**Mitigation**: Start with web-only, mobile is Phase 7 (optional)