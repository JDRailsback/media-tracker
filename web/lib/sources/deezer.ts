import type { MediaItem, ReleaseGroupInfo } from "@/lib/types";

// Deezer adapter — the identity/popularity/image source for the music type.
// Entirely keyless for public data (no env vars). Artist ids here ARE the
// app's artist ids ("artist:{deezerId}"); MusicBrainz (see musicbrainz.ts)
// only supplements future release dates and is matched by name, never used
// as the identity.

// Deezer's documented public rate limit is 50 requests per 5 seconds per IP.
// Same rolling-window throttle pattern as igdb.ts — bounding concurrency
// alone can't respect a rate-over-time limit. Kept a bit under the ceiling.
const MAX_REQUESTS_PER_WINDOW = 40;
const WINDOW_MS = 5000;
const requestTimestamps: number[] = [];
let gate: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  gate = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (requestTimestamps.length && requestTimestamps[0] <= now - WINDOW_MS) {
        requestTimestamps.shift();
      }
      if (requestTimestamps.length < MAX_REQUESTS_PER_WINDOW) break;
      await new Promise((r) => setTimeout(r, requestTimestamps[0] + WINDOW_MS - now));
    }
    requestTimestamps.push(Date.now());
  });
  return gate;
}

async function deezerGET<T>(path: string): Promise<T> {
  await throttle();
  const res = await fetch(`https://api.deezer.com${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Deezer request failed (${path}): ${res.status}`);
  const data = await res.json();
  // Deezer reports errors as 200s with an { error } body (verified in their
  // docs — e.g. quota exceeded comes back this way, not as an HTTP 429).
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(`Deezer error (${path}): ${JSON.stringify((data as { error: unknown }).error)}`);
  }
  return data as T;
}

export interface DeezerArtist {
  id: number;
  name: string;
  picture_xl?: string; // 1000x1000 square
  picture_big?: string;
  nb_fan?: number; // cumulative fan count — the popularity_score for artists
  nb_album?: number;
}

interface DeezerAlbum {
  id: number;
  title: string;
  release_date?: string; // "YYYY-MM-DD"
  record_type?: string; // "album" | "single" | "ep" | "compilation" | ...
  cover_big?: string; // 500x500 — plenty for release cards
  cover_xl?: string; // 1000x1000
}

interface DeezerList<T> {
  data: T[];
  next?: string;
  total?: number;
}

export function deezerArtistImage(a: DeezerArtist): string | undefined {
  const url = a.picture_xl ?? a.picture_big ?? undefined;
  // Deezer returns a URL even for artists with NO picture — the default
  // placeholder has an empty image hash ("/images/artist//..."), verified
  // live. Treat it as no image so the same "must have art" bar every other
  // source applies actually bites here.
  if (url && url.includes("/artist//")) return undefined;
  return url;
}

export function artistToMediaItem(a: DeezerArtist): MediaItem {
  const image = deezerArtistImage(a);
  return {
    id: `artist:${a.id}`,
    type: "artist",
    title: a.name,
    posterURL: image,
    // The square artist portrait doubles as the detail card's hero — crops
    // fine under the Marquee scrim, same way 2:3 posters do.
    backdropURL: image,
  };
}

// Quality floor for LIVE search results only — Deezer's search index is full
// of fan uploads, OST knockoffs, and abandoned one-single accounts that
// text-match popular franchise names ("One Piece Puzzle", 707 fans; "øne
// piece", 18 — verified live). Real niche artists comfortably clear 1,000
// fans (Sidney Gish: 2,834), so the floor cuts slop without defeating the
// find-anyone purpose of the fallback. Deliberately NOT applied to the
// catalog pool walk — the related-artists graph only reaches real acts.
const LIVE_ARTIST_MIN_FANS = 1000;

