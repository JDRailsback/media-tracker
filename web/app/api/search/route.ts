import { NextResponse } from "next/server";
import { search } from "@/lib/sources";
import { parseHiddenCategories } from "@/lib/contentFilters";

// The typo-fallback path (see lib/sources/index.ts) is time-boxed to a ~1.2s
// budget on top of the primary call, so total search latency stays well
// under Vercel's default function timeout — kept slightly generous here as a
// safety margin, not because normal operation should ever approach it.
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
    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
