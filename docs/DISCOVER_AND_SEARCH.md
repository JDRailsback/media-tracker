# Discover vs. Search, and the popularity quality bar

> **Update:** two follow-up fixes after real-world testing — exact-match
> relevance boosting, and IGDB "edition spam" filtering. See the two new
> sections near the bottom. The IGDB fix's numeric values were **verified
> live against real API responses**, not assumed from docs — the first
> attempt (an allowlist of `game_type = 0`) was wrong and is documented
> below as a cautionary example.

Two separate pages with different jobs:

- **Discover** — browsing. Curated shelves (Trending movies, Trending TV,
  Popular games, Popular manga, Popular upcoming), each with a "See all"
  drill-down into an expanded grid for that one category.
- **Search** — a single free-text box across all four sources at once,
  returned as one flat, ranked list. Never grouped by category.

## The interleaving fix

Combined search used to `concatenate` each source's results (all movies, then
all TV, then all games, then all manga). That meant searching "minecraft"
showed ~20 irrelevant movies before the one game that was the actual answer.

Fixed by **round-robin interleaving** (`lib/sources/index.ts`, `interleave()`):
take index 0 from every source's list, then index 1, etc. Each source already
returns its own results in roughly relevance order (the API's own text-search
ranking), so interleaving guarantees every category's best match surfaces
near the top — verified live: searching "minecraft" puts the IGDB game result
3rd, right next to the movie and TV results, not buried on page 2.

## The popularity/quality bar

Goal: cut obscure junk (no poster, near-zero engagement) without silently
hiding legitimate **upcoming/announced** titles, which is the app's whole
reason to exist — those legitimately have zero votes because they haven't
released yet.

Rule per source, applied in the adapter before results ever reach the API
response:

| Source | Released titles | Unreleased/unknown-date titles |
|---|---|---|
| TMDB movie/TV | `vote_count >= 20` OR `popularity >= 12` | `popularity >= 3` only |
| IGDB game | `total_rating_count >= 5` | pass (just needs cover art) |
| MangaDex | `follows >= 50` (batch-fetched, see below) | same (no release-date signal available) |

All sources also require a poster/cover image to exist — the single cheapest,
most effective "does anyone care about this" heuristic.

These thresholds are named constants (`MIN_VOTE_COUNT`, `MIN_POPULARITY`,
`MIN_RATING_COUNT`, `MIN_FOLLOWS`) at the top of each adapter file —
deliberately easy to tune later without touching logic.

### MangaDex popularity (verified live, not just from docs)

MangaDex's base search response has no popularity field. Fetching per-result
stats would be N+1 calls. Instead: **one batched call after search**,
confirmed live against the real API:

```
GET https://api.mangadex.org/statistics/manga?manga[]=<id1>&manga[]=<id2>...
→ { statistics: { <id>: { follows, rating: { average, bayesian } } } }
```

(Confirmed with real IDs: One Piece → 139,413 follows; a minor spinoff title →
1,829 follows — a wide enough spread that a `follows >= 50` floor cleanly cuts
true noise while keeping niche-but-real titles.)

The Discover "Popular manga" shelf avoids even this extra call by using
MangaDex's own `order[followedCount]=desc` search parameter, which sorts
server-side by popularity with no additional request.

## Discover data flow

- `GET /api/discover` → `{ trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming }`,
  each capped at ~20 items, fetched concurrently (`Promise.allSettled` — one
  source failing doesn't blank the others).
- `GET /api/discover?category=movies|tv|games|manga|upcoming` → an expanded
  list (~40 items) for the "See all" drill-down.
- "Popular upcoming" merges not-yet-released movies/TV/games (each already
  popularity-filtered per source) and sorts the combined list by release date
  ascending — "what's coming up, and is actually anticipated," across
  categories, exactly as the product is meant to answer.

## Exact-match relevance boosting

Interleaving fixed cross-category order, but not "is this actually THE
thing I searched for." Searching "fortnite" could still put a loosely-related
TV special ahead of the actual Fortnite game if interleave position landed
that way. Fixed with `matchTier()` + `byRelevance()` in `lib/sources/index.ts`:
every result gets scored 0 (exact title match) / 1 (starts with the query) /
2 (contains it) / 3 (anything else), then the list is **stably** sorted by
that tier — stable so items within the same tier keep their interleaved
cross-category order. Applied after interleaving for combined search, and
also to single-source search (`?type=game` etc.) for consistency.

## IGDB "edition spam" — verified live, not assumed

IGDB tags every season, episode, DLC, pack, and update as its own separate
"game" row. Searching "fortnite" returned the real game buried behind
"Fortnite: Season 6", "Season 7", "Season 8"... and "Fortnite Festival:
<song name>" repeated dozens of times. Same problem for "minecraft" (dozens
of "Update", "Skin Pack", and "Story Mode - Episode N" rows).

**First attempt (wrong):** assumed `game_type = 0` ("main_game") was a safe
allowlist, applied as a server-side `where` clause. This silently broke
search for Minecraft — turns out **the actual flagship "Minecraft" entry is
itself tagged `game_type: 11` ("port"), not `0`**. An allowlist excluded the
one thing we most wanted to keep, and a server-side `where` clause hides the
failure (you just get fewer results, not an error).

**Fix:** queried the live API directly (temporary server-side
`console.log` of raw `game_type` per result, inspected via the running dev
server — see `lib/sources/igdb.ts` history) and confirmed the actual values
IGDB returns for real spam entries:

| `game_type` | Meaning | Example observed |
|---|---|---|
| 7 | season | "Fortnite: Season 6/7/8" |
| 13 | pack | "Fortnite Festival: `<song>`", "Minecraft: `...` Skin Pack" |
| 6 | episode | "Minecraft: Story Mode - Episode 5" |
| 14 | update | "Minecraft: Nether Update", "Caves & Cliffs" |
| 5 | dlc_addon | "A Minecraft Movie DLC" |
| 3 | bundle | "Minecraft Dungeons: Ultimate DLC Bundle" |
| 2 | expansion | "Fortnite: Save the World", "LEGO Fortnite" |

