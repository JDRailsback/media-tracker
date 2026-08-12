import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";

// POST /api/subscribe  { subscription: <PushSubscription JSON> }
// Account-only — 401s without a session (enabling push is one of the
// account-gated actions, same as follow/dugout/mute/prefs).
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { subscription } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await ensureSchema();
  const sql = db();
  await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
    VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${userId})
    ON CONFLICT (endpoint)
    DO UPDATE SET
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_id = ${userId}`;

  return NextResponse.json({ ok: true });
}

// DELETE /api/subscribe  { endpoint } — the missing counterpart to POST:
// forgets this device's push subscription entirely (see lib/push-client.ts's
// disablePush). ON DELETE CASCADE on subscription_follows means this also
// drops whatever items/mutes were tied to it — correct, since a gone
// subscription can't be pushed to or muted anyway.
export async function DELETE(request: Request) {
  const { endpoint } = await request.json();
  if (!endpoint || typeof endpoint !== "string") {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  return NextResponse.json({ ok: true });
}
