// Standalone CLI — populates catalog_items with the most popular established
// (already-released) titles per media type. Not part of any live request
// path; run manually: `npm run ingest -- --type=movie|tv|game|manga|all [--count=N]`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { ensureSchema, db } from "../lib/db";
import { paginatedTMDBMovies, paginatedTMDBTV } from "../lib/sources/tmdb";
import { paginatedIGDBGames } from "../lib/sources/igdb";
import { paginatedMangaDex } from "../lib/sources/mangadex";
import type { CatalogRow } from "../lib/catalog";

const DEFAULT_COUNTS: Record<string, number> = {
  movie: 10000,
  tv: 10000,
  game: 10000,
  manga: 1000,
};

function parseArgs(): { type: string; count?: number } {
  let type = "all";
  let count: number | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--type=")) type = arg.slice("--type=".length);
    if (arg.startsWith("--count=")) count = parseInt(arg.slice("--count=".length), 10);
  }
  return { type, count };
}

// Batched via UNNEST so a 10,000-row fetch is a handful of round trips to
// Neon, not one per row.
const BATCH_SIZE = 200;

async function upsertBatch(rows: CatalogRow[]): Promise<void> {
  if (rows.length === 0) return;
  const sql = db();
  await sql`
    INSERT INTO catalog_items (id, type, title, overview, poster_url, release_date, popularity_score, genres, external_links, metadata, tags)
    SELECT * FROM UNNEST(
      ${rows.map((r) => r.id)}::text[],
      ${rows.map((r) => r.type)}::text[],
      ${rows.map((r) => r.title)}::text[],
      ${rows.map((r) => r.overview ?? null)}::text[],
      ${rows.map((r) => r.posterURL ?? null)}::text[],
      ${rows.map((r) => r.releaseDate ?? null)}::date[],
      ${rows.map((r) => r.popularityScore)}::int[],
      ${rows.map((r) => JSON.stringify(r.genres))}::jsonb[],
      ${rows.map((r) => JSON.stringify(r.externalLinks ?? []))}::jsonb[],
      ${rows.map((r) => JSON.stringify(r.metadata ?? {}))}::jsonb[],
      ${rows.map((r) => JSON.stringify(r.tags ?? []))}::jsonb[]
    )
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      overview = excluded.overview,
      poster_url = excluded.poster_url,
      release_date = excluded.release_date,
      popularity_score = excluded.popularity_score,
      genres = excluded.genres,
      external_links = excluded.external_links,
      metadata = excluded.metadata,
      tags = excluded.tags,
      updated_at = now()
  `;
}

async function upsertAll(rows: CatalogRow[], label: string): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await upsertBatch(batch);
    console.log(`  [${label}] upserted ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
  }
}

async function runType(type: string, count: number): Promise<void> {
  console.log(`\n=== ${type} (target ${count}) ===`);
  const onPage = (fetched: number) => console.log(`  fetched ${fetched} / ${count}`);

  const onEnrich = (done: number, total: number) => {
    if (done % 100 === 0 || done === total) console.log(`  enriched ${done} / ${total}`);
  };

  let rows: CatalogRow[];
  switch (type) {
    case "movie":
      rows = await paginatedTMDBMovies(count, onPage, onEnrich);
      break;
    case "tv":
      rows = await paginatedTMDBTV(count, onPage, onEnrich);
      break;
    case "game":
      rows = await paginatedIGDBGames(count, onPage);
      break;
    case "manga":
      rows = await paginatedMangaDex(count, onPage);
      break;
    default:
      throw new Error(`Unknown --type: ${type} (expected movie|tv|game|manga|all)`);
  }

  // TMDB's discover pagination isn't perfectly stable when many entries tie
  // on vote_count — the same id can land on two different pages across
  // requests, which a single ON CONFLICT DO UPDATE batch can't apply twice.
  const deduped = [...new Map(rows.map((r) => [r.id, r])).values()];
  console.log(`  fetched ${rows.length} total (${deduped.length} unique), upserting...`);
  await upsertAll(deduped, type);
}

async function main(): Promise<void> {
  const { type, count } = parseArgs();
  await ensureSchema();

  const types = type === "all" ? Object.keys(DEFAULT_COUNTS) : [type];
  for (const t of types) {
    if (!(t in DEFAULT_COUNTS)) {
      throw new Error(`Unknown --type: ${t} (expected movie|tv|game|manga|all)`);
    }
    await runType(t, count ?? DEFAULT_COUNTS[t]);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
