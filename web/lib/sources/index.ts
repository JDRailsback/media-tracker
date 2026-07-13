import type { MediaItem } from "@/lib/types";
import { catalogTop, getCatalogItem, recentReleases, searchCatalog } from "@/lib/catalog";
import { getUpcomingItem, upcomingNewest, upcomingTop, searchUpcoming } from "@/lib/upcoming";
import type { ContentCategory } from "@/lib/contentFilters";
import { searchCollections, detailsCollection, discoverCollections } from "./collection";

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

// Search dispatch — catalog_items (released) AND upcoming_items
// (not-yet-released) now, no live TMDB/IGDB/MangaDex calls anywhere in the
// app. Previously search only covered catalog_items, so an announced-but-
// unreleased title (Avengers: Doomsday, GTA VI, ...) was unfindable by name
// no matter how big it was — only reachable via the Discover shelves. See
// lib/upcoming.ts's searchUpcoming. Manga has no "upcoming" concept, so it
// only ever searches catalog_items. Franchises are deliberately NOT part of
// the combined/"All" search — a franchise container alongside its own
// individual entries would be confusing in one flat list. They only show up
// when explicitly filtered. Franchise search is a pure in-memory fuzzy
// match (see ./collection.ts) — never a network call.
export async function search(query: string, type?: string | null, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  switch (type) {
    case "manga":
      return searchCatalog(query, type, 40, hidden);
    case "movie":
    case "tvShow":
    case "game": {
      const [catalogResults, upcomingResults] = await Promise.all([
        searchCatalog(query, type, 40, hidden),
        searchUpcoming(query, [type], 20, hidden),
      ]);
      return dedupeById([...catalogResults, ...upcomingResults]);
    }
    case "franchise":
      return await searchCollections(query);
    default: {
      // Collection results are kept entirely separate from the media
      // results — the client renders any matches as their own standalone
      // row at the top of the results, never mixed into the flat media grid.
      const [franchiseResults, mediaResults, upcomingResults] = await Promise.all([
        searchCollections(query),
        searchCatalog(query, undefined, 40, hidden),
        searchUpcoming(query, ["movie", "tvShow", "game"], 20, hidden),
      ]);
      return [...franchiseResults, ...dedupeById([...mediaResults, ...upcomingResults])];
    }
  }
}

export async function details(type: string, id: string): Promise<MediaItem> {
  if (type === "franchise") return detailsCollection(id);
  // catalog_items.id is stored in the prefixed "type:sourceId" form (see
  // lib/catalog.ts) — the route splits it apart to build this call, so it
  // has to be put back together here. Catalog first (released titles carry
  // richer data — links, episodes), then upcoming_items: an unreleased
  // title lives ONLY there until it graduates to the catalog on release,
  // and it must resolve here or following it silently breaks (Home feed
  // refresh, detail modal, poll notifications all come through details()).
  const item = (await getCatalogItem(`${type}:${id}`)) ?? (await getUpcomingItem(`${type}:${id}`));
  if (!item) throw new Error(`Not found: ${type}:${id}`);
  return item;
}

export interface DiscoverPayload {
  trendingMovies: MediaItem[];
  trendingTV: MediaItem[];
  popularGames: MediaItem[];
  popularManga: MediaItem[];
  popularUpcoming: MediaItem[];
  newReleases: MediaItem[];
  justAnnounced: MediaItem[];
  featuredCollections: MediaItem[];
}

// Curated groupings for the Discover page — reads catalog_items/upcoming_items
// only, all of it refreshed by the daily cron (/api/cron/daily) — never a
// live TMDB/IGDB/MangaDex call from this request path. newReleases is the
// last-30-days slice of catalog_items; justAnnounced is upcoming_items by
// first-seen time. `hidden` is the user's Settings → Content filters
// selection (see lib/contentFilters.ts), applied server-side so a hidden
// category is excluded from the query itself, not just hidden in the UI.
export async function discover(hidden: ContentCategory[] = []): Promise<DiscoverPayload> {
  const [trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming, newReleases, justAnnounced, featuredCollections] =
    await Promise.all([
      catalogTop("movie", 20, hidden),
      catalogTop("tvShow", 20, hidden),
      catalogTop("game", 20, hidden),
      catalogTop("manga", 20, hidden),
      upcomingTop(["movie", "tvShow", "game"], 16, hidden),
      recentReleases(["movie", "tvShow", "game", "manga"], 16, 30, hidden),
      upcomingNewest(["movie", "tvShow", "game"], 16, hidden),
      discoverCollections(true),
    ]);
  return { trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming, newReleases, justAnnounced, featuredCollections };
}

// A single category, expanded (for "see all" drill-down on the Discover page).
export async function discoverCategory(category: string, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  switch (category) {
    case "movies":
      return catalogTop("movie", 40, hidden);
    case "tv":
      return catalogTop("tvShow", 40, hidden);
    case "games":
      return catalogTop("game", 40, hidden);
    case "manga":
      return catalogTop("manga", 40, hidden);
    case "collections":
      // Curated list plus admin overrides — no TMDB/IGDB/MangaDex calls,
      // same as before.
      return await discoverCollections(false);
    case "upcoming":
      return upcomingTop(["movie", "tvShow", "game"], 40, hidden);
    case "new-releases":
      return recentReleases(["movie", "tvShow", "game", "manga"], 40, 30, hidden);
    case "just-announced":
      return upcomingNewest(["movie", "tvShow", "game"], 40, hidden);
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}
