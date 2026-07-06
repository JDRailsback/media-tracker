import { NextResponse } from "next/server";
import { discover, discoverCategory } from "@/lib/sources";

// GET /api/discover                 -> { trendingMovies, trendingTV, popularGames, popularManga, popularUpcoming }
// GET /api/discover?category=movies -> MediaItem[] (expanded single category)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  try {
    if (category) {
      return NextResponse.json(await discoverCategory(category));
    }
    return NextResponse.json(await discover());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Discover failed" }, { status: 502 });
  }
}
