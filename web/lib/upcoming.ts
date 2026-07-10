import type { MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";

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
}

interface UpcomingDBRow {
  id: string;
  type: string;
  title: string;
  overview: string | null;
  poster_url: string | null;
  release_date: string | Date | null;
  date_confirmed: boolean;
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

// Confirmed-dated items first (soonest first — matches the old live shelf's
// ordering), but with a RESERVED quarter of the slots for undated-but-big
// titles (sorted by popularity/hype) — a plain "dated first, undated only if
// room's left" ordering starves them out entirely in practice: there are
// consistently more confirmed-dated entries than any reasonable limit, so
// undated blockbusters (a sequel with no date yet, years out) would never
// actually surface. Two queries unioned rather than one, so the undated
// slice is guaranteed rather than incidental. Degrades to [] on a DB error.
export async function upcomingTop(types: string[], limit = 16): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const undatedSlots = Math.max(1, Math.round(limit / 4));
    const datedSlots = limit - undatedSlots;
    const [dated, undated] = await Promise.all([
      sql`
        SELECT * FROM upcoming_items
        WHERE type = ANY(${types}) AND date_confirmed = true
        ORDER BY release_date ASC
        LIMIT ${datedSlots}
      ` as unknown as Promise<UpcomingDBRow[]>,
      sql`
        SELECT * FROM upcoming_items
        WHERE type = ANY(${types}) AND date_confirmed = false
        ORDER BY popularity_score DESC
        LIMIT ${undatedSlots}
      ` as unknown as Promise<UpcomingDBRow[]>,
    ]);
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
export async function upcomingNewest(types: string[], limit = 16): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`
      SELECT * FROM upcoming_items
      WHERE type = ANY(${types})
      ORDER BY first_seen_at DESC, popularity_score DESC
      LIMIT ${limit}
    `) as unknown as UpcomingDBRow[];
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
      INSERT INTO upcoming_items (id, type, title, overview, poster_url, release_date, date_confirmed, popularity_score)
      SELECT * FROM UNNEST(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.type)}::text[],
        ${batch.map((r) => r.title)}::text[],
        ${batch.map((r) => r.overview ?? null)}::text[],
        ${batch.map((r) => r.posterURL ?? null)}::text[],
        ${batch.map((r) => r.releaseDate ?? null)}::date[],
        ${batch.map((r) => r.dateConfirmed)}::boolean[],
        ${batch.map((r) => r.popularityScore)}::int[]
      )
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        overview = excluded.overview,
        poster_url = excluded.poster_url,
        release_date = excluded.release_date,
        date_confirmed = excluded.date_confirmed,
        popularity_score = excluded.popularity_score,
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
