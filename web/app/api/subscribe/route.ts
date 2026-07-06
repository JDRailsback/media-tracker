import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

// POST /api/subscribe  { subscription: <PushSubscription JSON> }
export async function POST(request: Request) {
  const { subscription } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await ensureSchema();
  const sql = db();
  await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    ON CONFLICT (endpoint)
    DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;

  return NextResponse.json({ ok: true });
}
