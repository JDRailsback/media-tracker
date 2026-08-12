import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";

// POST /api/mute  { itemID, subscription, muted }
// Account-only — 401s without a session. Mute/unmute pushes for one
// followed item on ONE device (mute state lives on subscription_follows —
// a phone and a laptop are separate subscriptions, so muting is a
// per-device choice, not an account-wide one). Runs the same upsert chain
// as /api/follow first, because the pairing may not exist yet: a user can
// enable push AFTER having followed the item, and muting should still work
// immediately.
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

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

  const subRows = (await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
    VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${userId})
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id)
    RETURNING id`) as unknown as { id: number }[];
  const subscriptionId = subRows[0].id;

  const itemRows = (await sql`
    INSERT INTO followed_items (item_id, type, source_id, user_id, active)
    VALUES (${itemID}, ${type}, ${sourceId}, ${userId}, true)
    ON CONFLICT (user_id, item_id) DO UPDATE SET active = true
    RETURNING id`) as unknown as { id: number }[];
  const followedItemId = itemRows[0].id;

  await sql`
    INSERT INTO subscription_follows (subscription_id, followed_item_id, muted)
    VALUES (${subscriptionId}, ${followedItemId}, ${muted})
    ON CONFLICT (subscription_id, followed_item_id) DO UPDATE SET muted = EXCLUDED.muted`;

  return NextResponse.json({ ok: true, muted });
}
