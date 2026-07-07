import type { MediaItem } from "@/lib/types";
import {
  searchTMDBMovie,
  detailsTMDBMovie,
  searchTMDBTV,
  detailsTMDBTV,
  discoverTMDBMovies,
  discoverTMDBTV,
  discoverTMDBUpcomingMovies,
  discoverTMDBUpcomingTV,
} from "./tmdb";
import { searchIGDB, detailsIGDB, discoverIGDBPopular, discoverIGDBUpcoming } from "./igdb";
import { searchMangaDex, detailsMangaDex, discoverMangaDex } from "./mangadex";
import { searchFranchises, detailsFranchise, discoverFranchises } from "./franchise";
import { fuzzyMatches, matchTier, normalizedScores, RankedItem, stripRanking, typoVariants } from "./textMatch";

// Round-robin interleave instead of concatenating. Without this, a combined
// search for "minecraft" would show 20 irrelevant movies (fetched first, in
// list order) before the one game that's actually the answer. Interleaving
// guarantees every source's best match surfaces near the top.
function interleave(lists: RankedItem[][]): RankedItem[] {
  const out: RankedItem[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

// Some sources fuzzy-match on things that never appear in the displayed
// title (tags, alt-titles) — e.g. searching "toy story" returned MangaDex
// results with no visible relation to the query at all. Reject anything
// that isn't at least an exact/starts-with/contains match OR a plausible
// misspelling of the title actually shown to the user, BEFORE ranking — a
// popularity score doesn't make an unrelated result acceptable to show, but
// a genuine typo (matchTier() alone requires an unbroken substring, which a
// typo breaks) shouldn't return nothing either.
function relevantOnly(items: RankedItem[], query: string): RankedItem[] {
  return items.filter((i) => matchTier(i.title, query) < 3 || fuzzyMatches(i.title, query));
}

// Rank by (significant desc, matchTier asc, popularity desc) — NOT match
// tier alone. An exact match doesn't automatically win: a hugely popular
// near-match (e.g. "Toy Story 2") should outrank a barely-passing exact
// match (e.g. an obscure "Toy Story"-titled game). "significant" means the
// item would clear each adapter's stricter non-exact-match bar regardless
// of its actual match tier — see lib/sources/textMatch.ts. The popularity
// key is real (raw, single-source — see RankedItem.popularity), not just a
// stable-sort artifact of interleave order: items tied on significance and
// tier used to fall back to whatever order the source's OWN API returned
// them in, which isn't necessarily popularity order. `query` here must be
// whichever string actually produced `items` — see withTypoFallback's
// `query` field below; filtering/sorting a typo-corrected result set against
// the ORIGINAL misspelled query (rather than the correction that found it)
// was a real bug ("toystroy" -> the "toystory" variant correctly found Toy
// Story on TMDB, but got discarded a moment later because
// fuzzyMatches("Toy Story", "toystroy") exceeds the edit-distance budget —
// the correction had already happened, this check was re-litigating it
// against the wrong string).
function filterAndSort(items: RankedItem[], query: string): RankedItem[] {
  return relevantOnly(items, query).sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1;
    const tierDiff = matchTier(a.title, query) - matchTier(b.title, query);
    if (tierDiff !== 0) return tierDiff;
    return b.popularity - a.popularity;
  });
}

function byRelevance(items: RankedItem[], query: string): MediaItem[] {
  return stripRanking(filterAndSort(items, query));
}

// A source's OWN search can come back completely empty for a misspelled
// query — verified live that IGDB and MangaDex have NO typo tolerance at
// all ("pokemn" for "pokemon" returns zero raw candidates), unlike TMDB
// which already handles mild typos on its own. When that happens, retry with
// a handful of plausible single-typo corrections (see typoVariants) and use
// the first correction that actually returns something. Only triggers on a
// genuinely empty result — a query that already found something never pays
// this extra cost.
interface FallbackResult {
  items: RankedItem[];
  // Whichever string (original query, or the typo variant that succeeded)
  // actually produced `items` — callers must filter/sort relevance against
  // THIS, not the original query, or a genuine correction gets thrown away
  // a moment after being found (see filterAndSort above).
  query: string;
}

