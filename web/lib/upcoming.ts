import type { EpisodeInfo, ExternalLink, MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { toISODate } from "@/lib/dbDate";
import { applyReleaseDateOverrides } from "@/lib/releaseDateOverrides";
import { tvEpisodeCount } from "@/lib/catalog";

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
  // False ONLY when this row's date-correction fetch (see
  // lib/sources/tmdb.ts's filterOfficialOnly/fetchStatus) failed outright
  // this run — not when it succeeded but simply found nothing to correct.
  // Defaults true (i.e. "trust this run's date") for every row that never
  // sets it, which is every non-movie row plus movies whose fetch actually
  // succeeded — see upsertUpcoming for how this gates the write.
  dateVerified?: boolean;
  // TV only, and only ever set by the cron's followed-upcoming-shows
  // refresh (app/api/cron/daily) — { seasons, numberOfEpisodes, ... } same
  // shape as CatalogRow's metadata, so a followed-but-unreleased show can
  // show its full season schedule instead of just its premiere date.
  // Omitted (not just empty) for every other writer, which is what lets
  // upsertUpcoming's regression guard tell "this run didn't fetch episode
  // data at all" apart from "this run confirmed there are none."
  metadata?: Record<string, unknown>;
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
  metadata: unknown;
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

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "string") return value as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface UpcomingSeasonMeta {
  seasonNumber: number;
  episodes: { episode: number; title?: string; airDate?: string }[];
}

