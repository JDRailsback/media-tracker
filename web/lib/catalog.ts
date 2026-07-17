import type { EpisodeInfo, ExternalLink, MediaItem, MediaType, ReleaseGroupInfo } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import type { RankedItem } from "@/lib/sources/textMatch";
import { excludeHiddenSQL, type ContentCategory } from "@/lib/contentFilters";

// Shared row shape for the bulk-populated catalog_items table (see
// scripts/ingest-catalog.ts and lib/db.ts's ensureSchema). Distinct from
// MediaItem/RankedItem — those are tuned for live search relevance/ranking,
// this is just "what a catalog row looks like on the way into Postgres."
export interface CatalogRow {
  id: string; // e.g. "movie:603" — matches MediaItem.id's format
  type: "movie" | "tvShow" | "game" | "manga" | "artist";
  title: string;
  overview?: string;
  posterURL?: string;
  backdropURL?: string; // wide hero art — see MediaItem.backdropURL
  releaseDate?: string; // ISO date
  popularityScore: number; // vote_count / total_rating_count / follows — see each adapter
  genres: string[];
  // Real, direct platform links ONLY (streaming provider, storefront, buy/read
  // link) — deliberately never a fallback to the source's OWN catalog page
  // (TMDB/IGDB/MangaDex), unlike the live single-item detail views. An empty
  // array means no direct platform link is known, not "link to the source instead."
  externalLinks?: ExternalLink[];
  metadata?: Record<string, unknown>;
  // Franchise/studio/keyword identifiers (e.g. "star wars collection",
  // "walt disney pictures") — a superset of genres, used ONLY for collection
  // matching (see scripts/rebuild-collections.ts), never shown in the UI.
  tags?: string[];
  // TMDB's ISO 639-1 original-language code ("ja", "ko", "en", ...) — movies
  // and TV only, never set for game/manga rows. Used ONLY by
  // lib/contentFilters.ts (e.g. "anime" = Animation genre + "ja"), never
  // shown in the UI.
  originalLanguage?: string;
}

// ---------- Write path: shared by the manual ingest script and the daily cron ----------

// Batched via UNNEST so a 10,000-row fetch is a handful of round trips to
// Neon, not one per row. Used by scripts/ingest-catalog.ts (manual bulk
// ingest) and app/api/cron/daily/route.ts (daily recent-releases refresh) —
// the catalog is append-only, so both paths only ever insert/update, never
// prune.
const UPSERT_BATCH_SIZE = 200;

export async function upsertCatalog(rows: CatalogRow[], onBatch?: (done: number, total: number) => void): Promise<void> {
  await ensureSchema();
  const sql = db();
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    if (batch.length === 0) continue;
    await sql`
      INSERT INTO catalog_items (id, type, title, overview, poster_url, backdrop_url, release_date, popularity_score, genres, external_links, metadata, tags, original_language)
      SELECT * FROM UNNEST(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.type)}::text[],
        ${batch.map((r) => r.title)}::text[],
        ${batch.map((r) => r.overview ?? null)}::text[],
        ${batch.map((r) => r.posterURL ?? null)}::text[],
        ${batch.map((r) => r.backdropURL ?? null)}::text[],
        ${batch.map((r) => r.releaseDate ?? null)}::date[],
        ${batch.map((r) => r.popularityScore)}::int[],
        ${batch.map((r) => JSON.stringify(r.genres))}::jsonb[],
        ${batch.map((r) => JSON.stringify(r.externalLinks ?? []))}::jsonb[],
        ${batch.map((r) => JSON.stringify(r.metadata ?? {}))}::jsonb[],
        ${batch.map((r) => JSON.stringify(r.tags ?? []))}::jsonb[],
        ${batch.map((r) => r.originalLanguage ?? null)}::text[]
      )
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        overview = excluded.overview,
        poster_url = excluded.poster_url,
        -- COALESCE: a refresh that didn't carry a backdrop (older write path,
        -- source omitted it this run) must not wipe one captured earlier.
        backdrop_url = COALESCE(excluded.backdrop_url, catalog_items.backdrop_url),
        release_date = excluded.release_date,
        popularity_score = excluded.popularity_score,
        genres = excluded.genres,
        external_links = excluded.external_links,
        metadata = excluded.metadata,
        tags = excluded.tags,
        original_language = excluded.original_language,
        updated_at = now()
    `;
    onBatch?.(Math.min(i + UPSERT_BATCH_SIZE, rows.length), rows.length);
  }
}

