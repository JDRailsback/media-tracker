import type { MediaItem, MediaType } from "@/lib/types";
import { FRANCHISES, FranchiseDef, FranchiseQueries, getFranchise } from "@/lib/franchises";
import { db, ensureSchema } from "@/lib/db";
import { matchTier, fuzzyMatches, normalizedScores, RankedItem, stripRanking } from "./textMatch";
import { searchTMDBMovie, searchTMDBTV, tmdbCollectionParts } from "./tmdb";
import { searchIGDB } from "./igdb";
import { searchMangaDex } from "./mangadex";

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
  type: Exclude<MediaType, "franchise">;
  title: string;
  posterURL?: string;
  releaseDate?: string;
  overview?: string;
}

// The fully-resolved definition used everywhere at runtime — a plain
// FranchiseDef (from the static seed list) if never edited, or the complete
// replacement row from franchise_overrides if it has been. `isCustom` marks
// a franchise created entirely through the editor, with no static fallback
// to revert to.
export interface EffectiveFranchise {
  slug: string;
  name: string;
  tagline: string;
  theme: { primary: string; secondary: string };
  queries: FranchiseQueries;
  movieCollectionId?: number;
  featured: boolean;
  posterURL?: string;
  bannerURL?: string;
  includeOverrides: IncludedPart[];
  excludeIds: string[];
  isCustom: boolean;
}

interface OverrideRow {
  slug: string;
  name: string;
  tagline: string | null;
  theme_primary: string;
  theme_secondary: string;
  poster_url: string | null;
  banner_url: string | null;
  queries: FranchiseQueries | string;
  movie_collection_id: number | null;
  featured: boolean;
  include_overrides: IncludedPart[] | string;
  exclude_ids: string[] | string;
  is_custom: boolean;
}

// Neon's driver returns JSONB columns already parsed in practice, but this
// guards against a raw string coming back (e.g. a future driver change)
// rather than throwing and breaking the whole franchise system over it.
function parseJSON<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function defToEffective(def: FranchiseDef): EffectiveFranchise {
  return {
    slug: def.slug,
    name: def.name,
    tagline: def.tagline,
    theme: def.theme,
    queries: def.queries,
    movieCollectionId: def.movieCollectionId,
    featured: !!def.featured,
    includeOverrides: [],
    excludeIds: [],
    isCustom: false,
  };
}

function rowToEffective(row: OverrideRow): EffectiveFranchise {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline ?? "",
    theme: { primary: row.theme_primary, secondary: row.theme_secondary },
    queries: parseJSON(row.queries, {} as FranchiseQueries),
    movieCollectionId: row.movie_collection_id ?? undefined,
    featured: row.featured,
    posterURL: row.poster_url ?? undefined,
    bannerURL: row.banner_url ?? undefined,
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
    const rows = await sql`SELECT * FROM franchise_overrides WHERE slug = ${slug}`;
    return (rows[0] as OverrideRow | undefined) ?? null;
  } catch {
    return null;
  }
}

async function loadAllOverrides(): Promise<OverrideRow[]> {
  try {
    await ensureSchema();
    const sql = db();
    return (await sql`SELECT * FROM franchise_overrides`) as unknown as OverrideRow[];
  } catch {
    return [];
  }
}

export async function getEffectiveFranchise(slug: string): Promise<EffectiveFranchise | null> {
  const row = await loadOverrideRow(slug);
  if (row) return rowToEffective(row);
  const def = getFranchise(slug);
  return def ? defToEffective(def) : null;
}

// The merged list used by search and Discover browsing: every static
// franchise (with its override applied, if any) plus any brand-new custom
// franchises created entirely through the editor.
export async function effectiveFranchises(): Promise<EffectiveFranchise[]> {
  const overrides = await loadAllOverrides();
  const overrideBySlug = new Map(overrides.map((r) => [r.slug, r]));
  const merged = FRANCHISES.map((def) => {
    const row = overrideBySlug.get(def.slug);
    return row ? rowToEffective(row) : defToEffective(def);
  });
  const staticSlugs = new Set(FRANCHISES.map((f) => f.slug));
  for (const row of overrides) {
    if (!staticSlugs.has(row.slug)) merged.push(rowToEffective(row));
  }
  return merged;
}

