import type { MediaItem } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";

// Canonical home for DiscoverPayload's shape — lib/sources/index.ts imports
// and re-exports it, rather than the type living there and this file
// importing it back, which would be a circular import (this file's helpers
// are called FROM lib/sources/index.ts).
export interface DiscoverPayload {
  trendingMovies: MediaItem[];
  trendingTV: MediaItem[];
  trendingGames: MediaItem[];
  // Manga is intentionally NOT surfaced on Discover right now (explicit
  // request — "remove manga from the site... flag it as something to
  // potentially add later"). The MangaDex ingestion/catalog rows/trending
  // data are all still intact (see lib/sources/mangadex.ts, catalog_items,
  // trending_items) — only the read-time surfaces (Discover's shelves, this
  // payload, Search's type filter) were turned off, specifically so
  // re-enabling later is a small, additive change rather than rebuilding
  // from scratch.
  trendingArtists: MediaItem[];
  popularUpcoming: MediaItem[];
  newReleases: MediaItem[];
  featuredCollections: MediaItem[];
}

// Precomputed daily snapshot of the UNFILTERED Discover payload (no hidden
// content-filter categories applied) — see refreshDiscoverSnapshot(), called
// once a day at the end of /api/cron/daily, after every table it reads from
// (trending_items, upcoming_items, catalog_items, collections) has itself
// already been refreshed that same run.
//
// Deliberately NOT extended to cover hidden-category requests too: doing
// that would mean either materializing all 16 combinations of the 4 filter
// categories, or duplicating the SQL exclusion predicates (lib/
// contentFilters.ts's CATEGORY_SQL) as a second, independent in-memory JS
// implementation to filter a cached unfiltered pool — both real
// maintenance/correctness risk for a case that's a small minority of
// traffic. A hidden-category request just computes live (see
// lib/sources/index.ts's discoverCached) — already index-backed and fast
// enough on its own.
export async function getDiscoverSnapshot(): Promise<DiscoverPayload | null> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`SELECT payload FROM discover_snapshot WHERE id = 1`) as unknown as {
      payload: DiscoverPayload;
    }[];
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

export async function setDiscoverSnapshot(payload: DiscoverPayload): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`
    INSERT INTO discover_snapshot (id, payload, updated_at) VALUES (1, ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
  `;
}
