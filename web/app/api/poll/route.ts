import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { details } from "@/lib/sources";
import { sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/poll — triggered by Vercel Cron (which sends Authorization: Bearer CRON_SECRET).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const sql = db();
  const items = await sql`
    SELECT id, item_id, type, source_id, last_known_release_date, last_checked_at
    FROM followed_items`;

  let notified = 0;

  for (const item of items) {
    try {
      const fetched = await details(item.type, item.source_id);
      const newDate = fetched.releaseDate ? new Date(fetched.releaseDate) : null;
      const oldDate = item.last_known_release_date ? new Date(item.last_known_release_date) : null;
      const firstCheck = !item.last_checked_at;
      const changed = (newDate?.getTime() ?? null) !== (oldDate?.getTime() ?? null);

      await sql`
        UPDATE followed_items
        SET last_known_release_date = ${newDate ? newDate.toISOString() : null},
            last_checked_at = now()
        WHERE id = ${item.id}`;

      if (!firstCheck && changed && newDate) {
        const subs = await sql`
          SELECT ps.endpoint, ps.p256dh, ps.auth
          FROM push_subscriptions ps
          JOIN subscription_follows sf ON sf.subscription_id = ps.id
          WHERE sf.followed_item_id = ${item.id}`;

        // Prefer subtitle when present — for a franchise, `title` alone is
        // just the franchise name ("Star Wars"), giving no indication of
        // *which* part is releasing. subtitle carries that ("Next: Ahsoka"),
        // and TV shows already have one too (e.g. "S2 E4") that was
        // previously being ignored here.
        const body = fetched.subtitle
          ? `${fetched.title}: ${fetched.subtitle} — ${newDate.toDateString()}`
          : `${fetched.title} — now releasing ${newDate.toDateString()}`;
        for (const s of subs) {
          const ok = await sendPush(
            { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
            { title: "New release date", body, url: "/" }
          );
          if (ok) notified++;
        }
      }
    } catch (err) {
      console.error(`poll failed for ${item.item_id}`, err);
    }
  }

  return NextResponse.json({ checked: items.length, notified });
}
