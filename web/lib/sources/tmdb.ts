import type { EpisodeInfo, ExternalLink, LinkKind, MediaItem } from "@/lib/types";
import type { CatalogRow } from "@/lib/catalog";
import { isExactMatch, RankedItem } from "./textMatch";
import { mapWithConcurrency, withRetries } from "./concurrency";

// TMDB adapter (TS port). Maps TMDB's JSON into our MediaItem.
// Runs server-side only (in an API route), so TMDB_API_KEY stays secret.
// Covers both movies (search/movie) and TV shows (search/tv) — TV is what
// makes "new episode this Friday" possible via next_episode_to_air.

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

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
  release_date?: string;
  popularity?: number;
  vote_count?: number;
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
  const res = await fetch(url);
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
    releaseDate: m.release_date || undefined,
  };
}

export async function detailsTMDBMovie(id: string): Promise<MediaItem> {
  const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${key()}&append_to_response=watch/providers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB movie details failed: ${res.status}`);
  const d = await res.json();
  const base = mapMovie(d as TMDBMovie);
  base.externalLinks =
    watchLinks(d["watch/providers"]?.results?.US) ?? tmdbPageFallback("movie", id);
  return base;
}

// Popular movies (for the Discover page's "Trending movies" shelf).
export async function discoverTMDBMovies(limit = 20): Promise<MediaItem[]> {
  const url = `https://api.themoviedb.org/3/discover/movie?api_key=${key()}&sort_by=popularity.desc&vote_count.gte=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB discover movies failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBMovie[]).slice(0, limit).map(mapMovie);
}

// Popular, not-yet-released movies (for "Popular upcoming").
export async function discoverTMDBUpcomingMovies(limit = 12): Promise<MediaItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://api.themoviedb.org/3/discover/movie?api_key=${key()}&sort_by=popularity.desc&primary_release_date.gte=${today}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB discover upcoming movies failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBMovie[])
    .filter((m) => m.poster_path)
    .slice(0, limit)
    .map(mapMovie);
}

// ---------- TV shows ----------

interface TMDBShow {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  first_air_date?: string;
  status?: string; // "Returning Series", "Ended", "Canceled", ...
  popularity?: number;
  vote_count?: number;
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
  const res = await fetch(url);
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
  const results = await Promise.allSettled(
    seasons.map((s) =>
      fetch(
        `https://api.themoviedb.org/3/tv/${id}/season/${s.season_number}?api_key=${key()}`
      ).then((r) => (r.ok ? r.json() : null))
    )
  );

  const episodes: EpisodeInfo[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value) return;
    const season = r.value as TMDBSeason;
    for (const ep of season.episodes ?? []) {
      episodes.push({
        season: seasons[i].season_number,
        episode: ep.episode_number,
        title: ep.name,
        airDate: ep.air_date,
      });
    }
  });
  return episodes;
}

export async function detailsTMDBTV(id: string): Promise<MediaItem> {
  const url = `https://api.themoviedb.org/3/tv/${id}?api_key=${key()}&append_to_response=watch/providers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB TV details failed: ${res.status}`);
  const d = await res.json();
  const base = mapShow(d as TMDBShow);
  base.externalLinks = watchLinks(d["watch/providers"]?.results?.US) ?? tmdbPageFallback("tv", id);
  base.episodeCount = d.number_of_episodes;
  base.episodes = await allEpisodes(id, d.seasons);
  return base;
}

