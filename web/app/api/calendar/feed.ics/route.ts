import { db, ensureSchema } from "@/lib/db";
import { details } from "@/lib/sources";
import { releaseEntriesFor } from "@/lib/releaseEntries";
import { buildCalendar, type ICSEvent } from "@/lib/ics";

// GET /api/calendar/feed.ics — a standard iCalendar subscription feed of
// every followed item's upcoming release date(s), for "Add calendar from
// URL" in Google Calendar / Apple Calendar / Outlook. One-way (this app
// never reads anything back). Before any account exists, followed_items is
// still a single global list (see lib/db.ts's schema comment) and this
// stays unauthenticated exactly as before — nobody to scope to yet. The
// moment a first account exists, an unscoped feed would leak that
// account's follows to anyone with the URL, so it switches to requiring
// ?token=<calendar_token> (a capability URL, same trust model as before,
// just now per-account instead of app-wide) and only ever returns that
// account's active follows. Same releaseEntriesFor used by the in-app
// Calendar view (app/page.tsx), so the two can never show different things.
export const dynamic = "force-dynamic";

interface FollowedRow {
  item_id: string;
  type: string;
  source_id: string;
}

export async function GET(request: Request) {
  await ensureSchema();
  const sql = db();

  const anyUsers = (await sql`SELECT 1 FROM users LIMIT 1`) as unknown as unknown[];

  let rows: FollowedRow[];
  if (anyUsers.length === 0) {
    rows = (await sql`SELECT item_id, type, source_id FROM followed_items`) as unknown as FollowedRow[];
  } else {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      return new Response("Missing calendar token", { status: 403 });
    }
    const userRows = (await sql`SELECT id FROM users WHERE calendar_token = ${token}`) as unknown as {
      id: number;
    }[];
    if (userRows.length === 0) {
      return new Response("Invalid calendar token", { status: 403 });
    }
    rows = (await sql`
      SELECT item_id, type, source_id FROM followed_items
      WHERE user_id = ${userRows[0].id} AND active = true`) as unknown as FollowedRow[];
  }

  const events: ICSEvent[] = [];

  for (const row of rows) {
    try {
      const item = await details(row.type, row.source_id);
      for (const entry of releaseEntriesFor(item)) {
        events.push({
          uid: `${row.item_id}${entry.uidSuffix ? `-${entry.uidSuffix}` : ""}@trackr`,
          date: entry.date,
          summary: entry.subtitle ?? entry.title,
          description: item.overview,
        });
      }
    } catch (err) {
      console.error(`ICS feed: failed to resolve ${row.item_id}`, err);
    }
  }

  const ics = buildCalendar(events, "Trackr");
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="trackr.ics"',
      // Calendar apps re-poll a subscribed feed on their own schedule
      // (typically every few hours) — an hour of edge/browser caching here
      // costs nothing in practical freshness and saves re-resolving every
      // followed item's details on every single poll.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
