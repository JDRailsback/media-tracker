import { NextResponse } from "next/server";
import { createCollection, validateCollectionInput } from "@/lib/sources/collectionAdmin";

// POST /api/collection — create a brand-new custom collection (not one of the
// curated defaults). The slug is derived from the name and de-duplicated
// against both the static list and existing overrides.
export async function POST(request: Request) {
  const input = validateCollectionInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Invalid collection data" }, { status: 400 });
  }
  try {
    const { effective } = await createCollection(input);
    return NextResponse.json(effective);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create collection" }, { status: 502 });
  }
}
