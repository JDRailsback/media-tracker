import type { ExternalLink, MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { excludeHiddenSQL, type ContentCategory } from "@/lib/contentFilters";

// Row shape produced by the upcoming-releases fetchers (tmdb.ts/igdb.ts) and
// stored in upcoming_items (see lib/db.ts's ensureSchema). Distinct from
// CatalogRow — this is refreshed daily by /api/cron/daily, not a one-time
// manual ingestion, and releaseDate is meaningfully optional here (an
// announced-but-undated title is exactly what this table exists to capture).
export interface UpcomingRow {
  id: string; // e.g. "movie:603"
  type: "movie" | "tvShow" | "game";
  title: string;
  overview?: string;
  posterURL?: string;
  backdropURL?: string; // wide hero art — see MediaItem.backdropURL
  releaseDate?: string; // ISO date — only ever set when dateConfirmed is true
  dateConfirmed: boolean;
  popularityScore: number;
  // A REAL "when was this actually announced" signal, when the source
  // exposes one — currently only IGDB's own `created_at` for games (see
  // discoverIGDBUpcoming). When omitted, first_seen_at falls back to "the
  // first time OUR tracker saw this row" (see upsertUpcoming), which is a
  // weaker proxy — TMDB's discover/trending responses don't expose a real
  // announcement timestamp at all.
  announcedAt?: string;
  // Content-filter signals (see lib/contentFilters.ts) — same fields as
  // CatalogRow's, movie/TV/game only (manga never appears in upcoming_items).
  genres?: string[];
  originalLanguage?: string;
  // Pre-release "Available on" links: storefront pre-order pages for games
  // (IGDB websites), the title's TMDB page for movies/TV — watch providers
  // don't exist before release, so an info link beats an empty section.
  externalLinks?: ExternalLink[];
}

export interface UpcomingDBRow {
  id: string;
  type: string;
  title: string;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  release_date: string | Date | null;
  date_confirmed: boolean;
  popularity_score: number;
  external_links: unknown;
}

function toISODate(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

// Neon returns JSONB parsed in practice; guard against a raw string anyway
// (same defensive pattern as lib/catalog.ts's parseJSON).
function parseLinks(value: unknown): ExternalLink[] {
  if (value == null) return [];
  if (typeof value !== "string") return value as ExternalLink[];
  try {
    return JSON.parse(value) as ExternalLink[];
  } catch {
    return [];
  }
}

// Exported for lib/search.ts's combined catalog+upcoming query, which maps
// each UNION branch through its own table's mapper.
export function upcomingRowToMediaItem(row: UpcomingDBRow): MediaItem {
  const externalLinks = parseLinks(row.external_links);
  return {
    id: row.id,
    type: row.type as MediaType,
    title: row.title,
    overview: row.overview ?? undefined,
    posterURL: row.poster_url ?? undefined,
    backdropURL: row.backdrop_url ?? undefined,
    releaseDate: row.date_confirmed ? toISODate(row.release_date) : undefined,
    externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
  };
}

// Single-row lookup, the upcoming_items counterpart of getCatalogItem —
// used by details() (lib/sources/index.ts) as a fallback when an id isn't
// in catalog_items. A followed UPCOMING title (GTA VI, an unreleased movie)
// lives only in this table until it releases and graduates to the catalog;
// without this lookup, following one worked but every later resolution of
// it (Home feed refresh, detail modal, poll notifications) 404'd — verified
// live, exactly why followed movies/games vanished from the Home page.
export async function getUpcomingItem(id: string): Promise<MediaItem | null> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`SELECT * FROM upcoming_items WHERE id = ${id}`) as unknown as UpcomingDBRow[];
    return rows[0] ? upcomingRowToMediaItem(rows[0]) : null;
  } catch {
    return null;
  }
}

// NOTE: search over upcoming_items lives in lib/search.ts now — one
// UNION ALL round trip with catalog_items instead of a separate query per
// table (Neon's HTTP driver pays ~50-150ms per round trip).

// "Popular upcoming" — popularity decides WHICH titles qualify, release date
// decides the ORDER they're shown in. Two different jobs: selection and
// display. Earlier versions conflated them (either sorted the whole list by
// popularity — GTA VI first regardless of it releasing months out — or
// sorted the whole list by date — a low-buzz title releasing next week
// buried GTA VI). Neither is what "Popular upcoming" should mean: it's a
// radar of the BIG stuff, in the order it's actually arriving. So: pull a
// pool of the most popular dated titles (POOL_MULTIPLIER larger than the
// display limit, so the date-sort has real candidates to work with, not
// just the single most-popular item), then sort THAT pool chronologically.
// Undated-but-big titles get a reserved slice (no date to sort by, so they
// stay popularity-ordered) appended after the dated ones — guaranteed
// visibility without disrupting the calendar ordering of what has a date.
const POOL_MULTIPLIER = 5;
const MIN_POOL_SIZE = 60;

