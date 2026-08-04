import { db } from "@/lib/db";

// The person who's been using this app solo all along (via the old global,
// no-owner followed_items/dugout_items rows) shouldn't lose their current
// follows/queue the moment they create the first account — this claims
// every orphaned (user_id IS NULL) row for that account. A SECOND signup
// must start empty, not inherit anything: gated by checking the total user
// count AFTER this user's own insert — if it's exactly 1, this row just
// created is provably the only account that has ever existed, so it's safe
// to claim; any count other than 1 means either an earlier signup already
// claimed everything, or this genuinely isn't the first account.
export async function claimLegacyDataIfFirstUser(userId: number): Promise<void> {
  const sql = db();
  const rows = (await sql`SELECT count(*)::int AS n FROM users`) as unknown as { n: number }[];
  if (rows[0]?.n !== 1) return;
  await sql`UPDATE followed_items SET user_id = ${userId} WHERE user_id IS NULL`;
  await sql`UPDATE dugout_items SET user_id = ${userId} WHERE user_id IS NULL`;
}
