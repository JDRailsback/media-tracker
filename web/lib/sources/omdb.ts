import type { ReviewScores } from "@/lib/types";

// Rotten Tomatoes has no public API of its own (same story as the watch-
// provider deep-link problem in tmdb.ts — that data is JustWatch/commercial-
// only). OMDb re-publishes RT/IMDb/Metacritic scores per title, keyed by
// IMDb id, on a free tier (1,000 req/day) — plenty, since this is only ever
// called once per title at ingest/refresh time, never on a live page view.

interface OMDbRating {
  Source: string;
  Value: string;
}

interface OMDbResponse {
  Response: "True" | "False";
  imdbRating?: string; // "8.8" or "N/A"
  Ratings?: OMDbRating[];
}

function key(): string {
  const k = process.env.OMDB_API_KEY;
  if (!k) throw new Error("OMDB_API_KEY not set");
  return k;
}

// "87%" -> 87. Returns undefined for "N/A" or anything unparsable rather
// than throwing — a missing score for one title is normal (OMDb doesn't
// have every source for every title) and shouldn't fail the whole fetch.
function parsePercent(value: string | undefined): number | undefined {
  const n = value ? Number(value.replace("%", "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// "74/100" -> 74.
function parseOutOf100(value: string | undefined): number | undefined {
  const n = value ? Number(value.split("/")[0]) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// "8.8" -> 8.8.
function parseDecimal(value: string | undefined): number | undefined {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// imdbId must include the "tt" prefix (TMDB's external_ids.imdb_id and a
// movie's own top-level imdb_id both already carry it). No title/year
// fallback — an id-less lookup risks matching the wrong title (a remake, a
// same-named show) and a silently wrong score is worse than a missing one.
export async function fetchOMDbRatings(imdbId: string | undefined): Promise<ReviewScores | undefined> {
  if (!imdbId || !process.env.OMDB_API_KEY) return undefined;
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${key()}&i=${encodeURIComponent(imdbId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const d = (await res.json()) as OMDbResponse;
    if (d.Response !== "True") return undefined;

    const ratings = d.Ratings ?? [];
    const rt = ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value;
    const metacritic = ratings.find((r) => r.Source === "Metacritic")?.Value;

    const scores: ReviewScores = {
      rottenTomatoes: parsePercent(rt),
      imdb: parseDecimal(d.imdbRating),
      metacritic: parseOutOf100(metacritic),
    };
    // Every field undefined (title known to OMDb but no scores yet — common
    // for something very recent) — treat the same as "nothing to store."
    return Object.values(scores).some((v) => v !== undefined) ? scores : undefined;
  } catch {
    return undefined;
  }
}
