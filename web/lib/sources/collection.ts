import type { MediaItem, MediaType } from "@/lib/types";
import { COLLECTIONS, CollectionDef, CollectionQueries, getCollection } from "@/lib/collections";
import { db, ensureSchema } from "@/lib/db";
import { getCollectionItems } from "@/lib/catalog";
import { matchTier, fuzzyMatches, normalizedScores, RankedItem, stripRanking } from "./textMatch";

// Deliberately does NOT import from ./index.ts — index.ts imports FROM this
// file (to wire up the "franchise" case in search()/details()), so importing
// back would create a cycle. Everything this module needs (the raw per-
// source search functions, MediaItem, textMatch helpers) lives one level
// below index.ts, not inside it.

// A manually pinned title — added through the editor to force-include
// something the curated queries don't find on their own (see IncludedPart
// below). Kept minimal (just what a card/row needs to render), not a full
// MediaItem, since it's hand-entered rather than fetched.
export interface IncludedPart {
  id: string;
  // Collections group movie/TV/game/manga parts only — never another
  // franchise, and not music artists (a person, not a titled work).
  type: Exclude<MediaType, "franchise" | "artist">;
  title: string;
  posterURL?: string;
  releaseDate?: string;
  overview?: string;
}

// The fully-resolved definition used everywhere at runtime — a plain
// CollectionDef (from the static seed list) if never edited, or the complete
// replacement row from collection_overrides if it has been. `isCustom` marks
// a collection created entirely through the editor, with no static fallback
// to revert to.
export interface EffectiveCollection {
  slug: string;
  name: string;
  tagline: string;
  theme: { primary: string; secondary: string };
  queries: CollectionQueries;
  movieCollectionId?: number;
  featured: boolean;
  posterURL?: string;
  bannerURL?: string;
  // A big wordmark/brand logo, shown large at the top of the detail page
  // hero INSTEAD of the plain text name — override-only, same as
  // posterURL/bannerURL, since the curated seed list doesn't ship official
  // logo art (licensing), only what someone adds through the editor.
  logoURL?: string;
  includeOverrides: IncludedPart[];
  excludeIds: string[];
  isCustom: boolean;
  // Mirrors CollectionDef.collectionType — preserved from the static seed
  // even when a DB override row exists (see getEffectiveCollection).
  collectionType?: "thematic";
}

interface OverrideRow {
  slug: string;
  name: string;
  tagline: string | null;
  theme_primary: string;
  theme_secondary: string;
  poster_url: string | null;
  banner_url: string | null;
  logo_url: string | null;
  queries: CollectionQueries | string;
  movie_collection_id: number | null;
  featured: boolean;
  include_overrides: IncludedPart[] | string;
  exclude_ids: string[] | string;
  is_custom: boolean;
}

// Neon's driver returns JSONB columns already parsed in practice, but this
// guards against a raw string coming back (e.g. a future driver change)
// rather than throwing and breaking the whole collection system over it.
function parseJSON<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function defToEffective(def: CollectionDef): EffectiveCollection {
  return {
    slug: def.slug,
    name: def.name,
    tagline: def.tagline,
    theme: def.theme,
    queries: def.queries,
    movieCollectionId: def.movieCollectionId,
    featured: !!def.featured,
    collectionType: def.collectionType,
    includeOverrides: [],
    excludeIds: [],
    isCustom: false,
  };
}

function rowToEffective(row: OverrideRow): EffectiveCollection {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline ?? "",
    theme: { primary: row.theme_primary, secondary: row.theme_secondary },
    queries: parseJSON(row.queries, {} as CollectionQueries),
    movieCollectionId: row.movie_collection_id ?? undefined,
    featured: row.featured,
    posterURL: row.poster_url ?? undefined,
    bannerURL: row.banner_url ?? undefined,
    logoURL: row.logo_url ?? undefined,
    includeOverrides: parseJSON(row.include_overrides, []),
    excludeIds: parseJSON(row.exclude_ids, []),
    isCustom: row.is_custom,
  };
}

// A DB read on every search/browse/resolve is a real cost this system didn't
// have before (see docs/DISCOVER_AND_SEARCH.md) — accepted deliberately so
// edits made through the editor show up immediately everywhere, with no
// stale-cache window. Degrades gracefully (falls back to the static list) if
// DATABASE_URL isn't configured or the DB is briefly unreachable, rather than
// breaking search/browse/follow entirely over an admin-editing feature.
async function loadOverrideRow(slug: string): Promise<OverrideRow | null> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = await sql`SELECT * FROM collection_overrides WHERE slug = ${slug}`;
    return (rows[0] as OverrideRow | undefined) ?? null;
  } catch {
    return null;
  }
}

async function loadAllOverrides(): Promise<OverrideRow[]> {
  try {
    await ensureSchema();
    const sql = db();
    return (await sql`SELECT * FROM collection_overrides`) as unknown as OverrideRow[];
  } catch {
    return [];
  }
}

