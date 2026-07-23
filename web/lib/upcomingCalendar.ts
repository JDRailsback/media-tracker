import type { ExternalLink, MediaItem, MediaType } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { excludeHiddenSQL, type ContentCategory } from "@/lib/contentFilters";
import { nextSeasonPremiere, type CatalogDBRow } from "@/lib/catalog";
import { fetchTraktAnticipatedMovieIds, fetchTraktAnticipatedShowIds } from "@/lib/trakt";
import { DEFAULT_INTL_BAR_LEVEL, type IntlBarLevel } from "@/lib/intlBar";
import { DEFAULT_GENERAL_BAR_LEVEL, type GeneralBarLevel } from "@/lib/generalBar";
import { COLLECTIONS } from "@/lib/collections";
import { deriveUpcomingKeywords } from "@/lib/collections-rebuild";

// "Popular upcoming"'s full release calendar (see lib/db.ts's ensureSchema
// for the table) — a single flat, pre-merged table of every confirmed-date
// upcoming release worth showing, rebuilt wholesale once daily by
// refreshUpcomingCalendar (called from /api/cron/daily). Every live read
// (getUpcomingCalendarTop/getUpcomingCalendarPage below) is a single
// indexed query against this table — nothing computes across
// upcoming_items/catalog_items live on a user request anymore.

interface CalendarWriteRow {
  id: string;
  type: "movie" | "tvShow" | "game";
  title: string;
  subtitle?: string;
  posterURL?: string;
  backdropURL?: string;
  releaseDate: string;
  externalLinks?: ExternalLink[];
  genres?: string[];
  originalLanguage?: string;
  // "How big is this" — Trakt list_count for movies/brand-new TV, catalog
  // vote_count for returning-show premieres, IGDB hypes for games. Only
  // used to rank the shelf's highlight slice, never to admit/exclude a row
  // (admission already happened by the time this is set) — see
  // lib/db.ts's ensureSchema for the full rationale.
  rankScore: number;
  // Admitted purely for belonging to a major, hand-curated franchise (see
  // fetchFranchisePicks) — exempt from the international/general bars
  // below, same as games and returning-TV premieres, since the whole point
  // is "regardless of popularity."
  franchisePick?: boolean;
}

