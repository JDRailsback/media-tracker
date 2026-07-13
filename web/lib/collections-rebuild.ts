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

// Same tiered exact/prefix/contains approach as matchTier, but against
// upcoming_items — for finding a collection's next NOT-YET-RELEASED entry
// (see collection_next_release in lib/db.ts). Only date_confirmed=true rows
// qualify: an undated "TBA" entry has no date to show on the "Up next" card.
// upcoming_items only ever holds movie/tvShow/game rows (manga has no
// "upcoming" concept), so this is only ever called for those three types.
interface UpcomingMatch {
  wanted: string;
  id: string;
  title: string;
  posterURL: string | null;
  releaseDate: string;
}

// Deliberately only exact + prefix — NO contains tier. Verified live: a
// "sports" curated title "Air" (2023, already released, correctly absent
// from upcoming_items) fell through to a contains match against "Avatar
// Aang: The Last Airbender" purely because "Air" is a substring of
// "Airbender". Harmless for bulk catalog membership (matchTier, many items
// blended together — see rationale there), but this feeds a single
// prominent "Up next" card per franchise: a false match is far worse than
// no match, so a curated title with no exact/prefix hit in upcoming_items
// just means "nothing upcoming for this title" rather than reaching for a
// loose guess.
async function matchUpcomingTier(
  type: PartType,
  titles: string[],
  tier: "exact" | "prefix"
): Promise<UpcomingMatch[]> {
  const sql = db();
  const rows =
    tier === "exact"
      ? await sql`
          SELECT t.title AS wanted, m.id, m.title, m.poster_url AS "posterURL", m.release_date::text AS "releaseDate"
          FROM UNNEST(${titles}::text[]) AS t(title)
          JOIN LATERAL (
            SELECT id, title, poster_url, release_date FROM upcoming_items
            WHERE type = ${type} AND date_confirmed = true AND lower(title) = lower(t.title)
            ORDER BY release_date ASC LIMIT 1
          ) m ON true
        `
      : await sql`
          SELECT t.title AS wanted, m.id, m.title, m.poster_url AS "posterURL", m.release_date::text AS "releaseDate"
          FROM UNNEST(${titles}::text[]) AS t(title)
          JOIN LATERAL (
            SELECT id, title, poster_url, release_date FROM upcoming_items
            WHERE type = ${type} AND date_confirmed = true AND title ILIKE t.title || '%'
            ORDER BY release_date ASC LIMIT 1
          ) m ON true
        `;
  return rows as unknown as UpcomingMatch[];
}

async function matchUpcomingTitles(type: PartType, titles: string[]): Promise<Map<string, UpcomingMatch>> {
  const resolved = new Map<string, UpcomingMatch>();
  let remaining = titles;
  for (const tier of ["exact", "prefix"] as const) {
    if (remaining.length === 0) break;
    for (const r of await matchUpcomingTier(type, remaining, tier)) resolved.set(r.wanted, r);
    remaining = remaining.filter((t) => !resolved.has(t));
  }
  return resolved;
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

  // Same shared-resolution-once approach against upcoming_items, for the
  // "Up next" franchise card (collection_next_release) — manga excluded,
  // upcoming_items never has manga rows.
  const UPCOMING_TYPES: PartType[] = ["movie", "tvShow", "game"];
  const upcomingResolvedByType = {} as Record<PartType, Map<string, UpcomingMatch>>;
  for (const type of UPCOMING_TYPES) {
    upcomingResolvedByType[type] = await matchUpcomingTitles(type, [...titlesByType[type]]);
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

        if (type !== "manga") {
          const upcomingMatch = upcomingResolvedByType[type as (typeof UPCOMING_TYPES)[number]].get(title);
          if (upcomingMatch && (!best || upcomingMatch.releaseDate < best.releaseDate)) best = upcomingMatch;
        }
      }
      totalUnmatched += unmatched.length;
      perType.push({ type, matched: titles.length - unmatched.length, total: titles.length, unmatched });
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
