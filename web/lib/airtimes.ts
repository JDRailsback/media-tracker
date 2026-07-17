import type { MediaItem } from "@/lib/types";
import { db, ensureSchema } from "@/lib/db";
import { tvmazeAirstamps } from "@/lib/sources/tvmaze";
import { platformDropTimeUTC } from "@/lib/streamingSchedules";

// Lazy TV air-time attachment. Real times (TVmaze airstamps) are fetched
// the first time a show with an upcoming episode is actually RESOLVED —
// the Home feed refresh or the detail modal, via details() — then cached in
// the show's catalog metadata under their own key and served from there.
// When TVmaze has no confirmed broadcast TIME, a known-platform release
// convention (lib/streamingSchedules.ts — e.g. Apple TV+'s 12:00 AM
// Pacific, verified against published release-schedule coverage) supplies
// it instead, anchored to TVmaze's own DATE rather than TMDB's — see
// TVmazeSchedule's doc comment in lib/sources/tvmaze.ts for why TVmaze's
// date is the more reliable of the two for this.
//
// Deliberately NOT part of the daily cron: TVmaze's ~2 req/s ceiling times
// the ~230 shows the recent-TV stage touches would blow Vercel's 60s
// budget, and that stage rebuilds metadata daily anyway (wiping anything
// attached). Lazy read-side attachment costs 2 keyless requests once per
// show, only for shows someone actually looks at, and self-heals after
// every metadata rebuild the same way it populated the first time.

// How long a fetched schedule is trusted before re-checking TVmaze. Air
// times/dates shift rarely (schedule changes, delays) — a day is fresh
// enough for a "tonight · 9 PM" display, and it means a Home feed with
// several followed shows costs ZERO TVmaze calls on almost every load.
const AIRSTAMP_TTL_MS = 24 * 60 * 60 * 1000;

interface AirStampCache {
  fetchedAt: string;
  // "season:episode" -> a REAL UTC timestamp (only when TVmaze has an
  // actual broadcast time on file). Empty object = show checked and not
  // matched on TVmaze (negative cache — don't re-query every read).
  byEpisode: Record<string, string>;
  // "season:episode" -> TVmaze's own calendar date, populated whenever the
  // show is matched, regardless of whether a real time exists — the date
  // anchor for the platform-convention estimate below.
  byEpisodeDate: Record<string, string>;
}

// Cross-check an airstamp against TMDB's own (already-trusted) day-precision
// date for the same episode before ever displaying it. A real broadcast
// legitimately shifts by ONE calendar day depending on timezone (a 9 PM
// Eastern airing is 01:00 UTC the next day — the UTC date of a real
// timestamp routinely differs from TMDB's local broadcast date by exactly
// one), so the check allows that, but nothing wider. This caught a real
// case live: TVmaze had Silo's whole season 3 dated a day later than TMDB's
// (confirmed-correct) schedule, with every one of those episodes ALSO
// carrying airtime: "" — see lib/sources/tvmaze.ts's filter, which is the
// cheaper first-pass guard; this is the second, independent one.
function withinOneDay(tmdbDateISO: string, airstamp: string): boolean {
  const tmdb = /^(\d{4})-(\d{2})-(\d{2})/.exec(tmdbDateISO);
  if (!tmdb) return false;
  const tmdbUTC = Date.UTC(Number(tmdb[1]), Number(tmdb[2]) - 1, Number(tmdb[3]));
  const stampDate = new Date(airstamp);
  if (Number.isNaN(stampDate.getTime())) return false;
  const stampUTC = Date.UTC(stampDate.getUTCFullYear(), stampDate.getUTCMonth(), stampDate.getUTCDate());
  return Math.abs(stampUTC - tmdbUTC) <= 86_400_000;
}

export async function attachTVAirtimes(item: MediaItem): Promise<MediaItem> {
  // Only meaningful for a catalog TV show with a known next episode — the
  // subtitle carries which one (see catalogRowToMediaItem's tvShow branch).
  if (item.type !== "tvShow" || !item.releaseDate) return item;

  try {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`
      SELECT metadata->'airStamps' AS stamps, metadata->>'imdbId' AS imdb, metadata->'networks' AS networks
      FROM catalog_items WHERE id = ${item.id}
    `) as unknown as { stamps: AirStampCache | null; imdb: string | null; networks: string[] | null }[];
    if (!rows[0]) return item; // not a catalog row (e.g. upcoming-only) — nothing to cache on
    const networks = rows[0].networks ?? undefined;

    let stamps = rows[0].stamps;
    const stale = !stamps || Date.now() - Date.parse(stamps.fetchedAt) > AIRSTAMP_TTL_MS;
    if (stale) {
      const fetched = await tvmazeAirstamps(rows[0].imdb, item.title);
      stamps = { fetchedAt: new Date().toISOString(), byEpisode: fetched?.byEpisode ?? {}, byEpisodeDate: fetched?.byEpisodeDate ?? {} };
      // jsonb || merge: touches ONLY the airStamps key, so a concurrent
      // metadata rebuild can't be clobbered (and vice versa — a rebuild
      // dropping this key just means the next read re-fetches).
      await sql`
        UPDATE catalog_items SET metadata = metadata || ${JSON.stringify({ airStamps: stamps })}::jsonb
        WHERE id = ${item.id}
      `;
    }

    const byEpisode = stamps?.byEpisode ?? {};
    const byEpisodeDate = stamps?.byEpisodeDate ?? {};
    // Real TVmaze time first (cross-checked — e.airDate absent means
    // nothing to check against, so skip rather than trust blind, same
    // conservative call as an outright date mismatch). Otherwise, the
    // known-platform drop time — anchored to TVmaze's date when TVmaze
    // matched the show at all, since that's the more reliable of the two
    // (see TVmazeSchedule's doc comment); TMDB's date is only a fallback
    // anchor for a show TVmaze doesn't have.
    const episodes = item.episodes?.map((e) => {
      const real = byEpisode[`${e.season}:${e.episode}`];
      if (real && e.airDate && withinOneDay(e.airDate, real)) return { ...e, airStamp: real };
      const anchorDate = byEpisodeDate[`${e.season}:${e.episode}`] ?? e.airDate;
      const platform = anchorDate ? platformDropTimeUTC(networks, anchorDate) : undefined;
      return platform ? { ...e, airStamp: platform } : e;
    });

    const next = /^S(\d+) E(\d+)$/.exec(item.subtitle ?? "");
    const nextRealStamp = next ? byEpisode[`${next[1]}:${next[2]}`] : undefined;
    if (nextRealStamp && withinOneDay(item.releaseDate, nextRealStamp)) {
      return { ...item, episodes, releaseAt: nextRealStamp };
    }
    const nextAnchorDate = (next && byEpisodeDate[`${next[1]}:${next[2]}`]) ?? item.releaseDate;
    const nextPlatform = platformDropTimeUTC(networks, nextAnchorDate);
    return nextPlatform ? { ...item, episodes, releaseAt: nextPlatform } : { ...item, episodes };
  } catch {
    // Times are enhancement, never a gate — any failure just means
    // day-precision display, exactly what the app did before.
    return item;
  }
}
