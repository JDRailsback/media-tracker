import { NextResponse } from "next/server";
import { rebuildAllCollections } from "@/lib/collections-rebuild";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/refresh-collections — stage D of the daily refresh (see
// app/api/cron/daily/route.ts's own top comment for A, refresh-upcoming-tv-
// game for the rest of B, refresh-recent for B/C). Split into its own
// invocation for the same reason as every other split in this chain: a
// fresh 60s budget instead of inheriting whatever refresh-recent's B/C had
// left. Verified live it was needed, not just precautionary — a manual
// timing run of refresh-recent's B/C (recent releases + trending + artist +
// followed-show refreshes, all concurrent) alone measured 46.3s, uncomfortably
// close to the cap on a day with nothing unusually slow; D (collection
// rebuild) and the trigger to E/F used to run inline at the end of that same
// invocation, so any day B/C ran a little slower than this measurement would
// silently kill the whole chain before D or the E/F trigger ever ran —
// exactly the "upcoming_items refreshed, upcoming_calendar/new_releases
// didn't" symptom this file's sibling routes' comments describe from the
// A-D/E-F split, recurring one boundary later.
//   D. Collection self-heal — re-resolves the hand-curated title lists in
//      lib/collections.ts against the (possibly just-grown) catalog. The
//      lists themselves never change automatically. Runs after B so it sees
//      any titles B just added.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let collections: { totalItems: number; totalUnmatched: number } | { error: string };
  try {
    const summary = await rebuildAllCollections();
    collections = { totalItems: summary.totalItems, totalUnmatched: summary.totalUnmatched };
  } catch (err) {
    collections = { error: String(err) };
  }

  const origin = new URL(request.url).origin;
  waitUntil(
    fetch(`${origin}/api/cron/refresh-calendar`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }).catch((err) => {
      console.error("Failed to trigger /api/cron/refresh-calendar", err);
    })
  );

  return NextResponse.json({
    collections,
    nextStage: "triggered", // see /api/cron/refresh-calendar for its own result
  });
}
