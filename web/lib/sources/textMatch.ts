import type { MediaItem } from "@/lib/types";

// Shared text-relevance helpers, used both to rank combined search results
// and to decide how strict the popularity bar should be per-adapter (see
// docs/DISCOVER_AND_SEARCH.md — "importance filtering").

// Search-only, internal ranking signal: would this item still be considered
// significant even judged as a NON-exact match (i.e. does it clear each
// adapter's stricter bar)? Lets a hugely popular near-match (e.g. "Toy Story
// 2") outrank a barely-passing exact match (e.g. an obscure "Toy Story"
// game) instead of exact-match always winning outright. Computed by each
// adapter's search function, used only inside the ranking pipeline in
// lib/sources/index.ts, and stripped before the API response is returned —
// never part of the public MediaItem contract.
export interface RankedItem extends MediaItem {
  significant: boolean;
}

export function isExactMatch(title: string, query: string): boolean {
  return title.trim().toLowerCase() === query.trim().toLowerCase();
}

// 0 = exact, 1 = starts with the query, 2 = contains it, 3 = anything else.
export function matchTier(title: string, query: string): number {
  const t = title.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return 3;
}