// ---------- Read path: the app's ONLY source of search/discover/details data ----------
// No live TMDB/IGDB/MangaDex calls anywhere in the app right now — every read
// here degrades to empty/null on a DB error rather than throwing, so a
// hiccup shows "no results" instead of a 500.

// Exported for lib/search.ts's combined catalog+upcoming query, which maps
// each UNION branch through its own table's mapper.
export interface CatalogDBRow {
  id: string;
  type: string;
  title: string;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  release_date: string | Date | null;
  popularity_score: number;
  genres: unknown;
  external_links: unknown;
  metadata: unknown;
}

// Neon's driver returns JSONB columns already parsed in practice, but this
// guards against a raw string coming back (same defensive pattern as
// lib/sources/collection.ts's parseJSON).
function parseJSON<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toISODate(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

interface CatalogSeasonMeta {
  seasonNumber: number;
  episodes: { episode: number; title?: string; airDate?: string }[];
}

export function catalogRowToMediaItem(row: CatalogDBRow): MediaItem {
  const type = row.type as MediaType;
  const metadata = parseJSON<Record<string, unknown>>(row.metadata, {});
  const externalLinks = parseJSON<ExternalLink[]>(row.external_links, []);

  let subtitle: string | undefined;
  let episodes: EpisodeInfo[] | undefined;
  let episodeCount: number | undefined;
  let releases: ReleaseGroupInfo[] | undefined;
  let releaseDate: string | undefined = toISODate(row.release_date);

  if (type === "artist") {
    // Same read-time split as the tvShow branch below: releaseDate means
    // "next upcoming release" for an artist (the thing the Home feed and
    // poll notifications track), never their latest past album — that lives
    // in the stored release_date column and the discography list. The
    // discography is stored newest-first (see lib/sources/artist.ts).
    const discography = (metadata.discography as ReleaseGroupInfo[] | undefined) ?? [];
    releases = discography.length > 0 ? discography : undefined;

    const todayISO = new Date().toISOString().slice(0, 10);
    const next = discography
      .filter((r) => r.date && r.date >= todayISO)
      .sort((a, b) => (a.date! < b.date! ? -1 : 1))[0];

    const KIND_LABEL: Record<ReleaseGroupInfo["kind"], string> = { album: "Album", ep: "EP", single: "Single" };
    if (next) {
      subtitle = `${KIND_LABEL[next.kind]} — ${next.title}`;
      releaseDate = next.date;
    } else {
      // Nothing announced — no releaseDate: correctly absent from the Home
      // feed (nothing new to report), still listed under Following.
      subtitle = undefined;
      releaseDate = undefined;
    }
  }

  if (type === "tvShow") {
    const seasons = (metadata.seasons as CatalogSeasonMeta[] | undefined) ?? [];
    const flattened = seasons.flatMap((s) =>
      s.episodes.map((e) => ({ season: s.seasonNumber, episode: e.episode, title: e.title, airDate: e.airDate }))
    );
    episodes = flattened.length > 0 ? flattened : undefined;
    episodeCount = (metadata.numberOfEpisodes as number | undefined) ?? (flattened.length || undefined);

    // releaseDate means "next episode airing" for a TV show everywhere else
    // in the app (matches the old live mapShow in tmdb.ts) — never the
    // show's ORIGINAL first-air-date, which isn't the same thing and would
    // misread as an upcoming release. The catalog only knows about episodes
    // as of its last ingest/refresh touch, so this can lag a show on a long
    // hiatus — same self-healing tradeoff accepted for collection membership.
    const todayISO = new Date().toISOString().slice(0, 10);
    const next = flattened
      .filter((e) => e.airDate && e.airDate >= todayISO)
      .sort((a, b) => (a.airDate! < b.airDate! ? -1 : 1))[0];

    // Fallback to TMDB's own next_episode_to_air (see tvExtra in tmdb.ts) —
    // occasionally populated even when the full season/episode list scan
    // above finds nothing (e.g. a season's episode-level dates aren't fully
    // announced yet, but TMDB still knows the premiere date). Verified
    // live this is frequently null too for a show genuinely between
    // seasons — that's a real TMDB data gap neither signal can fill, not a
    // bug in either extraction path.
    const rawNext = metadata.nextEpisodeToAir as
      | { season: number; episode: number; airDate: string }
      | undefined;
    const fallbackNext = rawNext && rawNext.airDate >= todayISO ? rawNext : undefined;

    const chosen = next ?? fallbackNext;
    if (chosen) {
      subtitle = `S${chosen.season} E${chosen.episode}`;
      releaseDate = chosen.airDate;
    } else {
      // No known next episode — fall back to the show's status (matches the
      // old live adapter's fallback), and no releaseDate: nothing upcoming.
      subtitle = (metadata.status as string | undefined) ?? undefined;
      releaseDate = undefined;
    }
  }

  return {
    id: row.id,
    type,
    title: row.title,
    subtitle,
    overview: row.overview ?? undefined,
    posterURL: row.poster_url ?? undefined,
    backdropURL: row.backdrop_url ?? undefined,
    releaseDate,
    externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
    episodes,
    episodeCount,
    releases,
  };
}

// Word-prefix tsquery, e.g. "toy story" -> "toy:* & story:*" — matches
// partial/still-typing input against the generated search_vector column
// (see lib/db.ts). Stripped to plain alphanumeric tokens so arbitrary input
// can never produce an invalid tsquery. Returns null for an empty/unsafe
// query so callers can treat that as "no catalog results" uniformly.
export function buildPrefixQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}

