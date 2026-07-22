// Standalone CLI — repoints existing TMDB poster URLs from w500 to w342
// (see lib/sources/tmdb.ts's IMAGE_BASE). A pure string replace, not a
// re-fetch: TMDB's image paths are identical across sizes, only the size
// segment in the URL changes, so this is safe and near-instant even across
// the whole catalog. New ingests already write w342 directly; this just
// backfills everything ingested before that change. Run manually:
// `npm run shrink-posters`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { db, ensureSchema } from "../lib/db";

const TABLES = ["catalog_items", "upcoming_items", "trending_items"] as const;

async function main() {
  await ensureSchema();
  const sql = db();
  for (const table of TABLES) {
    const rows = await sql(
      `UPDATE ${table}
       SET poster_url = replace(poster_url, '/t/p/w500/', '/t/p/w342/')
       WHERE poster_url LIKE '%image.tmdb.org/t/p/w500/%'
       RETURNING id`
    );
    console.log(`${table}: ${rows.length} poster URLs shrunk`);
  }
}
main().then(() => process.exit(0));
