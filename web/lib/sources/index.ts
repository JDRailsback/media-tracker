import type { MediaItem } from "@/lib/types";
import { catalogTop, getCatalogItem, searchCatalog } from "@/lib/catalog";
import { upcomingTop } from "@/lib/upcoming";
import { searchCollections, detailsCollection, discoverCollections } from "./collection";

// Search dispatch — catalog-only right now, no live TMDB/IGDB/MangaDex calls
// anywhere in the app (see lib/catalog.ts's searchCatalog). Franchises are
// deliberately NOT part of the combined/"All" search — a franchise container
// alongside its own individual entries would be confusing in one flat list.
// They only show up when explicitly filtered. Franchise search is a pure
// in-memory fuzzy match (see ./collection.ts) — never a network call.
export async function search(query: string, type?: string | null): Promise<MediaItem[]> {
  switch (type) {
    case "movie":
    case "tvShow":
    case "game":
    case "manga":
      return searchCatalog(query, type);
    case "franchise":
      return await searchCollections(query);
    default: {
      // Collection results are kept entirely separate from the media
      // results — the client renders any matches as their own standalone
      // row at the top of the results, never mixed into the flat media grid.
      const franchiseResults = await searchCollections(query);
      const mediaResults = await searchCatalog(query);
      return [...franchiseResults, ...mediaResults];
    }
  }
}

export async function details(type: string, id: string): Promise<MediaItem> {
  if (type === "franchise") return detailsCollection(id);
  // catalog_items.id is stored in the prefixed "type:sourceId" form (see
  // lib/catalog.ts) — the route splits it apart to build this call, so it
  // has to be put back together here.
  const item = await getCatalogItem(`${type}:${id}`);
  if (!item) throw new Error(`Not found: ${type}:${id}`);
  return item;
}

export interface DiscoverPayload {
  trendingMovies: MediaItem[];
  trendingTV: MediaItem[];
  popularGames: MediaItem[];
  popularManga: MediaItem[];
  popularUpcoming: MediaItem[];
  featuredCollections: MediaItem[];
}

// Curated groupings for the Discover page — reads catalog_items/upcoming_items
// only. popularUpcoming reads upcoming_items, refreshed daily by
// /api/cron/upcoming — never a live call from this request path.
export async function discover(): Promise<DiscoverPayload> {
  const [trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming, featuredCollections] =
    await Promise.all([
      catalogTop("movie"),
      catalogTop("tvShow"),
      catalogTop("game"),
      catalogTop("manga"),
      upcomingTop(["movie", "tvShow", "game"], 16),
      discoverCollections(true),
    ]);
  return { trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming, featuredCollections };
}

// A single category, expanded (for "see all" drill-down on the Discover page).
export async function discoverCategory(category: string): Promise<MediaItem[]> {
  switch (category) {
    case "movies":
      return catalogTop("movie", 40);
    case "tv":
      return catalogTop("tvShow", 40);
    case "games":
      return catalogTop("game", 40);
    case "manga":
      return catalogTop("manga", 40);
    case "collections":
      // Curated list plus admin overrides — no TMDB/IGDB/MangaDex calls,
      // same as before.
      return await discoverCollections(false);
    case "upcoming":
      return upcomingTop(["movie", "tvShow", "game"], 40);
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}
