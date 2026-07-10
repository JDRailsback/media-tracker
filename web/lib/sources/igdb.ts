import type { ExternalLink, MediaItem } from "@/lib/types";
import type { CatalogRow } from "@/lib/catalog";
import type { UpcomingRow } from "@/lib/upcoming";
import { isExactMatch, RankedItem } from "./textMatch";

// IGDB adapter (TS port). OAuth token + POST query body.

// Quality bar: released games need real rating volume; unreleased games get a
// pass (they legitimately have none yet) as long as they have cover art.
const MIN_RATING_COUNT = 5;

// A non-exact match (e.g. a niche edition like "Minecraft Education" when you
// search "minecraft") needs to be much more significant to show up at all.
// Searching its exact name still finds it (exact match = lenient bar above).
// Applies ONLY to already-released games — see passesQualityBar.
const NON_EXACT_MIN_RATING_COUNT = 50;

// A minimum "hypes" (people marked as looking forward to it) for an
// unreleased game to count as genuinely significant for RANKING purposes.
// Verified live: an old, dateless "Toy Story" catalog entry (almost
// certainly a data-incomplete duplicate, not a real upcoming release) had
// hypes: 1 and was wrongly ranked as significant — 1 hype is noise, not a
// real anticipation signal.
const MIN_SIGNIFICANT_HYPES = 10;

interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  cover?: { url?: string };
  first_release_date?: number; // Unix seconds
  total_rating_count?: number;
  hypes?: number;
  game_type?: number | null;
}

// A CONFIRMED future (or just-released) title — a real date on the record,
// either still upcoming or recent enough that it hasn't had time to earn
// ratings yet. This is the only case that gets an unconditional pass. A
// MISSING date is NOT the same thing and must not be treated as
// "unreleased" — verified live twice: an obscure "Toy Story" entry and "One
// Piece Kings" both have NO date, NO rating count, and ~0 hype (almost
// certainly old/incomplete or fan-made catalog entries, not real upcoming
// releases), and were wrongly admitted unconditionally when a missing date
// was treated as "isFuture = true". A grace period after the release date
// (not just a strict future check) matters too — see the identical fix and
// its rationale in lib/sources/tmdb.ts (RECENT_RELEASE_GRACE_DAYS).
const RECENT_RELEASE_GRACE_DAYS = 14;

function isConfirmedFuture(g: IGDBGame): boolean {
  if (!g.first_release_date) return false;
  const graceMs = RECENT_RELEASE_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return g.first_release_date * 1000 + graceMs > Date.now();
}

function passesQualityBar(g: IGDBGame, isExact: boolean): boolean {
  if (!g.cover?.url) return false;
  if (isConfirmedFuture(g)) return true;
  // Already-released OR no date on file at all: needs a real signal (rating
  // count or hype) — scaled by exact vs. non-exact, same as every other
  // source. No more automatic pass just because a date is absent.
  const minCount = isExact ? MIN_RATING_COUNT : NON_EXACT_MIN_RATING_COUNT;
  const minHypes = isExact ? 1 : MIN_SIGNIFICANT_HYPES;
  return (g.total_rating_count ?? 0) >= minCount || (g.hypes ?? 0) >= minHypes;
}

// Would this game clear the bar even judged as a non-exact match? Ranking
// signal only (see RankedItem) — lets a hugely popular near-match outrank an
// obscure exact-match title.
function isSignificant(g: IGDBGame): boolean {
  if (isConfirmedFuture(g)) return (g.hypes ?? 0) >= MIN_SIGNIFICANT_HYPES;
  return (g.total_rating_count ?? 0) >= NON_EXACT_MIN_RATING_COUNT;
}

