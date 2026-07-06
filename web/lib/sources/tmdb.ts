import type { ExternalLink, LinkKind, MediaItem } from "@/lib/types";

// TMDB adapter (TS port). Maps TMDB's JSON into our MediaItem.
// Runs server-side only (in an API route), so TMDB_API_KEY stays secret.

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

interface TMDBMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
}

interface TMDBSearchResponse {
  results: TMDBMovie[];
}

export async function searchTMDB(query: string): Promise<MediaItem[]> {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");

  const url = `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);

  const data = (await res.json()) as TMDBSearchResponse;
  return data.results.map(mapMovie);
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

// Details incl. watch providers (via append_to_response).
export async function detailsTMDB(id: string): Promise<MediaItem> {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");

  const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${key}&append_to_response=watch/providers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB details failed: ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = await res.json();
  const base = mapMovie(d as TMDBMovie);
  base.externalLinks = watchLinks(d["watch/providers"]?.results?.US);
  return base;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function watchLinks(country: any): ExternalLink[] | undefined {
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
