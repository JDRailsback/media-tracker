import { NextResponse } from "next/server";
import { resolveCollection } from "@/lib/sources/collection";
import {
  deleteCollectionOverride,
  isCuratedSlug,
  saveCollectionOverride,
  validateCollectionInput,
} from "@/lib/sources/collectionAdmin";

// GET /api/collection/star-wars — the one genuinely live read endpoint in the
// collection system: full merged definition (curated defaults + any admin
// override) plus parts aggregated across TMDB/IGDB/MangaDex. The detail page
// uses this response for everything (hero theme, parts, and pre-filling the
// edit form) rather than reading lib/collections.ts directly, since a
// collection's definition can now change at runtime via the editor.
export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const resolved = await resolveCollection(params.slug);
  if (!resolved) {
    return NextResponse.json({ error: "Unknown collection" }, { status: 404 });
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
    logoURL: resolved.def.logoURL ?? null,
    includeOverrides: resolved.def.includeOverrides,
    excludeIds: resolved.def.excludeIds,
    isCustom: resolved.def.isCustom,
    collectionType: resolved.def.collectionType ?? null,
    parts: resolved.parts,
    mostPopular: resolved.mostPopular,
    nextRelease: resolved.nextRelease,
    resolvedBannerURL: resolved.bannerURL,
  });
}

// PUT /api/collection/star-wars — save an edit. Works the same whether the
// slug is one of the curated defaults (creates/updates its override row) or
// already a custom collection (updates it in place).
export async function PUT(request: Request, { params }: { params: { slug: string } }) {
  const input = validateCollectionInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Invalid collection data" }, { status: 400 });
  }
  try {
    const effective = await saveCollectionOverride(params.slug, input);
    return NextResponse.json(effective);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save collection" }, { status: 502 });
  }
}

// DELETE /api/collection/star-wars — for a curated collection, reverts to the
// static default; for a custom one (no default to revert to), deletes it.
export async function DELETE(_request: Request, { params }: { params: { slug: string } }) {
  await deleteCollectionOverride(params.slug);
  return NextResponse.json({ ok: true, revertedToDefault: isCuratedSlug(params.slug) });
}
