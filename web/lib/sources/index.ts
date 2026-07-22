import type { MediaItem } from "@/lib/types";
import { getCatalogItem, searchCatalog, existingMediaTitles, FRANCHISE_NAME_COLLISION_MIN_FANS } from "@/lib/catalog";
import { getUpcomingItem } from "@/lib/upcoming";
import { getUpcomingCalendarTop, getNewReleasesCalendarTop } from "@/lib/upcomingCalendar";
import { DEFAULT_INTL_BAR_LEVEL, type IntlBarLevel } from "@/lib/intlBar";
import { DEFAULT_GENERAL_BAR_LEVEL, type GeneralBarLevel } from "@/lib/generalBar";
import { searchCatalogAndUpcoming } from "@/lib/search";
import { attachTVAirtimes } from "@/lib/airtimes";
import { trendingTop } from "@/lib/trending";
import { getDiscoverSnapshot, setDiscoverSnapshot, type DiscoverPayload } from "@/lib/discoverSnapshot";
import type { ContentCategory } from "@/lib/contentFilters";
import { searchCollections, detailsCollection, discoverCollections } from "./collection";
import { artistToMediaItem, searchDeezerArtists } from "./deezer";
import { ARTIST_METADATA_VERSION, getArtistRowState, ingestArtist } from "./artist";

