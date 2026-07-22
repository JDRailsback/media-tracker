import type { DiscoverPayload } from "@/lib/sources";

// Last-known Discover payload, persisted so switching to Discover renders
// the full set of shelves instantly instead of a "Loading…" blank while the
// (day-cadence, rarely-changed) data refetches — same stale-while-revalidate
// pattern as lib/freshCache.ts. Always superseded by the live fetch moments
// later; staleness is bounded to one session gap.

const KEY = "discoverCache";

export function getDiscoverCache(): DiscoverPayload | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") as DiscoverPayload | null;
  } catch {
    return null;
  }
}

export function setDiscoverCache(payload: DiscoverPayload): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Best-effort cache — a full/unavailable storage just means the next
    // load pays the fetch wait again.
  }
}
