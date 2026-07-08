import { db, ensureSchema } from "@/lib/db";
import { COLLECTIONS, CollectionQueries, getCollection } from "@/lib/collections";
import { EffectiveCollection, IncludedPart, getEffectiveCollection } from "./collection";

// Write side of the collection editor — kept separate from collection.ts
// (the read side: search/discover/resolve) purely for organization, not to
// avoid a cycle; both are only ever imported by API routes, never by
// lib/sources/index.ts.

export interface CollectionInput {
  name: string;
  tagline: string;
  theme: { primary: string; secondary: string };
  queries: CollectionQueries;
  movieCollectionId?: number;
  featured: boolean;
  posterURL?: string;
  bannerURL?: string;
  logoURL?: string;
  includeOverrides: IncludedPart[];
  excludeIds: string[];
}

// Shared by both API routes (create and edit) so the two never drift.
export function validateCollectionInput(body: unknown): CollectionInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (typeof b.tagline !== "string") return null;
  const theme = b.theme as { primary?: unknown; secondary?: unknown } | undefined;
  if (!theme || typeof theme.primary !== "string" || typeof theme.secondary !== "string") return null;
  if (!b.queries || typeof b.queries !== "object") return null;
  if (typeof b.featured !== "boolean") return null;
  if (!Array.isArray(b.includeOverrides) || !Array.isArray(b.excludeIds)) return null;

  return {
    name: b.name.trim(),
    tagline: b.tagline,
    theme: { primary: theme.primary, secondary: theme.secondary },
    queries: b.queries as CollectionQueries,
    movieCollectionId:
      typeof b.movieCollectionId === "number" && Number.isFinite(b.movieCollectionId)
        ? b.movieCollectionId
        : undefined,
    featured: b.featured,
    posterURL: typeof b.posterURL === "string" && b.posterURL ? b.posterURL : undefined,
    bannerURL: typeof b.bannerURL === "string" && b.bannerURL ? b.bannerURL : undefined,
    logoURL: typeof b.logoURL === "string" && b.logoURL ? b.logoURL : undefined,
    includeOverrides: b.includeOverrides as IncludedPart[],
    excludeIds: b.excludeIds as string[],
  };
}

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function slugExists(slug: string): Promise<boolean> {
  if (COLLECTIONS.some((f) => f.slug === slug)) return true;
  await ensureSchema();
  const sql = db();
  const rows = await sql`SELECT 1 FROM collection_overrides WHERE slug = ${slug}`;
  return rows.length > 0;
}

// Upserts a COMPLETE replacement row — editing any single field still writes
// every field, so there's no ambiguity later between "never set" and
// "explicitly cleared." isCustom is preserved from whatever it already was
// (a curated collection being edited stays non-custom; a collection created
// via createCollection stays custom) — this function never changes that flag.
export async function saveCollectionOverride(
  slug: string,
  input: CollectionInput
): Promise<EffectiveCollection> {
  await ensureSchema();
  const sql = db();
  const isCustom = !COLLECTIONS.some((f) => f.slug === slug);
  await sql`
    INSERT INTO collection_overrides (
      slug, name, tagline, theme_primary, theme_secondary, poster_url,
      banner_url, logo_url, queries, movie_collection_id, featured,
      include_overrides, exclude_ids, is_custom, updated_at
    ) VALUES (
      ${slug}, ${input.name}, ${input.tagline}, ${input.theme.primary},
      ${input.theme.secondary}, ${input.posterURL ?? null}, ${input.bannerURL ?? null},
      ${input.logoURL ?? null},
      ${JSON.stringify(input.queries)}, ${input.movieCollectionId ?? null},
      ${input.featured}, ${JSON.stringify(input.includeOverrides)},
      ${JSON.stringify(input.excludeIds)}, ${isCustom}, now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      tagline = EXCLUDED.tagline,
      theme_primary = EXCLUDED.theme_primary,
      theme_secondary = EXCLUDED.theme_secondary,
      poster_url = EXCLUDED.poster_url,
      banner_url = EXCLUDED.banner_url,
      logo_url = EXCLUDED.logo_url,
      queries = EXCLUDED.queries,
      movie_collection_id = EXCLUDED.movie_collection_id,
      featured = EXCLUDED.featured,
      include_overrides = EXCLUDED.include_overrides,
      exclude_ids = EXCLUDED.exclude_ids,
      updated_at = now()`;

  const effective = await getEffectiveCollection(slug);
  if (!effective) throw new Error("Failed to save collection");
  return effective;
}

export async function createCollection(
  input: CollectionInput
): Promise<{ slug: string; effective: EffectiveCollection }> {
  const base = slugify(input.name);
  if (!base) throw new Error("Name must contain at least one letter or number");
  let slug = base;
  let suffix = 2;
  while (await slugExists(slug)) {
    slug = `${base}-${suffix}`;
    suffix++;
  }

  await ensureSchema();
  const sql = db();
  await sql`
    INSERT INTO collection_overrides (
      slug, name, tagline, theme_primary, theme_secondary, poster_url,
      banner_url, logo_url, queries, movie_collection_id, featured,
      include_overrides, exclude_ids, is_custom, updated_at
    ) VALUES (
      ${slug}, ${input.name}, ${input.tagline}, ${input.theme.primary},
      ${input.theme.secondary}, ${input.posterURL ?? null}, ${input.bannerURL ?? null},
      ${input.logoURL ?? null},
      ${JSON.stringify(input.queries)}, ${input.movieCollectionId ?? null},
      ${input.featured}, ${JSON.stringify(input.includeOverrides)},
      ${JSON.stringify(input.excludeIds)}, true, now()
    )`;

  const effective = await getEffectiveCollection(slug);
  if (!effective) throw new Error("Failed to create collection");
  return { slug, effective };
}

// For a curated (non-custom) collection: deletes the override row, reverting
// to the static default. For a custom collection (no static fallback): this
// deletes it entirely — a followed custom collection that's since been
// deleted just fails gracefully on the next poll check (already handled by
// the per-item try/catch in app/api/poll/route.ts).
export async function deleteCollectionOverride(slug: string): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM collection_overrides WHERE slug = ${slug}`;
}

export function isCuratedSlug(slug: string): boolean {
  return !!getCollection(slug);
}
