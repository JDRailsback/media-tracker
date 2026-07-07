import { NextResponse } from "next/server";
import { resolveFranchise } from "@/lib/sources/franchise";
import {
  deleteFranchiseOverride,
  isCuratedSlug,
  saveFranchiseOverride,
  validateFranchiseInput,
} from "@/lib/sources/franchiseAdmin";

// GET /api/franchise/star-wars — the one genuinely live read endpoint in the
// franchise system: full merged definition (curated defaults + any admin
// override) plus parts aggregated across TMDB/IGDB/MangaDex. The detail page
// uses this response for everything (hero theme, parts, and pre-filling the
// edit form) rather than reading lib/franchises.ts directly, since a
// franchise's definition can now change at runtime via the editor.
export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const resolved = await resolveFranchise(params.slug);
  if (!resolved) {
    return NextResponse.json({ error: "Unknown franchise" }, { status: 404 });
  }
  return NextResponse.json({
    slug: resolved.def.slug,
    name: resolved.def.name,
    tagline: resolved.def.tagline,
    theme: resolved.def.theme,
    queries: resolved.def.queries,
    movieCollectionId: resolved.def.movieCollectionId ?? null,
    featured: resolved.def.featured,
    posterURL: resolved.def.posterURL ?? null,
    bannerURL: resolved.def.bannerURL ?? null,
    includeOverrides: resolved.def.includeOverrides,
    excludeIds: resolved.def.excludeIds,
    isCustom: resolved.def.isCustom,
    parts: resolved.parts,
    mostPopular: resolved.mostPopular,
    nextRelease: resolved.nextRelease,
    resolvedBannerURL: resolved.bannerURL,
  });
}

// PUT /api/franchise/star-wars — save an edit. Works the same whether the
// slug is one of the curated defaults (creates/updates its override row) or
// already a custom franchise (updates it in place).
export async function PUT(request: Request, { params }: { params: { slug: string } }) {
  const input = validateFranchiseInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Invalid franchise data" }, { status: 400 });
  }
  try {
    const effective = await saveFranchiseOverride(params.slug, input);
    return NextResponse.json(effective);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save franchise" }, { status: 502 });
  }
}

// DELETE /api/franchise/star-wars — for a curated franchise, reverts to the
// static default; for a custom one (no default to revert to), deletes it.
export async function DELETE(_request: Request, { params }: { params: { slug: string } }) {
  await deleteFranchiseOverride(params.slug);
  return NextResponse.json({ ok: true, revertedToDefault: isCuratedSlug(params.slug) });
}
