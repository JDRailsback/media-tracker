// TVmaze adapter — the primary source for exact episode air times, and a
// more reliable DATE source than TMDB for some shows (see TVmazeSchedule's
// doc comment). TMDB's air_date is day-precision only; TVmaze's `airstamp`
// is a real UTC timestamp per episode ("2026-07-20T01:00:00+00:00"), which
// is what makes "New episode tonight · 9:00 PM" possible. Keyless; used
// ONLY by lib/airtimes.ts's lazy attach — never in any bulk pipeline.

// TVmaze's documented rate limit is 20 calls per 10 seconds per IP — same
// rolling-window throttle pattern as igdb.ts/deezer.ts, kept under the
// ceiling.
const MAX_REQUESTS_PER_WINDOW = 15;
const WINDOW_MS = 10_000;
const requestTimestamps: number[] = [];
let gate: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  gate = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (requestTimestamps.length && requestTimestamps[0] <= now - WINDOW_MS) {
        requestTimestamps.shift();
      }
      if (requestTimestamps.length < MAX_REQUESTS_PER_WINDOW) break;
      await new Promise((r) => setTimeout(r, requestTimestamps[0] + WINDOW_MS - now));
    }
    requestTimestamps.push(Date.now());
  });
  return gate;
}

async function tvmazeGET<T>(path: string): Promise<T | null> {
  await throttle();
  const res = await fetch(`https://api.tvmaze.com${path}`, { cache: "no-store" });
  if (res.status === 404) return null; // "not found" is a normal answer here
  if (!res.ok) throw new Error(`TVmaze request failed (${path}): ${res.status}`);
  return (await res.json()) as T;
}

interface TVmazeShow {
  id: number;
  name: string;
}

interface TVmazeEpisode {
  season: number;
  number: number | null; // null for specials without a number
  airdate?: string | null; // "2026-07-24" — TVmaze's own calendar date, independent of airtime
  airtime?: string | null; // "23:00" when a real broadcast time is on file, "" when it isn't
  airstamp?: string | null;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Show resolution: IMDb id when we have one (exact — TMDB supplies it via
// external_ids, see tvExtra), else a name search accepted ONLY on an exact
// normalized match. A wrong show's air times confidently displayed would be
// far worse than none.
async function resolveShowId(imdbId: string | null, title: string): Promise<number | null> {
  if (imdbId) {
    const byImdb = await tvmazeGET<TVmazeShow>(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`);
    if (byImdb) return byImdb.id;
  }
  const byName = await tvmazeGET<TVmazeShow>(`/singlesearch/shows?q=${encodeURIComponent(title)}`);
  if (byName && normName(byName.name) === normName(title)) return byName.id;
  return null;
}

export interface TVmazeSchedule {
  // "season:episode" -> a REAL UTC timestamp, only for episodes where
  // TVmaze has an actual broadcast time on file (airtime non-empty).
  byEpisode: Record<string, string>;
  // "season:episode" -> TVmaze's own calendar date, populated for every
  // episode regardless of whether a time is known. Verified live against
  // published release-schedule coverage: for Silo season 3, this date was
  // CORRECT (matched press reporting exactly, e.g. episode 4 on July 24)
  // while TMDB's own air_date for the same episode was a day early (July
  // 23) — TMDB's TV date field is not reliably accurate for a global
  // simultaneous streaming drop the way TVmaze's is, so this is the
  // preferred date anchor for lib/streamingSchedules.ts's platform-time
  // heuristic, in place of TMDB's date.
  byEpisodeDate: Record<string, string>;
}

// Every known schedule entry for a show, keyed "season:episode" — the shape
// lib/airtimes.ts caches in catalog metadata. null = show not found on
// TVmaze (callers negative-cache that too, so an unmatched show isn't
// re-queried on every read).
export async function tvmazeAirstamps(imdbId: string | null, title: string): Promise<TVmazeSchedule | null> {
  const showId = await resolveShowId(imdbId, title);
  if (showId == null) return null;
  const episodes = await tvmazeGET<TVmazeEpisode[]>(`/shows/${showId}/episodes?specials=1`);
  if (!episodes) return null;
  const byEpisode: Record<string, string> = {};
  const byEpisodeDate: Record<string, string> = {};
  for (const ep of episodes) {
    if (ep.number == null) continue;
    const key = `${ep.season}:${ep.number}`;
    if (ep.airdate) byEpisodeDate[key] = ep.airdate;
    // airtime === "" is TVmaze's own convention for "no real broadcast time
    // on file" — airstamp in that case is just the date glued to a
    // placeholder T12:00:00Z, not a genuine timestamp. The DATE above is
    // kept regardless (it's independently reliable — see TVmazeSchedule's
    // doc comment); only the exact-time claim is rejected here.
    if (ep.airstamp && ep.airtime) byEpisode[key] = ep.airstamp;
  }
  return { byEpisode, byEpisodeDate };
}
