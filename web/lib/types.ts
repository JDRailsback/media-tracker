// The unified shape every source maps into (TS port of the Swift MediaItem).
// "artist" is the music type — you follow the ARTIST (not individual
// albums/songs); their releases flow through the artist item the same way a
// TV show's episodes do.
export type MediaType = "movie" | "tvShow" | "game" | "manga" | "franchise" | "artist";

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
  airDate?: string; // ISO-8601 date, day precision (TMDB)
  // Exact air moment as a UTC timestamp — either a real TVmaze airstamp, or
  // (only when TVmaze has no confirmed broadcast time) a known streaming
  // platform's documented, consistently-followed release convention (see
  // lib/streamingSchedules.ts). Attached lazily — see lib/airtimes.ts.
  airStamp?: string;
}

// One entry in an artist's discography — artists only, the music analogue
// of EpisodeInfo. Compilations are excluded at mapping time (greatest-hits
// repackages aren't new work); "kind" is Deezer's record_type vocabulary.
export interface ReleaseGroupInfo {
  title: string;
  kind: "album" | "ep" | "single";
  date?: string; // ISO date, day precision; absent for announced-but-undated
  coverURL?: string; // square Deezer cover art — absent for MB future entries
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
  // Wide, landscape artwork for the detail card's hero header — TMDB
  // backdrops for movies/TV, IGDB artworks/screenshots for games. Manga has
  // no landscape art (MangaDex only has portrait covers), so it's absent
  // there and the hero falls back to the poster.
  backdropURL?: string;
  releaseDate?: string; // ISO-8601 string
  // The EXACT release moment (UTC timestamp), when a source knows one —
  // currently TV shows only, via TVmaze airstamps (see lib/airtimes.ts).
  // releaseDate stays the day-precision field everything falls back to.
  releaseAt?: string;
  externalLinks?: ExternalLink[];
  episodes?: EpisodeInfo[]; // TV shows only
  episodeCount?: number; // TV shows only
  releases?: ReleaseGroupInfo[]; // artists only — discography, newest first
  theme?: MediaTheme; // franchise items only
}
