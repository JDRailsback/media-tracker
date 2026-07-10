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

  // Assemble each collection's membership from the shared resolution maps.
  const collections: CollectionRebuildResult[] = [];
  const pairs: { slug: string; itemId: string }[] = [];
  let totalUnmatched = 0;
  for (const def of COLLECTIONS) {
    const perType: CollectionTypeResult[] = [];
    const ids = new Set<string>();
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
    collections.push({ slug: def.slug, custom: false, perType });
    for (const itemId of ids) pairs.push({ slug: def.slug, itemId });
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
