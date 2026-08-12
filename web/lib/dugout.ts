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
export type DugoutType = "movie" | "tvShow" | "game" | "artist";

// Display label for the "watchlist" status, per type — "Watchlist" reads
// naturally for movies/TV, but not for games (nobody calls their pile of
// unplayed games a "watchlist") or music, so each type gets its own
// idiomatic term instead of one label stretched across all four. "Backlog"
// is the standard term gamers already use for "own/want to play,
// haven't gotten to it yet"; "Listen Later" mirrors the familiar "Watch
// Later" convention for the listening equivalent.
export const WATCHLIST_LABEL: Record<DugoutType, string> = {
  movie: "Watchlist",
  tvShow: "Watchlist",
  game: "Backlog",
  artist: "Listen Later",
};

// Per type (movies, TV, games, and artists each get their own 5, not a
// shared pool).
const ON_DECK_LIMIT = 5;

interface DugoutRow {
  item_id: string;
  type: string;
  status: DugoutStatus;
}

export interface DugoutGroups {
  onDeck: MediaItem[];
  watchlist: MediaItem[];
  // Only ever populated for types "tvShow" and "game" — an ongoing
  // "currently in progress" state makes sense for those two (an episode
  // count/playtime to work through) but not for a movie (one sitting) or
  // an artist (there's no single thing being "currently listened to").
  currentlyWatching: MediaItem[];
}

function splitItemId(itemId: string): { type: string; rawId: string } {
  const idx = itemId.indexOf(":");
  return { type: itemId.slice(0, idx), rawId: itemId.slice(idx + 1) };
}

// Dugout is account-only (see /api/dugout's 401 guard) — every function
// here takes a real userId, not an optional one, so a caller can't
// accidentally fall through to a global/unscoped query the way an
// `| null` signature invited. See lib/db.ts's schema comment on
// dugout_items.user_id for the (still-present, just unused going forward)
// anonymous-row index this predates.

// Resolves every stored id to a live MediaItem the same way /api/followed
// does (details() checks catalog_items first, then upcoming_items) — a
// title can sit in Dugout before it's even released. A row whose title no
// longer resolves (extremely unlikely — nothing here ever deletes catalog/
// upcoming rows) is silently dropped rather than surfacing a broken card.
export async function getDugout(type: DugoutType, userId: number): Promise<DugoutGroups> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT item_id, type, status FROM dugout_items
    WHERE type = ${type} AND user_id = ${userId}
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

// Home feed's "Continue" rail — currentlyWatching across BOTH types that
// support it (tvShow/game — see DugoutGroups' comment), flattened into one
// recency-ordered list rather than the per-type shape getDugout returns.
// Kept as its own query instead of calling getDugout twice (once per type)
// so this costs one round trip, not two, for a section that renders on
// every Home load.
export async function getContinueWatching(userId: number): Promise<MediaItem[]> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT item_id, type, status FROM dugout_items
    WHERE status = 'currentlyWatching' AND type IN ('tvShow', 'game') AND user_id = ${userId}
    ORDER BY added_at DESC
  `) as unknown as DugoutRow[];

  const settled = await Promise.allSettled(
    rows.map((row) => {
      const { rawId } = splitItemId(row.item_id);
      return details(row.type, rawId);
    })
  );
  return settled.filter((r): r is PromiseFulfilledResult<MediaItem> => r.status === "fulfilled").map((r) => r.value);
}

// Throws a plain Error with a user-facing message when onDeck is already at
// its cap — this is an expected, actionable rejection (the API route
// surfaces err.message as-is), not a real failure worth a generic 500.
export async function setDugoutStatus(
  itemId: string,
  status: DugoutStatus,
  userId: number
): Promise<void> {
  await ensureSchema();
  const sql = db();
  const { type } = splitItemId(itemId);

  if (status === "onDeck") {
    // Excludes the item itself so re-selecting "On Deck" on something
    // already there isn't rejected as if it were a 6th addition.
    const countRows = (await sql`
      SELECT count(*)::int AS count FROM dugout_items
      WHERE type = ${type} AND status = 'onDeck' AND item_id != ${itemId} AND user_id = ${userId}
    `) as unknown as { count: number }[];
    if (countRows[0].count >= ON_DECK_LIMIT) {
      throw new Error("On Deck is full — remove something first.");
    }
  }

  await sql`
    INSERT INTO dugout_items (item_id, type, status, user_id)
    VALUES (${itemId}, ${type}, ${status}, ${userId})
    ON CONFLICT (user_id, item_id) DO UPDATE SET status = excluded.status
  `;
}

export async function removeDugoutItem(itemId: string, userId: number): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM dugout_items WHERE item_id = ${itemId} AND user_id = ${userId}`;
}

// Used by DetailModal to show the item's current status (if any) without a
// separate round trip per open — cheap single-row lookup by primary key.
export async function getDugoutStatus(itemId: string, userId: number): Promise<DugoutStatus | null> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT status FROM dugout_items WHERE item_id = ${itemId} AND user_id = ${userId}
  `) as unknown as { status: DugoutStatus }[];
  return rows[0]?.status ?? null;
}
