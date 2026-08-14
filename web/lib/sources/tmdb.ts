import type { EpisodeInfo, ExternalLink, LinkKind, MediaItem, ReviewScores } from "@/lib/types";
import type { CatalogRow } from "@/lib/catalog";
import type { UpcomingRow } from "@/lib/upcoming";
import type { TrendingRow } from "@/lib/trending";
import { isExactMatch, RankedItem } from "./textMatch";
import { mapWithConcurrency, withRetries } from "./concurrency";
import { fetchOMDbRatings } from "./omdb";

// TMDB adapter (TS port). Maps TMDB's JSON into our MediaItem.
// Runs server-side only (in an API route), so TMDB_API_KEY stays secret.
// Covers both movies (search/movie) and TV shows (search/tv) — TV is what
// makes "new episode this Friday" possible via next_episode_to_air.

// w342 (not w500) — every poster surface in the app renders at 144px CSS
// width or less (grid cards, feed rows, the modal thumbnail); w342 stays
// sharp at 2x DPR for anything that small while cutting real bytes off
// every image on the site. w500 was sized for a full-detail single poster
// view that doesn't exist here.
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
// Backdrops render as a full-width hero header (see DetailModal), so they
// need more resolution than the w500 posters.
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

// Quality bar: cuts out obscure/low-signal entries (see docs/DISCOVER_AND_SEARCH.md).
// Unreleased titles get a pass on vote count — they legitimately have none yet.
const MIN_VOTE_COUNT = 20;
const MIN_POPULARITY = 3;

// A loosely-related result (a tie-in special, an unrelated title that only
// fuzzy/keyword-matched) needs to be MUCH more significant to show up at all
// — this is what keeps something like a minor "X x Y" crossover special or
// an obscure look-alike title from cluttering a search for the thing you
// actually meant. An exact title match always gets the lenient bar above.
// Applies ONLY to already-released titles — see passesQualityBar.
const NON_EXACT_MIN_VOTE_COUNT = 300;
const NON_EXACT_MIN_POPULARITY = 40;

// A strict "release date > now" check flips to "already released" the
// instant the clock crosses midnight on release day — verified live: a real
// show ("THE GHOST IN THE SHELL") releasing TODAY had vote_count 0 and
// popularity 5.5, and was excluded entirely because a few hours old is
// enough for `isFuture` to go false, subjecting it to the standard bar it
// hasn't had time to earn. A title needs real time (weeks, not hours) to
// accumulate votes/popularity after release — grace period covers "just
// released" the same way the unreleased case already does.
const RECENT_RELEASE_GRACE_DAYS = 14;

function isRecentOrFuture(dateStr?: string): boolean {
  if (!dateStr) return true;
  const graceMs = RECENT_RELEASE_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return new Date(dateStr).getTime() + graceMs > Date.now();
}

function passesQualityBar(opts: {
  posterPath?: string | null;
  voteCount: number;
  popularity: number;
  dateStr?: string;
  isExact: boolean;
}): boolean {
  if (!opts.posterPath) return false;
  const isFuture = isRecentOrFuture(opts.dateStr);
  // Unreleased/announced/just-released titles ALWAYS get the lenient bar,
  // exact match or not. Surfacing new announcements before they have any
  // votes/popularity is the whole point of this app — the elevated non-exact
  // bar exists to filter tie-in/crossover spam among EXISTING content, and
  // applying it to brand-new titles too would hide legitimate upcoming or
  // just-released titles just because they haven't accumulated engagement yet.
  if (isFuture) return opts.popularity >= MIN_POPULARITY;
  const minVotes = opts.isExact ? MIN_VOTE_COUNT : NON_EXACT_MIN_VOTE_COUNT;
  const minPopularity = opts.isExact ? MIN_POPULARITY : NON_EXACT_MIN_POPULARITY;
  return opts.voteCount >= minVotes || opts.popularity >= minPopularity * 4;
}

// Would this item clear the bar even if judged as a non-exact match? Used
// purely for ranking (see RankedItem) — lets "Toy Story 2" (a hugely popular
// near-match) outrank an obscure "Toy Story"-titled game/exact-match.
function isSignificant(voteCount: number, popularity: number, dateStr?: string): boolean {
  const isFuture = isRecentOrFuture(dateStr);
  if (isFuture) return popularity >= NON_EXACT_MIN_POPULARITY;
  return voteCount >= NON_EXACT_MIN_VOTE_COUNT || popularity >= NON_EXACT_MIN_POPULARITY * 4;
}

function key(): string {
  const k = process.env.TMDB_API_KEY;
  if (!k) throw new Error("TMDB_API_KEY is not set");
  return k;
}

// ---------- Movies ----------

interface TMDBMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null; // free on every list/detail response, like poster_path
  release_date?: string;
  popularity?: number;
  vote_count?: number;
  original_language?: string; // ISO 639-1 ("ja", "ko", "en", ...) — free on every response
}

// `lenient` (used only by franchise resolution — lib/sources/franchise.ts)
// treats every result as if it were an exact title match for quality-bar
// purposes. The elevated non-exact bar exists to fight general-search
// clutter (see docs/DISCOVER_AND_SEARCH.md — "importance filtering"), not to
// thin out a franchise's own already-precise, curated query — most of a
// franchise's real entries are non-exact matches by construction (e.g.
// "One Piece: Stampede" is not literally "One Piece").
export async function searchTMDBMovie(
  query: string,
  opts?: { lenient?: boolean }
): Promise<RankedItem[]> {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${key()}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB movie search failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBMovie[])
    .filter((m) =>
      passesQualityBar({
        posterPath: m.poster_path,
        voteCount: m.vote_count ?? 0,
        popularity: m.popularity ?? 0,
        dateStr: m.release_date,
        isExact: opts?.lenient || isExactMatch(m.title, query),
      })
    )
    .map((m) => ({
      ...mapMovie(m),
      significant: isSignificant(m.vote_count ?? 0, m.popularity ?? 0, m.release_date),
      // RankedItem.popularity feeds cross-type "Most Popular" ranking (see
      // lib/sources/franchise.ts) — deliberately vote_count, NOT TMDB's
      // `popularity` field. Verified live that `popularity` is a
      // trending/momentary-buzz metric, not a durable one: "Toy Story 5"
      // (unreleased, hyped) had popularity 615 vs. the 1995 original's 72,
      // even though the original has 20,108 votes against Toy Story 5's
      // 508 — using `popularity` here put the least-proven entry first.
      // vote_count accumulates over a title's whole lifetime, matching how
      // IGDB's total_rating_count and MangaDex's follows already behave
      // (both stable/cumulative, not trending).
      popularity: m.vote_count ?? 0,
    }));
}

function mapMovie(m: TMDBMovie): MediaItem {
  return {
    id: `movie:${m.id}`,
    type: "movie",
    title: m.title,
    overview: m.overview || undefined,
    posterURL: m.poster_path ? `${IMAGE_BASE}${m.poster_path}` : undefined,
    backdropURL: m.backdrop_path ? `${BACKDROP_BASE}${m.backdrop_path}` : undefined,
    releaseDate: m.release_date || undefined,
  };
}

// Popular movies (for the Discover page's "Trending movies" shelf).
export async function discoverTMDBMovies(limit = 20): Promise<MediaItem[]> {
  const url = `https://api.themoviedb.org/3/discover/movie?api_key=${key()}&sort_by=popularity.desc&vote_count.gte=100`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB discover movies failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBMovie[]).slice(0, limit).map(mapMovie);
}

// Big and/or brand-new upcoming movies, DATED OR NOT (for "Popular
// upcoming" — see /api/cron/upcoming, lib/upcoming.ts). Two merged
// strategies:
//  (a) discover with a confirmed future date, sorted by popularity — catches
//      "years away but dated."
//  (b) trending/movie/week, filtered to unreleased — TMDB's discover
//      endpoint has no "no date yet" filter to query directly, but trending
//      reacts to real search/view activity, which is exactly what spikes
//      the moment a big UNDATED sequel gets announced.
// Both filtered to release_date empty OR in the future — never something
// already out.
//
// popularity is deliberately NOT an admission gate here anymore — a real,
// officially-confirmed title years out with low current buzz (that's
// exactly what "low current buzz" means for something not releasing soon)
// was being excluded by a popularity floor, which is backwards: popularity
// is a snapshot of CURRENT attention, not a measure of whether a project is
// real. Admission is gated entirely on the official-status check below;
// popularity is stored (popularityScore) purely so read-time consumers that
// specifically want "the popular ones" (the Discover shelf, via
// upcomingTop's pool-then-sort — see lib/upcoming.ts) can select for it,
// without the underlying pool itself being popularity-filtered.

// Real gate on "officially confirmed, not speculative": TMDB tags every
// movie/show with a status. "Rumored" is exactly the fan-leak/speculation
// case a popularity signal can't catch (a rumored sequel can easily be
// plenty "popular"); "Canceled" is dead regardless of popularity. Every
// other status (Planned, In Production, Post Production, Returning Series,
// ...) counts as a real studio project. Not present on discover/trending
// list responses — only the full details endpoint has it, so this costs one
// extra lightweight request per candidate (deliberately NOT the expensive
// movieExtra/tvExtra enrichment — no watch-providers/keywords/per-season
// fetch, just the bare status field). Concurrency raised from the earlier
// popularity-gated version — the candidate pool is much bigger now that
// popularity no longer thins it out before this step.
// A live run against the full (no-longer-popularity-gated) candidate pool
// measured 57.8s total cron time at concurrency 30 — uncomfortably close to
// Vercel's 60s function limit, one slow TMDB response from timing out in
// production. TMDB's documented rate ceiling is ~50 req/s per key; raised
// toward that instead of shrinking the candidate pool back down.
const OFFICIAL_STATUS_CONCURRENCY = 50;
const NON_OFFICIAL_STATUS = new Set(["Rumored", "Canceled"]);