Switched to a **denylist** (`JUNK_GAME_TYPES` in `lib/sources/igdb.ts`) of
just these seven confirmed-junk values, applied **client-side** after
fetching (not via `where`, so nothing is silently hidden by an API-level
filter we can't inspect). Everything else — `0` (main_game), `11` (port,
needed for Minecraft's own flagship entry), and any type not on the list —
passes through. Also deduped by exact title (case-insensitive), since IGDB
sometimes has two rows for the same title (e.g. Fortnite has both a `0` and
an `11` entry) — kept whichever has the higher rating count.

Verified: "fortnite" → 1 result ("Fortnite"); "minecraft" → 2 results
("Minecraft", "Minecraft: Legends" — a real, separate, legitimate game).

**Lesson generalized:** when filtering on a taxonomy field from a
third-party API, prefer a denylist of *confirmed* bad values over an
allowlist of *assumed* good ones — the "obviously correct" default value
isn't always what real flagship data actually uses.

## Importance filtering — the same problem on ALL sources, not just IGDB

The IGDB edition-spam fix above was necessary but not sufficient: TMDB and
MangaDex have the same underlying problem in a different shape. Searching
"fortnite" also returned a minor real TV crossover special and an unrelated
movie that only fuzzy/keyword-matched; searching "minecraft" returned a tie-in
manga ("Minecraft: Anime Edition") that isn't what most people mean by the
word. Reordering (interleave + relevance tier) isn't enough — some results
need to be filtered out entirely, not just ranked lower.

**The general rule, applied identically in all three adapters
(`lib/sources/{tmdb,igdb,mangadex}.ts`):** an **exact** title match gets the
normal, lenient quality bar. Anything else — partial match, edition, tie-in,
crossover — must clear a **much higher** popularity/engagement bar to appear
at all. Searching a niche item's *exact* name still finds it (an exact match
always gets the lenient bar); this only suppresses it from cluttering a
*generic* query.

Shared helper: `lib/sources/textMatch.ts` (`isExactMatch`, `matchTier`).

| Source | Exact-match bar (existing) | Non-exact bar (new) |
|---|---|---|
| TMDB movie/TV | `vote_count >= 20` or `popularity >= 12` | `vote_count >= 300` or `popularity >= 160` |
| IGDB game | `total_rating_count >= 5` | `total_rating_count >= 50`; unreleased needs `hypes >= 20` |
| MangaDex | `follows >= 50` | `follows >= 25000` |

### The MangaDex number is a deliberately blunt, tuned-from-one-example bar

Tried `2000` first (a linear extrapolation from an earlier example: One Piece
139,413 follows vs. a minor spinoff at 1,829). Verified live against the
"Minecraft: Anime Edition" case and it **failed** — that tie-in comic
genuinely has 15,620 MangaDex follows, comfortably clearing 2,000. Raised to
25,000. This is an honest limitation, not a solved problem: a tie-in title
can be legitimately popular *within manga readers* while still not being
"the important thing" for a generic query — no single popularity number
perfectly captures that distinction. Treat this threshold as a dial, not a
law; revisit if a legitimately-wanted near-match starts getting hidden, or if
another niche title needs an even higher bar to exclude.

Verified end-to-end after this fix: "fortnite" (combined, all sources) → one
result, the game. "minecraft" (combined) → two results, the game and the
official movie — both genuinely major. "minecraft" scoped to manga-only →
zero results (the tie-in comic no longer clears the bar).

## Two follow-up corrections after more real-world testing

**Unreleased titles were wrongly caught by the elevated non-exact bar.**
The importance-filtering fix above applied its stricter bar to *all*
non-exact matches, including unreleased ones — which broke a core promise:
"A Minecraft Movie Squared" (a real, unreleased 2027 sequel) was hidden
just because it's new and hasn't accumulated votes/ratings yet. Fixed by
scoping the elevated non-exact bar to **already-released** content only, in
all of `tmdb.ts` and `igdb.ts` — unreleased/announced titles always get the
lenient bar, exact match or not. (MangaDex has no unreleased-title concept,
so it's unaffected.) Verified live: "minecraft" (movie) now correctly
includes the 2027 sequel alongside the original.

**MangaDex returned adult content, and irrelevant fuzzy matches, for
unrelated queries.** Searching "toy story" (no real manga match exists)
returned several results — some rated `erotica` — with no visible relation
to the query at all. Two compounding causes, both fixed:

1. MangaDex's API returns **every** content rating unless you explicitly
   restrict it. We never had. Now every MangaDex request (search and
   discover) sends `contentRating[]=safe&contentRating[]=suggestive`,
   permanently excluding `erotica`/`pornographic` regardless of match
   quality or follows.
2. Popularity-based filtering alone doesn't stop the *unrelated* fuzzy
   matches (title doesn't even contain the query — MangaDex apparently
   matched on tags/alt-titles we never see). Added a hard gate,
   `relevantOnly()` in `lib/sources/index.ts`, applied to **every** source
   uniformly: a result must be at least an exact/starts-with/contains match
   on the *displayed* title to be shown at all — no popularity score can
   override that. This runs centrally so all four sources get the same
   baseline, on top of MangaDex's own inline check in `mangadex.ts` (kept
   there too, since it lets the follows-stats batch call skip irrelevant
   candidates).

Verified live: "toy story" (manga-only) → zero results. "toy story"
(combined, all sources) → only real Toy Story movies and legitimate
Toy Story-branded games (e.g. the 90s TV tie-in game) — no adult content,
no unrelated titles.

## Ranking correction: exact match should not always win

Sorting purely by match tier (exact > starts-with > contains) had its own
failure mode: an obscure exact match could outrank a hugely popular
near-match. Verified live — searching "toy story" put an old, barely-alive
"Toy Story" IGDB game entry ahead of the movie "Toy Story 2".

Fixed by adding a **ranking-only** signal, `significant`, computed by each
adapter (`RankedItem` in `lib/sources/textMatch.ts`): would this item clear
the *elevated* non-exact-match bar, regardless of whether it's actually an
exact match? `lib/sources/index.ts` now sorts by `(significant desc, tier
asc)` instead of tier alone, so a significant near-match outranks an
insignificant exact match. This field is computed for ranking only and
**stripped before the API response is returned** — never part of the public
`MediaItem` contract.

Chasing this down surfaced a second, more specific bug: the "Toy Story" game
had **no release date on file at all**, which our code (correctly, by
design) treats as "unreleased — give it a pass." But its `hypes` was just
`1` — a single, meaningless click, not real anticipation. The unreleased
branch of `isSignificant()` in `igdb.ts` was accepting `hypes > 0` as
"significant," which is far too low a bar. Raised to `hypes >= 10`
(`MIN_SIGNIFICANT_HYPES`). Verified live: "Toy Story" (game) now correctly
sorts below "Toy Story 2" (movie) and other genuinely significant results.

## Watch/store/read links for every media type

Movies and TV already had TMDB watch-provider links. Games and manga had
none — fixed both, using data verified live (not guessed) in each case.

