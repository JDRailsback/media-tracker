// Read/unread tracking for the Notifications page — per-device, in
// localStorage, same pattern as lib/hiddenCategories.ts but CAPPED: history
// ids grow without bound (unlike the small fixed content-filter set), so
// only the most recent CAP read-marks are kept. Trimming old ids is safe
// because /api/notifications itself only returns the newest 200 rows — an
// id old enough to be trimmed here has already aged out of the fetch.

const KEY = "readNotificationIds";
const CAP = 500;

export function getReadIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as number[];
  } catch {
    return [];
  }
}

export function markRead(ids: number[]): void {
  const merged = [...new Set([...getReadIds(), ...ids])].sort((a, b) => a - b);
  localStorage.setItem(KEY, JSON.stringify(merged.slice(-CAP)));
}

// Compact relative timestamp for history rows ("4h ago", "3d ago") —
// precision matters less the older an entry gets, so beyond a week it
// falls back to a plain date.
export function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