interface TMDBReleaseDateEntry {
  type: number; // 1=Premiere, 2=Theatrical (limited), 3=Theatrical, 4=Digital, 5=Physical, 6=TV
  release_date: string;
}

// TMDB's top-level movie.release_date is NOT reliably the US theatrical
// date — verified live: "Spider-Man: Brand New Day" (id 969681) has a
// top-level release_date of 2026-07-28, but its own /release_dates
// sub-resource lists the real US theatrical release as 2026-07-31. The
// top-level field appears to be whatever TMDB treats as the "primary"
// release (sometimes an early/festival date, sometimes just unreconciled
// with the region data), while /release_dates carries the actual
// per-country dates people mean by "when does this come out". Prefers a
// real theatrical release (type 2 or 3); falls back to the earliest US
// entry of any type (e.g. a digital-only release) rather than nothing.
function usTheatricalDate(releaseDatesResponse: unknown): string | undefined {
  const results = (releaseDatesResponse as { results?: { iso_3166_1: string; release_dates: TMDBReleaseDateEntry[] }[] })
    ?.results;
  const us = results?.find((r) => r.iso_3166_1 === "US");
  if (!us || us.release_dates.length === 0) return undefined;
  const theatrical = us.release_dates.find((r) => r.type === 3) ?? us.release_dates.find((r) => r.type === 2);
  const chosen = theatrical ?? [...us.release_dates].sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
  return chosen?.release_date?.slice(0, 10);
}

// A real WIDE release, not just any theatrical showing. TMDB's type 3
// ("Theatrical") vs type 2 ("Theatrical (limited)") turned out NOT to be a
// reliable "wide" signal on its own — verified live: this admitted "The
// Wrong Girls" (popularity 4.5, a single LA-premiere-then-US-type-3 entry,
// 2 countries total) and "Slice of Life" (popularity 0.0071, ONE country in
// its entire release_dates response) right alongside real wide releases,
// because TMDB's type field is crowd-contributed and applied inconsistently
// for small/indie titles that technically aren't "limited" but were never
// wide either. A genuinely wide release is virtually always day-and-date
// across many territories now (verified live: "The End of Oak Street" had
// type-3 entries in 40+ countries; "Insidious: Out of the Further", a real
// franchise wide release, had 31; the junk titles above had 1-2) — country
// COUNT is what actually distinguishes "wide" from "technically theatrical,"
// so that's the gate, not the type value alone.
// The country COUNT itself, not just a yes/no — needed as a real magnitude,
// not only a gate, so lib/upcomingCalendar.ts's international bar can apply
// its own calibrated floor to non-English wide releases instead of admitting
// every one of them unconditionally (see MAJOR_PICK_EXEMPT there). Returns 0
// (never undefined) when there's no US theatrical entry at all — a title
// with no US release isn't "wide" by this app's own US-centric definition,
// regardless of how many other countries it played in.
function wideUSTheatricalReach(releaseDatesResponse: unknown): number {
  const results = (releaseDatesResponse as { results?: { iso_3166_1: string; release_dates: TMDBReleaseDateEntry[] }[] })
    ?.results;
  if (!results) return 0;
  const us = results.find((r) => r.iso_3166_1 === "US");
  if (!us?.release_dates.some((r) => r.type === 3)) return 0;
  return results.filter((r) => r.release_dates.some((rd) => rd.type === 3)).length;
}

// A show is on one of these iff its /tv/{id} `networks` field names one of
// them — checked via substring, not exact match, since TMDB's own network
// name varies by title ("Netflix" vs "Netflix Animation/Netflix Kids" for
// some children's shows, "Prime Video" vs "Amazon Prime Video"). Deliberately
// a SHORT list of the platforms actually driving major, widely-marketed
// releases — not lib/platformPrefs.ts's full "Streaming" group (Tubi, Pluto
// TV, Kanopy, ...), which exists to match every real "Available on" link,
// not to gate "is this a big-deal show."
const MAJOR_STREAMING_NETWORKS = ["netflix", "max", "hbo", "disney+", "apple tv+", "prime video", "hulu", "paramount+", "peacock"];

// A network match alone isn't "major" — verified live: being ON Netflix
// admitted three low-profile Netflix Originals (Moria/AR popularity 1.7,
// S&X/JP popularity 5.3, Blood Sacrifice/SE popularity 4.7) right alongside
// real hits, because Netflix (and every other platform on the list above)
// hosts a huge volume of small regional/niche content, not just its
// flagship titles. Returns the show's own popularity when it matches a
// major network (0 otherwise), same "magnitude, not just yes/no" reasoning
// as wideUSTheatricalReach — lib/upcomingCalendar.ts applies BOTH the
// admission floor and (for non-English rows) the international bar's own,
// stricter floor against this same stored number.
function majorStreamingReach(networks: unknown, popularity: number): number {
  const names = (networks as { name?: string }[] | undefined)?.map((n) => n.name?.toLowerCase() ?? "") ?? [];
  const isMajorNetwork = names.some((n) => MAJOR_STREAMING_NETWORKS.some((major) => n.includes(major)));
  return isMajorNetwork ? popularity : 0;
}

interface StatusResult {
  status?: string;
  // Movie-only — see usTheatricalDate. Corrects releaseDate on the calling
  // row when present; undefined for TV (no equivalent field fetched) or
  // when the movie has no US release_dates entry at all.
  usReleaseDate?: string;
  // True whenever this fetch actually completed (whether or not a US entry
  // existed to correct with) — false ONLY on the catch path below, i.e. the
  // request itself failed after retries. Deliberately NOT the same signal
  // as "usReleaseDate is present": a foreign film can legitimately have no
  // US release_dates entry at all, which is a successful fetch that simply
  // found nothing to correct, not a failure. Conflating the two used to mean
  // a single flaky request for one movie (out of thousands, once) fell back
  // to that run's raw, uncorrected discover-endpoint date and got WRITTEN
  // OVER an already-correct stored date — verified live on "Spider-Man:
  // Brand New Day," which reverted from its correct 2026-07-31 back to the
  // wrong 2026-07-28 this way. See filterOfficialOnly/upsertUpcoming for how
  // this flag now guards against that instead of just hoping retries win.
  fetchOk: boolean;
  // "How major" — country count for a wide US theatrical release (movie,
  // via wideUSTheatricalReach) or popularity for a major-platform show (TV,
  // via majorStreamingReach); 0 for neither. Piggybacks on this same
  // per-item request for both kinds: movies already fetch release_dates
  // here, and TV's base /tv/{id} response already includes
  // `networks`/`popularity` with no append needed. Always 0 (never
  // undefined) on a failed fetch, same reasoning as majorRelease had before
  // — a flaky request can't be mistaken for "checked, not major."
  majorReleaseScore: number;
}

