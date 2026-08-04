# Trackr — Complete Project Guide

This is the single, current, comprehensive reference for the Trackr codebase — what it is, how every piece works, why it was built the way it was, and how to change it yourself without outside help. It supersedes the older planning docs in this folder (`ARCHITECTURE.md`, `DATA_MODEL.md`, `DISCOVER_AND_SEARCH.md`, `MANGA_TRACKING.md`, `NOTIFICATIONS_PLAN.md`, `BUILD_STATUS.md`), which were written at various earlier points and no longer reflect the shipped system in several places. Where useful they're cited below for extra background, but treat *this* document as ground truth over them.

Everything here describes the live, actively-developed application in `web/`. The repo also contains `backend/` (a Swift Vapor server) and `ios/` (a native SwiftUI app) — these are **abandoned early prototypes** from before the project pivoted to a Next.js web app. They're not deployed, not maintained, and safe to ignore entirely; the rest of this guide never mentions them again.

---

## Table of contents

1. [What Trackr is](#1-what-trackr-is)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [The big architectural idea: tables, not live calls](#4-the-big-architectural-idea-tables-not-live-calls)
5. [Database schema, table by table](#5-database-schema-table-by-table)
6. [The `MediaItem` model and id scheme](#6-the-mediaitem-model-and-id-scheme)
7. [Data sources (external API adapters)](#7-data-sources-external-api-adapters)
8. [The daily cron — how the catalog stays fresh](#8-the-daily-cron--how-the-catalog-stays-fresh)
9. [The poll cron — how notifications get sent](#9-the-poll-cron--how-notifications-get-sent)
10. [Search](#10-search)
11. [Discover](#11-discover)
12. [Collections (franchises)](#12-collections-franchises)
13. [Following / Home feed / Calendar](#13-following--home-feed--calendar)
14. [Dugout (watch queue)](#14-dugout-watch-queue)
15. [Notifications system (push + history)](#15-notifications-system-push--history)
16. [Accounts & auth](#16-accounts--auth)
17. [Settings & personal preferences](#17-settings--personal-preferences)
18. [Frontend structure](#18-frontend-structure)
19. [API route reference](#19-api-route-reference)
20. [Environment variables](#20-environment-variables)
21. [Local development workflow](#21-local-development-workflow)
22. [One-off scripts](#22-one-off-scripts)
23. [Deployment](#23-deployment)
24. [Known constraints & gotchas](#24-known-constraints--gotchas)
25. [Cookbook: how to make common changes](#25-cookbook-how-to-make-common-changes)

---

## 1. What Trackr is

Trackr is a personal release tracker: follow movies, TV shows, games, music artists, and curated cross-media "collections" (franchises like Star Wars or Marvel), and it tells you when something new is coming or has just dropped. It is deliberately **not** a watch-status tracker (no watching/completed/dropped state) — that's a explicit non-goal; "plenty of other apps do that" (see `lib/library.ts`).

The core value proposition is the Home feed: "what's happening with what I follow," phrased in plain language ("New episode Friday, 9:00 PM", "Releases today", "Released yesterday").

Manga was a supported media type but is **currently hidden site-wide** (Discover, Search, Settings, Following) by explicit product decision — the ingestion code and data are untouched, just not surfaced, so it's a small, additive change to bring back later. Every place this matters is called out in this guide.

## 2. Tech stack

- **Next.js 14** (App Router), TypeScript, React 18, Tailwind CSS.
- **Neon** — serverless Postgres, accessed over HTTP via `@neondatabase/serverless` (not a persistent connection pool — this matters, see §4 and §24).
- **NextAuth v5 (beta)** — JWT session strategy, Google OAuth + email/password (Credentials) providers.
- **web-push** — Web Push API notifications, VAPID keys.
- **Vercel** — hosting, plus Vercel Cron for the two scheduled jobs (Hobby plan caps you at **two** cron jobs — this is why there's one consolidated daily job instead of one per concern).
- No ORM. Every DB call is a plain tagged-template SQL query through `lib/db.ts`'s `sql` function.
- No component library — hand-rolled Tailwind, "Nocturne" dark-first design language (starfield background, minimal chrome, an accent color used sparingly).

## 3. Repository layout

```
web/
  app/                    Next.js App Router — pages + API routes
    api/                  All server routes (see §19)
    page.tsx              THE app — one giant client-side SPA shell (§18)
    layout.tsx            Root layout, theme init script, <AuthProvider>
    artist/[id]/page.tsx  Dedicated artist profile page (not part of the SPA shell)
    collection/[slug]/page.tsx   Dedicated collection/franchise detail page
    calendar/page.tsx     Full-page release calendar (separate from the SPA's own "Calendar" tab)
    signin/page.tsx       Sign in / sign up
  components/             Shared React components used by page.tsx and the dedicated pages
  lib/                    All server + shared logic — the real "backend"
    sources/              External API adapters (TMDB, IGDB, MangaDex, Deezer, MusicBrainz, TVmaze) + collection resolution
    db.ts                 Neon client + full schema (CREATE TABLE / ALTER TABLE, idempotent)
    catalog.ts            catalog_items read/write
    upcoming.ts            upcoming_items read/write
    upcomingCalendar.ts    upcoming_calendar / new_releases_calendar (the precomputed release calendars)
    trending.ts            trending_items read/write
    ...                    (many more single-purpose files — see §5–17)
  scripts/                One-off CLI tools, run manually via `npm run <script>` (§22)
  public/sw.js            Service worker (push notification display)
  auth.ts                 NextAuth config
  vercel.json             Cron schedule
  .env.local.example      Every env var, with where to get it
backend/                  Abandoned Swift Vapor prototype — ignore
ios/                      Abandoned SwiftUI prototype — ignore
docs/                     This file, plus older planning docs (see intro)
```

## 4. The big architectural idea: tables, not live calls

This is the single most important thing to understand before changing anything.

**No user-facing request path ever calls TMDB, IGDB, MangaDex, Deezer, MusicBrainz, or Trakt live.** Every read a user triggers (Discover, Search, opening a detail page, the Home feed, notifications history) reads only from Postgres tables that were populated ahead of time by two things:

1. **`scripts/ingest-catalog.ts`** — a manual, one-time-per-type bulk ingest you run yourself (`npm run ingest`) that walks each source's "most popular N" list and writes `catalog_items`.
2. **`GET /api/cron/daily`** — a Vercel Cron job that runs once a day and refreshes everything that changes over time: recent releases, upcoming titles, trending shelves, collection membership, the precomputed release calendars, and the Discover snapshot.

The only exceptions — deliberate, narrow "self-heal" escape hatches — are:
- **Lazy artist admission**: if someone follows/opens an artist who isn't in the catalog yet (found via the live Deezer search fallback), `details()` ingests them on the spot (`lib/sources/index.ts`, `lib/sources/artist.ts`).
- **Lazy TV airtimes**: the first time a TV show with an upcoming episode is actually opened, `lib/airtimes.ts` fetches TVmaze once and caches the result in the row's own `metadata`, TTL'd at 24h.

Everything else is table-only. **Why this matters for you**: if you add a new "Discover shelf" or "Search filter," it must read from a table (`catalog_items`, `upcoming_items`, `trending_items`, `upcoming_calendar`, `new_releases_calendar`, `collection_items`) — never add a live third-party fetch to a route that a user's browser can trigger.

This is also why **the local dev cron never runs automatically** (see §24) — nothing in `next dev` triggers Vercel Cron, so newly-airing shows/games can sit with stale data until you manually hit the cron route with the right bearer token.

## 5. Database schema, table by table

Full source of truth: `web/lib/db.ts`'s `buildSchema()`. It's 100% idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and runs once per server process via `ensureSchema()` — see §24 for the "schema changes need a manual script to apply while the dev server is running" gotcha.

| Table | Written by | Read by | Purpose |
|---|---|---|---|
| `users` | signup/Google sign-in | `auth.ts` | Accounts. `password_hash` NULL = Google-only. `calendar_token` is a capability token for the ICS feed. `is_admin` gates the collection editor. `username` is case-insensitively unique. |
| `followed_items` | `/api/follow`, `/api/unfollow`, `/api/mute` | poll cron, Home feed, notifications | One row per followed title. Pre-accounts this was a single global list (`user_id IS NULL`); post-accounts, `user_id` scopes it and `active` (not deletion — see below) marks unfollowed. Never physically deleted because `notification_history` has an FK to it. |
| `push_subscriptions` | `/api/subscribe`, `/api/follow`, `/api/mute`, `/api/prefs` | poll cron | One row per browser/device that enabled push. `muted_types` (JSON array of `MediaType`), `lead_time_days` (0 = reminders off) live here — **per device**, not per account, on purpose. |
| `subscription_follows` | same routes as above | poll cron | Join table: which subscriptions care about which followed items, plus a per-item `muted` flag (device-scoped mute of one title). |
| `collection_overrides` | admin collection editor (`/api/collection/[slug]`) | `lib/sources/collection.ts` | Admin edits/creates on top of the static `COLLECTIONS` array in `lib/collections.ts`. A row here is a **complete replacement**, not a sparse patch. `is_custom = true` means it has no static fallback. |
| `catalog_items` | bulk ingest script + daily cron (recent releases, followed-show refresh) | almost everything | The bulk, already-released catalog. `id` is `"type:sourceId"` (e.g. `movie:603`). `search_vector` is a generated tsvector column. `metadata` is a type-specific JSON blob (TV: seasons/episodes; artist: discography; game: platforms). |
| `upcoming_items` | daily cron only | `lib/upcoming.ts`, search, calendars | Not-yet-released movies/TV/games. Churns constantly — refreshed wholesale daily, unlike the catalog's append-only model. |
| `release_date_overrides` | manual (you, by hand — no UI for this) | `lib/releaseDateOverrides.ts`, applied at the end of every ingest | A permanent manual pin for a title whose upstream date is simply wrong. Always wins, forever, until removed. |
| `collection_items` | `scripts/rebuild-collections.ts` / cron stage D | `lib/sources/collection.ts` | Precomputed collection membership (movie/tvShow/game/manga ids per collection slug), resolved from the hand-curated title lists in `lib/collections.ts`. |
| `collection_next_release` | same rebuild | collection detail page | One row per collection: its single nearest not-yet-released entry (matched against `upcoming_calendar`). |
| `trending_items` | daily cron (stage C) | Discover trending shelves | Each source's own real "hot right now" signal — distinct from `catalog_items.popularity_score`, which is all-time cumulative. Full replace every run. |
| `discover_snapshot` | daily cron (stage F, last) | `/api/discover` (no-filter case) | Single-row (`id=1`) precomputed JSON blob of the whole unfiltered Discover payload — turns 8 parallel table reads into one. |
| `upcoming_calendar` | daily cron (stage E) | Discover "Popular upcoming", `/calendar` page | The real, quality-gated release calendar — see §11.3. `rank_score` and `franchise_pick` drive the highlight-shelf selection and the international/general anticipation bars. |
| `new_releases_calendar` | daily cron (stage E) | Discover "New releases" | The other half of a title's lifecycle: rows **graduate** here from `upcoming_calendar` the day after their release date. Never independently admitted. |
| `dugout_items` | `/api/dugout` | Dugout page, DetailModal | Watch queue: `status` is `onDeck | watchlist | currentlyWatching`, one of the three at a time. On Deck capped at 5 per type. |
| `notification_history` | `/api/poll` only | `/api/notifications` | One global row per logged notification event. `lead_days`: `0` = release day (everyone gets this), `>0` = an advance reminder someone configured. `title`/`subtitle`/`message` are **frozen at log time**, never rewritten. |

Account-scoping pattern used throughout (`followed_items`, `dugout_items`): a nullable `user_id` plus **two** unique indexes — a composite `(user_id, item_id)` for signed-in rows, and a partial one scoped to `WHERE user_id IS NULL` for anonymous rows (Postgres treats `NULL <> NULL`, so a bare composite index alone would let duplicate anonymous rows through).

## 6. The `MediaItem` model and id scheme

Everything the frontend renders is a `MediaItem` (`lib/types.ts`):

```ts
type MediaType = "movie" | "tvShow" | "game" | "manga" | "franchise" | "artist";
interface MediaItem {
  id: string;              // "movie:603", "artist:1234", "franchise:star-wars"
  type: MediaType;
  title: string;
  subtitle?: string;       // "S3 E4", "Single — Title", a tagline, etc. — type-dependent
  overview?: string;
  posterURL?: string;
  backdropURL?: string;    // wide hero art for the detail modal header
  releaseDate?: string;    // ISO date — meaning is type-dependent, see below
  releaseAt?: string;      // exact UTC instant, TV episodes only (via TVmaze — see §7.6)
  externalLinks?: ExternalLink[];
  episodes?: EpisodeInfo[];      // tvShow only
  episodeCount?: number;         // tvShow only
  releases?: ReleaseGroupInfo[]; // artist only — discography, newest first
  theme?: MediaTheme;            // franchise only
}
```

**`id` format is always `"type:sourceId"`** — the type prefix plus that source's own native id (TMDB numeric id for movie/tvShow, IGDB numeric id for game, MangaDex UUID for manga, Deezer numeric id for artist, the collection's slug for franchise). Every route that takes an id splits on the first `:` to recover both halves.

**`releaseDate` has a different meaning per type** — this trips people up:
- movie/game: the release date itself.
- tvShow: the **next upcoming episode's** air date (not the show's original premiere) — computed at read time in `catalogRowToMediaItem` (`lib/catalog.ts`) by scanning stored season/episode metadata.
- artist: the **next announced release's** date, computed the same way from the stored discography (`lib/catalog.ts`'s artist branch).
- franchise: the collection's single nearest upcoming entry (`lib/sources/collection.ts`'s `resolveCollection`).

This is why a followed item that has nothing upcoming (a movie already out, a TV show between seasons with no next-episode data) simply has no `releaseDate` and drops out of the Home feed — that's correct behavior, not a bug (see `lib/feed.ts`'s comment on `buildFeed`).

## 7. Data sources (external API adapters)

All in `lib/sources/*.ts`. Each adapter is used in three distinct ways depending on the situation: **search**, **discover/details** (single item), and **bulk pagination** (for `scripts/ingest-catalog.ts` and the daily cron). Every adapter applies its own "quality bar" — a combination of a real popularity/vote-count/follow-count signal (for already-released titles) and a looser pass for unreleased/just-released titles (which legitimately have zero votes yet). The exact thresholds and the reasoning behind each one are documented inline in each file; the philosophy is explained at length in `docs/DISCOVER_AND_SEARCH.md`.

### 7.1 TMDB (`tmdb.ts`) — movies & TV
- Keyed via `TMDB_API_KEY`. Posters at `w342`, backdrops at `w1280`.
- `PROVIDER_SEARCH_RULES` — 32 real streaming/rental services, matched by regex against TMDB's `watch/providers` response, mapped to a "search this service for the title" URL (TMDB never gives real per-title deep links — only its own aggregator page). **Order matters**: named/branded services (Crunchyroll, Paramount+, Peacock, ...) must come before the four generic catch-alls (Apple, Google Play, YouTube, Amazon) at the bottom, or reseller "channel" bundles like "Crunchyroll Amazon Channel" get mislabeled.
- `usTheatricalDate()` corrects a movie's unreliable top-level `release_date` against its `/release_dates` sub-resource (the real cause of several "wrong release date" bugs this project hit).
- `tvExtra()` fetches full per-season/per-episode data — one request per season, season 0 ("Specials") always excluded. Deliberately serial (`SEASON_CONCURRENCY = 1`) after concurrency was found to trigger empty-but-200 TMDB responses under load.
- Exposes separate functions for: search, single-item details, "trending" (real momentum via `/trending/*/week`), "upcoming" (dated + trending-but-undated, filtered to officially-confirmed status), "recent releases" (last ~30 days, for the daily catalog refresh), and bulk pagination (10k movies/TV by vote_count for the initial ingest).

### 7.2 IGDB (`igdb.ts`) — games
- OAuth via Twitch (`IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`), token cached module-level including the in-flight promise (avoids a thundering herd of auth requests). Rate-limited to ~4 req/s via a rolling-window throttle.
- `JUNK_GAME_TYPES` is a **denylist** (seasons, DLC, mods, remasters, bundles, ...) applied to IGDB's `game_type` field — deliberately not an allowlist, because the real base "Minecraft" entry is itself tagged as a non-`main_game` type.
- Upcoming-game admission: a real credited developer/publisher (`hasCreditedStudio`), not a hype/rating floor — an unannounced placeholder has no company credited regardless of hype.

### 7.3 MangaDex (`mangadex.ts`) — manga (ingestion still runs; **not surfaced anywhere in the UI**, see §1)
- Content rating restricted to safe+suggestive (excludes erotica/pornographic, which MangaDex returns by default).
- Popularity signal is `follows`, fetched via a separate batched `/statistics/manga` call.
- Cover images are proxied through `/api/cover/mangadex/[mangaId]/[fileName]` because MangaDex's CDN blocks requests without a real browser User-Agent.

### 7.4 Deezer + MusicBrainz (`deezer.ts`, `musicbrainz.ts`, `artist.ts`) — music
- **Deezer** is the identity/popularity/image/released-discography source — keyless, its numeric artist id **is** Trackr's artist id.
- **MusicBrainz** supplements *only* strictly-future-dated release-group entries Deezer can't provide (Deezer only shows a release the day it drops). Hard 1 req/s cap (MusicBrainz policy) — this is why the bulk ingest skips MusicBrainz entirely (`withMB: false`) and only the daily cron's rotating refresh / lazy admission / follow-triggered resolution pays that cost, budgeted (`ARTIST_REFRESH_PER_RUN = 20`/day).
- Music has **no** bulk "top N artists" list anywhere — the catalog pool is built by BFS over Deezer's related-artists graph starting from its chart. A niche artist not in that pool is found via a **live** Deezer search fallback at request time (the one and only live third-party call in the whole search path — time-boxed to 1.2s, only awaited when the DB catalog came back thin).

### 7.5 Trakt (`trakt.ts`) — the real quality gate for "Popular upcoming" movies/TV
TMDB's own `popularity`/`vote_count` are useless for unreleased titles (verified: a completely unknown short film and a huge tentpole score nearly identically). Trakt's `movies/anticipated` and `shows/anticipated` lists (ranked by `list_count` — real users who added it to a personal watchlist) are the actual admission gate for "Popular upcoming"/"New releases" — see §11.3. Requires a browser-like `User-Agent` or Cloudflare blocks the request.

### 7.6 TVmaze (`tvmaze.ts`) — exact episode air times
Keyless, used only by the lazy `lib/airtimes.ts` attachment (never in any bulk pipeline — see §4). Supplies real UTC timestamps for episodes that have a confirmed broadcast time; falls back to `lib/streamingSchedules.ts`'s narrow, verified table of known fixed platform drop times (currently just Apple TV+'s 12:00 AM Pacific) when TVmaze only has a date, no time.

## 8. The daily cron — how the catalog stays fresh

`GET /api/cron/daily` (`app/api/cron/daily/route.ts`), triggered by Vercel Cron at 9:00 UTC daily (`vercel.json`), auth'd via `Authorization: Bearer $CRON_SECRET`. Six stages, in dependency order:

- **A — Upcoming refresh**: `upcoming_items` fully replaced per type (movie/tvShow/game) with the current biggest unreleased/announced titles, dated or not.
- **B — Recent releases**: titles released in the last ~30 days upserted into `catalog_items` (all types except manga, which is paused). This is what "graduates" a title on release day — stage A prunes it out of `upcoming_items`, stage B lands it in the catalog. Re-running the whole 30-day window daily keeps a fresh title's score/poster/metadata self-correcting for a month.
- **C — Trending refresh**: `trending_items` fully replaced with each source's own real momentum signal.
- Also in this batch, running alongside A/B/C: **artist discography rotation** (`refreshArtistDiscographies` — followed artists first, then the stalest 20 of the rest), **followed-TV-show refresh** (`refreshFollowedTVShows` — a real gap fix: stage B's popularity/date-window admission can permanently skip a lower-profile-but-followed show), and **followed-upcoming-TV-show refresh** (`refreshFollowedUpcomingTVShows` — the unreleased-show counterpart, using the `upcoming_items.metadata` column).
- **D — Collection self-heal**: re-resolves `lib/collections.ts`'s hand-curated title lists against the catalog (`rebuildAllCollections`, `lib/collections-rebuild.ts`). The curated lists themselves never change automatically — only the title→id lookup reruns, so a title that wasn't in the catalog yesterday self-heals the day a bigger ingest adds it.
- **E — Upcoming calendar rebuild** (`refreshUpcomingCalendar`, `lib/upcomingCalendar.ts`): builds the real, quality-gated release calendars — see §11.3. Must run after A/B (fresh source data) and before F.
- **F — Discover snapshot rebuild** (`refreshDiscoverSnapshot`): runs dead last so it reflects everything A–E just refreshed.

Everything runs inside `Promise.allSettled` — one stage failing never blocks the others, and the JSON response reports per-stage success/failure/counts.

Manga ingestion is **paused, not removed** — see the big comment at the top of the route for exactly what to restore to bring it back.

## 9. The poll cron — how notifications get sent

`GET /api/poll` (`app/api/poll/route.ts`), Vercel Cron at 8:00 UTC daily, same bearer-token auth. For every row in `followed_items`, resolves current details via `details()`, then fires up to two independent triggers:

1. **Release day** (`lead_days = 0`) — unconditional for every follow, regardless of any device's lead-time preference. "The one notification every follow is guaranteed to get."
2. **Reminder** (`lead_days > 0`) — only for devices that configured a lead time in Settings, and only on the exact day that's `N` days out.

Idempotency is enforced by a DB constraint, not application logic: `INSERT ... ON CONFLICT (followed_item_id, event_type, release_date, lead_days) DO NOTHING RETURNING id` — a push is only ever sent when that insert actually produced a new row, so re-running the poll the same day (or a manual trigger alongside the real cron) can never double-notify.

A push subscription the push service itself reports as permanently gone (404/410) gets pruned from `push_subscriptions` right there instead of failing identically forever (`pushAndPrune` in the route, `sendPush`'s `{ ok, gone }` return in `lib/push.ts`).

There used to be a third trigger — a `'change'` event fired whenever a followed item's stored release date differed from the prior poll's snapshot — **this was removed** (see the route's top comment) because it produced noisy, repetitive notifications, especially the day backend data gets bulk-refreshed. If you ever see `event_type = 'change'` rows in `notification_history` again, that trigger has regressed.

## 10. Search

`GET /api/search?q=...&type=...&hide=...` → `lib/sources/index.ts`'s `search()`.

- **Combined ("All") search** hits `lib/search.ts`'s `searchCatalogAndUpcoming` — a single `UNION ALL` SQL query across `catalog_items` and `upcoming_items` (merging them client-side used to cost two Neon round trips; Neon's HTTP driver pays ~50-150ms latency *per query*, so this matters for every keystroke).
- Full-text matching uses Postgres `tsvector`/`tsquery` against a prefix-matched query (`buildPrefixQuery` in `lib/catalog.ts` — `"toy story"` → `"toy:* & story:*"`).
- Collections/franchises are resolved separately (`lib/sources/collection.ts`'s `searchCollections` — pure in-memory fuzzy match, no DB-heavy join) and shown as their own row above the flat results grid, never mixed in.
- **Music is the one type with a live fallback**: no source has a "top N artists" bulk list, so a niche artist not in the pre-ingested catalog pool is only findable via a live, time-boxed (1.2s) Deezer search — started in parallel with the DB query, only *awaited* when the catalog came back thin (`LIVE_ARTIST_MIN_CATALOG_HITS = 5`).
- Typo tolerance (`lib/sources/textMatch.ts`) generates single-edit variants (transposition, deletion, vowel insertion, space insertion, and compound space+transposition) — but this machinery is currently only consumed by the franchise-resolution path (`fuzzyMatches`/`typoVariants`), not general catalog search, since catalog search runs through Postgres tsquery, which has its own prefix tolerance.

## 11. Discover

`GET /api/discover` → `lib/sources/index.ts`'s `discoverCached()`, which serves the precomputed `discover_snapshot` row when there's no content filter and both anticipation bars are at their defaults (the overwhelmingly common case), and computes live from tables otherwise.

### 11.1 The shelves
Trending movies/TV/games/artists (from `trending_items`), "Popular upcoming" and "New releases" (from the two precomputed calendars, §11.3), and "Featured collections."

### 11.2 "See all" / pagination
`?category=movies|tv|games|artists|collections` returns a single fixed-size grid. `?category=upcoming|new-releases&page=N` is different — these two are meant to be browsed hundreds deep (a real release calendar), paginated by **page number**, not item offset, against the precomputed calendar tables directly.

### 11.3 The precomputed calendars — the most subtle part of the whole app
`lib/upcomingCalendar.ts`. `upcoming_calendar` and `new_releases_calendar` are the actual, quality-gated release calendars everything else (the Discover shelves, the `/calendar` page, the franchise-pick admission) reads from. Understanding the admission model matters if you ever touch this:

- **Movies & brand-new TV**: admitted only if Trakt's anticipated lists say so (§7.5) — membership in that list *is* the gate, no threshold layered on top.
- **Games**: admitted by IGDB's `hypes` clearing a real floor (`GAME_POPULARITY_FLOOR = 70`) — a signal that actually distinguishes AAA from indie/slop for unreleased titles, unlike Trakt-equivalent data (which doesn't exist for games).
- **Returning shows' season premieres**: a completely separate mechanism (`fetchReturningTVPremieres`) — scans the *entire* `catalog_items` TV set for a stored next-season-premiere date. Trakt has no concept of "how anticipated is season 3 of an existing hit," only "brand new thing nobody's seen."
- **Franchise picks**: titles admitted purely for belonging to a `featured: true` curated collection (Star Wars, Marvel, One Piece, ...), regardless of any other signal — "the whole point is show it regardless of popularity." Matched via each collection's curated titles plus a derived franchise-level keyword (see §12).
- **`rank_score`** is stored per row (Trakt `list_count` / catalog `vote_count` / IGDB `hypes` depending on which path admitted it) — **never** used to decide admission, only to pick the small highlight-shelf slice out of the already-admitted pool, so the biggest thing per type surfaces regardless of how soon it arrives.
- **International bar / general bar** (`lib/intlBar.ts`, `lib/generalBar.ts`, Settings) are *extra* floors layered on top of the admission above, applied at read time via a SQL fragment, not baked into the refresh — so changing the setting doesn't require recomputing anything. International bar raises the floor only for `original_language <> 'en'` rows; general bar raises it for everyone. Both exempt games, returning-show premieres, and franchise picks.
- **`new_releases_calendar`** has **no independent admission logic at all** — a row only ever arrives there by graduating out of `upcoming_calendar` the day after its release date passes (`graduateReleasedTitles`), inheriting the same `rank_score` it already earned. This is what guarantees a title can never appear in both calendars simultaneously.

## 12. Collections (franchises)

A collection ("franchise" in code/`MediaType`) is a hand-curated cross-media grouping — not derivable from any single API. Defined entirely in `lib/collections.ts`'s `COLLECTIONS` array: a slug, theme colors, and a `curated` object of **exact, hand-picked title lists** per type (`{ movie: [...], tvShow: [...], game: [...] }`).

- Membership is resolved **once**, offline, by `scripts/rebuild-collections.ts` / the daily cron's stage D — exact → prefix → contains title match against `catalog_items`, written into `collection_items`. No live query matching happens on any read path.
- `lib/sources/collection.ts`'s `resolveCollection()` is what a collection detail page actually reads: precomputed membership, plus a cross-type "Most Popular" row (popularity normalized per type bucket, so games' smaller numeric scale can't be dominated by movies' bigger one), plus the "Up next" card (matched separately against `upcoming_calendar`, using both the curated titles *and* a derived franchise-level keyword — see `deriveUpcomingKeywords`, which splits a subtitled entry like `"Spider-Man: Homecoming"` on its first `": "` so a brand-new, not-yet-listed sequel like `"Spider-Man: Brand New Day"` still resolves without editing the curated list).
- **Admin editing** (`is_admin` users only, gated in `app/api/collection/[slug]/route.ts`): `collection_overrides` lets you edit a curated collection's presentation (colors, banner/logo/poster art, tagline, featured flag) or manually pin/hide specific titles (`includeOverrides`/`excludeIds`) without touching code. A brand-new collection created entirely through the editor (`is_custom = true`) has no static fallback — deleting it removes it outright, versus reverting a curated one to its code-defined default.
- **To change what's in a collection**: edit its `curated` list in `lib/collections.ts`, then run `npm run rebuild-collections` (or wait for the next daily cron).

## 13. Following / Home feed / Calendar

- **Following list** is stored client-side in `localStorage` (`lib/library.ts`) as a frozen snapshot taken at follow time — `followedAt` never changes, and the snapshot's `releaseDate`/`subtitle` go stale (a weekly show's next-episode date is wrong within a week). `app/page.tsx` refreshes a **display-only overlay** (`freshById`, from `GET /api/followed?ids=...`) on every load and merges it in without ever writing back to `localStorage`, which stays the source of truth for *which* items are followed.
- **Signed-in accounts** are the server-side source of truth instead: `GET /api/followed/mine` replaces localStorage wholesale on sign-in (`lib/library.ts`'s `replaceFollowed`).
- **Home feed** (`lib/feed.ts`'s `buildFeed`) only ever shows *upcoming* items, grouped into calendar-aligned buckets ("This week"/"Next week" are real Monday–Sunday weeks, then real calendar months) — never a past release, and a followed item with no known upcoming date simply doesn't appear (correct, not a bug). Anything releasing exactly today is pulled out into its own "hero" spotlight instead of the grouped list.
- **Sidebar "Calendar" tab** (inside the SPA) vs **`/calendar` page** (dedicated route) are two different things: the sidebar tab shows only *followed* items' dates (via `lib/releaseEntries.ts`'s `releaseEntriesFor`, the same function the ICS feed uses, so the two can never disagree); `/calendar` shows the full precomputed `upcoming_calendar` (everything, not just followed) via `GET /api/calendar?year=&month=`.
- **ICS feed** (`GET /api/calendar/feed.ics`) is a one-way, read-only calendar subscription URL for Google/Apple/Outlook — unauthenticated before any account exists (global list), requires `?token=<calendar_token>` afterward (a per-account capability URL, see `CalendarSync.tsx`).

## 14. Dugout (watch queue)

"What do I want to watch/play/listen to next" — deliberately separate from following ("tell me about release news"). `lib/dugout.ts`. Three states per item, mutually exclusive: `onDeck` (capped at 5 *per type*), `watchlist` (uncapped), `currentlyWatching` (only meaningful for `tvShow`/`game` — no "currently listening" concept for an artist, no "currently watching" for a single-sitting movie). Types: movie, tvShow, game, artist (**not** manga or franchise). An item can be added regardless of release status — an unreleased title resolves via `upcoming_items` the same way a follow does.

Artists get their own inline Dugout section on `app/artist/[id]/page.tsx` (not `DetailModal`, since artists route to a dedicated page — see §18) reusing `DetailModal`'s exported `DugoutPill`.

## 15. Notifications system (push + history)

Two independent halves that share one trigger point (`/api/poll`, §9):

- **Push delivery** — Web Push (VAPID), per-device (`push_subscriptions`). Settings has a real Enable/Disable toggle (`lib/push-client.ts`'s `enablePush`/`disablePush`), a lead-time selector (`LEAD_TIME_OPTIONS` in `lib/notificationPrefs.ts`), muted media types (`TypeMutes.tsx`), and a per-item mute (the bell icon in `DetailModal`/artist page). All of it is per-device state read/written through `POST /api/prefs`.
- **History** — every logged event, independent of whether push actually succeeded, readable at `/api/notifications?ids=...` scoped to whatever ids the client already holds (same no-auth, client-supplied-id trust model as `/api/followed`). Read/unread state is tracked client-side in `localStorage` (`lib/notificationHistory.ts`), capped at 500 ids. The badge in the Notifications view (`app/page.tsx`) checks `leadDays === 0` for a green "Out now" pill vs. the accent "Reminder" pill for anything else — `event_type` itself is currently always `'reminder'` in the DB and isn't a useful signal on its own (see §9's note about the removed `'change'` trigger).

## 16. Accounts & auth

`auth.ts` — NextAuth v5, **JWT session strategy** (required for the Credentials provider; there is no database-adapter/sessions table). Two providers:
- **Google OAuth** — on first sign-in, creates a `users` row, derives a best-effort unique username from the display name/email (`lib/username.ts`).
- **Credentials (email/password)** — `/api/auth/signup` creates the row (bcrypt-hashed password) separately; NextAuth's `authorize()` only verifies.

Every session carries `id`, `calendarToken`, `username`, and `isAdmin` (re-read fresh from the DB on every `session` callback invocation — deliberately **not** trusted from the cached JWT, because an account that signed in before `is_admin` existed would otherwise be permanently stuck reading `false`).

**Legacy data claim** (`lib/claimLegacyData.ts`): the app ran for a while with zero accounts, as one global implicit user (`followed_items`/`dugout_items` with `user_id IS NULL`). The very first account ever created automatically claims all of those orphaned rows — gated by checking that the *total user count is exactly 1* right after that account's own insert, so a second/third signup never inherits anything.

## 17. Settings & personal preferences

Everything in Settings is one of two storage models:
- **`localStorage`, per-device, no server involved**: theme (`lib/theme.ts`), content filters (`lib/hiddenCategories.ts` + `lib/contentFilters.ts`), preferred platforms (`lib/platformPrefs.ts`), international/general anticipation bars (`lib/intlBar.ts`/`lib/generalBar.ts`).
- **Server-side, per push-subscription**: muted types, lead time, per-item mutes (`POST /api/prefs` — see §15). These *have* to be server-side because the poll cron (not the browser) is what enforces them.

**Content filters** (`lib/contentFilters.ts`) hide whole categories from Discover/Search, applied server-side as a SQL `AND NOT (...)` fragment so a hidden category is excluded from the query itself. The categories (`anime`, `asian-drama`, `indie-games`, `music`) are heuristics built from signals already captured at ingestion (genre + `original_language`), not real upstream fields.

**Preferred platforms** (`lib/platformPrefs.ts`) must stay in sync with three separate real-string sources: `PROVIDER_SEARCH_RULES` (TMDB, §7.1), `STORE_DOMAINS` (IGDB, §7.2), and `artistPlatformLinks` (Deezer/music, §7.4) — a picker entry with no matching real provider string is a dead option, and vice versa. If you add a new streaming/store service anywhere, add it to the matching table *and* to `KNOWN_PLATFORMS` here.

## 18. Frontend structure

`app/page.tsx` is genuinely the whole app — a ~2,000-line single client component that switches between seven "views" (`feed`, `discover`, `following`, `calendar`, `dugout`, `notifications`, `settings`) entirely in React state, never changing the URL (it's all one route, `/`). Because of that:

- Browser back/forward can't restore view state on its own, so `page.tsx` persists `{ view, query, searchType, searchResults, hasSearched, category, categoryItems }` to `sessionStorage` and restores it on mount.
- A push notification's deep link (`/?view=notifications`) is handled as a one-shot URL param override, written into the persisted state, then immediately scrubbed from the URL.
- Data caching follows a consistent "hydrate from last session's localStorage cache, then always supersede with a fresh fetch" pattern for anything that's expensive and doesn't change fast: `lib/discoverCache.ts` (Discover payload) and `lib/freshCache.ts` (the followed-items freshness overlay) both exist purely so a repeat visit renders instantly instead of blanking behind "Loading…" for the seconds a real fetch takes.

**Three pages deliberately live outside this SPA shell**, each a real Next.js route:
- `app/artist/[id]/page.tsx` — artists aren't a single titled work (each release deserves its own card), so this is a banner+portrait profile page, not `DetailModal`.
- `app/collection/[slug]/page.tsx` — a collection detail page with its own hero banner/logo and admin edit affordance.
- `app/calendar/page.tsx` — the full release calendar, a bounded-height (`h-dvh`) non-scrolling page distinct from the SPA's own "Calendar" tab (which only shows followed items).

`DetailModal.tsx` is the generic detail popup used everywhere else (movie/TV/game clicked from a feed, search result, or shelf) — it self-fetches the full item, Dugout status, mute state, and preferred-platform sort independently of whatever parent opened it.

Key shared components: `MediaCard` (poster grid tile — artists render as a round portrait instead of a 2:3 poster), `Shelf`/`CollectionRow` (horizontal scrolling rows with arrow controls), `FeedRow` (the Home/Following list row), `MonthCalendarGrid` (shared by the sidebar Calendar tab and `/calendar`), `TypeTag` (the colored type badge — the color mapping is duplicated in `MonthCalendarGrid`'s `TYPE_CHIP`/`TYPE_DOT`, keep them in sync if you add a type), `Sidebar`/`MobileNav` (share one `NAV_ITEMS` export so they can't drift out of sync).

## 19. API route reference

All under `app/api/`. Routes that read live request state (`request.url`, DB rows that change) set `export const dynamic = "force-dynamic"` explicitly — Next 14 will otherwise statically cache a route handler that never touches `request`, which silently broke `/api/item` once (a freshly-ingested show 404'd forever because the first response got cached).

| Route | Method(s) | Auth | Purpose |
|---|---|---|---|
| `/api/discover` | GET | none | Shelves, or `?category=`, or paginated `upcoming`/`new-releases` |
| `/api/search` | GET | none | `?q=&type=&hide=` |
| `/api/item/[type]/[id]` | GET | none | Single item details |
| `/api/followed` | GET | none | Freshness overlay for a client-supplied id list |
| `/api/followed/mine` | GET | session | Signed-in account's server-side follows |
| `/api/follow`, `/api/unfollow` | POST | optional session | Follow/unfollow; scopes to account if signed in, else the legacy global list |
| `/api/mute` | POST | optional session | Per-item, per-device push mute |
| `/api/prefs` | POST | optional session | Read/update this device's notification prefs |
| `/api/subscribe` | POST, DELETE | optional session | Register/forget a push subscription |
| `/api/notifications` | GET, DELETE | none (id-scoped) | History read/clear |
| `/api/dugout` | GET, POST, DELETE | optional session | Watch queue |
| `/api/collection` | POST | none* | Create a custom collection (*no auth check on create — only edit/delete are admin-gated, see the route file) |
| `/api/collection/[slug]` | GET, PUT, DELETE | admin for PUT/DELETE | Collection detail / edit / delete-or-revert |
| `/api/calendar` | GET | none | `?year=&month=` — one month of the precomputed calendar |
| `/api/calendar/feed.ics` | GET | token (post-accounts) | ICS subscription feed |
| `/api/account/username` | POST | session | Change username |
| `/api/auth/signup` | POST | none | Create an email/password account |
| `/api/auth/[...nextauth]` | GET, POST | — | NextAuth handlers |
| `/api/cover/mangadex/[mangaId]/[fileName]` | GET | none | Proxies MangaDex cover art (their CDN blocks bare requests) |
| `/api/cron/daily` | GET | `Bearer $CRON_SECRET` | The daily refresh (§8) |
| `/api/poll` | GET | `Bearer $CRON_SECRET` | The notification poll (§9) |

## 20. Environment variables

See `web/.env.local.example` for the authoritative, annotated list (copy it to `.env.local`). Summary:

- `TMDB_API_KEY`, `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, `TRAKT_CLIENT_ID` — data sources requiring keys (Deezer/MusicBrainz/TVmaze/MangaDex are keyless).
- `DATABASE_URL` — Neon Postgres connection string.
- `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same public key, client-exposed) — Web Push.
- `CRON_SECRET` — bearer token Vercel Cron sends; must match between Vercel's cron config and your env.
- `AUTH_SECRET` — NextAuth session cookie signing key.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — only needed for "Continue with Google"; email/password works without them.

## 21. Local development workflow

```bash
cd web
npm install
cp .env.local.example .env.local   # fill in real values
npm run dev
```

- The dev server does **not** run the daily/poll crons automatically — nothing in `next dev` triggers Vercel Cron. If data looks stale (a show's episodes never updated, "Popular upcoming" looks old), you need to hit the cron route yourself with the bearer token:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://your-deployment/api/cron/daily
  ```
  (or `http://localhost:3000/api/cron/daily` against local dev — it still writes to the real shared Neon DB either way, see the caution below).
- **Type-check without building**: `npx tsc --noEmit`. Do **not** run `npm run build` while the dev server might also be running — both share the `.next` cache directory, and building alongside a live dev server can corrupt it.
- **The database is real, shared, live data** — there is no separate test DB. Be careful with anything that mutates global state (the cron routes, first-account signup flows) — verify with narrow, read-only, or always-cleaned-up throwaway scripts rather than exercising a real mutating route carelessly.
- **Schema changes need a manual apply step**: `ensureSchema()` (`lib/db.ts`) memoizes its promise *per server process* (`let schema: Promise<void> | null`). If you edit `buildSchema()` while the dev server is already running, hitting a route will **not** re-run the new DDL — the memoized promise from server startup is still what's cached. Either restart the dev server, or run a small one-off script that calls `ensureSchema()` directly to apply it immediately.

## 22. One-off scripts

All under `web/scripts/`, run via `npm run <name>` (see `package.json`'s `scripts` block), never part of any live request path:

- **`npm run ingest -- --type=movie|tv|game|manga|artist|all [--count=N]`** — the one-time bulk catalog population (`scripts/ingest-catalog.ts`). Run this once per environment/DB to seed `catalog_items` before the daily cron has anything to build on top of.
- **`npm run rebuild-collections`** — re-resolves every curated collection's membership against the current catalog (also runs automatically as cron stage D).
- **`npm run refresh-trending`**, **`npm run refresh-discover-snapshot`**, **`npm run refresh-upcoming-calendar`** — manually re-run one slice of what the daily cron does, useful for testing a change to one stage without waiting for (or re-running) the whole cron.
- **`npm run backfill-backdrops`** — one-time backfill for `backdrop_url` on rows ingested before backdrop capture existed; re-walks list pages only (cheap), not full per-item detail requests.
- **`npm run shrink-posters`** — image cleanup utility.

## 23. Deployment

Vercel. `vercel.json` declares the two cron jobs (Hobby plan's hard cap) — poll at 8:00 UTC, daily refresh at 9:00 UTC (an hour apart so the daily refresh's data is in place before the poll's `details()` calls read it, though they're independent enough that ordering isn't strictly required). Set every env var from §20 in the Vercel project settings, matching `.env.local` — most importantly `CRON_SECRET` must be identical to what Vercel Cron actually sends, or both cron routes 401.

There is no staging environment or separate database — production is the only Neon DB, and local dev talks to the same one (see §21's caution).

## 24. Known constraints & gotchas

Collected in one place because they're each easy to rediscover the hard way:

- **`ensureSchema()` is memoized per process** — see §21. Editing the schema requires a restart or a manual apply script, not just a route hit.
- **The dev cron never fires on its own** — see §21. A newly-airing show/game can sit stale in dev until you manually curl the cron route.
- **Never run `npm run build`/`next build` while the dev server may be running** — shared `.next` cache corruption. Use `tsc --noEmit` to type-check instead.
- **The Neon DB is real, live, shared data** — not a test DB. No separate environment exists.
- **Neon's HTTP driver + Next's fetch cache**: `lib/db.ts` explicitly sets `cache: "no-store"` on the Neon client's fetch options — without it, Next 14's Data Cache caches the driver's POST-based query requests (keyed by query text + params), so a row inserted later can appear permanently "missing" through one call site forever. If you ever see a query that looks correct return stale results, check this hasn't regressed.
- **`ensureSchema()`'s cached promise must be cleared on rejection**, not just on success — a transient DB outage at first touch used to poison the whole server process forever after (every subsequent call silently returned empty results even once the DB recovered). Already fixed in `lib/db.ts`; be aware of the pattern if you add a similar memoized-async-init anywhere else.
- **Manga is fully wired in the backend, hidden in the frontend.** If a feature seems to be "missing" manga, that's almost certainly deliberate (§1) — check `lib/discoverSnapshot.ts`'s `DiscoverPayload` comment and `lib/contentFilters.ts`'s header comment before assuming it's a bug.
- **TMDB's TV `first_air_date`/top-level movie `release_date` are not reliably correct** — always prefer the corrected values (`usTheatricalDate`, TVmaze's date over TMDB's for episode scheduling) documented in §7.1/§7.6, and know that `release_date_overrides` exists as the last-resort permanent pin for a title upstream simply gets wrong.
- **Postgres `DATE` columns round-trip through the Neon driver as local-midnight `Date` objects, not UTC** — always use `lib/dbDate.ts`'s `toISODate()` to normalize, never a raw `.toISOString()` on a driver-returned Date (this exact bug caused a real false "date changed" notification loop in production once — see the file's own long comment for the full story).
- **Day-precision date strings must be parsed as local dates, not `new Date(iso)`** — a bare `"2026-07-14"` parses as UTC midnight, which is the *previous* day in any western timezone. Use `lib/feed.ts`'s `parseReleaseDay()` everywhere a stored release date is being compared to "today."

## 25. Cookbook: how to make common changes

**Add a new streaming/storefront service so it shows up in "Available on":**
Add a matcher to `PROVIDER_SEARCH_RULES` in `lib/sources/tmdb.ts` (movies/TV) — put named/branded services *before* the generic Apple/Google/YouTube/Amazon catch-alls at the bottom — then add the same display name to `KNOWN_PLATFORMS` in `lib/platformPrefs.ts` so it can be marked "preferred" in Settings. For games, edit `STORE_DOMAINS` in `lib/sources/igdb.ts` instead.

**Add a title to a curated collection:**
Edit the `curated` list for that collection's slug in `lib/collections.ts`, then run `npm run rebuild-collections` (or wait for the next daily cron). No code changes needed beyond the list itself.

**Add a brand-new curated collection:**
Add a new entry to the `COLLECTIONS` array in `lib/collections.ts` (slug, name, tagline, theme colors, curated title lists, `featured: true/false`), then `npm run rebuild-collections`. Or use the in-app admin editor (any `is_admin` account, "New collection" button on Discover) for a zero-code custom collection.

**Change how strict the "Popular upcoming" quality bar is:**
The floors live in `lib/upcomingCalendar.ts` — `INTL_BAR_THRESHOLDS`/`intlBarSQL` and `GENERAL_BAR_THRESHOLDS`/`generalBarSQL`. Tune the `moderate`/`strict` numbers there; the Settings UI options themselves are just labels (`lib/intlBar.ts`/`lib/generalBar.ts`).

**Add a brand-new content-filter category (e.g. "hide horror"):**
Add the key to `ContentCategory` and a real SQL predicate to `CATEGORY_SQL` in `lib/contentFilters.ts`, add it to `CONTENT_CATEGORIES` for the Settings UI. It'll automatically apply everywhere `excludeHiddenSQL`/`parseHiddenCategories` are already wired (Discover, Search, the calendars).

**Add a new DB column or table:**
Add the `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `buildSchema()` in `lib/db.ts`, following the existing idempotent pattern — never a raw `CREATE TABLE` without `IF NOT EXISTS`, never a bare `ALTER TABLE ADD COLUMN` without `IF NOT EXISTS`, since this runs on every server start against a DB that already has all the old columns. Remember §21's "requires a restart or manual apply" gotcha while developing it.

**Add a new API route:**
Standard Next 14 App Router — a `route.ts` under `app/api/.../`. If it reads `request.url` or any DB state that can change between requests, add `export const dynamic = "force-dynamic"` explicitly (see §19's intro) or Next may statically cache the first response forever.

**Change what counts as "trending":**
Each source's trending fetch lives in its own adapter (`discoverTMDBTrendingMovies`/`TV`, `discoverIGDBTrending`, `discoverDeezerTrendingArtists`) and is wired into cron stage C (`lib/trending.ts`'s `upsertTrending`/`pruneTrending`, called from `app/api/cron/daily/route.ts`). MangaDex's trending fetcher (`discoverMangaDexTrending`) exists but is currently unwired since manga ingestion is paused.

**Bring manga back into the UI:**
Everything is intact and just needs re-enabling in a handful of read-time surfaces — follow the exact restore instructions in the comment above the `Promise.allSettled` call in `app/api/cron/daily/route.ts`, then re-add manga to `lib/sources/index.ts`'s `discover()`/`search()` type switches and `lib/discoverSnapshot.ts`'s `DiscoverPayload`, remove the manga exclusions in `lib/contentFilters.ts`, `app/page.tsx`'s `FOLLOW_GROUP_ORDER`, `lib/notificationPrefs.ts`'s `MUTABLE_TYPES`, and `app/collection/[slug]/page.tsx`'s `SECTION_TITLE`.

**Change quality-bar / admission thresholds for search or Discover per source:**
Each adapter's own constants near the top of its file — `MIN_VOTE_COUNT`/`NON_EXACT_MIN_VOTE_COUNT` (TMDB), `MIN_RATING_COUNT`/`NON_EXACT_MIN_RATING_COUNT` (IGDB), `MIN_FOLLOWS`/`NON_EXACT_MIN_FOLLOWS` (MangaDex), `LIVE_ARTIST_MIN_FANS` (Deezer live search). Each has an inline comment explaining what real case it was tuned against — read it before changing the number blind.

**Debug a wrong/stale release date:**
Check, in order: (1) is there a `release_date_overrides` row already? — that always wins. (2) For a movie, is `usTheatricalDate()` (§7.1) finding a US theatrical entry at all, or falling back to the raw top-level date? (3) For TV episode scheduling, is TVmaze matching the show at all (`resolveShowId`, needs either an IMDb id from TMDB or an exact name match)? (4) Check `dateVerified`/`date_confirmed` on the row — a failed correction fetch keeps the *old* stored date rather than overwriting it with something unverified, so a persistently-wrong date sometimes means the correction has simply never succeeded, not that it's being overwritten with garbage.