function toSummary(f: EffectiveFranchise): MediaItem {
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
// MangaDex) network calls, so franchise search stays effectively free
// regardless of the 2-second budget that governs the other, real,
// rate-limited sources.
export async function searchFranchises(query: string): Promise<MediaItem[]> {
  const list = await effectiveFranchises();
  return list
    .filter((f) => matchTier(f.name, query) < 3 || fuzzyMatches(f.name, query))
    .sort((a, b) => matchTier(a.name, query) - matchTier(b.name, query))
    .map(toSummary);
}

// Used for Discover browsing (the "Featured Franchises" shelf and its "see
// all" grid). No TMDB/IGDB/MangaDex calls; that cost is paid only when a
// specific franchise's detail page is opened (resolveFranchise below).
export async function discoverFranchises(featuredOnly = false): Promise<MediaItem[]> {
  const list = await effectiveFranchises();
  return (featuredOnly ? list.filter((f) => f.featured) : list).map(toSummary);
}

// Kept as RankedItem[] (not stripped down to MediaItem[] yet) — `popularity`
// is needed a bit longer, to build the "Most Popular" row and the
// chronological sort below. Stripped only at the very end of
// resolveFranchise, right before the response is assembled.
async function resolveQuery(
  queries: string | string[] | undefined,
  searchFn: (q: string, opts?: { lenient?: boolean }) => Promise<RankedItem[]>
): Promise<RankedItem[]> {
  if (!queries) return [];
  const list = Array.isArray(queries) ? queries : [queries];
  const settled = await Promise.allSettled(
    list.map(async (q) => {
      const results = await searchFn(q, { lenient: true });
      // `lenient` only relaxes the POPULARITY bar — a result still has to
      // actually relate to the query text. Verified live this matters even
      // for a precise-looking curated query: TMDB's TV search for "One
      // Piece" includes "A Piece of Your Mind" and "Aqua Teen Hunger
      // Force," neither containing "One Piece" anywhere in the title —
      // TMDB's own relevance ranking is looser than a substring match. This
      // is the same relevantOnly()/matchTier gate general search applies
      // (lib/sources/index.ts), scoped here to the SPECIFIC query string
      // that produced each result (a franchise can have several query
      // strings — e.g. Star Wars' TV list — and a result must relate to
      // the one that actually found it, not just any of them).
      return results.filter((r) => matchTier(r.title, q) < 3 || fuzzyMatches(r.title, q));
    })
  );
  const out: RankedItem[] = [];
  for (const r of settled) if (r.status === "fulfilled") out.push(...r.value);
  return out;
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

export interface FranchisePartsByType {
  movie: MediaItem[];
  tvShow: MediaItem[];
  game: MediaItem[];
  manga: MediaItem[];
}

export interface ResolvedFranchise {
  def: EffectiveFranchise;
  parts: FranchisePartsByType;
  // Combined across all four types, ranked by popularity normalized within
  // each type (see normalizedScores) — manually included titles (no real
  // popularity signal) are never part of this, only auto-resolved parts.
  mostPopular: MediaItem[];
  nextRelease: { date: string; title: string } | null;
  bannerURL?: string;
}

const MOST_POPULAR_LIMIT = 12;

// The one genuinely "live, multi-source" piece of the franchise system —
// only paid for on a detail-page load or the nightly poll check, never on
// search/browse. Movies use the pre-resolved TMDB Collection (accurate,
// catches oddly-titled entries a text search would miss) when
// `movieCollectionId` is set; everything else is plain per-type text search
// against the curated query strings, in `lenient` mode (see each adapter) —
// deliberately does NOT apply the general-search elevated non-exact-match
// popularity bar here. Verified live it was cutting real franchise entries:
// searching IGDB for "One Piece" returns 128 raw games, and the elevated bar
// let only 2 through (real, well-known titles like "One Piece: World
// Seeker" and "One Piece: Burning Blood" were excluded for not being a
// literal exact match to "One Piece" — true of almost every real entry in
// any franchise). That bar exists to fight general-search clutter, not to
// thin out a franchise's own already-precise, curated query.
export async function resolveFranchise(slug: string): Promise<ResolvedFranchise | null> {
  const def = await getEffectiveFranchise(slug);
  if (!def) return null;

  const [movieFromCollection, movieFromSearch, tvShow, game, manga] = await Promise.all([
    def.movieCollectionId
      ? tmdbCollectionParts(def.movieCollectionId).catch(() => [] as RankedItem[])
      : Promise.resolve([] as RankedItem[]),
    def.movieCollectionId ? Promise.resolve([] as RankedItem[]) : resolveQuery(def.queries.movie, searchTMDBMovie),
    resolveQuery(def.queries.tvShow, searchTMDBTV),
    resolveQuery(def.queries.game, searchIGDB),
    resolveQuery(def.queries.manga, searchMangaDex),
  ]);

  const excluded = new Set(def.excludeIds);
  const ranked: Record<keyof FranchisePartsByType, RankedItem[]> = {
    movie: dedupeById([...movieFromCollection, ...movieFromSearch]).filter((i) => !excluded.has(i.id)),
    tvShow: dedupeById(tvShow).filter((i) => !excluded.has(i.id)),
    game: dedupeById(game).filter((i) => !excluded.has(i.id)),
    manga: dedupeById(manga).filter((i) => !excluded.has(i.id)),
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
      .sort((a, b) => (scoresByType[b.type as keyof FranchisePartsByType]?.get(b.id) ?? 0) -
        (scoresByType[a.type as keyof FranchisePartsByType]?.get(a.id) ?? 0))
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
  const upcoming = all
    .filter((i): i is RankedItem & { releaseDate: string } => !!i.releaseDate && new Date(i.releaseDate) > new Date())
    .sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : 1));
  const nextRelease = upcoming.length > 0 ? { date: upcoming[0].releaseDate, title: upcoming[0].title } : null;

  // Explicit override wins; otherwise fall back to the first resolved part
  // that has a poster, same as before the editor existed.
  const bannerURL = def.bannerURL ?? all.find((i) => i.posterURL)?.posterURL;

  // Sorted "most recent first" within each type, then stripped down to the
  // plain MediaItem shape the API response/UI actually consumes.
  const parts: FranchisePartsByType = {
    movie: stripRanking(sortByRecency(ranked.movie)),
    tvShow: stripRanking(sortByRecency(ranked.tvShow)),
    game: stripRanking(sortByRecency(ranked.game)),
    manga: stripRanking(sortByRecency(ranked.manga)),
  };

  return { def, parts, mostPopular, nextRelease, bannerURL };
}

// What details("franchise", slug) returns — a thin summary over
// resolveFranchise, consumed generically by the poll/notification pipeline
// and app/api/item/[type]/[id] exactly like any other MediaType.
export async function detailsFranchise(slug: string): Promise<MediaItem> {
  const resolved = await resolveFranchise(slug);
  if (!resolved) throw new Error(`Unknown franchise: ${slug}`);
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
