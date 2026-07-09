import type { ExternalLink, MediaItem } from "@/lib/types";
import type { CatalogRow } from "@/lib/catalog";
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

// Batch-fetch follow counts for a set of manga ids in ONE request.
async function fetchFollows(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const params = ids.map((id) => `manga[]=${id}`).join("&");
  const res = await fetch(`https://api.mangadex.org/statistics/manga?${params}`);
  if (!res.ok) return {};
  const data = await res.json();
  const out: Record<string, number> = {};
  for (const id of ids) {
    out[id] = data.statistics?.[id]?.follows ?? 0;
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
  const res = await fetch(url);
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
  const res = await fetch(`https://api.mangadex.org/manga/${id}?includes[]=cover_art`);
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
  const res = await fetch(url);
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

export async function paginatedMangaDex(
  targetCount: number,
  onPage?: (fetched: number) => void
): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let offset = 0; rows.length < targetCount; offset += MANGADEX_PAGE_SIZE) {
    const url = `https://api.mangadex.org/manga?order[followedCount]=desc&limit=${MANGADEX_PAGE_SIZE}&offset=${offset}&includes[]=cover_art&hasAvailableChapters=true&${CONTENT_RATING}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MangaDex catalog page (offset ${offset}) failed: ${res.status}`);
    const data = await res.json();
    const page = (data.data as MDManga[]).filter((m) => coverURL(m));
    if (page.length === 0) break;

    const follows = await fetchFollows(page.map((m) => m.id));
    for (const m of page) {
      const tags = (m.attributes.tags ?? [])
        .map((t) => t.attributes.name.en)
        .filter((n): n is string => !!n);
      rows.push({
        id: `manga:${m.id}`,
        type: "manga",
        title: titleOf(m),
        overview: m.attributes.description?.en,
        posterURL: coverURL(m),
        releaseDate: m.attributes.year ? `${m.attributes.year}-01-01` : undefined,
        popularityScore: follows[m.id] ?? 0,
        genres: tags,
        externalLinks: realBuyLinks(m.attributes.links),
        metadata: { status: m.attributes.status },
      });
    }
    onPage?.(rows.length);
    if (page.length < MANGADEX_PAGE_SIZE) break;
  }
  return rows.slice(0, targetCount);
}

async function nextOfficialChapter(
  id: string
): Promise<{ chapter: string; date: string } | null> {
  const url = `https://api.mangadex.org/manga/${id}/feed?translatedLanguage[]=en&order[publishAt]=asc&includeExternalUrl=1&includeFuturePublishAt=1&limit=100`;
  const res = await fetch(url);
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
