// Standalone CLI — resolves each collection's hand-curated title lists (see
// lib/collections.ts `curated`) into the collection_items table. This is the
// ONLY population mechanism: no query matching, no tag matching — a
// collection is a static, hand-picked grouping, changed by editing its
// curated list and rerunning this script. Not part of any live request path:
// `npm run rebuild-collections`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { ensureSchema, db } from "../lib/db";
import { COLLECTIONS } from "../lib/collections";
import { effectiveCollections } from "../lib/sources/collection";

const TYPES = ["movie", "tvShow", "game", "manga"] as const;
type PartType = (typeof TYPES)[number];

// Exact → prefix → contains title lookup against catalog_items. This is an
// id lookup for a hand-chosen title, not discovery — the "contains" tier
// exists because many real titles carry a prefix the curated list omits
// ("Star Wars: Episode I - The Phantom Menace" for "The Phantom Menace").
// Ties broken by popularity_score DESC (the most-established candidate — for
// same-titled entries like Halloween 1978/2018, the famous one). A title
// that doesn't resolve (not in the catalog's top-N yet) is reported, not
// silently dropped, and self-heals on a future larger ingest.
async function matchByCurated(
  titles: string[] | undefined,
  type: PartType
): Promise<{ ids: Set<string>; unmatched: string[] }> {
  if (!titles || titles.length === 0) return { ids: new Set(), unmatched: [] };
  const sql = db();
  const ids = new Set<string>();
  const unmatched: string[] = [];
  for (const title of titles) {
    const exact = await sql`SELECT id FROM catalog_items WHERE type = ${type} AND lower(title) = lower(${title}) ORDER BY popularity_score DESC LIMIT 1`;
    if (exact.length > 0) {
      ids.add((exact[0] as { id: string }).id);
      continue;
    }
    const prefix = await sql`SELECT id FROM catalog_items WHERE type = ${type} AND title ILIKE ${title + "%"} ORDER BY popularity_score DESC LIMIT 1`;
    if (prefix.length > 0) {
      ids.add((prefix[0] as { id: string }).id);
      continue;
    }
    const contains = await sql`SELECT id FROM catalog_items WHERE type = ${type} AND title ILIKE ${"%" + title + "%"} ORDER BY popularity_score DESC LIMIT 1`;
    if (contains.length > 0) {
      ids.add((contains[0] as { id: string }).id);
      continue;
    }
    unmatched.push(title);
  }
  return { ids, unmatched };
}

async function rebuildOne(slug: string, curated: Partial<Record<PartType, string[]>>): Promise<void> {
  const allIds: string[] = [];
  const summary: string[] = [];
  for (const type of TYPES) {
    const titles = curated[type];
    if (!titles || titles.length === 0) continue;
    const { ids, unmatched } = await matchByCurated(titles, type);
    summary.push(`${type}: ${ids.size}/${titles.length}`);
    if (unmatched.length > 0) summary.push(`  NOT FOUND (${type}): ${unmatched.join(", ")}`);
    allIds.push(...ids);
  }
  console.log(summary.length > 0 ? `  ${summary.join("\n  ")}` : "  (no curated titles)");

  const sql = db();
  await sql`DELETE FROM collection_items WHERE collection_slug = ${slug}`;
  if (allIds.length > 0) {
    const unique = [...new Set(allIds)];
    await sql`
      INSERT INTO collection_items (collection_slug, item_id)
      SELECT ${slug}, * FROM UNNEST(${unique}::text[])
      ON CONFLICT DO NOTHING
    `;
  }
}

async function main(): Promise<void> {
  await ensureSchema();
  const sql = db();

  for (const def of COLLECTIONS) {
    console.log(`\n=== ${def.slug} ===`);
    await rebuildOne(def.slug, def.curated ?? {});
  }

  // Editor-created custom collections have no curated list in code — their
  // membership is the manual includeOverrides applied at read time (see
  // resolveCollection). Clear any stale precomputed rows they may have
  // accumulated under older query-based rebuilds. Same for rows belonging to
  // slugs that no longer exist at all.
  const staticSlugs = COLLECTIONS.map((c) => c.slug);
  const staticSet = new Set(staticSlugs);
  const list = await effectiveCollections();
  for (const c of list) {
    if (!staticSet.has(c.slug)) {
      await sql`DELETE FROM collection_items WHERE collection_slug = ${c.slug}`;
      console.log(`\n=== ${c.slug} === (custom — manual includes only, cleared precomputed rows)`);
    }
  }
  await sql`DELETE FROM collection_items WHERE NOT (collection_slug = ANY(${staticSlugs})) AND NOT (collection_slug = ANY(${list.map((c) => c.slug)}))`;

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
