import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

// GET /api/notifications?ids=movie:603,artist:12246
// -> [{ id, itemID, eventType, leadDays, releaseDate, title, subtitle, message, createdAt }]
//
// Same trust model as /api/followed: no auth, filtered strictly to the ids
// the browser already holds in its localStorage followed list — a client
// can only read history for items it already knows about. Newest first,
// capped (history is an inbox, not an archive).
// Dynamic today because it reads request.url, but explicit so a refactor
// can't silently turn it into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 200;

interface HistoryRow {
  id: number;
  item_id: string;
  event_type: string;
  lead_days: number;
  release_date: string | Date;
  title: string;
  subtitle: string | null;
  message: string;
  created_at: string | Date;
}

function toISO(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  if (!idsParam) return NextResponse.json([]);

  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return NextResponse.json([]);

  try {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`
      SELECT id, item_id, event_type, lead_days, release_date, title, subtitle, message, created_at
      FROM notification_history
      WHERE item_id = ANY(${ids})
      ORDER BY created_at DESC, id DESC
      LIMIT ${HISTORY_LIMIT}`) as unknown as HistoryRow[];

    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        itemID: r.item_id,
        eventType: r.event_type,
        leadDays: r.lead_days,
        releaseDate: toISO(r.release_date).slice(0, 10),
        title: r.title,
        subtitle: r.subtitle ?? undefined,
        message: r.message,
        createdAt: toISO(r.created_at),
      }))
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json([]);
  }
}
