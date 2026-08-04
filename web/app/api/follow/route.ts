import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";

// POST /api/follow  { itemID: "movie:603", subscription: <PushSubscription JSON> | null }
//
// `subscription` is OPTIONAL: a follow from a device that never enabled push
// still registers the item in followed_items — the daily poll needs that row
// to exist to log notification HISTORY for the item (see /api/poll and
// notification_history in lib/db.ts). Delivering a push additionally
// requires the subscription link, which is only created when a subscription
// is supplied. Before this, a push-less follow left zero server-side trace,
// which made a history page impossible for anyone who hadn't granted
// notification permission.
//
// Signed-in requests scope the row to that account (user_id + active — see
// lib/db.ts's schema comment on followed_items.active) instead of the old
// global, unowned row; signed-out requests run exactly the original query
// unchanged, targeting the partial index scoped to user_id IS NULL. Either
// way, a supplied push subscription gets linked to the account too (when one
// exists), so every device signed into an account becomes eligible for that
// account's notifications without re-following anything per device.
export async function POST(request: Request) {
  const { itemID, subscription } = await request.json();
  if (!itemID) {
    return NextResponse.json({ error: "Missing itemID" }, { status: 400 });
  }

  const idx = String(itemID).indexOf(":");
  if (idx < 0) {
    return NextResponse.json({ error: "Invalid itemID" }, { status: 400 });
  }
  const type = String(itemID).slice(0, idx);
  const sourceId = String(itemID).slice(idx + 1);

  await ensureSchema();
  const sql = db();
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;

  const itemRows = (
    userId === null
      ? await sql`
          INSERT INTO followed_items (item_id, type, source_id)
          VALUES (${itemID}, ${type}, ${sourceId})
          ON CONFLICT (item_id) WHERE user_id IS NULL DO UPDATE SET item_id = EXCLUDED.item_id
          RETURNING id`
      : await sql`
          INSERT INTO followed_items (item_id, type, source_id, user_id, active)
          VALUES (${itemID}, ${type}, ${sourceId}, ${userId}, true)
          ON CONFLICT (user_id, item_id) DO UPDATE SET active = true
          RETURNING id`
  ) as unknown as { id: number }[];
  const followedItemId = itemRows[0].id;

  if (subscription?.endpoint && subscription?.keys) {
    const subRows = (await sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
      VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${userId})
      ON CONFLICT (endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id)
      RETURNING id`) as unknown as { id: number }[];
    const subscriptionId = subRows[0].id;

    await sql`
      INSERT INTO subscription_follows (subscription_id, followed_item_id)
      VALUES (${subscriptionId}, ${followedItemId})
      ON CONFLICT DO NOTHING`;
  }

  return NextResponse.json({ ok: true });
}
