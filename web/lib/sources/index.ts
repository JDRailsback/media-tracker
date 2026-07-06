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

// Round-robin interleave instead of concatenating. Without this, a combined
// search for "minecraft" would show 20 irrelevant movies (fetched first, in
// list order) before the one game that's actually the answer. Interleaving
// guarantees every source's best match surfaces near the top.
function interleave(lists: MediaItem[][]): MediaItem[] {
  const out: MediaItem[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

// Search dispatch. No type -> search all sources concurrently, quality-filter
// (done inside each adapter), and interleave — never grouped by category.
export async function search(query: string, type?: string | null): Promise<MediaItem[]> {
  switch (type) {
    case "movie":
      return searchTMDBMovie(query);
    case "tvShow":
      return searchTMDBTV(query);
    case "game":
      return searchIGDB(query);
    case "manga":
      return searchMangaDex(query);
    default: {
      const settled = await Promise.allSettled([
        searchTMDBMovie(query),
        searchTMDBTV(query),
        searchIGDB(query),
        searchMangaDex(query),
      ]);
      const lists = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
      return interleave(lists);
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

  return { trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming };
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