export async function searchCatalog(
  query: string,
  type?: string,
  limit = 40,
  hidden: ContentCategory[] = []
): Promise<MediaItem[]> {
  const tsq = buildPrefixQuery(query);
  if (!tsq) return [];
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    // The common case (no filter) keeps the plain tagged-template form;
    // filtering switches to the raw string+params form since filterSQL is a
    // raw SQL fragment (see lib/contentFilters.ts) that a tagged template
    // can't interpolate as syntax, only as a parameter value.
    const rows =
      hidden.length === 0
        ? type
          ? await sql`
              SELECT * FROM catalog_items
              WHERE type = ${type} AND search_vector @@ to_tsquery('english', ${tsq})
              ORDER BY ts_rank(search_vector, to_tsquery('english', ${tsq})) DESC, popularity_score DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT * FROM catalog_items
              WHERE search_vector @@ to_tsquery('english', ${tsq})
              ORDER BY ts_rank(search_vector, to_tsquery('english', ${tsq})) DESC, popularity_score DESC
              LIMIT ${limit}
            `
        : type
        ? await sql(
            `SELECT * FROM catalog_items WHERE type = $1 AND search_vector @@ to_tsquery('english', $2) ${filterSQL}
             ORDER BY ts_rank(search_vector, to_tsquery('english', $2)) DESC, popularity_score DESC LIMIT $3`,
            [type, tsq, limit]
          )
        : await sql(
            `SELECT * FROM catalog_items WHERE search_vector @@ to_tsquery('english', $1) ${filterSQL}
             ORDER BY ts_rank(search_vector, to_tsquery('english', $1)) DESC, popularity_score DESC LIMIT $2`,
            [tsq, limit]
          );
    return (rows as unknown as CatalogDBRow[]).map(catalogRowToMediaItem);
  } catch {
    return [];
  }
}

