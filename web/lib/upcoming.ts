import type { MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { excludeHiddenSQL, type ContentCategory } from "@/lib/contentFilters";
import { buildPrefixQuery } from "@/lib/catalog";

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
}

interface UpcomingDBRow {
  id: string;
  type: string;
  title: string;
  overview: string | null;
  poster_url: string | null;
  release_date: string | Date | null;
  date_confirmed: boolean;
  popularity_score: number;
}

function toISODate(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function rowToMediaItem(row: UpcomingDBRow): MediaItem {
  return {
    id: row.id,
    type: row.type as MediaType,
    title: row.title,
    overview: row.overview ?? undefined,
    posterURL: row.poster_url ?? undefined,
    releaseDate: row.date_confirmed ? toISODate(row.release_date) : undefined,
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
    return rows[0] ? rowToMediaItem(rows[0]) : null;
  } catch {
    return null;
  }
}

// Search previously only covered catalog_items (already-released titles) —
// an upcoming/announced title (Avengers: Doomsday, GTA VI, ...) was
// unfindable through the search bar no matter how big it was, only
// reachable via the Discover shelves. upcoming_items already has its own
// generated search_vector (see lib/db.ts), so this is the same word-prefix
// full-text pattern searchCatalog uses, just against the other table.
// Deliberately no popularity gate — "vast" per the user's directive; a
// search should find a real, officially-confirmed title regardless of how
// much current buzz it has.
export async function searchUpcoming(
  query: string,
  types: string[] = ["movie", "tvShow", "game"],
  limit = 20,
  hidden: ContentCategory[] = []
): Promise<MediaItem[]> {
  const tsq = buildPrefixQuery(query);
  if (!tsq) return [];
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    const rows = (
      hidden.length === 0
        ? await sql`
            SELECT * FROM upcoming_items
            WHERE type = ANY(${types}) AND search_vector @@ to_tsquery('english', ${tsq})
            ORDER BY ts_rank(search_vector, to_tsquery('english', ${tsq})) DESC, popularity_score DESC
            LIMIT ${limit}
          `
        : await sql(
            `SELECT * FROM upcoming_items WHERE type = ANY($1) AND search_vector @@ to_tsquery('english', $2) ${filterSQL}
             ORDER BY ts_rank(search_vector, to_tsquery('english', $2)) DESC, popularity_score DESC LIMIT $3`,
            [types, tsq, limit]
          )
    ) as unknown as UpcomingDBRow[];
    return rows.map(rowToMediaItem);
  } catch {
    return [];
  }
}

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
    return [...dated, ...undated].map(rowToMediaItem);
  } catch {
    return [];
  }
}

// Newest announcements first — the "Just announced" Discover shelf.
// first_seen_at is set once and preserved across refreshes (see
// upsertUpcoming), so it genuinely means "when this title first appeared in
// any source feed." Caveat: every row present when the table was first
// seeded shares that seed timestamp, so for the first few days this is
// effectively popularity-ordered; it becomes a real announcement timeline
// as daily runs discover new titles. Degrades to [] on a DB error.
//
// popularity_score >= 5 here specifically — verified live against the real
// distribution: the underlying table is deliberately NOT popularity-gated
// at admission (see tmdb.ts), and a `> 0` floor still let through a flood of
// score-1-to-4 noise (1,274 titles clustered at the same first_seen_at from
// a single admission-criteria change) ahead of anything recognizable. 5 is
// the real breakpoint where genuine titles start appearing (e.g. "Sonic the
// Hedgehog 4", an Elden Ring adaptation) — chosen from the actual data, not
// guessed. This Discover shelf is exactly the kind of surface the user said
// a popularity filter belongs on — the table itself, and search, stay
// unfiltered.
const JUST_ANNOUNCED_MIN_POPULARITY = 5;

export async function upcomingNewest(types: string[], limit = 16, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    const rows = (
      hidden.length === 0
        ? await sql`
            SELECT * FROM upcoming_items
            WHERE type = ANY(${types}) AND popularity_score >= ${JUST_ANNOUNCED_MIN_POPULARITY}
            ORDER BY first_seen_at DESC, popularity_score DESC
            LIMIT ${limit}
          `
        : await sql(
            `SELECT * FROM upcoming_items WHERE type = ANY($1) AND popularity_score >= $3 ${filterSQL}
             ORDER BY first_seen_at DESC, popularity_score DESC LIMIT $2`,
            [types, limit, JUST_ANNOUNCED_MIN_POPULARITY]
          )
    ) as unknown as UpcomingDBRow[];
    return rows.map(rowToMediaItem);
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
      INSERT INTO upcoming_items (id, type, title, overview, poster_url, release_date, date_confirmed, popularity_score, first_seen_at, genres, original_language)
      SELECT id, type, title, overview, poster_url, release_date, date_confirmed, popularity_score, COALESCE(announced_at, now()), genres, original_language
      FROM UNNEST(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.type)}::text[],
        ${batch.map((r) => r.title)}::text[],
        ${batch.map((r) => r.overview ?? null)}::text[],
        ${batch.map((r) => r.posterURL ?? null)}::text[],
        ${batch.map((r) => r.releaseDate ?? null)}::date[],
        ${batch.map((r) => r.dateConfirmed)}::boolean[],
        ${batch.map((r) => r.popularityScore)}::int[],
        ${batch.map((r) => r.announcedAt ?? null)}::timestamptz[],
        ${batch.map((r) => JSON.stringify(r.genres ?? []))}::jsonb[],
        ${batch.map((r) => r.originalLanguage ?? null)}::text[]
      ) AS t(id, type, title, overview, poster_url, release_date, date_confirmed, popularity_score, announced_at, genres, original_language)
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        overview = excluded.overview,
        poster_url = excluded.poster_url,
        release_date = excluded.release_date,
        date_confirmed = excluded.date_confirmed,
        popularity_score = excluded.popularity_score,
        genres = excluded.genres,
        original_language = excluded.original_language,
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
