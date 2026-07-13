// The user's hidden-category selection (Settings → "Content filters") —
// personal, per-device preference, same storage pattern as
// lib/platformPrefs.ts. The actual category definitions/keys live in
// lib/contentFilters.ts (shared with the server, which applies the
// selection to the DB query itself — see app/api/discover, app/api/search).
import type { ContentCategory } from "@/lib/contentFilters";

const KEY = "hiddenCategories";

export function getHiddenCategories(): ContentCategory[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as ContentCategory[];
  } catch {
    return [];
  }
}

export function toggleHiddenCategory(key: ContentCategory): void {
  const current = getHiddenCategories();
  const next = current.includes(key) ? current.filter((c) => c !== key) : [...current, key];
  localStorage.setItem(KEY, JSON.stringify(next));
}
