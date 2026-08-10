import { NextResponse } from "next/server";
import {
  discoverTMDBUpcomingMovies,
  discoverTMDBUpcomingTV,
  discoverTMDBRecentMovies,
  discoverTMDBRecentTV,
  discoverTMDBTrendingMovies,
  discoverTMDBTrendingTV,
  tvExtra,
} from "@/lib/sources/tmdb";
import { discoverIGDBUpcoming, discoverIGDBRecent, discoverIGDBTrending } from "@/lib/sources/igdb";
// Manga ingestion paused — see the comment above the Promise.allSettled call
// below. lib/sources/mangadex.ts itself is untouched, just unused for now.
import { discoverDeezerTrendingArtists, ingestArtist } from "@/lib/sources/artist";
import { db, ensureSchema } from "@/lib/db";
import { upsertUpcoming, pruneUpcoming } from "@/lib/upcoming";
import type { UpcomingRow } from "@/lib/upcoming";
import { upsertCatalog } from "@/lib/catalog";
import type { CatalogRow } from "@/lib/catalog";
import { upsertTrending, pruneTrending } from "@/lib/trending";
import type { TrendingRow } from "@/lib/trending";
import { rebuildAllCollections } from "@/lib/collections-rebuild";
import { toISODate } from "@/lib/dbDate";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/daily — the one daily data-refresh job, triggered by Vercel
// Cron (see vercel.json; Hobby allows only two cron jobs, and /api/poll has
// the other slot — hence one consolidated endpoint rather than one per
// concern). Same Authorization: Bearer CRON_SECRET pattern as /api/poll.
// Four stages run inline here, then a fifth pair is handed off to a SEPARATE
// invocation:
//   A. Upcoming refresh — upcoming_items replaced with the current biggest
//      unreleased/announced titles (dated or not).
//   B. Recent releases — titles released in the last ~30 days upserted into
//      catalog_items (all four types, manga included). This is what
//      "graduates" a title the day it releases: stage A prunes it from
//      upcoming_items, stage B lands it in the catalog. Re-running the whole
//      window daily also keeps a fresh title's score/poster/metadata
//      self-correcting for a month.
//   C. Trending refresh — trending_items fully replaced with each source's
//      own real momentum signal (TMDB trending/week, IGDB
//      popularity_primitives, a MangaDex active-by-follows proxy — see
//      lib/sources/{tmdb,igdb,mangadex}.ts) — distinct from catalog_items'
//      all-time popularity_score. Independent of stages A/B: a trending
//      title is very often already IN the catalog (trending_items only
//      stores rank + display data, not the source of truth for the title).
//   D. Collection self-heal — re-resolves the hand-curated title lists in
//      lib/collections.ts against the (possibly just-grown) catalog. The
//      lists themselves never change automatically.
//   E/F. Upcoming calendar rebuild + Discover snapshot rebuild — see
//      lib/upcomingCalendar.ts / lib/discoverSnapshot.ts. Used to run
//      inline, right here, after D — but A-D alone were already measured at
//      ~57.8s of real wall-clock time (see lib/sources/tmdb.ts's
//      OFFICIAL_STATUS_CONCURRENCY comment), uncomfortably close to
//      Vercel's 60s function limit even before E's own Trakt calls are
//      added on top. Verified live: once Trakt started actually returning
//      data instead of erroring instantly, the combined A-F runtime started
//      timing out mid-E, and Vercel kills an invocation at maxDuration with
//      no partial save for whatever was mid-flight — upcoming_items would
//      refresh fine while upcoming_calendar and the Discover snapshot
//      silently never updated. E/F now run in /api/cron/refresh-calendar
//      instead, triggered below via a fire-and-forget server-to-server
//      call — a genuinely separate invocation gets its own fresh 60s
//      budget, independent of how long A-D just took. That route isn't in
//      vercel.json's `crons` list (same Hobby two-job cap as above), so
//      it's only ever reached this way, never by Vercel's scheduler
//      directly — the CRON_SECRET check there is what actually gates it.
// Nothing in the live app calls TMDB/IGDB/MangaDex — this cron and the
// manual ingest script are the only writers; every user-facing read stays
// table-only.

async function refreshUpcoming(type: string, fetchRows: () => Promise<UpcomingRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertUpcoming(rows);
  await pruneUpcoming(type, rows.map((r) => r.id));
  return rows.length;
}

async function ingestRecent(fetchRows: () => Promise<CatalogRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertCatalog(rows);
  return rows.length;
}

async function refreshTrending(type: string, fetchRows: () => Promise<TrendingRow[]>): Promise<number> {
  const rows = await fetchRows();
  await upsertTrending(rows);
  await pruneTrending(type, rows.map((r) => r.id));
  return rows.length;
}

