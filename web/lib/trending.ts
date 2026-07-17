import type { MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { excludeHiddenSQL, type ContentCategory } from "@/lib/contentFilters";

// Genuinely-trending-right-now data — distinct from catalog_items'
// popularity_score, which is an all-time cumulative signal (vote_count/
// total_rating_count/follows) and answers "what's big," not "what's hot this
// week." Refreshed daily by /api/cron/daily from each source's own momentum
// signal (TMDB's trending/week, IGDB's popularity_primitives, a MangaDex
// active-by-follows proxy — see lib/sources/{tmdb,igdb,mangadex}.ts).
// `rank` is the source's own trending ORDER (1 = most trending), not a
// popularity score — full replace-on-refresh (upsert + prune), same pattern
// as upcoming_items, since yesterday's rank is meaningless once a fresher
// run has a new order.
export interface TrendingRow {
  id: string; // e.g. "movie:603"
  type: "movie" | "tvShow" | "game" | "manga" | "artist";
  title: string;
  overview?: string;
  posterURL?: string;
  backdropURL?: string; // wide hero art — see MediaItem.backdropURL
  releaseDate?: string;
  rank: number;
  genres?: string[];
  originalLanguage?: string;
}

interface TrendingDBRow {
  id: string;
  type: string;
  title: string;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  release_date: string | Date | null;
  rank: number;
}

function toISODate(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function rowToMediaItem(row: TrendingDBRow): MediaItem {
  return {
    id: row.id,
    type: row.type as MediaType,
    title: row.title,
    overview: row.overview ?? undefined,
    posterURL: row.poster_url ?? undefined,
    backdropURL: row.backdrop_url ?? undefined,
    releaseDate: toISODate(row.release_date),
  };
}

export async function trendingTop(type: string, limit = 20, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    const rows =
      hidden.length === 0
        ? await sql`
            SELECT * FROM trending_items WHERE type = ${type} ORDER BY rank ASC LIMIT ${limit}
          `
        : await sql(
            `SELECT * FROM trending_items WHERE type = $1 ${filterSQL} ORDER BY rank ASC LIMIT $2`,
            [type, limit]
          );
    return (rows as unknown as TrendingDBRow[]).map(rowToMediaItem);
  } catch {
    return [];
  }
}

// Batched UNNEST upsert — same pattern as lib/upcoming.ts's upsertUpcoming.
// Used only by app/api/cron/daily/route.ts.
const BATCH_SIZE = 200;

export async function upsertTrending(rows: TrendingRow[]): Promise<void> {
  await ensureSchema();
  const sql = db();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    await sql`
      INSERT INTO trending_items (id, type, title, overview, poster_url, backdrop_url, release_date, rank, genres, original_language)
      SELECT * FROM UNNEST(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.type)}::text[],
        ${batch.map((r) => r.title)}::text[],
        ${batch.map((r) => r.overview ?? null)}::text[],
        ${batch.map((r) => r.posterURL ?? null)}::text[],
        ${batch.map((r) => r.backdropURL ?? null)}::text[],
        ${batch.map((r) => r.releaseDate ?? null)}::date[],
        ${batch.map((r) => r.rank)}::int[],
        ${batch.map((r) => JSON.stringify(r.genres ?? []))}::jsonb[],
        ${batch.map((r) => r.originalLanguage ?? null)}::text[]
      )
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        overview = excluded.overview,
        poster_url = excluded.poster_url,
        backdrop_url = COALESCE(excluded.backdrop_url, trending_items.backdrop_url),
        release_date = excluded.release_date,
        rank = excluded.rank,
        genres = excluded.genres,
        original_language = excluded.original_language,
        updated_at = now()
    `;
  }
}

// Removes rows of `type` that weren't part of the just-finished run — a
// title that's no longer trending shouldn't linger at a stale rank forever.
export async function pruneTrending(type: string, keepIds: string[]): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`
    DELETE FROM trending_items WHERE type = ${type} AND NOT (id = ANY(${keepIds}))
  `;
}
