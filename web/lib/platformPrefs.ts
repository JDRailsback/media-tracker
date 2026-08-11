import type { LinkKind } from "@/lib/types";

// User's preferred watch/store platforms, so their picks can be highlighted
// (and optionally exclusively shown — see getShowOnlyPreferred below) on
// the detail card's "Available on" section. Stored locally — this is a
// display preference, not something that needs to live on a server.

// Streaming (flatrate/subscription) and Rent & Buy are tracked as SEPARATE
// preferences, even where the same real-world service spans both (Prime
// Video, Apple TV/Apple TV+) — explicit request: a subscription pick and a
// pay-per-title pick are different decisions, and collapsing them meant
// there was no way to prefer "Netflix to stream" without also implicitly
// preferring "Apple TV to rent." Game stores and Music have no such split
// (a game/album is never both "subscription" and "rental" at once), so
// they stay single categories.
export type PlatformKind = "stream" | "rentBuy" | "store" | "music";

// Kept to EXACTLY the provider strings the app actually ever produces (see
// lib/sources/tmdb.ts's PROVIDER_SEARCH_RULES/EXACT_PROVIDER_OVERRIDES,
// lib/sources/igdb.ts's STORE_DOMAINS, lib/sources/artist.ts's
// artistPlatformLinks) — a picker full of platforms that can never match a
// real "Available on" link isn't a preference, it's a decoy. This list
// should stay in sync with those — adding a service there without adding
// it here just means it'll show up in "Available on" but can never be
// marked preferred, and vice versa a name added only here can never match
// anything. No Manga group — manga is hidden site-wide (see
// lib/contentFilters.ts).
export const KNOWN_PLATFORMS: { group: string; kind: PlatformKind; names: string[] }[] = [
  {
    group: "Streaming",
    kind: "stream",
    names: [
      "Netflix",
      "Disney+",
      "Hulu",
      "Max",
      "Prime Video",
      "Apple TV+",
      "Crunchyroll",
      "Peacock",
      "Paramount+",
      "Starz",
      "Showtime",
      "MGM+",
      "AMC+",
      "Discovery+",
      "ESPN+",
      "Tubi",
      "Pluto TV",
      "The Roku Channel",
      "YouTube TV",
      "Plex",
      "Shudder",
      "BritBox",
      "Acorn TV",
      "fuboTV",
      "Sling TV",
      "Philo",
      "Criterion Channel",
      "Kanopy",
      "Hoopla",
      "HIDIVE",
    ],
  },
  {
    group: "Rent & Buy",
    kind: "rentBuy",
    names: ["Prime Video", "Apple TV", "Google Play Movies", "YouTube", "Fandango At Home"],
  },
  {
    group: "Game stores",
    kind: "store",
    names: ["Steam", "Epic Games Store", "PlayStation Store", "Xbox", "Nintendo eShop", "GOG"],
  },
  {
    group: "Music",
    kind: "music",
    names: ["Spotify", "Apple Music", "YouTube Music", "Deezer"],
  },
];

function key(kind: PlatformKind): string {
  return `preferredPlatforms:${kind}`;
}

export function getPreferredPlatforms(kind: PlatformKind): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key(kind)) || "[]") as string[];
  } catch {
    return [];
  }
}

export function togglePreferredPlatform(name: string, kind: PlatformKind): void {
  const current = getPreferredPlatforms(kind);
  const next = current.includes(name) ? current.filter((p) => p !== name) : [...current, name];
  localStorage.setItem(key(kind), JSON.stringify(next));
}

// Maps an ExternalLink's kind to the preference bucket it should be judged
// against — "info" (a last-resort fallback link, e.g. a bare TMDB page)
// falls back to "stream" since it's never a real rent/buy/store offering.
export function platformKindFor(linkKind: LinkKind): PlatformKind {
  if (linkKind === "rent" || linkKind === "buy") return "rentBuy";
  if (linkKind === "store") return "store";
  return "stream";
}

// Loose match: a provider like "Netflix Standard with Ads" should still
// count as a match for the preference "Netflix". Channel-bundle entries
// ("X Amazon Channel" etc.) never reach here at all — lib/sources/tmdb.ts
// drops them before they ever become an ExternalLink — so no special-case
// exclusion is needed for those anymore.
export function isPreferredProvider(provider: string, preferred: string[]): boolean {
  const p = provider.toLowerCase();
  return preferred.some((pref) => p.includes(pref.toLowerCase()));
}

// "Available on" defaults to showing everything, preferred picks just
// pinned first (see DetailModal). Flipping this on hides everything else
// instead — for someone who only ever wants to see whether it's on THEIR
// services, not a full inventory of every storefront on earth.
const SHOW_ONLY_KEY = "showOnlyPreferredPlatforms";

export function getShowOnlyPreferred(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SHOW_ONLY_KEY) === "true";
}

export function setShowOnlyPreferred(value: boolean): void {
  localStorage.setItem(SHOW_ONLY_KEY, String(value));
}