// IGDB tags every sub-entry (seasons, episodes, DLC, packs, updates,
// remasters, editions...) as its own "game" with a `game_type`. Verified LIVE
// against real responses (see docs/DISCOVER_AND_SEARCH.md):
//   7  = season       ("Fortnite: Season 6/7/8...")
//   13 = pack          ("Fortnite Festival: <song>", "Minecraft: ... Skin Pack")
//   6  = episode       ("Minecraft: Story Mode - Episode 5")
//   14 = update        ("Minecraft: Nether Update", "Caves & Cliffs")
//   5  = mod           ("A Minecraft Movie DLC/Add-On/Hero Pack" — community content)
//   3  = bundle        ("Cyberpunk 2077: Ultimate Edition", "Skyrim: Legendary Edition")
//   2  = expansion     ("Fortnite: Save the World", "Cyberpunk 2077: Phantom Liberty")
//   1  = dlc_addon     ("Skyrim: Dawnguard/Hearthfire" — official paid DLC)
//   9  = remaster      ("Skyrim - Special Edition", total_rating_count 437 —
//                        would otherwise clear the popularity bar easily)
//   10 = expanded_game ("Skyrim - Anniversary Edition")
// Note 1 vs 5 vs 2 all superficially look like "DLC" but are genuinely
// distinct IGDB categories (official small DLC / community mod / larger
// official expansion) — confirmed by cross-checking Bethesda's official
// Dawnguard/Hearthfire (1) against Minecraft's community add-on packs (5).
// A DENYLIST, not an allowlist: the real flagship "Minecraft" entry itself
// is tagged 11 ("port"), not 0 ("main_game") — an allowlist of just {0}
// silently excluded the actual base game. Deny only the confirmed-junk
// types; let everything else (0, 11, and anything unobserved) through.
// Deliberately NOT denied: 8 (remake) — a ground-up rebuild (e.g. Resident
// Evil 2 Remake) is a distinct, separately-worth-tracking product, unlike a
// remaster (a cosmetic re-release of the same game).
export const JUNK_GAME_TYPES = new Set([1, 2, 3, 5, 6, 7, 9, 10, 13, 14]);

export function isMainGame(g: IGDBGame): boolean {
  return g.game_type == null || !JUNK_GAME_TYPES.has(g.game_type);
}

// Twitch client_credentials tokens are valid for ~60 days, but this was
// fetching a BRAND NEW token on every single search call — wasteful on its
// own, and directly responsible for a real reliability problem: the typo
// retry fallback (up to ~80 concurrent search attempts) was ALSO firing ~80
// concurrent token requests, hitting Twitch's auth endpoint hard enough to
// trigger real 429s that made otherwise-correct typo corrections silently
// fail. Cached module-level, including the in-flight PROMISE (not just the
// resolved value) so concurrent callers share one request instead of each
// starting their own before the first one resolves.
let cachedToken: { token: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (pendingToken) return pendingToken;

  pendingToken = (async () => {
    const id = process.env.IGDB_CLIENT_ID;
    const secret = process.env.IGDB_CLIENT_SECRET;
    if (!id || !secret) throw new Error("IGDB credentials not set");

    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error(`IGDB auth failed: ${res.status}`);
    const data = await res.json();
    // Refresh 5 minutes early rather than cutting it exactly at expiry.
    cachedToken = {
      token: data.access_token as string,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };
    return cachedToken.token;
  })();

  try {
    return await pendingToken;
  } finally {
    pendingToken = null;
  }
}

// IGDB enforces ~4 requests/second per API key — verified live: even with the
// token cached, a plain single-word search ("skyrim") started throwing real
// 429s once the typo-fallback path's concurrent workers (see
// mapWithConcurrency in lib/sources/index.ts) were in flight at the same
// time. Bounding CONCURRENCY isn't enough to respect a rate-over-time limit
// (4 in-flight slots with ~300ms latency each still starts far more than 4
// requests/sec) — this tracks actual request start times in a rolling
// 1-second window and makes every caller wait its turn, globally, regardless
// of how many callers (typo variants, discover shelves, concurrent users)
// are asking at once. Chained through `gate` so concurrent callers check the
// window serially instead of racing each other to the same slot.
const MAX_REQUESTS_PER_WINDOW = 4;
const WINDOW_MS = 1000;
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

async function query(body: string): Promise<IGDBGame[]> {
  const clientID = process.env.IGDB_CLIENT_ID as string;
  const token = await getToken();

  await throttle();
  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": clientID, Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new Error(`IGDB request failed: ${res.status}`);
  return (await res.json()) as IGDBGame[];
}

function mapGame(g: IGDBGame): MediaItem {
  let posterURL: string | undefined;
  if (g.cover?.url) {
    const big = g.cover.url.replace("t_thumb", "t_cover_big");
    posterURL = big.startsWith("//") ? `https:${big}` : big;
  }
  return {
    id: `game:${g.id}`,
    type: "game",
    title: g.name,
    overview: g.summary,
    posterURL,
    releaseDate: g.first_release_date
      ? new Date(g.first_release_date * 1000).toISOString()
      : undefined,
  };
}

const SEARCH_FIELDS = "name,summary,cover.url,first_release_date,total_rating_count,hypes,game_type";

