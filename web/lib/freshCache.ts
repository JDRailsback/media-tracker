import type { MediaItem } from "@/lib/types";

// Last-known fresh display data for followed items (the /api/followed
// overlay), persisted so the NEXT load can render Home complete instantly
// instead of blanking stale items for the seconds the refresh takes.
//
// Why this exists: the `followed` localStorage list is a snapshot frozen at
// follow time — for a weekly TV show its releaseDate goes stale within a
// week, and Home only shows upcoming dates, so on load such items simply
// VANISHED until the fresh fetch landed (verified live: Silo and GHOST IN
// THE SHELL popping in seconds after everything else). This cache is
// display-only and always superseded by the real fetch moments later —
// staleness is bounded by one session gap and corrects itself silently.
// Each write stores exactly the fetch's response, so unfollowed items
// self-prune on the next successful refresh.

const KEY = "freshFollowedCache";

export function getFreshCache(): Record<string, MediaItem> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, MediaItem>;
  } catch {
    return {};
  }
}

export function setFreshCache(byId: Record<string, MediaItem>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(byId));
  } catch {
    // Best-effort cache — a full/unavailable storage just means the next
    // load pays the refresh wait again.
  }
}
