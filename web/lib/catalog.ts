import type { EpisodeInfo, ExternalLink, MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import type { RankedItem } from "@/lib/sources/textMatch";

// Shared row shape for the bulk-populated catalog_items table (see
// scripts/ingest-catalog.ts and lib/db.ts's ensureSchema). Distinct from
// MediaItem/RankedItem — those are tuned for live search relevance/ranking,
// this is just "what a catalog row looks like on the way into Postgres."
export interface CatalogRow {
  id: string; // e.g. "movie:603" — matches MediaItem.id's format
  type: "movie" | "tvShow" | "game" | "manga";
  title: string;
  overview?: string;
  posterURL?: string;
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
}

// ---------- Read path: the app's ONLY source of search/discover/details data ----------
// No live TMDB/IGDB/MangaDex calls anywhere in the app right now — every read
// here degrades to empty/null on a DB error rather than throwing, so a
// hiccup shows "no results" instead of a 500.

interface CatalogDBRow {
  id: string;
  type: string;
  title: string;
  overview: string | null;
  poster_url: string | null;
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

  if (type === "tvShow") {
    const seasons = (metadata.seasons as CatalogSeasonMeta[] | undefined) ?? [];
    const flattened = seasons.flatMap((s) =>
      s.episodes.map((e) => ({ season: s.seasonNumber, episode: e.episode, title: e.title, airDate: e.airDate }))
    );
    episodes = flattened.length > 0 ? flattened : undefined;
    episodeCount = (metadata.numberOfEpisodes as number | undefined) ?? (flattened.length || undefined);
    // Matches the live adapter's own fallback (mapShow in tmdb.ts) for a show
    // with no known next episode — the catalog is a point-in-time snapshot,
    // so it can't know about episodes airing after ingestion.
    subtitle = (metadata.status as string | undefined) ?? undefined;
  }

  return {
    id: row.id,
    type,
    title: row.title,
    subtitle,
    overview: row.overview ?? undefined,
    posterURL: row.poster_url ?? undefined,
    // For a TV show, releaseDate means "next episode airing" everywhere
    // else in the app (see mapShow in tmdb.ts) — the catalog only has the
    // show's ORIGINAL first-air-date, which isn't the same thing and would
    // misread as an upcoming release. Left undefined for tvShow; every
    // other type's release_date is the real release date.
    releaseDate: type === "tvShow" ? undefined : toISODate(row.release_date),
    externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
    episodes,
    episodeCount,
  };
}

// Word-prefix tsquery, e.g. "toy story" -> "toy:* & story:*" — matches
// partial/still-typing input against the generated search_vector column
// (see lib/db.ts). Stripped to plain alphanumeric tokens so arbitrary input
// can never produce an invalid tsquery. Returns null for an empty/unsafe
// query so callers can treat that as "no catalog results" uniformly.
function buildPrefixQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}

export async function searchCatalog(query: string, type?: string, limit = 40): Promise<MediaItem[]> {
  const tsq = buildPrefixQuery(query);
  if (!tsq) return [];
  try {
    await ensureSchema();
    const sql = db();
    const rows = type
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
        `;
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

export async function catalogTop(type: string, limit = 20): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = await sql`
      SELECT * FROM catalog_items WHERE type = ${type} ORDER BY popularity_score DESC LIMIT ${limit}
    `;
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
