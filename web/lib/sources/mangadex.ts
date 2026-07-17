import type { ExternalLink, MediaItem } from "@/lib/types";
import type { CatalogRow } from "@/lib/catalog";
import type { TrendingRow } from "@/lib/trending";
import { fuzzyMatches, isExactMatch, matchTier, RankedItem } from "./textMatch";

// MangaDex adapter (TS port). v1 = official English chapter dates only.

// Quality bar: manga has no per-item popularity in the base search response,
// so we batch-fetch "follows" via /statistics/manga (one extra request per
// search, not one per result) and require a minimum. Confirmed live:
// GET /statistics/manga?manga[]=id1&manga[]=id2 -> { statistics: { [id]: { follows } } }
const MIN_FOLLOWS = 50;

// A non-exact match (e.g. a tie-in comic when you search a game/show's name)
// needs to be much more followed to show up at all. Searching its exact name
// still finds it (exact match = lenient bar above).
// Tuned against a real observed case: "Minecraft: Anime Edition" (a tie-in
// comic, not what most people mean by "minecraft") has 15,620 MangaDex
// follows — genuinely popular within manga readers, but not what a generic
// query should surface. No popularity number perfectly captures "is this
// the important thing," so this is a deliberately high, adjustable bar.
const NON_EXACT_MIN_FOLLOWS = 25000;

// A separate, MIDDLE-GROUND bar used only by franchise resolution (see
// `opts.lenient` below) — neither the strict exact-match bar (50, too
// permissive here — verified live it lets real doujinshi through, e.g. a
// One Piece/One-Punch Man crossover doujinshi with 935 follows) nor the
// general-search NON_EXACT_MIN_FOLLOWS (25,000, too strict — verified live
// it excludes real official spin-offs, e.g. "One Piece: Ace's Story—The
// Manga" at 3,158 follows). Follow count alone can't perfectly separate
// "official-ish franchise content" from "popular fan work" (some doujinshi
// out-follow obscure official one-shots), so this is a deliberate, tunable
// compromise favoring "show more of the franchise" over perfect purity.
const FRANCHISE_MIN_FOLLOWS = 500;

// MangaDex's API returns ALL content ratings — including erotica/pornographic
// — unless you explicitly restrict it. Verified live: searching "toy story"
// (which has no real match) returned several suggestive/erotica results that
// merely fuzzy-matched somewhere in MangaDex's own index. "safe" +
// "suggestive" covers ordinary mainstream manga (including normal
// shounen/shoujo fan-service); erotica/pornographic are always excluded,
// regardless of match quality or follows.
const CONTENT_RATING = "contentRating[]=safe&contentRating[]=suggestive";

interface MDRelationship {
  id: string;
  type: string;
  attributes?: { fileName?: string };
}

interface MDTag {
  attributes: { name: Record<string, string> };
}

interface MDManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    description?: Record<string, string>;
    year?: number;
    links?: Record<string, string>;
    tags?: MDTag[];
    status?: string; // "ongoing" | "completed" | "hiatus" | "cancelled"
    createdAt?: string; // when the entry was added to MangaDex
  };
  relationships: MDRelationship[];
}

// Would this manga clear the bar even judged as a non-exact match? Ranking
// signal only (see RankedItem).
function isSignificant(follows: number): boolean {
  return follows >= NON_EXACT_MIN_FOLLOWS;
}

// MangaDex's `links` field, verified live against a real response (One
// Piece): most keys are just cross-reference IDs to OTHER catalog sites
// (AniList, MyAnimeList, Kitsu, MangaUpdates...) — not places to actually
// read/buy the manga, so we skip those. A few keys ARE real, direct links:
//   engtl -> official English translation (e.g. Manga Plus) — the best link
//   bw    -> BookWalker; only a URL PATH, needs the domain prepended
//   amz/ebj/cdj -> Amazon/eBookJapan/CDJapan — already full URLs
//   raw   -> official Japanese source; used only as a fallback if no engtl
// Real, direct links only — no self-fallback to MangaDex's own page. Used
// directly by the bulk catalog (see paginatedMangaDex); readBuyLinks below
// wraps this with the self-fallback for the live single-item detail view.
export function realBuyLinks(links?: Record<string, string>): ExternalLink[] {
  const out: ExternalLink[] = [];
  if (links?.engtl) out.push({ provider: "Official (English)", url: links.engtl, kind: "stream" });
  else if (links?.raw) out.push({ provider: "Official (Japanese)", url: links.raw, kind: "info" });
  if (links?.bw) out.push({ provider: "BookWalker", url: `https://bookwalker.jp/${links.bw}`, kind: "buy" });
  if (links?.amz) out.push({ provider: "Amazon", url: links.amz, kind: "buy" });
  if (links?.ebj) out.push({ provider: "eBookJapan", url: links.ebj, kind: "buy" });
  if (links?.cdj) out.push({ provider: "CDJapan", url: links.cdj, kind: "buy" });
  return out;
}

