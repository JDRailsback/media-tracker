import { NextResponse } from "next/server";
import { createFranchise, validateFranchiseInput } from "@/lib/sources/franchiseAdmin";

// POST /api/franchise — create a brand-new custom franchise (not one of the
// curated defaults). The slug is derived from the name and de-duplicated
// against both the static list and existing overrides.
export async function POST(request: Request) {
  const input = validateFranchiseInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Invalid franchise data" }, { status: 400 });
  }
  try {
    const { effective } = await createFranchise(input);
    return NextResponse.json(effective);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create franchise" }, { status: 502 });
  }
}