async function fetchStatus(kind: "movie" | "tv", id: number): Promise<StatusResult> {
  try {
    return await withRetries(async () => {
      // append_to_response costs nothing extra (one request either way) —
      // this piggybacks the US-date correction onto the SAME per-item call
      // filterOfficialOnly already makes for every upcoming movie, rather
      // than adding a second round of requests.
      const append = kind === "movie" ? "&append_to_response=release_dates" : "";
      const res = await fetch(`https://api.themoviedb.org/3/${kind}/${id}?api_key=${key()}${append}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`TMDB ${kind} status (${id}) failed: ${res.status}`);
      const d = await res.json();
      return {
        status: d.status as string | undefined,
        usReleaseDate: kind === "movie" ? usTheatricalDate(d.release_dates) : undefined,
        fetchOk: true,
        majorReleaseScore:
          kind === "movie" ? wideUSTheatricalReach(d.release_dates) : majorStreamingReach(d.networks, d.popularity ?? 0),
      };
    });
  } catch {
    // Unknown status/date on a persistent failure — don't let one flaky
    // request silently exclude an otherwise-legitimate title or crash the
    // date correction; the row just keeps its original release_date this
    // run, but fetchOk: false stops that unverified value from ever being
    // written over a previously-good one (see upsertUpcoming). majorReleaseScore
    // stays 0 rather than carrying forward a stale prior value — this
    // score is fully recomputed every run, unlike releaseDate.
    return { fetchOk: false, majorReleaseScore: 0 };
  }
}

async function filterOfficialOnly<T extends { id: string; releaseDate?: string; dateVerified?: boolean; majorReleaseScore?: number }>(
  kind: "movie" | "tv",
  rows: T[]
): Promise<T[]> {
  const results = await mapWithConcurrency(rows, OFFICIAL_STATUS_CONCURRENCY, (row) =>
    fetchStatus(kind, Number(row.id.split(":")[1]))
  );
  // Pair each row with its result BEFORE filtering — filtering first would
  // shift indices in the surviving array out of sync with `results`.
  return rows
    .map((row, i) => ({ row, result: results[i] }))
    .filter((x) => !NON_OFFICIAL_STATUS.has(x.result.status ?? ""))
    .map((x) => ({
      ...x.row,
      ...(x.result.usReleaseDate ? { releaseDate: x.result.usReleaseDate } : {}),
      dateVerified: x.result.fetchOk,
      majorReleaseScore: x.result.majorReleaseScore,
    }));
}

// TMDB discover pagination — 20 results/page. Fetches page 1 first to learn
// the REAL total_pages (TMDB's own count), then fetches the rest
// concurrently up to `maxPages` — covers the actual full result set without
// either guessing a fixed depth (wasting requests on pages past the real
// end) or under-fetching (missing real candidates because a limit was tied
// to the display count rather than what's actually out there). "Vast" means
// this should cover TMDB's whole dated-upcoming catalog, not a slice of it —
// verified live, TMDB's own totals for confirmed-future titles are modest
// (low thousands for movies, low hundreds for TV), well within reach.
const DISCOVER_PAGE_CONCURRENCY = 15;

async function discoverPages<T>(url: (page: number) => string, maxPages: number): Promise<T[]> {
  // Every page fetch retries with backoff — verified live that a long
  // multi-list run (the backdrop backfill walks movie pages then TV pages
  // back-to-back) trips TMDB's rate limiter with a real 429 partway
  // through, and one throttled page shouldn't sink the whole run. Backoff
  // starts at 2s: TMDB's throttle window is per-second, so the 500ms
  // default just retries into the same closed window.
  const fetchPage = (page: number) =>
    withRetries(async () => {
      const res = await fetch(url(page), { cache: "no-store" });
      if (!res.ok) throw new Error(`TMDB discover (page ${page}) failed: ${res.status}`);
      return res.json();
    }, 4, 2000);

  const firstData = await fetchPage(1);
  const results: T[] = (firstData.results ?? []) as T[];
  const totalPages = Math.min(firstData.total_pages ?? 1, maxPages);
  if (totalPages <= 1) return results;

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const rest = await mapWithConcurrency(remainingPages, DISCOVER_PAGE_CONCURRENCY, async (page) => {
    const data = await fetchPage(page);
    return (data.results ?? []) as T[];
  });
  return [...results, ...rest.flat()];
}

// Deliberately high — TMDB's real total for confirmed-future movies is a
// couple thousand; this covers all of it rather than an arbitrary slice.
const UPCOMING_MOVIE_MAX_PAGES = 200;

export async function discoverTMDBUpcomingMovies(limit = 4000): Promise<UpcomingRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const genreMap = await tmdbGenreMap("movie");
  const [dated, trending] = await Promise.all([
    discoverPages<TMDBDiscoverMovie>(
      (page) =>
        `https://api.themoviedb.org/3/discover/movie?api_key=${key()}&sort_by=popularity.desc&primary_release_date.gte=${today}&page=${page}`,
      UPCOMING_MOVIE_MAX_PAGES
    ),
    discoverPages<TMDBDiscoverMovie>((page) => `https://api.themoviedb.org/3/trending/movie/week?api_key=${key()}&page=${page}`, 5),
  ]);
  const genresOf = (m: TMDBDiscoverMovie) => (m.genre_ids ?? []).map((id) => genreMap.get(id)).filter((n): n is string => !!n);

  const rows = new Map<string, UpcomingRow>();
  for (const m of dated) {
    if (!m.poster_path || !m.release_date) continue;
    rows.set(`movie:${m.id}`, {
      id: `movie:${m.id}`,
      type: "movie",
      title: m.title,
      overview: m.overview || undefined,
      posterURL: `${IMAGE_BASE}${m.poster_path}`,
      backdropURL: m.backdrop_path ? `${BACKDROP_BASE}${m.backdrop_path}` : undefined,
      releaseDate: m.release_date,
      dateConfirmed: true,
      popularityScore: Math.round(m.popularity ?? 0),
      genres: genresOf(m),
      originalLanguage: m.original_language,
      externalLinks: tmdbPageFallback("movie", String(m.id)),
    });
  }
  for (const m of trending) {
    const id = `movie:${m.id}`;
    const unreleased = !m.release_date || m.release_date > today;
    if (!m.poster_path || !unreleased || rows.has(id)) continue;
    rows.set(id, {
      id,
      type: "movie",
      title: m.title,
      overview: m.overview || undefined,
      posterURL: `${IMAGE_BASE}${m.poster_path}`,
      backdropURL: m.backdrop_path ? `${BACKDROP_BASE}${m.backdrop_path}` : undefined,
      releaseDate: m.release_date && m.release_date > today ? m.release_date : undefined,
      dateConfirmed: !!(m.release_date && m.release_date > today),
      popularityScore: Math.round(m.popularity ?? 0),
      genres: genresOf(m),
      originalLanguage: m.original_language,
      externalLinks: tmdbPageFallback("movie", String(m.id)),
    });
  }
  const official = await filterOfficialOnly("movie", [...rows.values()]);
  return official.slice(0, limit);
}

// ---------- TV shows ----------

interface TMDBShow {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null; // free on every list/detail response, like poster_path
  first_air_date?: string;
  status?: string; // "Returning Series", "Ended", "Canceled", ...
  popularity?: number;
  vote_count?: number;
  original_language?: string; // ISO 639-1 ("ja", "ko", "en", ...) — free on every response
  number_of_episodes?: number;
  seasons?: { season_number: number; episode_count: number }[];
  next_episode_to_air?: {
    air_date: string;
    episode_number: number;
    season_number: number;
    name?: string;
  } | null;
}

export async function searchTMDBTV(
  query: string,
  opts?: { lenient?: boolean }
): Promise<RankedItem[]> {
  const url = `https://api.themoviedb.org/3/search/tv?api_key=${key()}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB TV search failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBShow[])
    .filter((s) =>
      passesQualityBar({
        posterPath: s.poster_path,
        voteCount: s.vote_count ?? 0,
        popularity: s.popularity ?? 0,
        dateStr: s.first_air_date,
        isExact: opts?.lenient || isExactMatch(s.name, query),
      })
    )
    .map((s) => ({
      ...mapShow(s),
      significant: isSignificant(s.vote_count ?? 0, s.popularity ?? 0, s.first_air_date),
      // See the identical comment in searchTMDBMovie — vote_count, not
      // TMDB's trending `popularity` field, for the same reason.
      popularity: s.vote_count ?? 0,
    }));
}

function mapShow(s: TMDBShow): MediaItem {
  const next = s.next_episode_to_air;
  return {
    id: `tvShow:${s.id}`,
    type: "tvShow",
    title: s.name,
    subtitle: next
      ? `S${next.season_number} E${next.episode_number}`
      : s.status || undefined,
    overview: s.overview || undefined,
    posterURL: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : undefined,
    backdropURL: s.backdrop_path ? `${BACKDROP_BASE}${s.backdrop_path}` : undefined,
    // Only set when a next episode is actually scheduled — otherwise the show
    // simply doesn't appear in the release feed (nothing to be "up to date" on).
    releaseDate: next?.air_date,
  };
}

interface TMDBSeason {
  episodes?: { episode_number: number; name?: string; air_date?: string }[];
}

// Every episode's air date, across every season — TMDB's base /tv/{id}
// response only has the NEXT episode; the full list needs one request per
// season (there's no single "all episodes" endpoint). Fetched concurrently;
// only called from details() (one show at a time), never from search.
async function allEpisodes(
  id: string,
  seasons: { season_number: number }[] | undefined
): Promise<EpisodeInfo[]> {
  if (!seasons || seasons.length === 0) return [];
  // Season 0 ("Specials") is bonus/spinoff material — OVAs, recaps,
  // companion shorts — not real episode releases; TMDB's own
  // number_of_episodes already excludes it. Verified live on Re:ZERO,
  // whose Season 0 is a weekly companion mini-series airing right
  // alongside each real episode, which made every real episode look like
  // it had two calendar entries once every season (including 0) was
  // included here.
  const realSeasons = seasons.filter((s) => s.season_number !== 0);
  const results = await Promise.allSettled(
    realSeasons.map((s) =>
      fetch(
        `https://api.themoviedb.org/3/tv/${id}/season/${s.season_number}?api_key=${key()}`,
        { cache: "no-store" }
      ).then((r) => (r.ok ? r.json() : null))
    )
  );

  const episodes: EpisodeInfo[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value) return;
    const season = r.value as TMDBSeason;
    for (const ep of season.episodes ?? []) {
      episodes.push({
        season: realSeasons[i].season_number,
        episode: ep.episode_number,
        title: ep.name,
        airDate: ep.air_date,
      });
    }
  });
  return episodes;
}

// Popular TV shows (for the Discover page's "Trending TV" shelf).
export async function discoverTMDBTV(limit = 20): Promise<MediaItem[]> {
  const url = `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=popularity.desc&vote_count.gte=100`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB discover TV failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBShow[]).slice(0, limit).map((s) => ({
    id: `tvShow:${s.id}`,
    type: "tvShow" as const,
    title: s.name,
    overview: s.overview || undefined,
    posterURL: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : undefined,
    releaseDate: undefined,
  }));
}