// A catalog result and an upcoming-table result can never collide on id in
// practice (a title lives in exactly one of the two tables at a time — see
// the daily cron's graduation/prune logic), but dedupe defensively anyway
// rather than assume that invariant holds across every edge case.
function dedupeById(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// Music is the one type with a LIVE search fallback: there's no "top 10k
// artists" list to bulk-ingest the way vote-count sorts provide for other
// types, so the pre-ingested catalog only covers a few thousand chart
// artists — a niche artist has to be findable live or not at all. Deezer is
// keyless and fast; time-boxed so a slow response degrades to catalog-only
// results instead of hanging the whole search. Callers START this in
// parallel with the DB queries and only AWAIT it when the catalog came back
// thin — the common rich-catalog case never waits on Deezer at all.
const LIVE_ARTIST_SEARCH_BUDGET_MS = 1200;

// Deezer's own soundtrack-keyword filter (see deezer.ts) only catches an
// account explicitly named "X OST" — it doesn't catch a fan-upload account
// named EXACTLY after the franchise itself ("One Piece": 4,169 fans, no
// "OST" in the name at all, verified live). Cross-referencing against our
// own non-artist catalog is the other half of that fix (see
// FRANCHISE_NAME_COLLISION_MIN_FANS's comment in lib/catalog.ts) — this
// adapter is the DB-aware orchestration layer, so it's the right place for
// it, not the keyless deezer.ts adapter.
async function filterFranchiseNameCollisions(artists: DeezerArtist[]): Promise<DeezerArtist[]> {
  if (artists.length === 0) return artists;
  const collisions = await existingMediaTitles(artists.map((a) => a.name));
  return artists.filter(
    (a) => !collisions.has(a.name.toLowerCase()) || (a.nb_fan ?? 0) >= FRANCHISE_NAME_COLLISION_MIN_FANS
  );
}

function liveArtistSearch(query: string, limit: number): Promise<MediaItem[]> {
  const timeout = new Promise<MediaItem[]>((resolve) =>
    setTimeout(() => resolve([]), LIVE_ARTIST_SEARCH_BUDGET_MS)
  );
  const live = searchDeezerArtists(query, limit)
    .then((artists) => filterFranchiseNameCollisions(artists))
    .then((artists) => artists.map(artistToMediaItem))
    .catch(() => [] as MediaItem[]);
  return Promise.race([live, timeout]);
}

// Enough catalog artist hits that the live fallback adds nothing but wait.
const LIVE_ARTIST_MIN_CATALOG_HITS = 5;

// Search responses are grids of cards — they never render episode lists or
// discographies, and the detail views refetch the full item anyway. A 40-hit
// TV search would otherwise serialize thousands of episode entries per
// response (each TV row carries its full season scan), which the client
// then re-persists to sessionStorage on every keystroke.
function slimForSearch(items: MediaItem[]): MediaItem[] {
  return items.map((i) =>
    i.episodes || i.episodeCount || i.releases
      ? { ...i, episodes: undefined, episodeCount: undefined, releases: undefined }
      : i
  );
}

// Search dispatch — catalog_items (released) AND upcoming_items
// (not-yet-released), fetched as ONE combined round trip (see
// lib/search.ts's searchCatalogAndUpcoming); the only live network call
// anywhere in search is the Deezer artist fallback below. Manga has no
// "upcoming" concept, so it only ever searches catalog_items. Franchises
// are deliberately NOT part of the combined/"All" search — a franchise
// container alongside its own individual entries would be confusing in one
// flat list. They only show up when explicitly filtered. Franchise search
// is a pure in-memory fuzzy match (see ./collection.ts) — never a network
// call.
export async function search(query: string, type?: string | null, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  switch (type) {
    case "manga":
      return searchCatalog(query, type, 40, hidden);
    case "artist": {
      // Live search starts alongside the catalog query, but is only
      // AWAITED when the catalog came back thin — a well-known artist
      // resolves at pure DB speed, a niche one costs at most the
      // fallback's time-box.
      const livePromise = liveArtistSearch(query, 15);
      const catalogResults = await searchCatalog(query, type, 40, hidden);
      if (catalogResults.length >= LIVE_ARTIST_MIN_CATALOG_HITS) return slimForSearch(catalogResults);
      const liveResults = await livePromise;
      return slimForSearch(dedupeById([...catalogResults, ...liveResults]));
    }
    case "movie":
    case "tvShow":
    case "game":
      return slimForSearch(await searchCatalogAndUpcoming(query, type, [type], hidden));
    case "franchise":
      return await searchCollections(query);
    default: {
      // Collection results are kept entirely separate from the media
      // results — the client renders any matches as their own standalone
      // row at the top of the results, never mixed into the flat media grid.
      //
      // The live artist fallback starts in parallel but is only awaited
      // when the catalog produced NO artist at all (and music isn't
      // hidden) — a niche-artist query still finds them without slowing
      // every ordinary movie/TV search down. `mediaResults` never contains
      // an artist (searchCatalogAndUpcoming below is scoped to
      // movie/tvShow/game only), so this ALSO queries the artist catalog
      // directly — cheap (well under 100ms, run in parallel with the other
      // two) — otherwise "hasArtist" was always false and every single
      // unscoped search paid the live Deezer round-trip regardless of the
      // query, which was the actual cause of "search is slow" (verified
      // live: the DB queries here run in 13-70ms, the Deezer call itself in
      // 150-300ms — the tax was being paid on every search, not that any
      // one call was slow).
      const livePromise = hidden.includes("music") ? null : liveArtistSearch(query, 5);
      const [franchiseResults, mediaResults, catalogArtists] = await Promise.all([
        searchCollections(query),
        searchCatalogAndUpcoming(query, undefined, ["movie", "tvShow", "game"], hidden),
        hidden.includes("music") ? Promise.resolve([]) : searchCatalog(query, "artist", 5, hidden),
      ]);
      const liveArtists = catalogArtists.length > 0 || !livePromise ? [] : await livePromise;
      return [
        ...franchiseResults,
        ...slimForSearch(dedupeById([...mediaResults, ...catalogArtists, ...liveArtists])),
      ];
    }
  }
}

export async function details(type: string, id: string): Promise<MediaItem> {
  if (type === "franchise") return detailsCollection(id);
  if (type === "artist") {
    // Two self-heals share this path:
    //  (a) Lazy admission — an artist found through the live search
    //      fallback has no catalog row yet; ingest on first resolution so
    //      following them Just Works everywhere downstream (Home feed
    //      refresh, detail modal, poll notifications).
    //  (b) One-time MusicBrainz upgrade — bulk-ingested rows skip MB (its
    //      1 req/s cap makes a thousands-run take hours), so the first time
    //      anyone actually resolves the artist (opening the modal, or the
    //      feed refreshing a followed artist), do the enriched pass that
    //      picks up FUTURE release dates. The mbid marker in metadata makes
    //      this a once-per-artist cost, and the daily cron keeps it fresh
    //      from then on. A stale metadata version (see
    //      ARTIST_METADATA_VERSION) re-triggers the same refresh so rows
    //      ingested under an older discography shape self-heal too.
    const state = await getArtistRowState(`artist:${id}`);
    if (!state.exists || !state.mbAttempted || state.version < ARTIST_METADATA_VERSION) {
      await ingestArtist(id, state.mbid);
    }
    const item = await getCatalogItem(`artist:${id}`);
    if (!item) throw new Error(`Not found: artist:${id}`);
    return item;
  }
  // catalog_items.id is stored in the prefixed "type:sourceId" form (see
  // lib/catalog.ts) — the route splits it apart to build this call, so it
  // has to be put back together here. Catalog first (released titles carry
  // richer data — links, episodes), then upcoming_items: an unreleased
  // title lives ONLY there until it graduates to the catalog on release,
  // and it must resolve here or following it silently breaks (Home feed
  // refresh, detail modal, poll notifications all come through details()).
  const item = (await getCatalogItem(`${type}:${id}`)) ?? (await getUpcomingItem(`${type}:${id}`));
  if (!item) throw new Error(`Not found: ${type}:${id}`);
  // TV shows with a next episode get exact air TIMES attached lazily
  // (TVmaze, cached in metadata — see lib/airtimes.ts). No-op for
  // everything else and for shows with nothing scheduled.
  if (item.type === "tvShow") return attachTVAirtimes(item);
  return item;
}

// Re-exported so existing `import type { DiscoverPayload } from "@/lib/sources"`
// call sites (app/page.tsx) keep working — lib/discoverSnapshot.ts is the
// canonical definition now (it needs the type and can't import this module
// without a cycle, since this module calls INTO it).
export type { DiscoverPayload };

// Curated groupings for the Discover page — reads catalog_items/upcoming_items/
// trending_items only, all of it refreshed by the daily cron
// (/api/cron/daily) — never a live TMDB/IGDB/MangaDex call from this request
// path. The four "trending" shelves read trending_items (each source's own
// real momentum signal — see lib/trending.ts), NOT catalog_items'
// popularity_score (an all-time cumulative signal, genuinely a different
// thing — see docs on trending_items in lib/db.ts). newReleases is the
// last-30-days slice of catalog_items. `hidden` is the user's Settings →
// Content filters selection (see lib/contentFilters.ts), applied
// server-side so a hidden category is excluded from the query itself, not
// just hidden in the UI.
export async function discover(
  hidden: ContentCategory[] = [],
  intlBar: IntlBarLevel = DEFAULT_INTL_BAR_LEVEL,
  generalBar: GeneralBarLevel = DEFAULT_GENERAL_BAR_LEVEL
): Promise<DiscoverPayload> {
  // Manga trending intentionally omitted — see DiscoverPayload's comment.
  const [trendingMovies, trendingTV, trendingGames, trendingArtists, popularUpcoming, newReleases, featuredCollections] =
    await Promise.all([
      trendingTop("movie", 20, hidden),
      trendingTop("tvShow", 20, hidden),
      trendingTop("game", 20, hidden),
      trendingTop("artist", 20, hidden),
      getUpcomingCalendarTop(["movie", "tvShow", "game"], 20, hidden, intlBar, generalBar),
      getNewReleasesCalendarTop(["movie", "tvShow", "game"], 20, hidden, intlBar, generalBar),
      discoverCollections(true),
    ]);
  return { trendingMovies, trendingTV, trendingGames, trendingArtists, popularUpcoming, newReleases, featuredCollections };
}

// What /api/discover actually calls for the no-category request: the
// precomputed snapshot when there's no hidden-category filter AND both bars
// are at their defaults (see lib/discoverSnapshot.ts for why that's the
// only case cached) and a snapshot exists yet — self-heals to a live
// compute otherwise (first-ever run before any cron has fired, a snapshot
// read failure, or a non-default bar setting), same "enhancement, never a
// hard requirement" pattern as TV airtime caching.
export async function discoverCached(
  hidden: ContentCategory[] = [],
  intlBar: IntlBarLevel = DEFAULT_INTL_BAR_LEVEL,
  generalBar: GeneralBarLevel = DEFAULT_GENERAL_BAR_LEVEL
): Promise<DiscoverPayload> {
  if (hidden.length === 0 && intlBar === DEFAULT_INTL_BAR_LEVEL && generalBar === DEFAULT_GENERAL_BAR_LEVEL) {
    const snapshot = await getDiscoverSnapshot();
    if (snapshot) return snapshot;
  }
  return discover(hidden, intlBar, generalBar);
}

// Called once daily by /api/cron/daily, LAST — after trending_items,
// upcoming_items, catalog_items, and collections have all been refreshed
// that same run, so the snapshot reflects the freshest possible state
// rather than racing ahead of the data it's built from. Always built with
// BOTH bars at their defaults — that's the only variant discoverCached
// serves from this snapshot; any other setting computes live.
export async function refreshDiscoverSnapshot(): Promise<void> {
  const payload = await discover([], DEFAULT_INTL_BAR_LEVEL, DEFAULT_GENERAL_BAR_LEVEL);
  await setDiscoverSnapshot(payload);
}

// A single category, expanded (for "see all" drill-down on the Discover page).
// NOTE: "upcoming" and "new-releases" are NOT handled here — both paginate
// (see lib/upcomingCalendar.ts's getUpcomingCalendarPage/
// getNewReleasesCalendarPage), intercepted directly in
// app/api/discover/route.ts before this function is ever called for them.
// "manga" is also gone — see DiscoverPayload's comment.
export async function discoverCategory(category: string, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  switch (category) {
    case "movies":
      return trendingTop("movie", 40, hidden);
    case "tv":
      return trendingTop("tvShow", 40, hidden);
    case "games":
      return trendingTop("game", 40, hidden);
    case "artists":
      return trendingTop("artist", 40, hidden);
    case "collections":
      // Curated list plus admin overrides — no TMDB/IGDB/MangaDex calls,
      // same as before.
      return await discoverCollections(false);
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}
