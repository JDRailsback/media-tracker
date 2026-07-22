import type { MediaType } from "@/lib/types";

// Client-side constants for the Settings notification controls. The server
// deliberately has no fixed enum for either — it stores whatever integer/
// strings it's given — so these lists are purely about what the UI offers.

export const LEAD_TIME_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 1, label: "1 day before" },
  { value: 3, label: "3 days before" },
  { value: 7, label: "1 week before" },
  { value: 14, label: "2 weeks before" },
];

// Every followable type (labels match components/TypeTag.tsx). "franchise"
// is included — collections are followable via their own page.
export const MUTABLE_TYPES: { type: MediaType; label: string }[] = [
  { type: "movie", label: "Movies" },
  { type: "tvShow", label: "TV" },
  { type: "game", label: "Games" },
  { type: "manga", label: "Manga" },
  { type: "artist", label: "Music" },
  { type: "franchise", label: "Collections" },
];
