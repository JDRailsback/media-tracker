// User's preferred watch/store platforms, so their picks can be highlighted
// on the detail card's "Available on" section. Stored locally — this is a
// display preference, not something that needs to live on a server.

export const KNOWN_PLATFORMS: { group: string; names: string[] }[] = [
  {
    group: "Streaming",
    names: [
      "Netflix",
      "Disney Plus",
      "Hulu",
      "Max",
      "Amazon Prime Video",
      "Apple TV",
      "Crunchyroll",
      "Peacock",
      "Paramount Plus",
      "Starz",
      "Showtime",
      "MGM Plus",
      "AMC Plus",
      "Tubi",
      "Pluto TV",
      "The Roku Channel",
      "Freevee",
      "Vudu",
      "Fandango At Home",
      "YouTube",
      "Google Play Movies",
      "Plex",
      "Shudder",
      "BritBox",
      "Acorn TV",
      "Discovery Plus",
      "ESPN Plus",
      "fuboTV",
      "Sling TV",
      "Philo",
      "Criterion Channel",
      "Kanopy",
      "Hoopla",
      "HIDIVE",
      "VRV",
    ],
  },
  {
    group: "Game stores",
    names: [
      "Steam",
      "Epic Games Store",
      "PlayStation Store",
      "Xbox",
      "Nintendo eShop",
      "GOG",
      "itch.io",
      "Humble Bundle",
      "Battle.net",
      "Ubisoft Connect",
      "EA App",
      "Amazon Luna",
      "Apple Arcade",
      "Google Play Games",
    ],
  },
  {
    group: "Manga",
    names: [
      "Official (English)",
      "BookWalker",
      "Amazon",
      "Manga Plus",
      "VIZ",
      "ComiXology",
      "Google Play Books",
      "Kindle",
    ],
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

// Loose match: a provider like "Netflix Standard with Ads" or "Amazon Video"
// should still count as a match for the preference "Netflix" / "Amazon".
export function isPreferredProvider(provider: string, preferred: string[]): boolean {
  const p = provider.toLowerCase();
  return preferred.some((pref) => p.includes(pref.toLowerCase()));
}