function readBuyLinks(mangaID: string, links?: Record<string, string>): ExternalLink[] {
  const out = realBuyLinks(links);
  // Always link to SOMETHING — fall back to the manga's own MangaDex page.
  if (out.length === 0) {
    out.push({ provider: "MangaDex", url: `https://mangadex.org/title/${mangaID}`, kind: "info" });
  }
  return out;
}

export function coverURL(m: MDManga): string | undefined {
  const cover = m.relationships.find((r) => r.type === "cover_art");
  const file = cover?.attributes?.fileName;
  // Routed through OUR proxy, not uploads.mangadex.org directly — see
  // app/api/cover/mangadex/[mangaId]/[fileName]/route.ts for why.
  return file ? `/api/cover/mangadex/${m.id}/${file}.512.jpg` : undefined;
}

export function titleOf(m: MDManga): string {
  return m.attributes.title.en ?? Object.values(m.attributes.title)[0] ?? "Untitled";
}

function mapManga(m: MDManga, releaseDate?: string, subtitle?: string): MediaItem {
  const title = titleOf(m);
  return {
    id: `manga:${m.id}`,
    type: "manga",
    title,
    subtitle: subtitle ?? (m.attributes.year ? String(m.attributes.year) : undefined),
    overview: m.attributes.description?.en,
    posterURL: coverURL(m),
    releaseDate,
  };
}

// Batch-fetch follow counts — one request per 100 ids (MangaDex's page
// size; also keeps the query string a sane length when a caller merges two
// result pages, e.g. discoverMangaDexRecent).
async function fetchFollows(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const params = chunk.map((id) => `manga[]=${id}`).join("&");
    const res = await fetch(`https://api.mangadex.org/statistics/manga?${params}`, { cache: "no-store" });
    if (!res.ok) continue;
    const data = await res.json();
    for (const id of chunk) {
      out[id] = data.statistics?.[id]?.follows ?? 0;
    }
  }
  return out;
}

// `lenient` (used only by franchise resolution — lib/sources/franchise.ts)
// raises the result limit (MangaDex's own relevance ranking can push real
// spin-offs past 15 — verified live: "One Piece" has 34 raw matches) and
// swaps the exact/non-exact bar pair for the single FRANCHISE_MIN_FOLLOWS
// middle ground.
export async function searchMangaDex(
  q: string,
  opts?: { lenient?: boolean }
): Promise<RankedItem[]> {
  const limit = opts?.lenient ? 40 : 15;
  const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(q)}&limit=${limit}&includes[]=cover_art&${CONTENT_RATING}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`MangaDex search failed: ${res.status}`);
  const data = await res.json();
  const results = data.data as MDManga[];

  // MangaDex's own search sometimes matches on tags/alt-titles that don't
  // appear anywhere in the displayed title — e.g. searching "toy story"
  // (which has no real manga match) returned several completely unrelated
  // titles. Require the displayed title to at least CONTAIN the query before
  // any popularity consideration; a title that isn't even a loose text match
  // shouldn't show up regardless of how followed it is.
  const withCovers = results.filter(
    (m) => coverURL(m) && (matchTier(titleOf(m), q) < 3 || fuzzyMatches(titleOf(m), q))
  );
  const follows = await fetchFollows(withCovers.map((m) => m.id));

  return withCovers
    .filter((m) => {
      const threshold = opts?.lenient
        ? FRANCHISE_MIN_FOLLOWS
        : isExactMatch(titleOf(m), q)
        ? MIN_FOLLOWS
        : NON_EXACT_MIN_FOLLOWS;
      return (follows[m.id] ?? 0) >= threshold;
    })
    .sort((a, b) => (follows[b.id] ?? 0) - (follows[a.id] ?? 0))
    .map((m) => ({
      ...mapManga(m),
      significant: isSignificant(follows[m.id] ?? 0),
      popularity: follows[m.id] ?? 0,
    }));
}

