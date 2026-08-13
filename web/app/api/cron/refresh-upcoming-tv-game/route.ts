import { NextResponse } from "next/server";
import { discoverTMDBUpcomingTV } from "@/lib/sources/tmdb";
import { discoverIGDBUpcoming } from "@/lib/sources/igdb";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/refresh-upcoming-tv-game — second link in the daily chain,
// triggered by /api/cron/daily's own waitUntil (see that route's comment
// for why movies was split out from this). TV (~170 candidates, same
// per-item official-status fetch movies uses) and games (bulk IGDB
// queries, no per-item network call) are both light enough to safely share
// one invocation. Not in vercel.json's `crons` list — only ever reached
// via the chain, gated by the same CRON_SECRET check as every other stage.
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

  const [upTV, upGame] = (
    await Promise.allSettled([
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
    upcoming: { tvShow: upTV, game: upGame },
    nextStage: "triggered", // see /api/cron/refresh-recent for its own result
  });
}