// Popular TV shows (for the Discover page's "Trending TV" shelf).
export async function discoverTMDBTV(limit = 20): Promise<MediaItem[]> {
  const url = `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=popularity.desc&vote_count.gte=100`;
  const res = await fetch(url);
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

// Popular, soon-to-premiere shows (for "Popular upcoming").
export async function discoverTMDBUpcomingTV(limit = 12): Promise<MediaItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=popularity.desc&first_air_date.gte=${today}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB discover upcoming TV failed: ${res.status}`);
  const data = await res.json();
  return (data.results as TMDBShow[])
    .filter((s) => s.poster_path)
    .slice(0, limit)
    .map((s) => ({
      id: `tvShow:${s.id}`,
      type: "tvShow" as const,
      title: s.name,
      overview: s.overview || undefined,
      posterURL: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : undefined,
      releaseDate: s.first_air_date,
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
  const res = await fetch(url);
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
const PROVIDER_SEARCH_RULES: { pattern: string; provider: string; searchURL: (title: string) => string }[] = [
  { pattern: "paramount", provider: "Paramount+", searchURL: (t) => `https://www.paramountplus.com/search/?query=${encodeURIComponent(t)}` },
  { pattern: "disney", provider: "Disney+", searchURL: (t) => `https://www.disneyplus.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "peacock", provider: "Peacock", searchURL: (t) => `https://www.peacocktv.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "netflix", provider: "Netflix", searchURL: (t) => `https://www.netflix.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "hulu", provider: "Hulu", searchURL: (t) => `https://www.hulu.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "apple", provider: "Apple TV", searchURL: (t) => `https://tv.apple.com/search?term=${encodeURIComponent(t)}` },
  { pattern: "max", provider: "Max", searchURL: (t) => `https://play.max.com/search?q=${encodeURIComponent(t)}` },
  { pattern: "google play", provider: "Google Play Movies", searchURL: (t) => `https://play.google.com/store/search?q=${encodeURIComponent(t)}&c=movies` },
  { pattern: "youtube", provider: "YouTube", searchURL: (t) => `https://www.youtube.com/results?search_query=${encodeURIComponent(t)}` },
  { pattern: "amazon", provider: "Amazon Video", searchURL: (t) => `https://www.amazon.com/s?k=${encodeURIComponent(t)}&i=instant-video` },
];

function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(name);
}

interface TMDBProviderEntry {
  provider_name: string;
}

function providerSearchLinks(
  country: { flatrate?: TMDBProviderEntry[]; rent?: TMDBProviderEntry[]; buy?: TMDBProviderEntry[] } | undefined,
  title: string
): ExternalLink[] {
  if (!country) return [];
  const seen = new Set<string>();
  const links: ExternalLink[] = [];
  const scan = (list: TMDBProviderEntry[] | undefined, kind: LinkKind) => {
    for (const p of list ?? []) {
      const rule = PROVIDER_SEARCH_RULES.find((r) => matchesPattern(p.provider_name, r.pattern));
      if (!rule || seen.has(rule.provider)) continue;
      seen.add(rule.provider);
      links.push({ provider: rule.provider, url: rule.searchURL(title), kind });
    }
  };
  scan(country.flatrate, "stream");
  scan(country.rent, "rent");
  scan(country.buy, "buy");
  return links;
}

// Per-movie enrichment: runtime + provider search links — neither is in the
// discover response, needs one extra request per movie.
async function movieExtra(id: number, title: string): Promise<{ runtimeMinutes?: number; externalLinks: ExternalLink[] }> {
  try {
    return await withRetries(async () => {
      const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${key()}&append_to_response=watch/providers`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TMDB movie details (${id}) failed: ${res.status}`);
      const d = await res.json();
      return {
        runtimeMinutes: typeof d.runtime === "number" ? d.runtime : undefined,
        externalLinks: providerSearchLinks(d["watch/providers"]?.results?.US, title),
      };
    });
  } catch {
    return { externalLinks: [] };
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
    const res = await fetch(url);
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
        releaseDate: m.release_date || undefined,
        popularityScore: m.vote_count ?? 0,
        genres: (m.genre_ids ?? []).map((id) => genres.get(id)).filter((n): n is string => !!n),
      });
    }
    onPage?.(rows.length);
  }
  // Dedupe BEFORE enrichment — TMDB's discover pagination isn't perfectly
  // stable when many entries tie on vote_count, so the same id can land on
  // two different pages; enriching it twice would waste a detail request.
  const capped = [...new Map(rows.map((r) => [r.id, r])).values()].slice(0, targetCount);

  let done = 0;
  await mapWithConcurrency(capped, MOVIE_DETAIL_CONCURRENCY, async (row) => {
    const tmdbId = Number(row.id.split(":")[1]);
    const extra = await movieExtra(tmdbId, row.title);
    row.metadata = { runtimeMinutes: extra.runtimeMinutes };
    row.externalLinks = extra.externalLinks;
    done++;
    onEnrich?.(done, capped.length);
  });
  return capped;
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

