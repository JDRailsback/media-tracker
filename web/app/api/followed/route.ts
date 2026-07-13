import { NextResponse } from "next/server";
import { details } from "@/lib/sources";
import type { MediaItem } from "@/lib/types";

// GET /api/followed?ids=movie:603,tvShow:1399,franchise:star-wars
// -> { [id]: MediaItem }
//
// The Home feed's followed list is stored client-side in localStorage as a
// frozen snapshot taken at follow-time (see lib/library.ts) — its
// releaseDate/subtitle never update on their own. This is what the feed
// calls on every load to refresh that display data from the current
// server-side state (details() already covers every MediaType, including
// franchise, whose subtitle/releaseDate already reflect its real next
// release once resolveCollection has one). The refreshed data is never
// written back into localStorage — that stays the source of truth for
// *which* items are followed, only the displayed metadata is refreshed.
// Dynamic today because it reads request.url, but explicit so a refactor
// can't silently turn it into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  if (!idsParam) return NextResponse.json({});

  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const idx = id.indexOf(":");
      if (idx < 0) throw new Error(`Invalid id: ${id}`);
      const type = id.slice(0, idx);
      const rawId = id.slice(idx + 1);
      return details(type, rawId);
    })
  );

  const out: Record<string, MediaItem> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[ids[i]] = r.value;
  });
  return NextResponse.json(out);
}
