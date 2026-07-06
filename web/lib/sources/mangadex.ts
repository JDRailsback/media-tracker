import type { MediaItem } from "@/lib/types";

// MangaDex adapter (TS port). v1 = official English chapter dates only.

// Quality bar: manga has no per-item popularity in the base search response,
// so we batch-fetch "follows" via /statistics/manga (one extra request per
// search, not one per result) and require a minimum. Confirmed live:
// GET /statistics/manga?manga[]=id1&manga[]=id2 -> { statistics: { [id]: { follows } } }
const MIN_FOLLOWS = 50;

interface MDRelationship {
  id: string;
  type: string;
  attributes?: { fileName?: string };
}

interface MDManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    description?: Record<string, string>;
    year?: number;
  };
  relationships: MDRelationship[];
}

function coverURL(m: MDManga): string | undefined {
  const cover = m.relationships.find((r) => r.type === "cover_art");
  const file = cover?.attributes?.fileName;
  // Routed through OUR proxy, not uploads.mangadex.org directly — see
  // app/api/cover/mangadex/[mangaId]/[fileName]/route.ts for why.
  return file ? `/api/cover/mangadex/${m.id}/${file}.512.jpg` : undefined;
}

function mapManga(m: MDManga, releaseDate?: string, subtitle?: string): MediaItem {
  const title = m.attributes.title.en ?? Object.values(m.attributes.title)[0] ?? "Untitled";
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

export async function searchMangaDex(q: string): Promise<MediaItem[]> {
  const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(q)}&limit=15&includes[]=cover_art`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MangaDex search failed: ${res.status}`);
  const data = await res.json();
  const results = data.data as MDManga[];

  const withCovers = results.filter((m) => coverURL(m));
  const follows = await fetchFollows(withCovers.map((m) => m.id));

  return withCovers
    .filter((m) => (follows[m.id] ?? 0) >= MIN_FOLLOWS)
    .sort((a, b) => (follows[b.id] ?? 0) - (follows[a.id] ?? 0))
    .map((m) => mapManga(m));
}

export async function detailsMangaDex(id: string): Promise<MediaItem> {
  const res = await fetch(`https://api.mangadex.org/manga/${id}?includes[]=cover_art`);
  if (!res.ok) throw new Error(`MangaDex details failed: ${res.status}`);
  const manga = (await res.json()).data as MDManga;

  const next = await nextOfficialChapter(id);
  return mapManga(manga, next?.date, next ? `Ch. ${next.chapter}` : undefined);
}

// Popular manga (for the Discover page's "Popular manga" shelf). MangaDex can
// sort server-side by follow count, so no extra statistics call is needed here.
export async function discoverMangaDex(limit = 20): Promise<MediaItem[]> {
  const url = `https://api.mangadex.org/manga?order[followedCount]=desc&limit=${limit}&includes[]=cover_art&hasAvailableChapters=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MangaDex discover failed: ${res.status}`);
  const data = await res.json();
  return (data.data as MDManga[]).filter((m) => coverURL(m)).map((m) => mapManga(m));
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
