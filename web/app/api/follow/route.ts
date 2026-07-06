import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

// POST /api/follow  { itemID: "movie:603", subscription: <PushSubscription JSON> }
export async function POST(request: Request) {
  const { itemID, subscription } = await request.json();
  if (!itemID || !subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "Missing itemID or subscription" }, { status: 400 });
  }

  const idx = String(itemID).indexOf(":");
  if (idx < 0) {
    return NextResponse.json({ error: "Invalid itemID" }, { status: 400 });
  }
  const type = String(itemID).slice(0, idx);
  const sourceId = String(itemID).slice(idx + 1);

  await ensureSchema();
  const sql = db();

  const subRows = await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    RETURNING id`;
  const subscriptionId = subRows[0].id;

  const itemRows = await sql`
    INSERT INTO followed_items (item_id, type, source_id)
    VALUES (${itemID}, ${type}, ${sourceId})
    ON CONFLICT (item_id) DO UPDATE SET item_id = EXCLUDED.item_id
    RETURNING id`;
  const followedItemId = itemRows[0].id;

  await sql`
    INSERT INTO subscription_follows (subscription_id, followed_item_id)
    VALUES (${subscriptionId}, ${followedItemId})
    ON CONFLICT DO NOTHING`;

  return NextResponse.json({ ok: true });
}