// Rotating artist-discography refresh. MusicBrainz's hard 1 req/s cap means
// refreshing EVERY catalog artist daily is impossible inside Vercel's 60s
// limit — instead each run refreshes a bounded budget: every followed
// artist first (they drive the Home feed and poll notifications), then the
// stalest of the rest. With daily runs the whole catalog still cycles over
// a couple of weeks, and followed artists are always fresh.
const ARTIST_REFRESH_PER_RUN = 20;

async function refreshArtistDiscographies(): Promise<number> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT c.id, c.metadata->>'mbid' AS mbid
    FROM catalog_items c
    WHERE c.type = 'artist'
    ORDER BY
      (c.id IN (SELECT 'artist:' || f.source_id FROM followed_items f WHERE f.type = 'artist')) DESC,
      c.updated_at ASC
    LIMIT ${ARTIST_REFRESH_PER_RUN}
  `) as unknown as { id: string; mbid: string | null }[];

  // Sequential on purpose: every artist's MusicBrainz call goes through the
  // same 1 req/s gate anyway, so parallelism buys nothing here.
  for (const row of rows) {
    const deezerId = row.id.slice(row.id.indexOf(":") + 1);
    await ingestArtist(deezerId, row.mbid);
  }
  return rows.length;
}

// Same "followed items always get refreshed" principle as artists above,
// for a real gap TV shows didn't have at all: discoverTMDBRecentTV's
// popularity/date-window admission (stage B) only revisits a show while
// it's popular/recent enough to qualify — a followed show that's neither
// (a lower-profile currently-airing series, or one whose air-date has
// aged out of the ~30-45 day window) never gets touched again, so a
// one-time bad fetch (or a show ingested before its episodes existed)
// stays wrong forever. Verified live: "Witch Hat Atelier" — a real,
// currently-followed, currently-airing show — sat at 0 fetched episodes
// (TMDB has 13) because it simply never qualified for stage B's list.
// Small, uncapped list in practice (a personal follow list, not the whole
// catalog) — sequential for the same reason artists are: no shared rate
// limit to parallelize around, and it's a handful of shows at most.
async function refreshFollowedTVShows(): Promise<number> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT c.id, c.title, c.overview, c.poster_url, c.backdrop_url, c.release_date,
           c.popularity_score, c.genres, c.original_language
    FROM catalog_items c
    JOIN followed_items f ON f.item_id = c.id
    WHERE c.type = 'tvShow' AND f.active = true
    GROUP BY c.id
  `) as unknown as {
    id: string;
    title: string;
    overview: string | null;
    poster_url: string | null;
    backdrop_url: string | null;
    release_date: string | null;
    popularity_score: number;
    genres: string[];
    original_language: string | null;
  }[];

  const catalogRows: CatalogRow[] = [];
  for (const row of rows) {
    const tmdbId = Number(row.id.split(":")[1]);
    const extra = await tvExtra(tmdbId, row.title);
    catalogRows.push({
      id: row.id,
      type: "tvShow",
      title: row.title,
      overview: row.overview ?? undefined,
      posterURL: row.poster_url ?? undefined,
      backdropURL: row.backdrop_url ?? undefined,
      releaseDate: row.release_date ?? undefined,
      popularityScore: row.popularity_score,
      genres: row.genres ?? [],
      externalLinks: extra.externalLinks,
      metadata: {
        status: extra.status,
        numberOfSeasons: extra.numberOfSeasons,
        numberOfEpisodes: extra.numberOfEpisodes,
        seasons: extra.seasons,
        nextEpisodeToAir: extra.nextEpisodeToAir,
        imdbId: extra.imdbId,
        networks: extra.networks,
      },
      tags: extra.tags,
      originalLanguage: row.original_language ?? undefined,
    });
  }
  await upsertCatalog(catalogRows);
  return catalogRows.length;
}

