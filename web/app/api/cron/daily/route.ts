import { NextResponse } from "next/server";
import {
  discoverTMDBUpcomingMovies,
  discoverTMDBUpcomingTV,
  discoverTMDBRecentMovies,
  discoverTMDBRecentTV,
  discoverTMDBTrendingMovies,
  discoverTMDBTrendingTV,
} from "@/lib/sources/tmdb";
import { discoverIGDBUpcoming, discoverIGDBRecent, discoverIGDBTrending } from "@/lib/sources/igdb";
import { discoverMangaDexRecent, discoverMangaDexTrending } from "@/lib/sources/mangadex";
import { discoverDeezerTrendingArtists, ingestArtist } from "@/lib/sources/artist";
import { db, ensureSchema } from "@/lib/db";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";
import { upsertCatalog } from "@/lib/catalog";
import type { CatalogRow } from "@/lib/catalog";
import { upsertTrending, pruneTrending } from "@/lib/trending";
import type { TrendingRow } from "@/lib/trending";
import { rebuildAllCollections } from "@/lib/collections-rebuild";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/daily — the one daily data-refresh job, triggered by Vercel
// Cron (see vercel.json; Hobby allows only two cron jobs, and /api/poll has
// the other slot — hence one consolidated endpoint rather than one per
// concern). Same Authorization: Bearer CRON_SECRET pattern as /api/poll.
// Four stages:
//   A. Upcoming refresh — upcoming_items replaced with the current biggest
//      unreleased/announced titles (dated or not).
//   B. Recent releases — titles released in the last ~30 days upserted into
//      catalog_items (all four types, manga included). This is what
//      "graduates" a title the day it releases: stage A prunes it from
//      upcoming_items, stage B lands it in the catalog. Re-running the whole
//      window daily also keeps a fresh title's score/poster/metadata
//      self-correcting for a month.
//   C. Trending refresh — trending_items fully replaced with each source's
//      own real momentum signal (TMDB trending/week, IGDB
//      popularity_primitives, a MangaDex active-by-follows proxy — see
//      lib/sources/{tmdb,igdb,mangadex}.ts) — distinct from catalog_items'
//      all-time popularity_score. Independent of stages A/B: a trending
//      title is very often already IN the catalog (trending_items only
//      stores rank + display data, not the source of truth for the title).
//   D. Collection self-heal — re-resolves the hand-curated title lists in
//      lib/collections.ts against the (possibly just-grown) catalog. The
//      lists themselves never change automatically.
// Nothing in the live app calls TMDB/IGDB/MangaDex — this cron and the
// manual ingest script are the only writers; every user-facing read stays
// table-only.

async function refreshUpcoming(type: string, fetchRows: () => Promise<UpcomingRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertUpcoming(rows);
  await pruneUpcoming(type, rows.map((r) => r.id));
  return rows.length;
}

async function ingestRecent(fetchRows: () => Promise<CatalogRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertCatalog(rows);
  return rows.length;
}

async function refreshTrending(type: string, fetchRows: () => Promise<TrendingRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertTrending(rows);
  await pruneTrending(type, rows.map((r) => r.id));
  return rows.length;
}

// Rotating artist-discography refresh. MusicBrainz's hard 1 req/s cap means
// refreshing EVERY catalog artist daily is impossible inside Vercel's 60s
// limit — instead each run refreshes a bounded budget: every followed
// artist first (they drive the Home feed and poll notifications), then the
// stalest of the rest. With daily runs the whole catalog still cycles over
// a couple of weeks, and followed artists are always fresh.
const ARTIST_REFRESH_PER_RUN = 20;

async function refreshArtistDiscographies(): Promise<number> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT c.id, c.metadata->>'mbid' AS mbid
    FROM catalog_items c
    WHERE c.type = 'artist'
    ORDER BY
      (c.id IN (SELECT 'artist:' || f.source_id FROM followed_items f WHERE f.type = 'artist')) DESC,
      c.updated_at ASC
    LIMIT ${ARTIST_REFRESH_PER_RUN}
  `) as unknown as { id: string; mbid: string | null }[];

  // Sequential on purpose: every artist's MusicBrainz call goes through the
  // same 1 req/s gate anyway, so parallelism buys nothing here.
  for (const row of rows) {
    const deezerId = row.id.slice(row.id.indexOf(":") + 1);
    await ingestArtist(deezerId, row.mbid);
  }
  return rows.length;
}

function settled(r: PromiseSettledResult<number>): number | { error: string } {
  return r.status === "fulfilled" ? r.value : { error: String(r.reason) };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Stages A, B, and C in parallel — different tables, and each entry is a
  // different source/type pair, so nothing contends. The artist refresh
  // rides alongside: it hits Deezer/MusicBrainz, which nothing else touches.
  const [upMovie, upTV, upGame, recMovie, recTV, recGame, recManga, trendMovie, trendTV, trendGame, trendManga, trendArtist, artistsRefreshed] = (
    await Promise.allSettled([
      refreshUpcoming("movie", discoverTMDBUpcomingMovies),
      refreshUpcoming("tvShow", discoverTMDBUpcomingTV),
      refreshUpcoming("game", discoverIGDBUpcoming),
      ingestRecent(discoverTMDBRecentMovies),
      ingestRecent(discoverTMDBRecentTV),
      ingestRecent(discoverIGDBRecent),
      ingestRecent(discoverMangaDexRecent),
      refreshTrending("movie", discoverTMDBTrendingMovies),
      refreshTrending("tvShow", discoverTMDBTrendingTV),
      refreshTrending("game", discoverIGDBTrending),
      refreshTrending("manga", discoverMangaDexTrending),
      refreshTrending("artist", discoverDeezerTrendingArtists),
      refreshArtistDiscographies(),
    ])
  ).map(settled);

  // Stage D after B so the rebuild sees any titles B just added.
  let collections: { totalItems: number; totalUnmatched: number } | { error: string };
  try {
    const summary = await rebuildAllCollections();
    collections = { totalItems: summary.totalItems, totalUnmatched: summary.totalUnmatched };
  } catch (err) {
    collections = { error: String(err) };
  }

  return NextResponse.json({
    upcoming: { movie: upMovie, tvShow: upTV, game: upGame },
    recent: { movie: recMovie, tvShow: recTV, game: recGame, manga: recManga },
    trending: { movie: trendMovie, tvShow: trendTV, game: trendGame, manga: trendManga, artist: trendArtist },
    artistsRefreshed,
    collections,
  });
}
