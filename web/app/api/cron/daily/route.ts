import { NextResponse } from "next/server";
import { discoverTMDBUpcomingMovies } from "@/lib/sources/tmdb";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/daily — the ONLY stage still triggered directly by Vercel
// Cron (see vercel.json; Hobby allows just two cron jobs, and /api/poll has
// the other slot). Same Authorization: Bearer CRON_SECRET pattern as
// /api/poll. This used to run every stage of the daily refresh inline —
// see git history, or /api/cron/refresh-upcoming-tv-game,
// /api/cron/refresh-recent, and /api/cron/refresh-calendar for where the
// rest of it lives now.
//
// Movies ONLY now — split out from what used to also include TV and games
// in one invocation. Verified LIVE in Vercel's own cron log (not just
// measured locally): a real scheduled run hit "Task timed out after 60
// seconds" and got killed outright, silently starving every downstream
// stage for a full day since the waitUntil trigger to the next stage never
// even ran. Movies is the heaviest piece by a wide margin on its own —
// ~2,500+ candidates each needing a per-item official-status fetch (see
// lib/sources/tmdb.ts's filterOfficialOnly/OFFICIAL_STATUS_CONCURRENCY) —
// so it gets its own full 60s budget; TV (~170 candidates, same
// per-item check but a fraction of the volume) and games (bulk IGDB
// queries, no per-item fetch at all) are cheap enough to share the next
// stage safely.
//
// Chained via a fire-and-forget server-to-server call at the end, same
// pattern used again at the end of every later stage: waitUntil keeps THIS
// invocation alive just long enough to guarantee the trigger request is
// actually sent, not dropped the instant this handler returns. Once
// Vercel has received it, the next stage runs as its own fully independent
// invocation — with its own fresh 60s budget — regardless of what happens
// to this one afterward. No downstream route is in vercel.json's `crons`
// list (same Hobby two-job cap as above), so they're only ever reached
// this way, never by Vercel's scheduler directly — the CRON_SECRET check
// each one does on its own is what actually gates them.
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

  let upMovie: number | { error: string };
  try {
    upMovie = await refreshUpcoming("movie", discoverTMDBUpcomingMovies);
  } catch (err) {
    upMovie = { error: String(err) };
  }

  const origin = new URL(request.url).origin;
  waitUntil(
    fetch(`${origin}/api/cron/refresh-upcoming-tv-game`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }).catch((err) => {
      console.error("Failed to trigger /api/cron/refresh-upcoming-tv-game", err);
    })
  );

  return NextResponse.json({
    upcoming: { movie: upMovie },
    nextStage: "triggered", // see /api/cron/refresh-upcoming-tv-game for its own result
  });
}