**Games (IGDB):** `websites.url` on a game, verified against a real response
(The Witcher 3) — there is **no usable category field** on IGDB websites (it
came back empty even when explicitly requested), so store links are matched
by **URL domain** instead: `store.steampowered.com` → Steam,
`epicgames.com` → Epic Games Store, `xbox.com` → Xbox, `playstation.com` →
PlayStation Store, `nintendo.com` → Nintendo eShop, `gog.com` → GOG. Social
links (Facebook, Twitter, Discord, Reddit, wikis) are ignored — not "watch
this" links.

**Manga (MangaDex):** the manga's `attributes.links` field, verified live
against a real response (One Piece). Most keys there are just cross-reference
IDs to *other catalog sites* (AniList, MyAnimeList, Kitsu, MangaUpdates) —
not places to read/buy, so they're skipped. A few keys are real, direct,
usable links:
- `engtl` — the official English translation (e.g. Manga Plus) — best link, used first.
- `raw` — official Japanese source — fallback only if `engtl` is absent.
- `bw` (BookWalker) — only a URL *path*, needs `https://bookwalker.jp/` prepended.
- `amz` / `ebj` / `cdj` (Amazon / eBookJapan / CDJapan) — already full URLs.

If none of these exist, we fall back to linking the manga's own MangaDex
page — every item links to *something*, per the "everything should link
out" requirement.

## Preferred platforms (Settings)

