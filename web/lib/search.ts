import type { MediaItem } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { buildPrefixQuery, catalogRowToMediaItem, type CatalogDBRow } from "@/lib/catalog";
import { upcomingRowToMediaItem, type UpcomingDBRow } from "@/lib/upcoming";
import { excludeHiddenSQL, type ContentCategory } from "@/lib/contentFilters";

// The combined text-search read: catalog_items (released titles) and
// upcoming_items (announced-but-unreleased) in ONE UNION ALL round trip.
// These used to be two separate queries fired in parallel — but Neon's HTTP
// driver pays ~50-150ms of round-trip latency PER QUERY, so merging them
// takes that cost once instead of twice on every keystroke's search.
//
// Deliberately no popularity gate on the upcoming side — a search should
// find a real, officially-confirmed title regardless of how much current
// buzz it has (the tables themselves are already admission-filtered).
//
// The outer ORDER BY (src, then rank) reproduces the old behavior exactly:
// all catalog results first (richer data), then upcoming, each block
// relevance-ordered — subquery order inside UNION ALL isn't guaranteed to
// survive, so it's restated at the top level rather than assumed.
const combinedRow = (row: { src: number }) =>
  row.src === 0
    ? catalogRowToMediaItem(row as unknown as CatalogDBRow)
    : upcomingRowToMediaItem(row as unknown as UpcomingDBRow);

export async function searchCatalogAndUpcoming(
  query: string,
  catalogType: string | undefined,
  upcomingTypes: string[],
  hidden: ContentCategory[] = [],
  catalogLimit = 40,
  upcomingLimit = 20
): Promise<MediaItem[]> {
  const tsq = buildPrefixQuery(query);
  if (!tsq) return [];
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);

    // The catalog side is ALWAYS restricted to upcomingTypes, not just
    // optionally to a single catalogType — verified live, this was the bug
    // behind manga still appearing in plain/"All" search after manga was
    // removed from Discover: the default caller passes catalogType=undefined
    // (meaning "any of these 3 types", relying on upcomingTypes alone) but
    // that predicate was only ever applied to the upcoming_items half of the
    // UNION, so catalog_items — where already-released manga still sits,
    // ingestion paused but not deleted — ran with NO type filter at all and
    // matched every type. catalogType is kept as a param for callers that
    // want a SINGLE type (movie/tvShow/game individual searches), where it's
    // identical to a 1-element upcomingTypes array anyway.
    const catalogTypes = catalogType ? [catalogType] : upcomingTypes;
    const params: unknown[] = [tsq, catalogLimit, upcomingLimit, upcomingTypes, catalogTypes];

    // The upcoming branch aliases empty JSONB literals into the catalog-only
    // columns so both branches share one projection; `src` tells the mapper
    // which table a row came from.
    const rows = (await sql(
      `SELECT * FROM (
         (SELECT id, type, title, overview, poster_url, backdrop_url, release_date, popularity_score,
                 genres, external_links, metadata,
                 NULL::boolean AS date_confirmed, 0 AS src,
                 ts_rank(search_vector, to_tsquery('english', $1)) AS rank
          FROM catalog_items
          WHERE search_vector @@ to_tsquery('english', $1) AND type = ANY($5) ${filterSQL}
          ORDER BY rank DESC, popularity_score DESC
          LIMIT $2)
         UNION ALL
         (SELECT id, type, title, overview, poster_url, backdrop_url, release_date, popularity_score,
                 '[]'::jsonb AS genres, '[]'::jsonb AS external_links, '{}'::jsonb AS metadata,
                 date_confirmed, 1 AS src,
                 ts_rank(search_vector, to_tsquery('english', $1)) AS rank
          FROM upcoming_items
          WHERE search_vector @@ to_tsquery('english', $1) AND type = ANY($4) ${filterSQL}
          ORDER BY rank DESC, popularity_score DESC
          LIMIT $3)
       ) combined
       ORDER BY src ASC, rank DESC, popularity_score DESC`,
      params
    )) as unknown as { src: number }[];

    return rows.map(combinedRow);
  } catch {
    return [];
  }
}
