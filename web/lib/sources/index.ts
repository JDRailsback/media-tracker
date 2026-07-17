import type { MediaItem } from "@/lib/types";
import { getCatalogItem, recentReleases, searchCatalog } from "@/lib/catalog";
import { getUpcomingItem, upcomingTop } from "@/lib/upcoming";
import { searchCatalogAndUpcoming } from "@/lib/search";
import { attachTVAirtimes } from "@/lib/airtimes";
import { trendingTop } from "@/lib/trending";
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

function liveArtistSearch(query: string, limit: number): Promise<MediaItem[]> {
  const timeout = new Promise<MediaItem[]>((resolve) =>
    setTimeout(() => resolve([]), LIVE_ARTIST_SEARCH_BUDGET_MS)
  );
  const live = searchDeezerArtists(query, limit)
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
      // every ordinary movie/TV search down.
      const livePromise = hidden.includes("music") ? null : liveArtistSearch(query, 5);
      const [franchiseResults, mediaResults] = await Promise.all([
        searchCollections(query),
        searchCatalogAndUpcoming(query, undefined, ["movie", "tvShow", "game"], hidden),
      ]);
      const hasArtist = mediaResults.some((i) => i.type === "artist");
      const liveArtists = hasArtist || !livePromise ? [] : await livePromise;
      return [...franchiseResults, ...slimForSearch(dedupeById([...mediaResults, ...liveArtists]))];
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

export interface DiscoverPayload {
  trendingMovies: MediaItem[];
  trendingTV: MediaItem[];
  trendingGames: MediaItem[];
  trendingManga: MediaItem[];
  trendingArtists: MediaItem[];
  popularUpcoming: MediaItem[];
  newReleases: MediaItem[];
  featuredCollections: MediaItem[];
}

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
export async function discover(hidden: ContentCategory[] = []): Promise<DiscoverPayload> {
  const [trendingMovies, trendingTV, trendingGames, trendingManga, trendingArtists, popularUpcoming, newReleases, featuredCollections] =
    await Promise.all([
      trendingTop("movie", 20, hidden),
      trendingTop("tvShow", 20, hidden),
      trendingTop("game", 20, hidden),
      trendingTop("manga", 20, hidden),
      trendingTop("artist", 20, hidden),
      upcomingTop(["movie", "tvShow", "game"], 16, hidden),
      recentReleases(["movie", "tvShow", "game", "manga"], 16, 30, hidden),
      discoverCollections(true),
    ]);
  return { trendingMovies, trendingTV, trendingGames, trendingManga, trendingArtists, popularUpcoming, newReleases, featuredCollections };
}

// A single category, expanded (for "see all" drill-down on the Discover page).
export async function discoverCategory(category: string, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  switch (category) {
    case "movies":
      return trendingTop("movie", 40, hidden);
    case "tv":
      return trendingTop("tvShow", 40, hidden);
    case "games":
      return trendingTop("game", 40, hidden);
    case "manga":
      return trendingTop("manga", 40, hidden);
    case "artists":
      return trendingTop("artist", 40, hidden);
    case "collections":
      // Curated list plus admin overrides — no TMDB/IGDB/MangaDex calls,
      // same as before.
      return await discoverCollections(false);
    case "upcoming":
      return upcomingTop(["movie", "tvShow", "game"], 40, hidden);
    case "new-releases":
      return recentReleases(["movie", "tvShow", "game", "manga"], 40, 30, hidden);
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}