// Budget for the OPTIONAL typo-correction sweep only — a real user
// requirement ("no search should take longer than 2 seconds"), verified live
// to matter: IGDB's real ~4 req/sec rate limit (see lib/sources/igdb.ts)
// means working through dozens of correction candidates can take 15-20+
// seconds if left unbounded. Deliberately does NOT wrap the primary call —
// tried that, and verified live it was actively harmful: under back-to-back
// load, IGDB's shared rate-limit window can back up enough that even a
// single, correctly-spelled, primary request ("skyrim") hadn't resolved yet
// when a shared deadline expired, which made the search return EMPTY for a
// game that definitely exists. Sacrificing correctness for a latency
// guarantee is the wrong trade — the primary call is always trusted to
// finish and return the truth; only the discretionary retry-on-nothing-found
// sweep is time-boxed.
const TYPO_FALLBACK_BUDGET_MS = 1200;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout);
      }
    );
  });
}

// Worker-pool over `variants`, but — unlike a plain "wait for everything,
// then pick the first success" sweep — workers stop claiming NEW variants
// the moment any one of them finds a relevant match. Waiting for the full
// batch to settle before checking results was fine for correctness but
// wasted the entire fallback's time budget even when the very first variant
// already worked (a real problem once a hard 2-second ceiling was added:
// there's no time left to burn on requests whose answer no longer matters).
// `deadline` (not just the outer withTimeout race) matters here — without
// it, a query that never finds a match keeps workers claiming and firing
// requests against `variants` for as long as the array lasts, even after
// the caller has already given up waiting and responded to the client. That
// wastes real budget on a rate-limited source (IGDB) for zero benefit.
async function findTypoMatch(
  variants: string[],
  concurrency: number,
  searchFn: (q: string) => Promise<RankedItem[]>,
  deadline: number
): Promise<FallbackResult | null> {
  let next = 0;
  let found: FallbackResult | null = null;
  async function worker() {
    while (next < variants.length && !found && Date.now() < deadline) {
      const i = next++;
      try {
        const value = await searchFn(variants[i]);
        if (!found && relevantOnly(value, variants[i]).length > 0) {
          found = { items: value, query: variants[i] };
        }
      } catch {
        // A single variant failing (e.g. a rate-limited request) shouldn't
        // sink the whole search — just move on to the next candidate.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, variants.length) }, () => worker())
  );
  return found;
}

async function withTypoFallback(
  query: string,
  searchFn: (q: string) => Promise<RankedItem[]>
): Promise<FallbackResult> {
  const primary = await searchFn(query);
  // A non-empty primary result isn't necessarily a GOOD one — verified live
  // that TMDB's own fuzzy search for a garbled query like "toystroy" already
  // returns some barely-related candidate rather than nothing, which used to
  // make this short-circuit here and never try the "toystory" variant that
  // actually would have worked. Only count primary as sufficient if it has
  // at least one result that survives the same relevance check the caller
  // will apply anyway.
  if (relevantOnly(primary, query).length > 0) return { items: primary, query };

  const variants = typoVariants(query);
  const deadline = Date.now() + TYPO_FALLBACK_BUDGET_MS;
  const found = await withTimeout(
    findTypoMatch(variants, 10, searchFn, deadline),
    TYPO_FALLBACK_BUDGET_MS,
    null
  );
  return found ?? { items: primary, query };
}

// Search dispatch. No type -> search all sources concurrently, quality-filter
// (done inside each adapter), and interleave — never grouped by category.
// Franchises are deliberately NOT part of the combined/"All" search — a
// franchise container alongside its own individual entries would be
// confusing in one flat list. They only show up when explicitly filtered.
// Franchise search is a pure in-memory fuzzy match (see
// lib/sources/franchise.ts) — no typo-fallback machinery needed, it's not a
// rate-limited network call.
export async function search(query: string, type?: string | null): Promise<MediaItem[]> {
  switch (type) {
    case "movie": {
      const r = await withTypoFallback(query, searchTMDBMovie);
      return byRelevance(r.items, r.query);
    }
    case "tvShow": {
      const r = await withTypoFallback(query, searchTMDBTV);
      return byRelevance(r.items, r.query);
    }
    case "game": {
      const r = await withTypoFallback(query, searchIGDB);
      return byRelevance(r.items, r.query);
    }
    case "manga": {
      const r = await withTypoFallback(query, searchMangaDex);
      return byRelevance(r.items, r.query);
    }
    case "franchise":
      return await searchFranchises(query);
    default: {
      const settled = await Promise.allSettled([
        withTypoFallback(query, searchTMDBMovie),
        withTypoFallback(query, searchTMDBTV),
        withTypoFallback(query, searchIGDB),
        withTypoFallback(query, searchMangaDex),
      ]);
      // Each source may have resolved via a DIFFERENT typo correction, so
      // filter/sort each against its own matched query before merging —
      // matchTier comparisons only make sense within a single reference
      // query, not across sources that corrected differently.
      const lists = settled.map((r) =>
        r.status === "fulfilled" ? filterAndSort(r.value.items, r.value.query) : []
      );
      // Popularity is real now (not just a stable-sort artifact of
      // interleave position) but each source's raw numbers are on wildly
      // different scales (MangaDex follows vs. IGDB rating counts vs. TMDB
      // vote counts) — normalize each source's OWN list to 0-1 before
      // comparing across sources, same approach as the franchise "Most
      // Popular" row (lib/sources/franchise.ts).
      const scores = new Map<string, number>();
      for (const list of lists) {
        for (const [id, score] of normalizedScores(list)) scores.set(id, score);
      }
      const merged = interleave(lists).sort((a, b) => {
        if (a.significant !== b.significant) return a.significant ? -1 : 1;
        return (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
      });
      return stripRanking(merged);
    }
  }
}

export async function details(type: string, id: string): Promise<MediaItem> {
  switch (type) {
    case "movie":
      return detailsTMDBMovie(id);
    case "tvShow":
      return detailsTMDBTV(id);
    case "game":
      return detailsIGDB(id);
    case "manga":
      return detailsMangaDex(id);
    case "franchise":
      return detailsFranchise(id);
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}

export interface DiscoverPayload {
  trendingMovies: MediaItem[];
  trendingTV: MediaItem[];
  popularGames: MediaItem[];
  popularManga: MediaItem[];
  popularUpcoming: MediaItem[];
  featuredFranchises: MediaItem[];
}

// Curated groupings for the Discover page. Each shelf is independent — one
// source failing (e.g. IGDB credentials missing) doesn't break the others.
export async function discover(): Promise<DiscoverPayload> {
  const [trendingMovies, trendingTV, popularGames, popularManga, upcomingMovies, upcomingTV, upcomingGames] =
    await Promise.allSettled([
      discoverTMDBMovies(),
      discoverTMDBTV(),
      discoverIGDBPopular(),
      discoverMangaDex(),
      discoverTMDBUpcomingMovies(),
      discoverTMDBUpcomingTV(),
      discoverIGDBUpcoming(),
    ]).then((results) => results.map((r) => (r.status === "fulfilled" ? r.value : [])));

  // "Popular upcoming" = soonest-first, across movies/TV/games that are both
  // unreleased AND already popular/anticipated.
  const popularUpcoming = [...upcomingMovies, ...upcomingTV, ...upcomingGames]
    .filter((i) => i.releaseDate)
    .sort((a, b) => (a.releaseDate! < b.releaseDate! ? -1 : 1))
    .slice(0, 16);

  // No TMDB/IGDB/MangaDex calls — just curated data plus one DB read for
  // any admin overrides (see lib/sources/franchise.ts).
  const featuredFranchises = await discoverFranchises(true);

  return { trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming, featuredFranchises };
}

// A single category, expanded (for "see all" drill-down on the Discover page).
export async function discoverCategory(category: string): Promise<MediaItem[]> {
  switch (category) {
    case "movies":
      return discoverTMDBMovies(40);
    case "tv":
      return discoverTMDBTV(40);
    case "games":
      return discoverIGDBPopular(40);
    case "manga":
      return discoverMangaDex(40);
    case "franchises":
      // Curated list plus admin overrides — returned in full (there are
      // 150+, but no TMDB/IGDB/MangaDex calls, unlike every other category
      // here).
      return await discoverFranchises(false);
    case "upcoming": {
      const [movies, tv, games] = await Promise.allSettled([
        discoverTMDBUpcomingMovies(20),
        discoverTMDBUpcomingTV(20),
        discoverIGDBUpcoming(20),
      ]).then((results) => results.map((r) => (r.status === "fulfilled" ? r.value : [])));
      return [...movies, ...tv, ...games]
        .filter((i) => i.releaseDate)
        .sort((a, b) => (a.releaseDate! < b.releaseDate! ? -1 : 1));
    }
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}