// Same as searchCatalog, but keeps popularity_score around as a RankedItem —
// used only by lib/sources/collection.ts, which still needs a real
// popularity signal to build a collection's cross-type "Most Popular" row.
// `significant` is unconditionally true: every catalog row already cleared
// a popularity bar at ingestion time, so there's no live per-item
// significance check left to make (see the elevated-bar rationale in the
// old adapter-level search functions, which no longer run in the app).
export async function searchCatalogRanked(query: string, type: string, limit = 100): Promise<RankedItem[]> {
  const tsq = buildPrefixQuery(query);
  if (!tsq) return [];
  try {
    await ensureSchema();
    const sql = db();
    const rows = await sql`
      SELECT * FROM catalog_items
      WHERE type = ${type} AND search_vector @@ to_tsquery('english', ${tsq})
      ORDER BY ts_rank(search_vector, to_tsquery('english', ${tsq})) DESC, popularity_score DESC
      LIMIT ${limit}
    `;
    return (rows as unknown as CatalogDBRow[]).map((row) => ({
      ...catalogRowToMediaItem(row),
      significant: true,
      popularity: row.popularity_score,
    }));
  } catch {
    return [];
  }
}

export async function catalogTop(type: string, limit = 20, hidden: ContentCategory[] = []): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    const rows =
      hidden.length === 0
        ? await sql`
            SELECT * FROM catalog_items WHERE type = ${type} ORDER BY popularity_score DESC LIMIT ${limit}
          `
        : await sql(
            `SELECT * FROM catalog_items WHERE type = $1 ${filterSQL} ORDER BY popularity_score DESC LIMIT $2`,
            [type, limit]
          );
    return (rows as unknown as CatalogDBRow[]).map(catalogRowToMediaItem);
  } catch {
    return [];
  }
}

// Titles released within the last `windowDays` — the "New releases" Discover
// shelf. Fed by the daily cron's recent-releases ingest (see
// app/api/cron/daily/route.ts), so this window is exactly the slice of the
// catalog that refreshes every day. Ordered by recency rather than raw
// popularity_score because the score scales differ wildly across types
// (vote_count vs total_rating_count vs follows) — mixing types on raw score
// would just rank whole media types against each other.
export async function recentReleases(
  types: string[],
  limit = 16,
  windowDays = 30,
  hidden: ContentCategory[] = []
): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden);
    const rows =
      hidden.length === 0
        ? await sql`
            SELECT * FROM catalog_items
            WHERE type = ANY(${types})
              AND release_date <= now()::date
              AND release_date >= now()::date - ${windowDays}::int
            ORDER BY release_date DESC, popularity_score DESC
            LIMIT ${limit}
          `
        : await sql(
            `SELECT * FROM catalog_items
             WHERE type = ANY($1) AND release_date <= now()::date AND release_date >= now()::date - $2::int
             ${filterSQL}
             ORDER BY release_date DESC, popularity_score DESC LIMIT $3`,
            [types, windowDays, limit]
          );
    return (rows as unknown as CatalogDBRow[]).map(catalogRowToMediaItem);
  } catch {
    return [];
  }
}

export async function getCatalogItem(id: string): Promise<MediaItem | null> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = await sql`SELECT * FROM catalog_items WHERE id = ${id}`;
    const row = (rows as unknown as CatalogDBRow[])[0];
    return row ? catalogRowToMediaItem(row) : null;
  } catch {
    return null;
  }
}

// A collection's precomputed members (see scripts/rebuild-collections.ts) —
// used by lib/sources/collection.ts's resolveCollection, which replaced its
// old live per-request search with a read of collection_items. Kept as
// RankedItem (not MediaItem) for the same reason searchCatalogRanked is —
// resolveCollection still needs a real popularity signal to build a
// collection's cross-type "Most Popular" row.
export async function getCollectionItems(slug: string): Promise<RankedItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = await sql`
      SELECT catalog_items.* FROM collection_items
      JOIN catalog_items ON catalog_items.id = collection_items.item_id
      WHERE collection_items.collection_slug = ${slug}
    `;
    return (rows as unknown as CatalogDBRow[]).map((row) => ({
      ...catalogRowToMediaItem(row),
      significant: true,
      popularity: row.popularity_score,
    }));
  } catch {
    return [];
  }
}
