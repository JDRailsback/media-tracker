import type { MediaItem } from "@/lib/types";

// MangaDex adapter (TS port). v1 = official English chapter dates only.

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

export async function searchMangaDex(q: string): Promise<MediaItem[]> {
  const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(q)}&limit=10&includes[]=cover_art`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MangaDex search failed: ${res.status}`);
  const data = await res.json();
  return (data.data as MDManga[]).map((m) => mapManga(m));
}

export async function detailsMangaDex(id: string): Promise<MediaItem> {
  const res = await fetch(`https://api.mangadex.org/manga/${id}?includes[]=cover_art`);
  if (!res.ok) throw new Error(`MangaDex details failed: ${res.status}`);
  const manga = (await res.json()).data as MDManga;

  const next = await nextOfficialChapter(id);
  return mapManga(manga, next?.date, next ? `Ch. ${next.chapter}` : undefined);
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
