import type { MediaItem } from "./types";

// The user's followed items, stored locally in the browser. Deliberately NO
// watch-status/activity tracking (planned/watching/completed) — plenty of
// other apps do that. This app's only job is: tell me when something new
// is coming or just dropped.
export interface FollowedItem extends MediaItem {
  followedAt: string;
}

const KEY = "followed";

export function getFollowed(): FollowedItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as FollowedItem[];
  } catch {
    return [];
  }
}

function save(list: FollowedItem[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function isFollowed(id: string): boolean {
  return getFollowed().some((i) => i.id === id);
}

export function addFollow(item: MediaItem): void {
  const list = getFollowed();
  if (!list.some((i) => i.id === item.id)) {
    list.push({ ...item, followedAt: new Date().toISOString() });
    save(list);
  }
}

export function removeFollow(id: string): void {
  save(getFollowed().filter((i) => i.id !== id));
}

// Overwrites the local list wholesale with an account's server-side follows
// (see /api/followed/mine) — called once on sign-in. The account becomes
// the source of truth at that point, so this replaces rather than merges;
// anonymous follows made in this same browser before signing in are not
// carried over (the one-time legacy-data claim already covers the actual
// case that matters: this app's original single-user data becoming the
// first account's data).
export function replaceFollowed(items: FollowedItem[]): void {
  save(items);
}
