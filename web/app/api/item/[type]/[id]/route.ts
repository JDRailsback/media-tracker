import { NextResponse } from "next/server";
import { details } from "@/lib/sources";

// This handler never touches the `request` object, which makes Next 14
// treat it as statically cacheable — verified live in dev: a freshly
// ingested show 404'd here indefinitely while /api/followed (dynamic, same
// underlying details() call) resolved it fine. In production the first
// response per id would be cached forever — release dates and next-episode
// data would never update. Every DB-backed GET must opt out explicitly.
export const dynamic = "force-dynamic";

// GET /api/item/movie/603
export async function GET(
  _request: Request,
  { params }: { params: { type: string; id: string } }
) {
  try {
    const item = await details(params.type, params.id);
    return NextResponse.json(item);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
