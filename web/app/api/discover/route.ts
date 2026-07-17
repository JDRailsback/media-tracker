import { NextResponse } from "next/server";
import { discover, discoverCategory } from "@/lib/sources";
import { parseHiddenCategories } from "@/lib/contentFilters";

// Dynamic today because it reads request.url, but explicit so a refactor
// can't silently turn it into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

// GET /api/discover                          -> DiscoverPayload (trending shelves + popularUpcoming, newReleases, featuredCollections)
// GET /api/discover?category=movies          -> MediaItem[] (expanded single category)
// &hide=manga,anime,asian-drama,indie-games   -> Settings' Content filters selection, applied to either form
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const hidden = parseHiddenCategories(searchParams.get("hide"));

  try {
    if (category) {
      return NextResponse.json(await discoverCategory(category, hidden));
    }
    return NextResponse.json(await discover(hidden));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Discover failed" }, { status: 502 });
  }
}