// Deezer's own search silently drops numeric/short tokens instead of
// requiring them — verified live: searching "coco 2" returns "CoCo Jones",
// "Coco & Clair Clair", and two different artists just named "Coco", none of
// which contain "2" at all (Deezer matched "coco" alone and ignored the
// rest). The catalog's own tsquery requires every token to match
// (buildPrefixQuery joins tokens with "&"), so the live fallback needs the
// same discipline or it's visibly less strict than the catalog path it's
// supposed to be filling gaps for.
function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function matchesAllTokens(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

// A fan-upload/soundtrack-compilation account can clear LIVE_ARTIST_MIN_FANS
// just fine ("One Piece OST": 2,126 fans) — verified live, that range
// overlaps real niche artists too closely for a fan-count floor alone to
// separate them (see MIN_ARTIST_CATALOG_POPULARITY's comment in
// lib/catalog.ts). This name-pattern check is cheap and safe since no real
// band names itself literally "X OST"/"X Soundtrack". The other half of that
// fix — catching a BARE franchise-name account like "One Piece" itself — is
// a cross-reference against our own catalog, which needs a DB call this
// keyless adapter deliberately doesn't make; that part lives in
// lib/sources/index.ts's liveArtistSearch instead.
function looksLikeSoundtrackAccount(name: string): boolean {
  return /\b(ost|soundtrack|original score|theme song)\b/i.test(name);
}

export async function searchDeezerArtists(q: string, limit = 15): Promise<DeezerArtist[]> {
  const data = await deezerGET<DeezerList<DeezerArtist>>(
    `/search/artist?q=${encodeURIComponent(q)}&limit=${limit}`
  );
  const tokens = tokenize(q);
  // Portrait-less artists are skipped everywhere (same "must have art" bar
  // every other source applies via poster/cover checks — deezerArtistImage
  // also rejects Deezer's default placeholder portrait).
  return (data.data ?? [])
    .filter(
      (a) =>
        deezerArtistImage(a) &&
        (a.nb_fan ?? 0) >= LIVE_ARTIST_MIN_FANS &&
        matchesAllTokens(a.name, tokens) &&
        !looksLikeSoundtrackAccount(a.name)
    )
    .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
}

export async function deezerArtist(id: string | number): Promise<DeezerArtist> {
  return deezerGET<DeezerArtist>(`/artist/${id}`);
}

// An artist's released work. Deezer paginates at 100/page via an absolute
// `next` URL; prolific artists (session musicians aside) rarely exceed a few
// pages. Compilations excluded — greatest-hits repackages aren't new work
// and would spam the discography list.
const ALBUM_PAGE_LIMIT = 100;
const MAX_ALBUM_PAGES = 5;

export async function deezerArtistReleases(id: string | number): Promise<ReleaseGroupInfo[]> {
  const releases: ReleaseGroupInfo[] = [];
  let path: string | null = `/artist/${id}/albums?limit=${ALBUM_PAGE_LIMIT}`;
  for (let page = 0; path && page < MAX_ALBUM_PAGES; page++) {
    const data: DeezerList<DeezerAlbum> = await deezerGET<DeezerList<DeezerAlbum>>(path);
    for (const album of data.data ?? []) {
      const kind = album.record_type;
      if (kind !== "album" && kind !== "ep" && kind !== "single") continue;
      releases.push({
        title: album.title,
        kind,
        date: album.release_date || undefined,
        coverURL: album.cover_big || album.cover_xl || undefined,
      });
    }
    path = data.next ? data.next.replace("https://api.deezer.com", "") : null;
  }
  return releases;
}

// Deezer's editorial chart — a real "popular right now" list, refreshed by
// Deezer itself. Genre 0 = "all genres". This is the trending signal for
// artists (the analogue of TMDB trending/week).
export async function deezerChartArtists(limit = 20): Promise<DeezerArtist[]> {
  const data = await deezerGET<DeezerList<DeezerArtist>>(`/chart/0/artists?limit=${limit}`);
  return (data.data ?? []).filter((a) => deezerArtistImage(a));
}

// Bulk-ingest artist pool. Deezer has no deep "top N artists" list, and its
// per-genre artist/chart endpoints all return the SAME global ~50 artists
// regardless of genre id (verified live against /genre/{id}/artists and
// /chart/{id}/artists — 28 genres, 50 unique artists total). What DOES work
// is the related-artists graph: BFS out from the chart seeds, 20 related
// artists per request, which stays anchored to well-known acts (relevance
// decays naturally with depth) and reaches thousands in a few hundred
// requests. The live search fallback covers everyone this can't.
export async function deezerArtistPool(targetCount: number): Promise<DeezerArtist[]> {
  const seeds = await deezerChartArtists(50);
  const seen = new Map<number, DeezerArtist>();
  const queue: number[] = [];
  for (const a of seeds) {
    seen.set(a.id, a);
    queue.push(a.id);
  }
  while (seen.size < targetCount && queue.length > 0) {
    const id = queue.shift()!;
    try {
      const related = await deezerGET<DeezerList<DeezerArtist>>(`/artist/${id}/related`);
      for (const a of related.data ?? []) {
        if (!deezerArtistImage(a) || seen.has(a.id)) continue;
        seen.set(a.id, a);
        queue.push(a.id);
      }
    } catch {
      // One dead node shouldn't sink the whole walk.
    }
  }
  return [...seen.values()].slice(0, targetCount);
}
