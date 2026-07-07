// The unified shape every source maps into (TS port of the Swift MediaItem).
export type MediaType = "movie" | "tvShow" | "game" | "manga" | "franchise";

export type LinkKind = "stream" | "rent" | "buy" | "store" | "info";

export interface ExternalLink {
  provider: string;
  logoURL?: string;
  url: string;
  kind: LinkKind;
}

// One episode's air date — TV shows only, populated on details() calls, not
// search results (would be a lot of extra requests for every search hit).
export interface EpisodeInfo {
  season: number;
  episode: number;
  title?: string;
  airDate?: string; // ISO-8601 string
}

// Franchise items carry their curated (and possibly admin-overridden) theme
// colors right on the wire — franchise definitions can now be edited at
// runtime (see lib/sources/franchise.ts), so a client-side component can no
// longer assume a static import has the current colors.
export interface MediaTheme {
  primary: string; // "R G B" triplet, matches app/globals.css's CSS variables
  secondary: string;
}

export interface MediaItem {
  id: string; // canonical id, e.g. "movie:603"
  type: MediaType;
  title: string;
  subtitle?: string;
  overview?: string;
  posterURL?: string;
  releaseDate?: string; // ISO-8601 string
  externalLinks?: ExternalLink[];
  episodes?: EpisodeInfo[]; // TV shows only
  episodeCount?: number; // TV shows only
  theme?: MediaTheme; // franchise items only
}
