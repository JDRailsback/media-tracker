import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";

// POST /api/unfollow  { itemID, subscription }
//
// Signed-in requests mark the account's row inactive (never delete — see
// followed_items.active's schema comment: notification_history's FK means
// deleting the row would erase that item's history). Anyone with a push
// subscription also gets that device's push link cleared, same as before —
// unfollowing should stop pushes to whichever device asked, account or not.
export async function POST(request: Request) {
  const { itemID, subscription } = await request.json();
  if (!itemID) {
    return NextResponse.json({ error: "Missing itemID" }, { status: 400 });
  }

  await ensureSchema();
  const sql = db();
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;

  if (userId !== null) {
    await sql`UPDATE followed_items SET active = false WHERE user_id = ${userId} AND item_id = ${itemID}`;
  }

  if (subscription?.endpoint) {
    await sql`
      DELETE FROM subscription_follows sf
      USING push_subscriptions ps, followed_items fi
      WHERE sf.subscription_id = ps.id
        AND sf.followed_item_id = fi.id
        AND ps.endpoint = ${subscription.endpoint}
        AND fi.item_id = ${itemID}`;
  }

  return NextResponse.json({ ok: true });
}