export async function detailsMangaDex(id: string): Promise<MediaItem> {
  const res = await fetch(`https://api.mangadex.org/manga/${id}?includes[]=cover_art`, { cache: "no-store" });
  if (!res.ok) throw new Error(`MangaDex details failed: ${res.status}`);
  const manga = (await res.json()).data as MDManga;

  const next = await nextOfficialChapter(id);
  const item = mapManga(manga, next?.date, next ? `Ch. ${next.chapter}` : undefined);
  item.externalLinks = readBuyLinks(id, manga.attributes.links);
  return item;
}

// Popular manga (for the Discover page's "Popular manga" shelf). MangaDex can
// sort server-side by follow count, so no extra statistics call is needed here.
export async function discoverMangaDex(limit = 20): Promise<MediaItem[]> {
  const url = `https://api.mangadex.org/manga?order[followedCount]=desc&limit=${limit}&includes[]=cover_art&hasAvailableChapters=true&${CONTENT_RATING}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`MangaDex discover failed: ${res.status}`);
  const data = await res.json();
  return (data.data as MDManga[]).filter((m) => coverURL(m)).map((m) => mapManga(m));
}

// ---------- Bulk catalog ingestion (scripts/ingest-catalog.ts only) ----------
// Sorted by followedCount (the same stable, cumulative signal used for
// search ranking — see the rationale in searchMangaDex), so "most popular N"
// tracks real, sustained readership rather than any trending metric.
// MangaDex caps `limit` at 100 per request; offset-paginated beyond that.
const MANGADEX_PAGE_SIZE = 100;

// One API entry + its follow count → CatalogRow, shared by the bulk ingest
// and the daily recent fetch below. `releaseDate` defaults to year-01-01
// (MangaDex has no real serialization date, only a year); the recent fetch
// passes the entry's createdAt instead so new series carry a usable date.
function mangaToCatalogRow(m: MDManga, follows: number, releaseDate?: string): CatalogRow {
  const tags = (m.attributes.tags ?? [])
    .map((t) => t.attributes.name.en)
    .filter((n): n is string => !!n);
  return {
    id: `manga:${m.id}`,
    type: "manga",
    title: titleOf(m),
    overview: m.attributes.description?.en,
    posterURL: coverURL(m),
    releaseDate: releaseDate ?? (m.attributes.year ? `${m.attributes.year}-01-01` : undefined),
    popularityScore: follows,
    genres: tags,
    externalLinks: realBuyLinks(m.attributes.links),
    metadata: { status: m.attributes.status },
  };
}

export async function paginatedMangaDex(
  targetCount: number,
  onPage?: (fetched: number) => void
): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let offset = 0; rows.length < targetCount; offset += MANGADEX_PAGE_SIZE) {
    const url = `https://api.mangadex.org/manga?order[followedCount]=desc&limit=${MANGADEX_PAGE_SIZE}&offset=${offset}&includes[]=cover_art&hasAvailableChapters=true&${CONTENT_RATING}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`MangaDex catalog page (offset ${offset}) failed: ${res.status}`);
    const data = await res.json();
    const page = (data.data as MDManga[]).filter((m) => coverURL(m));
    if (page.length === 0) break;

    const follows = await fetchFollows(page.map((m) => m.id));
    for (const m of page) {
      rows.push(mangaToCatalogRow(m, follows[m.id] ?? 0));
    }
    onPage?.(rows.length);
    if (page.length < MANGADEX_PAGE_SIZE) break;
  }
  return rows.slice(0, targetCount);
}

// ---------- Daily recent refresh (app/api/cron/daily/route.ts) ----------
// MangaDex has no "announced but unpublished" concept — a title exists once
// it's actually serializing — so "recent" here means newly-ADDED series:
// (a) the most-followed series added in the last 90 days (new AND already
// rising), (b) the newest additions outright (brand-new, before follows have
// had time to accumulate). The follows floor keeps the endless stream of
// low-signal uploads out of the catalog — a genuinely rising new series
// clears a few hundred follows within days, so quality-over-immediacy: it
// enters on a later cron run instead of never. releaseDate is the entry's
// createdAt (the only day-precision date MangaDex has — the year-01-01
// fallback used by the bulk ingest would never land in a recency window).
const RECENT_MIN_FOLLOWS = 500;
const RECENT_MANGA_WINDOW_DAYS = 90;

