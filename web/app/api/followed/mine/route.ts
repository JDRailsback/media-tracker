import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";
import { details } from "@/lib/sources";
import type { MediaItem } from "@/lib/types";

// GET /api/followed/mine
// -> FollowedItem[] ({ ...MediaItem, followedAt })
//
// Session-only: the signed-in account's active follows, in the exact shape
// lib/library.ts's FollowedItem already uses, so the client can merge this
// straight into localStorage on sign-in/app-load without any reshaping —
// the server becomes the source of truth, localStorage its synced cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT type, source_id, created_at
    FROM followed_items
    WHERE user_id = ${userId} AND active = true
    ORDER BY created_at ASC`) as unknown as { type: string; source_id: string; created_at: string }[];

  const results = await Promise.allSettled(
    rows.map(async (row) => ({
      item: await details(row.type, row.source_id),
      followedAt: new Date(row.created_at).toISOString(),
    }))
  );

  const out: (MediaItem & { followedAt: string })[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push({ ...r.value.item, followedAt: r.value.followedAt });
  }
  return NextResponse.json(out);
}