// Per-show enrichment: status + full per-season/per-episode breakdown +
// provider search links. One request for the show itself, plus one more PER
// SEASON — far more expensive than the movie case, since a show's episode
// data isn't on the show-level response at all.
const SEASON_CONCURRENCY = 5;

async function tvExtra(
  id: number,
  title: string
): Promise<{ status?: string; numberOfSeasons?: number; numberOfEpisodes?: number; seasons: CatalogSeason[]; externalLinks: ExternalLink[] }> {
  try {
    return await withRetries(async () => {
      const url = `https://api.themoviedb.org/3/tv/${id}?api_key=${key()}&append_to_response=watch/providers`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TMDB show details (${id}) failed: ${res.status}`);
      const d = (await res.json()) as TMDBShowDetails & { "watch/providers"?: { results?: Record<string, unknown> } };

      const seasonSummaries = d.seasons ?? [];
      const seasons = await mapWithConcurrency(seasonSummaries, SEASON_CONCURRENCY, async (s) => {
        try {
          const seasonRes = await fetch(
            `https://api.themoviedb.org/3/tv/${id}/season/${s.season_number}?api_key=${key()}`
          );
          if (!seasonRes.ok) return { seasonNumber: s.season_number, name: s.name, episodes: [] };
          const seasonData = await seasonRes.json();
          const episodes = (seasonData.episodes as TMDBSeasonEpisode[] | undefined ?? []).map((e) => ({
            episode: e.episode_number,
            title: e.name || undefined,
            airDate: e.air_date || undefined,
            runtimeMinutes: e.runtime ?? undefined,
          }));
          return { seasonNumber: s.season_number, name: s.name, episodes };
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
      };
    });
  } catch {
    return { seasons: [], externalLinks: [] };
  }
}

const SHOW_DETAIL_CONCURRENCY = 8;

export async function paginatedTMDBTV(
  targetCount: number,
  onPage?: (fetched: number) => void,
  onEnrich?: (done: number, total: number) => void
): Promise<CatalogRow[]> {
  const genres = await tmdbGenreMap("tv");
  const rows: CatalogRow[] = [];
  for (let page = 1; page <= TMDB_MAX_PAGE && rows.length < targetCount; page++) {
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${key()}&sort_by=vote_count.desc&page=${page}`;
    const res = await fetch(url);
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
        releaseDate: s.first_air_date || undefined,
        popularityScore: s.vote_count ?? 0,
        genres: (s.genre_ids ?? []).map((id) => genres.get(id)).filter((n): n is string => !!n),
      });
    }
    onPage?.(rows.length);
  }
  // Dedupe BEFORE enrichment — see the identical comment in paginatedTMDBMovies.
  const capped = [...new Map(rows.map((r) => [r.id, r])).values()].slice(0, targetCount);

  let done = 0;
  await mapWithConcurrency(capped, SHOW_DETAIL_CONCURRENCY, async (row) => {
    const tmdbId = Number(row.id.split(":")[1]);
    const extra = await tvExtra(tmdbId, row.title);
    row.metadata = {
      status: extra.status,
      numberOfSeasons: extra.numberOfSeasons,
      numberOfEpisodes: extra.numberOfEpisodes,
      seasons: extra.seasons,
    };
    row.externalLinks = extra.externalLinks;
    done++;
    onEnrich?.(done, capped.length);
  });
  return capped;
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
  const res = await fetch(url);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function watchLinks(country: any): ExternalLink[] | undefined {
  if (!country?.link) return undefined;
  const links: ExternalLink[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const add = (list: any[] | undefined, kind: LinkKind) => {
    for (const p of list ?? []) {
      links.push({
        provider: p.provider_name,
        logoURL: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : undefined,
        url: country.link,
        kind,
      });
    }
  };
  add(country.flatrate, "stream");
  add(country.rent, "rent");
  add(country.buy, "buy");
  return links.length ? links : undefined;
}

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