// IGDB sometimes has more than one entry for the same title (e.g. a
// main_game AND a separate port/edition entry both literally named
// "Fortnite"). Keep only the highest-signal one per exact title.
function dedupeByTitle(games: IGDBGame[]): IGDBGame[] {
  const best = new Map<string, IGDBGame>();
  for (const g of games) {
    const key = g.name.trim().toLowerCase();
    const existing = best.get(key);
    if (!existing || (g.total_rating_count ?? 0) > (existing.total_rating_count ?? 0)) {
      best.set(key, g);
    }
  }
  return [...best.values()];
}

export async function searchIGDB(q: string, opts?: { lenient?: boolean }): Promise<RankedItem[]> {
  // Fetch a larger raw candidate pool since filtering (quality + main-game)
  // happens after the fetch, not in the query itself. 200, not 50 — verified
  // live that IGDB's own search relevance for a broad query (e.g. "mario",
  // "minecraft") can rank a genuinely massive hit (Super Mario Galaxy,
  // total_rating_count 1265; Minecraft: Story Mode, 133) past position 50,
  // purely because so many other same-franchise entries also match.
  const games = await query(`search "${q}"; fields ${SEARCH_FIELDS}; limit 200;`);
  // `lenient` (used only by franchise resolution — lib/sources/franchise.ts)
  // treats every result as if it were an exact match for quality-bar
  // purposes. Verified live: searching "One Piece" returns 128 raw games,
  // almost none literally titled just "One Piece" — real, well-known entries
  // like "One Piece: World Seeker" (total_rating_count 32) and "One Piece:
  // Burning Blood" (38) were being cut by the NON-exact-match bar (needs
  // >=50), which exists to fight general-search clutter, not to thin out a
  // franchise's own already-precise, curated query.
  return dedupeByTitle(
    games.filter(isMainGame).filter((g) => passesQualityBar(g, opts?.lenient || isExactMatch(g.name, q)))
  ).map((g) => ({ ...mapGame(g), significant: isSignificant(g), popularity: g.total_rating_count ?? 0 }));
}

// Recognized storefront domains. Verified live against a real IGDB response
// (The Witcher 3): IGDB's `websites` field has NO usable category field (it
// came back empty even when requested), so we match by URL domain instead —
// robust and doesn't depend on an undocumented/uncertain enum.
const STORE_DOMAINS: { pattern: string; provider: string }[] = [
  { pattern: "store.steampowered.com", provider: "Steam" },
  { pattern: "epicgames.com", provider: "Epic Games Store" },
  { pattern: "xbox.com", provider: "Xbox" },
  { pattern: "playstation.com", provider: "PlayStation Store" },
  { pattern: "nintendo.com", provider: "Nintendo eShop" },
  { pattern: "gog.com", provider: "GOG" },
];

export function storeLinks(websites: { url?: string }[] | undefined): ExternalLink[] | undefined {
  if (!websites) return undefined;
  const links: ExternalLink[] = [];
  for (const w of websites) {
    if (!w.url) continue;
    const match = STORE_DOMAINS.find((d) => w.url!.includes(d.pattern));
    if (match) links.push({ provider: match.provider, url: w.url, kind: "store" });
  }
  return links.length ? links : undefined;
}

export async function detailsIGDB(id: string): Promise<MediaItem> {
  const games = await query(
    `fields name,summary,cover.url,first_release_date,websites.url,url; where id = ${id};`
  );
  if (games.length === 0) throw new Error(`Game ${id} not found`);
  const game = games[0] as IGDBGame & { websites?: { url?: string }[]; url?: string };
  const item = mapGame(game);
  // Always link to SOMETHING (same principle as MangaDex/TMDB fallbacks) —
  // a game with no recognized storefront link still gets its own IGDB page.
  // IGDB's own page URL is slug-based (e.g. "/games/the-witcher-3-wild-hunt"),
  // NOT the numeric id — verified live, so this uses IGDB's own `url` field
  // rather than guessing a URL shape.
  item.externalLinks = storeLinks(game.websites) ??
    (game.url ? [{ provider: "IGDB", url: game.url, kind: "info" }] : undefined);
  return item;
}

// Popular, already-released games (for the Discover page's "Popular games" shelf).
export async function discoverIGDBPopular(limit = 20): Promise<MediaItem[]> {
  const games = await query(
    `fields ${SEARCH_FIELDS}; where total_rating_count > 50 & cover != null; sort total_rating_count desc; limit ${limit * 2};`
  );
  return games.filter(isMainGame).slice(0, limit).map(mapGame);
}