// TMDB's TV popularity ranking is dominated by daily programming — soaps,
// talk shows, news, reality — which is "popular" in the metric but slop in
// an upcoming/new-releases feed (a soap gets a new "season" constantly).
// Excluded by genre id at the API level wherever we discover TV:
// News 10763, Reality 10764, Soap 10766, Talk 10767.
const TV_JUNK_GENRES = "10763,10764,10766,10767";

// Deliberately high — TMDB's real total for confirmed-future TV is only a
// few hundred (verified live), so this comfortably covers all of it.
const UPCOMING_TV_MAX_PAGES = 50;

// Big and/or brand-new upcoming shows, DATED OR NOT — same merged
// dated+trending strategy as discoverTMDBUpcomingMovies above. No popularity
// admission gate (see the comment on that removal above filterOfficialOnly)
// — junk-genre exclusion (TV_JUNK_GENRES) plus the official-status check are
// what keep this clean now, not a popularity threshold.
export async function discoverTMDBUpcomingTV(limit = 1000): Promise<UpcomingRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const genreMap = await tmdbGenreMap("tv");
  const [dated, trending] = await Promise.all([
    discoverPages<TMDBDiscoverShow>(
      (page) =>
        `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=popularity.desc&first_air_date.gte=${today}&without_genres=${TV_JUNK_GENRES}&page=${page}`,
      UPCOMING_TV_MAX_PAGES
    ),
    discoverPages<TMDBDiscoverShow>((page) => `https://api.themoviedb.org/3/trending/tv/week?api_key=${key()}&page=${page}`, 5),
  ]);
  const genresOf = (s: TMDBDiscoverShow) => (s.genre_ids ?? []).map((id) => genreMap.get(id)).filter((n): n is string => !!n);

  const rows = new Map<string, UpcomingRow>();
  for (const s of dated) {
    if (!s.poster_path || !s.first_air_date) continue;
    rows.set(`tvShow:${s.id}`, {
      id: `tvShow:${s.id}`,
      type: "tvShow",
      title: s.name,
      overview: s.overview || undefined,
      posterURL: `${IMAGE_BASE}${s.poster_path}`,
      backdropURL: s.backdrop_path ? `${BACKDROP_BASE}${s.backdrop_path}` : undefined,
      releaseDate: s.first_air_date,
      dateConfirmed: true,
      popularityScore: Math.round(s.popularity ?? 0),
      genres: genresOf(s),
      originalLanguage: s.original_language,
      externalLinks: tmdbPageFallback("tv", String(s.id)),
    });
  }
  for (const s of trending) {
    const id = `tvShow:${s.id}`;
    const unreleased = !s.first_air_date || s.first_air_date > today;
    if (!s.poster_path || !unreleased || rows.has(id)) continue;
    rows.set(id, {
      id,
      type: "tvShow",
      title: s.name,
      overview: s.overview || undefined,
      posterURL: `${IMAGE_BASE}${s.poster_path}`,
      backdropURL: s.backdrop_path ? `${BACKDROP_BASE}${s.backdrop_path}` : undefined,
      releaseDate: s.first_air_date && s.first_air_date > today ? s.first_air_date : undefined,
      dateConfirmed: !!(s.first_air_date && s.first_air_date > today),
      popularityScore: Math.round(s.popularity ?? 0),
      genres: genresOf(s),
      originalLanguage: s.original_language,
      externalLinks: tmdbPageFallback("tv", String(s.id)),
    });
  }
  const official = await filterOfficialOnly("tv", [...rows.values()]);
  return official.slice(0, limit);
}

// ---------- Trending (app/api/cron/daily/route.ts, via lib/trending.ts;
// also lib/upcomingCalendar.ts's fetchTrendingAdmitted) ----------
// TMDB's own trending/week endpoint IS a real momentum signal (recent
// views/searches), unlike `popularity` used elsewhere in this file for
// admission gating — this is the one place that signal is exactly what's
// wanted. Already ranked by TMDB itself; `rank` here is just the response's
// own order (1 = most trending), not a recomputed score.
//
// `pages` defaults to 1 (the Discover shelf's own need — ~20 items is
// plenty for a shelf) but the calendar's admission use needs much deeper
// coverage: trending/week mixes already-released AND upcoming titles, so
// only a small slice of any one page is genuinely unreleased — verified
// live, page 1 alone matched only 1 of our own upcoming movie rows. Pages
// are fetched IN PARALLEL and concatenated in TMDB's own rank order (page 1
// before page 2, etc.), not re-sorted, since `rank` is meant to reflect
// TMDB's real ordering, not this function's fetch order.
async function fetchTMDBTrendingPages<T>(
  url: (page: number) => string,
  pages: number
): Promise<T[]> {
  const responses = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetch(url(i + 1), { cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
        return (await res.json()).results as T[];
      })
    )
  );
  return responses.flat();
}

export async function discoverTMDBTrendingMovies(limit = 20, pages = 1): Promise<TrendingRow[]> {
  const genreMap = await tmdbGenreMap("movie");
  const results = (
    await fetchTMDBTrendingPages<TMDBDiscoverMovie>(
      (page) => `https://api.themoviedb.org/3/trending/movie/week?api_key=${key()}&page=${page}`,
      pages
    )
  ).filter((m) => m.poster_path);
  return results.slice(0, limit).map((m, i) => ({
    id: `movie:${m.id}`,
    type: "movie",
    title: m.title,
    overview: m.overview || undefined,
    posterURL: `${IMAGE_BASE}${m.poster_path}`,
    backdropURL: m.backdrop_path ? `${BACKDROP_BASE}${m.backdrop_path}` : undefined,
    releaseDate: m.release_date || undefined,
    rank: i + 1,
    genres: (m.genre_ids ?? []).map((id) => genreMap.get(id)).filter((n): n is string => !!n),
    originalLanguage: m.original_language,
  }));
}

export async function discoverTMDBTrendingTV(limit = 20, pages = 1): Promise<TrendingRow[]> {
  const genreMap = await tmdbGenreMap("tv");
  const results = (
    await fetchTMDBTrendingPages<TMDBDiscoverShow>(
      (page) => `https://api.themoviedb.org/3/trending/tv/week?api_key=${key()}&page=${page}`,
      pages
    )
  ).filter((s) => s.poster_path);
  return results.slice(0, limit).map((s, i) => ({
    id: `tvShow:${s.id}`,
    type: "tvShow",
    title: s.name,
    overview: s.overview || undefined,
    posterURL: `${IMAGE_BASE}${s.poster_path}`,
    backdropURL: s.backdrop_path ? `${BACKDROP_BASE}${s.backdrop_path}` : undefined,
    releaseDate: s.first_air_date || undefined,
    rank: i + 1,
    genres: (s.genre_ids ?? []).map((id) => genreMap.get(id)).filter((n): n is string => !!n),
    originalLanguage: s.original_language,
  }));
}

// ---------- Bulk catalog ingestion (scripts/ingest-catalog.ts only) ----------
// Sorted by vote_count (a stable, cumulative signal — see the identical
// rationale in searchTMDBMovie), NOT TMDB's own trending `popularity` field,
// so "most popular N" means genuinely most-established, not momentarily
// hyped. TMDB caps any list endpoint at page 500 (20/page = 10,000 results),
// which conveniently matches the ~10k target.
const TMDB_MAX_PAGE = 500;

// Genre id -> name, fetched once per ingestion run and reused across every
// page (TMDB has no per-item genre-name field, only numeric `genre_ids`).
export async function tmdbGenreMap(kind: "movie" | "tv"): Promise<Map<number, string>> {
  const url = `https://api.themoviedb.org/3/genre/${kind}/list?api_key=${key()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB genre list failed: ${res.status}`);
  const data = await res.json();
  const map = new Map<number, string>();
  for (const g of data.genres as { id: number; name: string }[]) map.set(g.id, g.name);
  return map;
}

interface TMDBDiscoverMovie extends TMDBMovie {
  genre_ids?: number[];
}

