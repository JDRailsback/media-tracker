import { db, ensureSchema } from "@/lib/db";
import { details } from "@/lib/sources";
import type { MediaItem } from "@/lib/types";

// The user's watch queue — deliberately separate from followed_items (see
// lib/db.ts's schema comment): following is "tell me about release news",
// this is "help me decide what to watch". A title is in exactly ONE of
// these three at a time; moving to onDeck removes it from watchlist rather
// than layering on top of it (an explicit, simpler-than-the-alternative
// design choice — see the conversation that scoped this feature).
export type DugoutStatus = "onDeck" | "watchlist" | "currentlyWatching";
export type DugoutType = "movie" | "tvShow";

// Per type (movies and TV each get their own 5, not a shared pool).
const ON_DECK_LIMIT = 5;

interface DugoutRow {
  item_id: string;
  type: string;
  status: DugoutStatus;
}

export interface DugoutGroups {
  onDeck: MediaItem[];
  watchlist: MediaItem[];
  // Only ever populated for type "tvShow" — movies have no such status.
  currentlyWatching: MediaItem[];
}

function splitItemId(itemId: string): { type: string; rawId: string } {
  const idx = itemId.indexOf(":");
  return { type: itemId.slice(0, idx), rawId: itemId.slice(idx + 1) };
}

// Resolves every stored id to a live MediaItem the same way /api/followed
// does (details() checks catalog_items first, then upcoming_items) — a
// title can sit in Dugout before it's even released. A row whose title no
// longer resolves (extremely unlikely — nothing here ever deletes catalog/
// upcoming rows) is silently dropped rather than surfacing a broken card.
export async function getDugout(type: DugoutType): Promise<DugoutGroups> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT item_id, type, status FROM dugout_items
    WHERE type = ${type}
    ORDER BY added_at DESC
  `) as unknown as DugoutRow[];

  const settled = await Promise.allSettled(
    rows.map(async (row) => {
      const { rawId } = splitItemId(row.item_id);
      const item = await details(row.type, rawId);
      return { status: row.status, item };
    })
  );

  const groups: DugoutGroups = { onDeck: [], watchlist: [], currentlyWatching: [] };
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    groups[result.value.status].push(result.value.item);
  }
  return groups;
}

// Throws a plain Error with a user-facing message when onDeck is already at
// its cap — this is an expected, actionable rejection (the API route
// surfaces err.message as-is), not a real failure worth a generic 500.
export async function setDugoutStatus(itemId: string, status: DugoutStatus): Promise<void> {
  await ensureSchema();
  const sql = db();
  const { type } = splitItemId(itemId);

  if (status === "onDeck") {
    // Excludes the item itself so re-selecting "On Deck" on something
    // already there isn't rejected as if it were a 6th addition.
    const [{ count }] = (await sql`
      SELECT count(*)::int AS count FROM dugout_items
      WHERE type = ${type} AND status = 'onDeck' AND item_id != ${itemId}
    `) as unknown as { count: number }[];
    if (count >= ON_DECK_LIMIT) {
      throw new Error("On Deck is full — remove something first.");
    }
  }

  await sql`
    INSERT INTO dugout_items (item_id, type, status)
    VALUES (${itemId}, ${type}, ${status})
    ON CONFLICT (item_id) DO UPDATE SET status = excluded.status
  `;
}

export async function removeDugoutItem(itemId: string): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM dugout_items WHERE item_id = ${itemId}`;
}

// Used by DetailModal to show the item's current status (if any) without a
// separate round trip per open — cheap single-row lookup by primary key.
export async function getDugoutStatus(itemId: string): Promise<DugoutStatus | null> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`SELECT status FROM dugout_items WHERE item_id = ${itemId}`) as unknown as
    { status: DugoutStatus }[];
  return rows[0]?.status ?? null;
}
