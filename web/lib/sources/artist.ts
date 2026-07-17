import type { ReleaseGroupInfo } from "@/lib/types";
import type { CatalogRow } from "@/lib/catalog";
import type { TrendingRow } from "@/lib/trending";
import { upsertCatalog } from "@/lib/catalog";
import { db, ensureSchema } from "@/lib/db";
import {
  deezerArtist,
  deezerArtistImage,
  deezerArtistReleases,
  deezerChartArtists,
  deezerArtistPool,
  type DeezerArtist,
} from "./deezer";
import { mbReleaseGroups, resolveMBID } from "./musicbrainz";

// Glue for the music type: merges Deezer (identity, images, popularity,
// released discography) with MusicBrainz (future release dates) into the
// same CatalogRow shape every other type uses. Artists live in
// catalog_items — no music-specific tables.

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Dedupe key. Kind is part of it deliberately: a lead single and the album
// it precedes often share a title, and both should show — but the
// explicit/clean/deluxe EDITIONS of one release (which Deezer lists
// separately under an identical title) should collapse to one entry.
function releaseKey(r: ReleaseGroupInfo): string {
  return `${r.kind}:${normTitle(r.title)}`;
}

// Bump when the stored discography shape changes (new fields, new dedupe
// rules) — details() re-ingests any artist whose stored version is older,
// so already-ingested rows self-heal on their next resolution instead of
// waiting for the cron rotation to reach them.
// v2: coverURL on entries + edition dedupe.
// v3: streaming-platform links (Spotify/Apple Music/YouTube Music/Deezer).
export const ARTIST_METADATA_VERSION = 3;

// Same pattern as tmdb.ts's PROVIDER_SEARCH_RULES: no keyless API exposes
// true per-artist profile URLs across platforms (MusicBrainz has url-rels,
// but that's an extra 1 req/s-throttled call per artist), so these link to
// each platform's own search pre-filled with the artist's name — a real
// link to the actual platform, one tap from the profile. Deezer is the one
// platform where the REAL page is known (it's the identity source).
function artistPlatformLinks(deezerId: number, name: string): { provider: string; url: string; kind: "stream" }[] {
  const q = encodeURIComponent(name);
  return [
    { provider: "Spotify", url: `https://open.spotify.com/search/${q}/artists`, kind: "stream" },
    { provider: "Apple Music", url: `https://music.apple.com/us/search?term=${q}`, kind: "stream" },
    { provider: "YouTube Music", url: `https://music.youtube.com/search?q=${q}`, kind: "stream" },
    { provider: "Deezer", url: `https://www.deezer.com/artist/${deezerId}`, kind: "stream" },
  ];
}

// Deezer is the canonical list of RELEASED work (real day-precision dates).
// MusicBrainz contributes ONLY strictly-future-dated entries not already
// present: its historical data is full of year-only dates and regional
// variants that would read as junk "TBA" rows, but an announced upcoming
// album with a real date is exactly the signal Deezer can't provide
// (releases only appear there on release day).
async function buildDiscography(
  deezerId: number,
  artistName: string,
  opts: { mbid?: string | null; withMB: boolean }
): Promise<{ discography: ReleaseGroupInfo[]; mbid: string | null }> {
  const raw = await deezerArtistReleases(deezerId);
  // Collapse duplicate editions, preferring the entry that has cover art
  // and a date (editions are otherwise interchangeable).
  const byKey = new Map<string, ReleaseGroupInfo>();
  for (const r of raw) {
    const key = releaseKey(r);
    const existing = byKey.get(key);
    if (!existing || (!existing.coverURL && r.coverURL) || (!existing.date && r.date)) {
      byKey.set(key, r);
    }
  }
  const discography = [...byKey.values()];
  let mbid = opts.mbid ?? null;

  if (opts.withMB) {
    if (!mbid) mbid = await resolveMBID(artistName);
    if (mbid) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        for (const rg of await mbReleaseGroups(mbid)) {
          if (!rg.date || rg.date <= today) continue;
          if (byKey.has(releaseKey(rg))) continue;
          byKey.set(releaseKey(rg), rg);
          discography.push(rg);
        }
      } catch {
        // Future dates are supplementary — a MusicBrainz hiccup shouldn't
        // sink the whole artist refresh.
      }
    }
  }

  // Newest first; undated entries ("" in the comparator) sort last.
  discography.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { discography, mbid };
}

