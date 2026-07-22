import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

// POST /api/mute  { itemID, subscription, muted }
// Mute/unmute pushes for one followed item on ONE device (mute state lives
// on subscription_follows — a phone and a laptop are separate
// subscriptions). Runs the same upsert chain as /api/follow first, because
// the pairing may not exist yet: a user can enable push AFTER having
// followed the item, and muting should still work immediately.
export async function POST(request: Request) {
  const { itemID, subscription, muted } = await request.json();
  if (!itemID || !subscription?.endpoint || !subscription?.keys || typeof muted !== "boolean") {
    return NextResponse.json({ error: "Missing itemID, subscription, or muted" }, { status: 400 });
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
    INSERT INTO subscription_follows (subscription_id, followed_item_id, muted)
    VALUES (${subscriptionId}, ${followedItemId}, ${muted})
    ON CONFLICT (subscription_id, followed_item_id) DO UPDATE SET muted = EXCLUDED.muted`;

  return NextResponse.json({ ok: true, muted });
}
