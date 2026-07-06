// Shared text-relevance helpers, used both to rank combined search results
// and to decide how strict the popularity bar should be per-adapter (see
// docs/DISCOVER_AND_SEARCH.md — "importance filtering").

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
