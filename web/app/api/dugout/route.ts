import { NextResponse } from "next/server";
import {
  getDugout,
  getDugoutStatus,
  getContinueWatching,
  setDugoutStatus,
  removeDugoutItem,
  type DugoutStatus,
  type DugoutType,
} from "@/lib/dugout";
import { auth } from "@/auth";

// Dynamic because GET reads request.url — explicit so a refactor can't
// silently turn this into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<DugoutType>(["movie", "tvShow", "game", "artist"]);
const VALID_STATUSES = new Set<DugoutStatus>(["onDeck", "watchlist", "currentlyWatching"]);

// Dugout is account-only — every handler below 401s without a session (see
// this file's own history: it used to fall back to a single unscoped
// global list for signed-out callers, same as followed_items did, until
// that anonymous mode was removed entirely).
async function requireUserId(): Promise<number | null> {
  const session = await auth();
  return session?.user?.id ? Number(session.user.id) : null;
}

// GET /api/dugout?type=movie|tvShow -> { onDeck, watchlist, currentlyWatching }
// GET /api/dugout?itemID=movie:603  -> { status: DugoutStatus | null }
// GET /api/dugout?continue=1        -> { items: MediaItem[] }
// Three shapes on one route rather than separate endpoints — same "itemID
// vs. type" split already used elsewhere (/api/followed takes ids).
// DetailModal only ever needs the single-item form; the Home feed's
// "Continue" rail only ever needs the flattened cross-type form.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = await requireUserId();
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const itemID = searchParams.get("itemID");
  if (itemID) {
    const status = await getDugoutStatus(itemID, userId);
    return NextResponse.json({ status });
  }
  if (searchParams.get("continue")) {
    const items = await getContinueWatching(userId);
    return NextResponse.json({ items });
  }
  const type = searchParams.get("type");
  if (!type || !VALID_TYPES.has(type as DugoutType)) {
    return NextResponse.json({ error: "type must be movie, tvShow, game, or artist" }, { status: 400 });
  }
  const groups = await getDugout(type as DugoutType, userId);
  return NextResponse.json(groups);
}

// POST /api/dugout  { itemID: "movie:603", status: "onDeck" | "watchlist" | "currentlyWatching" }
// currentlyWatching is only meaningful for tvShow and game — the client is
// responsible for not offering it on the movie/artist page; not re-validated here
// against the item's own type since that's a UI-scoping concern, not a data
// integrity one (an errant movie:… row with status currentlyWatching would
// simply never be read, since getDugout only ever reads currentlyWatching
// for type "tvShow").
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { itemID, status } = await request.json();
  if (!itemID || typeof itemID !== "string" || itemID.indexOf(":") < 0) {
    return NextResponse.json({ error: "Invalid itemID" }, { status: 400 });
  }
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    await setDugoutStatus(itemID, status, userId);
  } catch (err) {
    // setDugoutStatus only ever throws its own plain, user-facing "On Deck
    // is full" message — surfaced as-is rather than a generic 500.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/dugout  { itemID: "movie:603" } — removes it from Dugout
// entirely (no longer tracked in any of the three lists).
export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { itemID } = await request.json();
  if (!itemID || typeof itemID !== "string") {
    return NextResponse.json({ error: "Missing itemID" }, { status: 400 });
  }
  await removeDugoutItem(itemID, userId);
  return NextResponse.json({ ok: true });
}