// The unreleased counterpart of refreshFollowedTVShows above. upcoming_items
// has no episode data at all by default (discoverTMDBUpcomingTV is
// deliberately cheap — up to ~1000 shows, list-endpoint only, no per-item
// detail fetch) — a followed-but-unreleased show only ever showed its
// single premiere date, even when TMDB already has the full season
// schedule (verified live: "Lanterns" and "Carrie," both fully scheduled on
// TMDB, showed only their premiere). upsertUpcoming's own regression guard
// (see there) protects this from being wiped by the regular stage A refresh.
async function refreshFollowedUpcomingTVShows(): Promise<number> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT u.id, u.title, u.overview, u.poster_url, u.backdrop_url, u.release_date,
           u.date_confirmed, u.popularity_score, u.genres, u.original_language
    FROM upcoming_items u
    JOIN followed_items f ON f.item_id = u.id
    WHERE u.type = 'tvShow' AND f.active = true
    GROUP BY u.id
  `) as unknown as {
    id: string;
    title: string;
    overview: string | null;
    poster_url: string | null;
    backdrop_url: string | null;
    release_date: string | Date | null;
    date_confirmed: boolean;
    popularity_score: number;
    genres: string[];
    original_language: string | null;
  }[];

  const upcomingRows: UpcomingRow[] = [];
  for (const row of rows) {
    const tmdbId = Number(row.id.split(":")[1]);
    const extra = await tvExtra(tmdbId, row.title);
    upcomingRows.push({
      id: row.id,
      type: "tvShow",
      title: row.title,
      overview: row.overview ?? undefined,
      posterURL: row.poster_url ?? undefined,
      backdropURL: row.backdrop_url ?? undefined,
      releaseDate: toISODate(row.release_date),
      dateConfirmed: row.date_confirmed,
      popularityScore: row.popularity_score,
      genres: row.genres ?? [],
      originalLanguage: row.original_language ?? undefined,
      externalLinks: extra.externalLinks,
      metadata: {
        status: extra.status,
        numberOfSeasons: extra.numberOfSeasons,
        numberOfEpisodes: extra.numberOfEpisodes,
        seasons: extra.seasons,
        nextEpisodeToAir: extra.nextEpisodeToAir,
        imdbId: extra.imdbId,
        networks: extra.networks,
      },
    });
  }
  await upsertUpcoming(upcomingRows);
  return upcomingRows.length;
}

function settled(r: PromiseSettledResult<number>): number | { error: string } {
  return r.status === "fulfilled" ? r.value : { error: String(r.reason) };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Stages A, B, and C in parallel — different tables, and each entry is a
  // different source/type pair, so nothing contends. The artist refresh
  // rides alongside: it hits Deezer/MusicBrainz, which nothing else touches.
  //
  // Manga ingestion is PAUSED, not removed — explicit request ("remove
  // manga from the site... flag it as something to potentially add later").
  // No point spending MangaDex API calls/cron time refreshing data nothing
  // reads right now; existing manga catalog_items/trending_items rows are
  // left in place untouched, just aging. To re-enable: restore
  // ingestRecent(discoverMangaDexRecent) and
  // refreshTrending("manga", discoverMangaDexTrending) below (and their
  // matching destructure/response entries), and re-add manga back into
  // Discover (see lib/sources/index.ts's discover(), lib/discoverSnapshot.ts's
  // DiscoverPayload).
  const [
    upMovie,
    upTV,
    upGame,
    recMovie,
    recTV,
    recGame,
    trendMovie,
    trendTV,
    trendGame,
    trendArtist,
    artistsRefreshed,
    followedTVRefreshed,
    followedUpcomingTVRefreshed,
  ] = (
    await Promise.allSettled([
      refreshUpcoming("movie", discoverTMDBUpcomingMovies),
      refreshUpcoming("tvShow", discoverTMDBUpcomingTV),
      refreshUpcoming("game", discoverIGDBUpcoming),
      ingestRecent(discoverTMDBRecentMovies),
      ingestRecent(discoverTMDBRecentTV),
      ingestRecent(discoverIGDBRecent),
      refreshTrending("movie", discoverTMDBTrendingMovies),
      refreshTrending("tvShow", discoverTMDBTrendingTV),
      refreshTrending("game", discoverIGDBTrending),
      refreshTrending("artist", discoverDeezerTrendingArtists),
      refreshArtistDiscographies(),
      refreshFollowedTVShows(),
      refreshFollowedUpcomingTVShows(),
    ])
  ).map(settled);

  // Stage D after B so the rebuild sees any titles B just added.
  let collections: { totalItems: number; totalUnmatched: number } | { error: string };
  try {
    const summary = await rebuildAllCollections();
    collections = { totalItems: summary.totalItems, totalUnmatched: summary.totalUnmatched };
  } catch (err) {
    collections = { error: String(err) };
  }

  // Stage E/F handoff — fire-and-forget, not awaited: this invocation's own
  // remaining budget can't be trusted to cover E/F's full runtime on top of
  // what A-D already took (see this file's top comment). waitUntil keeps
  // this invocation alive just long enough to guarantee the request is
  // actually sent rather than dropped the instant this handler returns;
  // once Vercel has received it, /api/cron/refresh-calendar runs as its own
  // independent invocation regardless of what happens to this one
  // afterward. The secret is read directly rather than forwarding this
  // request's own Authorization header, since a request with no `secret`
  // configured (local dev without CRON_SECRET set) would otherwise forward
  // a null/missing header instead of skipping auth the same way this
  // route's own check above does.
  const origin = new URL(request.url).origin;
  waitUntil(
    fetch(`${origin}/api/cron/refresh-calendar`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }).catch((err) => {
      console.error("Failed to trigger /api/cron/refresh-calendar", err);
    })
  );

  return NextResponse.json({
    upcoming: { movie: upMovie, tvShow: upTV, game: upGame },
    recent: { movie: recMovie, tvShow: recTV, game: recGame },
    trending: { movie: trendMovie, tvShow: trendTV, game: trendGame, artist: trendArtist },
    artistsRefreshed,
    followedTVRefreshed,
    followedUpcomingTVRefreshed,
    collections,
    calendarRefresh: "triggered", // see /api/cron/refresh-calendar for its own result
  });
}
