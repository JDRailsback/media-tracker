import { ensureSchema, db } from "@/lib/db";
import { COLLECTIONS } from "@/lib/collections";
import { effectiveCollections } from "@/lib/sources/collection";

// Resolves every collection's hand-curated title lists (see
// lib/collections.ts `curated`) into the collection_items table. This is the
// ONLY population mechanism: no query matching, no tag matching — a
// collection is a static, hand-picked grouping, changed by editing its
// curated list. Two callers: `npm run rebuild-collections` (manual, after
// editing a list) and app/api/cron/daily/route.ts (so a curated title that
// wasn't in the catalog yet self-heals the day an ingest adds it — the
// LISTS never change automatically, only the title→id lookup reruns).
//
// Matching is set-based — one query per type per tier instead of one per
// title — because the cron runs against Neon over HTTP, where ~2,000
// sequential per-title round trips would blow the whole 60s function budget
// on network latency alone.

const TYPES = ["movie", "tvShow", "game", "manga"] as const;
type PartType = (typeof TYPES)[number];

export interface CollectionTypeResult {
  type: PartType;
  matched: number;
  total: number;
  unmatched: string[];
}

export interface CollectionRebuildResult {
  slug: string;
  // true for editor-created custom collections (no curated list in code) —
  // their membership is manual includeOverrides applied at read time, so the
  // rebuild only clears any stale precomputed rows they may have accumulated.
  custom: boolean;
  perType: CollectionTypeResult[];
}

export interface RebuildSummary {
  collections: CollectionRebuildResult[];
  totalItems: number;
  totalUnmatched: number;
}

// Exact → prefix → contains title lookup against catalog_items, each tier
// resolving ALL still-unmatched titles of a type in one UNNEST+LATERAL
// query. Same semantics as the old per-title version: the "contains" tier
// exists because many real titles carry a prefix the curated list omits
// ("Star Wars: Episode I - The Phantom Menace" for "The Phantom Menace"),
// and ties break by popularity_score DESC (for same-titled entries like
// Halloween 1978/2018, the famous one wins). A title that resolves nowhere
// (not in the catalog's top-N yet) is reported, not silently dropped.
async function matchTier(
  type: PartType,
  titles: string[],
  tier: "exact" | "prefix" | "contains"
): Promise<{ wanted: string; id: string }[]> {
  const sql = db();
  if (tier === "exact") {
    return (await sql`
      SELECT t.title AS wanted, m.id
      FROM UNNEST(${titles}::text[]) AS t(title)
      JOIN LATERAL (
        SELECT id FROM catalog_items
        WHERE type = ${type} AND lower(title) = lower(t.title)
        ORDER BY popularity_score DESC LIMIT 1
      ) m ON true
    `) as { wanted: string; id: string }[];
  }
  if (tier === "prefix") {
    return (await sql`
      SELECT t.title AS wanted, m.id
      FROM UNNEST(${titles}::text[]) AS t(title)
      JOIN LATERAL (
        SELECT id FROM catalog_items
        WHERE type = ${type} AND title ILIKE t.title || '%'
        ORDER BY popularity_score DESC LIMIT 1
      ) m ON true
    `) as { wanted: string; id: string }[];
  }
  return (await sql`
    SELECT t.title AS wanted, m.id
    FROM UNNEST(${titles}::text[]) AS t(title)
    JOIN LATERAL (
      SELECT id FROM catalog_items
      WHERE type = ${type} AND title ILIKE '%' || t.title || '%'
      ORDER BY popularity_score DESC LIMIT 1
    ) m ON true
  `) as { wanted: string; id: string }[];
}

async function matchTitles(type: PartType, titles: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>(); // curated title -> catalog id
  let remaining = titles;
  for (const tier of ["exact", "prefix", "contains"] as const) {
    if (remaining.length === 0) break;
    for (const r of await matchTier(type, remaining, tier)) resolved.set(r.wanted, r.id);
    remaining = remaining.filter((t) => !resolved.has(t));
  }
  return resolved;
}

