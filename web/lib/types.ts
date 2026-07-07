// The unified shape every source maps into (TS port of the Swift MediaItem).
export type MediaType = "movie" | "tvShow" | "game" | "manga" | "collection";

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
}