// `withMB` is false for the BULK ingest (2,000+ artists against
// MusicBrainz's hard 1 req/s cap would take hours; the pre-ingested catalog
// exists for search/trending, where future dates don't matter yet) and true
// for the daily cron refresh and lazy admission (bounded artist counts,
// and these are the artists whose upcoming releases actually get tracked).
export async function buildArtistRow(
  a: DeezerArtist,
  opts?: { mbid?: string | null; withMB?: boolean }
): Promise<CatalogRow> {
  const withMB = opts?.withMB ?? true;
  const { discography, mbid } = await buildDiscography(a.id, a.name, {
    mbid: opts?.mbid,
    withMB,
  });
  const image = deezerArtistImage(a);
  const today = new Date().toISOString().slice(0, 10);
  // catalog release_date = the latest RELEASED work (discography is sorted
  // newest-first, so the first past entry wins) — this is what would let
  // artists participate in recency-ordered shelves; the "next upcoming"
  // display date is computed at read time from metadata.discography (see
  // catalogRowToMediaItem), same split as TV's episodes.
  const latestReleased = discography.find((r) => r.date && r.date <= today);
  // The mbid key is only PRESENT when MusicBrainz was actually attempted
  // (string = matched, null = tried and no confident match) — its absence
  // is what marks a bulk-ingested row as "MB never attempted", which
  // details() uses to trigger the one-time enriched refresh on first
  // resolution (see getArtistMBState below).
  const mbAttempted = withMB || opts?.mbid !== undefined;
  return {
    id: `artist:${a.id}`,
    type: "artist",
    title: a.name,
    posterURL: image,
    backdropURL: image,
    releaseDate: latestReleased?.date,
    popularityScore: a.nb_fan ?? 0,
    genres: [],
    externalLinks: artistPlatformLinks(a.id, a.name),
    metadata: mbAttempted
      ? { v: ARTIST_METADATA_VERSION, mbid, discography }
      : { v: ARTIST_METADATA_VERSION, discography },
  };
}

// Whether an artist row exists, has ever had a MusicBrainz pass, and is on
// the current metadata shape — the raw-metadata peek details() needs
// (catalogRowToMediaItem deliberately strips metadata from what it returns).
export async function getArtistRowState(
  id: string
): Promise<{ exists: boolean; mbAttempted: boolean; mbid: string | null; version: number }> {
  try {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`
      SELECT metadata ? 'mbid' AS attempted, metadata->>'mbid' AS mbid, COALESCE((metadata->>'v')::int, 0) AS version
      FROM catalog_items WHERE id = ${id}
    `) as unknown as { attempted: boolean; mbid: string | null; version: number }[];
    if (!rows[0]) return { exists: false, mbAttempted: false, mbid: null, version: 0 };
    return { exists: true, mbAttempted: rows[0].attempted, mbid: rows[0].mbid, version: rows[0].version };
  } catch {
    return { exists: false, mbAttempted: false, mbid: null, version: 0 };
  }
}

// Lazy admission + daily refresh entry point: one artist, full fidelity
// (MusicBrainz included). ~3-5 requests. Used by details() when a followed/
// clicked artist isn't in the catalog yet, and by the cron's rotating
// discography refresh.
export async function ingestArtist(deezerId: string | number, mbid?: string | null): Promise<void> {
  const artist = await deezerArtist(deezerId);
  const row = await buildArtistRow(artist, { mbid });
  await upsertCatalog([row]);
}

// Bulk catalog ingestion (scripts/ingest-catalog.ts only) — a related-
// artists BFS out from Deezer's chart seeds (see deezerArtistPool), each
// enriched with full fan counts and released discographies. Deliberately
// withMB: false — MusicBrainz's hard 1 req/s cap would turn thousands of
// artists into hours; the pre-ingested catalog serves search/trending, and
// future-date tracking arrives via the daily cron / lazy admission for the
// artists that actually get followed.
export async function paginatedDeezerArtists(
  targetCount: number,
  onPage?: (fetched: number) => void
): Promise<CatalogRow[]> {
  const pool = await deezerArtistPool(targetCount);
  const rows: CatalogRow[] = [];
  for (const candidate of pool) {
    try {
      // Genre-chart entries are slim (often no nb_fan) — fetch the full
      // artist object so popularity_score is the real fan count.
      const artist = await deezerArtist(candidate.id);
      rows.push(await buildArtistRow(artist, { withMB: false }));
    } catch {
      continue; // one broken artist shouldn't sink a multi-thousand run
    }
    if (rows.length % 50 === 0) onPage?.(rows.length);
  }
  onPage?.(rows.length);
  return rows;
}

// Deezer's own editorial chart — the trending signal for artists, same role
// TMDB trending/week plays for movies (see lib/trending.ts).
export async function discoverDeezerTrendingArtists(limit = 20): Promise<TrendingRow[]> {
  const artists = await deezerChartArtists(limit);
  return artists.map((a, i) => {
    const image = deezerArtistImage(a);
    return {
      id: `artist:${a.id}`,
      type: "artist" as const,
      title: a.name,
      posterURL: image,
      backdropURL: image,
      rank: i + 1,
    };
  });
}