// Same tiered exact/prefix approach as matchTier, but against
// upcoming_calendar — for finding a collection's next NOT-YET-RELEASED entry
// (see collection_next_release in lib/db.ts). Reads upcoming_calendar (the
// Trakt/IGDB-vetted precomputed calendar — see lib/upcomingCalendar.ts), NOT
// the raw upcoming_items: every row there already cleared a real quality bar
// and confirmed-date check, so there's no separate date_confirmed condition
// to add, and a franchise's "Up next" card can only ever point at something
// the rest of the site already treats as genuinely notable. upcoming_calendar
// only ever holds movie/tvShow/game rows (manga has no "upcoming" concept),
// so this is only ever called for those three types.
interface UpcomingMatch {
  wanted: string;
  id: string;
  title: string;
  posterURL: string | null;
  releaseDate: string;
}

// Now includes a contains tier (unlike the exact+prefix-only version this
// used to be) — verified live it's needed: "LEGO ONE PIECE" (a real,
// Trakt-anticipated show) never prefix-matches the derived keyword "One
// Piece" because the franchise name sits mid-title, not at the start. Back
// when this matched against the full unfiltered upcoming_items, a contains
// tier was too dangerous — a "sports" curated title "Air" (2023, already
// released) fell through to a contains match against "Avatar Aang: The
// Last Airbender" purely because "Air" is a substring of "Airbender". Now
// that this matches against the much smaller, pre-vetted upcoming_calendar
// instead (~150-300 rows, every one already Trakt/IGDB-admitted), that
// false-positive surface is far smaller, and even a wrong contains match
// would itself be a genuinely notable title, not noise.
async function matchUpcomingTier(
  type: PartType,
  titles: string[],
  tier: "exact" | "prefix" | "contains"
): Promise<UpcomingMatch[]> {
  const sql = db();
  if (tier === "exact") {
    return (await sql`
      SELECT t.title AS wanted, m.id, m.title, m.poster_url AS "posterURL", m.release_date::text AS "releaseDate"
      FROM UNNEST(${titles}::text[]) AS t(title)
      JOIN LATERAL (
        SELECT id, title, poster_url, release_date FROM upcoming_calendar
        WHERE type = ${type} AND lower(title) = lower(t.title)
        ORDER BY release_date ASC LIMIT 1
      ) m ON true
    `) as unknown as UpcomingMatch[];
  }
  if (tier === "prefix") {
    return (await sql`
      SELECT t.title AS wanted, m.id, m.title, m.poster_url AS "posterURL", m.release_date::text AS "releaseDate"
      FROM UNNEST(${titles}::text[]) AS t(title)
      JOIN LATERAL (
        SELECT id, title, poster_url, release_date FROM upcoming_calendar
        WHERE type = ${type} AND title ILIKE t.title || '%'
        ORDER BY release_date ASC LIMIT 1
      ) m ON true
    `) as unknown as UpcomingMatch[];
  }
  return (await sql`
    SELECT t.title AS wanted, m.id, m.title, m.poster_url AS "posterURL", m.release_date::text AS "releaseDate"
    FROM UNNEST(${titles}::text[]) AS t(title)
    JOIN LATERAL (
      SELECT id, title, poster_url, release_date FROM upcoming_calendar
      WHERE type = ${type} AND title ILIKE '%' || t.title || '%'
      ORDER BY release_date ASC LIMIT 1
    ) m ON true
  `) as unknown as UpcomingMatch[];
}

async function matchUpcomingTitles(type: PartType, titles: string[]): Promise<Map<string, UpcomingMatch>> {
  const resolved = new Map<string, UpcomingMatch>();
  let remaining = titles;
  for (const tier of ["exact", "prefix", "contains"] as const) {
    if (remaining.length === 0) break;
    for (const r of await matchUpcomingTier(type, remaining, tier)) resolved.set(r.wanted, r);
    remaining = remaining.filter((t) => !resolved.has(t));
  }
  return resolved;
}