interface CalendarDBRow {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  release_date: string | Date;
  external_links: unknown;
  rank_score: number;
  franchise_pick: boolean;
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toISODate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function calendarRowToMediaItem(row: CalendarDBRow): MediaItem {
  return {
    id: row.id,
    type: row.type as MediaType,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    posterURL: row.poster_url ?? undefined,
    backdropURL: row.backdrop_url ?? undefined,
    releaseDate: toISODate(row.release_date),
    externalLinks: parseJSON<ExternalLink[]>(row.external_links, []),
  };
}

// ---------- Refresh (called once daily by /api/cron/daily) ----------

// Games keep a real popularity floor — IGDB's `hypes` counter is a signal
// that actually works for telling AAA/major games apart from indie/slop
// (verified live: 70+ keeps ~26 recognizable titles like Grand Theft Auto
// VI, Fable, Silent Hill: Townfall, no indie filler).
const GAME_POPULARITY_FLOOR = 70;

interface SourceUpcomingRow {
  id: string;
  type: string;
  title: string;
  poster_url: string | null;
  backdrop_url: string | null;
  release_date: string | Date;
  external_links: unknown;
  genres: unknown;
  original_language: string | null;
  popularity_score: number;
}

// TMDB id is the numeric suffix of our own "movie:603"/"tvShow:1399" id
// format.
function tmdbIdOf(id: string): number {
  return Number(id.slice(id.indexOf(":") + 1));
}

function toWriteRow(row: SourceUpcomingRow, rankScore: number): CalendarWriteRow {
  return {
    id: row.id,
    type: row.type as CalendarWriteRow["type"],
    title: row.title,
    posterURL: row.poster_url ?? undefined,
    backdropURL: row.backdrop_url ?? undefined,
    releaseDate: toISODate(row.release_date),
    externalLinks: parseJSON<ExternalLink[]>(row.external_links, []),
    genres: parseJSON<string[]>(row.genres, []),
    originalLanguage: row.original_language ?? undefined,
    rankScore,
  };
}

// Every confirmed-date upcoming_items row, per type — fetched ONCE and
// shared by both admission paths below (Trakt/IGDB in
// fetchTraktAndHypeAdmitted, franchise membership in fetchFranchisePicks),
// so a franchise-pick check never costs a second round trip over the same
// table. No popularity floor at the SQL level for movies/TV (that
// filtering happens per-path, in JS, against whichever signal that path
// actually uses) — games DO get their AAA floor applied here since NO
// other path needs to see sub-floor games (franchise picks are the one
// exception, and they get their own separate low-floor-free game fetch).
// The release_date >= today filter on every branch here is a defensive
// check, not an optimization — verified live, upcoming_items itself can lag
// behind on pruning a title the day it releases (found 32 stale rows sitting
// in upcoming_items with a past release_date, including one that had ALSO
// already separately graduated into catalog_items). Without this,
// fetchRawUpcomingRows blindly trusts that upstream table to only ever hold
// future titles, and a stale row gets re-admitted into upcoming_calendar on
// every refresh even after graduateReleasedTitles already moved it into
// new_releases_calendar — the exact "same title in both calendars at once"
// bug this file already fixed once for a DIFFERENT cause (the inclusive
// same-day TMDB/IGDB query). `>=` (not `>`) matches graduation's own
// boundary: a title stays admissible here through its release day, then
// graduates starting the day after (graduateReleasedTitles uses `<`).
async function fetchRawUpcomingRows(): Promise<{
  movies: SourceUpcomingRow[];
  tv: SourceUpcomingRow[];
  games: SourceUpcomingRow[];
  allGames: SourceUpcomingRow[];
}> {
  await ensureSchema();
  const sql = db();
  const [movies, tv, games, allGames] = await Promise.all([
    sql`
      SELECT id, type, title, poster_url, backdrop_url, release_date, external_links, genres, original_language, popularity_score
      FROM upcoming_items WHERE type = 'movie' AND date_confirmed = true AND release_date >= now()::date
    ` as unknown as Promise<SourceUpcomingRow[]>,
    sql`
      SELECT id, type, title, poster_url, backdrop_url, release_date, external_links, genres, original_language, popularity_score
      FROM upcoming_items WHERE type = 'tvShow' AND date_confirmed = true AND release_date >= now()::date
    ` as unknown as Promise<SourceUpcomingRow[]>,
    sql`
      SELECT id, type, title, poster_url, backdrop_url, release_date, external_links, genres, original_language, popularity_score
      FROM upcoming_items WHERE type = 'game' AND date_confirmed = true AND release_date >= now()::date AND popularity_score >= ${GAME_POPULARITY_FLOOR}
    ` as unknown as Promise<SourceUpcomingRow[]>,
    sql`
      SELECT id, type, title, poster_url, backdrop_url, release_date, external_links, genres, original_language, popularity_score
      FROM upcoming_items WHERE type = 'game' AND date_confirmed = true AND release_date >= now()::date
    ` as unknown as Promise<SourceUpcomingRow[]>,
  ]);
  return { movies, tv, games, allGames };
}

// Movies and brand-new TV are admitted ONLY if Trakt's anticipated lists
// (see lib/trakt.ts) say there's real anticipation for them — TMDB's own
// `popularity`/`vote_count` fields proved completely uninformative for
// unreleased titles (verified live: The Hunger Games: Sunrise on the
// Reaping and a totally unknown short film scored the same 1-2 on
// popularity; vote_count was 0 for both). Trakt's lists are the actual
// admission gate here, not a threshold layered on top of a local floor — a
// title either has real anticipation behind it or it doesn't. Games keep
// IGDB's own hypes floor since that signal already works. Trakt's
// list_count (movies/TV) and IGDB's hypes (games) both carry through as
// rankScore — see lib/db.ts's ensureSchema for why. Returning shows'
// season premieres are handled entirely separately below (Trakt doesn't
// track those at all — see fetchReturningTVPremieres); franchise picks are
// ALSO separate (see fetchFranchisePicks) — this function is only the
// "real anticipation/hype" admission path.
async function fetchTraktAndHypeAdmitted(rows: {
  movies: SourceUpcomingRow[];
  tv: SourceUpcomingRow[];
  games: SourceUpcomingRow[];
}): Promise<CalendarWriteRow[]> {
  const [traktMovies, traktShows] = await Promise.all([fetchTraktAnticipatedMovieIds(), fetchTraktAnticipatedShowIds()]);

  const movies = rows.movies
    .map((row) => ({ row, score: traktMovies.get(tmdbIdOf(row.id)) }))
    .filter((x): x is { row: SourceUpcomingRow; score: number } => x.score !== undefined)
    .map(({ row, score }) => toWriteRow(row, score));
  const tv = rows.tv
    .map((row) => ({ row, score: traktShows.get(tmdbIdOf(row.id)) }))
    .filter((x): x is { row: SourceUpcomingRow; score: number } => x.score !== undefined)
    .map(({ row, score }) => toWriteRow(row, score));
  const games = rows.games.map((row) => toWriteRow(row, row.popularity_score));

  return [...movies, ...tv, ...games];
}

// Titles admitted purely for belonging to a MAJOR, hand-curated franchise —
// regardless of Trakt anticipation or IGDB hype. Explicit request: a
// franchise's existing fanbase cares about every new entry even when it
// doesn't independently clear a popularity bar (verified live: One Piece's
// "Grand Gourmet" game, IGDB hype 5 — nowhere near the 70 AAA floor — is a
// real release fans want to know about specifically because it's One
// Piece). Scoped to `featured: true` collections only (Star Wars, Marvel,
// DC, Harry Potter, LOTR, Nickelodeon, One Piece, Pokémon, Zelda, Final
// Fantasy, Ghibli, Disney, Pixar, Halo at the time this was built) — the
// ones the user actually meant by "major franchises," not every genre
// grouping (heist, time-travel, ...) that also happens to be a curated
// collection. Reuses the SAME curated+derived keyword logic as the "Up
// next" franchise card (lib/collections-rebuild.ts's deriveUpcomingKeywords)
// so both features agree on what counts as "this franchise's title" — a
// simple case-insensitive substring match against the keyword set, since
// this only ever runs against a franchise's own small keyword list, not a
// huge corpus (the false-positive risk that ruled out a broad contains
// match elsewhere doesn't apply the same way here — a wrong pick would
// still have to contain a distinctive franchise name).
function fetchFranchisePicks(rows: {
  movies: SourceUpcomingRow[];
  tv: SourceUpcomingRow[];
  allGames: SourceUpcomingRow[];
}): CalendarWriteRow[] {
  const keywordsByType: Record<"movie" | "tvShow" | "game", string[]> = { movie: [], tvShow: [], game: [] };
  for (const def of COLLECTIONS) {
    if (!def.featured) continue;
    for (const type of ["movie", "tvShow", "game"] as const) {
      const curated = def.curated?.[type] ?? [];
      if (curated.length === 0) continue;
      for (const k of [...curated, ...deriveUpcomingKeywords(curated)]) keywordsByType[type].push(k);
    }
  }

  // A keyword must appear as a whole word/phrase — not embedded inside a
  // longer word — or a short, common curated title turns into a landmine
  // against the full raw upcoming universe. Fixing this took two rounds:
  // requiring a boundary on both sides of the keyword stopped it matching
  // MID-word ("Tele Fantasia" no longer matches inside "Wishlist" etc.), but
  // a keyword that's a single common word ("Soul", "Up", "Wish", "Pinocchio")
  // still matches as its OWN standalone word inside a totally unrelated
  // title — verified live: with boundary-only matching, "Fantasia" still hit
  // "Tele Fantasia" itself (a genuine standalone word there), and "Wish"/
  // "Up"/"Soul" hit "I Wish This Was Real", "Give It Up", "I Rarely Wake Up
  // Dreaming", "A Penny Weighs More Than a Soul" — none of which are Disney/
  // Pixar. A multi-word keyword ("Star Wars", "One Piece", "Final Fantasy")
  // is distinctive enough that anywhere-in-title stays safe (two specific
  // words landing next to each other by coincidence is rare, and this is
  // what's needed to catch a franchise name sitting mid-title, e.g. "LEGO
  // ONE PIECE"). But a single-word keyword needs to anchor to the START of
  // the title — allowing a leading "The"/"A"/"An" through (real titles like
  // "The Batman: Part II" start with an article before the character name;
  // "Tele Fantasia" or "The Boy Who Collects Spider-Man" don't have a
  // franchise keyword there at all). This still catches real sequels
  // ("Moana 3", "Frozen II", "The Batman: Part II") while rejecting a
  // keyword that only shows up elsewhere in an unrelated title.
  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function stripLeadingArticle(title: string): string {
    return title.replace(/^(the|a|an)\s+/i, "");
  }
  function matchesKeyword(title: string, keyword: string): boolean {
    if (keyword.includes(" ")) {
      return new RegExp(`(?:^|[^a-zA-Z0-9])${escapeRegExp(keyword)}(?:[^a-zA-Z0-9]|$)`, "i").test(title);
    }
    return new RegExp(`^${escapeRegExp(keyword)}(?:[^a-zA-Z0-9]|$)`, "i").test(stripLeadingArticle(title));
  }
  // A small denylist of curated titles proven live to be too generic/
  // public-domain a name to safely gate admission on even with start-
  // anchoring — "Pinocchio" and "Fantasia" both start unrelated real titles
  // often enough ("Pinocchio: Unstrung", "Tele Fantasia") that anchoring
  // alone doesn't help; "Brave" hit two unrelated titles in one run
  // ("Brave New Love", "Brave Heart Yakari"); "Soul" likewise admitted the
  // unrelated "Soul Trader". Scoped to franchise-pick ADMISSION only — these
  // stay untouched in lib/collections.ts's curated lists, which resolve
  // against the known catalog (a lower-risk, already-vetted context, not the
  // raw upcoming universe).
  const FRANCHISE_PICK_KEYWORD_DENYLIST = new Set(["pinocchio", "fantasia", "brave", "soul"]);
  function matches(title: string, keywords: string[]): boolean {
    return keywords.some(
      (k) => !FRANCHISE_PICK_KEYWORD_DENYLIST.has(k.toLowerCase()) && matchesKeyword(title, k)
    );
  }

  const picks: CalendarWriteRow[] = [];
  const sources: [SourceUpcomingRow[], "movie" | "tvShow" | "game"][] = [
    [rows.movies, "movie"],
    [rows.tv, "tvShow"],
    [rows.allGames, "game"],
  ];
  for (const [sourceRows, type] of sources) {
    const keywords = keywordsByType[type];
    if (keywords.length === 0) continue;
    for (const row of sourceRows) {
      if (matches(row.title, keywords)) picks.push({ ...toWriteRow(row, row.popularity_score), franchisePick: true });
    }
  }
  return picks;
}

// Season premieres of shows the catalog already knows about (as opposed to
// upcoming_items' brand-new/never-aired titles) — explicit request: without
// this, a hugely popular returning show (House of the Dragon, Ted Lasso,
// Adults) had no way to ever appear here at all. Scans catalog_items'
// WHOLE tvShow set (10,000+ rows) in batches — the response-size limit on
// a single unbatched SELECT * proved real (verified live) — since this now
// runs once a day in the cron, not on a live request, the cost is
// acceptable where it would NOT have been for a per-request read. Batches
// are fetched IN PARALLEL (not a sequential offset loop): this cron already
// runs close to Vercel's 60s function limit on its existing TMDB/IGDB
// stages (see tmdb.ts's OFFICIAL_STATUS_CONCURRENCY comment — 57.8s
// measured live), so a ~10-batch sequential scan added on top was a real
// risk to that budget; firing every batch's request at once instead costs
// roughly one round trip's worth of wall-clock time, not ten. No
// popularity floor here either: a show doesn't get a season-2+ pickup with
// a confirmed premiere date without real viewership, so "has one" is
// already the meaningful signal (verified live: Adults' Season 2 premiere
// at vote_count 59 was a real, legitimate result a floor had wrongly cut).
const CATALOG_TV_SCAN_BATCH_SIZE = 1000;

async function fetchReturningTVPremieres(): Promise<CalendarWriteRow[]> {
  await ensureSchema();
  const sql = db();
  const [{ n: total }] = (await sql`SELECT count(*)::int AS n FROM catalog_items WHERE type = 'tvShow'`) as unknown as {
    n: number;
  }[];

  const batchCount = Math.ceil(total / CATALOG_TV_SCAN_BATCH_SIZE);
  const batches = await Promise.all(
    Array.from({ length: batchCount }, (_, i) =>
      sql`
        SELECT id, type, title, overview, poster_url, backdrop_url, release_date, popularity_score, genres, external_links, metadata, original_language
        FROM catalog_items WHERE type = 'tvShow'
        ORDER BY id
        OFFSET ${i * CATALOG_TV_SCAN_BATCH_SIZE} LIMIT ${CATALOG_TV_SCAN_BATCH_SIZE}
      ` as unknown as Promise<CatalogDBRow[]>
    )
  );

  const rows: CalendarWriteRow[] = [];
  for (const row of batches.flat()) {
    const premiere = nextSeasonPremiere(row);
    if (!premiere) continue;
    rows.push({
      id: row.id,
      type: "tvShow",
      title: row.title,
      subtitle: `Season ${premiere.season}`,
      posterURL: row.poster_url ?? undefined,
      backdropURL: row.backdrop_url ?? undefined,
      releaseDate: premiere.releaseDate,
      externalLinks: parseJSON<ExternalLink[]>(row.external_links, []),
      genres: parseJSON<string[]>(row.genres, []),
      originalLanguage: row.original_language ?? undefined,
      rankScore: row.popularity_score,
    });
  }
  return rows;
}

const UPSERT_BATCH_SIZE = 200;

// The other half of a title's release lifecycle — see lib/db.ts's
// ensureSchema for why "New releases" is just upcoming_calendar's graduates
// rather than its own independently-admitted list. A straight SQL
// INSERT...SELECT (not a fetch-into-JS-then-reinsert round trip): every
// column new_releases_calendar needs already exists on the source row, so
// there's nothing to transform. Must run BEFORE fetchUpcomingSourceRows'
// fresh admission set is computed below — that fresh set is drawn from
// upcoming_items, which the cron's earlier stages have already pruned of
// anything that released today, so this is the ONLY point where a
// just-released title's row (and its already-earned rank_score) is still
// visible in upcoming_calendar to carry over.
//
// Strictly BEFORE today, not <=: TMDB/IGDB's own "upcoming" queries treat a
// title releasing today as still-upcoming (inclusive `.gte=today` filters —
// a pre-existing convention this file doesn't own), so a title's LAST day in
// upcoming_calendar is its release day, and it graduates starting the NEXT
// day's refresh. Using <= here would overlap with that for exactly one day
// — verified live: a same-day release appeared in both calendars at once
// before this was tightened to <.
async function graduateReleasedTitles(): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`
    INSERT INTO new_releases_calendar (id, type, title, subtitle, poster_url, backdrop_url, release_date, external_links, genres, original_language, rank_score, franchise_pick)
    SELECT id, type, title, subtitle, poster_url, backdrop_url, release_date, external_links, genres, original_language, rank_score, franchise_pick
    FROM upcoming_calendar WHERE release_date < now()::date
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      subtitle = excluded.subtitle,
      poster_url = excluded.poster_url,
      backdrop_url = COALESCE(excluded.backdrop_url, new_releases_calendar.backdrop_url),
      release_date = excluded.release_date,
      external_links = excluded.external_links,
      genres = excluded.genres,
      original_language = excluded.original_language,
      rank_score = excluded.rank_score,
      franchise_pick = excluded.franchise_pick,
      updated_at = now()
  `;
}

