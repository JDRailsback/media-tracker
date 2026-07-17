import { NextResponse } from "next/server";
import { search } from "@/lib/sources";
import { parseHiddenCategories } from "@/lib/contentFilters";

// The live artist fallback (see lib/sources/index.ts) is time-boxed to a
// ~1.2s budget alongside the primary call, so total search latency stays
// well under Vercel's default function timeout — kept slightly generous
// here as a safety margin, not because normal operation should ever
// approach it.
export const maxDuration = 8;

// Dynamic today because it reads request.url, but explicit so a refactor
// can't silently turn it into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

// GET /api/search?q=matrix[&type=movie|game|manga]
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const type = searchParams.get("type");

  if (!query) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  try {
    const hidden = parseHiddenCategories(searchParams.get("hide"));
    const results = await search(query, type, hidden);
    // Results only change when the daily cron rewrites the tables (plus the
    // rare lazy artist admission), so Vercel's edge cache can serve repeat
    // queries for a while without touching the function or the DB at all.
    // force-dynamic only opts out of Next's own caches — response headers
    // still control the CDN. Keyed by full URL, so q/type/hide all vary.
    return NextResponse.json(results, {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