// Anticipated, not-yet-released games (for "Popular upcoming").
// Big and/or brand-new upcoming games, DATED OR NOT (for "Popular
// upcoming" — see /api/cron/upcoming, lib/upcoming.ts). Filtered to NOT YET
// RELEASED (no first_release_date, or a future one) — never something
// already out. Two sorts merged: hypes desc (IGDB's own "anticipation"
// counter, built for exactly "big, no date yet") and created_at desc
// (catches a brand-new announcement before hype has had time to accumulate).
export async function discoverIGDBUpcoming(limit = 60): Promise<UpcomingRow[]> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const condition = `(first_release_date = null | first_release_date > ${nowSeconds}) & cover != null`;
  const [byHype, byNew] = await Promise.all([
    query(`fields ${SEARCH_FIELDS}; where ${condition}; sort hypes desc; limit ${limit};`),
    query(`fields ${SEARCH_FIELDS}; where ${condition}; sort created_at desc; limit ${limit};`),
  ]);

  const rows = new Map<string, UpcomingRow>();
  for (const g of [...byHype, ...byNew].filter(isMainGame)) {
    const mapped = mapGame(g);
    if (rows.has(mapped.id)) continue;
    rows.set(mapped.id, {
      id: mapped.id,
      type: "game",
      title: mapped.title,
      overview: mapped.overview,
      posterURL: mapped.posterURL,
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString() : undefined,
      dateConfirmed: !!g.first_release_date,
      popularityScore: g.hypes ?? 0,
    });
  }
  return [...rows.values()].slice(0, limit);
}

// ---------- Bulk catalog ingestion (scripts/ingest-catalog.ts only) ----------
// Sorted by total_rating_count (the same stable, cumulative signal used for
// search ranking — see the rationale in searchIGDB), so "most popular N"
// means the N most-rated real games, not hype/trending. IGDB's query
// endpoint supports up to 500 rows per request with offset-based paging.
interface IGDBGameWithGenres extends IGDBGame {
  genres?: { name: string }[];
  platforms?: { name: string }[];
  websites?: { url?: string }[];
  franchises?: { name: string }[];
  keywords?: { name: string }[];
  themes?: { name: string }[];
}

// platforms.name, websites.url, and franchises/keywords/themes all come back
// inline on the same request — no extra per-item call needed, unlike TMDB's
// runtime/watch-providers. franchises/keywords/themes feed `tags`, a superset
// of genres used ONLY for collection matching (see
// scripts/rebuild-collections.ts), never shown in the UI the way genres are.
const CATALOG_FIELDS = `${SEARCH_FIELDS},genres.name,platforms.name,websites.url,franchises.name,keywords.name,themes.name`;
const IGDB_PAGE_SIZE = 500;

export async function paginatedIGDBGames(
  targetCount: number,
  onPage?: (fetched: number) => void
): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let offset = 0; rows.length < targetCount; offset += IGDB_PAGE_SIZE) {
    const games = (await query(
      `fields ${CATALOG_FIELDS}; where total_rating_count > 0 & cover != null; sort total_rating_count desc; limit ${IGDB_PAGE_SIZE}; offset ${offset};`
    )) as IGDBGameWithGenres[];
    if (games.length === 0) break;
    for (const g of games.filter(isMainGame)) {
      const mapped = mapGame(g);
      rows.push({
        id: mapped.id,
        type: "game",
        title: mapped.title,
        overview: mapped.overview,
        posterURL: mapped.posterURL,
        releaseDate: mapped.releaseDate,
        popularityScore: g.total_rating_count ?? 0,
        genres: (g.genres ?? []).map((x) => x.name),
        // Real storefront links only — storeLinks() already returns
        // undefined rather than falling back to IGDB's own page (that
        // fallback only happens in detailsIGDB, for the live single-item view).
        externalLinks: storeLinks(g.websites) ?? [],
        metadata: { platforms: (g.platforms ?? []).map((p) => p.name) },
        tags: [
          ...new Set(
            [...(g.franchises ?? []), ...(g.keywords ?? []), ...(g.themes ?? [])]
              .map((t) => t.name?.toLowerCase().trim())
              .filter((n): n is string => !!n)
          ),
        ],
      });
    }
    onPage?.(rows.length);
    if (games.length < IGDB_PAGE_SIZE) break;
  }
  return rows.slice(0, targetCount);
}
