// Trakt's "anticipated" lists — the real quality signal for "Popular
// upcoming"'s movies and brand-new TV (see lib/upcomingCalendar.ts). TMDB's
// own `popularity`/`vote_count` fields are BOTH useless for anything not yet
// released: verified live that Avengers: Doomsday and a completely unknown
// short film scored the same 1-2 on TMDB's popularity, and vote_count is 0
// for literally every unreleased title regardless of how big it is (nobody
// can vote on a movie before it exists). Trakt's anticipated lists rank by
// `list_count` — how many Trakt users have actually added the title to a
// personal watchlist, a real behavioral signal — and are inherently small
// (~200 movies, ~60 shows at the time this was built), since they only ever
// include titles with SOME genuine anticipation. Membership in the list IS
// the quality gate here; there's no further threshold layered on top.
//
// Covers brand-new (never-aired) titles ONLY — verified live that zero of
// Silo/Adults/House of the Dragon/Ted Lasso/Reacher/Rings of Power/Slow
// Horses (all genuinely renewed, already-aired shows) appear in
// shows/anticipated; every entry there has aired_episodes: 0. Returning
// shows' season premieres are a completely separate mechanism (see
// upcomingCalendar.ts's nextSeasonPremiere-based scan) — Trakt doesn't
// track "how anticipated is season 3 of an existing hit," only "brand new
// thing nobody's seen yet."

const TRAKT_API_BASE = "https://api.trakt.tv";
// Trakt's front end sits behind Cloudflare bot-protection that blocks
// requests with no User-Agent (or a generic Node/fetch one) with a 403
// "Attention Required" challenge page instead of JSON — verified live. A
// plausible browser-style User-Agent is enough to pass.
const USER_AGENT = "Mozilla/5.0 (compatible; Trackr/1.0; +https://github.com)";

function headers(): HeadersInit {
  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId) throw new Error("TRAKT_CLIENT_ID is not set");
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    "User-Agent": USER_AGENT,
  };
}

interface TraktAnticipatedRow {
  list_count: number;
}

// Trakt's anticipated lists are small (a few pages at most) — walked fully
// via its own x-pagination-page-count header rather than an assumed depth,
// so this stays correct if the list ever grows or shrinks.
async function fetchAllPages<T extends TraktAnticipatedRow>(path: string): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${TRAKT_API_BASE}${path}?limit=100&page=${page}&extended=full`, {
      headers: headers(),
    });
    if (!res.ok) break;
    const data = (await res.json()) as T[];
    results.push(...data);
    const totalPages = Number(res.headers.get("x-pagination-page-count") ?? "1");
    if (page >= totalPages || data.length === 0) break;
    page++;
  }
  return results;
}

interface TraktMovieRow extends TraktAnticipatedRow {
  movie: { ids: { tmdb: number | null } };
}

interface TraktShowRow extends TraktAnticipatedRow {
  show: { ids: { tmdb: number | null } };
}

// TMDB id -> Trakt's list_count (kept in case a future read wants the raw
// number; today's callers only check Set membership).
export async function fetchTraktAnticipatedMovieIds(): Promise<Map<number, number>> {
  const rows = await fetchAllPages<TraktMovieRow>("/movies/anticipated");
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.movie.ids.tmdb) map.set(r.movie.ids.tmdb, r.list_count);
  }
  return map;
}

export async function fetchTraktAnticipatedShowIds(): Promise<Map<number, number>> {
  const rows = await fetchAllPages<TraktShowRow>("/shows/anticipated");
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.show.ids.tmdb) map.set(r.show.ids.tmdb, r.list_count);
  }
  return map;
}
