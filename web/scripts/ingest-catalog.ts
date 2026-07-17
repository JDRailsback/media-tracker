// Standalone CLI — populates catalog_items with the most popular established
// (already-released) titles per media type. Not part of any live request
// path; run manually: `npm run ingest -- --type=movie|tv|game|manga|all [--count=N]`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { ensureSchema } from "../lib/db";
import { paginatedTMDBMovies, paginatedTMDBTV } from "../lib/sources/tmdb";
import { paginatedIGDBGames } from "../lib/sources/igdb";
import { paginatedMangaDex } from "../lib/sources/mangadex";
import { paginatedDeezerArtists } from "../lib/sources/artist";
import { upsertCatalog } from "../lib/catalog";
import type { CatalogRow } from "../lib/catalog";

const DEFAULT_COUNTS: Record<string, number> = {
  movie: 10000,
  tv: 10000,
  game: 10000,
  manga: 1000,
  // Practical ceiling, not a popularity cut — the union of Deezer's genre
  // charts is only a few thousand artists (music has no deep "top N"
  // endpoint anywhere); the live search fallback covers everyone else.
  artist: 3000,
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
    case "artist":
      rows = await paginatedDeezerArtists(count, onPage);
      break;
    default:
      throw new Error(`Unknown --type: ${type} (expected movie|tv|game|manga|artist|all)`);
  }

  // TMDB's discover pagination isn't perfectly stable when many entries tie
  // on vote_count — the same id can land on two different pages across
  // requests, which a single ON CONFLICT DO UPDATE batch can't apply twice.
  const deduped = [...new Map(rows.map((r) => [r.id, r])).values()];
  console.log(`  fetched ${rows.length} total (${deduped.length} unique), upserting...`);
  // The batched-UNNEST upsert itself lives in lib/catalog.ts now, shared with
  // the daily cron's recent-releases refresh (app/api/cron/daily/route.ts).
  await upsertCatalog(deduped, (done, total) => console.log(`  [${type}] upserted ${done} / ${total}`));
}

async function main(): Promise<void> {
  const { type, count } = parseArgs();
  await ensureSchema();

  const types = type === "all" ? Object.keys(DEFAULT_COUNTS) : [type];
  for (const t of types) {
    if (!(t in DEFAULT_COUNTS)) {
      throw new Error(`Unknown --type: ${t} (expected movie|tv|game|manga|artist|all)`);
    }
    await runType(t, count ?? DEFAULT_COUNTS[t]);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
