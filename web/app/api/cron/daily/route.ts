import { NextResponse } from "next/server";
import { discoverTMDBUpcomingMovies, discoverTMDBUpcomingTV } from "@/lib/sources/tmdb";
import { discoverIGDBUpcoming } from "@/lib/sources/igdb";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/daily — the ONLY stage still triggered directly by Vercel
// Cron (see vercel.json; Hobby allows just two cron jobs, and /api/poll has
// the other slot). Same Authorization: Bearer CRON_SECRET pattern as
// /api/poll. This used to run every stage of the daily refresh inline —
// see git history, or /api/cron/refresh-recent and /api/cron/refresh-calendar
// for where the rest of it lives now.
//
// Stage A only: upcoming_items replaced with the current biggest
// unreleased/announced titles (dated or not), per type. Kept alone in the
// one route Vercel's scheduler actually calls because it's the single
// heaviest stage by a wide margin — the per-item official-status check in
// filterOfficialOnly (see lib/sources/tmdb.ts's OFFICIAL_STATUS_CONCURRENCY
// comment) was already measured at ~57.8s of real wall-clock time on its
// own, uncomfortably close to Vercel's 60s function limit even before any
// other stage's work is added. Everything downstream (recent releases,
// trending, artist/followed-show refreshes, collections, the upcoming
// calendar, the Discover snapshot) used to run inline after this and
// routinely pushed the combined runtime over budget — verified live,
// repeatedly: Vercel kills an invocation at maxDuration with no partial
// save for whatever stage was mid-flight, so a downstream table could
// simply never update for days with no visible error, only a stale
// timestamp to notice by hand.
//
// Chained via a fire-and-forget server-to-server call at the end, same
// pattern used again at the end of refresh-recent: waitUntil keeps THIS
// invocation alive just long enough to guarantee the trigger request is
// actually sent, not dropped the instant this handler returns. Once
// Vercel has received it, refresh-recent runs as its own fully independent
// invocation — with its own fresh 60s budget — regardless of what happens
// to this one afterward. Neither downstream route is in vercel.json's
// `crons` list (same Hobby two-job cap as above), so they're only ever
// reached this way, never by Vercel's scheduler directly — the
// CRON_SECRET check each one does on its own is what actually gates them.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  async function refreshUpcoming(type: string, fetchRows: () => Promise<UpcomingRow[]>): Promise<number> {
    const rows = await fetchRows();
    await upsertUpcoming(rows);
    await pruneUpcoming(type, rows.map((r) => r.id));
    return rows.length;
  }

  function settled(r: PromiseSettledResult<number>): number | { error: string } {
    return r.status === "fulfilled" ? r.value : { error: String(r.reason) };
  }

  const [upMovie, upTV, upGame] = (
    await Promise.allSettled([
      refreshUpcoming("movie", discoverTMDBUpcomingMovies),
      refreshUpcoming("tvShow", discoverTMDBUpcomingTV),
      refreshUpcoming("game", discoverIGDBUpcoming),
    ])
  ).map(settled);

  const origin = new URL(request.url).origin;
  waitUntil(
    fetch(`${origin}/api/cron/refresh-recent`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }).catch((err) => {
      console.error("Failed to trigger /api/cron/refresh-recent", err);
    })
  );

  return NextResponse.json({
    upcoming: { movie: upMovie, tvShow: upTV, game: upGame },
    nextStage: "triggered", // see /api/cron/refresh-recent for its own result
  });
}