// Exported for lib/search.ts's combined catalog+upcoming query, which maps
// each UNION branch through its own table's mapper.
export function upcomingRowToMediaItem(row: UpcomingDBRow): MediaItem {
  const externalLinks = parseLinks(row.external_links);
  const metadata = parseMetadata(row.metadata);

  // Same split as catalogRowToMediaItem's tvShow branch: a followed but
  // still-unreleased show only ever gets a full season schedule here when
  // the cron's followed-upcoming-shows refresh has actually run for it
  // (see app/api/cron/daily) — most upcoming TV rows never set this at
  // all, which is fine, they just show their single premiere date.
  let episodes: EpisodeInfo[] | undefined;
  let episodeCount: number | undefined;
  if (row.type === "tvShow") {
    const seasons = (metadata.seasons as UpcomingSeasonMeta[] | undefined) ?? [];
    const flattened = seasons.flatMap((s) =>
      s.episodes.map((e) => ({ season: s.seasonNumber, episode: e.episode, title: e.title, airDate: e.airDate }))
    );
    episodes = flattened.length > 0 ? flattened : undefined;
    episodeCount = (metadata.numberOfEpisodes as number | undefined) ?? (flattened.length || undefined);
  }

  return {
    id: row.id,
    type: row.type as MediaType,
    title: row.title,
    overview: row.overview ?? undefined,
    posterURL: row.poster_url ?? undefined,
    backdropURL: row.backdrop_url ?? undefined,
    releaseDate: row.date_confirmed ? toISODate(row.release_date) : undefined,
    externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
    episodes,
    episodeCount,
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
//
// NOTE: "Popular upcoming" (the Discover shelf + its "See all" page) no
// longer reads upcoming_items live — see lib/upcomingCalendar.ts. That
// module's refreshUpcomingCalendar() (called once daily by the cron) is
// what reads upcoming_items (and catalog_items, for returning shows'
// season premieres) and materializes the precomputed upcoming_calendar
// table that getUpcomingCalendarTop/getUpcomingCalendarPage actually serve
// from. This file stays focused on upcoming_items' own write path (the
// daily ingest) and the single-item lookup above.

// Batched UNNEST upsert (same pattern as lib/catalog.ts's upsertCatalog) —
// used only by app/api/cron/daily/route.ts, never a user request path.
// first_seen_at is preserved across refreshes (excluded from the UPDATE SET)
// so it keeps meaning "when we first saw this title," not "when it was last
// refreshed" — that's what lets a future "newest announcements" view exist.
const BATCH_SIZE = 200;

export async function upsertUpcoming(rows: UpcomingRow[]): Promise<void> {
  await ensureSchema();
  const sql = db();

  // A title already in catalog_items has already released — it graduated
  // out of upcoming_items the day it dropped (see the cron route's stage
  // A/B comment) and must never come back, no matter what a source's
  // discover feed claims. This guards against exactly the bug found live:
  // TMDB's own top-level/primary_release_date for "One Piece: The Movie"
  // (id movie:19576, real release 2000-03-04) reads 2026-09-17 because a
  // Brazilian re-release listing (type 3 "Theatrical") is its only
  // future-dated release_dates entry and TMDB's aggregate field picked it —
  // with no US entry at all, the existing usTheatricalDate() correction in
  // lib/sources/tmdb.ts has nothing to override it with, so the bad date
  // flowed straight into upcoming_items and surfaced as the collection's
  // "Up next." Catalog membership is the one signal that can't be spoofed
  // by a bad regional release-date entry: it's already-ingested, confirmed
  // history.
  const ids = rows.map((r) => r.id);
  const alreadyCatalogued =
    ids.length === 0
      ? new Set<string>()
      : new Set(
          (
            (await sql`SELECT id FROM catalog_items WHERE id = ANY(${ids})`) as unknown as { id: string }[]
          ).map((r) => r.id)
        );
  const filtered = alreadyCatalogued.size === 0 ? rows : rows.filter((r) => !alreadyCatalogued.has(r.id));

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;

    // Same episode-count regression guard as upsertCatalog, and for the
    // same reason: most writers here (discoverTMDBUpcomingTV, the regular
    // "upcoming" refresh) never set metadata at all — only the cron's
    // followed-upcoming-shows refresh does. Without this, that stage's
    // work would just get overwritten back to nothing the next time the
    // regular refresh touches the same row.
    const tvIds = batch.filter((r) => r.type === "tvShow" && r.metadata).map((r) => r.id);
    const existingMetadata = new Map<string, Record<string, unknown>>();
    if (tvIds.length > 0) {
      const existing = (await sql`
        SELECT id, metadata FROM upcoming_items WHERE id = ANY(${tvIds})
      `) as unknown as { id: string; metadata: Record<string, unknown> }[];
      for (const row of existing) existingMetadata.set(row.id, row.metadata);
    }
    const metadataFor = (r: UpcomingRow): Record<string, unknown> | null => {
      if (!r.metadata) return null; // null, not {} — see ON CONFLICT below
      const old = existingMetadata.get(r.id);
      if (!old) return r.metadata;
      return tvEpisodeCount(r.metadata) < tvEpisodeCount(old) ? old : r.metadata;
    };

    await sql`
      INSERT INTO upcoming_items (id, type, title, overview, poster_url, backdrop_url, release_date, date_confirmed, popularity_score, first_seen_at, genres, original_language, external_links, date_verified, metadata)
      SELECT id, type, title, overview, poster_url, backdrop_url, release_date, date_confirmed, popularity_score, COALESCE(announced_at, now()), genres, original_language, external_links, date_verified, COALESCE(metadata, '{}'::jsonb)
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
        ${batch.map((r) => JSON.stringify(r.externalLinks ?? []))}::jsonb[],
        ${batch.map((r) => r.dateVerified ?? true)}::boolean[],
        ${batch.map((r) => {
          const m = metadataFor(r);
          return m ? JSON.stringify(m) : null;
        })}::jsonb[]
      ) AS t(id, type, title, overview, poster_url, backdrop_url, release_date, date_confirmed, popularity_score, announced_at, genres, original_language, external_links, date_verified, metadata)
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        overview = excluded.overview,
        poster_url = excluded.poster_url,
        -- COALESCE: same backdrop-preserving rule as upsertCatalog.
        backdrop_url = COALESCE(excluded.backdrop_url, upcoming_items.backdrop_url),
        -- The actual regression guard: an unverified row (this run's
        -- date-correction fetch failed outright) keeps whatever date was
        -- already stored instead of overwriting it with this run's raw,
        -- uncorrected one. A verified row always writes through as before.
        release_date = CASE WHEN excluded.date_verified THEN excluded.release_date ELSE upcoming_items.release_date END,
        date_confirmed = CASE WHEN excluded.date_verified THEN excluded.date_confirmed ELSE upcoming_items.date_confirmed END,
        popularity_score = excluded.popularity_score,
        genres = excluded.genres,
        original_language = excluded.original_language,
        external_links = excluded.external_links,
        date_verified = excluded.date_verified,
        -- NULL (this run never touched episode data) keeps whatever was
        -- already stored instead of wiping it back to '{}'.
        metadata = COALESCE(excluded.metadata, upcoming_items.metadata),
        updated_at = now()
    `;
  }
  await applyReleaseDateOverrides();
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
