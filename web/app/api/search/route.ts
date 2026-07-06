import { NextResponse } from "next/server";
import { search } from "@/lib/sources";

// GET /api/search?q=matrix[&type=movie|game|manga]
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const type = searchParams.get("type");

  if (!query) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  try {
    const results = await search(query, type);
    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