export async function discoverMangaDexRecent(limit = 60): Promise<CatalogRow[]> {
  // MangaDex requires this param formatted as YYYY-MM-DDTHH:mm:ss — no
  // milliseconds, no timezone suffix.
  const since = new Date(Date.now() - RECENT_MANGA_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);
  const common = `limit=${MANGADEX_PAGE_SIZE}&includes[]=cover_art&hasAvailableChapters=true&${CONTENT_RATING}`;
  const [risingRes, newestRes] = await Promise.all([
    fetch(`https://api.mangadex.org/manga?order[followedCount]=desc&createdAtSince=${since}&${common}`, { cache: "no-store" }),
    fetch(`https://api.mangadex.org/manga?order[createdAt]=desc&${common}`, { cache: "no-store" }),
  ]);
  if (!risingRes.ok) throw new Error(`MangaDex recent (rising) failed: ${risingRes.status}`);
  if (!newestRes.ok) throw new Error(`MangaDex recent (newest) failed: ${newestRes.status}`);
  const rising = (await risingRes.json()).data as MDManga[];
  const newest = (await newestRes.json()).data as MDManga[];

  const seen = new Map<string, MDManga>();
  for (const m of [...rising, ...newest]) {
    if (coverURL(m) && !seen.has(m.id)) seen.set(m.id, m);
  }
  const candidates = [...seen.values()];
  const follows = await fetchFollows(candidates.map((m) => m.id));

  return candidates
    .filter((m) => (follows[m.id] ?? 0) >= RECENT_MIN_FOLLOWS)
    .sort((a, b) => (follows[b.id] ?? 0) - (follows[a.id] ?? 0))
    .slice(0, limit)
    .map((m) => mangaToCatalogRow(m, follows[m.id] ?? 0, m.attributes.createdAt?.slice(0, 10)));
}

// ---------- Trending (app/api/cron/daily/route.ts, via lib/trending.ts) ----------
// MangaDex has no momentum/velocity metric at all (no view counts, no
// trending endpoint) — follows is the only popularity signal it exposes, and
// it's purely cumulative (see the identical caveat on popularity_score
// throughout this file). The proxy used here: pull the pool of series with
// the most RECENT chapter activity (order[latestUploadedChapter]=desc — a
// real "still actively serializing, right now" signal MangaDex does expose),
// then rank that pool by follows. This answers "what's both being actively
// released AND already popular," which is the closest honest approximation
// of "trending" available from this source — not a claim that it's
// measuring real-time reader attention the way TMDB/IGDB's primitives do.
// MangaDex caps non-feed `limit` at 100 (verified live: 150 -> 400 "Non-feed
// limit query param may not be >100") — MANGADEX_PAGE_SIZE already reflects
// that same cap elsewhere in this file, reused here rather than a second
// magic number.
const TRENDING_MANGA_POOL_SIZE = MANGADEX_PAGE_SIZE;
const TRENDING_MANGA_MIN_FOLLOWS = 200;

export async function discoverMangaDexTrending(limit = 20): Promise<TrendingRow[]> {
  const url = `https://api.mangadex.org/manga?order[latestUploadedChapter]=desc&limit=${TRENDING_MANGA_POOL_SIZE}&includes[]=cover_art&hasAvailableChapters=true&${CONTENT_RATING}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`MangaDex trending failed: ${res.status}`);
  const data = await res.json();
  const candidates = (data.data as MDManga[]).filter((m) => coverURL(m));
  const follows = await fetchFollows(candidates.map((m) => m.id));

  return candidates
    .filter((m) => (follows[m.id] ?? 0) >= TRENDING_MANGA_MIN_FOLLOWS)
    .sort((a, b) => (follows[b.id] ?? 0) - (follows[a.id] ?? 0))
    .slice(0, limit)
    .map((m, i) => ({
      id: `manga:${m.id}`,
      type: "manga",
      title: titleOf(m),
      overview: m.attributes.description?.en,
      posterURL: coverURL(m),
      releaseDate: m.attributes.year ? `${m.attributes.year}-01-01` : undefined,
      rank: i + 1,
      genres: (m.attributes.tags ?? []).map((t) => t.attributes.name.en).filter((n): n is string => !!n),
    }));
}

async function nextOfficialChapter(
  id: string
): Promise<{ chapter: string; date: string } | null> {
  const url = `https://api.mangadex.org/manga/${id}/feed?translatedLanguage[]=en&order[publishAt]=asc&includeExternalUrl=1&includeFuturePublishAt=1&limit=100`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const now = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ch of data.data as any[]) {
    const external = ch.attributes.externalUrl;
    if (!external) continue; // official chapters are external links
    const t = Date.parse(ch.attributes.publishAt);
    if (!Number.isNaN(t) && t > now) {
      return { chapter: ch.attributes.chapter ?? "?", date: new Date(t).toISOString() };
    }
  }
  return null;
}