// "New releases" is a rolling window, not a permanent archive — anything
// that graduated more than this many days ago ages back out entirely
// (matches the window the old catalog-based "New releases" used to use).
const NEW_RELEASES_WINDOW_DAYS = 30;

async function pruneOldReleases(): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM new_releases_calendar WHERE release_date < now()::date - ${NEW_RELEASES_WINDOW_DAYS}::int`;
}

// Full wholesale rebuild — called once daily by /api/cron/daily, LAST
// (after upcoming_items/catalog_items have themselves been refreshed that
// same run, same "don't race ahead of your own inputs" reasoning as
// lib/discoverSnapshot.ts). Upsert-then-prune, same pattern as
// trending_items: this run's rows always win, anything not refreshed this
// run (released, cancelled, no longer has a future premiere) is deleted.
export async function refreshUpcomingCalendar(): Promise<{ count: number }> {
  await ensureSchema();
  const sql = db();

  // Graduate anything that released before this run's fresh admission set
  // (below) is computed and overwrites it.
  await graduateReleasedTitles();
  await pruneOldReleases();

  const [rawRows, returningTV] = await Promise.all([fetchRawUpcomingRows(), fetchReturningTVPremieres()]);
  const admittedRows = await fetchTraktAndHypeAdmitted(rawRows);
  const franchisePicks = fetchFranchisePicks(rawRows);

  // Merge in priority order: Trakt/hype-admitted first (a real earned
  // rankScore), then returning-show premieres, then franchise picks last —
  // a title that already qualified on its own merits keeps that path's
  // rankScore rather than being silently downgraded to a franchise-pick
  // exemption it doesn't need.
  const seen = new Set<string>();
  const merged: CalendarWriteRow[] = [];
  for (const row of [...admittedRows, ...returningTV, ...franchisePicks]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }

  // A final, centralized "must still be in the future" guard across EVERY
  // admission path at once, rather than trusting each path to police its own
  // dates — verified live this was actually necessary, not just defensive:
  // fetchRawUpcomingRows already has its own release_date >= today filter,
  // but fetchReturningTVPremieres' nextSeasonPremiere (lib/catalog.ts) does
  // its own future-date check using JS `new Date()`, and a stale premiere
  // ("A Shop for Killers", dated the day before this exact run) still made
  // it through — re-admitted into upcoming_calendar on the SAME run that
  // graduateReleasedTitles had just correctly moved it out of, recreating
  // the "same title in both calendars" bug via a path the earlier fix didn't
  // cover. Using the DB's own now()::date (not JS's) keeps this consistent
  // with graduateReleasedTitles/pruneOldReleases, which already anchor to
  // Postgres' clock rather than the Node process's.
  const [{ today }] = (await sql`SELECT now()::date::text AS today`) as unknown as { today: string }[];
  const rows = merged.filter((r) => r.releaseDate >= today);

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    if (batch.length === 0) continue;
    await sql`
      INSERT INTO upcoming_calendar (id, type, title, subtitle, poster_url, backdrop_url, release_date, external_links, genres, original_language, rank_score, franchise_pick)
      SELECT * FROM UNNEST(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.type)}::text[],
        ${batch.map((r) => r.title)}::text[],
        ${batch.map((r) => r.subtitle ?? null)}::text[],
        ${batch.map((r) => r.posterURL ?? null)}::text[],
        ${batch.map((r) => r.backdropURL ?? null)}::text[],
        ${batch.map((r) => r.releaseDate)}::date[],
        ${batch.map((r) => JSON.stringify(r.externalLinks ?? []))}::jsonb[],
        ${batch.map((r) => JSON.stringify(r.genres ?? []))}::jsonb[],
        ${batch.map((r) => r.originalLanguage ?? null)}::text[],
        ${batch.map((r) => r.rankScore)}::int[],
        ${batch.map((r) => !!r.franchisePick)}::boolean[]
      ) AS t(id, type, title, subtitle, poster_url, backdrop_url, release_date, external_links, genres, original_language, rank_score, franchise_pick)
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        poster_url = excluded.poster_url,
        backdrop_url = COALESCE(excluded.backdrop_url, upcoming_calendar.backdrop_url),
        release_date = excluded.release_date,
        external_links = excluded.external_links,
        genres = excluded.genres,
        original_language = excluded.original_language,
        rank_score = excluded.rank_score,
        franchise_pick = excluded.franchise_pick,
        updated_at = now()
    `;
  }

  const keepIds = rows.map((r) => r.id);
  await sql`DELETE FROM upcoming_calendar WHERE NOT (id = ANY(${keepIds}))`;

  return { count: rows.length };
}

// ---------- Reads (live request paths) ----------

// Extra admission bar for non-English titles, layered on TOP of the refresh's
// own admission (Trakt membership / IGDB hypes) — NOT a replacement for it.
// Explicit request: Trakt's anticipated lists skew toward Trakt's own
// English-speaking user base, so a real regional hit (Jana Nayagan, Ip Man:
// Kung Fu Legend — both verified live to have genuine anticipation in their
// own markets) still posts a list_count far below an equally-anticipated
// English-language title. Rather than raising the bar for EVERYONE (which
// would also cut smaller-but-legitimate English titles the user did NOT
// object to), this only raises it for `original_language <> 'en'` rows —
// see lib/intlBar.ts for the user-facing setting. Applied at READ time, not
// baked into the refresh, so changing the setting doesn't require
// recomputing the whole calendar — same self-contained-WHERE-clause
// approach as excludeHiddenSQL.
const INTL_BAR_THRESHOLDS: Record<Exclude<IntlBarLevel, "off">, { movie: number; tvShow: number }> = {
  // Cuts Jana Nayagan (276) / Ip Man: Kung Fu Legend (300) while keeping
  // genuinely crossover-scale international hits.
  moderate: { movie: 2000, tvShow: 1000 },
  strict: { movie: 5000, tvShow: 3000 },
};

// Both bar functions below must NEVER apply their tvShow threshold to
// returning-show premieres (Adults, Silo, Reacher, ...) — those rows'
// rank_score is catalog vote_count (tens to low thousands even for a real
// hit), a completely different scale from Trakt's list_count (thousands to
// tens of thousands) that the tvShow thresholds are calibrated against.
// Verified live: applying the general bar's tvShow threshold uniformly
// silently dropped Adults' real, legitimate Season 2 premiere (vote_count
// 59) the moment the threshold was introduced. Returning premieres are
// identified by `subtitle IS NOT NULL` — only fetchReturningTVPremieres
// ever sets one (brand-new Trakt-admitted shows never do) — and are exempt
// from BOTH bars below, same as games: their own admission (a confirmed
// season-2+ pickup exists at all) is already the meaningful signal, per
// fetchReturningTVPremieres' own reasoning.
const RETURNING_TV_EXEMPT = "(type = 'tvShow' AND subtitle IS NOT NULL)";

// Franchise picks (see fetchFranchisePicks) are exempt from BOTH bars for
// the same reason games are: their admission — belonging to a major,
// hand-curated franchise — is already the point, explicitly "regardless of
// popularity." A low rank_score (One Piece: Grand Gourmet's IGDB hype of 5)
// must never re-exclude a row that was deliberately admitted despite it.
const FRANCHISE_PICK_EXEMPT = "franchise_pick = true";

function intlBarSQL(level: IntlBarLevel): string {
  if (level === "off") return "";
  const t = INTL_BAR_THRESHOLDS[level];
  return `AND (original_language = 'en' OR original_language IS NULL OR type = 'game' OR ${RETURNING_TV_EXEMPT} OR ${FRANCHISE_PICK_EXEMPT} OR
    (type = 'movie' AND rank_score >= ${t.movie}) OR (type = 'tvShow' AND subtitle IS NULL AND rank_score >= ${t.tvShow}))`;
}

// General admission bar — same idea as the international one above, but
// applied to EVERY movie/brand-new-TV row regardless of language (the
// international bar only raises the floor for non-English rows; this one
// raises it for everyone). Explicit request: even English-language titles
// that clear Trakt's own admission can still read as noise next to real
// tentpoles — verified live that Pinocchio: Unstrung (rank_score 1725), A
// Toxic Love Story (262), and Bad Counselors (137), ALL English, still felt
// like slop despite having real Trakt anticipation behind them. "moderate"
// (1800/900) is set just above Pinocchio: Unstrung's 1725 specifically so
// it (and everything at or below its tier) drops out.
const GENERAL_BAR_THRESHOLDS: Record<Exclude<GeneralBarLevel, "off">, { movie: number; tvShow: number }> = {
  moderate: { movie: 1800, tvShow: 900 },
  strict: { movie: 5000, tvShow: 3000 },
};

function generalBarSQL(level: GeneralBarLevel): string {
  if (level === "off") return "";
  const t = GENERAL_BAR_THRESHOLDS[level];
  return `AND (type = 'game' OR ${RETURNING_TV_EXEMPT} OR ${FRANCHISE_PICK_EXEMPT} OR
    (type = 'movie' AND rank_score >= ${t.movie}) OR (type = 'tvShow' AND subtitle IS NULL AND rank_score >= ${t.tvShow}))`;
}

// Shared by both calendars below — the only difference between "Popular
// upcoming" and "New releases" is which table and which chronological
// direction ("soonest first" vs "newest first"); the admission rules
// (Trakt/IGDB via the refresh), the bar filters, and the shelf-vs-page
// relationship are identical, because new_releases_calendar's rows are
// literally upcoming_calendar's graduates (see graduateReleasedTitles).
type CalendarTable = "upcoming_calendar" | "new_releases_calendar";

async function getCalendarTop(
  table: CalendarTable,
  direction: "ASC" | "DESC",
  types: string[],
  limit: number,
  hidden: ContentCategory[],
  intlBar: IntlBarLevel,
  generalBar: GeneralBarLevel
): Promise<MediaItem[]> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden) + " " + intlBarSQL(intlBar) + " " + generalBarSQL(generalBar);
    const perTypeSlots = Math.max(1, Math.ceil(limit / types.length));

    const slices = await Promise.all(
      types.map(
        (type) =>
          sql(
            `SELECT * FROM ${table} WHERE type = $1 ${filterSQL} ORDER BY release_date ${direction}, id ASC LIMIT $2`,
            [type, perTypeSlots]
          ) as unknown as Promise<CalendarDBRow[]>
      )
    );

    const sign = direction === "ASC" ? 1 : -1;
    return slices
      .flat()
      .sort((a, b) => sign * (new Date(a.release_date).getTime() - new Date(b.release_date).getTime()))
      .slice(0, limit)
      .map(calendarRowToMediaItem);
  } catch {
    return [];
  }
}

export interface CalendarPage {
  items: MediaItem[];
  hasMore: boolean;
}

const CALENDAR_PAGE_SIZE = 30;

async function getCalendarPage(
  table: CalendarTable,
  direction: "ASC" | "DESC",
  types: string[],
  hidden: ContentCategory[],
  page: number,
  pageSize: number,
  intlBar: IntlBarLevel,
  generalBar: GeneralBarLevel
): Promise<CalendarPage> {
  try {
    await ensureSchema();
    const sql = db();
    const filterSQL = excludeHiddenSQL(hidden) + " " + intlBarSQL(intlBar) + " " + generalBarSQL(generalBar);
    const offset = page * pageSize;
    // Fetch one extra row so hasMore is known without a separate COUNT(*).
    const rows = (await sql(
      `SELECT * FROM ${table} WHERE type = ANY($1) ${filterSQL}
       ORDER BY release_date ${direction}, id ASC
       OFFSET $2 LIMIT $3`,
      [types, offset, pageSize + 1]
    )) as unknown as CalendarDBRow[];
    const hasMore = rows.length > pageSize;
    return { items: rows.slice(0, pageSize).map(calendarRowToMediaItem), hasMore };
  } catch {
    return { items: [], hasMore: false };
  }
}

// "Popular upcoming" — a small, hand-picked highlight shelf: a soonest-
// arriving slice PER TYPE of upcoming_calendar, same selection rule as the
// full "See all" page below — explicit request that the shelf be a literal
// subset of the page ("the two should show the same content"), not a
// separately-ranked view that can show something the page's own ordering
// wouldn't put first. Every candidate already cleared the refresh's
// admission rules (real Trakt anticipation for movies/TV, real AAA hype for
// games) plus the international/general bars above, so "soonest" is safe here.
export async function getUpcomingCalendarTop(
  types: string[],
  limit = 16,
  hidden: ContentCategory[] = [],
  intlBar: IntlBarLevel = DEFAULT_INTL_BAR_LEVEL,
  generalBar: GeneralBarLevel = DEFAULT_GENERAL_BAR_LEVEL
): Promise<MediaItem[]> {
  return getCalendarTop("upcoming_calendar", "ASC", types, limit, hidden, intlBar, generalBar);
}

export type UpcomingPage = CalendarPage;

// "Popular upcoming"'s See all — a single flat, globally chronological,
// indexed query (release_date has a real index — see lib/db.ts) against
// the precomputed calendar. No per-type stitching, so no possibility of the
// cross-page ordering bug an earlier live-computed version had (see git
// history of lib/upcoming.ts's upcomingBrowse for that story) — there's
// only ever one ordering, computed by Postgres itself off a real index.
export async function getUpcomingCalendarPage(
  types: string[],
  hidden: ContentCategory[] = [],
  page = 0,
  pageSize = CALENDAR_PAGE_SIZE,
  intlBar: IntlBarLevel = DEFAULT_INTL_BAR_LEVEL,
  generalBar: GeneralBarLevel = DEFAULT_GENERAL_BAR_LEVEL
): Promise<UpcomingPage> {
  return getCalendarPage("upcoming_calendar", "ASC", types, hidden, page, pageSize, intlBar, generalBar);
}

// "New releases" — the same shelf-plus-full-page structure as "Popular
// upcoming," just walking new_releases_calendar NEWEST-first instead of
// soonest-first. Same bar thresholds, same shelf-is-a-prefix-of-the-page
// relationship, same admission rules — because a row here is literally a
// graduate of upcoming_calendar (see graduateReleasedTitles), never an
// independently-admitted one, the two calendars can never overlap: a title
// is in exactly one of them at any given time, determined solely by
// whether its release_date has passed.
export async function getNewReleasesCalendarTop(
  types: string[],
  limit = 16,
  hidden: ContentCategory[] = [],
  intlBar: IntlBarLevel = DEFAULT_INTL_BAR_LEVEL,
  generalBar: GeneralBarLevel = DEFAULT_GENERAL_BAR_LEVEL
): Promise<MediaItem[]> {
  return getCalendarTop("new_releases_calendar", "DESC", types, limit, hidden, intlBar, generalBar);
}

export async function getNewReleasesCalendarPage(
  types: string[],
  hidden: ContentCategory[] = [],
  page = 0,
  pageSize = CALENDAR_PAGE_SIZE,
  intlBar: IntlBarLevel = DEFAULT_INTL_BAR_LEVEL,
  generalBar: GeneralBarLevel = DEFAULT_GENERAL_BAR_LEVEL
): Promise<CalendarPage> {
  return getCalendarPage("new_releases_calendar", "DESC", types, hidden, page, pageSize, intlBar, generalBar);
}
