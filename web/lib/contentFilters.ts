// User-configurable content filters (Settings → "Content filters") — hide
// whole categories of media across Discover shelves and Search. Personal,
// per-device preference stored in localStorage (see components/Settings*
// and app/page.tsx), sent along with each Discover/Search request as a
// query param and applied server-side so a hidden category never gets
// fetched from the DB at all (matches/counts stay correct, no sparse
// shelves from client-side post-filtering).
//
// Built from signals already captured during ingestion (see CatalogRow/
// UpcomingRow's genres/originalLanguage) — "anime" and "Asian dramas" are
// not real TMDB/IGDB fields, they're heuristics defined here:
//   anime        = movie/TV, original_language "ja", genre "Animation"
//   asian-drama  = TV, original_language ko/zh/ja/th, NOT genre "Animation"
//                  (the NOT keeps anime and Asian drama mutually exclusive)
//   indie-games  = game, genre "Indie"
//   manga        = type = manga (already a first-class type, no heuristic needed)
export type ContentCategory = "manga" | "anime" | "asian-drama" | "indie-games" | "music";

export const CONTENT_CATEGORIES: { key: ContentCategory; label: string; description: string }[] = [
  { key: "manga", label: "Manga", description: "Hide all manga." },
  { key: "anime", label: "Anime", description: "Hide Japanese-language animated movies and shows." },
  { key: "asian-drama", label: "Asian dramas", description: "Hide Korean, Japanese, Chinese, and Thai-language TV dramas." },
  { key: "indie-games", label: "Indie games", description: "Hide games tagged Indie." },
  { key: "music", label: "Music", description: "Hide all music artists." },
];

const KNOWN_CATEGORIES = new Set<string>(CONTENT_CATEGORIES.map((c) => c.key));

// Raw boolean SQL, true = "this row belongs to the category" (so it gets
// hidden). Column names (type/genres/original_language) are identical on
// catalog_items and upcoming_items, so the same fragment works against
// either table. These are the ONLY strings ever concatenated into a query —
// never built from client input, only looked up by validated category key
// (see parseHiddenCategories) — so this is safe against injection despite
// not being parameterized.
const CATEGORY_SQL: Record<ContentCategory, string> = {
  manga: `type = 'manga'`,
  anime: `type IN ('movie','tvShow') AND original_language = 'ja' AND genres @> '["Animation"]'::jsonb`,
  "asian-drama": `type = 'tvShow' AND original_language = ANY(ARRAY['ko','zh','ja','th']) AND NOT (genres @> '["Animation"]'::jsonb)`,
  "indie-games": `type = 'game' AND genres @> '["Indie"]'::jsonb`,
  music: `type = 'artist'`,
};

// Parses a comma-separated `?hide=manga,anime` query param, dropping
// anything that isn't one of the fixed known keys above.
export function parseHiddenCategories(param: string | null | undefined): ContentCategory[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ContentCategory => KNOWN_CATEGORIES.has(s));
}

// A `AND NOT (...) AND NOT (...)` fragment to append to a WHERE clause —
// empty string (no-op) when nothing is hidden. Callers only need this when
// `hidden.length > 0`; the common no-filter case should keep using the
// plain tagged-template query unchanged (see lib/catalog.ts/lib/upcoming.ts
// callers) rather than route every read through the raw-SQL path.
export function excludeHiddenSQL(hidden: ContentCategory[]): string {
  if (hidden.length === 0) return "";
  return hidden.map((c) => `AND NOT (${CATEGORY_SQL[c]})`).join(" ");
}
