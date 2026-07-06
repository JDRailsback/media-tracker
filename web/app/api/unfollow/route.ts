import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

// POST /api/unfollow  { itemID, subscription }
export async function POST(request: Request) {
  const { itemID, subscription } = await request.json();
  if (!itemID || !subscription?.endpoint) {
    return NextResponse.json({ error: "Missing itemID or subscription" }, { status: 400 });
  }

  await ensureSchema();
  const sql = db();
  await sql`
    DELETE FROM subscription_follows sf
    USING push_subscriptions ps, followed_items fi
    WHERE sf.subscription_id = ps.id
      AND sf.followed_item_id = fi.id
      AND ps.endpoint = ${subscription.endpoint}
      AND fi.item_id = ${itemID}`;

  return NextResponse.json({ ok: true });
}
