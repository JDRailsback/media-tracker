import { NextResponse } from "next/server";
import { details } from "@/lib/sources";

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