// The curated lists are an exhaustive record of SPECIFIC known past entries
// ("Spider-Man: Homecoming", "Spider-Man: No Way Home", ...) — a brand new
// colon-subtitled sequel that didn't exist yet when the list was written
// ("Spider-Man: Brand New Day") never exact/prefix-matches any of them, so
// most franchises' "Up next" card silently stayed empty even with a real
// upcoming entry sitting in upcoming_calendar (verified live: One Piece's
// "Grand Gourmet" game, Marvel's "Spider-Man: Brand New Day"). Splitting
// each curated title on its first ": " recovers the shared franchise-level
// name behind every subtitled entry (Homecoming/Far From Home/No Way
// Home/Brand New Day all reduce to "Spider-Man"), which then prefix-matches
// ANY future entry automatically — no hand-maintenance needed going
// forward. Titles without a colon ("Iron Man", "The Avengers") don't need
// this: the bare curated title is already its own effective prefix for a
// numbered sequel. The length-4 floor skips trivially short/generic
// fragments that would otherwise risk a wrong match.
export function deriveUpcomingKeywords(titles: string[]): string[] {
  const keywords = new Set<string>();
  for (const title of titles) {
    const idx = title.indexOf(": ");
    if (idx > 3) keywords.add(title.slice(0, idx));
  }
  return [...keywords];
}