export async function upcomingTop(types: string[], limit = 16, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    const undatedSlots = Math.max(1, Math.round(limit / 4));
    const datedSlots = limit - undatedSlots;
    const poolSize = Math.max(datedSlots * POOL_MULTIPLIER, MIN_POOL_SIZE);
    const [dated, undated] =
      hidden.length === 0
        ? await Promise.all([
            sql`
              SELECT * FROM (
                SELECT * FROM upcoming_items WHERE type = ANY(${types}) AND date_confirmed = true
                ORDER BY popularity_score DESC LIMIT ${poolSize}
              ) pool
              ORDER BY release_date ASC LIMIT ${datedSlots}
            ` as unknown as Promise<UpcomingDBRow[]>,
            sql`
              SELECT * FROM upcoming_items
              WHERE type = ANY(${types}) AND date_confirmed = false
              ORDER BY popularity_score DESC
              LIMIT ${undatedSlots}
            ` as unknown as Promise<UpcomingDBRow[]>,
          ])
        : await Promise.all([
            sql(
              `SELECT * FROM (
                 SELECT * FROM upcoming_items WHERE type = ANY($1) AND date_confirmed = true ${filterSQL}
                 ORDER BY popularity_score DESC LIMIT $2
               ) pool ORDER BY release_date ASC LIMIT $3`,
              [types, poolSize, datedSlots]
            ) as unknown as Promise<UpcomingDBRow[]>,
            sql(
              `SELECT * FROM upcoming_items WHERE type = ANY($1) AND date_confirmed = false ${filterSQL}
               ORDER BY popularity_score DESC LIMIT $2`,
              [types, undatedSlots]
            ) as unknown as Promise<UpcomingDBRow[]>,
          ]);
    // Dated (chronological) first, undated (popularity) after — NOT
    // re-sorted together, that would undo the chronological ordering.
    return [...dated, ...undated].map(upcomingRowToMediaItem);
  } catch {
    return [];
  }
}

// Batched UNNEST upsert (same pattern as lib/catalog.ts's upsertCatalog) —
// used only by app/api/cron/daily/route.ts, never a user request path.
// first_seen_at is preserved across refreshes (excluded from the UPDATE SET)
// so it keeps meaning "when we first saw this title," not "when it was last
// refreshed" — that's what lets a future "newest announcements" view exist.
const BATCH_SIZE = 200;

export async function upsertUpcoming(rows: UpcomingRow[]): Promise<void> {
  await ensureSchema();
  const sql = db();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    await sql`
      INSERT INTO upcoming_items (id, type, title, overview, poster_url, backdrop_url, release_date, date_confirmed, popularity_score, first_seen_at, genres, original_language, external_links)
      SELECT id, type, title, overview, poster_url, backdrop_url, release_date, date_confirmed, popularity_score, COALESCE(announced_at, now()), genres, original_language, external_links
      FROM UNNEST(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.type)}::text[],
        ${batch.map((r) => r.title)}::text[],
        ${batch.map((r) => r.overview ?? null)}::text[],
        ${batch.map((r) => r.posterURL ?? null)}::text[],
        ${batch.map((r) => r.backdropURL ?? null)}::text[],
        ${batch.map((r) => r.releaseDate ?? null)}::date[],
        ${batch.map((r) => r.dateConfirmed)}::boolean[],
        ${batch.map((r) => r.popularityScore)}::int[],
        ${batch.map((r) => r.announcedAt ?? null)}::timestamptz[],
        ${batch.map((r) => JSON.stringify(r.genres ?? []))}::jsonb[],
        ${batch.map((r) => r.originalLanguage ?? null)}::text[],
        ${batch.map((r) => JSON.stringify(r.externalLinks ?? []))}::jsonb[]
      ) AS t(id, type, title, overview, poster_url, backdrop_url, release_date, date_confirmed, popularity_score, announced_at, genres, original_language, external_links)
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        overview = excluded.overview,
        poster_url = excluded.poster_url,
        -- COALESCE: same backdrop-preserving rule as upsertCatalog.
        backdrop_url = COALESCE(excluded.backdrop_url, upcoming_items.backdrop_url),
        release_date = excluded.release_date,
        date_confirmed = excluded.date_confirmed,
        popularity_score = excluded.popularity_score,
        genres = excluded.genres,
        original_language = excluded.original_language,
        external_links = excluded.external_links,
        updated_at = now()
    `;
  }
}

// Removes rows of `type` that weren't part of the just-finished run — a
// title that released, got cancelled, or dropped below the popularity/hype
// threshold shouldn't linger in the table forever. Scoped by `type` so a
// run of one type never touches another's rows.
export async function pruneUpcoming(type: string, keepIds: string[]): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`
    DELETE FROM upcoming_items WHERE type = ${type} AND NOT (id = ANY(${keepIds}))
  `;
}
