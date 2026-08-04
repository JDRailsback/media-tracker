import type { MediaItem } from "@/lib/types";

// One followed item's release date(s) as plain data — shared by the
// sidebar's followed-items calendar (app/page.tsx) and the ICS feed
// (app/api/calendar/feed.ics), so both ever show exactly the same things
// with zero duplicated logic to drift out of sync. A followed TV show
// expands into one entry per episode across every season (not just the
// latest — lib/sources/tmdb.ts's allEpisodes already fetches all of them);
// everything else is a single entry on its releaseDate. Past dates are
// kept, not dropped — a calendar is a record of what happened as much as
// what's coming, and the ICS feed especially should keep already-aired
// episodes on the day they aired rather than making them vanish.
export interface ReleaseEntry {
  date: string; // ISO YYYY-MM-DD
  title: string; // episode title (falls back to show title) or item title
  subtitle?: string; // "{show} — S{s} E{e}" for episodes only
  // Unique per entry within one item's own entries — "" for the single-entry
  // cases, "s{season}e{episode}" for an expanded episode.
  uidSuffix: string;
}

export function releaseEntriesFor(item: MediaItem): ReleaseEntry[] {
  if (item.type === "tvShow") {
    const episodes = item.episodes ?? [];
    if (episodes.length > 0) {
      return episodes
        .filter((ep): ep is typeof ep & { airDate: string } => !!ep.airDate)
        .map((ep) => ({
          date: ep.airDate,
          title: ep.title || item.title,
          subtitle: `${item.title} — S${ep.season} E${ep.episode}`,
          uidSuffix: `s${ep.season}e${ep.episode}`,
        }));
    }
    // Per-season data has a real gap (verified live on "THE GHOST IN THE
    // SHELL" — see app/page.tsx) — fall back to the single next-episode
    // date catalogRowToMediaItem itself already resolved (TMDB's own
    // nextEpisodeToAir field) rather than dropping the show entirely.
    if (item.releaseDate) {
      return [
        {
          date: item.releaseDate,
          title: item.title,
          subtitle: item.subtitle ? `${item.title} — ${item.subtitle}` : undefined,
          uidSuffix: "",
        },
      ];
    }
    return [];
  }
  if (item.releaseDate) {
    return [{ date: item.releaseDate, title: item.title, uidSuffix: "" }];
  }
  return [];
}
