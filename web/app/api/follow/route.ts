import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";

// POST /api/follow  { itemID: "movie:603", subscription: <PushSubscription JSON> | null }
//
// Account-only — 401s without a session (see this file's own history: a
// signed-out request used to write an unowned global row; that anonymous
// mode was removed entirely). `subscription` is still OPTIONAL: a follow
// from a device that never enabled push still registers the item in
// followed_items — the daily poll needs that row to exist to log
// notification HISTORY for the item (see /api/poll and notification_history
// in lib/db.ts). Delivering a push additionally requires the subscription
// link, which is only created when a subscription is supplied.
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

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

  const itemRows = (await sql`
    INSERT INTO followed_items (item_id, type, source_id, user_id, active)
    VALUES (${itemID}, ${type}, ${sourceId}, ${userId}, true)
    ON CONFLICT (user_id, item_id) DO UPDATE SET active = true
    RETURNING id`) as unknown as { id: number }[];
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