export async function getEffectiveCollection(slug: string): Promise<EffectiveCollection | null> {
  const row = await loadOverrideRow(slug);
  if (row) {
    const effective = rowToEffective(row);
    // collectionType is a static property of the seed data, not an editable
    // field — preserve it from the static def even when a DB override exists.
    const staticDef = getCollection(slug);
    if (staticDef?.collectionType) effective.collectionType = staticDef.collectionType;
    return effective;
  }
  const def = getCollection(slug);
  return def ? defToEffective(def) : null;
}

// The merged list used by search and Discover browsing: every static
// collection (with its override applied, if any) plus any brand-new custom
// collections created entirely through the editor.
export async function effectiveCollections(): Promise<EffectiveCollection[]> {
  const overrides = await loadAllOverrides();
  const overrideBySlug = new Map(overrides.map((r) => [r.slug, r]));
  const merged = COLLECTIONS.map((def) => {
    const row = overrideBySlug.get(def.slug);
    return row ? rowToEffective(row) : defToEffective(def);
  });
  const staticSlugs = new Set(COLLECTIONS.map((f) => f.slug));
  for (const row of overrides) {
    if (!staticSlugs.has(row.slug)) merged.push(rowToEffective(row));
  }
  return merged;
}

function toSummary(f: EffectiveCollection): MediaItem {
  return {
    id: `franchise:${f.slug}`,
    type: "franchise",
    title: f.name,
    subtitle: f.tagline,
    posterURL: f.posterURL,
    theme: f.theme,
  };
}

// In-memory-fast fuzzy match plus one DB read — no per-source (TMDB/IGDB/
// MangaDex) network calls, so collection search stays effectively free
// regardless of the 2-second budget that governs the other, real,
// rate-limited sources.
export async function searchCollections(query: string): Promise<MediaItem[]> {
  const list = await effectiveCollections();
  return list
    .filter((f) => matchTier(f.name, query) < 3 || fuzzyMatches(f.name, query))
    .sort((a, b) => matchTier(a.name, query) - matchTier(b.name, query))
    .map(toSummary);
}

// Used for Discover browsing (the "Featured Collections" shelf and its "see
// all" grid). No TMDB/IGDB/MangaDex calls; that cost is paid only when a
// specific collection's detail page is opened (resolveCollection below).
export async function discoverCollections(featuredOnly = false): Promise<MediaItem[]> {
  const list = await effectiveCollections();
  return (featuredOnly ? list.filter((f) => f.featured) : list).map(toSummary);
}

function dedupeById<T extends MediaItem>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// "Most recent last" — items with a real date sort oldest-to-newest (a
// future date counts as "more recent" than anything already released, so it
// lands at the end); items with no date on file are pushed to the very end
// rather than sorted arbitrarily among the dated ones.
function sortByRecency<T extends MediaItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return 0;
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return a.releaseDate < b.releaseDate ? -1 : a.releaseDate > b.releaseDate ? 1 : 0;
  });
}

// normalizedScores() (imported from textMatch.ts, shared with general
// search's ranking in lib/sources/index.ts) is used below to build the
// "Most Popular" row — normalized per type bucket so one type's bigger raw
// numbers can't dominate a franchise's cross-type ranking.

export interface CollectionPartsByType {
  movie: MediaItem[];
  tvShow: MediaItem[];
  game: MediaItem[];
  manga: MediaItem[];
}

export interface ResolvedCollection {
  def: EffectiveCollection;
  parts: CollectionPartsByType;
  // Combined across all four types, ranked by popularity normalized within
  // each type (see normalizedScores) — manually included titles (no real
  // popularity signal) are never part of this, only auto-resolved parts.
  mostPopular: MediaItem[];
  nextRelease: { date: string; title: string; posterURL?: string } | null;
  bannerURL?: string;
}

const MOST_POPULAR_LIMIT = 12;

