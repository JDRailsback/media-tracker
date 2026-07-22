import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { details } from "@/lib/sources";
import { sendPush } from "@/lib/push";
import { daysBetween, describeRelease, parseReleaseDay } from "@/lib/feed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/poll — triggered by Vercel Cron (which sends Authorization:
// Bearer CRON_SECRET). Two alert triggers per followed item, each logged to
// notification_history exactly once (idempotent insert) and pushed only to
// eligible subscriptions:
//   1. CHANGE — the item's release date differs from the last poll's
//      snapshot (a date was set, moved, or an episode/release rolled over).
//      Logged even with ZERO subscribers: history must be complete for
//      devices that never enabled push (they read it via /api/notifications).
//   2. REMINDER — the release is exactly N days out, where N is a lead-time
//      some eligible subscriber actually configured. Only computed against
//      real subscribers (a reminder's only purpose is delivering a push).
// Eligibility = subscription follows the item, hasn't muted it, and hasn't
// muted its media type. Push failures never abort the run (sendPush never
// throws), and one bad item never aborts the loop.

interface SubscriberRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  muted_types: string[] | null;
  lead_time_days: number;
  item_muted: boolean;
}

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
  let logged = 0;

  // The idempotency layer: ON CONFLICT DO NOTHING RETURNING id yields a row
  // ONLY on a genuinely new event — re-running the poll the same day (or a
  // manual trigger alongside the cron) logs nothing twice and, because the
  // push send is gated on this insert, never double-notifies either.
  async function logEvent(
    followedItemId: number,
    itemId: string,
    eventType: "change" | "reminder",
    leadDays: number,
    releaseDay: string,
    title: string,
    subtitle: string | null,
    message: string
  ): Promise<boolean> {
    const rows = await sql`
      INSERT INTO notification_history (followed_item_id, item_id, event_type, lead_days, release_date, title, subtitle, message)
      VALUES (${followedItemId}, ${itemId}, ${eventType}, ${leadDays}, ${releaseDay}, ${title}, ${subtitle}, ${message})
      ON CONFLICT (followed_item_id, event_type, release_date, lead_days) DO NOTHING
      RETURNING id`;
    if (rows.length > 0) logged++;
    return rows.length > 0;
  }

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

      // No known upcoming date — nothing to announce or remind about.
      if (!fetched.releaseDate || !newDate) continue;
      const releaseDay = fetched.releaseDate.slice(0, 10);

      const subs = (await sql`
        SELECT ps.endpoint, ps.p256dh, ps.auth, ps.muted_types, ps.lead_time_days, sf.muted AS item_muted
        FROM push_subscriptions ps
        JOIN subscription_follows sf ON sf.subscription_id = ps.id
        WHERE sf.followed_item_id = ${item.id}`) as unknown as SubscriberRow[];
      const eligible = subs.filter(
        (s) => !s.item_muted && !(s.muted_types ?? []).includes(item.type)
      );

      // Same phrasing engine the feed uses ("New episode Friday, 9:00 PM")
      // — followedAt is irrelevant to describeRelease, hence the stub.
      const release = describeRelease({ ...fetched, followedAt: "" });
      const detail = fetched.subtitle ? `${fetched.title}: ${fetched.subtitle}` : fetched.title;
      const message = `${detail} — ${release?.label ?? releaseDay}`;

      if (!firstCheck && changed) {
        if (await logEvent(item.id, item.item_id, "change", -1, releaseDay, fetched.title, fetched.subtitle ?? null, message)) {
          for (const s of eligible) {
            const ok = await sendPush(
              { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
              { title: "New release date", body: message, url: "/?view=notifications" }
            );
            if (ok) notified++;
          }
        }
      }

      // Reminder trigger — independent of whether the date changed this run.
      const diffDays = daysBetween(parseReleaseDay(fetched.releaseDate), new Date());
      if (diffDays > 0) {
        const leads = [...new Set(eligible.filter((s) => s.lead_time_days > 0).map((s) => s.lead_time_days))];
        for (const lead of leads) {
          if (lead !== diffDays) continue;
          if (await logEvent(item.id, item.item_id, "reminder", lead, releaseDay, fetched.title, fetched.subtitle ?? null, message)) {
            for (const s of eligible.filter((x) => x.lead_time_days === lead)) {
              const ok = await sendPush(
                { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
                { title: `${lead} day${lead === 1 ? "" : "s"} until release`, body: message, url: "/?view=notifications" }
              );
              if (ok) notified++;
            }
          }
        }
      }
    } catch (err) {
      console.error(`poll failed for ${item.item_id}`, err);
    }
  }

  return NextResponse.json({ checked: items.length, logged, notified });
}
