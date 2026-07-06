// The unified shape every source maps into (TS port of the Swift MediaItem).
export type MediaType = "movie" | "tvShow" | "game" | "manga";

export type LinkKind = "stream" | "rent" | "buy" | "store" | "info";

export interface ExternalLink {
  provider: string;
  logoURL?: string;
  url: string;
  kind: LinkKind;
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
}
