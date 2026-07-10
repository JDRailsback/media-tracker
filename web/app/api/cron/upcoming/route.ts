import { NextResponse } from "next/server";
import { discoverTMDBUpcomingMovies, discoverTMDBUpcomingTV } from "@/lib/sources/tmdb";
import { discoverIGDBUpcoming } from "@/lib/sources/igdb";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/upcoming — triggered daily by Vercel Cron (see vercel.json),
// same Authorization: Bearer CRON_SECRET pattern as /api/poll. Refreshes
// upcoming_items (see lib/upcoming.ts) — nothing in the live app calls
// TMDB/IGDB's upcoming endpoints directly; this cron is the only place that
// does, keeping every user-facing read catalog/table-only.
async function refresh(type: string, fetchRows: () => Promise<UpcomingRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertUpcoming(rows);
  await pruneUpcoming(type, rows.map((r) => r.id));
  return rows.length;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await Promise.allSettled([
    refresh("movie", discoverTMDBUpcomingMovies),
    refresh("tvShow", discoverTMDBUpcomingTV),
    refresh("game", discoverIGDBUpcoming),
  ]);

  const [movie, tvShow, game] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) }
  );
  return NextResponse.json({ movie, tvShow, game });
}
