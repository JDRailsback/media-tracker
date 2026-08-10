import { NextResponse } from "next/server";
import { refreshUpcomingCalendar } from "@/lib/upcomingCalendar";
import { refreshDiscoverSnapshot } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/refresh-calendar — stages E/F of the daily refresh (see
// app/api/cron/daily/route.ts's own top comment for A-D), split into a
// SEPARATE function invocation rather than run inline at the end of that
// route. Not declared in vercel.json's `crons` list — the Hobby plan caps
// that at two jobs (poll + daily already use both slots) — so this is only
// ever reached by /api/cron/daily's own server-to-server trigger, never
// Vercel's scheduler directly. Same Bearer CRON_SECRET auth as the two
// real cron routes; the secret is what actually gates this, not whether
// Vercel itself dispatched the request.
//
// Why this exists: stages A-D alone were already measured at ~57.8s of
// real wall-clock time (see lib/sources/tmdb.ts's OFFICIAL_STATUS_CONCURRENCY
// comment) — uncomfortably close to Vercel's 60s function limit even
// before E's own Trakt calls are added on top. Vercel kills an invocation
// at its maxDuration with no partial save for whatever stage was
// mid-flight, so once Trakt started actually returning real (non-instant-
// error) data, the combined A-F runtime started timing out the whole cron
// — verified live: upcoming_items refreshed fine, upcoming_calendar and
// the Discover snapshot silently never updated because the function died
// partway through E. Splitting E/F into their own invocation gives them a
// fresh 60s budget, independent of how long A-D just took.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let upcomingCalendar: { count: number } | { error: string };
  try {
    upcomingCalendar = await refreshUpcomingCalendar();
  } catch (err) {
    upcomingCalendar = { error: String(err) };
  }

  let discoverSnapshot: { ok: true } | { error: string };
  try {
    await refreshDiscoverSnapshot();
    discoverSnapshot = { ok: true };
  } catch (err) {
    discoverSnapshot = { error: String(err) };
  }

  return NextResponse.json({ upcomingCalendar, discoverSnapshot });
}
