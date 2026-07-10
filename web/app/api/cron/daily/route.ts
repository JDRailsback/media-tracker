import { NextResponse } from "next/server";
import {
  discoverTMDBUpcomingMovies,
  discoverTMDBUpcomingTV,
  discoverTMDBRecentMovies,
  discoverTMDBRecentTV,
} from "@/lib/sources/tmdb";
import { discoverIGDBUpcoming, discoverIGDBRecent } from "@/lib/sources/igdb";
import { discoverMangaDexRecent } from "@/lib/sources/mangadex";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";
import { upsertCatalog } from "@/lib/catalog";
import type { CatalogRow } from "@/lib/catalog";
import { rebuildAllCollections } from "@/lib/collections-rebuild";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/daily — the one daily data-refresh job, triggered by Vercel
// Cron (see vercel.json; Hobby allows only two cron jobs, and /api/poll has
// the other slot — hence one consolidated endpoint rather than one per
// concern). Same Authorization: Bearer CRON_SECRET pattern as /api/poll.
// Three stages:
//   A. Upcoming refresh — upcoming_items replaced with the current biggest
//      unreleased/announced titles (dated or not).
//   B. Recent releases — titles released in the last ~30 days upserted into
//      catalog_items (all four types, manga included). This is what
//      "graduates" a title the day it releases: stage A prunes it from
//      upcoming_items, stage B lands it in the catalog. Re-running the whole
//      window daily also keeps a fresh title's score/poster/metadata
//      self-correcting for a month.
//   C. Collection self-heal — re-resolves the hand-curated title lists in
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

function settled(r: PromiseSettledResult<number>): number | { error: string } {
  return r.status === "fulfilled" ? r.value : { error: String(r.reason) };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Stages A and B in parallel — different tables, and each entry is a
  // different source/type pair, so nothing contends.
  const [upMovie, upTV, upGame, recMovie, recTV, recGame, recManga] = (
    await Promise.allSettled([
      refreshUpcoming("movie", discoverTMDBUpcomingMovies),
      refreshUpcoming("tvShow", discoverTMDBUpcomingTV),
      refreshUpcoming("game", discoverIGDBUpcoming),
      ingestRecent(discoverTMDBRecentMovies),
      ingestRecent(discoverTMDBRecentTV),
      ingestRecent(discoverIGDBRecent),
      ingestRecent(discoverMangaDexRecent),
    ])
  ).map(settled);

  // Stage C after B so the rebuild sees any titles B just added.
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
    collections,
  });
}
