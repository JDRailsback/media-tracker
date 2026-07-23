import { NextResponse } from "next/server";
import {
  getDugout,
  getDugoutStatus,
  setDugoutStatus,
  removeDugoutItem,
  type DugoutStatus,
  type DugoutType,
} from "@/lib/dugout";

// Dynamic because GET reads request.url — explicit so a refactor can't
// silently turn this into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<DugoutType>(["movie", "tvShow"]);
const VALID_STATUSES = new Set<DugoutStatus>(["onDeck", "watchlist", "currentlyWatching"]);

// GET /api/dugout?type=movie|tvShow -> { onDeck, watchlist, currentlyWatching }
// GET /api/dugout?itemID=movie:603  -> { status: DugoutStatus | null }
// Two shapes on one route rather than a second endpoint — same "itemID vs.
// type" split already used elsewhere (/api/followed takes ids). DetailModal
// only ever needs the single-item form.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const itemID = searchParams.get("itemID");
  if (itemID) {
    const status = await getDugoutStatus(itemID);
    return NextResponse.json({ status });
  }
  const type = searchParams.get("type");
  if (!type || !VALID_TYPES.has(type as DugoutType)) {
    return NextResponse.json({ error: "type must be movie or tvShow" }, { status: 400 });
  }
  const groups = await getDugout(type as DugoutType);
  return NextResponse.json(groups);
}

// POST /api/dugout  { itemID: "movie:603", status: "onDeck" | "watchlist" | "currentlyWatching" }
// currentlyWatching is only meaningful for tvShow — the client is
// responsible for not offering it on the movie page; not re-validated here
// against the item's own type since that's a UI-scoping concern, not a data
// integrity one (an errant movie:… row with status currentlyWatching would
// simply never be read, since getDugout only ever reads currentlyWatching
// for type "tvShow").
export async function POST(request: Request) {
  const { itemID, status } = await request.json();
  if (!itemID || typeof itemID !== "string" || itemID.indexOf(":") < 0) {
    return NextResponse.json({ error: "Invalid itemID" }, { status: 400 });
  }
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    await setDugoutStatus(itemID, status);
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
  const { itemID } = await request.json();
  if (!itemID || typeof itemID !== "string") {
    return NextResponse.json({ error: "Missing itemID" }, { status: 400 });
  }
  await removeDugoutItem(itemID);
  return NextResponse.json({ ok: true });
}