// TMDB's watch/providers endpoint correctly identifies WHICH real services
// carry a title, but its only URL (`link`) is always TMDB's own aggregator
// page (verified live — every provider entry shares one identical
// themoviedb.org URL, regardless of provider). There is no public API for
// true per-title deep links (that data belongs to JustWatch's commercial-only
// API). This maps TMDB's provider name to that service's OWN site and builds
// a search-by-title URL there instead — a real link to the actual platform,
// not a guaranteed exact-title deep link. Ordered so a more specific brand
// (e.g. "Paramount+ Amazon Channel") matches its own rule before falling
// through to a more generic one that happens to share a word ("Amazon").
// Named/branded services all come before the generic reseller platforms
// (apple/google play/youtube/amazon) at the bottom — those four are also
// the most common CHANNEL-BUNDLE suffix ("Crunchyroll Amazon Channel",
// "Starz Apple TV Channel", ...), so if they matched first every bundled
// service would get mislabeled as whichever storefront resold it instead
// of its real name. Verified against real TMDB watch/providers responses,
// not guessed — see the account/notes around this file for the sampled
// titles this was checked against.
const PROVIDER_SEARCH_RULES: { pattern: string; provider: string; searchURL: (title: string) => string }[] = [
  { pattern: "crunchyroll", provider: "Crunchyroll", searchURL: (t) => `https://www.crunchyroll.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "paramount", provider: "Paramount+", searchURL: (t) => `https://www.paramountplus.com/search/?query=${encodeURIComponent(t)}` },
  { pattern: "disney", provider: "Disney+", searchURL: (t) => `https://www.disneyplus.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "peacock", provider: "Peacock", searchURL: (t) => `https://www.peacocktv.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "netflix", provider: "Netflix", searchURL: (t) => `https://www.netflix.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "hulu", provider: "Hulu", searchURL: (t) => `https://www.hulu.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "max", provider: "Max", searchURL: (t) => `https://play.max.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "starz", provider: "Starz", searchURL: (t) => `https://www.starz.com/us/en/search?q=${encodeURIComponent(t)}` },
  { pattern: "showtime", provider: "Showtime", searchURL: (t) => `https://www.showtime.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "mgm", provider: "MGM+", searchURL: (t) => `https://www.mgmplus.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "amc", provider: "AMC+", searchURL: (t) => `https://www.amcplus.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "discovery", provider: "Discovery+", searchURL: (t) => `https://www.discoveryplus.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "espn", provider: "ESPN+", searchURL: (t) => `https://www.espn.com/watch/search?q=${encodeURIComponent(t)}` },
  { pattern: "tubi", provider: "Tubi", searchURL: (t) => `https://tubitv.com/search/${encodeURIComponent(t)}` },
  { pattern: "pluto", provider: "Pluto TV", searchURL: () => `https://pluto.tv/` },
  { pattern: "roku channel", provider: "The Roku Channel", searchURL: (t) => `https://therokuchannel.roku.com/search/${encodeURIComponent(t)}` },
  { pattern: "fandango", provider: "Fandango At Home", searchURL: (t) => `https://www.fandangoathome.com/search/${encodeURIComponent(t)}` },
  { pattern: "plex", provider: "Plex", searchURL: (t) => `https://watch.plex.tv/search?query=${encodeURIComponent(t)}` },
  { pattern: "shudder", provider: "Shudder", searchURL: (t) => `https://www.shudder.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "britbox", provider: "BritBox", searchURL: (t) => `https://www.britbox.com/us/search/${encodeURIComponent(t)}` },
  { pattern: "acorn", provider: "Acorn TV", searchURL: (t) => `https://acorn.tv/search/?q=${encodeURIComponent(t)}` },
  { pattern: "fubo", provider: "fuboTV", searchURL: (t) => `https://www.fubo.tv/search?q=${encodeURIComponent(t)}` },
  { pattern: "sling", provider: "Sling TV", searchURL: () => `https://www.sling.com/` },
  { pattern: "philo", provider: "Philo", searchURL: () => `https://www.philo.com/` },
  { pattern: "criterion", provider: "Criterion Channel", searchURL: (t) => `https://www.criterionchannel.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "kanopy", provider: "Kanopy", searchURL: (t) => `https://www.kanopy.com/en/search?query=${encodeURIComponent(t)}` },
  { pattern: "hoopla", provider: "Hoopla", searchURL: (t) => `https://www.hoopladigital.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "hidive", provider: "HIDIVE", searchURL: (t) => `https://www.hidive.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "apple", provider: "Apple TV+", searchURL: (t) => `https://tv.apple.com/search?term=${encodeURIComponent(t)}` },
  { pattern: "google play", provider: "Google Play Movies", searchURL: (t) => `https://play.google.com/store/search?q=${encodeURIComponent(t)}&c=movies` },
  { pattern: "youtube", provider: "YouTube", searchURL: (t) => `https://www.youtube.com/results?search_query=${encodeURIComponent(t)}` },
  { pattern: "amazon", provider: "Prime Video", searchURL: (t) => `https://www.amazon.com/s?k=${encodeURIComponent(t)}&i=instant-video` },
];

function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(name);
}

// TMDB gives the subscription service and the transactional store DIFFERENT
// literal provider_name strings — verified live against real responses:
// the Apple TV+ subscription is "Apple TV" (flatrate/free only), while the
// pay-per-title storefront is the DISTINCT "Apple TV Store" (rent/buy only).
// PROVIDER_SEARCH_RULES' plain "apple" substring pattern matched both and
// collapsed them onto one label — verified live: a movie rentable ONLY on
// "Apple TV Store" was showing as bare "Apple TV+", implying it was
// included with the subscription. Amazon splits the same way — the
// flatrate subscription ("Amazon Prime Video"/"...with Ads") is labeled
// "Prime Video"; the pay-per-title store ("Amazon Video") keeps its own
// "Amazon Video" name rather than also being folded into "Prime Video" —
// explicit request, since that's still the name people know the rental
// storefront by even though Amazon's marketing has blurred the two.
// "YouTube TV" (a live-TV subscription bundle) is its own real service,
// not the youtube.com rental storefront — PROVIDER_SEARCH_RULES' "youtube"
// pattern would otherwise match "YouTube TV" as a substring and mislabel
// it plain "YouTube," implying free rental availability it doesn't have.
// These exact-name overrides are checked first so cases like this get
// their own correctly-branded label; only after this table misses does
// the generic substring table below run.
const EXACT_PROVIDER_OVERRIDES: Record<string, { provider: string; searchURL: (title: string) => string }> = {
  "apple tv store": { provider: "Apple TV", searchURL: (t) => `https://tv.apple.com/search?term=${encodeURIComponent(t)}` },
  "amazon video": { provider: "Amazon Video", searchURL: (t) => `https://www.amazon.com/s?k=${encodeURIComponent(t)}&i=instant-video` },
  "amazon prime video": { provider: "Prime Video", searchURL: (t) => `https://www.amazon.com/gp/video/search?phrase=${encodeURIComponent(t)}` },
  "amazon prime video with ads": { provider: "Prime Video", searchURL: (t) => `https://www.amazon.com/gp/video/search?phrase=${encodeURIComponent(t)}` },
  "youtube tv": { provider: "YouTube TV", searchURL: () => `https://tv.youtube.com/` },
};

// Reseller "channel" bundles TMDB names as "{real brand} {reseller} Channel"
// (e.g. "Starz Amazon Channel", "Apple TV Amazon Channel") — a separate
// billing path for a subscription the title is already reachable through
// directly. Dropped outright rather than resolved to a label (explicit
// call — these read as noisy/redundant duplicates of the real service,
// not a distinct way to watch): every provider entry ending in one of
// these reseller suffixes is skipped before it ever reaches the rule
// tables below.
const CHANNEL_SUFFIX_RE = /\s+(?:Amazon|Apple TV|Roku Premium|Google Play)\s+Channel$/i;

interface TMDBProviderEntry {
  provider_name: string;
}

function resolveProvider(name: string, title: string): { provider: string; url: string } | null {
  if (CHANNEL_SUFFIX_RE.test(name)) return null;

  const exact = EXACT_PROVIDER_OVERRIDES[name.toLowerCase().trim()];
  if (exact) return { provider: exact.provider, url: exact.searchURL(title) };

  for (const rule of PROVIDER_SEARCH_RULES) {
    if (matchesPattern(name, rule.pattern)) return { provider: rule.provider, url: rule.searchURL(title) };
  }
  return null;
}

// A title that's genuinely, natively on Amazon Prime Video shows ONLY
// "Amazon Prime Video"/"...with Ads" in flatrate. Verified live on "Silo"
// (Apple TV+ exclusive) that JustWatch/TMDB's data ALSO lists bare "Amazon
// Prime Video" right alongside "Apple TV" (the real home) and "Apple TV
// Amazon Channel" (the actual Amazon offering — access to Apple TV+'s
// catalog THROUGH Prime Video's Channels feature, not Prime Video's own
// library) — i.e. the channel pass-through gets duplicated onto the base
// Amazon entry too, not just its own channel entry (which is already
// dropped above). Detected the same way: a title only earns this
// suppression when both a "{brand} Amazon Channel" entry AND that brand's
// own native entry are present in the SAME flatrate list — that pairing is
// the actual evidence of channel-only access, not a real direct Prime
// Video license.
function hasAmazonChannelPassthrough(list: TMDBProviderEntry[] | undefined): boolean {
  if (!list) return false;
  const names = new Set(list.map((p) => p.provider_name));
  return list.some((p) => {
    const m = /^(.+?)\s+Amazon\s+Channel$/i.exec(p.provider_name);
    return m !== null && names.has(m[1].trim());
  });
}

function providerSearchLinks(
  country: { flatrate?: TMDBProviderEntry[]; rent?: TMDBProviderEntry[]; buy?: TMDBProviderEntry[] } | undefined,
  title: string
): ExternalLink[] {
  if (!country) return [];
  const seen = new Set<string>();
  const links: ExternalLink[] = [];
  const suppressAmazonPrime = hasAmazonChannelPassthrough(country.flatrate);
  const scan = (list: TMDBProviderEntry[] | undefined, kind: LinkKind) => {
    for (const p of list ?? []) {
      if (kind === "stream" && suppressAmazonPrime && /^amazon prime video/i.test(p.provider_name)) continue;
      const resolved = resolveProvider(p.provider_name, title);
      const key = `${resolved?.provider ?? p.provider_name}:${kind}`;
      if (!resolved || seen.has(key)) continue;
      seen.add(key);
      links.push({ provider: resolved.provider, url: resolved.url, kind });
    }
  };
  scan(country.flatrate, "stream");
  scan(country.rent, "rent");
  scan(country.buy, "buy");
  return links;
}

// Provider links ONLY, for backfilling stale catalog_items rows in bulk —
// deliberately NOT movieExtra/tvExtra, which also pull runtime/tags (movie)
// or the full per-season episode list (TV, a separate request PER season).
// A catalog-wide refresh only needs the single append_to_response=watch/
// providers field already on the base detail request, so this skips
// everything else rather than paying a TV show's full episode-list cost
// just to re-resolve its provider labels. Reuses providerSearchLinks (the
// same resolution logic movieExtra/tvExtra use) so a future provider-table
// fix never has to be made twice.
//
// withRetries wraps the actual fetch — verified live that a real
// catalog-wide backfill (10k+ movies) started hitting TMDB 429s after
// roughly 1,000-1,500 sustained requests within ~20 seconds; every other
// per-item TMDB call in this file already retries through exactly this
// kind of transient throttling (see fetchStatus), this one just hadn't
// needed it until something actually ran it at full-catalog scale.
export async function fetchWatchProviderLinks(
  kind: "movie" | "tv",
  id: number,
  title: string
): Promise<ExternalLink[]> {
  return withRetries(async () => {
    const url = `https://api.themoviedb.org/3/${kind}/${id}?api_key=${key()}&append_to_response=watch/providers`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`TMDB ${kind} watch/providers (${id}) failed: ${res.status}`);
    const d = await res.json();
    return providerSearchLinks(d["watch/providers"]?.results?.US, title);
  });
}

// Franchise/studio/keyword identifiers for collection matching (see
// scripts/rebuild-collections.ts) — NOT the same as `genres`, which is
// purely for UI badges. belongs_to_collection/production_companies/keywords
// are all in this same movie-details response already, no extra request.
function movieTags(d: {
  belongs_to_collection?: { name?: string } | null;
  production_companies?: { name?: string }[];
  keywords?: { keywords?: { name?: string }[] };
}): string[] {
  const tags: string[] = [];
  if (d.belongs_to_collection?.name) tags.push(d.belongs_to_collection.name);
  for (const c of d.production_companies ?? []) if (c.name) tags.push(c.name);
  for (const k of d.keywords?.keywords ?? []) if (k.name) tags.push(k.name);
  return [...new Set(tags.map((t) => t.toLowerCase().trim()))];
}

// Per-movie enrichment: runtime + provider search links + collection/studio/
// keyword tags — none of this is in the discover response, needs one extra
// request per movie. Exported (alongside tmdbGenreMap) so a one-off script
// can hand-ingest a specific title the same way the bulk pipeline would,
// without duplicating this logic — see scripts/ for an example.
export async function movieExtra(
  id: number,
  title: string
): Promise<{
  runtimeMinutes?: number;
  externalLinks: ExternalLink[];
  tags: string[];
  // Same correction/verification pair as fetchStatus's usReleaseDate/fetchOk
  // (see that function's comment) — this is the OTHER place a movie's raw
  // TMDB release_date needs correcting: any movie ingested straight into
  // catalog_items (discoverTMDBRecentMovies below, or the bulk ingest via
  // paginatedTMDBMovies) went through this function, which never fetched
  // release_dates at all until now, so a graduated movie could carry a wrong
  // date with literally no correction attempted, not just an occasional
  // failed-fetch regression. Piggybacks on this same per-movie request —
  // zero extra TMDB calls.
  usReleaseDate?: string;
  fetchOk: boolean;
  reviewScores?: ReviewScores;
}> {
  try {
    return await withRetries(async () => {
      const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${key()}&append_to_response=watch/providers,keywords,release_dates`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`TMDB movie details (${id}) failed: ${res.status}`);
      const d = await res.json();
      return {
        runtimeMinutes: typeof d.runtime === "number" ? d.runtime : undefined,
        externalLinks: providerSearchLinks(d["watch/providers"]?.results?.US, title),
        tags: movieTags(d),
        usReleaseDate: usTheatricalDate(d.release_dates),
        fetchOk: true,
        // A movie's imdb_id is on this same top-level response — no extra
        // TMDB request needed, just one more (already-budgeted, see
        // lib/sources/omdb.ts) OMDb call.
        reviewScores: await fetchOMDbRatings(typeof d.imdb_id === "string" ? d.imdb_id : undefined),
      };
    });
  } catch {
    return { externalLinks: [], tags: [], fetchOk: false };
  }
}

const MOVIE_DETAIL_CONCURRENCY = 15;

export async function paginatedTMDBMovies(
  targetCount: number,
  onPage?: (fetched: number) => void,
  onEnrich?: (done: number, total: number) => void
): Promise<CatalogRow[]> {
  const genres = await tmdbGenreMap("movie");
  const rows: CatalogRow[] = [];
  for (let page = 1; page <= TMDB_MAX_PAGE && rows.length < targetCount; page++) {
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${key()}&sort_by=vote_count.desc&page=${page}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`TMDB discover movies (page ${page}) failed: ${res.status}`);
    const data = await res.json();
    const results = data.results as TMDBDiscoverMovie[];
    if (!results || results.length === 0) break;
    for (const m of results) {
      if (!m.poster_path) continue;
      rows.push({
        id: `movie:${m.id}`,
        type: "movie",
        title: m.title,
        overview: m.overview || undefined,
        posterURL: `${IMAGE_BASE}${m.poster_path}`,
        backdropURL: m.backdrop_path ? `${BACKDROP_BASE}${m.backdrop_path}` : undefined,
        releaseDate: m.release_date || undefined,
        popularityScore: m.vote_count ?? 0,
        genres: (m.genre_ids ?? []).map((id) => genres.get(id)).filter((n): n is string => !!n),
        originalLanguage: m.original_language,
      });
    }
    onPage?.(rows.length);
  }
  // Dedupe BEFORE enrichment — TMDB's discover pagination isn't perfectly
  // stable when many entries tie on vote_count, so the same id can land on
  // two different pages; enriching it twice would waste a detail request.
  const capped = [...new Map(rows.map((r) => [r.id, r])).values()].slice(0, targetCount);
  await enrichMovieRows(capped, onEnrich);
  return capped;
}

// The per-movie enrichment pass (runtime, provider links, collection/studio/
// keyword tags), shared by the bulk ingest above and the daily
// recent-releases fetch below. Mutates the rows in place.
async function enrichMovieRows(rows: CatalogRow[], onEnrich?: (done: number, total: number) => void): Promise<void> {
  let done = 0;
  await mapWithConcurrency(rows, MOVIE_DETAIL_CONCURRENCY, async (row) => {
    const tmdbId = Number(row.id.split(":")[1]);
    const extra = await movieExtra(tmdbId, row.title);
    // reviewScores lives in metadata (read back by catalogRowToMediaItem)
    // rather than its own column — same treatment as runtimeMinutes here,
    // no schema migration needed for a field this small.
    row.metadata = { runtimeMinutes: extra.runtimeMinutes, reviewScores: extra.reviewScores };
    row.externalLinks = extra.externalLinks;
    row.tags = extra.tags;
    if (extra.usReleaseDate) row.releaseDate = extra.usReleaseDate;
    row.dateVerified = extra.fetchOk;
    done++;
    onEnrich?.(done, rows.length);
  });
}

interface TMDBDiscoverShow extends TMDBShow {
  genre_ids?: number[];
}

interface TMDBSeasonSummary {
  season_number: number;
  name?: string;
  air_date?: string;
  episode_count?: number;
}

interface TMDBShowDetails extends Omit<TMDBShow, "seasons"> {
  seasons?: TMDBSeasonSummary[];
  number_of_seasons?: number;
}

interface TMDBSeasonEpisode {
  episode_number: number;
  name?: string;
  air_date?: string;
  runtime?: number;
}

interface CatalogSeason {
  seasonNumber: number;
  name?: string;
  episodes: { episode: number; title?: string; airDate?: string; runtimeMinutes?: number }[];
}

// TV has no belongs_to_collection equivalent (that field is movie-only), so
// this stays weaker than movieTags — networks/production_companies + the
// TV keywords endpoint (which uses a "results" key, unlike movies' "keywords"
// key — a real TMDB API inconsistency, not a typo).
function tvTags(d: {
  networks?: { name?: string }[];
  production_companies?: { name?: string }[];
  keywords?: { results?: { name?: string }[] };
}): string[] {
  const tags: string[] = [];
  for (const n of d.networks ?? []) if (n.name) tags.push(n.name);
  for (const c of d.production_companies ?? []) if (c.name) tags.push(c.name);
  for (const k of d.keywords?.results ?? []) if (k.name) tags.push(k.name);
  return [...new Set(tags.map((t) => t.toLowerCase().trim()))];
}

// Per-show enrichment: status + full per-season/per-episode breakdown +
// provider search links + network/studio/keyword tags. One request for the
// show itself, plus one more PER SEASON — far more expensive than the movie
// case, since a show's episode data isn't on the show-level response at all.
// Combined with SHOW_DETAIL_CONCURRENCY below, this stacks: with both at
// their old values (8 shows x 5 seasons) TMDB could see 40 simultaneous
// requests — verified live this reliably triggered empty-but-200 season
// responses across many shows in one run, and the SAME shows failed again
// even after lowering this to 3 (15 peak concurrent) with longer retry
// backoff — confirmed via an isolated single-show fetch (no concurrency at
// all) that the data and endpoint are fine, so this really is a load
// problem, not a per-show data gap. Serial per-show (1) keeps peak
// concurrent season requests capped at SHOW_DETAIL_CONCURRENCY.
const SEASON_CONCURRENCY = 1;

// Exported so the daily cron's followed-show refresh (app/api/cron/daily)
// can hand-refresh one show's season/episode data the same way the bulk
// recent-releases pass does, same precedent as movieExtra above.
export async function tvExtra(
  id: number,
  title: string
): Promise<{
  status?: string;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  seasons: CatalogSeason[];
  externalLinks: ExternalLink[];
  tags: string[];
  // IMDb id (via external_ids, free on the same request) — stored in
  // metadata so lib/airtimes.ts can resolve the show on TVmaze exactly
  // instead of by name.
  imdbId?: string;
  // TMDB's own network/platform names (e.g. "Apple TV" for Apple TV+) —
  // already on this same response, no extra request. Consumed by
  // lib/streamingSchedules.ts as the ONLY signal for its known-platform
  // drop-time heuristic, so that heuristic and the date it's applied to
  // both come from the one trusted source instead of cross-referencing a
  // second, less reliable one (TVmaze's own webChannel field).
  networks?: string[];
  // TMDB's OWN "the next episode scheduled to air" field — a direct signal,
  // separate from (and sometimes populated when) the full per-season
  // episode list isn't. Verified live it's frequently null for a show
  // between seasons (a genuine TMDB data gap, not something either signal
  // can recover), but when TMDB does know a next episode, this is the more
  // authoritative source — used as a fallback in catalogRowToMediaItem
  // when scanning the season list doesn't turn one up.
  nextEpisodeToAir?: { season: number; episode: number; airDate: string };
  reviewScores?: ReviewScores;
}> {
  try {
    return await withRetries(async () => {
      const url = `https://api.themoviedb.org/3/tv/${id}?api_key=${key()}&append_to_response=watch/providers,keywords,external_ids`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`TMDB show details (${id}) failed: ${res.status}`);
      const d = (await res.json()) as TMDBShowDetails & {
        "watch/providers"?: { results?: Record<string, unknown> };
        networks?: { name?: string }[];
        production_companies?: { name?: string }[];
        keywords?: { results?: { name?: string }[] };
        external_ids?: { imdb_id?: string | null };
      };

      // Season 0 ("Specials") is bonus/spinoff material, not real episode
      // releases — see allEpisodes' identical filter above for the Re:ZERO
      // case this was verified against (a companion mini-series bundled as
      // Season 0, airing right alongside each real episode).
      const seasonSummaries = (d.seasons ?? []).filter((s) => s.season_number !== 0);
      const seasons = await mapWithConcurrency(seasonSummaries, SEASON_CONCURRENCY, async (s) => {
        try {
          // Retried like every other TMDB call here — a non-ok response now
          // THROWS (instead of silently resolving to "no episodes") so
          // withRetries actually gets a chance to recover a transient
          // failure before this season falls back to empty. Longer backoff
          // than the default (4 attempts, 900ms base — ~900/1800/3600ms
          // between tries) since the actual failure mode observed live was
          // rate-limiting under concurrent load, which needs more time to
          // clear than a single quick retry gives it.
          return await withRetries(async () => {
            const seasonRes = await fetch(
              `https://api.themoviedb.org/3/tv/${id}/season/${s.season_number}?api_key=${key()}`,
              { cache: "no-store" }
            );
            if (!seasonRes.ok) {
              throw new Error(`TMDB season fetch (${id}/${s.season_number}) failed: ${seasonRes.status}`);
            }
            const seasonData = await seasonRes.json();
            const episodes = (seasonData.episodes as TMDBSeasonEpisode[] | undefined ?? []).map((e) => ({
              episode: e.episode_number,
              title: e.name || undefined,
              airDate: e.air_date || undefined,
              runtimeMinutes: e.runtime ?? undefined,
            }));
            return { seasonNumber: s.season_number, name: s.name, episodes };
          }, 4, 900);
        } catch {
          return { seasonNumber: s.season_number, name: s.name, episodes: [] };
        }
      });

      return {
        status: d.status || undefined,
        numberOfSeasons: d.number_of_seasons,
        numberOfEpisodes: d.number_of_episodes,
        seasons,
        externalLinks: providerSearchLinks(
          d["watch/providers"]?.results?.US as Parameters<typeof providerSearchLinks>[0],
          title
        ),
        tags: tvTags(d),
        imdbId: d.external_ids?.imdb_id ?? undefined,
        networks: (d.networks ?? []).map((n) => n.name).filter((n): n is string => !!n),
        nextEpisodeToAir: d.next_episode_to_air
          ? {
              season: d.next_episode_to_air.season_number,
              episode: d.next_episode_to_air.episode_number,
              airDate: d.next_episode_to_air.air_date,
            }
          : undefined,
        reviewScores: await fetchOMDbRatings(d.external_ids?.imdb_id ?? undefined),
      };
    });
  } catch {
    return { seasons: [], externalLinks: [], tags: [] };
  }
}

// Paired with SEASON_CONCURRENCY's own comment — was 8, lowered alongside it.
const SHOW_DETAIL_CONCURRENCY = 5;

export async function paginatedTMDBTV(
  targetCount: number,
  onPage?: (fetched: number) => void,
  onEnrich?: (done: number, total: number) => void
): Promise<CatalogRow[]> {
  const genres = await tmdbGenreMap("tv");
  const rows: CatalogRow[] = [];
  for (let page = 1; page <= TMDB_MAX_PAGE && rows.length < targetCount; page++) {
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=vote_count.desc&page=${page}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`TMDB discover TV (page ${page}) failed: ${res.status}`);
    const data = await res.json();
    const results = data.results as TMDBDiscoverShow[];
    if (!results || results.length === 0) break;
    for (const s of results) {
      if (!s.poster_path) continue;
      rows.push({
        id: `tvShow:${s.id}`,
        type: "tvShow",
        title: s.name,
        overview: s.overview || undefined,
        posterURL: `${IMAGE_BASE}${s.poster_path}`,
        backdropURL: s.backdrop_path ? `${BACKDROP_BASE}${s.backdrop_path}` : undefined,
        releaseDate: s.first_air_date || undefined,
        popularityScore: s.vote_count ?? 0,
        genres: (s.genre_ids ?? []).map((id) => genres.get(id)).filter((n): n is string => !!n),
        originalLanguage: s.original_language,
      });
    }
    onPage?.(rows.length);
  }
  // Dedupe BEFORE enrichment — see the identical comment in paginatedTMDBMovies.
  const capped = [...new Map(rows.map((r) => [r.id, r])).values()].slice(0, targetCount);
  await enrichTVRows(capped, onEnrich);
  return capped;
}

// Per-show enrichment pass — shared by the bulk ingest above and the daily
// recent-releases fetch below, same as enrichMovieRows. Mutates in place.
async function enrichTVRows(rows: CatalogRow[], onEnrich?: (done: number, total: number) => void): Promise<void> {
  let done = 0;
  await mapWithConcurrency(rows, SHOW_DETAIL_CONCURRENCY, async (row) => {
    const tmdbId = Number(row.id.split(":")[1]);
    const extra = await tvExtra(tmdbId, row.title);
    row.metadata = {
      status: extra.status,
      numberOfSeasons: extra.numberOfSeasons,
      numberOfEpisodes: extra.numberOfEpisodes,
      seasons: extra.seasons,
      nextEpisodeToAir: extra.nextEpisodeToAir,
      // Consumed by lib/airtimes.ts to resolve the show on TVmaze exactly,
      // instead of by (fuzzy, collision-prone) name match.
      imdbId: extra.imdbId,
      // Consumed by lib/streamingSchedules.ts's known-platform heuristic.
      networks: extra.networks,
      reviewScores: extra.reviewScores,
    };
    row.externalLinks = extra.externalLinks;
    row.tags = extra.tags;
    done++;
    onEnrich?.(done, rows.length);
  });
}

// ---------- Daily recent-releases refresh (app/api/cron/daily/route.ts) ----------
// The bulk ingest above sorts by all-time vote_count, where a title released
// last week ranks near the very bottom — a full 10k crawl would be needed to
// pick it up. These instead ask TMDB directly for "the biggest things
// released in the last N days" and return full CatalogRow[]s (same
// enrichment as the bulk path), so the daily cron can upsert them straight
// into catalog_items. Re-running daily over the whole window means a fresh
// title's score/poster/metadata self-correct every day for a month.
//
// Quality floors, per-medium scale (see the TV-popularity-scale lesson at
// discoverTMDBUpcomingTV — TMDB's `popularity` runs far lower for TV than
// movies): a month of releases is mostly direct-to-video/regional filler,
// and "released recently" alone doesn't earn a catalog slot. Checked
// client-side (discover can only sort by popularity, not filter on it).
const RECENT_WINDOW_DAYS = 30;
const RECENT_MOVIE_MIN_POPULARITY = 8; // aligned with the upcoming-movie floor the user approved
const RECENT_TV_MIN_POPULARITY = 3;

// How far back a show's PREMIERE can be and still get swept into the
// catalog by the daily premieres slice below (wider than the airing window
// so a niche show that premiered ~6 weeks ago isn't stranded forever).
const PREMIERE_WINDOW_DAYS = 45;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function discoverTMDBRecentMovies(limit = 100): Promise<CatalogRow[]> {
  const genres = await tmdbGenreMap("movie");
  const today = new Date().toISOString().slice(0, 10);
  const since = daysAgoISO(RECENT_WINDOW_DAYS);
  const results = await discoverPages<TMDBDiscoverMovie>(
    (page) =>
      `https://api.themoviedb.org/3/discover/movie?api_key=${key()}&sort_by=popularity.desc&primary_release_date.gte=${since}&primary_release_date.lte=${today}&page=${page}`,
    Math.ceil(limit / 20) + 2 // small margin: floor/poster culls below eat into raw pages
  );
  const rows: CatalogRow[] = [];
  for (const m of results) {
    if (!m.poster_path) continue;
    if ((m.popularity ?? 0) < RECENT_MOVIE_MIN_POPULARITY) continue;
    rows.push({
      id: `movie:${m.id}`,
      type: "movie",
      title: m.title,
      overview: m.overview || undefined,
      posterURL: `${IMAGE_BASE}${m.poster_path}`,
      backdropURL: m.backdrop_path ? `${BACKDROP_BASE}${m.backdrop_path}` : undefined,
      releaseDate: m.release_date || undefined,
      popularityScore: m.vote_count ?? 0,
      genres: (m.genre_ids ?? []).map((id) => genres.get(id)).filter((n): n is string => !!n),
      originalLanguage: m.original_language,
    });
  }
  const capped = [...new Map(rows.map((r) => [r.id, r])).values()].slice(0, limit);
  await enrichMovieRows(capped);
  return capped;
}

// Two merged slices, different jobs:
//  (a) AIRING — air_date (any episode aired in the window), NOT
//      first_air_date: keeps episode data fresh for ongoing/returning shows
//      already worth carrying, top-N by popularity. This is what updates
//      House of the Dragon's next-episode date every week.
//  (b) PREMIERES — first_air_date in the last PREMIERE_WINDOW_DAYS, ALL
//      pages: a brand-new show is by definition absent from the vote_count-
//      sorted bulk catalog AND from upcoming_items (it already premiered),
//      so this slice is its ONLY route into the system. Verified live: "THE
//      GHOST IN THE SHELL" (premiered 2026-07-07, next episode already
//      scheduled) sat outside the old top-30-by-popularity fetch among
//      1,874 shows airing that month, and was therefore findable nowhere in
//      the app. Popularity decides slice (a)'s ranking, but for (b) it's
//      only a junk floor — being NEW is the admission criterion.
// Junk genres (soap/talk/reality/news — see TV_JUNK_GENRES) excluded at the
// API level in both slices; daily programming otherwise owns the "aired
// recently" window outright. tvExtra is one request PER SEASON, so slice
// sizes are the cron's main TV cost — premieres are cheap (a new show has
// one season), the airing slice carries the multi-season heavyweights.
const RECENT_TV_AIRING_LIMIT = 80;
const RECENT_TV_PREMIERE_LIMIT = 150;

export async function discoverTMDBRecentTV(): Promise<CatalogRow[]> {
  const genres = await tmdbGenreMap("tv");
  const today = new Date().toISOString().slice(0, 10);
  const airingSince = daysAgoISO(RECENT_WINDOW_DAYS);
  const premiereSince = daysAgoISO(PREMIERE_WINDOW_DAYS);

  const [airing, premieres] = await Promise.all([
    discoverPages<TMDBDiscoverShow>(
      (page) =>
        `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=popularity.desc&air_date.gte=${airingSince}&air_date.lte=${today}&without_genres=${TV_JUNK_GENRES}&page=${page}`,
      Math.ceil(RECENT_TV_AIRING_LIMIT / 20) + 2
    ),
    discoverPages<TMDBDiscoverShow>(
      (page) =>
        `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=popularity.desc&first_air_date.gte=${premiereSince}&first_air_date.lte=${today}&without_genres=${TV_JUNK_GENRES}&page=${page}`,
      50 // effectively "all pages" — real premiere counts are a few hundred, discoverPages stops at TMDB's actual total
    ),
  ]);

  const toRow = (s: TMDBDiscoverShow): CatalogRow => ({
    id: `tvShow:${s.id}`,
    type: "tvShow",
    title: s.name,
    overview: s.overview || undefined,
    posterURL: `${IMAGE_BASE}${s.poster_path}`,
    backdropURL: s.backdrop_path ? `${BACKDROP_BASE}${s.backdrop_path}` : undefined,
    releaseDate: s.first_air_date || undefined,
    popularityScore: s.vote_count ?? 0,
    genres: (s.genre_ids ?? []).map((id) => genres.get(id)).filter((n): n is string => !!n),
    originalLanguage: s.original_language,
  });

  const qualifies = (s: TMDBDiscoverShow) =>
    !!s.poster_path && (s.popularity ?? 0) >= RECENT_TV_MIN_POPULARITY;

  const rows = new Map<string, CatalogRow>();
  for (const s of airing.filter(qualifies).slice(0, RECENT_TV_AIRING_LIMIT)) {
    rows.set(`tvShow:${s.id}`, toRow(s));
  }
  for (const s of premieres.filter(qualifies).slice(0, RECENT_TV_PREMIERE_LIMIT)) {
    if (!rows.has(`tvShow:${s.id}`)) rows.set(`tvShow:${s.id}`, toRow(s));
  }

  const all = [...rows.values()];
  await enrichTVRows(all);
  return all;
}

// ---------- Backdrop backfill (scripts/backfill-backdrops.ts only) ----------
// The bulk ingest now captures backdrop_path as it goes, but everything
// ingested BEFORE that change has backdrop_url = NULL. Re-running the full
// ingest would refetch per-item enrichment (10k+ detail requests per type);
// this instead re-walks just the LIST pages (backdrop_path is on every
// discover response already — zero per-item requests) and returns id ->
// backdrop URL for the script to bulk-UPDATE.
export async function listTMDBBackdrops(kind: "movie" | "tv"): Promise<Map<string, string>> {
  const idPrefix = kind === "movie" ? "movie" : "tvShow";
  const results = await discoverPages<{ id: number; backdrop_path?: string | null }>(
    (page) => `https://api.themoviedb.org/3/discover/${kind}?api_key=${key()}&sort_by=vote_count.desc&page=${page}`,
    TMDB_MAX_PAGE
  );
  const map = new Map<string, string>();
  for (const r of results) {
    if (r.backdrop_path) map.set(`${idPrefix}:${r.id}`, `${BACKDROP_BASE}${r.backdrop_path}`);
  }
  return map;
}

// ---------- Franchise movie parts (TMDB "collections") ----------
// TMDB's Collection API is a curated, authoritative list of a franchise's
// films — internal-only now, consumed by lib/sources/franchise.ts for the
// movie side of a curated cross-media franchise (see lib/franchises.ts's
// `movieCollectionId`, resolved once live during authoring, not guessed).
// More accurate than a plain title-text search for movies whose titles
// don't contain the franchise name (e.g. "Solo: A Star Wars Story"). Note:
// TMDB does NOT have one unified "Marvel Cinematic Universe" collection —
// verified live, MCU is split across dozens of sub-collections — so
// franchises like that fall back to plain per-title text search instead.

interface TMDBCollectionPart {
  id: number;
  title: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  // Verified live against a real response (One Piece Collection, id 23456):
  // collection parts carry the same popularity/vote_count fields a normal
  // movie search result does.
  popularity?: number;
  vote_count?: number;
}

// All of a collection's films, mapped as RankedItems (same shape
// searchTMDBMovie produces) — so a franchise part behaves identically to any
// other movie (clickable, followable via the existing DetailModal, and
// carries a real `popularity` value for the franchise's "Most Popular" row)
// regardless of which path found it. No quality-bar filtering here — the
// whole point of using the collection is that it's already a complete,
// authoritative list, including older/obscure entries a popularity bar
// would otherwise cut.
export async function tmdbCollectionParts(id: number): Promise<RankedItem[]> {
  const url = `https://api.themoviedb.org/3/collection/${id}?api_key=${key()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB collection details failed: ${res.status}`);
  const data = await res.json();
  const parts = (data.parts ?? []) as TMDBCollectionPart[];
  return parts.map((p) => ({
    id: `movie:${p.id}`,
    type: "movie" as const,
    title: p.title,
    overview: p.overview || undefined,
    posterURL: p.poster_path ? `${IMAGE_BASE}${p.poster_path}` : undefined,
    releaseDate: p.release_date || undefined,
    significant: isSignificant(p.vote_count ?? 0, p.popularity ?? 0, p.release_date),
    // vote_count, not TMDB's trending `popularity` field — see the
    // identical comment in searchTMDBMovie.
    popularity: p.vote_count ?? 0,
  }));
}

// ---------- Shared: watch providers ----------

// TMDB has zero watch-provider data for some titles (verified live: "THE
// GHOST IN THE SHELL," a brand-new show, has an entirely empty
// `watch/providers.results` object — not just missing for the US region).
// Everything should link to SOMEWHERE (the same principle MangaDex already
// follows — see detailsMangaDex's own page fallback in
// lib/sources/mangadex.ts) rather than showing an empty "Available on"
// section with nothing to click.
function tmdbPageFallback(kind: "movie" | "tv", id: string): ExternalLink[] {
  return [
    {
      provider: "TMDB",
      url: `https://www.themoviedb.org/${kind}/${id}`,
      kind: "info",
    },
  ];
}