`lib/platformPrefs.ts` holds a small curated list (streaming, game stores,
manga) grouped for the Settings UI (`components/PlatformPrefs.tsx`), stored
in `localStorage` — this is a display preference, not something that needs
a server round-trip. `DetailModal` sorts a user's preferred providers first
in "Available on" and gives them a distinct accent-highlighted, star-badged
style (`isPreferredProvider()` does a loose case-insensitive substring
match, so a preference for "Netflix" also matches "Netflix Standard with
Ads").

## Two more IGDB corrections, verified live

**"Missing date" was quietly treated as "confirmed upcoming release."**
`passesQualityBar`'s `isFuture` check was `g.first_release_date ? (date > now) : true`
— so a game with NO date on file got the *same* unconditional pass as a real,
dated announcement. Verified live that this is a real, recurring pattern, not
a one-off: "One Piece Kings" (an IGDB entry with no date, no rating count, no
hype at all — almost certainly an old/incomplete or fan-made catalog entry)
was let straight through, bypassing the exact/non-exact distinction entirely.
The earlier "Toy Story" hype fix (see above) only patched the *ranking* signal
for this same underlying pattern — the *inclusion* filter had the identical
bug and was still wrong.

Fixed by splitting the concept in two, in `lib/sources/igdb.ts`:
- `isConfirmedFuture()` — a REAL date on file, in the future. Only this case
  gets the unconditional pass (a brand-new announcement legitimately has no
  ratings yet).
- Everything else (already-released, OR no date at all) now requires a real
  signal — rating count or hype, scaled by exact/non-exact — with no
  automatic pass just because a date happens to be missing.

Verified live: "one piece kings" now returns zero results, even searched by
its own exact name (it has no legitimate signal at all to qualify on).

**IGDB's own search relevance can rank a genuine hit past our fetch limit.**
Searching "mario" or "minecraft" returned games, but not *the* specific
massive hits ("Super Mario Galaxy", "Minecraft: Story Mode") — verified live
that both exist, pass every quality bar easily (total_rating_count 1265 and
133 respectively), and are simply ranked by IGDB itself at position 89 and 57
— past our old fetch limit of 50. A broad, common query (a franchise name)
matches so many same-series entries that IGDB's own relevance doesn't always
surface the most iconic one first. Raised the raw candidate fetch from 50 to
200 (IGDB's documented max is 500) in `searchIGDB`. Verified live: both now
appear.

## Search UX round: filters, franchises, editions, episodes, typo tolerance

**Search-by-type filter chips.** `app/page.tsx` adds a row of filter chips
(All/Movies/TV/Games/Manga/Franchises) above the results grid, backed by the
existing `?type=` param `search()` already supported. Selecting a chip
re-runs the current query with that type; clicking the sidebar's "Search"
entry again *while already on the Search page* clears query/filter/results
(`resetSearch()` in `app/page.tsx`) — otherwise React bails out on the
unchanged `view` state and nothing visibly happens.

**Franchise/collection following.** TMDB's `/search/collection` and
`/collection/{id}` endpoints (`searchTMDBCollection`/`detailsTMDBCollection`
in `lib/sources/tmdb.ts`) model clean single-franchise collections well
("Star Wars Collection"). Verified live: TMDB has **no unified "Marvel
Cinematic Universe" entity** — that query returns zero collection results,
since the MCU is split across dozens of sub-collections (Avengers Collection,
Iron Man Collection, ...). Following one of those sub-collections works;
there's no single "follow the whole MCU" yet. Deliberately excluded from the
default/combined search (a franchise container next to its own individual
entries would be confusing in one flat list) — only reachable via the
"Franchises" filter chip. A followed collection's `releaseDate` tracks the
soonest upcoming unreleased part, so it plugs into the release feed exactly
like a single title.

**Game editions/DLC denylist expanded.** `JUNK_GAME_TYPES` in
`lib/sources/igdb.ts` grew from `{2,3,5,6,7,13,14}` to
`{1,2,3,5,6,7,9,10,13,14}` after verifying live against Skyrim and Cyberpunk
2077 data: `1` (dlc_addon — Dawnguard/Hearthfire), `9` (remaster — "Skyrim
Special Edition", `total_rating_count` 437, would otherwise clear the
popularity bar easily), `10` (expanded_game — "Skyrim Anniversary Edition").
Deliberately **not** denied: `8` (remake) — a ground-up rebuild (Resident
Evil 2 Remake) is a distinct product, unlike a remaster's cosmetic
re-release. Verified live: "skyrim" now returns exactly one result, "The
Elder Scrolls V: Skyrim."

**Expanded platform list.** `lib/platformPrefs.ts`'s `KNOWN_PLATFORMS` grew
from a handful of majors to ~50 entries — streaming (Crunchyroll, Peacock,
Tubi, Pluto TV, Shudder, BritBox, HIDIVE, VRV, and more, not just
Netflix/Disney+/Hulu), game storefronts (itch.io, GOG, Humble Bundle,
Battle.net, Ubisoft Connect), and manga (BookWalker, VIZ, Manga Plus).

**Full TV episode lists.** `allEpisodes()` in `lib/sources/tmdb.ts` fetches
`/tv/{id}/season/{season_number}` for every season concurrently
(`Promise.allSettled`), populating `MediaItem.episodes` (season, episode,
title, air date) and `episodeCount`. Only called from `detailsTMDBTV` (one
show at a time, on-demand when its detail modal opens) — never from search,
where it would multiply request volume across every result. `DetailModal`
renders a scrollable per-episode list with the total episode/season count.

### Typo-tolerant search — three separate bugs, not one

Item 7 ("a slight misspelling shouldn't return no results") needed three
independent fixes before it actually worked end-to-end. Each masked the next
until fixed:

**1. IGDB OAuth token was never cached.** `getToken()` in `lib/sources/igdb.ts`
fetched a fresh Twitch `client_credentials` token on *every* call. The typo
fallback (up to ~80 correction attempts) meant up to 80 *extra* OAuth
requests on top of the actual searches, hammering Twitch's auth endpoint.
Fixed with a module-level cache (token + expiry, refreshed 5 minutes early)
that also caches the **in-flight promise** — not just the resolved value —
so concurrent callers share one request instead of each firing their own
before the first resolves.

**2. IGDB's actual rate limit is ~4 requests/second — verified live.**
Caching the token wasn't enough: even a single, non-typo, primary search
("skyrim") started throwing real `429`s once concurrent typo-fallback workers
were in flight. Bounding *concurrency* (6 in-flight workers) doesn't bound
*rate* — 6 concurrent requests at ~300ms latency each still starts far more
than 4/sec. Added a real rolling-window rate limiter inside `query()` in
`igdb.ts`: tracks the last 4 request start times and makes every caller wait
its turn, globally, regardless of how many callers (typo variants, discover
shelves, concurrent users) are asking at once.

**3. Relevance was checked against the wrong string.** Even after fixing 1
and 2, "toystroy" (for "toy story") still returned nothing. Root cause:
`withTypoFallback` treated any non-empty primary result as success — but
TMDB's own fuzzy search for a garbled query sometimes returns *something*
tangentially related rather than nothing, which short-circuited the retry
loop before it ever tried the correction that would have worked. Fixed by
requiring the primary result to contain at least one item that survives the
same `relevantOnly()` relevance check the caller applies anyway. Separately,
once a typo *variant* (not the original query) is what actually found the
match, downstream filtering/sorting was still checking relevance against the
**original misspelled query** rather than the variant that succeeded —
`fuzzyMatches("Toy Story", "toystroy")` exceeds the edit-distance budget even
though `fuzzyMatches("Toy Story", "toystory")` doesn't. `withTypoFallback` now
returns `{ items, query }` where `query` is whichever string actually
produced the results, and all downstream relevance/ranking uses that.

**4. Some typos need two edits at once.** "toystroy" → "toy story" requires
*both* inserting a space *and* fixing a transposition ("stroy" → "story").
Neither single-edit correction alone finds anything (verified live: TMDB
returns zero raw results for both "toystory" — transposition fixed, still
one run-together word — and "toy stroy" — space restored, letters still
scrambled). `typoVariants()` in `lib/sources/textMatch.ts` now also chains a
transposition pass onto each space-inserted candidate, covering the "two
words run together and scrambled" pattern without the combinatorial cost of
transposing every position against every other variant.

**Superseded — see "Hard 2-second search budget" below.** The 15-20s
worst case was revisited after real user feedback that search was simply too
slow; it's now capped, at the cost of weaker typo-correction depth for
heavily rate-limited sources. Left here for history.

## Hard 2-second search budget, and a real missing-title bug

Real user feedback: search was taking far too long, and a genuinely
existing, just-released show ("Ghost in the Shell," a new 2026 series) wasn't
showing up in search results at all. Two unrelated bugs, both found by
querying the live TMDB/IGDB APIs directly rather than guessing.

**A release-day title falls through the quality bar within hours of
existing.** Verified live against the real TMDB response: "THE GHOST IN THE
SHELL" (id 255358) has `first_air_date` of today, `vote_count: 0`,
`popularity: 5.5`. The existing `isFuture` check was a strict
`releaseDate > now` — true right up until midnight of release day, then
false forever after, at which point the show is judged as "already released"
and needs to clear the standard bar (`vote_count >= 20` or
`popularity >= 12`) it hasn't had time to earn. A title needs real time
(weeks, not hours) to accumulate votes after release. Fixed with a 14-day
grace period (`isRecentOrFuture()` in `lib/sources/tmdb.ts`,
`RECENT_RELEASE_GRACE_DAYS`) — a title still gets the lenient bar for two
weeks after its release date, not just strictly before it. Applied the
identical fix to IGDB (`isConfirmedFuture()` in `lib/sources/igdb.ts`) for the
same underlying pattern, being careful to preserve the earlier "One Piece
Kings" fix: the grace period only widens what counts as "recent," it does
NOT restore "missing date = automatic pass" (a title still needs a REAL date
on file to qualify for either the future or grace-period case).

**Search response time is now capped, deliberately at the cost of typo-fix
depth.** The typo fallback (see above) could legitimately take 15-20s against
IGDB's ~4 req/sec real limit — verified live, and confirmed too slow by
direct user feedback ("no search should take longer than 2 seconds"). Three
changes in `lib/sources/index.ts`:

1. `findTypoMatch()` replaces the old "wait for the whole batch, then check
   results" sweep with a worker pool that stops claiming new candidates the
   instant any worker finds a relevant match — previously, even a match found
   on the very first attempt still waited for the entire batch to settle
   before it was noticed.
2. The sweep runs against a `TYPO_FALLBACK_BUDGET_MS = 1200` deadline that
   workers check themselves (not just an outer race) — so if nothing is ever
   found, workers actually stop issuing new requests once the budget expires,
   rather than continuing to burn IGDB's rate-limited window on a search the
   client already stopped waiting on.
3. **Deliberately does NOT wrap the primary (first) search call in any
   deadline.** Tried this and reverted it after verifying live that it was
   actively harmful: under back-to-back requests, IGDB's shared rate-limit
   window can back up enough that even a single, correctly-spelled query
   ("skyrim") hadn't gotten its primary response back before a shared
   deadline fired — which made the search return **empty for a game that
   definitely exists**. A latency guarantee is worthless if it comes at the
   cost of silently wrong (empty) results for real, correctly-spelled
   queries. Only the discretionary, best-effort typo-correction retry is
   time-boxed; the primary call always runs to completion and is always
   trusted.

**Known, accepted trade-off:** a query needing a *deep* correction against a
throttled source (e.g. "pokemn" → "Pokémon" needs a vowel inserted deep
enough in `typoVariants()`'s candidate order that IGDB's 4 req/sec limit only
allows a handful of attempts within the 1.2s budget) may no longer get
auto-corrected under the tighter budget, where it previously would have
(taking ~18s to do so). Simple single-edit typos and anything against
unthrottled sources (TMDB, MangaDex) are unaffected. This is the accepted
cost of the 2-second requirement — every search reliably finishes fast,
rather than occasionally taking 15-20s to be maximally thorough.

**Regression caught during this same fix, worth recording:** raising
`typoVariants()`'s `max` cap mattered independently of the timing work.
Reordering the candidate list earlier (to put common single-edit fixes
before the rarer compound space+transposition fixes, for "pokemn"'s sake) had
pushed the correct "toy story" candidate past the then-fixed `max = 80` cutoff
entirely — silently breaking the "toystroy" case again despite the
compound-generation code itself being correct. Since the real bound is now a
time budget (workers stop on deadline), not array length, `max` was raised to
250 — generous enough that the list itself is never the limiting factor;
each source's own real fetch speed and the time budget determine how deep it
actually gets.

## Franchise system redo: curated cross-media franchises

The TMDB-collection-only "Franchises" filter (see the sections above) was
replaced outright with a curated, cross-media system: 150+ hand-authored
franchises (`lib/franchises.ts`) spanning film, TV, games, and anime/manga —
Star Wars, Pokémon, One Piece, Halo, Attack on Titan, and so on — each with
its own themed detail page (`app/franchise/[slug]/page.tsx`) and its own
Follow button that alerts on any new release across the whole franchise, not
just one title. `MediaType`'s `"collection"` was renamed to `"franchise"`.

**The follow → push-notification pipeline needed zero changes.** Read every
file in the chain (`lib/library.ts`, `lib/push-client.ts`,
`app/api/follow/route.ts`, `app/api/unfollow/route.ts`, the Postgres schema
in `lib/db.ts`, `app/api/poll/route.ts`) before writing anything, and
confirmed it's already fully generic over `"type:sourceId"` strings — the
`followed_items` table stores `type`/`source_id` as free `TEXT`, no
enum/allowlist anywhere. `app/api/poll/route.ts` and
`app/api/item/[type]/[id]/route.ts` both dispatch purely through
`details(type, id)`. Adding one `case "franchise"` to `details()` in
`lib/sources/index.ts` was the entire integration point needed for
following + push notifications to work.

**Curated data is small and dynamic, not exhaustive ID lists.** Hand-picking
exact TMDB/IGDB/MangaDex IDs for every constituent title across 150+
franchises would be unmaintainable and go stale immediately. Instead each
`FranchiseDef` (`lib/franchises.ts`) stores a slug, tagline, theme colors,
and a handful of **search query strings** per media type — resolved at
request time through the existing, already quality-filtered adapters
(`searchTMDBMovie`, `searchTMDBTV`, `searchIGDB`, `searchMangaDex`). A
franchise picks up new announcements automatically as they land upstream,
with zero maintenance — directly serving "see all new releases and
announcements." Spin-offs whose titles don't share the franchise name (Star
Wars' "The Mandalorian," "Andor") are handled by letting `queries.tvShow` be
an array of specific titles instead of just the franchise name — verified
live that this genuinely works: resolving `star-wars` correctly pulls in
all 5 curated TV entries alongside the films.

**Movies use pre-resolved TMDB Collection IDs, verified live, not guessed.**
TMDB's Collection API is a curated, authoritative parts list per franchise —
more accurate than text search for oddly-titled entries ("Solo: A Star Wars
Story" doesn't contain "Star Wars" as a title prefix). Ran a batch script
against `/search/collection` for every franchise with a `movie` query,
then manually vetted every match rather than trusting name-similarity alone
— a real, necessary step: several "matches" were false positives caught only
by inspection, e.g. `lord-of-the-rings` matched **"The Making of The Lord of
the Rings Collection"** (a behind-the-scenes documentary collection, wrong),
`twilight` matched an unrelated short film called "Twilight Psalm," and
`final-fantasy` matched only the narrow "Final Fantasy VII Collection"
(missing every other mainline film). Those were left unresolved (falling
back to plain text search) rather than wired in wrong. ~64 franchises ended
up with a verified `movieCollectionId`; a first pass also missed several
legitimate anime film collections (One Piece, Naruto, Dragon Ball, Attack on
Titan, and others) that were confirmed good matches in the raw lookup but
got dropped when hand-compiling the final list — caught by testing
`/api/franchise/one-piece` directly and noticing the Movies section was
empty despite One Piece clearly having real films. Fixed by re-patching the
missed entries. (When `movieCollectionId` is set, `queries.movie` is ignored
entirely — the collection is authoritative for that franchise's movies.)

**No new API routes for search or browse — franchise search is effectively
free.** `search(query, "franchise")` and `discoverCategory("franchises")`
are just new cases in the existing dispatchers: franchise search
(`searchFranchises` in `lib/sources/franchise.ts`) is an in-memory fuzzy
match over the curated list (reusing `matchTier`/`fuzzyMatches` from
`textMatch.ts`), and Discover browsing (`discoverFranchises`) is pure static
data — no live TMDB/IGDB/MangaDex calls, so browsing 150+ franchises is
instant regardless of the 2-second budget that governs the other, real,
rate-limited sources. The only genuinely live piece is
`resolveFranchise(slug)` (aggregating parts across sources), paid for once
per detail-page load and once per franchise per nightly poll check — never
on search or browse.

**Franchise parts deliberately skip the messy-input relevance filter.**
`relevantOnly()`/`matchTier`-based filtering in `lib/sources/index.ts` (see
"Importance filtering" above) is tuned for arbitrary user-typed queries;
running curated, precisely-chosen query strings through the same heuristic
risked silently dropping legitimate parts. `resolveFranchise` calls the raw
per-source search functions directly and only strips the internal
`significant` ranking flag (via `stripSignificant`, moved from
`lib/sources/index.ts` into `lib/sources/textMatch.ts` so both modules can
share it without a circular import — `lib/sources/franchise.ts` must never
import from `lib/sources/index.ts`, since `index.ts` imports the franchise
module to wire up `search()`/`details()`).

**Franchise cards are a separate component, not a branch inside
`MediaCard`.** Since franchises are always shown in homogeneous grids (never
inline-mixed with individual titles — same reasoning as the old system: a
franchise container next to its own parts in one flat list is confusing),
`components/FranchiseCard.tsx` is a themed gradient card (colors looked up
client-side from the static `lib/franchises.ts` import, keyed by slug — never
sent over the wire, keeping `MediaItem` a clean, uniform contract) used
wherever a franchise grid renders; `MediaCard` itself needed zero changes.
`components/Shelf.tsx` gained one small, backward-compatible `renderItem`
prop so the Discover "Franchises" shelf could reuse the existing
header/scroll-container markup instead of duplicating it.

**The detail page reuses `DetailModal` for individual parts, unmodified.**
Confirmed by reading the component directly: it depends only on its own
props and `getPreferredPlatforms()` (a pure `localStorage` utility), with no
reference to `app/page.tsx` — fully portable into the new
`app/franchise/[slug]/page.tsx` route with its own local `selected` state.
Clicking a part inside a franchise page opens the exact same modal, with
independent follow/unfollow, as clicking that same title anywhere else in
the app.

**Push notification copy was generically improved, not just for
franchises.** `app/api/poll/route.ts`'s push body used to ignore `subtitle`
entirely (`"${title} — now releasing ${date}"`), which mattered a lot once a
franchise's `title` is just the franchise name — a notification saying "Star
Wars — now releasing March 3" gives no indication of *what's* releasing.
Fixed to prefer `subtitle` when present (`"Next: Ahsoka"`, etc.) — this also
fixes TV show notifications, which already carried a `subtitle` (e.g. "S2
E4") that was being silently dropped before.

## Known gap / future work

There's no single "follow the whole Marvel Cinematic Universe" entity as one
followable item — MCU is curated as one `FranchiseDef` with many query
strings (Avengers, Iron Man, Thor, ...), which surfaces all its parts on the
detail page, but there's still no single authoritative TMDB collection
backing it (verified live, same finding as before: TMDB splits MCU across
dozens of sub-collections with no unified entity), so its movie list comes
from plain text search rather than a pre-resolved collection.

## Franchise editor: manual overrides on top of the curated defaults

The curated `lib/franchises.ts` list (name/tagline/theme/queries, baked into
the deployed source) can't be hand-tweaked without a code change + redeploy.
Added a full in-app editor — an Edit button on every `/franchise/[slug]`
page, plus a "New franchise" entry point in Discover — backed by a new
Postgres table, `franchise_overrides` (schema in `lib/db.ts`).

**A DB row is a complete replacement definition, not a sparse patch.** Once
any field of a franchise is edited, the whole row (name, tagline, theme,
poster/banner, queries, `movieCollectionId`, featured, manual
include/exclude lists) becomes that slug's sole source of truth going
forward — avoids ever having to distinguish "field was never set" from
"field was explicitly cleared to null." `is_custom` marks a franchise
created entirely through the editor (no static default underneath); for
those, "Delete" removes it outright, while a curated franchise's "Revert to
default" just deletes its override row and falls back to the static entry.

**Every read path (search, Discover browsing, and the detail resolver) now
does one small DB read it didn't need before**, to merge in any override —
`lib/sources/franchise.ts`'s `effectiveFranchises()` /
`getEffectiveFranchise()`. Accepted deliberately: an edit needs to show up
immediately everywhere (search results, the Discover shelf, the detail
page), not after some cache TTL expires. Degrades gracefully — if
`DATABASE_URL` isn't set or the DB is briefly unreachable, these functions
catch the error and fall back to the static list rather than breaking
search/browse/follow over an admin-only feature.

**Franchise colors moved from a static client-side import onto the wire.**
Before the editor existed, `FranchiseCard` read a franchise's theme colors
via a plain `import { getFranchise } from "@/lib/franchises"` and a
client-side slug lookup — fine when the data was fixed at build time, wrong
the moment colors become editable at runtime (the client bundle would keep
serving stale colors after an edit). Added `MediaItem.theme` (optional,
franchise-only, `lib/types.ts`) so the server embeds a franchise's current
colors directly in every response that returns one — `FranchiseCard` and the
detail page now both read `item.theme`/the API response, never a static
import, for anything that can change at runtime. Same reasoning applies to
`app/franchise/[slug]/page.tsx`: it used to read `name`/`tagline`/`theme`
from the static import too; now everything about a franchise's identity
comes from the `/api/franchise/[slug]` response.

**Manual include/exclude is deliberately two separate mechanisms, not one.**
"Add a title the curated queries miss" (`includeOverrides` — a small
hand-entered list, found via the same `/api/search` the rest of the app
uses, unioned into whichever type bucket it belongs to) and "hide a title
the queries wrongly pull in" (`excludeIds` — just a list of MediaItem ids,
filtered out of the auto-resolved parts before anything else runs) are
independent for a reason: a manually-included title is never subject to
`excludeIds` filtering — if you no longer want one, you remove it from the
include list directly rather than "hiding" your own manual addition through
a second mechanism that exists for a different purpose (suppressing bad
automatic matches).

**Movie collection ID takes over the movie side entirely when set** — same
behavior as before the editor, just now user-adjustable: setting
`movieCollectionId` in the form makes `queries.movie` inert for that
franchise (the collection is authoritative), matching
`lib/sources/franchise.ts`'s existing `resolveFranchise` logic.

## Franchise detail page: single-row categories, Most Popular, and a real
## completeness bug

Real user report: browsing a franchise's Games/Manga sections showed far
fewer entries than actually exist — for One Piece specifically, only 2 games
and 1 manga title, when the real numbers are much higher. Root cause, found
by querying IGDB directly rather than guessing: **the general-search
"importance filtering" bar (see above) was being applied inside franchise
resolution too**, and it's fundamentally the wrong tool there.

**The elevated non-exact-match popularity bar was excluding almost every
real franchise entry.** Verified live: IGDB returns 128 raw results for
"One Piece," and the elevated bar (designed to fight general-search clutter
— see "Importance filtering" above) let only 2 through, because it demands
`total_rating_count >= 50` for anything that isn't a LITERAL exact title
match — and almost nothing in a real franchise is literally titled just
"One Piece." Real, well-known games like "One Piece: World Seeker"
(`total_rating_count` 32) and "One Piece: Burning Blood" (38) were being
excluded for the same reason an obscure fan-made entry would be — the bar
doesn't distinguish "obscure" from "franchise-branded but not blockbuster."
The bug wasn't specific to games: TMDB movies/TV and MangaDex have the
identical elevated-bar mechanism and the identical problem.

**Fix: a `lenient` mode on every per-source search function**
(`searchTMDBMovie`, `searchTMDBTV`, `searchIGDB`, `searchMangaDex` — an
`opts?: { lenient?: boolean }` second parameter), used only by
`lib/sources/franchise.ts`'s `resolveQuery`. For TMDB/IGDB, lenient just
treats every result as if it were an exact match for quality-bar purposes.
MangaDex needed a genuinely different middle-ground threshold
(`FRANCHISE_MIN_FOLLOWS = 500` in `lib/sources/mangadex.ts`) rather than a
simple exact-match override — verified live that the strict exact-match bar
(50 follows) is too permissive for franchise mode (lets real doujinshi
through, e.g. a One Piece/One-Punch Man crossover doujinshi with 935
follows) while the elevated bar (25,000) is too strict (excludes real
official spin-offs, e.g. "One Piece: Ace's Story—The Manga" at 3,158
follows). Follow count alone can't perfectly separate "official-ish
franchise content" from "popular fan work" — some doujinshi genuinely
out-follow obscure official one-shots — so 500 is a deliberate, tunable
compromise favoring "show more of the franchise" over perfect purity; a
handful of very-popular doujinshi/crossovers may still slip through.
MangaDex's search result limit was also raised from 15 to 40 in lenient
mode — MangaDex's own relevance ranking can push real spin-offs (like
"Ace's Story") past 15, the same class of bug already fixed for IGDB
("Super Mario Galaxy" ranked past position 50 — see above).

**A second bug surfaced immediately after fixing the first: lenient mode
alone let real noise back in.** With the popularity bar relaxed, TMDB's TV
search for "One Piece" started including "A Piece of Your Mind" and "Aqua
Teen Hunger Force" — verified live neither contains "One Piece" anywhere in
the title; TMDB's own search relevance is looser than a literal substring
match for a generic-sounding two-word query. `lenient` only relaxes the
*popularity* threshold — it was never meant to also skip the basic
relevance check (does the title actually relate to the query?). Fixed by
adding back a `matchTier`/`fuzzyMatches` gate inside `resolveQuery` itself,
scoped per query string (a franchise can have several — e.g. Star Wars' TV
list is 5 different show names — and a result must relate to the SPECIFIC
string that found it, not just any of them). This is the same
`relevantOnly()` gate general search already applies
(`lib/sources/index.ts`) — franchise resolution just needed its own copy,
scoped correctly, rather than either skipping it entirely (the original
design) or inheriting index.ts's version (which operates on one combined
query, not per-source query lists).

**Popularity is now tracked all the way through, for two purposes.** Added
`popularity: number` to `RankedItem` (`lib/sources/textMatch.ts`) — TMDB's
`popularity` field, IGDB's `total_rating_count`, MangaDex's `follows`,
verified live that TMDB collection parts carry the same `popularity`/
`vote_count` fields a normal movie search result does. Renamed
`stripSignificant` to `stripRanking` (same function, now also strips
`popularity`) since it's no longer just about the one field. Used for:

1. **Chronological sort, "most recent last"** — each category (Movies/TV/
   Games/Manga) is sorted by release date ascending (oldest first), undated
   items pushed to the very end (`sortByRecency` in
   `lib/sources/franchise.ts`). Flipped from an earlier "most recent first"
   version per explicit user request — a future release date still counts as
   "more recent" than anything already out, so a newly-announced entry lands
   at the end of its row instead of the front.
2. **A combined "Most Popular" row across all four types.** Raw popularity
   numbers are wildly different scales per source (MangaDex follows can run
   into the hundreds of thousands; IGDB rating counts rarely exceed a few
   thousand) — comparing them directly would let whichever source uses
   bigger numbers dominate regardless of actual relative popularity.
   `normalizedScores()` min-max normalizes each type bucket to 0-1 first, so
   the combined ranking compares "how popular is this relative to the rest
   of this franchise's own movies/shows/games/manga," not incomparable raw
   magnitudes. Manually included titles (`includeOverrides` — hand-entered,
   no real popularity signal) are excluded from this ranking entirely,
   rather than given a fake score.

**Layout: one horizontal row per category, not a growing multi-row grid.**
A franchise can have dozens of parts (One Piece alone has 15 movies, 21
games after the fix above) — a full grid would make the page enormous.
New `components/FranchiseRow.tsx`: a single non-wrapping flex row with
explicit left/right arrow buttons that `scrollBy()` the row (not just relying
on drag/trackpad scrolling), reusing the existing `MediaCard` component per
item. `app/franchise/[slug]/page.tsx` renders "Most Popular" first (if
non-empty), then one `FranchiseRow` per category that has any parts.

## Popularity sorting was using the wrong TMDB field entirely

Before wiring real popularity into general search, a user report on the
franchise "Most Popular" row ("some franchises still do not have good
orders... like Toy Story") led to finding the actual root cause, verified
live rather than assumed:

**TMDB's `popularity` field is a trending/momentary-buzz metric, not a
durable one.** Queried TMDB directly for "Toy Story": `popularity` for "Toy
Story 5" (unreleased, hyped, releases mid-2026) is **615.6** — more than 6x
"Toy Story 4"'s 101.6, and nearly 9x the 1995 original's 72.6. But
`vote_count` tells the real story: the 1995 original has **20,108** votes,
Toy Story 3 has 15,889, Toy Story 2 has 15,049, Toy Story 4 has 10,694 — and
Toy Story 5 has only 508. `popularity` spikes for anything getting a lot of
*current* search/view attention (imminent releases, trending news), which
is a completely different question from "how significant/beloved is this,"
and using it for `RankedItem.popularity` (added for the franchise Most
Popular feature) put the least-proven entry in a franchise first every time
something in it was about to release.

**Fix: TMDB movies/TV now feed `RankedItem.popularity` from `vote_count`,
not TMDB's `popularity` field** (`lib/sources/tmdb.ts` —
`searchTMDBMovie`/`searchTMDBTV`/`tmdbCollectionParts`, all three had the
same bug). This makes TMDB's contribution consistent with the other two
sources, which were never affected by this problem in the first place:
IGDB's `total_rating_count` and MangaDex's `follows` are both cumulative,
lifetime signals, not trending ones. TMDB's own `popularity` field is left
untouched everywhere else (`passesQualityBar`/`isSignificant` in
`lib/sources/tmdb.ts` still use it for the unrelated "does this deserve to
appear at all" quality bar, where a trending signal is a reasonable
consideration).

Verified live after the fix: Toy Story's "Most Popular" row now leads with
the 1995 original, followed by the other three mainline films in vote-count
order, with Toy Story 5 correctly near the bottom until it actually earns an
audience.

## General search now ranks by real popularity too

Combined (no-type-filter) search previously had no true popularity ranking
at all — `lib/sources/index.ts`'s per-source sort (`filterAndSort`) ordered
by `(significant desc, matchTier asc)` only, where `significant` is a
**boolean** threshold check, not a magnitude; ties fell back to whatever
order each source's own black-box relevance algorithm returned. The final
cross-source merge (after round-robin `interleave()`) was even coarser: just
a `significant` partition, so which of two "significant, exact-match"
results (say a movie and a game) came first was really decided by interleave
position, not actual popularity.

Fix, reusing the same normalization approach as the franchise Most Popular
row: `normalizedScores()` (min-max per list, 0-1) moved from
`lib/sources/franchise.ts` into the shared `lib/sources/textMatch.ts` so
both modules use one implementation.

- **Per-source (`filterAndSort`)**: added `popularity desc` as a third sort
  key, after `significant` and `matchTier` — raw (not normalized) is fine
  here since a single source's own list never mixes scales.
- **Cross-source merge**: each source's list is normalized to 0-1
  independently, merged into one `Map<id, score>` (ids are globally unique
  — `movie:603` vs. `game:1234` — so no collision risk merging maps from
  different sources), and the final sort is `(significant desc, normalized
  popularity desc)` — matchTier is deliberately NOT compared across sources
  here (an existing, still-correct constraint: different sources may have
  resolved via different typo corrections, so tier comparisons only mean
  something within one source's own reference query).

Both changes preserve the original, deliberate design goal (a hugely popular
near-match can still outrank a barely-passing exact match — `significant`
still wins first) while replacing what used to be an arbitrary tiebreaker
with the same real, cross-source-normalized popularity signal used
throughout the franchise system.

## Ten polish fixes: real search-speed root cause, franchise cards, platform links

**The actual reason search felt slow — not the typo-correction budget
itself.** Verified live: a plain, correctly-spelled query like "star wars"
returns real results from movie/TV/game in well under 300ms combined, but
"star wars" has zero MangaDex matches — not a typo, there's just no Star Wars
manga. The combined search ran typo-fallback **per source, unconditionally**,
so that one legitimately-empty category alone cost the full ~1.2s typo
budget and dragged the WHOLE combined search down to match it, on nearly
every query (it's rare for all four media types to have a real hit
simultaneously). Fixed in `lib/sources/index.ts`'s default search case:
run plain primary searches on all four sources first; only fall back to
typo-correction if the search comes up empty **as a whole**. Also removed a
redundant duplicate primary fetch that the first version of this fix
introduced (`withTypoFallback` now accepts an already-fetched primary result
instead of re-fetching it). Net effect verified live: "star wars"/"zelda"/
"minecraft"/"the witcher" dropped from 1.6-3s to 200-1000ms; a genuinely
misspelled query with no match anywhere ("toystroy") still gets corrected,
just costs the typo budget once instead of never being attempted for the
common case.

**Franchise search results get their own row, not mixed into the flat
grid.** `search()`'s default case now also runs `searchFranchises()` (free,
in-memory) and returns matches alongside the regular results; the client
(`app/page.tsx`) partitions them into a dedicated `FranchiseRow` above the
main grid — only on the "All" filter (the "Franchises" filter already shows
every franchise in its own wider grid, making a redundant row there). Caught
a real data bug in the process: two separate curated entries were both named
"The Witcher" (`the-witcher` for the games, `the-witcher-tv` for the show) —
merged into one entry with both `game` and `tvShow` queries, since the
system already supports multi-type franchises and this was just leftover
duplication from authoring, not an intentional design choice.

**`FranchiseCard` rebuilt to fix three related complaints at once** (poster
hover rendering oddly, unwanted text baked onto the poster, wanting a wider
card). Root cause of all three: the old card had an absolutely-positioned
image UNDER a persistently-visible gradient+text overlay — a structurally
different, more fragile pattern than `MediaCard`'s proven one (normal-flow
image, hover-only overlay). Rebuilt to match `MediaCard`'s structure exactly
(fixing the hover glitch as a side effect), dropped the overlay text entirely
(title/tagline now sit below the image like every other card), and switched
the aspect ratio from portrait 2:3 to landscape 3:2 with wider container
widths (`Shelf`/`FranchiseRow` both gained an `itemWidthClassName` prop) —
franchises are themed collections, not box art, and the wider landscape tile
keeps them visually distinct in a mixed page.

**The back button led to Home, not wherever the user actually came from.**
Root cause: this app is a single-route SPA (`app/page.tsx`) — switching
between Home/Discover/Search/Following is pure `useState`, never reflected
in the URL. `/franchise/[slug]` is a real, different route, so the browser's
back button could only ever land back on "/" at its hardcoded default state,
losing whatever view or search results were active. Verified live before
concluding `router.back()` alone would fix it — it didn't; Next.js still
remounted `/` fresh. Fixed by persisting the relevant state
(`view`/`query`/`searchType`/`searchResults`/`hasSearched`/`category`/
`categoryItems`) to `sessionStorage` on every change, restored once on mount
— not the URL, since redesigning this SPA's routing to encode view state
there was a much larger change than the bug warranted.

**Platform-preference matching couldn't tell a service from its reseller
bundle.** `isPreferredProvider()` (`lib/platformPrefs.ts`) did a plain
substring match, so a preference for "Apple TV" also matched "Apple TV
Amazon Channel" — verified live TMDB lists these as genuinely separate
provider entries (different subscription/billing products, "Max" similarly
matched both "HBO Max" and "HBO Max Amazon Channel"). Fixed with a
`CHANNEL_SUFFIXES` check: a provider that's a channel bundle only matches a
preference that's ALSO specifically for that channel — verified live
against a real title with both "HBO Max" and "HBO Max Amazon Channel" as
separate providers; only the base service now gets the preferred
highlight/star.

**Movies/TV with zero watch-provider data got an empty "Available on"
section.** Verified live: "THE GHOST IN THE SHELL" (a brand-new show) has a
completely empty `watch/providers.results` object from TMDB — not just
missing US data, nothing at all. Same "always link to SOMETHING" principle
MangaDex already followed (falls back to the manga's own MangaDex page) now
applies to movies/TV (fall back to the title's TMDB page) and games (fall
back to the game's own IGDB page) — verified live that IGDB's page URLs are
slug-based (`/games/the-witcher-3-wild-hunt`), not numeric-id-based, so this
uses IGDB's own `url` field rather than constructing one.

**`DetailModal`'s poster panel had no controlled aspect ratio.** It was a
flex-row sibling with no fixed height, so it stretched to match whatever
height the text column happened to need (overview length, episode list, etc.
all vary a lot) — `object-cover` doesn't stretch/distort an image, but it
does crop harder or looser depending on that arbitrary height, which reads
as "the poster looks wrong." Fixed with `self-start` (opts out of the flex
row's default stretch) plus a fixed `aspect-[2/3]`, matching every other
poster box in the app.

**Scrollbars were visible on several containers that forgot the existing
`scrollbar-none` utility** (`app/globals.css`) — the TV episode list and
main content area in `DetailModal`, and two list containers in
`FranchiseEditForm`. `Shelf` and `FranchiseRow`'s horizontal rows already had
it; this was just inconsistently applied, not a new mechanism.
