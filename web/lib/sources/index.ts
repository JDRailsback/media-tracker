import type { MediaItem } from "@/lib/types";
import { searchTMDB, detailsTMDB } from "./tmdb";
import { searchIGDB, detailsIGDB } from "./igdb";
import { searchMangaDex, detailsMangaDex } from "./mangadex";

// Combined search dispatch. No type -> search all sources concurrently and
// tolerate individual failures (Promise.allSettled).
export async function search(query: string, type?: string | null): Promise<MediaItem[]> {
  switch (type) {
    case "movie":
      return searchTMDB(query);
    case "game":
      return searchIGDB(query);
    case "manga":
      return searchMangaDex(query);
    default: {
      const settled = await Promise.allSettled([
        searchTMDB(query),
        searchIGDB(query),
        searchMangaDex(query),
      ]);
      return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    }
  }
}

export async function details(type: string, id: string): Promise<MediaItem> {
  switch (type) {
    case "movie":
      return detailsTMDB(id);
    case "game":
      return detailsIGDB(id);
    case "manga":
      return detailsMangaDex(id);
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}