export async function rebuildAllCollections(): Promise<RebuildSummary> {
  await ensureSchema();
  const sql = db();

  // Resolve every curated title once per type, across ALL collections — the
  // same title appearing in two collections costs one lookup, not two.
  const titlesByType: Record<PartType, Set<string>> = {
    movie: new Set(),
    tvShow: new Set(),
    game: new Set(),
    manga: new Set(),
  };
  for (const def of COLLECTIONS) {
    for (const type of TYPES) {
      for (const title of def.curated?.[type] ?? []) titlesByType[type].add(title);
    }
  }

  const resolvedByType = {} as Record<PartType, Map<string, string>>;
  for (const type of TYPES) {
    resolvedByType[type] = await matchTitles(type, [...titlesByType[type]]);
  }

  // Same shared-resolution-once approach against upcoming_calendar, for the
  // "Up next" franchise card (collection_next_release) — manga excluded,
  // upcoming_calendar never has manga rows. Uses a BROADER per-collection
  // keyword set than catalog membership above: the curated titles
  // themselves, PLUS each one's derived franchise-level keyword (see
  // deriveUpcomingKeywords) — kept as its own separate map so a derived
  // keyword like "Spider-Man" only ever widens the "Up next" search, never
  // accidentally pulls unrelated catalog items into a collection's actual
  // membership via matchTitles' contains tier above.
  const UPCOMING_TYPES = ["movie", "tvShow", "game"] as const;
  const upcomingTitlesByType: Record<(typeof UPCOMING_TYPES)[number], Set<string>> = {
    movie: new Set(),
    tvShow: new Set(),
    game: new Set(),
  };
  const upcomingKeywordsByDef = new Map<string, Partial<Record<(typeof UPCOMING_TYPES)[number], string[]>>>();
  for (const def of COLLECTIONS) {
    const perDef: Partial<Record<(typeof UPCOMING_TYPES)[number], string[]>> = {};
    for (const type of UPCOMING_TYPES) {
      const curated = def.curated?.[type] ?? [];
      if (curated.length === 0) continue;
      const combined = [...new Set([...curated, ...deriveUpcomingKeywords(curated)])];
      perDef[type] = combined;
      for (const t of combined) upcomingTitlesByType[type].add(t);
    }
    upcomingKeywordsByDef.set(def.slug, perDef);
  }

  const upcomingResolvedByType = {} as Record<(typeof UPCOMING_TYPES)[number], Map<string, UpcomingMatch>>;
  for (const type of UPCOMING_TYPES) {
    upcomingResolvedByType[type] = await matchUpcomingTitles(type, [...upcomingTitlesByType[type]]);
  }

  // Assemble each collection's membership from the shared resolution maps.
  const collections: CollectionRebuildResult[] = [];
  const pairs: { slug: string; itemId: string }[] = [];
  const nextReleases: { slug: string; itemId: string; title: string; posterURL: string | null; releaseDate: string }[] = [];
  let totalUnmatched = 0;
  for (const def of COLLECTIONS) {
    const perType: CollectionTypeResult[] = [];
    const ids = new Set<string>();
    let best: UpcomingMatch | null = null;
    for (const type of TYPES) {
      const titles = def.curated?.[type];
      if (!titles || titles.length === 0) continue;
      const unmatched: string[] = [];
      for (const title of titles) {
        const id = resolvedByType[type].get(title);
        if (id) ids.add(id);
        else unmatched.push(title);
      }
      totalUnmatched += unmatched.length;
      perType.push({ type, matched: titles.length - unmatched.length, total: titles.length, unmatched });
    }
    // "Up next" search uses the BROADER curated+derived keyword set (see
    // upcomingKeywordsByDef above), separately from the catalog-membership
    // loop just above, which stays scoped to the raw curated titles only.
    for (const type of UPCOMING_TYPES) {
      const keywords = upcomingKeywordsByDef.get(def.slug)?.[type];
      if (!keywords) continue;
      for (const keyword of keywords) {
        const upcomingMatch = upcomingResolvedByType[type].get(keyword);
        if (upcomingMatch && (!best || upcomingMatch.releaseDate < best.releaseDate)) best = upcomingMatch;
      }
    }
    collections.push({ slug: def.slug, custom: false, perType });
    for (const itemId of ids) pairs.push({ slug: def.slug, itemId });
    if (best) {
      nextReleases.push({
        slug: def.slug,
        itemId: best.id,
        title: best.title,
        posterURL: best.posterURL,
        releaseDate: best.releaseDate,
      });
    }
  }

  // Full replace in two statements: clear every static slug, then insert the
  // whole membership set at once.
  const staticSlugs = COLLECTIONS.map((c) => c.slug);
  await sql`DELETE FROM collection_items WHERE collection_slug = ANY(${staticSlugs})`;
  if (pairs.length > 0) {
    await sql`
      INSERT INTO collection_items (collection_slug, item_id)
      SELECT * FROM UNNEST(${pairs.map((p) => p.slug)}::text[], ${pairs.map((p) => p.itemId)}::text[])
      ON CONFLICT DO NOTHING
    `;
  }

  // Same full-replace pattern for the "Up next" precomputed row — a
  // collection with no current upcoming match simply gets no row (not a
  // stale one left over from a previous rebuild).
  await sql`DELETE FROM collection_next_release WHERE collection_slug = ANY(${staticSlugs})`;
  if (nextReleases.length > 0) {
    await sql`
      INSERT INTO collection_next_release (collection_slug, item_id, title, poster_url, release_date)
      SELECT * FROM UNNEST(
        ${nextReleases.map((r) => r.slug)}::text[],
        ${nextReleases.map((r) => r.itemId)}::text[],
        ${nextReleases.map((r) => r.title)}::text[],
        ${nextReleases.map((r) => r.posterURL)}::text[],
        ${nextReleases.map((r) => r.releaseDate)}::date[]
      )
      ON CONFLICT (collection_slug) DO UPDATE SET
        item_id = excluded.item_id, title = excluded.title,
        poster_url = excluded.poster_url, release_date = excluded.release_date
    `;
  }

  // Editor-created custom collections have no curated list in code — their
  // membership is the manual includeOverrides applied at read time (see
  // resolveCollection). Clear any stale precomputed rows they may have
  // accumulated under older query-based rebuilds. Same for rows belonging to
  // slugs that no longer exist at all.
  const staticSet = new Set(staticSlugs);
  const list = await effectiveCollections();
  const customSlugs = list.map((c) => c.slug).filter((slug) => !staticSet.has(slug));
  if (customSlugs.length > 0) {
    await sql`DELETE FROM collection_items WHERE collection_slug = ANY(${customSlugs})`;
    for (const slug of customSlugs) {
      collections.push({ slug, custom: true, perType: [] });
    }
  }
  await sql`
    DELETE FROM collection_items
    WHERE NOT (collection_slug = ANY(${staticSlugs})) AND NOT (collection_slug = ANY(${list.map((c) => c.slug)}))
  `;

  return { collections, totalItems: pairs.length, totalUnmatched };
}
