// User's preferred watch/store platforms, so their picks can be highlighted
// on the detail card's "Available on" section. Stored locally — this is a
// display preference, not something that needs to live on a server.

// Kept to EXACTLY the provider strings the app actually ever produces (see
// lib/sources/tmdb.ts's PROVIDER_SEARCH_RULES, lib/sources/igdb.ts's
// STORE_DOMAINS, lib/sources/artist.ts's artistPlatformLinks) — a picker
// full of platforms that can never match a real "Available on" link isn't
// a preference, it's a decoy. Verified live: the old list had "Disney
// Plus"/"Paramount Plus"/"Amazon Prime Video" entries that silently never
// matched the real "Disney+"/"Paramount+"/"Amazon Video" strings
// (isPreferredProvider's substring check). This list should stay in sync
// with PROVIDER_SEARCH_RULES — adding a service there without adding it
// here just means it'll show up in "Available on" but can never be marked
// preferred, and vice versa a name added only here can never match anything.
// No Manga group — manga is hidden site-wide (see lib/contentFilters.ts).
export const KNOWN_PLATFORMS: { group: string; names: string[] }[] = [
  {
    group: "Streaming",
    names: [
      "Netflix",
      "Disney+",
      "Hulu",
      "Max",
      "Amazon Video",
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
      "Fandango At Home",
      "YouTube",
      "Google Play Movies",
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
    group: "Game stores",
    names: ["Steam", "Epic Games Store", "PlayStation Store", "Xbox", "Nintendo eShop", "GOG"],
  },
  {
    group: "Music",
    names: ["Spotify", "Apple Music", "YouTube Music", "Deezer"],
  },
];

const KEY = "preferredPlatforms";

export function getPreferredPlatforms(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function togglePreferredPlatform(name: string): void {
  const current = getPreferredPlatforms();
  const next = current.includes(name)
    ? current.filter((p) => p !== name)
    : [...current, name];
  localStorage.setItem(KEY, JSON.stringify(next));
}

// TMDB's watch-provider list includes reseller "channel" bundles — a
// separate subscription/billing product sold THROUGH another platform, not
// the base service itself. Verified live: selecting "Apple TV" as preferred
// also highlighted "Apple TV Amazon Channel," a distinct provider entry, just
// because the plain substring match found "apple tv" inside its name too.
const CHANNEL_SUFFIXES = ["amazon channel", "apple tv channel", "roku premium channel"];

function isChannelBundle(providerLower: string): boolean {
  return CHANNEL_SUFFIXES.some((suffix) => providerLower.includes(suffix));
}

// Loose match: a provider like "Netflix Standard with Ads" or "Amazon Video"
// should still count as a match for the preference "Netflix" / "Amazon" —
// but a channel bundle (see above) only matches if the preference is
// SPECIFICALLY for that channel, not just the base service it resells.
export function isPreferredProvider(provider: string, preferred: string[]): boolean {
  const p = provider.toLowerCase();
  return preferred.some((pref) => {
    const prefLower = pref.toLowerCase();
    if (!p.includes(prefLower)) return false;
    if (isChannelBundle(p) && !isChannelBundle(prefLower)) return false;
    return true;
  });
}
