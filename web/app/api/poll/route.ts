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
//   1. RELEASE DAY (lead_days = 0) — the release is today. Unconditional
//      default for every followed item, regardless of that item's/device's
//      lead-time preference — this is the one notification every follow is
//      guaranteed to get. ("Change" notifications — the release date being
//      set or moved — used to fire here too, explicitly turned off: they
//      were noisy and repetitive, especially for anything whose date shifts
//      more than once before it actually airs. If you only care that
//      something's actually out, that's this trigger.)
//   2. REMINDER (lead_days > 0) — the release is exactly N days out, where N
//      is a lead-time some eligible subscriber actually configured (see
//      Settings → Release reminders). Purely additive on top of trigger 1,
//      for anyone who wants an advance heads-up too.
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
  // last_known_release_date/last_checked_at are write-only bookkeeping now
  // (kept updated below in case a future feature wants a "when did this
  // last change" signal) — nothing in this route reads them anymore, since
  // date-change detection was the one thing that used to need them.
  const items = await sql`
    SELECT id, item_id, type, source_id
    FROM followed_items`;

  let notified = 0;
  let logged = 0;
  let pruned = 0;

  // A subscription the push service itself says is gone for good (endpoint
  // 404/410 — unsubscribed, expired, or silently rotated by the browser)
  // gets removed here instead of being left to fail the exact same way on
  // every future poll forever. ON DELETE CASCADE takes subscription_follows
  // rows with it.
  async function pushAndPrune(sub: SubscriberRow, payload: object): Promise<boolean> {
    const result = await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload);
    if (result.gone) {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
      pruned++;
    }
    return result.ok;
  }

  // The idempotency layer: ON CONFLICT DO NOTHING RETURNING id yields a row
  // ONLY on a genuinely new event — re-running the poll the same day (or a
  // manual trigger alongside the cron) logs nothing twice and, because the
  // push send is gated on this insert, never double-notifies either.
  async function logEvent(
    followedItemId: number,
    itemId: string,
    leadDays: number,
    releaseDay: string,
    title: string,
    subtitle: string | null,
    message: string
  ): Promise<boolean> {
    const rows = await sql`
      INSERT INTO notification_history (followed_item_id, item_id, event_type, lead_days, release_date, title, subtitle, message)
      VALUES (${followedItemId}, ${itemId}, 'reminder', ${leadDays}, ${releaseDay}, ${title}, ${subtitle}, ${message})
      ON CONFLICT (followed_item_id, event_type, release_date, lead_days) DO NOTHING
      RETURNING id`;
    if (rows.length > 0) logged++;
    return rows.length > 0;
  }

  for (const item of items) {
    try {
      const fetched = await details(item.type, item.source_id);
      const newDate = fetched.releaseDate ? new Date(fetched.releaseDate) : null;

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
      // Shown as the push notification's icon (see public/sw.js) — a
      // followed title's own poster instead of the app's generic icon,
      // so the notification itself is identifiable at a glance.
      const icon = fetched.posterURL;

      const diffDays = daysBetween(parseReleaseDay(fetched.releaseDate), new Date());

      // Trigger 1: release day, unconditional — every followed item gets
      // this regardless of any lead-time preference (see this route's
      // top-of-file comment for why "change" notifications were removed
      // instead of kept alongside this).
      if (diffDays === 0) {
        if (await logEvent(item.id, item.item_id, 0, releaseDay, fetched.title, fetched.subtitle ?? null, message)) {
          for (const s of eligible) {
            const ok = await pushAndPrune(s, { title: "Releasing today", body: message, url: "/?view=notifications", icon });
            if (ok) notified++;
          }
        }
      }

      // Trigger 2: optional advance heads-up, additive on top of trigger 1 —
      // only for subscribers who set a lead time in Settings.
      if (diffDays > 0) {
        const leads = [...new Set(eligible.filter((s) => s.lead_time_days > 0).map((s) => s.lead_time_days))];
        for (const lead of leads) {
          if (lead !== diffDays) continue;
          if (await logEvent(item.id, item.item_id, lead, releaseDay, fetched.title, fetched.subtitle ?? null, message)) {
            for (const s of eligible.filter((x) => x.lead_time_days === lead)) {
              const ok = await pushAndPrune(s, {
                title: `${lead} day${lead === 1 ? "" : "s"} until release`,
                body: message,
                url: "/?view=notifications",
                icon,
              });
              if (ok) notified++;
            }
          }
        }
      }
    } catch (err) {
      console.error(`poll failed for ${item.item_id}`, err);
    }
  }

  return NextResponse.json({ checked: items.length, logged, notified, pruned });
}
