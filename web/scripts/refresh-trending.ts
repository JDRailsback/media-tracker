// Standalone CLI — runs just the trending_items refresh (stage C of
// /api/cron/daily) without the much heavier upcoming/recent-releases stages.
// Useful for testing the trending shelves without waiting out (or spending
// API quota on) a full daily cron run. Not part of any live request path;
// run manually: `npm run refresh-trending`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { discoverTMDBTrendingMovies, discoverTMDBTrendingTV } from "../lib/sources/tmdb";
import { discoverIGDBTrending } from "../lib/sources/igdb";
import { discoverMangaDexTrending } from "../lib/sources/mangadex";
import { discoverDeezerTrendingArtists } from "../lib/sources/artist";
import { upsertTrending, pruneTrending } from "../lib/trending";
import type { TrendingRow } from "../lib/trending";

async function refresh(type: string, fetchRows: () => Promise<TrendingRow[]>): Promise<void> {
  process.stdout.write(`${type}... `);
  try {
    const rows = await fetchRows();
    await upsertTrending(rows);
    await pruneTrending(type, rows.map((r) => r.id));
    console.log(`${rows.length} rows`);
  } catch (err) {
    console.log(`FAILED: ${err}`);
  }
}

async function main() {
  await refresh("movie", discoverTMDBTrendingMovies);
  await refresh("tvShow", discoverTMDBTrendingTV);
  await refresh("game", discoverIGDBTrending);
  await refresh("manga", discoverMangaDexTrending);
  await refresh("artist", discoverDeezerTrendingArtists);
}

main().then(() => process.exit(0));
