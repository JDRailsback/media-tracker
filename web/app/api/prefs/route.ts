import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

// POST /api/prefs  { subscription, mutedTypes?, leadTimeDays? }
// -> { mutedTypes, leadTimeDays, mutedItemIds }
//
// One route for both reading and updating this device's notification
// preferences: with no update fields it just returns the current state.
// Deliberately POST-only (no GET ?endpoint=...) — a push endpoint is a
// capability URL, and query strings end up in server/proxy logs.
export async function POST(request: Request) {
  const { subscription, mutedTypes, leadTimeDays } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "Missing subscription" }, { status: 400 });
  }

  await ensureSchema();
  const sql = db();

  const subRows = await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    RETURNING id, muted_types, lead_time_days`;
  const subscriptionId = subRows[0].id;

  let finalMutedTypes = subRows[0].muted_types ?? [];
  let finalLeadTime = subRows[0].lead_time_days ?? 0;

  if (Array.isArray(mutedTypes)) {
    finalMutedTypes = mutedTypes.map(String);
    await sql`
      UPDATE push_subscriptions SET muted_types = ${JSON.stringify(finalMutedTypes)}::jsonb
      WHERE id = ${subscriptionId}`;
  }
  if (Number.isInteger(leadTimeDays) && leadTimeDays >= 0) {
    finalLeadTime = leadTimeDays;
    await sql`
      UPDATE push_subscriptions SET lead_time_days = ${leadTimeDays}
      WHERE id = ${subscriptionId}`;
  }

  // Per-item mutes ride along so DetailModal/artist pages can show an
  // item's current mute state from one call instead of a dedicated route.
  const mutedRows = (await sql`
    SELECT fi.item_id
    FROM subscription_follows sf
    JOIN followed_items fi ON fi.id = sf.followed_item_id
    WHERE sf.subscription_id = ${subscriptionId} AND sf.muted = true`) as unknown as { item_id: string }[];

  return NextResponse.json({
    mutedTypes: finalMutedTypes,
    leadTimeDays: finalLeadTime,
    mutedItemIds: mutedRows.map((r) => r.item_id),
  });
}