// Reads each collection's PRECOMPUTED contents from collection_items — a
// static, hand-curated grouping resolved once by scripts/rebuild-collections.ts
// from the `curated` title lists in lib/collections.ts. No live search, no
// TMDB/IGDB/MangaDex calls, no query/tag auto-matching, on this or any other
// request path. A curated title that isn't in the catalog's top-N simply
// won't appear until a larger ingest includes it; that's an accepted
// tradeoff of running catalog-only. Membership changes by editing the
// curated lists and rerunning `npm run rebuild-collections`, or per-item
// through the editor (includeOverrides/excludeIds, applied below).
export async function resolveCollection(slug: string): Promise<ResolvedCollection | null> {
  const def = await getEffectiveCollection(slug);
  if (!def) return null;

  const members = await getCollectionItems(slug);
  const excluded = new Set(def.excludeIds);
  const ranked: Record<keyof CollectionPartsByType, RankedItem[]> = {
    movie: dedupeById(members.filter((i) => i.type === "movie")).filter((i) => !excluded.has(i.id)),
    tvShow: dedupeById(members.filter((i) => i.type === "tvShow")).filter((i) => !excluded.has(i.id)),
    game: dedupeById(members.filter((i) => i.type === "game")).filter((i) => !excluded.has(i.id)),
    manga: dedupeById(members.filter((i) => i.type === "manga")).filter((i) => !excluded.has(i.id)),
  };

  // Popularity-based "Most Popular" row is computed from auto-resolved
  // results only, BEFORE manually included titles (no real popularity
  // signal to rank by) are unioned in below.
  const scoresByType = {
    movie: normalizedScores(ranked.movie),
    tvShow: normalizedScores(ranked.tvShow),
    game: normalizedScores(ranked.game),
    manga: normalizedScores(ranked.manga),
  };
  const allRanked = [...ranked.movie, ...ranked.tvShow, ...ranked.game, ...ranked.manga];
  const mostPopular = stripRanking(
    [...allRanked]
      .sort((a, b) => (scoresByType[b.type as keyof CollectionPartsByType]?.get(b.id) ?? 0) -
        (scoresByType[a.type as keyof CollectionPartsByType]?.get(a.id) ?? 0))
      .slice(0, MOST_POPULAR_LIMIT)
  );

  // Manually included titles are unioned in — and never subject to
  // excludeIds, which is specifically for hiding auto-resolved query
  // matches. If a manual inclusion is no longer wanted, it's removed from
  // includeOverrides directly in the editor instead. No real popularity
  // signal for these (hand-entered, not fetched), so they don't affect
  // Most Popular — significant/popularity are just placeholders here.
  for (const inc of def.includeOverrides) {
    const bucket = ranked[inc.type];
    if (!bucket.some((i) => i.id === inc.id)) {
      bucket.push({
        id: inc.id,
        type: inc.type,
        title: inc.title,
        posterURL: inc.posterURL,
        releaseDate: inc.releaseDate,
        overview: inc.overview,
        significant: false,
        popularity: 0,
      });
    }
  }

  const all = [...ranked.movie, ...ranked.tvShow, ...ranked.game, ...ranked.manga];
  // Catches: (a) a next episode of a show already in this collection (once
  // catalogRowToMediaItem computes a real next-episode releaseDate for TV,
  // this naturally flows through here — no special-casing needed), and (b)
  // any already-catalogued title with a future date on file (rare, but a
  // fresh ingest can occasionally catch one pre-release).
  const catalogUpcoming = all
    .filter((i): i is RankedItem & { releaseDate: string } => !!i.releaseDate && new Date(i.releaseDate) > new Date())
    .sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : 1));
  const catalogNext = catalogUpcoming.length > 0
    ? { date: catalogUpcoming[0].releaseDate, title: catalogUpcoming[0].title, posterURL: catalogUpcoming[0].posterURL }
    : null;

  // Brand-new titles that aren't in catalog_items at all yet — precomputed
  // by rebuildAllCollections against upcoming_items (see collection_next_release
  // in lib/db.ts). Whichever of the two has the earlier date wins; either,
  // both, or neither may exist for a given collection. Degrades to "none"
  // on a DB error, same as every other read in this file.
  let upcomingNext: { date: string; title: string; posterURL?: string } | null = null;
  try {
    await ensureSchema();
    const rows = await db()`
      SELECT title, poster_url, release_date::text AS release_date
      FROM collection_next_release WHERE collection_slug = ${slug}
    `;
    const row = rows[0] as { title: string; poster_url: string | null; release_date: string } | undefined;
    if (row) upcomingNext = { date: row.release_date, title: row.title, posterURL: row.poster_url ?? undefined };
  } catch {
    // upcomingNext stays null
  }

  const nextRelease =
    catalogNext && upcomingNext
      ? (catalogNext.date < upcomingNext.date ? catalogNext : upcomingNext)
      : catalogNext ?? upcomingNext;

  // Explicit override wins; otherwise fall back to the first resolved part
  // that has a poster, same as before the editor existed.
  const bannerURL = def.bannerURL ?? all.find((i) => i.posterURL)?.posterURL;

  // Sorted "most recent first" within each type, then stripped down to the
  // plain MediaItem shape the API response/UI actually consumes.
  const parts: CollectionPartsByType = {
    movie: stripRanking(sortByRecency(ranked.movie)),
    tvShow: stripRanking(sortByRecency(ranked.tvShow)),
    game: stripRanking(sortByRecency(ranked.game)),
    manga: stripRanking(sortByRecency(ranked.manga)),
  };

  return { def, parts, mostPopular, nextRelease, bannerURL };
}

// What details("franchise", slug) returns — a thin summary over
// resolveCollection, consumed generically by the poll/notification pipeline
// and app/api/item/[type]/[id] exactly like any other MediaType.
export async function detailsCollection(slug: string): Promise<MediaItem> {
  const resolved = await resolveCollection(slug);
  if (!resolved) throw new Error(`Unknown collection: ${slug}`);
  return {
    id: `franchise:${slug}`,
    type: "franchise",
    title: resolved.def.name,
    overview: resolved.def.tagline,
    subtitle: resolved.nextRelease ? `Next: ${resolved.nextRelease.title}` : undefined,
    releaseDate: resolved.nextRelease?.date,
    posterURL: resolved.def.posterURL ?? resolved.bannerURL,
    theme: resolved.def.theme,
  };
}
