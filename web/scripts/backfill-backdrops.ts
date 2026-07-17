// Standalone CLI — fills catalog_items.backdrop_url for rows ingested before
// backdrop capture existed. List-page passes only (backdrop/artwork URLs are
// inline on TMDB discover and IGDB games responses), so this is a few
// hundred requests total, not a 10k-item re-enrichment. Manga is skipped:
// MangaDex has no landscape art at all — those heroes fall back to the
// poster in the UI. Run manually: `npm run backfill-backdrops`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { db, ensureSchema } from "../lib/db";
import { listTMDBBackdrops } from "../lib/sources/tmdb";
import { listIGDBBackdrops } from "../lib/sources/igdb";

const UPDATE_BATCH_SIZE = 500;

async function applyBackdrops(label: string, backdrops: Map<string, string>): Promise<void> {
  const sql = db();
  const entries = [...backdrops.entries()];
  let updated = 0;
  for (let i = 0; i < entries.length; i += UPDATE_BATCH_SIZE) {
    const batch = entries.slice(i, i + UPDATE_BATCH_SIZE);
    const result = (await sql`
      UPDATE catalog_items SET backdrop_url = t.backdrop_url, updated_at = now()
      FROM UNNEST(
        ${batch.map(([id]) => id)}::text[],
        ${batch.map(([, url]) => url)}::text[]
      ) AS t(id, backdrop_url)
      WHERE catalog_items.id = t.id AND catalog_items.backdrop_url IS DISTINCT FROM t.backdrop_url
    `) as unknown as { length?: number };
    updated += result?.length ?? 0;
  }
  console.log(`${label}: ${entries.length} backdrops fetched, applied to catalog`);
}

async function main() {
  await ensureSchema();

  console.log("Fetching TMDB movie backdrops (list pages only)...");
  await applyBackdrops("movies", await listTMDBBackdrops("movie"));

  console.log("Fetching TMDB TV backdrops (list pages only)...");
  await applyBackdrops("tv", await listTMDBBackdrops("tv"));

  console.log("Fetching IGDB game artworks/screenshots...");
  await applyBackdrops("games", await listIGDBBackdrops());

  console.log("Done. (Manga skipped — MangaDex has no landscape art.)");
}

main().then(() => process.exit(0));
