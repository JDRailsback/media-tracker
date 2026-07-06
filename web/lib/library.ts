import type { MediaItem } from "./types";

// The user's followed items, stored locally in the browser.
const KEY = "followed";

export function getFollowed(): MediaItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as MediaItem[];
  } catch {
    return [];
  }
}

export function isFollowed(id: string): boolean {
  return getFollowed().some((i) => i.id === id);
}

export function addFollow(item: MediaItem): void {
  const list = getFollowed();
  if (!list.some((i) => i.id === item.id)) {
    list.push(item);
    localStorage.setItem(KEY, JSON.stringify(list));
  }
}

export function removeFollow(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(getFollowed().filter((i) => i.id !== id)));
}
