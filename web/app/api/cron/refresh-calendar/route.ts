import { NextResponse } from "next/server";
import { refreshUpcomingCalendar } from "@/lib/upcomingCalendar";
import { refreshDiscoverSnapshot } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/refresh-calendar — stages E/F of the daily refresh (see
// app/api/cron/daily/route.ts's own top comment for A, and its sibling
// routes for B/C/D), split into a SEPARATE function invocation rather than
// run inline at the end of refresh-collections. Not declared in
// vercel.json's `crons` list — the Hobby plan caps that at two jobs (poll +
// daily already use both slots) — so this is only ever reached via the
// chain's own server-to-server triggers, never Vercel's scheduler directly.
// Same Bearer CRON_SECRET auth as the two real cron routes; the secret is
// what actually gates this, not whether Vercel itself dispatched the
// request.
//
// Why this exists: the combined A-F runtime used to time out the whole
// cron before E/F ever ran — verified live twice now, at two different
// stage boundaries as the pipeline grew (originally A-D, most recently B/C
// alone measuring 46.3s — see refresh-collections/route.ts). Each time,
// Vercel killed the invocation at its maxDuration with no partial save for
// whatever stage was mid-flight — upcoming_items/catalog_items refreshed
// fine, upcoming_calendar and the Discover snapshot silently never updated
// because the function died before reaching them. Splitting E/F into their
// own invocation gives them a fresh 60s budget, independent of how long the
// stages before it just took.
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
